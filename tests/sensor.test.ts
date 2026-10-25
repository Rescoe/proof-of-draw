import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MEASURE_KEEP, MEASURE_MAX_HOURS, MEASURE_MIN_INTERVAL_SEC, MEASURE_TEST_INTERVAL_SEC, MEASURE_TEST_UNTIL_MS, clampHours, decodeMeasure, decodeMeasures, encodeMeasure, formatMeasure, isSensorScreens,
  kindsOfGroup, measureKindsOf, measureMinIntervalSec, parseDeclaredSensors, parseMeasureBatch, parseMeasurePost, primaryKinds, summarize,
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
  assert.equal(clampHours(undefined), 168); assert.equal(clampHours("abc"), 168); assert.equal(clampHours(0), 168); assert.equal(clampHours(24), 24); assert.equal(clampHours(99999), MEASURE_MAX_HOURS); assert.equal(MEASURE_MAX_HOURS, 744); assert.equal(MEASURE_KEEP, 1488, "31 jours à 48 points par jour");
});

test("CADENCE : l'essai à 5 min s'éteint tout seul le 16/10/2026 00:00 UTC", () => {
  assert.equal(measureMinIntervalSec(MEASURE_TEST_UNTIL_MS - 1), MEASURE_TEST_INTERVAL_SEC);
  assert.equal(measureMinIntervalSec(MEASURE_TEST_UNTIL_MS), MEASURE_MIN_INTERVAL_SEC);
  assert.equal(MEASURE_TEST_INTERVAL_SEC, 240); assert.equal(MEASURE_MIN_INTERVAL_SEC, 3000);   // envoi horaire, refus sous 50 min
  assert.equal(new Date(MEASURE_TEST_UNTIL_MS).toISOString(), "2026-10-16T00:00:00.000Z");
});

test("VUE RÉSEAU : un capteur seul devient un appareil SANS écran avec sa dernière mesure ; en ligne selon la mesure, pas la fiche", () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);
  const rec: DeviceRecord = { deviceId: "dev_I25D9Z7A", screens: ["sensor"], firmware: "r4dht22-1.1", measuresPublic: true, lastSeen: now - 5 * 3600_000, lastPing: now - 5 * 3600_000, framesSent: 0, createdAt: now - 9 * 3600_000, artistName: "Roubzi" };
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
  const both = toNetworkDevice({ ...rec, deviceId: "dev_BBBBBBBB", screens: ["eink29bwr"], sensors: ["temp"], measuresPublic: true }, null, now, `${Math.floor(now / 1000) - 60};temp=190`);
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
  assert.match(ino, /#define READ_INTERVAL_MS\s+1800000UL/);   // lecture toutes les 30 min
  assert.match(ino, /#define POST_INTERVAL_MS\s+3600000UL/);   // envoi toutes les heures (serveur : refus sous 50 min)
  assert.match(ino, /sensors\\":\[\\"temp\\",\\"hum\\",\\"rssi\\",\\"lat\\",\\"dl\\"\]/);
  assert.match(ino, /wifiRssi\(rssi\)/);
  assert.match(ino, /\\"r\\":" \+ r/);
  assert.match(ino, /\\"a\\":" \+ String\(\(unsigned\)ageS\)/);
  assert.match(ino, /httpCall\("POST", "\/api\/sensor"/);
  assert.ok(!fs.existsSync(path.join(root, D, "secrets.h")), "aucun secrets.h dans le dépôt");
  // tout appel au module Wi-Fi passe par les enveloppes, toute transaction TLS par podNetRun
  const code = ino.replace(/\/\/.*$/gm, "");
  const wifiCalls = [...code.matchAll(/WiFi\.(\w+)\(/g)].length;
  assert.equal(wifiCalls, 6, "WiFi.status/firmwareVersion/begin/macAddress/RSSI/localIP : seulement dans les six enveloppes");
  assert.equal((code.match(/podNetRun\(/g) ?? []).length, 2, "netHttpRaw + netSpeedTest : toute transaction TLS sur pile dédiée");
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

test("CONSTELLATION : un capteur seul est un nœud « appareil » de la hiérarchie et de la mise en page (sans nœud-écran), distinct visuellement", async () => {
  const { buildNetworkHierarchy, layoutNetwork } = await import("../app/network/model");
  const now = Date.now();
  const rec: DeviceRecord = { deviceId: "dev_I25D9Z7A", screens: ["sensor"], firmware: "r4dht22-1.1", lastSeen: now, lastPing: now, framesSent: 0, createdAt: now, artistName: "Roubzi" };
  const screenDev = toNetworkDevice({ ...rec, deviceId: "dev_AAAAAAAA", screens: ["eink29bwr"] }, null, now);
  const sensor = toNetworkDevice(rec, null, now, `${Math.floor(now / 1000)};temp=197;hum=740`);
  const layout = layoutNetwork(buildNetworkHierarchy([screenDev, sensor]));
  const dev = layout.nodes.filter((n) => n.kind === "device");
  assert.equal(dev.length, 2, "les deux appareils sont des nœuds");
  assert.equal(layout.nodes.filter((n) => n.kind === "screen").length, 1, "le capteur n'ajoute aucun nœud-écran");
  assert.ok(dev.some((n) => n.id.includes(sensor.publicId)), "le nœud du capteur existe");
  // forme et couleur propres au capteur (losange ambre), légende
  const node = read("app/network/graph/nodes/DeviceNode.tsx");
  assert.match(node, /isSensor/); assert.match(node, /#fbbf24/); assert.match(node, /rotate\(45\)/);
  assert.match(read("app/network/graph/Graph.tsx"), /is-sensor" \/>capteur/);
  assert.match(read("app/network/NetworkStage.tsx"), /transform="rotate\(45\)"/);
});

test("DIAGNOSTIC Wi-Fi : rssi (dBm entier) et lat (ms) sont des grandeurs valides, non affichées sur les nœuds, sans commande Redis de plus", () => {
  assert.deepEqual(parseMeasurePost({ m: { temp: 211, hum: 719, rssi: -61, lat: 742 } }), { ok: true, values: { temp: 211, hum: 719, rssi: -61, lat: 742 } });
  for (const bad of [{ m: { rssi: 5 } }, { m: { rssi: -128 } }, { m: { rssi: -60.5 } }, { m: { lat: -1 } }, { m: { lat: 60001 } }]) assert.equal(parseMeasurePost(bad).ok, false, JSON.stringify(bad));
  assert.equal(encodeMeasure({ t: 5, v: { temp: 200, rssi: -61, lat: 742 } }), "5;temp=200;rssi=-61;lat=742");
  assert.deepEqual(decodeMeasure("5;temp=200;rssi=-61;lat=742"), { t: 5, v: { temp: 200, rssi: -61, lat: 742 } });
  assert.equal(formatMeasure("rssi", -61), "-61 dBm"); assert.equal(formatMeasure("lat", 742), "742 ms"); assert.equal(formatMeasure("temp", 197), "19,7 °C");
  assert.deepEqual(primaryKinds(["temp", "hum", "rssi", "lat"]), ["temp", "hum"]);
  assert.match(read("app/network/graph/nodes/DeviceNode.tsx"), /primaryKinds\(device\.measures!\.kinds\)/);
  assert.match(read("app/network/NetworkStage.tsx"), /primaryKinds\(m\.kinds\)/);
});

test("TOPOLOGIE : rayon des anneaux dicté par l'espacement d'arc, monde élargi borné, vue initiale = monde entier, zoom arrière possible", () => {
  const n = read("app/network/NetworkStage.tsx");
  assert.match(n, /const arc = 170 \* nodeScale, gap = 185 \* nodeScale;/);
  assert.match(n, /Math\.max\(wished, needed, ring === 0 \? 0 : out\[ring - 1\] \+ gap\)/);
  assert.match(n, /Math\.min\(4, Math\.max\(1, /);
  assert.match(n, /setVb\(\{ x: 0, y: 0, w: worldW, h: worldH \}\)/);
  assert.match(n, /const ZOOM_MIN  = 0\.15;/);
  // ordre de grandeur : 60 appareils sur 4 anneaux exigent un rayon extérieur bien supérieur à celui du cadre, donc un monde élargi (facteur borné à 4)
  const arcRadius = (count: number, nodeScale: number) => (count * 170 * nodeScale) / (Math.PI * 2);
  assert.ok(arcRadius(60, 0.75) > arcRadius(8, 1) * 0.9 && arcRadius(8, 1) > 200);
});

test("CONSTELLATION : un doigt posé sur un appareil participe au pincement ; glissement depuis un nœud = déplacement de la vue ; le clic qui suit est avalé", () => {
  const v = read("app/network/graph/useViewport.ts");
  assert.doesNotMatch(v, /closest\("\.ng-node"\)\) return;/, "plus de pointeur ignoré sur un nœud");
  assert.match(v, /fromNode/); assert.match(v, /Math\.hypot\(rec\.x - rec\.sx, rec\.y - rec\.sy\) < 8/);
  assert.match(v, /if \(!fromNode\) event\.currentTarget\.setPointerCapture/);
  assert.match(v, /onClickCapture/); assert.match(v, /suppressClick\.current = true;/);
  assert.match(read("app/network/graph/Graph.tsx"), /\{\.\.\.viewport\.handlers\}/);
});

test("DÉBIT : grandeur dl (kbit/s), fichier statique de 4 Ko servi par le CDN, client TLS borné, aucune commande Redis de plus", () => {
  assert.deepEqual(parseMeasurePost({ m: { temp: 200, dl: 81 } }), { ok: true, values: { temp: 200, dl: 81 } });
  for (const bad of [{ m: { dl: -1 } }, { m: { dl: 1000001 } }, { m: { dl: 8.5 } }]) assert.equal(parseMeasurePost(bad).ok, false, JSON.stringify(bad));
  assert.equal(formatMeasure("dl", 81), "81 kbit/s"); assert.equal(formatMeasure("dl", 2500), "2,5 Mbit/s");
  assert.deepEqual(primaryKinds(["temp", "hum", "rssi", "lat", "dl"]), ["temp", "hum"]);
  const bin = fs.readFileSync(path.join(root, "public/speedtest.bin"));
  assert.equal(bin.length, 4096);
  assert.ok(new Set(bin).size > 200, "octets variés : incompressible, aucune compression CDN possible");
  const D = "arduino_uno_r4/pod_uno_r4_dht22", ino = read(`${D}/pod_uno_r4_dht22.ino`);
  assert.equal(read(`${D}/pod_ssl_bounded.h`), read("arduino_uno_r4/pod_uno_r4_eink29/pod_ssl_bounded.h"), "copie identique du client borné validé sur carte");
  assert.ok(ino.indexOf("#define WiFiSSLClient PodBoundedSSL") > 0 && ino.indexOf("#define WiFiSSLClient PodBoundedSSL") < ino.indexOf("struct Conn {"));
  assert.match(ino, /#define SPEED_PATH\s+"\/speedtest\.bin"/); assert.match(ino, /#define SPEED_BYTES\s+4096UL/);
  // le test de débit est UNE transaction réseau sur pile dédiée, avant le POST ; son échec n'empêche pas la mesure
  assert.equal((ino.replace(/\/\/.*$/gm, "").match(/podNetRun\(/g) ?? []).length, 2);
  assert.ok(ino.indexOf("netSpeedTest();") < ino.indexOf('httpCall("POST", "/api/sensor"'));
  assert.match(ino, /if \(dl > 0 && dl <= 1000000UL\)/);
  assert.match(read("lib/measures.ts"), /aucune commande Redis, aucune fonction serveur/);
  assert.doesNotMatch(read("app/api/sensor/route.ts"), /speedtest/, "le fichier est statique : la route n'est pas concernée");
});

test("ENVOI GROUPÉ : lectures en tampon avec âge, un seul LPUSH pour tout le lot, diagnostic rattaché à la plus récente", () => {
  // corps du firmware r4dht22-1.3
  const b = parseMeasureBatch({ r: [{ a: 1800, temp: 211, hum: 719 }, { a: 0, temp: 205, hum: 725 }], m: { rssi: -61, lat: 742, dl: 65 } });
  assert.ok(b.ok); if (!b.ok) return;
  assert.equal(b.readings.length, 2);
  assert.deepEqual(b.readings[0], { ageSec: 1800, values: { temp: 211, hum: 719 } });
  assert.deepEqual(b.readings[1], { ageSec: 0, values: { temp: 205, hum: 725, rssi: -61, lat: 742, dl: 65 } }, "le diagnostic va sur la lecture la plus RÉCENTE");
  // anciens corps : une seule lecture d'âge 0
  assert.deepEqual(parseMeasureBatch({ m: { temp: 200 } }), { ok: true, readings: [{ ageSec: 0, values: { temp: 200 } }] });
  assert.deepEqual(parseMeasureBatch({ c: 215, h: 456 }), { ok: true, readings: [{ ageSec: 0, values: { temp: 215, hum: 456 } }] });
  for (const bad of [{ r: [] }, { r: "x" }, { r: [{ a: -1, temp: 1 }] }, { r: [{ a: 86401, temp: 1 }] }, { r: [{ a: 1.5, temp: 1 }] }, { r: [{ temp: 1 }] }, { r: [{ a: 0 }] }, { r: [{ a: 0, temp: 9999 }] }, { r: [{ a: 0, temp: 1 }], m: { rssi: 3 } }, { r: Array.from({ length: 17 }, () => ({ a: 0, temp: 1 })) }])
    assert.equal(parseMeasureBatch(bad).ok, false, JSON.stringify(bad).slice(0, 60));
  assert.equal(parseMeasureBatch({ r: Array.from({ length: 16 }, (_, i) => ({ a: i * 100, temp: 1 })) }).ok, true);
  const r = read("app/api/sensor/route.ts");
  assert.match(r, /\.lpush\(key, \.\.\.stored\.map\(encodeMeasure\)\)/, "un seul LPUSH, N valeurs");
  assert.match(r, /\.sort\(\(a, b\) => a\.t - b\.t\)/, "ordre chronologique : la plus récente en tête de liste");
  assert.match(r, /t: nowS - r\.ageSec/);
  // firmware : tampon de 12 lectures, ré-essai sans perte, lecture indépendante du réseau
  const ino = read("arduino_uno_r4/pod_uno_r4_dht22/pod_uno_r4_dht22.ino");
  assert.match(ino, /#define RING_MAX 12/); assert.match(ino, /resp\.indexOf\("\\"stored\\":true"\) >= 0/);
  assert.ok(ino.indexOf("takeReading();") < ino.indexOf("wifiStatus() != WL_CONNECTED) { wifiBegin()"), "la lecture précède le test du Wi-Fi : elle continue pendant une coupure");
  assert.match(ino, /g_n = 0; g_posts\+\+; return true;/);
});

test("PROFIL : une carte sans écran affiche ses mesures (pas de conversion, de frames ni de ping) ; température et connexion sont deux parties", () => {
  const d = read("app/profile/DevicesPanel.tsx");
  assert.match(d, /\{isSensorScreens\(d\.screens\) && <SensorSummary d=\{d\} \/>\}/);
  assert.match(d, /\{!isSensorScreens\(d\.screens\) && d\.screens\.map/);
  assert.match(d, /dernière mesure \$\{timeSince\(d\.latest\.t \* 1000\)\}/);
  assert.match(read("lib/deviceStore.ts"), /sc !== "sensor"\);   \/\/ « sensor » est un pseudo-écran/);
  const api = read("app/api/devices/route.ts");
  assert.match(api, /pl\.lindex\(measKey\(d\.deviceId\), 0\)/); assert.match(api, /d\.isOnline = Date\.now\(\) - m\.t \* 1000 <= MEASURE_ONLINE_MS/);
  const sp = read("app/profile/SensorPanel.tsx");
  assert.match(sp, /MEASURE_GROUPS\.map/); assert.match(sp, /kindsOfGroup\(kinds, g\.id\)/);
  assert.match(read("app/network/SidePanel.tsx"), /MEASURE_GROUPS\.map/);
  assert.deepEqual(kindsOfGroup(["temp", "hum", "rssi", "lat", "dl"], "env"), ["temp", "hum"]);
  assert.deepEqual(kindsOfGroup(["temp", "hum", "rssi", "lat", "dl"], "link"), ["rssi", "lat", "dl"]);
  assert.deepEqual(kindsOfGroup(["temp", "hum"], "link"), []);
});

import { showsMeasures } from "../lib/measures";
test("showsMeasures : un appareil AVEC écran n'affiche « Mesures » que s'il a reçu une vraie mesure ; un capteur seul dès sa déclaration", () => {
  const screenDeclared = { screens: ["tft18"], sensors: ["temp", "hum"] };
  assert.equal(showsMeasures(screenDeclared, false), false, "déclaration sans mesure : aucun capteur branché");
  assert.equal(showsMeasures(screenDeclared, true), true);
  assert.equal(showsMeasures({ screens: ["tft18"] }, true), false, "firmware sans déclaration : jamais");
  assert.equal(showsMeasures({ screens: ["sensor"], sensors: ["temp", "hum"] }, false), true, "capteur seul : visible dès la déclaration");
});
