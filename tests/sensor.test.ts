import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SENSOR_KEEP, clampHours, decodeReading, decodeReadings, encodeReading, formatHum, formatTemp, isSensorScreens, parseReading, summarize,
} from "../lib/sensorData";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// Capteur de température (UNO R4 WiFi + DHT22) : fonctions pures, garde-fous de quota/quorum, copies du firmware, décodage DHT22 sur l'hôte.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

test("isSensorScreens : seulement [\"sensor\"]", () => {
  assert.equal(isSensorScreens(["sensor"]), true);
  for (const v of [["eink29bwr"], ["sensor", "oled096"], [], "sensor", undefined, null]) assert.equal(isSensorScreens(v), false);
});

test("parseReading : plages du DHT22, entiers uniquement", () => {
  assert.deepEqual(parseReading({ c: 215, h: 456 }), { ok: true, c: 215, h: 456 });
  assert.deepEqual(parseReading({ c: -400 }), { ok: true, c: -400 });
  assert.deepEqual(parseReading({ c: 800, h: 1000 }), { ok: true, c: 800, h: 1000 });
  for (const bad of [null, "x", {}, { c: 801 }, { c: -401 }, { c: 21.5 }, { c: "215" }, { c: 215, h: 1001 }, { c: 215, h: -1 }, { c: 215, h: 4.5 }]) assert.equal(parseReading(bad).ok, false, JSON.stringify(bad));
});

test("encode/decode : aller-retour, entrées illisibles ignorées, ordre conservé", () => {
  const r = { t: 1760000000, c: -35, h: 801 };
  assert.deepEqual(decodeReading(encodeReading(r)), r);
  assert.deepEqual(decodeReading(encodeReading({ t: 5, c: 100 })), { t: 5, c: 100 });
  assert.equal(encodeReading({ t: 5, c: 100 }), "5,100,");
  for (const bad of ["", "1,2", "a,b,c", "0,5,", "1.5,5,", 12, null, undefined, "1,2,3,4"]) assert.equal(decodeReading(bad), null, String(bad));
  const list = decodeReadings(["10,200,", "zzz", "9,190,500"]);
  assert.deepEqual(list.map((x) => x.t), [10, 9]);
});

test("summarize : min / max / moyenne / dernière mesure", () => {
  assert.deepEqual(summarize([]), { count: 0, min: null, max: null, avg: null, last: null });
  const s = summarize([{ t: 30, c: 200 }, { t: 20, c: 100 }, { t: 10, c: 301 }]);
  assert.equal(s.min, 100); assert.equal(s.max, 301); assert.equal(s.avg, 200); assert.equal(s.count, 3); assert.equal(s.last?.t, 30);
});

test("formats et bornes d'historique", () => {
  assert.equal(formatTemp(215), "21,5 °C"); assert.equal(formatTemp(-35), "-3,5 °C"); assert.equal(formatHum(456), "45,6 %");
  assert.equal(clampHours(undefined), 168); assert.equal(clampHours("abc"), 168); assert.equal(clampHours(0), 168); assert.equal(clampHours(24), 24); assert.equal(clampHours(99999), SENSOR_KEEP);
});

test("QUORUM : un capteur n'entre ni dans devices:all ni dans les pools ; l'onboarding ne l'envoie pas sur une page de dessin", () => {
  const ds = read("lib/deviceStore.ts");
  assert.equal((ds.match(/if \(!isSensorScreens\(screens\)\) await redis\.sadd\("devices:all"/g) ?? []).length, 2);
  assert.doesNotMatch(ds.replace(/if \(!isSensorScreens\(screens\)\) await redis\.sadd\("devices:all"[^\n]*/g, ""), /redis\.sadd\("devices:all"/);
  const reg = read("app/api/register/route.ts");
  assert.match(reg, /const sensor = isSensorScreens\(screens\);\n    if \(sensor\) \{ removedScreens\.length = 0; addedScreens\.length = 0; unchangedScreens\.length = 0; \}/);
  assert.match(reg, /if \(isNew && !sensor\) invalidateNetworkSnapshot\(\);/);
  assert.match(read("app/api/onboard/route.ts"), /isSensorScreens\(device\.screens\) \? "\/profile"/);
});

test("ROUTE /api/sensor : appairé + code + capteur exigés, anti-rafale SET NX avant toute écriture, aucune écriture hors pipeline unique", () => {
  const r = read("app/api/sensor/route.ts");
  const iDev = r.indexOf("getDevice(deviceId)"), iPair = r.indexOf("device.pairCode !== pairCode"), iSens = r.indexOf("isSensorScreens(device.screens)"), iApp = r.indexOf("capteur non appairé");
  const iGate = r.indexOf("{ nx: true, ex: SENSOR_MIN_INTERVAL_SEC }"), iPush = r.indexOf(".lpush(key"), iWrite = r.indexOf("writeDeviceKey(device)");
  assert.ok(iDev > 0 && iDev < iPair && iPair < iSens && iSens < iApp && iApp < iGate && iGate < iPush && iPush < iWrite, "ordre : appareil, code, capteur, appairé, anti-rafale, écriture, présence");
  assert.match(r, /\.lpush\(key, [\s\S]*?\)\.ltrim\(key, 0, SENSOR_KEEP - 1\)\.expire\(key, SENSOR_TTL_SEC\)\.exec\(\)/);
  assert.match(r, /sessionOwnsDevice\(deviceId\)/, "lecture réservée au propriétaire");
  assert.match(r, /redis\.lrange\(sensorKey\(deviceId\), 0, hours - 1\)/);
  assert.doesNotMatch(r, /setInterval|smembers|\.keys\(|scan/);
});

test("INTERFACE : une seule lecture à l'ouverture (jamais relancée par un re-rendu), aucun minuteur", () => {
  const ui = read("app/profile/SensorPanel.tsx");
  assert.match(ui, /\}, \[d\.deviceId\]\);/);
  assert.doesNotMatch(ui, /setInterval|setTimeout|usePolling/);
  assert.equal((ui.match(/fetch\(/g) ?? []).length, 1);
});

test("FIRMWARE capteur : copies identiques des fichiers partagés, aucun canari, aucune clé, drapeaux sans objet", () => {
  const D = "arduino_uno_r4/pod_uno_r4_dht22";
  assert.equal(read(`${D}/podNetStack.h`), read("consensus-pod/src/adapters/podNetStack.h"));
  assert.equal(read(`${D}/pod_http.h`), read("arduino_uno_r4/pod_uno_r4_eink29/pod_http.h"));
  const ino = read(`${D}/pod_uno_r4_dht22.ino`);
  assert.doesNotMatch(ino, /POD_CANARY|POD_RENDER_V1|podCanary|POD_FF|Ed25519|EEPROM|set_new_handler|operator\s+new/);
  assert.match(ino, /#define SCREEN_TYPE\s+"sensor"/);
  assert.match(ino, /#define SENSOR_INTERVAL_MS\s+3600000UL/);
  assert.match(ino, /httpCall\("POST", "\/api\/sensor"/);
  assert.ok(!fs.existsSync(path.join(root, D, "secrets.h")), "aucun secrets.h dans le dépôt");
  // tout appel au module Wi-Fi passe par les enveloppes, toute transaction TLS par podNetRun
  const code = ino.replace(/\/\/.*$/gm, "");
  const wifiCalls = [...code.matchAll(/WiFi\.(\w+)\(/g)].length;
  assert.equal(wifiCalls, 6, "WiFi.status/firmwareVersion/begin/macAddress/RSSI/localIP : seulement dans les six enveloppes");
  assert.equal((code.match(/podNetRun\(/g) ?? []).length, 1);
});

const cc = findCompiler();
test("DHT22 : décodage (code réel de dht22.h) — trames de la fiche technique, signe, bornes, somme de contrôle", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dht22-"));
  const exe = path.join(dir, "h");
  const r0 = runProcess(cc.path as string, ["-std=c++11", "-Wall", "-Wextra", "-Werror", `-I${path.join(root, "arduino_uno_r4/pod_uno_r4_dht22")}`, "-o", exe, path.join(root, "consensus-pod/host/dht22_harness.cpp")], 60000);
  assert.equal(r0.status, 0, `${r0.stdout}\n${r0.stderr}`);
  const r = runProcess(exe, [], 30000);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /SUCCES : 0 echec/);
});
