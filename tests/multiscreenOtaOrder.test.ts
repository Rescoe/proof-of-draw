// tests/multiscreenOtaOrder.test.ts — l'appel de l'OTA du multiscreen n'est jamais derrière le « return » de l'animation de bloc (04/11/2026).
// Constat série sur dev_KAD6PKC4 : « [OTA] annonce acceptee » au démarrage puis aucune ligne [OTA] pendant 150 s ; le bloc d'animation de loop() fait `return` à chaque tour tant qu'un clip joue.
// Ce que cela NE prouve PAS : l'exécution réelle sur la carte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const INO = path.join(__dirname, "..", "esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino");
const src = fs.readFileSync(INO, "utf8").replace(/\r\n/g, "\n");
const loop = src.slice(src.indexOf("void loop()"));

export function otaOrderViolations(s: string): string[] {
  const v: string[] = [];
  const l = s.slice(s.indexOf("void loop()"));
  const ota = l.indexOf("podotaesp::maybeRun();");
  const anim = l.indexOf("if (g_anim.on && !g_bench.mode)");
  if (ota < 0) v.push("appel de l'OTA absent de loop()");
  if (anim < 0) v.push("bloc d'animation absent de loop()");
  if (ota >= 0 && anim >= 0 && ota > anim) v.push("l'appel de l'OTA est APRÈS le return de l'animation : jamais atteint pendant un clip");
  if (ota >= 0 && !/pendingCandidateId\.length\(\) == 0 && pendingObsHashes\.length\(\) == 0 && !g_bench\.mode/.test(l.slice(Math.max(0, ota - 160), ota))) v.push("conditions de sûreté de l'appel OTA retirées");
  return v;
}

test("multiscreen : l'OTA est appelée avant l'animation de bloc, sous ses conditions de sûreté", () => {
  assert.deepEqual(otaOrderViolations(src), []);
  assert.ok(loop.includes("podotaesp::maybeRun();"));
});

test("multiscreen MUTANTS : OTA remise après l'animation, ou sans ses conditions ⇒ détectés", () => {
  const call = "  if (pendingCandidateId.length() == 0 && pendingObsHashes.length() == 0 && !g_bench.mode) { podotaesp::maybeRun(); }\n";
  assert.ok(src.includes(call));
  const without = src.replace(call, "");
  const after = without.replace("  yield();\n}", call + "  yield();\n}");
  assert.notDeepEqual(otaOrderViolations(after), [], "mutant « après l'animation » survivant");
  const unsafe = src.replace(call, "  podotaesp::maybeRun();\n");
  assert.notDeepEqual(otaOrderViolations(unsafe), [], "mutant « sans conditions » survivant");
});

test("multiscreen : la POST du vote v2 utilise le petit tampon TLS, et seulement elle (drapeau levé puis rabaissé autour de l'appel)", () => {
  const i = src.indexOf('bool vOk = httpPost("/api/validation-result", body, vResp);');
  assert.ok(i > 0);
  const before = src.slice(Math.max(0, i - 120), i), after = src.slice(i, i + 160);
  assert.match(before, /g_httpSmallRx = true;/);
  assert.match(after, /g_httpSmallRx = false;/);
  assert.match(src, /if \(g_httpSmallRx\) client\.setBufferSizes\(4096, 512\);/);
  assert.equal((src.match(/g_httpSmallRx = true;/g) ?? []).length, 1);   // aucune autre requête n'est concernée
  assert.doesNotMatch(src, /bool httpPost\([^)]*=\s*(true|false)/);        // pas de paramètre par défaut (prototypes d'Arduino)
});
