// gen_env.js — assemble arduino_uno_r4/pod_uno_r4_tft18_env/pod_uno_r4_tft18_env.ino à partir de :
//   - pod_uno_r4_tft18.ino (base : affichage TFT 1,8″, clés, vote v2, ACK) ;
//   - pod_uno_r4_eink29.ino (correctifs VALIDÉS sur carte : pull / validate / register décodés sur la pile de travail) ;
//   - pod_uno_r4_station.ino (capteurs DHT22 + SGP40, client OTA R4-B).
// Usage : node scripts/gen-tft18-env.js <racine du dépôt>   (PROVENANCE du firmware : le .ino généré est ensuite la source de vérité, il se modifie à la main ; ce script ne sert qu à tracer d où viennent les blocs)
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const rd = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const base = rd("arduino_uno_r4/pod_uno_r4_tft18/pod_uno_r4_tft18.ino");
const e29 = rd("arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino");
const stn = rd("arduino_uno_r4/pod_uno_r4_station/pod_uno_r4_station.ino");

function must(cond, msg) { if (!cond) throw new Error("gen_env: " + msg); }
function between(text, startMarker, endMarker, includeEnd = false) {
  const a = text.indexOf(startMarker); must(a >= 0, "début introuvable : " + startMarker.slice(0, 60));
  const b = text.indexOf(endMarker, a + startMarker.length); must(b >= 0, "fin introuvable : " + endMarker.slice(0, 60));
  return text.slice(a, includeEnd ? b + endMarker.length : b);
}
/** Retire les blocs `#if ... POD_CANARY ... #endif` (imbrication gérée), les sondes et marqueurs de canari. */
function stripCanary(t) {
  const out = []; let depth = 0; let skipping = false; let skipDepth = 0;
  for (const line of t.split("\n")) {
    if (/^\s*#\s*if/.test(line)) { depth++; if (!skipping && /POD_CANARY|POD_DP_PROBE/.test(line)) { skipping = true; skipDepth = depth; continue; } }
    else if (/^\s*#\s*endif/.test(line)) { if (skipping && depth === skipDepth) { skipping = false; depth--; continue; } depth--; }
    if (skipping) continue;
    if (/POD_DP_PROBE\(|POD_FF_START\(|podCanary[A-Za-z]*\(/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

// ── 1. pièces transplantées du e-ink 2,9″ (validées) ─────────────────────────────────────────────────────────
const regBlock = stripCanary(between(e29, "enum RegisterStatus", "static bool doRegister() {"));
const pullBlock = stripCanary(between(e29, "#define PULL_ID_MAX", "// ─── VALIDATION RÉELLE (vote v2)")).replace("if (frameKey(newFrameId) == lastFrameId)", "if (newFrameId == lastFrameId)");
const valBlock = stripCanary(between(e29, "enum ValidateStatus", "// ─── AUTO-TEST Ed25519 (au boot)"));
must(!/podCanary|POD_CANARY|POD_DP_PROBE/.test(regBlock + pullBlock + valBlock), "canari résiduel");
must(!/frameKey\(/.test(pullBlock), "frameKey résiduel");

// ── 2. pièces de la station (capteurs, OTA) ──────────────────────────────────────────────────────────────
let sensorBlock = between(stn, "#define SPEED_PATH", "// ─── AFFICHAGE LOCAL");
sensorBlock = sensorBlock.replace("static const char* g_otaMsg = nullptr;                      // état OTA affiché (nullptr : rien)\n", "");
must(!/g_otaMsg/.test(sensorBlock), "g_otaMsg résiduel dans le bloc capteurs");
// variables d'affichage de la station : retirées du bloc capteurs (g_sendOk / g_lastSendMs servent à l'écran seulement)
let out = base;

// ── 3. assemblage ────────────────────────────────────────────────────────────────────────────────────────
const hdr = `// pod_uno_r4_tft18_env.ino — PRODUIT COMPLET R4 (26/10/2026) : UNO R4 WiFi + TFT 1,8″ (œuvres, cartel) + VOTE RÉEL v2 + capteurs DHT22 / SGP40 + mise à jour OTA R4-B.
// Dérivé de pod_uno_r4_tft18 (affichage, clés, vote, ACK) + des correctifs de mémoire VALIDÉS sur carte dans les autres firmwares R4 : client TLS borné (PodBoundedSSL), register / pull / validate décodés sur la pile
// de travail dédiée (podWorkRun), + pod_uno_r4_station (capteurs, OTA). Écran serveur « tft18 » (compté dans le quorum dès r4tft18-1.1 : lib/voteCapability.ts).
// ÉTAT : COMPILÉ seulement (cœur 1.6.0) ; JAMAIS flashé, jamais essayé sur la carte (ni vote, ni image, ni capteur, ni OTA de ce produit). Drapeaux : POD_SENSORS = 0, POD_OTA_R4 = 0 par défaut (firmware = r4tft18 corrigé).
// Voir docs/PRODUIT_R4_TFT18_ENV_2026_10_26.md (câblage, protocole du premier essai, ce qui n'est pas prouvé).
`;
out = hdr + out;
// 3a. drapeaux de banc + includes
out = out.replace("#include <Arduino.h>\n", `#include <Arduino.h>
#if __has_include("pod_build_flags.h")
  #include "pod_build_flags.h"   // drapeaux de BANC (IGNORÉ par git) : FIRMWARE_VERSION, POD_SENSORS, POD_OTA_R4, OTAR4_*
#endif
`);
out = out.replace('#include "pod_vote_r4.h"\n', `#include "pod_vote_r4.h"
#include "pod_ssl_bounded.h"   // client TLS à réception modem BORNÉE (240 o) : validé sur carte (e-ink 2,9″ 11/10, TFT 2,8″ 13/10, capteur R4 12/10)
#include "dht22.h"
#include "sgp40.h"
#include <Wire.h>
#include <new>
`);
// 3b. configuration
out = out.replace('#define FIRMWARE_VERSION    "r4tft18-1.1"', `#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION    "r4tft18-2.0"
#endif
#ifndef POD_SENSORS
#define POD_SENSORS 0                                // 1 : DHT22 (D2) + SGP40 (I2C) lus toutes les 30 min, envoyés toutes les heures à /api/sensor (comme la station)
#endif
#ifndef POD_OTA_R4
#define POD_OTA_R4 0                                 // 1 : client OTA R4-B (manifeste signé Ed25519), famille uno-r4-wifi-tft18
#endif
#ifndef OTAR4_COMPILED_SEQ
#define OTAR4_COMPILED_SEQ 1
#endif
#define DHT_PIN             2
#define READ_INTERVAL_MS    1800000UL
#define POST_INTERVAL_MS    3600000UL
#define SPEED_EVERY_N_POSTS 1
#define SENSOR_RETRY_MS     300000UL
#define SGP_WARMUP_SAMPLES  12
#if POD_OTA_R4
  #define OTAR4_FAMILY "uno-r4-wifi-tft18"
  #define OTAR4_KIND "tft18"
  #if __has_include("pod_ota_r4_keys.h")
    #include "pod_ota_r4_keys.h"
  #endif
#endif`);
// 3c. client TLS borné AVANT struct Conn
must(out.includes("struct Conn {"), "struct Conn");
out = out.replace("struct Conn {", "// À partir d'ici le nom WiFiSSLClient désigne PodBoundedSSL (pod_ssl_bounded.h) : chaque lecture TLS demande au module AU PLUS 240 o.\n#define WiFiSSLClient PodBoundedSSL\nstruct Conn {");
// 3d. register : corps avec capteurs + décodage sur la pile de travail
const regOld = between(out, "static bool doRegister() {", "// ─── PULL ──");
let regNew = regOld;
regNew = regNew.replace('"\\"publicKey\\":\\"" + (keysLoaded ? bytesToHex(publicKey, 32) : String("")) + "\\"," \n', '');
const a1 = regNew.indexOf("  JSON_DOC(doc, 768);");
const a2 = regNew.indexOf('  logf("[REGISTER] deviceId=');
must(a1 > 0 && a2 > a1, "bloc JSON de doRegister");
regNew = regNew.slice(0, a1) + "  if (!doRegisterDecode(resp)) return false;\n" + regNew.slice(a2);
regNew = regNew.replace('"\\"ownedHashes\\":" + loadOwnedHashesJson() + "}";', '"\\"ownedHashes\\":" + loadOwnedHashesJson() +\n                      SENSORS_JSON "}";');
must(regNew.includes("SENSORS_JSON"), "SENSORS_JSON");
out = out.replace(regOld, regBlock + "\n" + regNew);
out = out.replace("static bool doRegister() {", '#if POD_SENSORS\n#define SENSORS_JSON ",\\"sensors\\":[\\"temp\\",\\"hum\\",\\"voc\\",\\"rssi\\",\\"lat\\",\\"dl\\"]"\n#else\n#define SENSORS_JSON ""\n#endif\nstatic bool doRegister() {');
// 3e. pull : remplacé
const pullOld = between(out, "// ─── PULL ──", "// ─── VALIDATION RÉELLE (vote v2)");
out = out.replace(pullOld, "// ─── PULL ──────────────────────────────────────────────────────────────────\n" + pullBlock.replace(/\n+$/, "\n") + "\n");
// 3f. validate : remplacé (le bloc d'origine va de « // ─── VALIDATION ──… » à l'auto-test)
const valOld = between(out, "// ─── VALIDATION ──", "// ─── AUTO-TEST Ed25519 (au boot)");
out = out.replace(valOld, "// ─── VALIDATION ──────────────────────────────────────────────────────────�\n" + valBlock.replace(/\n+$/, "\n") + "\n");
// 3g. capteurs + OTA avant setup
const sensorOta = `#if POD_SENSORS
// ─── CAPTEURS (DHT22 + SGP40) — repris de pod_uno_r4_station (r4env-1.1) ─────────────────────────────────
${sensorBlock}
static unsigned long g_lastReadMs = 0, g_nextReadDelayMs = 0, g_lastPostMs = 0, g_nextPostDelayMs = 0;
static bool g_firstRead = true, g_firstPost = true;
/** Lectures et envois des capteurs : indépendants du pull et du vote. L'envoi exige un appareil appairé (code d'appairage). */
static void __attribute__((noinline)) sensorsTick() {
  if (g_firstRead || millis() - g_lastReadMs >= g_nextReadDelayMs) {
    const bool ok = takeReading();
    g_firstRead = false; g_lastReadMs = millis();
    g_nextReadDelayMs = ok ? READ_INTERVAL_MS : SENSOR_RETRY_MS;
  }
  if (paired && g_n > 0 && (g_firstPost || millis() - g_lastPostMs >= g_nextPostDelayMs)) {
    const bool ok = doPost();
    g_firstPost = false; g_lastPostMs = millis();
    g_nextPostDelayMs = ok ? POST_INTERVAL_MS : SENSOR_RETRY_MS;
    g_sendOk = ok; if (ok) g_lastSendMs = millis();
  }
}
#endif
#if POD_OTA_R4
#include "pod_ota_r4_client.h"
static unsigned long g_otaNextMs = OTAR4_CHECK_FIRST_MS;
/** Une passe OTA (réseau + staging + éventuelle programmation). Bloque la boucle le temps du téléchargement (≈ 50 s pour 120 Ko). */
static void __attribute__((noinline)) otaTick(bool force) {
  if (!force && millis() < g_otaNextMs) return;
  const otar4::Result res = otar4::checkOnce(true);
  g_otaNextMs = millis() + ((res == otar4::R_NET_FAIL || res == otar4::R_STAGE_FAIL || res == otar4::R_DEFERRED_HOST || res == otar4::R_ERROR) ? OTAR4_RETRY_MS : OTAR4_CHECK_EVERY_MS);
  logf("[OTA] résultat : %s ; prochaine vérification dans %lu s", otar4::resultName(res), (unsigned long)((g_otaNextMs - millis()) / 1000UL));
}
#endif

`;
out = out.replace("// ─── SETUP / LOOP ──", sensorOta + "// ─── SETUP / LOOP ──");
// 3h. setup : Wire, OTA après register
out = out.replace('  logf("[WARNING] PORT NON TESTE SUR LE MATERIEL — 06/10/2026");', '  logf("[WARNING] PRODUIT R4 TFT 1,8 ENV : COMPILE SEULEMENT, JAMAIS ESSAYE SUR LA CARTE (26/10/2026)");\n#if POD_SENSORS\n  Wire.begin();\n#endif');
out = out.replace('  while (!registered) { if (doRegister()) break; delay(5000); }\n', `  while (!registered) { if (doRegister()) break; delay(5000); }
#if POD_OTA_R4
  otar4::setServer(OTAR4_HOST, OTAR4_PORT, OTAR4_BASE);
  otar4::confirmBoot();
#endif
`);
// 3i. loop : ticks
out = out.replace('  if (!registered) { if (!doRegister()) { delay(5000); return; } }\n', `  if (!registered) { if (!doRegister()) { delay(5000); return; } }
#if POD_SENSORS
  sensorsTick();
#endif
#if POD_OTA_R4
  if (Serial.available()) { const int ch = Serial.peek(); if (ch == 'o') { while (Serial.available()) Serial.read(); otaTick(true); } else if (ch == 'f') { while (Serial.available()) Serial.read(); otar4::dumpBlocks(); } }   // laboratoire : o = vérifier maintenant, f = data flash
  otaTick(false);                                  // la mise à jour ne dépend NI de l'appairage NI des capteurs
#endif
`);

// 3j. affichage TFT SUR LA PILE DE TRAVAIL (la pile principale de la R4 ne fait que 1 024 o ; un appel Adafruit GFX + SPI descend de plusieurs centaines d'octets) + pile réseau 3 072 o (le flux de l'image
//     s'écrit dans la transaction TLS). Les corps d'origine deviennent *Impl ; les enveloppes échouent FERMÉ (affichage ignoré, jamais de reset).
function rename(from, to) { must(out.includes(from), "renommage : " + from); out = out.replace(from, to); }
rename('static void tftStatus(const String& line1, const String& line2 = "", uint16_t bg = C_NAVY) {', 'static void tftStatusImpl(const String& line1, const String& line2, uint16_t bg) {');
rename("static void drawCartel() {", "static void drawCartelImpl() {");
rename("static void displayKeyMaterialOnce() {", "static void displayKeyMaterialOnceImpl() {");
rename("static void displayOnboardingQR(const String& onboardUrl, const String& code, const String& mac) {", "static void displayOnboardingQRImpl(const String& onboardUrl, const String& code, const String& mac) {");
const wrappers = [
  "// ─── Enveloppes d'affichage : TFT / QR sur la PILE DE TRAVAIL dédiée (podWorkRun, 2 048 o, garde + marge contrôlées) ───────────────────────",
  "static void __attribute__((noinline)) tftWorkFailed(const char* what, const PodNetInfo& ni) {",
  "  if (ni.err == POD_NET_GUARD) logfSafeStop();                    // garde écrasée : le voisin au tas est corrompu — arrêt sûr silencieux AVANT tout journal",
  '  logf("[TFT] %s : pile de travail dédiée : %s (erreur %u, marge %u o) — affichage ignoré", what, podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin);',
  "}",
  'static void __attribute__((noinline)) tftStatus(const String& line1, const String& line2 = "", uint16_t bg = C_NAVY) { PodNetInfo ni; auto wk = [&]() { tftStatusImpl(line1, line2, bg); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("tftStatus", ni); }',
  "#if !POD_RENDER_V1",
  'static void __attribute__((noinline)) drawCartel() { PodNetInfo ni; auto wk = [&]() { drawCartelImpl(); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("drawCartel", ni); }',
  "#endif",
  'static void __attribute__((noinline)) displayKeyMaterialOnce() { PodNetInfo ni; auto wk = [&]() { displayKeyMaterialOnceImpl(); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("clés à l\'écran", ni); }',
  'static void __attribute__((noinline)) displayOnboardingQR(const String& u, const String& c, const String& m) { PodNetInfo ni; auto wk = [&]() { displayOnboardingQRImpl(u, c, m); }; if (!podWorkRun(wk, &ni)) tftWorkFailed("QR d\'appairage", ni); }',
  "",
].join("\n");
must(out.includes("// ─── ACK / image"), "marqueur ACK");
out = out.replace("// ─── ACK / image", wrappers + "// ─── ACK / image");
out = out.replace('#include "podNetStack.h"', '#ifndef POD_NET_STACK_TOTAL\n#define POD_NET_STACK_TOTAL 3072u   // le flux de l\'image (Adafruit + SPI) s\'écrit DANS la transaction TLS : 1 024 o de plus que les autres firmwares R4\n#endif\n#include "podNetStack.h"');

fs.writeFileSync(path.join(root, "arduino_uno_r4/pod_uno_r4_tft18_env/pod_uno_r4_tft18_env.ino"), out);
console.log("écrit", out.length, "caractères");
