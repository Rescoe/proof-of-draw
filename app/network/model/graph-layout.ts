import type { NetworkDevice } from "@/lib/networkSnapshot";
import { CORE_NODE_ID, GRAPH_GEOMETRY, SPACIOUS_GEOMETRY } from "./constants";
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
  /** Petit réseau : orbites larges et nœuds dessinés plus gros (voir SPACIOUS_GEOMETRY). 1 pour un grand réseau. */
  nodeScale: number;
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

type Orbits = { deviceOrbit: number; deviceRingGap: number; screenOrbit: number };

/** Rayon occupé par un artiste : bulle + appareils (+ anneaux supplémentaires) + écrans + libellés. */
function artistFootprint(artist: ArtistGroup, orbits: Orbits): number {
  const count = artist.devices.length;
  const rings = count <= 8 ? 1 : 2 + Math.floor((count - 9) / 14);
  return orbits.deviceOrbit + (rings - 1) * orbits.deviceRingGap + 8 + orbits.screenOrbit + GRAPH_GEOMETRY.screenRadius + 50;
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Petit réseau : les artistes sont RÉPARTIS autour du core au lieu d'être semés au hasard dans un carré.
 *   • angle de base = hash(artistKey) (clé stable, comme avant) ;
 *   • les artistes, triés par angle de base, sont attirés vers des créneaux régulièrement espacés (rotation moyenne choisie pour minimiser le déplacement),
 *     d'au plus 20 % d'un créneau : l'ordre est conservé et la clé garde une influence, mais jamais deux artistes ne se retrouvent côte à côte ;
 *   • rayon assez grand pour que les appareils et écrans de deux voisins ne se touchent pas ; au-delà de 6 artistes, anneaux intérieur/extérieur en quinconce.
 * Mêmes clés ⇒ mêmes coordonnées, quel que soit l'ordre d'entrée.
 */
function resolveArtistPositions(artists: ArtistGroup[], orbits: Orbits): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = artists.length;
  if (n === 0) return positions;
  const TAU = Math.PI * 2;
  const items = artists
    .map((artist) => ({ artist, base: (stableHash32(`angle:${artist.artistKey}`) / 0x1_0000_0000) * TAU }))
    .sort((a, b) => a.base - b.base || a.artist.artistKey.localeCompare(b.artist.artistKey));
  const step = TAU / n;
  let sinSum = 0, cosSum = 0;
  items.forEach((item, i) => { sinSum += Math.sin(item.base - step * i); cosSum += Math.cos(item.base - step * i); });
  const rotation = Math.atan2(sinSum, cosSum);

  const footprint = Math.max(...artists.map((artist) => artistFootprint(artist, orbits)));
  const stagger = n > 6;
  const perRing = stagger ? Math.ceil(n / 2) : n;
  const sinHalf = Math.sin(Math.PI / Math.max(2, perRing));
  const radius = Math.max(footprint + 200, (footprint * 0.62) / (0.6 * sinHalf));

  items.forEach((item, i) => {
    const slot = step * i + rotation;
    const angle = slot + Math.max(-step * 0.2, Math.min(step * 0.2, wrapPi(item.base - slot) * 0.25));
    const jitter = ((stableHash32(`radius:${item.artist.artistKey}`) / 0x1_0000_0000) - 0.5) * 0.1;
    const r = radius * (stagger ? (i % 2 === 0 ? 0.82 : 1.2) : 1) * (1 + jitter);
    // la page est panoramique : l'ellipse profite de la largeur
    positions.set(item.artist.artistKey, { x: Math.cos(angle) * r * 1.15, y: Math.sin(angle) * r * 0.92 });
  });
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
function resolveHierarchyPositions(hierarchy: NetworkHierarchy, size: number, orbits: Orbits) {
  const artistPositions = new Map<string, { x: number; y: number }>();
  const clusterPositions = new Map<string, { x: number; y: number }>();
  if (!hierarchy.children.some((child) => child.kind === "cluster")) {
    return { artistPositions: resolveArtistPositions(hierarchy.artists, orbits), clusterPositions };
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

function devicePosition(artist: ArtistGroup, device: NetworkDevice, index: number, center: { x: number; y: number }, orbits: Orbits) {
  const firstCapacity = 8;
  const ring = index < firstCapacity ? 0 : 1 + Math.floor((index - firstCapacity) / 14);
  const before = ring === 0 ? 0 : firstCapacity + (ring - 1) * 14;
  const capacity = ring === 0 ? Math.min(firstCapacity, artist.devices.length) : Math.min(14, artist.devices.length - before);
  const inRing = index - before;
  const phase = (stableHash32(`orbit:${artist.artistKey}`) / 0x1_0000_0000) * Math.PI * 2;
  const angle = phase + (Math.PI * 2 * inRing) / Math.max(1, capacity);
  const radius = orbits.deviceOrbit + ring * orbits.deviceRingGap;
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
  const spacious = !hierarchy.children.some((child) => child.kind === "cluster");
  const orbits: Orbits = spacious ? SPACIOUS_GEOMETRY : GRAPH_GEOMETRY;
  const nodeScale = spacious ? SPACIOUS_GEOMETRY.nodeScale : 1;
  const { artistPositions, clusterPositions } = resolveHierarchyPositions(hierarchy, size, orbits);
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
      const devicePos = devicePosition(artist, device, deviceIndex, position, orbits);
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
          x: devicePos.x + Math.cos(angle) * orbits.screenOrbit,
          y: devicePos.y + Math.sin(angle) * orbits.screenOrbit,
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
    nodeScale,
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
