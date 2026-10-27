// 29/10/2026 — « œuvres fixes » par écran : un écran dynamique (TFT, OLED) n'affiche que des animations par défaut ; la conversion s'applique à ce qui est choisi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { acceptsAnimationFrom, fixedWorksScreensOf, isDynamicScreen, showsFixedWorks } from "../lib/fixedWorks";
import { animTargets } from "../lib/anim/targets";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("défaut : écrans dynamiques = animations SEULEMENT, e-ink inchangés ; capteur jamais", () => {
  assert.deepEqual(["tft28", "tft18", "oled096"].map(isDynamicScreen), [true, true, true]);
  assert.equal(isDynamicScreen("eink29bwr") || isDynamicScreen("eink27bw"), false);
  assert.deepEqual(fixedWorksScreensOf({ screens: ["oled096", "eink27bw"] }), ["eink27bw"], "multiscreen : l'e-ink garde ses œuvres fixes, l'OLED non");
  assert.deepEqual(fixedWorksScreensOf({ screens: ["tft28"] }), []);
  assert.deepEqual(fixedWorksScreensOf({ screens: ["eink29bwr"] }), ["eink29bwr"]);
  assert.deepEqual(fixedWorksScreensOf({ screens: ["sensor"], fixedWorksScreens: ["sensor"] }), [], "le pseudo-écran capteur n'est jamais concerné");
});

test("réglage explicite : la liste fait foi, restreinte aux écrans de l'appareil", () => {
  assert.deepEqual(fixedWorksScreensOf({ screens: ["tft28"], fixedWorksScreens: ["tft28"] }), ["tft28"]);
  assert.deepEqual(fixedWorksScreensOf({ screens: ["oled096", "eink27bw"], fixedWorksScreens: ["oled096"] }), ["oled096"], "l'e-ink décoché n'est plus servi");
  assert.deepEqual(fixedWorksScreensOf({ screens: ["tft18"], fixedWorksScreens: ["tft28", "tft18"] }), ["tft18"], "un écran étranger est ignoré");
  assert.equal(showsFixedWorks({ screens: ["tft28"] }, "tft28"), false);
  assert.equal(showsFixedWorks({ screens: ["tft28"], fixedWorksScreens: ["tft28"] }, "tft28"), true);
  assert.equal(showsFixedWorks(null, "tft28"), false);
});

test("animation : même type d'écran = toujours ; autre type = seulement si l'écran accepte les conversions (défaut : oui)", () => {
  assert.equal(acceptsAnimationFrom({ screens: ["tft18"] }, "tft18", "tft18"), true);
  assert.equal(acceptsAnimationFrom({ screens: ["tft18"], acceptsConvertedScreens: [] }, "tft18", "tft18"), true, "conversions coupées : l'animation faite pour CE type arrive quand même");
  assert.equal(acceptsAnimationFrom({ screens: ["tft18"] }, "tft18", "oled096"), true, "défaut : conversions acceptées");
  assert.equal(acceptsAnimationFrom({ screens: ["tft18"], acceptsConvertedScreens: [] }, "tft18", "oled096"), false);
  assert.equal(acceptsAnimationFrom({ screens: ["tft18"], acceptsConvertedScreens: ["tft18"] }, "tft18", "oled096"), true);
  assert.equal(acceptsAnimationFrom({ screens: ["tft18"], acceptsConvertedScreens: [] }, "tft18", undefined), true, "origine inconnue : livrée");
  assert.equal(acceptsAnimationFrom(null, "tft18", "tft18"), false);
});

test("cibles d'une animation : les écrans qui refusent les conversions ne reçoivent que les animations faites pour leur type", () => {
  const devs: Record<string, { screens: string[]; firmware: string; acceptsConvertedScreens?: string[] }> = {
    a: { screens: ["tft18"], firmware: "tft18-2.5" },                                              // défaut
    b: { screens: ["tft18"], firmware: "tft18-2.5", acceptsConvertedScreens: [] },                // conversions coupées
    c: { screens: ["oled096"], firmware: "multiscreen-2.8", acceptsConvertedScreens: [] },
  };
  const pools = { tft18: ["a", "b"], oled096: ["c"] };
  const get = (id: string) => devs[id] ?? null;
  const ids = (o?: string) => animTargets(pools, () => false, get, o).map((t) => `${t.deviceId}:${t.screen}`).sort();
  assert.deepEqual(ids("oled096"), ["a:tft18", "c:oled096"], "animation faite pour l'OLED : b (TFT 1,8″, conversions coupées) n'en reçoit pas");
  assert.deepEqual(ids("tft18"), ["a:tft18", "b:tft18"], "animation faite pour le TFT 1,8″ : c (OLED, conversions coupées) n'en reçoit pas");
  assert.deepEqual(ids(undefined), ["a:tft18", "b:tft18", "c:oled096"], "origine inconnue : comme avant");
});

test("câblage : diffusions fixes filtrées, conversions filtrées, animation avec son origine, route et interface du réglage", () => {
  assert.match(read("app/api/validation-result/route.ts"), /await filterFixedWorks\(members\.filter/);
  assert.match(read("app/api/validation-result/route.ts"), /broadcastAnimation\(\{ originScreen: candidate\.poolScreen/);
  assert.match(read("lib/broadcast.ts"), /members\.length > 0 \? await filterFixedWorks\(members, screen\)/);
  assert.match(read("lib/broadcast.ts"), /if \(ids\.length === 0 \|\| !isDynamicScreen\(screen\)\) return ids;/, "e-ink : aucune lecture Redis de plus");
  assert.match(read("lib/deviceStore.ts"), /convertedScreensOf\(d\)\.includes\(screen\) && fixedWorksScreensOf\(d\)\.includes\(screen\)/);
  assert.match(read("app/api/my-devices/[deviceId]/fixed-works/route.ts"), /setShowsFixedWorks\(deviceId, body\.screen, body\.enabled\)/);
  assert.match(read("app/profile/DevicesPanel.tsx"), /"fixed-works", \{ screen: sid, enabled: !fixedOn \}/);
});
