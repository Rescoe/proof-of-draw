// tests/livenessWitness.test.ts — témoin de vie (POD_LIVENESS) du firmware BWR + rapport de démarrage côté serveur (04/11/2026).
// Prouvé : texte du rapport (pur), garde-fous STATIQUES du sketch (option éteinte par défaut, gardes sur toutes les étapes, aucune E/S longue dans le minuteur, numéros alignés sur le serveur).
// NON prouvé : le comportement sur la carte (redémarrage depuis le Ticker, RTC), l'effet sur le blocage du cousin.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describeBoot, BOOT_PHASE_NAMES, BOOT_RESET_NAMES } from "../lib/bootReport";

const INO = path.join(__dirname, "..", "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino");
const src = fs.readFileSync(INO, "utf8").replace(/\r\n/g, "\n");

test("rapport : cause du reset et étape bloquée, en clair", () => {
  assert.equal(describeBoot({ rr: 4, rp: 3, rh: 1 }), "reset : redémarrage logiciel, BLOQUÉ pendant : lecture du contenu par morceaux (candidate-frame)");
  assert.equal(describeBoot({ rr: 3, rp: 0, rh: 0 }), "reset : chien de garde logiciel");
  assert.equal(describeBoot({ rr: 0 }), "reset : mise sous tension");
  assert.equal(describeBoot({ rp: 5, rh: 0 }), "interrompu pendant : envoi du vote (validation-result)");
});

test("rapport : anciens firmwares, entrées absurdes ou hostiles ⇒ rien d'inventé, rien d'injecté", () => {
  assert.equal(describeBoot(null), "");
  assert.equal(describeBoot({}), "");
  assert.equal(describeBoot({ firmware: "x" }), "");
  assert.equal(describeBoot({ rr: "<script>", rp: -1, rh: "1" }), "");
  assert.equal(describeBoot({ rr: 1e9, rp: 1.5 }), "");
  assert.equal(describeBoot({ rr: 42, rp: 42, rh: 1 }), "reset : cause 42, BLOQUÉ pendant : étape 42");
  assert.equal(describeBoot({ rp: 0, rh: 1 }), "blocage détecté (étape inconnue)");
});

test("journal : le rapport de démarrage est écrit dans la ligne du register", () => {
  const log = fs.readFileSync(path.join(__dirname, "..", "lib/deviceLog.ts"), "utf8");
  assert.match(log, /const boot = describeBoot\(b\); if \(boot\) parts\.push\(boot\);/);
});

test("firmware : option éteinte par défaut, tout le code dans des blocs POD_BWR (le firmware d'avant reste intact)", () => {
  assert.match(src, /#ifndef POD_LIVENESS\n#define POD_LIVENESS 0\n#endif/);
  for (const m of src.matchAll(/POD_LIVENESS/g)) {
    const before = src.slice(0, m.index!);
    assert.ok(before.lastIndexOf("// POD_BWR_BEGIN") > before.lastIndexOf("// POD_BWR_END"), "POD_LIVENESS hors d'un bloc POD_BWR à l'offset " + m.index);
  }
});

export function guardViolations(s: string): string[] {
  const v: string[] = [];
  const heads = ["bool doFetchFrame(const String& frameId, const String& frameSource) {", "bool doPull() {", "bool doValidate() {"];
  for (const fn of heads) {
    const i = s.indexOf(fn + "\n");
    if (i < 0) { v.push("définition absente : " + fn); continue; }
    const after = s.slice(i + fn.length + 1, i + fn.length + 121);
    if (!/^\/\/ POD_BWR_BEGIN\n#if POD_LIVENESS\n {2}LiveGuard liveGuard_\(LP_[A-Z_]+\);/.test(after)) v.push("garde absent : " + fn);
  }
  if (!/~LiveGuard\(\) \{ liveSet\(0\); \}/.test(s)) v.push("le garde ne remet pas l'étape à 0");
  for (const ph of ["LP_VAL_FETCH", "LP_VAL_SIGN", "LP_VAL_POST"]) if (!s.includes("liveSet(" + ph + ");")) v.push("sous-étape absente : " + ph);
  return v;
}

test("firmware : chaque étape qui peut bloquer est gardée, et le garde remet l'étape à 0 à la sortie", () => {
  assert.deepEqual(guardViolations(src), []);
});

test("firmware : le minuteur ne fait aucune E/S longue (ni série, ni réseau, ni String) et redémarre au-delà de la limite", () => {
  const i = src.indexOf("static void liveTick()");
  const body = src.slice(i, src.indexOf("\n}\n", i));
  assert.doesNotMatch(body, /Serial|HTTP|String|delay|malloc|new /);
  assert.match(body, /LIVE_LIMIT_MS/);
  assert.match(body, /ESP\.restart\(\)/);
  assert.match(src, /#define LIVE_LIMIT_MS 300000UL/);
});

test("firmware : les numéros d'étape du sketch sont ceux du serveur, la RTC ne chevauche ni le canari (0..3) ni l'e-ink (16..17)", () => {
  const m = /enum LivePhase : uint8_t \{([^}]*)\}/.exec(src)!;
  const nums = [...m[1].matchAll(/LP_[A-Z_]+ = (\d+)/g)].map((x) => Number(x[1])).filter((n) => n > 0).sort((a, b) => a - b);
  assert.deepEqual(nums, Object.keys(BOOT_PHASE_NAMES).map(Number).sort((a, b) => a - b));
  assert.match(src, /rtcUserMemoryWrite\(24, /);
  assert.match(src, /rtcUserMemoryRead\(24, /);
  assert.equal(Object.keys(BOOT_RESET_NAMES).length, 7);
});

test("firmware : le rapport part avec le register (rr, rp, rh), seulement quand l'option est active", () => {
  const i = src.indexOf("+ liveBootJson() +");
  assert.ok(i > 0);
  assert.match(src.slice(Math.max(0, i - 40), i), /#if POD_LIVENESS\n/);
  for (const k of ["rr", "rp", "rh"]) assert.ok(src.includes('\\"' + k + '\\":'), k);
});

test("MUTANTS firmware : garde retiré, remise à 0 retirée, sous-étape retirée, minuteur qui écrit sur le port série ⇒ détectés", () => {
  assert.notDeepEqual(guardViolations(src.replace("LiveGuard liveGuard_(LP_VAL_GET);", "")), []);
  assert.notDeepEqual(guardViolations(src.replace("~LiveGuard() { liveSet(0); }", "~LiveGuard() {}")), []);
  assert.notDeepEqual(guardViolations(src.replace("liveSet(LP_VAL_POST);", "")), []);
  const tick = src.slice(src.indexOf("static void liveTick()"), src.indexOf("static void liveBoot()"));
  assert.doesNotMatch(tick, /Serial/);
  assert.match(tick.replace("ESP.restart();", "Serial.println(1); ESP.restart();"), /Serial/);
});
