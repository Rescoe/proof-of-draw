// tests/networkFixtures.test.ts — contrat des données de la vue réseau : identifiants publics, matériel, fixtures déterministes à toutes les échelles
import test from "node:test";
import assert from "node:assert/strict";
import { publicDeviceId, PUBLIC_ID_RE } from "../lib/network/publicId";
import { hardwareOfFirmware } from "../lib/network/hardware";
import { fixtureCount, buildFixtureSnapshot, buildFixtureDisplays, buildFixtureEvents, fixtureImage } from "../lib/network/fixtures";

const NOW = 1_800_000_000_000;

test("publicDeviceId : stable, bien formé, non égal au deviceId", () => {
  const a = publicDeviceId("dev_ABCD1234");
  assert.equal(a, publicDeviceId("dev_ABCD1234"));
  assert.match(a, PUBLIC_ID_RE);
  assert.notEqual(a, publicDeviceId("dev_ABCD1235"));
  assert.ok(!a.includes("ABCD1234"));
});

test("hardwareOfFirmware", () => {
  assert.equal(hardwareOfFirmware("r4tft28-2.4"), "uno-r4");
  assert.equal(hardwareOfFirmware("multiscreen-2.2"), "esp8266");
  assert.equal(hardwareOfFirmware("tft18-2.2"), "esp8266");
  assert.equal(hardwareOfFirmware("2.0"), "esp8266");
  assert.equal(hardwareOfFirmware("mystery-9.9"), "unknown");
  assert.equal(hardwareOfFirmware(""), "unknown");
});

test("fixtureCount : refusé en production, borné, tolérant", () => {
  assert.equal(fixtureCount("20", "production"), null);
  assert.equal(fixtureCount("20", "development"), 20);
  assert.equal(fixtureCount("abc", "development"), null);
  assert.equal(fixtureCount("-3", "development"), null);
  assert.equal(fixtureCount("99999", "development"), null);
  assert.equal(fixtureCount(null, "development"), null);
  assert.equal(fixtureCount("0", "development"), 0);
});

test("fixtures : déterministes et à la bonne taille (1, 5, 20, 100, 500)", () => {
  for (const n of [0, 1, 5, 20, 100, 500]) {
    const a = buildFixtureSnapshot(n, NOW);
    const b = buildFixtureSnapshot(n, NOW);
    assert.equal(a.devices.length, n);
    assert.deepEqual(a.devices.map((d) => d.publicId), b.devices.map((d) => d.publicId));
    assert.equal(new Set(a.devices.map((d) => d.deviceId)).size, n);
    for (const d of a.devices) assert.match(d.publicId, PUBLIC_ID_RE);
  }
});

test("fixtures : cas pénibles présents à 100 appareils (homonymes, hors ligne, matériel inconnu, sans écran)", () => {
  const s = buildFixtureSnapshot(100, NOW);
  assert.ok(s.devices.some((d) => d.isOnline));
  assert.ok(s.devices.some((d) => !d.isOnline));
  assert.ok(s.devices.some((d) => d.hardware === "unknown"));
  assert.ok(s.devices.some((d) => d.screens.length === 0));
  const keysByName = new Map<string, Set<string>>();
  for (const d of s.devices) if (d.artistName && d.artistKey) (keysByName.get(d.artistName) ?? keysByName.set(d.artistName, new Set()).get(d.artistName)!).add(d.artistKey);
  assert.ok([...keysByName.values()].some((k) => k.size > 1), "au moins un nom partagé par deux profils");
});

test("fixtures : affichages et événements cohérents avec le snapshot", () => {
  const s = buildFixtureSnapshot(50, NOW);
  const shown = buildFixtureDisplays(s, NOW);
  const ids = new Set(s.devices.map((d) => d.deviceId));
  let count = 0, recent = 0;
  for (const [dev, per] of Object.entries(shown)) {
    assert.ok(ids.has(dev));
    for (const rec of Object.values(per)) { count++; assert.ok(rec.hasImage && rec.frameId?.startsWith("fixture-")); if (NOW - rec.shownAt < 5 * 60_000) recent++; }
  }
  assert.ok(count > 0 && recent > 0);
  const ev = buildFixtureEvents(s, NOW);
  assert.ok(ev.length > 0);
  for (const e of ev.filter((x) => x.type === "VALIDATION_VOTE")) assert.match(e.deviceRef ?? "", PUBLIC_ID_RE);
  assert.deepEqual(ev.map((e) => e.ts), [...ev.map((e) => e.ts)].sort((x, y) => y - x));
});

test("fixtureImage : buffers de la bonne taille pour chaque écran", () => {
  assert.equal(fixtureImage("fixture-00000001", "inconnu"), null);
  const o = fixtureImage("fixture-00000001", "oled096");
  assert.ok(o && typeof o.buffer === "string" && Buffer.from(o.buffer, "base64").length === 1024);
  const e = fixtureImage("fixture-00000001", "eink29bwr");
  assert.ok(e && e.black && e.red);
});
