// tests/multiBwrPin.test.ts — le pin de build suivi du profil multibwr-2.1 : complet, sans secret, et lié au sketch (toute modification du sketch impose de refaire le build ET le pin).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const PIN = "docs/mesures/MULTIBWR_2026_10_29/MULTIBWR-2.1-BUILD-PIN.json";
const raw = fs.readFileSync(PIN, "utf8");
const pin = JSON.parse(raw);
const hex64 = /^[0-9a-f]{64}$/;

test("pin multibwr : FQBN, options exactes, version embarquée, séquence, tailles, RAM statique et SHA complets (image, fichier signé, région signée)", () => {
  assert.equal(pin.fqbn, "esp8266:esp8266:nodemcuv2:eesz=4M2M");
  for (const o of ["POD_MULTI_OLED=1", "POD_OLED_ANIM=1", "POD_SENSOR_DHT22=1", "POD_OLED_STATUS=1", "POD_SENSOR_DISPLAY=1", "POD_FRAME_CHUNK=1", "POD_WIFI_FROM_RECORD=1", "POD_WIFI_PORTAL=1", "POD_OTA=1", "POD_OTA_CLIENT=1", "POD_OTA_SEQ=16"]) assert.ok(pin.buildExtraFlags.includes("-D" + o), o);
  assert.deepEqual(pin.embedded, { firmwareVersion: "multibwr-2.1", otaFamily: "esp8266-multibwr", otaSeq: 16, screens: ["eink29bwr", "oled096"], sensors: ["temp", "hum"] });
  for (const k of ["image", "signedFile", "signedRegion"]) { assert.match(pin[k].sha256, hex64, k); assert.ok(Number.isInteger(pin[k].bytes) && pin[k].bytes > 100000, k); }
  assert.ok(pin.image.ramStatic > 0 && pin.image.ramStatic <= 40000, "règle ESP8266 : RAM statique ≤ 40 000 o");
  assert.deepEqual(pin.manifest, { releaseId: "eink29bwr-2.15-ota16", family: "esp8266-eink29bwr", firmwareVersion: "eink29bwr-2.15", otaSeq: 16, channel: "canary", canaryDevices: ["dev_T46HBXG1"], keyId: "ota-a" });
  assert.ok(pin.signedRegion.bytes < pin.signedFile.bytes && pin.signedRegion.bytes > pin.image.bytes, "région signée = image + trailer, fichier signé = région + signature");
  assert.match(pin.sketchSha256Lf, hex64);
});

test("pin multibwr : aucun secret (ni Wi-Fi, ni clé privée, ni jeton)", () => {
  assert.doesNotMatch(raw, /PRIVATE KEY|BEGIN [A-Z ]*KEY|SECRET_WIFI|password|mot de passe|ssid|token|KV_REST|OTA_TICKET_SECRET/i);
  assert.ok(!/\.pod-ota-release|C:\\\\Users/.test(raw), "aucun chemin privé");
});

test("pin multibwr : lié au sketch courant (modifier le sketch impose de refaire le build et le pin) et aux options par défaut éteintes", () => {
  const ino = fs.readFileSync(pin.sketchSource, "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(ino).digest("hex"), pin.sketchSha256Lf, "le sketch a changé depuis le build épinglé : refaire le build, la signature et le pin");
  assert.match(ino, /#ifndef POD_MULTI_OLED\n#define POD_MULTI_OLED 0\n#endif/);
  assert.match(ino, /#ifndef POD_OLED_ANIM\n#define POD_OLED_ANIM 0\n#endif/);
});
