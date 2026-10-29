// UX jalon 3 (29/10/2026) — « Animer » sur /draw : la capacité vient du SERVEUR (animCapable = même règle que la diffusion réelle), jamais d'une table de versions dans l'interface.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { animScreensOf } from "../lib/animScreens";
import { mineTargets, sharedTargets, drawableScreens } from "../lib/drawTargets";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

test("écran compatible + firmware récent → Animer ; firmware ancien ou inconnu → non ; écran fixe (e-ink) → non", () => {
  assert.deepEqual(animScreensOf({ screens: ["tft28"], firmware: "r4tft28-2.6" }), ["tft28"]);
  assert.deepEqual(animScreensOf({ screens: ["tft28"], firmware: "r4tft28-2.3" }), [], "firmware ancien");
  assert.deepEqual(animScreensOf({ screens: ["tft28"], firmware: null }), [], "firmware inconnu");
  assert.deepEqual(animScreensOf({ screens: ["tft18"], firmware: "tft18-2.10" }), ["tft18"]);
  assert.deepEqual(animScreensOf({ screens: ["tft18"], firmware: "r4tft18-2.6" }), ["tft18"], "station R4 + TFT 1,8″");
  assert.deepEqual(animScreensOf({ screens: ["tft18"], firmware: "tft18-2.1" }), []);
  assert.deepEqual(animScreensOf({ screens: ["eink29bwr"], firmware: "eink29bwr-2.13" }), [], "e-ink BWR : l'animation n'est pas jouée sur son écran e-ink");
  assert.deepEqual(animScreensOf({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.8" }), ["oled096"], "multiscreen : l'OLED seulement");
  assert.deepEqual(animScreensOf({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.1" }), []);
  assert.deepEqual(animScreensOf(null), []);
  assert.deepEqual(animScreensOf({ screens: ["tft28", "tft28"], firmware: "r4tft28-2.6" }), ["tft28"], "sans doublon");
});

test("OLED AUXILIAIRE d'un BWR : ce n'est pas un écran déclaré, donc jamais proposé comme cible « Animer » sur /draw", () => {
  const bwr = { deviceId: "dev_AAAAAAAA", screens: ["eink29bwr"], firmware: "eink29bwr-2.13", isOnline: true, animScreens: animScreensOf({ screens: ["eink29bwr"], firmware: "eink29bwr-2.13" }) };
  const [t] = mineTargets([bwr]);
  assert.deepEqual(t.screens.map((s) => [s.id, s.canAnimate]), [["eink29bwr", false]]);
});

test("cibles : « Animer » uniquement sur MES écrans et seulement si le serveur l'a déclaré ; les écrans partagés ne proposent que Dessiner", () => {
  const mine = mineTargets([{ deviceId: "dev_A", screens: ["tft28"], isOnline: true, animScreens: ["tft28"] }, { deviceId: "dev_B", screens: ["tft28"], isOnline: true, animScreens: [] }]);
  assert.deepEqual(mine.map((t) => [t.deviceId, t.screens[0].canAnimate]).sort(), [["dev_A", true], ["dev_B", false]]);
  const shared = sharedTargets([{ deviceId: "dev_C", screens: ["tft28"], isOnline: true, ...({ animScreens: ["tft28"] } as object) }], []);
  assert.equal(shared[0].screens[0].canAnimate, false);
  assert.deepEqual(drawableScreens(["tft28", "sensor", "inconnu"], ["tft28"]).map((s) => [s.id, s.canAnimate]), [["tft28", true]]);
  assert.deepEqual(drawableScreens(["tft28"], "pas un tableau").map((s) => s.canAnimate), [false]);
});

test("câblage : /api/devices?mine=1 calcule animScreens côté serveur ; DrawChoice n'a aucune table de versions ; /api/draw revalide avec animCapable", () => {
  assert.ok(read("app/api/devices/route.ts").includes("animScreens: animScreensOf(d!)"));
  const dc = read("app/draw/DrawChoice.tsx");
  assert.ok(dc.includes("s.canAnimate &&") && dc.includes("🎞 Animer") && dc.includes("✏️ Dessiner"));
  assert.ok(!/firmware|ANIM_POINTER_FIRMWARE|bench\/screens/.test(dc), "aucune table de versions dans l'interface");
  assert.ok(read("app/api/draw/route.ts").includes("animCapable("), "le serveur revalide la capacité à la soumission");
});
