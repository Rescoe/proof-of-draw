// tests/tft28OtaPort.test.ts — client OTA R4-B porté au UNO R4 + TFT 2,8″ (04/11/2026) : garde-fous STATIQUES du sketch.
// Prouvé : option éteinte par défaut, code confiné aux blocs balisés (le firmware d'avant reste intact), OTA appelée AVANT le bloc d'animation (qui fait « return »), conditions de sûreté, famille/clés, marqueur Wi-Fi hors binaire.
// NON prouvé : tout comportement sur la carte (téléchargement, staging, reprogrammation, séquence en data flash) — compilé seulement.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino";
const src = read(INO);

export function otaPortViolations(s: string): string[] {
  const v: string[] = [];
  if (!/#ifndef POD_OTA_R4\n#define POD_OTA_R4 0\n#endif/.test(s)) v.push("POD_OTA_R4 doit valoir 0 par défaut");
  if (/#define POD_OTA_R4 1\b/.test(s)) v.push("POD_OTA_R4 ne doit jamais être commité à 1");
  if (!/#if !POD_WIFI_PORTAL\n\s+#error "POD_OTA_R4 exige POD_WIFI_PORTAL/.test(s)) v.push("l'OTA doit exiger le Wi-Fi hors binaire (#error sinon)");
  if (!s.includes('#define OTAR4_FAMILY "uno-r4-wifi-tft28"') || !s.includes('#define OTAR4_KIND "tft28"')) v.push("famille / dossier OTA du TFT 2,8″");
  // confinement : chaque occurrence de POD_OTA_R4 / otar4:: / otaTick est dans un bloc POD_WIFI
  for (const m of s.matchAll(/POD_OTA_R4|otar4::|otaTick/g)) {
    const before = s.slice(0, m.index!);
    if (before.lastIndexOf("// POD_WIFI_BEGIN") <= before.lastIndexOf("// POD_WIFI_END")) { v.push("hors d'un bloc POD_WIFI : " + m[0] + " @" + m.index); break; }
  }
  const loop = s.slice(s.indexOf("void loop() {"));
  const ota = loop.indexOf("otaTick();"), anim = loop.indexOf("if (animOn && !animPaused && !benchMode)");
  if (ota < 0 || anim < 0) v.push("appel de l'OTA ou bloc d'animation absent de loop()");
  else if (ota > anim) v.push("l'OTA est appelée APRÈS le bloc d'animation (qui fait « return » à chaque tour) : jamais atteinte pendant un clip");
  const fn = s.slice(s.indexOf("static void __attribute__((noinline)) otaTick()"), s.indexOf("static void __attribute__((noinline)) otaTick()") + 700);
  if (!/pendingCandidateId\.length\(\) > 0 \|\| benchMode\) return;/.test(fn)) v.push("l'OTA ne doit pas tourner pendant un candidat à voter ni le banc d'essai");
  if (!/otar4::setServer\(OTAR4_HOST, OTAR4_PORT, OTAR4_BASE\);\n\s+otar4::confirmBoot\(\);/.test(s)) v.push("setServer + confirmBoot après le register");
  if (s.indexOf("otar4::confirmBoot();") < s.indexOf("POD_CANARY_HEAP(\"apres le register\");")) v.push("la séquence installée ne s'inscrit qu'APRÈS le register");
  if (!/const char POD_WIFI_MODE_MARK\[\] __attribute__\(\(used, retain\)\) = "PODWIFI:record-v1";/.test(s) || !s.includes('logf("[WIFI] mode: %s", POD_WIFI_MODE_MARK);')) v.push("marqueur « Wi-Fi hors binaire » absent ou non référencé (l'éditeur de liens l'éliminerait)");
  if (!/#if POD_OTA_R4\n#define FIRMWARE_VERSION  "r4tft28-2\.7"/.test(s)) v.push("version 2.7 annoncée seulement avec l'OTA");
  const bud = s.slice(s.indexOf("static unsigned long msUntilNextTask()"), s.indexOf("static unsigned long msUntilNextTask()") + 900);
  if (!/#if POD_OTA_R4\n\s*\{ const long o = \(long\)\(g_otaNextMs - millis\(\)\); if \(o < r\) r = o; \}/.test(bud)) v.push("l'échéance de l'OTA doit borner la durée d'un passage de l'animation (msUntilNextTask)");
  return v;
}

test("TFT 2,8″ : client OTA porté — aucune violation des garde-fous", () => { assert.deepEqual(otaPortViolations(src), []); });

test("TFT 2,8″ : l'OTA ne touche pas aux blocs de la data flash réservés (0 clés, 5-6 verrou de vote, 7 canari)", () => {
  const client = read("arduino_uno_r4/pod_uno_r4/pod_ota_r4_client.h");
  assert.match(client, /blocs 2 et 3/);
  assert.doesNotMatch(src, /EEPROM\.(write|update)\([^)]*otar4/);   // la séquence passe par le client, jamais par un accès direct du sketch
});

test("TFT 2,8″ : copies du client et du noyau identiques à leurs originaux, famille présente côté serveur", () => {
  assert.equal(read("arduino_uno_r4/pod_uno_r4/pod_ota_r4_client.h"), read("arduino_uno_r4/pod_uno_r4_station/pod_ota_r4_client.h"));
  assert.equal(read("arduino_uno_r4/pod_uno_r4/podOtaR4.h"), read("consensus-pod/src/podOtaR4.h"));
  assert.match(read("consensus-pod/src/podOtaR4.h"), /uno-r4-wifi-tft28/);
});

test("TFT 2,8″ MUTANTS : OTA après l'animation, option à 1, sans #error, hors bloc, sans conditions de sûreté ⇒ tous détectés", () => {
  const call = "  otaTick();                                             // la mise à jour ne dépend NI de l'appairage NI de l'animation ; placée AVANT le bloc d'animation, qui fait « return » à chaque tour\n";
  assert.ok(src.includes(call), "motif absent");
  const muts: Array<[string, string]> = [
    ["OTA après l'animation", src.replace(call, "").replace("  if (benchMode) {\n    if (millis() - benchModeSince", "  otaTick();\n  if (benchMode) {\n    if (millis() - benchModeSince")],
    ["option à 1 par défaut", src.replace("#ifndef POD_OTA_R4\n#define POD_OTA_R4 0", "#ifndef POD_OTA_R4\n#define POD_OTA_R4 1")],
    ["sans #error", src.replace(/#error "POD_OTA_R4 exige POD_WIFI_PORTAL[^\n]*\n/, "")],
    ["sans conditions de sûreté", src.replace("pendingCandidateId.length() > 0 || benchMode", "false")],
    ["confirmBoot avant le register", src.replace("  otar4::setServer(OTAR4_HOST, OTAR4_PORT, OTAR4_BASE);\n  otar4::confirmBoot();", "  otar4::confirmBoot();").replace("  lastPullMs = millis(); lastValidateMs = millis();", "  otar4::setServer(OTAR4_HOST, OTAR4_PORT, OTAR4_BASE);\n  lastPullMs = millis(); lastValidateMs = millis();")],
    ["marqueur non référencé", src.replace('logf("[WIFI] mode: %s", POD_WIFI_MODE_MARK);', "")],
    ["version 2.7 sans OTA", src.replace("#if POD_OTA_R4\n#define FIRMWARE_VERSION  \"r4tft28-2.7\"", "#if POD_WIFI_PORTAL\n#define FIRMWARE_VERSION  \"r4tft28-2.7\"")],
  ];
  for (const [name, mutant] of muts) { assert.notEqual(mutant, src, "mutant sans effet : " + name); assert.notDeepEqual(otaPortViolations(mutant), [], "mutant survivant : " + name); }
});

// ── Orientation de l'écran (POD_ORIENT) ─────────────────────────────────────────────────────────────────────────────────────────────────
export function orientViolations(s: string): string[] {
  const v: string[] = [];
  if (!/#ifndef POD_ORIENT\n#define POD_ORIENT 0\n#endif/.test(s)) v.push("POD_ORIENT doit valoir 0 par défaut");
  if (!/#ifndef POD_ORIENT_LAB\n#define POD_ORIENT_LAB 0/.test(s)) v.push("la commande série de banc doit être éteinte par défaut");
  for (const m of s.matchAll(/POD_ORIENT\b|g_rot\b|orientCycle|orientLoad|orientSave/g)) {
    const before = s.slice(0, m.index!);
    if (before.lastIndexOf("// POD_WIFI_BEGIN") <= before.lastIndexOf("// POD_WIFI_END")) { v.push("hors d'un bloc POD_WIFI : " + m[0] + " @" + m.index); break; }
  }
  if (!/void setRotation\(uint8_t r\) \{ Adafruit_ILI9341::setRotation\(\(uint8_t\)\(\(r \+ g_rot\) & 3\)\); \}/.test(s)) v.push("la sous-classe doit AJOUTER la rotation choisie à celle que demande le code");
  if (!/#define EEPROM_ORIENT_MAGIC_OFF 1024\n#define EEPROM_ORIENT_VALUE_OFF 1025/.test(s)) v.push("orientation dans le bloc 1 de la data flash (octets 1024-1025) : jamais 0, 2-3, 5-6, 7");
  if (!/g_rot = \(EEPROM\.read\(EEPROM_ORIENT_MAGIC_OFF\) == ORIENT_MAGIC && EEPROM\.read\(EEPROM_ORIENT_VALUE_OFF\) == 2\) \? 2 : 0;/.test(s)) v.push("une valeur inconnue ou un octet vierge doit donner l'orientation normale");
  const i = s.indexOf("static void serviceTouch() {\n  if (!touchOk || !ts.touched()) return;\n  const unsigned long t0 = millis();\n  while (ts.touched() && millis() - t0 < 1500UL) { delay(5); }\n  if (ts.touched()) {");
  if (i < 0) v.push("appui LONG (doigt toujours posé après 1,5 s) absent de serviceTouch");
  else if (!/orientCycle\(\);[\s\S]{0,260}return;\s*\}\s*drainTouch\(\);\s*delay\(120\);\s*toggleCartel\(\);/.test(s.slice(i, i + 700))) v.push("le toucher COURT doit rester « afficher / cacher le cartel »");
  if (!/\} else \{\s*tft\.fillScreen\(C_BLACK\);|else tft\.fillScreen\(C_BLACK\);/.test(s)) v.push("sans image mémorisée, l'écran est effacé après un retournement");
  return v;
}
test("TFT 2,8″ orientation : garde-fous (option éteinte, blocs balisés, bloc 1 de la data flash, toucher court inchangé)", () => { assert.deepEqual(orientViolations(src), []); });
test("TFT 2,8″ orientation MUTANTS : option à 1, bloc 0 de la data flash, rotation écrasée, toucher court supprimé ⇒ détectés", () => {
  const muts: Array<[string, string]> = [
    ["option à 1 par défaut", src.replace("#ifndef POD_ORIENT\n#define POD_ORIENT 0", "#ifndef POD_ORIENT\n#define POD_ORIENT 1")],
    ["octets dans le bloc 0", src.replace("#define EEPROM_ORIENT_MAGIC_OFF 1024", "#define EEPROM_ORIENT_MAGIC_OFF 600")],
    ["rotation écrasée", src.replace("((r + g_rot) & 3)", "(g_rot)")],
    ["toucher court supprimé", src.replace("  drainTouch();\n  delay(120);\n  toggleCartel();\n  drainTouch();\n}\n#else", "  drainTouch();\n}\n#else")],
    ["commande de banc allumée", src.replace("#ifndef POD_ORIENT_LAB\n#define POD_ORIENT_LAB 0", "#ifndef POD_ORIENT_LAB\n#define POD_ORIENT_LAB 1")],
  ];
  for (const [name, m] of muts) { assert.notEqual(m, src, "mutant sans effet : " + name); assert.notDeepEqual(orientViolations(m), [], "mutant survivant : " + name); }
});
