// tests/multiBwrOledFlow.test.ts — image de l'OLED du multiscreen BWR (POD_MULTI_OLED) : invariants mémoire et ACK, vérifiés sur le texte du sketch ET par mutants (audit Codex du 29/10/2026).
//  - aucun plan e-ink (blackBuf / redBuf) vivant à l'ouverture du TLS de l'OLED ni pendant l'ACK ;
//  - plans réalloués et initialisés sur TOUTES les sorties (aucun retour anticipé dans l'enveloppe), redémarrage fermé si la réallocation échoue ;
//  - ACK contrôlé ; identifiant (g_lastFrameIdOled) et message de succès seulement APRÈS un ACK réussi ; un ACK échoué laisse la frame retentable.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SKETCH = "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino";
const source = fs.readFileSync(SKETCH, "utf8").replace(/\r\n/g, "\n");
const noComments = (s: string) => s.replace(/\/\/[^\n]*/g, "");

function fn(src: string, signature: string): string {
  const i = src.indexOf(signature);
  if (i < 0) return "";
  let depth = 0, started = false;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") { depth++; started = true; } else if (src[k] === "}") { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  return "";
}

/** Violations des invariants ; vide = conforme. */
function violations(sketch: string): string[] {
  const v: string[] = [];
  const code = noComments(sketch);
  const outer = fn(code, "static bool doFetchFrameOled(const String& frameId, const String& frameSource) {");
  const inner = fn(code, "static bool oledFrameFlow(const String& frameId, const String& frameSource) {");
  if (!outer) v.push("enveloppe doFetchFrameOled absente");
  if (!inner) v.push("flux interne oledFrameFlow absent");
  if (!outer || !inner) return v;

  // 1. plans libérés AVANT le flux (donc avant toute création de WiFiClientSecure)
  const iFreeB = outer.indexOf("free(blackBuf)"), iFreeR = outer.indexOf("free(redBuf)"), iCall = outer.indexOf("oledFrameFlow(");
  if (iFreeB < 0 || iFreeR < 0 || iCall < 0 || iFreeB > iCall || iFreeR > iCall) v.push("les plans e-ink ne sont pas libérés avant le TLS de l'OLED");
  if (/blackBuf\s*=\s*nullptr/.test(outer) === false || /redBuf\s*=\s*nullptr/.test(outer) === false) v.push("pointeurs de plans non remis à nullptr après free");
  if (/blackBuf|redBuf|BUF_SIZE/.test(inner)) v.push("le flux interne touche aux plans e-ink");
  if (!inner.includes("WiFiClientSecure")) v.push("le flux interne n'ouvre plus de TLS (test périmé ?)");

  // 2. réallocation sur TOUTES les sorties : aucun return avant la réallocation dans l'enveloppe, restart fermé, initialisation
  const iMal = outer.indexOf("blackBuf = (uint8_t*)malloc(BUF_SIZE)"), iMalR = outer.indexOf("redBuf = (uint8_t*)malloc(BUF_SIZE)");
  if (iMal < 0 || iMalR < 0 || iMal < iCall) v.push("plans non réalloués après le flux");
  else {
    if (/\breturn\b/.test(outer.slice(0, iMal))) v.push("retour anticipé avant la réallocation des plans");
    const tail = outer.slice(iMal);
    if (!/if \(!blackBuf \|\| !redBuf\)[^]*ESP\.restart\(\)/.test(tail)) v.push("réallocation échouée : pas de redémarrage fermé");
    if (!/Serial\.println\(F\("\[FETCHFRAME-OLED\] malloc des plans/.test(tail)) v.push("réallocation échouée : pas de journal clair");
    if (!/memset\(blackBuf, 0xFF, BUF_SIZE\);\s*memset\(redBuf, 0xFF, BUF_SIZE\)/.test(tail)) v.push("plans non initialisés à 0xFF");
    if (!/return shown;\s*\}\s*$/.test(tail)) v.push("l'enveloppe ne rend pas le résultat du flux en dernier");
  }

  // 3. ACK contrôlé, identifiant APRÈS l'ACK
  const iAck = inner.indexOf('if (!ackFrame(frameId, "oled096"))');
  if (iAck < 0) v.push("ACK non contrôlé (résultat ignoré)");
  else {
    const failBranch = inner.slice(iAck, inner.indexOf("}", iAck) + 1);
    if (!/return false;/.test(failBranch)) v.push("un ACK échoué ne rend pas false");
    if (/g_lastFrameIdOled\s*=/.test(failBranch)) v.push("l'identifiant est enregistré malgré l'ACK échoué");
    if (/acquitt/.test(failBranch.replace(/ACK refuse[^;]*;/, "")) ) v.push("message de succès dans la branche d'échec de l'ACK");
    const assigns = [...inner.matchAll(/g_lastFrameIdOled\s*=/g)].map((m) => m.index!);
    if (assigns.length !== 1) v.push("g_lastFrameIdOled doit être affecté exactement une fois dans le flux (" + assigns.length + ")");
    else if (assigns[0] < iAck + failBranch.length) v.push("l'identifiant OLED est enregistré avant la fin du contrôle de l'ACK");
    const ok = inner.indexOf("affichee et acquittee");
    if (ok < 0 || ok < iAck + failBranch.length) v.push("message « affichée et acquittée » avant l'ACK ou absent");
    if ((inner.match(/ackFrame\(/g) ?? []).length !== 1) v.push("ACK non unique dans le flux");
  }
  const allAssign = (code.replace(/static String g_lastFrameIdOled\s*=/, "").match(/g_lastFrameIdOled\s*=(?!=)/g) ?? []).length;   // hors la déclaration
  if (allAssign !== 1) v.push("g_lastFrameIdOled affecté hors du flux (" + allAssign + " fois dans le sketch)");
  return v;
}

test("OLED multiscreen : le sketch réel respecte les invariants mémoire et ACK", () => {
  assert.deepEqual(violations(source), []);
});

const mutants: Array<[string, (s: string) => string]> = [
  ["plans e-ink vivants à l'ouverture du TLS OLED (free supprimé)", (s) => s.replace("free(blackBuf); blackBuf = nullptr; free(redBuf); redBuf = nullptr;\n  const bool shown", "const bool shown")],
  ["plans libérés APRÈS le flux", (s) => s.replace("free(blackBuf); blackBuf = nullptr; free(redBuf); redBuf = nullptr;\n  const bool shown = oledFrameFlow(frameId, frameSource);", "const bool shown = oledFrameFlow(frameId, frameSource);\n  free(blackBuf); blackBuf = nullptr; free(redBuf); redBuf = nullptr;")],
  ["branche d'erreur qui oublie de restaurer les plans (retour anticipé dans l'enveloppe)", (s) => s.replace("  const bool shown = oledFrameFlow(frameId, frameSource);", "  if (!ensureOLEDReady()) return false;\n  const bool shown = oledFrameFlow(frameId, frameSource);")],
  ["plans jamais réalloués", (s) => s.replace("blackBuf = (uint8_t*)malloc(BUF_SIZE); redBuf = (uint8_t*)malloc(BUF_SIZE);\n  if (!blackBuf || !redBuf) { Serial.println(F(\"[FETCHFRAME-OLED] malloc des plans", "if (!blackBuf || !redBuf) { Serial.println(F(\"[FETCHFRAME-OLED] malloc des plans")],
  ["réallocation échouée sans redémarrage", (s) => s.replace("apres l'OLED impossible — redemarrage\"));  ESP.restart(); }".replace("  ESP", " ESP"), "apres l'OLED impossible — redemarrage\")); }")],
  ["plans réalloués mais non initialisés", (s) => s.replace("memset(blackBuf, 0xFF, BUF_SIZE); memset(redBuf, 0xFF, BUF_SIZE);\n  return shown;", "return shown;")],
  ["ACK ignoré", (s) => s.replace('if (!ackFrame(frameId, "oled096")) {', 'ackFrame(frameId, "oled096");\n  if (false) {')],
  ["identifiant OLED enregistré avant l'ACK", (s) => s.replace('  if (!ackFrame(frameId, "oled096")) {', '  g_lastFrameIdOled = frameId;\n  if (!ackFrame(frameId, "oled096")) {').replace("  g_lastFrameIdOled = frameId;\n  Serial.printf_P(PSTR(\"[FETCHFRAME-OLED] affichee", "  Serial.printf_P(PSTR(\"[FETCHFRAME-OLED] affichee")],
  ["un ACK échoué enregistre l'identifiant (la frame ne sera plus retentée)", (s) => s.replace("frame reproposee au prochain pull\\n\"), frameId.c_str());\n    return false;", "frame reproposee au prochain pull\\n\"), frameId.c_str());\n    g_lastFrameIdOled = frameId;\n    return false;")],
  ["un ACK échoué rend true", (s) => s.replace("frame reproposee au prochain pull\\n\"), frameId.c_str());\n    return false;", "frame reproposee au prochain pull\\n\"), frameId.c_str());\n    return true;")],
  ["message de succès avant l'ACK", (s) => s.replace('  if (!ackFrame(frameId, "oled096")) {', '  Serial.println(F("[FETCHFRAME-OLED] affichee et acquittee"));\n  if (!ackFrame(frameId, "oled096")) {')],
  ["le flux interne touche aux plans", (s) => s.replace("  uint8_t* px = oled.getBuffer();", "  uint8_t* px = oled.getBuffer(); (void)blackBuf;")],
];
for (const [name, mutate] of mutants) {
  test(`mutant refusé : ${name}`, () => {
    const mutated = mutate(source);
    assert.notEqual(mutated, source, "le mutant n'a rien modifié (ancre périmée)");
    assert.ok(violations(mutated).length > 0, "le mutant n'est pas détecté");
  });
}
