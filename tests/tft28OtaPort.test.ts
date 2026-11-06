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
