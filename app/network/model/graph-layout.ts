import type { NetworkDevice } from "@/lib/networkSnapshot";
import { CORE_NODE_ID, GRAPH_GEOMETRY } from "./constants";
import {
  artistNodeId,
  deviceNodeId,
  flattenClusters,
  screenNodeId,
  stableHash32,
  type ArtistGroup,
  type ClusterGroup,
  type HierarchyChild,
  type NetworkHierarchy,
  type StablePoint,
} from "./groups";

// Nom volontairement distinct de `layout.ts`, réservé par l'App Router Next.js.
export type GraphNodeKind = "core" | "cluster" | "artist" | "device" | "screen";

export type LayoutNode = {
  id: string;
  kind: GraphNodeKind;
  parentId?: string;
  x: number;
  y: number;
  radius: number;
  depth: number;
  weight: number;
  artistKey?: string;
  publicId?: string;
  screen?: string;
};

export type LayoutLink = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "hierarchy" | "device" | "screen";
};

export type GraphLayout = {
  nodes: LayoutNode[];
  links: LayoutLink[];
  nodeIndex: Map<string, LayoutNode>;
  world: { x: number; y: number; width: number; height: number };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pointToWorld(point: StablePoint, size: number): { x: number; y: number } {
  let x = (point.x - 0.5) * size * 0.84;
  let y = (point.y - 0.5) * size * 0.84;
  const distance = Math.hypot(x, y);
  const coreGap = 250;
  if (distance < coreGap) {
    const angle = Math.atan2(y || 1, x || 1);
    x = Math.cos(angle) * coreGap;
    y = Math.sin(angle) * coreGap;
  }
  return { x, y };
}

function resolveArtistPositions(artists: ArtistGroup[], size: number): Map<string, { x: number; y: number }> {
  const placed: { x: number; y: number }[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  const minGap = GRAPH_GEOMETRY.artistMinGap;
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (const artist of [...artists].sort((a, b) => a.artistKey.localeCompare(b.artistKey))) {
    const origin = pointToWorld(artist.seedPoint, size);
    const phase = (stableHash32(`phase:${artist.artistKey}`) / 0x1_0000_0000) * Math.PI * 2;
    let candidate = origin;
    for (let attempt = 0; attempt < 32; attempt++) {
      if (!placed.some((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) < minGap)) break;
      const radius = minGap * (0.55 + Math.sqrt(attempt + 1));
      const angle = phase + attempt * golden;
      candidate = { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
    }
    placed.push(candidate);
    positions.set(artist.artistKey, candidate);
  }
  return positions;
}

function clusterPosition(cluster: ClusterGroup, size: number): { x: number; y: number } {
  return pointToWorld(cluster.seedPoint, size);
}

function orderedByStableHash<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return stableHash32(ka) - stableHash32(kb) || ka.localeCompare(kb);
  });
}

/** Place les zones de densité autour du core puis leurs artistes dans la zone. */
function resolveHierarchyPositions(hierarchy: NetworkHierarchy, size: number) {
  const artistPositions = new Map<string, { x: number; y: number }>();
  const clusterPositions = new Map<string, { x: number; y: number }>();
  if (!hierarchy.children.some((child) => child.kind === "cluster")) {
    return { artistPositions: resolveArtistPositions(hierarchy.artists, size), clusterPositions };
  }

  const arrange = (children: HierarchyChild[], center: { x: number; y: number }, parentKey: string, depth: number) => {
    const childClusters = orderedByStableHash(children.filter((child): child is ClusterGroup => child.kind === "cluster"), (child) => child.id);
    const childArtists = orderedByStableHash(children.filter((child): child is ArtistGroup => child.kind === "artist"), (child) => child.artistKey);
    const phase = (stableHash32(`phase:${parentKey}`) / 0x1_0000_0000) * Math.PI * 2;

    childClusters.forEach((cluster, index) => {
      // Les zones principales respirent largement. Les sous-zones restent
      // proches de leur parent afin que le zoom raconte la hiérarchie.
      const radius = depth === 0 ? Math.max(760, size * 0.43) : Math.max(235, size * 0.12);
      const angle = phase + (Math.PI * 2 * index) / Math.max(1, childClusters.length);
      // La page est naturellement panoramique : une ellipse exploite la largeur
      // disponible et évite l'effet « petite couronne au milieu d'un désert ».
      const xRadius = depth === 0 ? Math.max(900, size * 0.56) : radius;
      const yRadius = depth === 0 ? Math.max(620, size * 0.3) : radius;
      const position = { x: center.x + Math.cos(angle) * xRadius, y: center.y + Math.sin(angle) * yRadius };
      clusterPositions.set(cluster.id, position);
      arrange(cluster.children, position, cluster.id, depth + 1);
    });

    const firstRingCapacity = 10;
    childArtists.forEach((artist, index) => {
      const ring = Math.floor(index / firstRingCapacity);
      const before = ring * firstRingCapacity;
      const capacity = Math.min(firstRingCapacity, childArtists.length - before);
      const angle = phase + (Math.PI * 2 * (index - before)) / Math.max(1, capacity) + ring * 0.32;
      const radius = depth === 0 ? Math.max(390, size * 0.38) : 245 + ring * 205;
      artistPositions.set(artist.artistKey, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
    });
  };

  arrange(hierarchy.children, { x: 0, y: 0 }, hierarchy.id, 0);
  return { artistPositions, clusterPositions };
}

function devicePosition(artist: ArtistGroup, device: NetworkDevice, index: number, center: { x: number; y: number }) {
  const firstCapacity = 8;
  const ring = index < firstCapacity ? 0 : 1 + Math.floor((index - firstCapacity) / 14);
  const before = ring === 0 ? 0 : firstCapacity + (ring - 1) * 14;
  const capacity = ring === 0 ? Math.min(firstCapacity, artist.devices.length) : Math.min(14, artist.devices.length - before);
  const inRing = index - before;
  const phase = (stableHash32(`orbit:${artist.artistKey}`) / 0x1_0000_0000) * Math.PI * 2;
  const angle = phase + (Math.PI * 2 * inRing) / Math.max(1, capacity);
  const radius = GRAPH_GEOMETRY.deviceOrbit + ring * GRAPH_GEOMETRY.deviceRingGap;
  const jitter = (stableHash32(device.publicId) % 17) - 8;
  return { x: center.x + Math.cos(angle) * (radius + jitter), y: center.y + Math.sin(angle) * (radius + jitter) };
}

/**
 * Layout sans simulation de forces : mêmes clés + mêmes dimensions ⇒ mêmes
 * coordonnées, quel que soit l'ordre d'entrée ou l'activité courante.
 */
export function layoutNetwork(hierarchy: NetworkHierarchy): GraphLayout {
  const artistCount = Math.max(1, hierarchy.artistCount);
  const size = Math.max(GRAPH_GEOMETRY.minWorldSize, Math.sqrt(artistCount) * GRAPH_GEOMETRY.worldSizePerArtist);
  const { artistPositions, clusterPositions } = resolveHierarchyPositions(hierarchy, size);
  const nodes: LayoutNode[] = [{
    id: CORE_NODE_ID,
    kind: "core",
    x: 0,
    y: 0,
    radius: 64,
    depth: 0,
    weight: Math.max(1, hierarchy.deviceCount),
  }];
  const links: LayoutLink[] = [];

  const addLink = (sourceId: string, targetId: string, kind: LayoutLink["kind"]) => {
    links.push({ id: `${sourceId}->${targetId}`, sourceId, targetId, kind });
  };

  const addArtist = (artist: ArtistGroup, parentId: string, depth: number) => {
    const position = artistPositions.get(artist.artistKey) ?? { x: 0, y: 0 };
    const id = artistNodeId(artist.artistKey);
    nodes.push({
      id,
      kind: "artist",
      parentId,
      x: position.x,
      y: position.y,
      radius: GRAPH_GEOMETRY.artistRadius + Math.min(24, Math.sqrt(artist.devices.length) * 6),
      depth,
      weight: Math.max(1, artist.devices.length),
      artistKey: artist.artistKey,
    });
    addLink(parentId, id, "hierarchy");

    artist.devices.forEach((device, deviceIndex) => {
      const deviceId = deviceNodeId(device.publicId);
      const devicePos = devicePosition(artist, device, deviceIndex, position);
      nodes.push({
        id: deviceId,
        kind: "device",
        parentId: id,
        x: devicePos.x,
        y: devicePos.y,
        radius: GRAPH_GEOMETRY.deviceRadius,
        depth: depth + 1,
        weight: Math.max(1, device.screens.length),
        artistKey: artist.artistKey,
        publicId: device.publicId,
      });
      addLink(id, deviceId, "device");

      const screenPhase = (stableHash32(`screen:${device.publicId}`) / 0x1_0000_0000) * Math.PI * 2;
      device.screens.forEach((screen, screenIndex) => {
        const angle = screenPhase + (Math.PI * 2 * screenIndex) / Math.max(1, device.screens.length);
        const screenId = screenNodeId(device.publicId, screen.screen);
        nodes.push({
          id: screenId,
          kind: "screen",
          parentId: deviceId,
          x: devicePos.x + Math.cos(angle) * GRAPH_GEOMETRY.screenOrbit,
          y: devicePos.y + Math.sin(angle) * GRAPH_GEOMETRY.screenOrbit,
          radius: GRAPH_GEOMETRY.screenRadius,
          depth: depth + 2,
          weight: 1,
          artistKey: artist.artistKey,
          publicId: device.publicId,
          screen: screen.screen,
        });
        addLink(deviceId, screenId, "screen");
      });
    });
  };

  const addChildren = (children: HierarchyChild[], parentId: string, depth: number) => {
    for (const child of children) {
      if (child.kind === "artist") {
        addArtist(child, parentId, depth);
        continue;
      }
      const position = clusterPositions.get(child.id) ?? clusterPosition(child, size);
      nodes.push({
        id: child.id,
        kind: "cluster",
        parentId,
        x: position.x,
        y: position.y,
        radius: child.depth === 1
          ? clamp(360 + Math.sqrt(child.deviceCount) * 13, 390, 560)
          : clamp(110 + Math.sqrt(child.deviceCount) * 9, 125, 250),
        depth,
        weight: Math.max(1, child.deviceCount),
      });
      addLink(parentId, child.id, "hierarchy");
      addChildren(child.children, child.id, depth + 1);
    }
  };

  addChildren(hierarchy.children, CORE_NODE_ID, 1);

  // Les moteurs JS serveur et navigateur peuvent différer d'un ulp après les
  // fonctions trigonométriques. Trois décimales évitent tout mismatch SSR sans
  // effet visuel, et rendent les snapshots strictement reproductibles.
  for (const node of nodes) {
    node.x = Math.round(node.x * 1_000) / 1_000;
    node.y = Math.round(node.y * 1_000) / 1_000;
    node.radius = Math.round(node.radius * 1_000) / 1_000;
  }

  const padding = 140;
  const xs = nodes.map((node) => node.x - node.radius).concat(nodes.map((node) => node.x + node.radius));
  const ys = nodes.map((node) => node.y - node.radius).concat(nodes.map((node) => node.y + node.radius));
  const minX = Math.min(...xs, -size / 2) - padding;
  const maxX = Math.max(...xs, size / 2) + padding;
  const minY = Math.min(...ys, -size / 2) - padding;
  const maxY = Math.max(...ys, size / 2) + padding;

  return {
    nodes,
    links,
    nodeIndex: new Map(nodes.map((node) => [node.id, node])),
    world: {
      x: Math.round(minX * 1_000) / 1_000,
      y: Math.round(minY * 1_000) / 1_000,
      width: Math.round((maxX - minX) * 1_000) / 1_000,
      height: Math.round((maxY - minY) * 1_000) / 1_000,
    },
  };
}

/** Nombre de clusters calculé sans relancer le layout (utile à la minimap/LOD). */
export function clusterCount(hierarchy: NetworkHierarchy): number {
  return flattenClusters(hierarchy).length;
}
