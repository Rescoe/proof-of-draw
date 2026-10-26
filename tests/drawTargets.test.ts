import test from "node:test";
import assert from "node:assert/strict";
import { classifyList, drawableScreens, mineTargets, sharedTargets } from "../lib/drawTargets";

test("drawableScreens : écrans connus seulement, sans doublon, pseudo-écran capteur exclu", () => {
  assert.deepEqual(drawableScreens(["tft28", "sensor", "tft28", "inconnu", 3]).map((s) => s.id), ["tft28"]);
  assert.deepEqual(drawableScreens(undefined), []);
});

test("mineTargets : capteur seul exclu, en ligne d'abord, nom donné prioritaire", () => {
  const t = mineTargets([
    { deviceId: "dev_B", artistName: "Zoé", screens: ["oled096"], isOnline: false },
    { deviceId: "dev_S", screens: ["sensor"], isOnline: true },
    { deviceId: "dev_A", artistName: "Zoé", deviceName: "Salon", screens: ["eink29bwr", "oled096"], isOnline: true },
  ]);
  assert.deepEqual(t.map((x) => x.deviceId), ["dev_A", "dev_B"]);
  assert.equal(t[0].label, "Salon");
  assert.equal(t[1].label, "Zoé");
  assert.equal(t[0].screens.length, 2);
});

test("sharedTargets : mes propres appareils retirés de la liste partagée", () => {
  const t = sharedTargets(
    [{ deviceId: "dev_A", screens: ["tft28"], isOnline: true }, { deviceId: "dev_X", artistName: "Ana", screens: ["tft28"], isOnline: false }],
    ["dev_A"],
  );
  assert.deepEqual(t.map((x) => x.deviceId), ["dev_X"]);
  assert.equal(t[0].online, false);
});

test("sharedTargets : nom d'artiste absent -> libellé neutre", () => {
  assert.equal(sharedTargets([{ deviceId: "dev_Q", screens: ["tft18"] }], [])[0].label, "Artiste inconnu");
});

test("classifyList : erreur HTTP, corps inattendu et vide sont trois états DISTINCTS", () => {
  assert.equal(classifyList(false, 500, { devices: [] }, "devices").kind, "error");
  assert.equal(classifyList(true, 200, null, "devices").kind, "error");
  assert.equal(classifyList(true, 200, { devices: "x" }, "devices").kind, "error");
  const empty = classifyList(true, 200, { devices: [] }, "devices");
  assert.equal(empty.kind, "ready");
  assert.deepEqual(empty.kind === "ready" && empty.data, []);
  assert.match((classifyList(false, 429, {}, "devices") as { message: string }).message, /Trop de requêtes/);
});
