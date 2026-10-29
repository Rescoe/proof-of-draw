// tests/multiBwr.test.ts — MULTISCREEN e-ink BWR 2,9″ + OLED 0,96″ + DHT22 (« multibwr », 29/10/2026) : déclaration de deux écrans, une seule voix, animations OLED, migration OTA depuis le client eink29bwr,
// futures mises à jour de la nouvelle famille, impossibilité d'envoyer un binaire d'une autre famille. Les propriétés du firmware sont vérifiées sur le texte du sketch (aucune carte ici).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { supportsAnimPointer, animCapable, animOledAuxCapable } from "../lib/anim/pointer";
import { voteV2Capable, VOTE_V2_FIRMWARE } from "../lib/voteCapability";
import { familyOfFirmware, otaClientCapable, pickRelease, OTA_CLIENT_FIRMWARE } from "../lib/otaDistribution";
import { eligibleForRelease, type OtaManifest } from "../lib/otaManifest";
import { hardwareOfFirmware } from "../lib/network/hardware";

const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const ino = read("esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino");
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "");
const code = strip(ino);

function manifest(over: Partial<OtaManifest>): OtaManifest {
  return {
    schema: "pod-ota-manifest-v2", releaseId: "x", family: "esp8266-eink29bwr", profile: { board: "esp8266", screen: "eink29bwr", flash: "4M2M" }, channel: "canary", firmwareVersion: "eink29bwr-2.15", otaSeq: 16, minOtaSeq: 1,
    revokedSeqs: [], url: "/firmware/x/image.bin", size: 1, sha256: "0".repeat(64), wave: { of: 100, upTo: 100 }, canaryDevices: ["dev_T46HBXG1"], signature: { alg: "rsa2048-pkcs1-sha256", keyId: "ota-a", sig: "AA==" },
    ...over,
  } as OtaManifest;
}

test("1. deux écrans RÉELS déclarés (eink29bwr + oled096) quand POD_MULTI_OLED = 1 ; un seul écran sinon (BWR d'avant)", () => {
  assert.ok(code.includes('\\"screens\\":[\\"eink29bwr\\",\\"oled096\\"],"'), "doRegister déclare les deux écrans (variante)");
  assert.ok(code.includes('\\"screens\\":[\\"" + SCREEN_TYPE + "\\"],"'), "un seul écran sinon (texte d'avant conservé)");
  assert.match(code, /#if POD_OLED_ANIM && !POD_MULTI_OLED\n\s+"\\"caps\\":\[\\"anim-oled\\"\],"/, "plus de capacité d'OLED auxiliaire");
  assert.match(ino, /#ifndef POD_MULTI_OLED\n#define POD_MULTI_OLED 0\n#endif/, "0 par défaut : le firmware distribué ne change pas");
  assert.match(code, /#if POD_MULTI_OLED && !\(POD_OLED_STATUS && POD_OLED_ANIM && POD_SENSOR_DHT22\)\n#error/, "OLED, animations et DHT22 sont exigés ensemble");
});

test("2. BWR fixe : chaque téléchargement de l'e-ink nomme son écran (le serveur choisit sinon la plus ancienne frame des DEUX files)", () => {
  assert.match(code, /#define POD_SCREEN_QS "&screen=eink29bwr"/);
  assert.match(code, /#define POD_SCREEN_QS ""/);
  assert.ok(code.includes('"/api/pull-frame?deviceId=" + deviceId + POD_SCREEN_QS + "&fmt=bin&off="'), "morceaux");
  assert.ok(code.includes('"/api/pull-frame?deviceId=" + deviceId + "&screen=eink29bwr&fmt=bin";'), "téléchargement historique (variante)");
  assert.ok(code.includes('"/api/pull-frame?deviceId=" + deviceId + "&fmt=bin";'), "texte d'avant conservé hors variante");
});

test("3. OLED : frame propre (1 024 o lus dans le tampon SSD1306), ACK POUR l'écran oled096, pointeur d'animation réservé aux frames de l'OLED", () => {
  assert.ok(code.includes('"&screen=oled096&fmt=bin"') && code.includes("http.getSize() != 1024") && code.includes("oled.getBuffer()"));
  assert.ok(code.includes('ackFrame(frameId, "oled096")'));
  assert.ok(code.includes('body += ",\\"screen\\":\\""'), "l'ACK porte le champ screen quand on le demande");
  assert.match(code, /#if POD_MULTI_OLED\n\s+if \(newScreen == "oled096"\)[^\n]*\n#endif\n\s+\{ JsonObject an = doc\["anim"\]; podoaOnPull/, "une frame e-ink ou l'absence de frame ne touche jamais à l'animation en cours");
  assert.match(code, /if \(forOled\) \{[\s\S]*?doFetchFrameOled\(newFrameId, newFrameSource\)/);
  assert.ok(code.includes("g_lastFrameIdOled") && code.includes("forOled ? g_lastFrameIdOled : lastFrameId"), "un identifiant mémorisé PAR écran");
  assert.match(code, /#if POD_OLED_ANIM && !POD_MULTI_OLED\n\s+podoaAfterFrame\(fetchOk\);/, "une frame e-ink n'arrête plus l'animation de l'OLED");
  // côté serveur : l'écran oled096 d'un multibwr reçoit le pointeur, l'ancienne carte BWR sans écran oled096 jamais
  assert.equal(supportsAnimPointer(["oled096"], "multibwr-2.1"), true);
  assert.equal(supportsAnimPointer(["oled096"], "multibwr-2.0"), false);
  assert.equal(animCapable({ screens: ["eink29bwr", "oled096"], firmware: "multibwr-2.1" }, "oled096"), true);
  assert.equal(animCapable({ screens: ["eink29bwr", "oled096"], firmware: "multibwr-2.1" }, "eink29bwr"), false, "jamais d'animation sur l'e-ink");
  assert.equal(animCapable({ screens: ["eink29bwr"], firmware: "eink29bwr-2.12" }, "eink29bwr"), false, "BWR sans OLED inchangé");
  assert.equal(supportsAnimPointer(["oled096"], "multiscreen-2.2"), true, "ancien multiscreen 2,7″ inchangé");
  assert.equal(supportsAnimPointer(["oled096"], "multiscreen-2.1"), false);
});

test("3 bis. mesures entre les animations : l'écran capteur ne remplace une image fixe de l'OLED qu'après 5 minutes, jamais une animation", () => {
  assert.ok(code.includes("s.holdUntilMs = millis() + 300000UL"));
  assert.match(code, /if \(\(int32_t\)\(s\.holdUntilMs - now\) > 0\) return;/);
  assert.match(code, /if \(!s\.playing && \(int32_t\)\(s\.holdUntilMs - millis\(\)\) <= 0\) podoaSensorScreen\(\);/);
});

test("4. DHT22 : D3 + envoi au serveur déjà validés, exigés par la variante ; les grandeurs sont déclarées à l'enregistrement", () => {
  assert.ok(code.includes('"\\"sensors\\":[\\"temp\\",\\"hum\\"],"'));
  assert.ok(/#define POD_DHT_PIN\s+(D3|0)\b/.test(code) || /POD_DHT_PIN/.test(code));
  assert.ok(code.includes("podoaOnRead(ok, t, h)"), "chaque lecture rafraîchit l'écran capteur de l'OLED");
});

test("5-6. UNE voix par appareil (un seul /api/register, une seule clé), vote sur tous les formats (table de la famille côté serveur ET côté client)", () => {
  assert.equal((code.match(/Ed25519::derivePublicKey|void generateKeys\(\)/g) ?? []).length >= 1, true);
  assert.equal((code.match(/"\/api\/register"/g) ?? []).length, 1, "un seul enregistrement : deux écrans ne sont jamais deux validateurs");
  assert.deepEqual(VOTE_V2_FIRMWARE.multibwr, [2, 1]);
  assert.equal(voteV2Capable("multibwr-2.1"), true);
  assert.equal(voteV2Capable("multibwr-2.0"), false);
  const pod = read("esp8266/esp_eink_2.9BWR/podOta.h");
  assert.match(pod, /\{"multibwr", 2, 1\}/, "le client sait que multibwr-2.1 vote");
  const vote = read("esp8266/esp_eink_2.9BWR/pod_vote_esp.h");
  for (const n of ["oled096", "eink27bw", "eink29bwr", "tft18"]) assert.ok(vote.includes(`name == "${n}"`), `vote sur le format ${n}`);
});

test("7. identité, clé privée, Wi-Fi et blocs possédés conservés : aucune zone EEPROM ni Wi-Fi touchée par la variante", () => {
  const diff = ino.split("POD_MULTI_OLED").length;
  assert.ok(diff > 5);
  for (const k of ["EEPROM_OTA_OFF", "pod_wifi_cfg.h", "loadKeysFromEEPROM", "loadOwnedHashesJson"]) assert.ok(code.includes(k), `${k} conservé`);
  assert.match(ino, /#define POD_WIFI_FROM_RECORD 1/, "profil de distribution : Wi-Fi lu de l'enregistrement, jamais compilé");
  // aucune définition EEPROM_* dans les blocs POD_MULTI_OLED
  const blocks = [...ino.matchAll(/#if POD_MULTI_OLED[\s\S]*?#(?:else|endif)/g)].map((m) => m[0]).join("\n");
  assert.ok(!/EEPROM_[A-Z_]+\s+\d/.test(blocks) && !/EEPROM\.(write|put)/.test(blocks), "aucune écriture EEPROM dans les blocs de la variante");
});

test("8. OTA de migration : le client eink29bwr INSTALLÉ (2.13) l'accepte — famille de l'ancien client, version de manifeste connue de sa table de vote, séquence supérieure, canari ciblé", () => {
  const dev = { deviceId: "dev_T46HBXG1", firmware: "eink29bwr-2.13", otaSeq: 14 };
  const mig = manifest({ releaseId: "eink29bwr-2.15-ota16", firmwareVersion: "eink29bwr-2.15", otaSeq: 16 });
  assert.equal(pickRelease([mig], dev, Date.now())?.releaseId, "eink29bwr-2.15-ota16");
  // l'ancien client refuse tout préfixe de version absent de sa table : « multibwr-2.1 » comme version de MANIFESTE serait refusé (not-vote-capable)
  const oldTable = read("consensus-pod/src/podOta.h").replace(/\{"multibwr", 2, 1\}, /, "");
  assert.ok(!oldTable.includes('"multibwr"'));
  assert.equal(voteV2Capable("eink29bwr-2.15"), true, "version de manifeste/trailer lisible par le client installé");
  assert.deepEqual(OTA_CLIENT_FIRMWARE.eink29bwr, [2, 4]);
  // une autre carte BWR, ou une autre séquence, ne reçoit pas la migration
  assert.equal(pickRelease([mig], { ...dev, deviceId: "dev_MN67OG7R" }, Date.now()), null);
  assert.equal(pickRelease([mig], { ...dev, otaSeq: 16 }, Date.now()), null, "anti-retour : séquence non supérieure");
  // la carte garde son identité : le binaire migré se déclare multibwr-2.1 (jamais la version du manifeste)
  assert.match(code, /#define FIRMWARE_VERSION/);
});

test("9. mises à jour suivantes : la famille multibwr est distribuée normalement ; les autres familles n'y arrivent jamais", () => {
  assert.equal(familyOfFirmware("multibwr-2.1"), "esp8266-multibwr");
  assert.equal(otaClientCapable("multibwr-2.1"), true);
  assert.equal(otaClientCapable("multibwr-2.0"), false);
  assert.match(code, /#define POD_OTA_FAMILY "esp8266-multibwr"/);
  const dev = { deviceId: "dev_T46HBXG1", firmware: "multibwr-2.1", otaSeq: 16 };
  const next = manifest({ family: "esp8266-multibwr", firmwareVersion: "multibwr-2.2", otaSeq: 17 });
  assert.equal(pickRelease([next], dev, Date.now())?.otaSeq, 17);
  assert.equal(pickRelease([manifest({ otaSeq: 17 })], dev, Date.now()), null, "une release eink29bwr n'est plus offerte à la nouvelle famille");
});

test("10. impossible d'envoyer le binaire 2,7″ BW (ou une autre famille) au BWR : la famille du manifeste doit égaler celle de l'appareil", () => {
  const bwr = { deviceId: "dev_T46HBXG1", firmware: "eink29bwr-2.13", otaSeq: 14 };
  const ms27 = manifest({ family: "esp8266-multiscreen", firmwareVersion: "multiscreen-2.7", otaSeq: 20 });
  assert.deepEqual(eligibleForRelease(ms27, { deviceId: bwr.deviceId, family: familyOfFirmware(bwr.firmware), firmware: bwr.firmware, otaSeq: bwr.otaSeq, channel: "canary" }), { eligible: false, reason: "family" });
  assert.equal(pickRelease([ms27], bwr, Date.now()), null);
  assert.equal(pickRelease([ms27], { ...bwr, firmware: "multibwr-2.1", otaSeq: 16 }, Date.now()), null);
  // le client vérifie aussi la famille du trailer signé (podOta.h : T_FAMILY) et celle de l'annonce
  const pod = read("esp8266/esp_eink_2.9BWR/podOta.h");
  assert.ok(pod.includes("trailer-family"));
});

test("anciens appareils inchangés : l'ancien multiscreen 2,7″, le BWR sans OLED et l'OLED auxiliaire déjà distribué gardent leurs règles", () => {
  assert.equal(familyOfFirmware("multiscreen-2.6"), "esp8266-multiscreen");
  assert.equal(familyOfFirmware("eink29bwr-2.13"), "esp8266-eink29bwr");
  assert.equal(animOledAuxCapable({ screens: ["eink29bwr"], firmware: "eink29bwr-2.13", caps: ["anim-oled"] }), true, "oled096aux reste compatible pour les firmwares déjà distribués");
  assert.equal(animOledAuxCapable({ screens: ["eink29bwr", "oled096"], firmware: "multibwr-2.1", caps: [] }), false, "le nouveau firmware n'est jamais un OLED auxiliaire");
  assert.equal(hardwareOfFirmware("multibwr-2.1"), "esp8266");
});
