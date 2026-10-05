import type { Hardware } from "@/lib/network/hardware";
import type { NetworkDevice } from "@/lib/networkSnapshot";
import { CLUSTER_ARTIST_THRESHOLD, CLUSTER_MAX_DEPTH } from "./constants";

export type StablePoint = { x: number; y: number };
export type ArtistGroup = {
  kind: "artist";
  id: string;
  artistKey: string;
  label: string;
  devices: NetworkDevice[];
  onlineCount: number;
  screenCount: number;
  hardwareCounts: Record<Hardware, number>;
  lastActivity: number;
  /** Position pseudo-aléatoire STABLE, indépendante du matériel et de l'activité. */
  seedPoint: StablePoint;
};

export type ClusterGroup = {
  kind: "cluster";
  id: string;
  path: string;
  label: string;
  depth: number;
  /** Position stable du lot, dérivée de son identifiant et non de l'activité. */
  seedPoint: StablePoint;
  children: HierarchyChild[];
  artistCount: number;
  deviceCount: number;
  onlineCount: number;
  lastActivity: number;
};

export type HierarchyChild = ArtistGroup | ClusterGroup;

export type NetworkHierarchy = {
  kind: "network";
  id: "network:public";
  children: HierarchyChild[];
  artists: ArtistGroup[];
  artistCount: number;
  deviceCount: number;
};

/** FNV-1a 32 bits, identique sur serveur et navigateur. */
export function stableHash32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deux coordonnées stables et décorrélées dans [0, 1[. */
export function stablePointForKey(key: string): StablePoint {
  const x = stableHash32(`x:${key}`) / 0x1_0000_0000;
  const y = stableHash32(`y:${key}`) / 0x1_0000_0000;
  return { x, y };
}

export function artistNodeId(artistKey: string): string {
  return `artist:${artistKey}`;
}

export function deviceNodeId(publicId: string): string {
  return `device:${publicId}`;
}

export function screenNodeId(publicId: string, screen: string): string {
  return `screen:${publicId}:${screen}`;
}

function activityOf(device: NetworkDevice): number {
  return Math.max(device.lastSeen || 0, device.lastPing || 0, device.recentFrame?.createdAt || 0);
}

/** Regroupe exclusivement avec `artistKey`, jamais avec le nom affiché. */
export function groupDevicesByArtist(devices: readonly NetworkDevice[]): ArtistGroup[] {
  const buckets = new Map<string, NetworkDevice[]>();
  for (const device of devices) {
    const key = device.artistKey || "unassigned";
    const bucket = buckets.get(key) ?? [];
    bucket.push(device);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([artistKey, rawDevices]) => {
      const sorted = [...rawDevices].sort((a, b) => a.publicId.localeCompare(b.publicId));
      const named = sorted.find((device) => device.artistName?.trim())?.artistName?.trim();
      const hardwareCounts: Record<Hardware, number> = { "esp8266": 0, "uno-r4": 0, unknown: 0 };
      for (const device of sorted) hardwareCounts[device.hardware]++;
      return {
        kind: "artist" as const,
        id: artistNodeId(artistKey),
        artistKey,
        label: artistKey === "unassigned" ? "Non associés" : named || "Artiste sans nom",
        devices: sorted,
        onlineCount: sorted.filter((device) => device.isOnline).length,
        screenCount: sorted.reduce((total, device) => total + device.screens.length, 0),
        hardwareCounts,
        lastActivity: Math.max(0, ...sorted.map(activityOf)),
        seedPoint: stablePointForKey(artistKey),
      };
    });
}

function summariseCluster(path: string, depth: number, ordinal: number, children: HierarchyChild[]): ClusterGroup {
  const artists = children.flatMap((child) => child.kind === "artist" ? [child] : flattenArtists(child));
  return {
    kind: "cluster",
    id: `cluster:${path}`,
    path,
    // Ce regroupement est un niveau de détail technique, pas une communauté
    // réelle. Le libellé n'est donc jamais présenté comme un « lot » métier.
    label: depth === 1 ? `Zone ${ordinal + 1}` : `Sous-zone ${ordinal + 1}`,
    depth,
    seedPoint: stablePointForKey(`cluster:${path}`),
    children,
    artistCount: artists.length,
    deviceCount: artists.reduce((total, artist) => total + artist.devices.length, 0),
    onlineCount: artists.reduce((total, artist) => total + artist.onlineCount, 0),
    lastActivity: Math.max(0, ...artists.map((artist) => artist.lastActivity)),
  };
}

function clusterCountFor(artistCount: number): number {
  return Math.max(3, Math.min(12, Math.ceil(Math.sqrt(artistCount))));
}

/**
 * Répartition mixte demandée : préférence `hash(artistKey) mod k`, puis léger
 * équilibrage déterministe lorsque plusieurs hashes tombent dans le même lot.
 * Le seul changement structurel possible vient donc d'un changement de `k`.
 */
function balancedClusters(artists: ArtistGroup[], path: string, depth: number): ClusterGroup[] {
  const count = Math.min(artists.length, clusterCountFor(artists.length));
  const capacity = Math.ceil(artists.length / count);
  const buckets: ArtistGroup[][] = Array.from({ length: count }, () => []);
  const ordered = [...artists].sort((a, b) => {
    const delta = stableHash32(a.artistKey) - stableHash32(b.artistKey);
    return delta || a.artistKey.localeCompare(b.artistKey);
  });

  for (const artist of ordered) {
    const preferred = stableHash32(artist.artistKey) % count;
    let bucket = preferred;
    for (let offset = 0; offset < count && buckets[bucket].length >= capacity; offset++) {
      bucket = (preferred + offset + 1) % count;
    }
    buckets[bucket].push(artist);
  }

  return buckets.flatMap((items, ordinal) => {
    if (items.length === 0) return [];
    const childPath = `${path}.${ordinal}`;
    const children: HierarchyChild[] = items.length > CLUSTER_ARTIST_THRESHOLD && depth < CLUSTER_MAX_DEPTH
      ? balancedClusters(items, childPath, depth + 1)
      : [...items].sort((a, b) => a.artistKey.localeCompare(b.artistKey));
    return [summariseCluster(childPath, depth, ordinal, children)];
  });
}

/**
 * Hiérarchie mixte et stable : `hash32(artistKey) mod k`, avec équilibrage
 * déterministe. Le matériel, l'écran, l'état en ligne et l'activité ne
 * participent JAMAIS au regroupement.
 */
export function buildNetworkHierarchy(devices: readonly NetworkDevice[]): NetworkHierarchy {
  const artists = groupDevicesByArtist(devices);
  const children: HierarchyChild[] = artists.length > CLUSTER_ARTIST_THRESHOLD
    ? balancedClusters(artists, "lot", 1)
    : artists;
  return {
    kind: "network",
    id: "network:public",
    children,
    artists,
    artistCount: artists.length,
    deviceCount: devices.length,
  };
}

export function flattenArtists(node: ClusterGroup | NetworkHierarchy): ArtistGroup[] {
  return node.children.flatMap((child) => child.kind === "artist" ? [child] : flattenArtists(child));
}

export function flattenClusters(node: ClusterGroup | NetworkHierarchy): ClusterGroup[] {
  return node.children.flatMap((child) => child.kind === "artist" ? [] : [child, ...flattenClusters(child)]);
}
