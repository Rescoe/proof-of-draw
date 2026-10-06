import test from "node:test";
import assert from "node:assert/strict";
import type { NetworkDevice } from "../lib/networkSnapshot";
import {
  CORE_NODE_ID,
  FLOW_ACTIVE_MS,
  FLOW_FADE_MS,
  MAX_VISIBLE_FLOWS,
  artistNodeId,
  buildNetworkHierarchy,
  buildObservedFlows,
  deviceNodeId,
  flattenArtists,
  flattenClusters,
  flowLifetime,
  groupDevicesByArtist,
  layoutNetwork,
  screenNodeId,
  stablePointForKey,
  summarizeArtist,
  type ClusterGroup,
  type NetworkHierarchy,
} from "../app/network/model";

const NOW = 2_000_000_000_000;

function makeDevice(index: number, overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const artistIndex = Math.floor(index / 3);
  return {
    deviceId: `dev_TEST${String(index).padStart(4, "0")}`,
    publicId: `pub_${String(index).padStart(12, "0")}`,
    artistName: `Artiste ${artistIndex}`,
    artistKey: `a:artist-${artistIndex}`,
    firmware: "tft18-2.2",
    hardware: "esp8266",
    capabilities: { animation: true, animationScreens: ["tft18"], scene: true },
    pools: ["tft18"],
    screens: [{ screen: "tft18", label: "TFT 1.8\"", description: "test" }],
    lastSeen: NOW - index * 1_000,
    lastPing: NOW - index * 1_000,
    framesSent: index,
    createdAt: NOW - 86_400_000,
    isOnline: true,
    recentFrame: null,
    ...overrides,
  };
}

function clusterMemberships(hierarchy: NetworkHierarchy): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (cluster: ClusterGroup) => {
    for (const child of cluster.children) {
      if (child.kind === "artist") out.set(child.artistKey, cluster.path);
      else walk(child);
    }
  };
  for (const child of hierarchy.children) {
    if (child.kind === "artist") out.set(child.artistKey, "root");
    else walk(child);
  }
  return out;
}

test("artistes : artistKey sépare les homonymes et conserve tous les appareils", () => {
  const devices = [
    makeDevice(0, { artistName: "Neo", artistKey: "a:neo-1" }),
    makeDevice(1, { artistName: "Neo", artistKey: "a:neo-2" }),
    makeDevice(2, { artistName: undefined, artistKey: "unassigned" }),
    makeDevice(3, { artistName: undefined, artistKey: "unassigned" }),
  ];
  const groups = groupDevicesByArtist(devices);
  assert.equal(groups.length, 3);
  assert.equal(groups.filter((group) => group.label === "Neo").length, 2);
  assert.equal(groups.find((group) => group.artistKey === "unassigned")?.devices.length, 2);
  assert.equal(groups.reduce((sum, group) => sum + group.devices.length, 0), devices.length);
});

test("clusters : pseudo-aléatoires mais stables, indépendants du matériel et de l'activité", () => {
  const devices = Array.from({ length: 80 }, (_, index) => makeDevice(index, {
    artistName: `Mix ${index}`,
    artistKey: `a:mix-${index}`,
  }));
  const changed = devices.map((device, index) => ({
    ...device,
    hardware: index % 2 ? "uno-r4" as const : "unknown" as const,
    lastSeen: index % 3 ? 1 : NOW,
    lastPing: index % 3 ? 1 : NOW,
    isOnline: index % 3 === 0,
  }));
  assert.deepEqual(clusterMemberships(buildNetworkHierarchy(devices)), clusterMemberships(buildNetworkHierarchy(changed)));
  assert.deepEqual(stablePointForKey("a:mix-4"), stablePointForKey("a:mix-4"));
  assert.notDeepEqual(stablePointForKey("a:mix-4"), stablePointForKey("a:mix-5"));
});

test("échelle : 500 appareils restent tous présents dans la hiérarchie et le layout", () => {
  const devices = Array.from({ length: 500 }, (_, index) => makeDevice(index));
  const hierarchy = buildNetworkHierarchy(devices);
  const layout = layoutNetwork(hierarchy);
  assert.equal(flattenArtists(hierarchy).reduce((sum, artist) => sum + artist.devices.length, 0), 500);
  assert.ok(flattenClusters(hierarchy).length > 4, "plusieurs niveaux de zones attendus à cette échelle");
  assert.equal(layout.nodes.filter((node) => node.kind === "device").length, 500);
  assert.equal(layout.nodes.filter((node) => node.kind === "screen").length, 500);
  assert.equal(new Set(layout.nodes.map((node) => node.id)).size, layout.nodes.length, "IDs de noeuds uniques");
});

test("layout : mêmes clés, même position malgré l'ordre d'entrée et les changements d'activité", () => {
  const devices = Array.from({ length: 60 }, (_, index) => makeDevice(index));
  const changed = [...devices].reverse().map((device, index) => ({ ...device, lastSeen: NOW - index * 99_000, isOnline: index % 4 === 0 }));
  const a = layoutNetwork(buildNetworkHierarchy(devices));
  const b = layoutNetwork(buildNetworkHierarchy(changed));
  const positions = (layout: typeof a) => [...layout.nodeIndex.values()]
    .filter((node) => node.kind !== "cluster")
    .map(({ id, x, y }) => [id, x, y] as const)
    .sort(([idA], [idB]) => idA.localeCompare(idB));
  assert.deepEqual(positions(a), positions(b));
});

test("flux : aucune observation ne produit aucun mouvement", () => {
  const devices = [makeDevice(0)];
  const artists = groupDevicesByArtist(devices);
  assert.deepEqual(buildObservedFlows({ devices, artists, now: NOW }), []);
});

test("flux ACK : trajet exact core → artiste → appareil → écran", () => {
  const device = makeDevice(0);
  const artists = groupDevicesByArtist([device]);
  const flows = buildObservedFlows({
    devices: [device],
    artists,
    displays: {
      [device.deviceId]: {
        tft18: { frameId: "fixture-123456", screen: "tft18", shownAt: NOW - 60_000, kind: "human", mode: "scene", hasImage: true },
      },
    },
    now: NOW,
  });
  assert.equal(flows.length, 1);
  assert.deepEqual(flows[0].path, [
    CORE_NODE_ID,
    artistNodeId(device.artistKey),
    deviceNodeId(device.publicId),
    screenNodeId(device.publicId, "tft18"),
  ]);
  assert.equal(flows[0].label, "scène affichée");
  assert.equal(flows[0].moving, true);
});

test("flux : 5 minutes actives, 30 secondes d'estompage, puis expiration", () => {
  assert.deepEqual(flowLifetime(NOW - FLOW_ACTIVE_MS, NOW), { phase: "active", ageMs: FLOW_ACTIVE_MS, opacity: 1 });
  const middle = flowLifetime(NOW - FLOW_ACTIVE_MS - FLOW_FADE_MS / 2, NOW);
  assert.equal(middle.phase, "fading");
  assert.equal(middle.opacity, 0.5);
  assert.equal(flowLifetime(NOW - FLOW_ACTIVE_MS - FLOW_FADE_MS - 1, NOW).phase, "expired");
});

test("vote : deviceRef public retrouve l'appareil sans exposer son deviceId", () => {
  const device = makeDevice(0);
  const flows = buildObservedFlows({
    devices: [device],
    artists: groupDevicesByArtist([device]),
    events: [{ id: "vote-1", type: "VALIDATION_VOTE", ts: NOW - 20_000, deviceRef: device.publicId, message: "vote" }],
    now: NOW,
  });
  assert.equal(flows.length, 1);
  assert.deepEqual(flows[0].path, [deviceNodeId(device.publicId), artistNodeId(device.artistKey), CORE_NODE_ID]);
  assert.equal(JSON.stringify(flows[0]).includes(device.deviceId), false);
});

test("validation ambiguë : deux homonymes donnent un halo core, jamais un faux trajet artiste", () => {
  const devices = [
    makeDevice(0, { artistName: "Neo", artistKey: "a:neo-a" }),
    makeDevice(1, { artistName: "Neo", artistKey: "a:neo-b" }),
  ];
  const flows = buildObservedFlows({
    devices,
    artists: groupDevicesByArtist(devices),
    events: [{ id: "pending", type: "VALIDATION_PENDING", ts: NOW - 10_000, artistName: "Neo", message: "pending" }],
    now: NOW,
  });
  assert.deepEqual(flows[0].path, [CORE_NODE_ID]);
  assert.equal(flows[0].moving, false);
});

test("saturation : le nombre de flux visuels est plafonné", () => {
  const device = makeDevice(0);
  const events = Array.from({ length: MAX_VISIBLE_FLOWS + 10 }, (_, index) => ({
    id: `vote-${index}`,
    type: "VALIDATION_VOTE" as const,
    ts: NOW - index * 100,
    deviceRef: device.publicId,
    message: "vote",
  }));
  const flows = buildObservedFlows({ devices: [device], artists: groupDevicesByArtist([device]), events, now: NOW });
  assert.equal(flows.length, MAX_VISIBLE_FLOWS);
  assert.equal(flows[0].id, "event:vote-0");
});

// ── Constellation : petits réseaux bien répartis, appareils et écrans à l'écart, fiche artiste ───────────────────────────────────────────

function smallNetwork(artists: number, devicesPer = 2): NetworkDevice[] {
  const out: NetworkDevice[] = [];
  let i = 0;
  for (let a = 0; a < artists; a++) for (let d = 0; d < devicesPer; d++) out.push(makeDevice(i++, { artistKey: `a:artiste-${a}`, artistName: `Artiste ${a}` }));
  return out;
}

const angleOf = (n: { x: number; y: number }) => Math.atan2(n.y, n.x);

test("petit réseau : les artistes sont répartis autour du core (aucun grand vide angulaire)", () => {
  for (const count of [1, 2, 3, 5, 8, 12]) {
    const layout = layoutNetwork(buildNetworkHierarchy(smallNetwork(count)));
    const artists = layout.nodes.filter((n) => n.kind === "artist");
    assert.equal(artists.length, count);
    assert.ok(layout.nodeScale > 1, "petit réseau : nœuds dessinés plus gros");
    if (count < 3) continue;
    const angles = artists.map(angleOf).sort((a, b) => a - b);
    const gaps = angles.map((a, i) => (i === angles.length - 1 ? angles[0] + Math.PI * 2 - a : angles[i + 1] - a));
    // l'ellipse (x ×1,15, y ×0,92) déforme un peu les angles : on tolère 2,2 × l'écart idéal
    assert.ok(Math.max(...gaps) < ((Math.PI * 2) / count) * 2.2, `${count} artistes : plus grand vide ${Math.max(...gaps).toFixed(2)} rad`);
  }
});

test("petit réseau : appareils et écrans restent loin de la bulle de leur artiste, et deux artistes ne se chevauchent pas", () => {
  const layout = layoutNetwork(buildNetworkHierarchy(smallNetwork(5, 3)));
  const byId = layout.nodeIndex;
  for (const node of layout.nodes) {
    if (node.kind === "device" && node.parentId) {
      const artist = byId.get(node.parentId)!;
      const gap = Math.hypot(node.x - artist.x, node.y - artist.y) - (artist.radius + node.radius) * layout.nodeScale;
      assert.ok(gap > 60, `appareil trop près de son artiste (${gap.toFixed(0)})`);
    }
    if (node.kind === "screen" && node.parentId) {
      const device = byId.get(node.parentId)!;
      const gap = Math.hypot(node.x - device.x, node.y - device.y) - (device.radius + node.radius) * layout.nodeScale;
      assert.ok(gap > 30, `écran trop près de son appareil (${gap.toFixed(0)})`);
    }
  }
  const artists = layout.nodes.filter((n) => n.kind === "artist");
  for (let i = 0; i < artists.length; i++) for (let j = i + 1; j < artists.length; j++) {
    assert.ok(Math.hypot(artists[i].x - artists[j].x, artists[i].y - artists[j].y) > 500, "artistes trop proches");
  }
});

test("petit réseau : positions déterministes (ordre d'entrée sans effet)", () => {
  const devices = smallNetwork(4, 2);
  const a = layoutNetwork(buildNetworkHierarchy(devices));
  const b = layoutNetwork(buildNetworkHierarchy([...devices].reverse()));
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y]).sort(), b.nodes.map((n) => [n.id, n.x, n.y]).sort());
});

test("grand réseau (zones de navigation) : échelle de dessin inchangée", () => {
  const layout = layoutNetwork(buildNetworkHierarchy(smallNetwork(30, 1)));
  assert.equal(layout.nodeScale, 1);
});

test("fiche artiste : en ligne d'abord, œuvres confirmées triées du plus récent, rien d'inventé sans ACK", () => {
  const devices = [
    makeDevice(0, { artistKey: "a:x", artistName: "X", isOnline: false, lastSeen: NOW - 9 * 3600_000, lastPing: NOW - 9 * 3600_000, framesSent: 4 }),
    makeDevice(1, { artistKey: "a:x", artistName: "X", isOnline: true, framesSent: 6 }),
  ];
  const artist = groupDevicesByArtist(devices)[0];
  const shown = (shownAt: number, workTitle: string) => ({ frameId: "fid-" + shownAt, screen: "eink29bwr", shownAt, kind: "consensus", workTitle, hasImage: true }) as never;
  const displays = { [devices[0].deviceId]: { [devices[0].screens[0].screen]: shown(NOW - 1000, "Récent") }, [devices[1].deviceId]: {} };
  const s = summarizeArtist(artist, displays);
  assert.equal(s.devices[0].device.deviceId, devices[1].deviceId, "l'appareil en ligne passe en premier");
  assert.equal(s.framesSent, 10);
  assert.equal(s.recentWorks.length, 1);
  assert.equal(s.recentWorks[0].title, "Récent");
  assert.equal(summarizeArtist(artist, null).recentWorks.length, 0, "aucun ACK ⇒ aucune œuvre affichée");
});
