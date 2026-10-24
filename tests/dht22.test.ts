// tests/dht22.test.ts — capteur DHT22 EXPÉRIMENTAL sur le multiscreen ESP8266 (23/10/2026). Le code RÉEL de esp8266/_shared/pod_dht22.h (partie pure) tourne sur l'hôte (consensus-pod/host/dht22_harness.cpp) ;
// le sketch est vérifié par analyse du source. Ce que cela NE prouve PAS : la lecture réelle du composant (timings sur la broche), l'envoi TLS réel, le tas réel de la carte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findCompiler, runProcess, formatFailure } from "./helpers/cppHarness";
import { MEASURE_KINDS, MEASURE_MIN_INTERVAL_SEC, parseMeasureBatch } from "../lib/measures";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const HDR = "esp8266/_shared/pod_dht22.h", INO = "esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino", HARNESS = "consensus-pod/host/dht22_harness.cpp";
const compiler = findCompiler().path;
const skip = compiler ? false : "aucun compilateur C++ : test du DHT22 ignoré — définir CXX";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dht22-"));

test("DHT22 : le code RÉEL (décodage, plages, planification, tampon, JSON) passe sur l'hôte", { skip }, () => {
  const exe = path.join(tmp, "h" + (process.platform === "win32" ? ".exe" : ""));
  const c = runProcess(compiler!, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O1", "-I" + path.join(root, "esp8266", "_shared"), path.join(root, HARNESS), "-o", exe]);
  if (c.status !== 0) throw new Error(formatFailure("compilation du harnais DHT22 impossible", c));
  const r = runProcess(exe, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
});
test("DHT22 : les constantes du firmware respectent le SERVEUR (cadence ≥ 50 min entre deux envois, plages, corps de lot accepté)", () => {
  const h = read(HDR);
  const num = (name: string) => { const m = new RegExp(`${name}\\s+=\\s+(\\d+)UL \\* (\\d+)UL \\* (\\d+)UL`).exec(h); return m ? Number(m[1]) * Number(m[2]) * Number(m[3]) / 1000 : NaN; };
  assert.equal(num("READ_EVERY_MS"), 1800, "une lecture toutes les 30 min");
  assert.ok(num("SEND_EVERY_MS") >= MEASURE_MIN_INTERVAL_SEC, `envoi toutes les heures ≥ ${MEASURE_MIN_INTERVAL_SEC} s (anti-rafale du serveur)`);
  assert.ok(MEASURE_KINDS.temp.min === -400 && MEASURE_KINDS.temp.max === 800 && MEASURE_KINDS.hum.min === 0 && MEASURE_KINDS.hum.max === 1000, "plages du serveur = plages du firmware (dixièmes)");
  assert.ok(/t < -400 \|\| t > 800/.test(h) && /h < 0 \|\| h > 1000/.test(h));
  // le corps que construit le firmware est accepté par le parseur du serveur
  const body = JSON.parse('{"deviceId":"dev_KAD6PKC4","pairCode":"9MTNU94Q","r":[{"a":1800,"temp":211,"hum":719},{"a":0,"temp":-50,"hum":999}],"m":{"rssi":-61}}');
  const p = parseMeasureBatch(body);
  assert.ok(p.ok, JSON.stringify(p)); if (p.ok) assert.equal(p.readings.length, 2);
});
test("DHT22 : le sketch — éteint par défaut, broche D3 (GPIO0, la seule libre), capteurs déclarés à l'enregistrement, jamais pendant un vote, hors sketch éteint rien ne change", () => {
  const s = read(INO);
  assert.ok(s.includes("#ifndef POD_SENSOR_DHT22\n#define POD_SENSOR_DHT22 0\n#endif"));
  assert.ok(s.includes("#define POD_DHT_PIN D3"));
  assert.ok(s.includes('"\\"sensors\\":[\\"temp\\",\\"hum\\"],"'), "déclaration des grandeurs à /api/register");
  const svc = s.slice(s.indexOf("static void sensorService()"), s.indexOf("\n}\n", s.indexOf("static void sensorService()")));
  assert.ok(svc.includes("pendingCandidateId.length() > 0 || pendingObsHashes.length() > 0"), "jamais pendant un vote / une observation");
  assert.ok(svc.includes("!registered || !paired || WiFi.status() != WL_CONNECTED"), "pas de lecture ni d'envoi avant l'appairage ou sans Wi-Fi");
  assert.ok(svc.includes("ESP.getMaxFreeBlockSize() < 18000"), "garde de tas contigu avant le TLS");
  assert.ok(/httpPost\("\/api\/sensor"/.test(svc) && !/\bmalloc\(|\bnew\b/.test(svc), "un seul POST, aucune allocation dynamique du capteur");
  assert.ok(s.includes("  sensorService();\n#endif"), "appelé depuis loop()");
  // aucune broche déjà utilisée
  const epd = read("esp8266/esp_eink_2.7BW_OLED/epdif.h");
  for (const pin of ["D0", "D1", "D2", "D8"]) assert.ok(new RegExp(`_PIN\\s+${pin}\\b`).test(epd), `broche e-ink ${pin}`);
  assert.ok(/OLED_SDA\s+D6/.test(s) && /OLED_SCL\s+D4/.test(s));
});
test("DHT22 : les copies de l'en-tête sont identiques", () => { assert.equal(read("esp8266/esp_eink_2.7BW_OLED/pod_dht22.h"), read(HDR)); });
