import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MEASURE_KEEP, MEASURE_MIN_INTERVAL_SEC, MEASURE_TEST_INTERVAL_SEC, MEASURE_TEST_UNTIL_MS, clampHours, decodeMeasure, decodeMeasures, encodeMeasure, formatMeasure, isSensorScreens,
  measureKindsOf, measureMinIntervalSec, parseDeclaredSensors, parseMeasurePost, summarize,
} from "../lib/measures";
import { assembleNetworkSnapshot, toNetworkDevice, type DeviceRecord } from "../lib/networkSnapshot";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// Mesures des appareils (capteurs) : modèle générique, quota/quorum, vue réseau, copies du firmware, décodage DHT22 sur l'hôte.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

test("isSensorScreens / measureKindsOf : pseudo-écran historique et déclaration explicite", () => {
  assert.equal(isSensorScreens(["sensor"]), true);
  for (const v of [["eink29bwr"], ["sensor", "oled096"], [], "sensor", undefined, null]) assert.equal(isSensorScreens(v), false);
  assert.deepEqual(measureKindsOf({ screens: ["sensor"] }), ["temp", "hum"]);                       // firmware r4dht22-1.0 déjà déployé
  assert.deepEqual(measureKindsOf({ screens: ["eink29bwr"] }), []);
  assert.deepEqual(measureKindsOf({ screens: ["eink29bwr"], sensors: ["temp", "bidon", "temp"] }), ["temp"]);   // carte AVEC écran qui mesure
  assert.deepEqual(measureKindsOf({ screens: ["sensor"], sensors: [] }), []);
  assert.deepEqual(parseDeclaredSensors(["temp", "x", "hum"]), ["temp", "hum"]);
  assert.equal(parseDeclaredSensors("temp"), undefined);
});

test("parseMeasurePost : { m } et ancien { c, h }, plages, entiers, grandeur inconnue refusée", () => {
  assert.deepEqual(parseMeasurePost({ m: { temp: 211, hum: 719 } }), { ok: true, values: { temp: 211, hum: 719 } });
  assert.deepEqual(parseMeasurePost({ c: 215, h: 456 }), { ok: true, values: { temp: 215, hum: 456 } });
  assert.deepEqual(parseMeasurePost({ c: -400 }), { ok: true, values: { temp: -400 } });
  assert.deepEqual(parseMeasurePost({ m: { hum: 1000 } }), { ok: true, values: { hum: 1000 } });
  for (const bad of [null, "x", {}, { m: {} }, { m: [] }, { m: { temp: 801 } }, { m: { temp: 21.5 } }, { m: { temp: "215" } }, { m: { hum: 1001 } }, { m: { hum: -1 } }, { m: { pression: 1000 } }, { c: 801 }])
    assert.equal(parseMeasurePost(bad).ok, false, JSON.stringify(bad));
});

test("encode/decode : aller-retour, ordre stable, entrées illisibles ignorées", () => {
  const m = { t: 1760000000, v: { temp: -35, hum: 801 } };
  assert.equal(encodeMeasure(m), "1760000000;temp=-35;hum=801");
  assert.deepEqual(decodeMeasure(encodeMeasure(m)), m);
  assert.deepEqual(decodeMeasure("5;temp=100"), { t: 5, v: { temp: 100 } });
  for (const bad of ["", "5", "5;", "0;temp=1", "x;temp=1", "5;temp", "5;temp=1.5", "5;bidon=1", 12, null, undefined]) assert.equal(decodeMeasure(bad), null, String(bad));
  assert.deepEqual(decodeMeasures(["10;temp=200", "zzz", "9;temp=190;hum=500"]).map((x) => x.t), [10, 9]);
});

test("summarize par grandeur, formats, bornes d'historique", () => {
  const ms = [{ t: 30, v: { temp: 200 } }, { t: 20, v: { temp: 100, hum: 500 } }, { t: 10, v: { temp: 301, hum: 700 } }];
  const t = summarize(ms, "temp"), h = summarize(ms, "hum");
  assert.deepEqual([t.min, t.max, t.avg, t.count, t.last?.t], [100, 301, 200, 3, 30]);
  assert.deepEqual([h.min, h.max, h.avg, h.count, h.last?.t], [500, 700, 600, 2, 20]);
  assert.equal(summarize([], "temp").count, 0);
  assert.equal(formatMeasure("temp", 215), "21,5 °C"); assert.equal(formatMeasure("temp", -35), "-3,5 °C"); assert.equal(formatMeasure("hum", 456), "45,6 %");
  assert.equal(clampHours(undefined), 168); assert.equal(clampHours("abc"), 168); assert.equal(clampHours(0), 168); assert.equal(clampHours(24), 24); assert.equal(clampHours(99999), MEASURE_KEEP);
});

test("CADENCE : l'essai à 5 min s'éteint tout seul le 16/10/2026 00:00 UTC", () => {
  assert.equal(measureMinIntervalSec(MEASURE_TEST_UNTIL_MS - 1), MEASURE_TEST_INTERVAL_SEC);
  assert.equal(measureMinIntervalSec(MEASURE_TEST_UNTIL_MS), MEASURE_MIN_INTERVAL_SEC);
  assert.equal(MEASURE_TEST_INTERVAL_SEC, 240); assert.equal(MEASURE_MIN_INTERVAL_SEC, 3000);
  assert.equal(new Date(MEASURE_TEST_UNTIL_MS).toISOString(), "2026-10-16T00:00:00.000Z");
});

test("VUE RÉSEAU : un capteur seul devient un appareil SANS écran avec sa dernière mesure ; en ligne selon la mesure, pas la fiche", () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);
  const rec: DeviceRecord = { deviceId: "dev_I25D9Z7A", screens: ["sensor"], firmware: "r4dht22-1.1", lastSeen: now - 5 * 3600_000, lastPing: now - 5 * 3600_000, framesSent: 0, createdAt: now - 9 * 3600_000, artistName: "Roubzi" };
  const raw = `${Math.floor((now - 10 * 60_000) / 1000)};temp=211;hum=719`;
  const d = toNetworkDevice(rec, null, now, raw);
  assert.deepEqual(d.screens, []); assert.deepEqual(d.pools, []);
  assert.deepEqual(d.measures?.kinds, ["temp", "hum"]);
  assert.equal(d.measures?.latest?.v.temp, 211);
  assert.equal(d.isOnline, true, "fiche vieille de 5 h mais mesure d'il y a 10 min");
  assert.equal(d.hardware, "uno-r4");
  const stale = toNetworkDevice(rec, null, now, `${Math.floor((now - 4 * 3600_000) / 1000)};temp=211`);
  assert.equal(stale.isOnline, false);
  const never = toNetworkDevice(rec, null, now, null);
  assert.equal(never.measures?.latest, null);
  // un appareil sans capteur n'a pas de champ measures ; une carte AVEC écran qui mesure garde ses écrans et ses pools
  const plain = toNetworkDevice({ ...rec, deviceId: "dev_AAAAAAAA", screens: ["eink29bwr"] }, null, now);
  assert.equal(plain.measures, undefined); assert.deepEqual(plain.screens.map((s) => s.screen), ["eink29bwr"]);
  const both = toNetworkDevice({ ...rec, deviceId: "dev_BBBBBBBB", screens: ["eink29bwr"], sensors: ["temp"] }, null, now, `${Math.floor(now / 1000) - 60};temp=190`);
  assert.deepEqual(both.pools, ["eink29bwr"]); assert.deepEqual(both.measures?.kinds, ["temp"]);
  const snap = assembleNetworkSnapshot([d, plain, both], 0);
  assert.equal(snap.totals.devices, 3); assert.equal(snap.totals.screens, 2, "le capteur n'ajoute aucun écran");
  assert.equal(snap.screens.every((p) => !p.devices.includes(d)), true, "le capteur n'est dans aucune pool d'écran");
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

test("ROUTE /api/sensor : code + capteur déclaré + appairé exigés AVANT l'anti-rafale SET NX, écriture en un pipeline, présence rare, lecture privée/publique bornée", () => {
  const r = read("app/api/sensor/route.ts");
  const iDev = r.indexOf("getDevice(deviceId)"), iPair = r.indexOf("device.pairCode !== pairCode"), iKinds = r.indexOf("kinds.length === 0"), iApp = r.indexOf("appareil non appairé");
  const iGate = r.indexOf("{ nx: true, ex: minSec }"), iPush = r.indexOf(".lpush(key"), iWrite = r.indexOf("writeDeviceKey(device)");
  assert.ok(iDev > 0 && iDev < iPair && iPair < iKinds && iKinds < iApp && iApp < iGate && iGate < iPush && iPush < iWrite, "ordre : appareil, code, capteur, appairé, anti-rafale, écriture, présence");
  assert.match(r, /\.lpush\(key, [\s\S]*?\)\.ltrim\(key, 0, MEASURE_KEEP - 1\)\.expire\(key, MEASURE_TTL_SEC\)\.sadd\(MEASURE_INDEX_KEY, deviceId\)\.exec\(\)/);
  assert.match(r, /MEASURE_PRESENCE_REFRESH_MS/);
  assert.match(r, /sessionOwnsDevice\(deviceId\)/, "historique long réservé au propriétaire");
  assert.match(r, /PUBLIC_HOURS = 48/); assert.match(r, /s-maxage=120/); assert.match(r, /sismember\("meas:devices", deviceId\)/);
  assert.doesNotMatch(r, /setInterval|smembers|redis\.keys\(|redis\.scan/);
  assert.match(r, /appareil inconnu ou code invalide/, "même réponse 403 : pas d'énumération");
});

test("VUE RÉSEAU : snapshot = + 1 SMEMBERS + un pipeline de LINDEX ; pseudo-écran jamais affiché ; panneau latéral sans lecture inutile pour un capteur", () => {
  const n = read("lib/networkSnapshot.ts");
  assert.match(n, /redis\.smembers<string\[\]>\(MEASURE_INDEX_KEY\)/);
  assert.match(n, /pl\.lindex\(measKey\(id\), 0\)/);
  assert.match(n, /filter\(\(s\) => s !== SENSOR_SCREEN\)/);
  const sp = read("app/network/SidePanel.tsx");
  assert.match(sp, /device\.measures && device\.screens\.length === 0\) \{ setLoadingBlock\(false\)/);
  assert.match(sp, /DeviceMeasuresSection/);
  assert.match(read("app/network/NetworkStage.tsx"), /node\.device\.measures \? "CAPTEUR" : "ESP"/);
  assert.match(read("app/network/graph/nodes/DeviceNode.tsx"), /device\.measures && device\.screens\.length === 0 \? "🌡"/);
  assert.match(read("app/draw/[device]/[screen]/page.tsx"), /screenParam === "sensor"/);
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
  assert.match(ino, /#define SENSOR_INTERVAL_MS\s+(300000|3600000)UL/);   // 300000 = essai (extinction du serveur le 16/10/2026), 3600000 = production
  assert.match(ino, /sensors\\":\[\\"temp\\",\\"hum\\"\]/);
  assert.match(ino, /\\"m\\":\{\\"temp\\":/);
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
