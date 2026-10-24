// tests/tftSensor.test.ts — branchement STATIQUE du capteur DHT22 dans le TFT 1,8″ (24/10/2026). Ne prouve PAS le comportement sur la carte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const ino = read("esp8266/esp_tft1.8/esp_tft1.8.ino");

test("TFT capteur : option à 0 par défaut, exige le portail, broche D3", () => {
  assert.match(ino, /#ifndef POD_SENSOR_DHT22\n#define POD_SENSOR_DHT22 0\n#endif/);
  assert.match(ino, /#ifndef POD_DHT_PIN\n#define POD_DHT_PIN D3\n#endif/);
  assert.match(ino, /#if POD_SENSOR_DHT22 && !POD_WIFI_PORTAL\n\s*#error/);
});
test("TFT capteur : déclaration sensors à /api/register SOUS la garde, jamais sans l'option", () => {
  const i = ino.indexOf('"\\"sensors\\":[\\"temp\\",\\"hum\\"],"');
  assert.ok(i > 0);
  assert.ok(ino.lastIndexOf("#if POD_SENSOR_DHT22", i) > ino.lastIndexOf("#endif", i), "la déclaration doit être dans un bloc #if POD_SENSOR_DHT22");
});
test("TFT capteur : le service ne tourne ni avant l'appairage, ni pendant un vote, une observation ou le banc d'essai ; appel avant le point d'appel OTA", () => {
  const svc = ino.slice(ino.indexOf("static void sensorService()"), ino.indexOf("void loop()"));
  assert.match(svc, /!registered \|\| !paired \|\| WiFi\.status\(\) != WL_CONNECTED/);
  assert.match(svc, /pendingCandidateId\.length\(\) > 0 \|\| pendingObsHashes\.length\(\) > 0 \|\| g_bench\.mode/);
  assert.match(svc, /ESP\.getMaxFreeBlockSize\(\) >= 18000/);
  const loop = ino.slice(ino.indexOf("void loop()"));
  assert.ok(loop.indexOf("sensorService();") > 0 && loop.indexOf("sensorService();") < loop.indexOf("podotaesp::maybeRun()"));
});
test("TFT capteur : la copie de pod_dht22.h est identique à l'original", () => {
  assert.equal(read("esp8266/esp_tft1.8/pod_dht22.h"), read("esp8266/_shared/pod_dht22.h"));
});
