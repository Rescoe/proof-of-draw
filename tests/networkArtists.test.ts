// UX jalon 2 (29/10/2026) — « Artistes du réseau » : sortie bornée, un artiste par clé, ordre déterministe, aucune dépendance au nombre d'appareils pour la taille de la sortie.
import test from "node:test";
import assert from "node:assert/strict";
import type { NetworkDevice } from "../lib/networkSnapshot";
import { networkArtists } from "../lib/networkArtists";

const dev = (i: number, over: Partial<NetworkDevice> = {}): NetworkDevice => ({ deviceId: `dev_${String(i).padStart(8, "0")}`, publicId: `p${i}`, artistName: `Artiste ${i % 50}`, artistKey: `a:art${i % 50}`, firmware: "x-1.0", isOnline: i % 3 === 0, lastPing: 1_000_000 + i, ...over, lastSeen: over.lastPing ?? 1_000_000 + i } as unknown as NetworkDevice);

test("regroupe par clé d'artiste, compte les appareils en ligne, exclut « unassigned »", () => {
  const s = networkArtists([
    dev(1, { artistKey: "a:x", artistName: "Xavier", isOnline: true, lastPing: 50 }), dev(2, { artistKey: "a:x", artistName: "Xavier", isOnline: false, lastPing: 90 }),
    dev(3, { artistKey: "n:zoe", artistName: "Zoé", isOnline: false, lastPing: 10 }), dev(4, { artistKey: "unassigned", artistName: undefined, isOnline: true }),
  ]);
  assert.equal(s.artists, 2, "unassigned exclu");
  assert.equal(s.devices, 4); assert.equal(s.devicesOnline, 2); assert.equal(s.artistsOnline, 1);
  assert.deepEqual(s.active.map((a) => [a.label, a.devices, a.online, a.artistId]), [["Xavier", 2, 1, "x"], ["Zoé", 1, 0, null]]);
  assert.equal(s.active[0].lastActiveMs, 90, "dernier signe de vie = le plus récent des appareils");
});

test("ordre : en ligne d'abord, puis dernier signe de vie décroissant, puis alphabétique (déterministe, indépendant de l'ordre d'entrée)", () => {
  const list = [
    dev(1, { artistKey: "a:b", artistName: "Bob", isOnline: false, lastPing: 500 }), dev(2, { artistKey: "a:a", artistName: "Alice", isOnline: false, lastPing: 500 }),
    dev(3, { artistKey: "a:c", artistName: "Carl", isOnline: true, lastPing: 10 }), dev(4, { artistKey: "a:d", artistName: "Dora", isOnline: false, lastPing: 900 }),
  ];
  const expected = ["Carl", "Dora", "Alice", "Bob"];
  assert.deepEqual(networkArtists(list).active.map((a) => a.label), expected);
  assert.deepEqual(networkArtists([...list].reverse()).active.map((a) => a.label), expected);
});

test("sortie BORNÉE à 6 quelle que soit la taille du réseau (0, 1, 7 et 5 000 appareils) — assertion structurelle, aucune durée", () => {
  for (const n of [0, 1, 7, 5000]) {
    const s = networkArtists(Array.from({ length: n }, (_, i) => dev(i)));
    assert.ok(s.active.length <= 6, `${n} appareils → ${s.active.length} artistes`);
    assert.equal(s.devices, n);
    assert.ok(s.artists <= 50);
  }
  assert.equal(networkArtists(Array.from({ length: 5000 }, (_, i) => dev(i))).active.length, 6);
  assert.equal(networkArtists(Array.from({ length: 5000 }, (_, i) => dev(i)), 3).active.length, 3, "borne paramétrable");
  assert.deepEqual(networkArtists([]).active, []);
});
