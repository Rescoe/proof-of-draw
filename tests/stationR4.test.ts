// Station de monitoring R4 (26/10/2026) : DHT22 + SGP40 + TFT 1,8″. Pilote SGP40 testé sur l'hôte (vecteurs Sensirion) ; propriétés statiques du firmware (jamais flashé).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findCompiler, describeChoice, runProcess } from "./helpers/cppHarness";
import { MEASURE_KINDS, parseMeasureBatch } from "../lib/measures";

const root = path.join(__dirname, "..");
const dir = path.join(root, "arduino_uno_r4/pod_uno_r4_station");
const ino = fs.readFileSync(path.join(dir, "pod_uno_r4_station.ino"), "utf8").replace(/\r\n/g, "\n");
const rd = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");

const cc = findCompiler();
test("SGP40 : CRC, commande et décodage (code réel de sgp40.h) conformes à la fiche Sensirion", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sgp40-"));
  const exe = path.join(tmp, "h");
  const r0 = runProcess(cc.path as string, ["-std=c++11", "-Wall", "-Wextra", "-Werror", `-I${dir}`, "-o", exe, path.join(root, "consensus-pod/host/sgp40_harness.cpp")], 120000);
  assert.equal(r0.status, 0, `${r0.stdout}\n${r0.stderr}`);
  const r = runProcess(exe, [], 30000);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /SUCCES : 0 echec/);
});

test("STATION : les en-têtes réseau sont des copies identiques de ceux du capteur validé (r4dht22-1.3)", () => {
  for (const f of ["podNetStack.h", "pod_http.h", "pod_ssl_bounded.h", "dht22.h"]) assert.equal(rd(dir, f), rd(root, "arduino_uno_r4/pod_uno_r4_dht22", f), f);
});

test("STATION : s'enregistre comme capteur (jamais écran/votant) et déclare la grandeur voc", () => {
  assert.match(ino, /#define SCREEN_TYPE\s+"sensor"/);
  assert.match(ino, /sensors\\":\[\\"temp\\",\\"hum\\",\\"voc\\"/);
  assert.match(ino, /#define FIRMWARE_VERSION\s+"r4env-1\.\d+"/);
  assert.ok(MEASURE_KINDS.voc, "le registre serveur connaît voc");
});

test("STATION : un envoi réel (température, humidité, gaz, diagnostic) est accepté par le serveur ; chaque grandeur peut manquer", () => {
  const ok = parseMeasureBatch({ r: [{ a: 1800, temp: 211, hum: 719, voc: 28340 }, { a: 0, voc: 28100 }], m: { rssi: -61, lat: 700, dl: 60 } });
  assert.equal(ok.ok, true);
  if (ok.ok) { assert.equal(ok.readings[0].values.voc, 28340); assert.equal(ok.readings[1].values.temp, undefined); assert.equal(ok.readings[1].values.voc, 28100); }
  for (const bad of [-1, 65536, 1.5]) assert.equal(parseMeasureBatch({ r: [{ a: 0, voc: bad }] }).ok, false, `voc ${bad}`);
});

test("STATION : TFT et I2C hors de la pile principale (1 024 o) ; aucun appel Wi-Fi direct ; journal par logf", () => {
  const stripped = ino.replace(/\/\/[^\n]*/g, "");
  // tout appel tft.* est dans tftLine / drawStationWork / initTft (exécutées par podWorkRun)
  const lines = stripped.split("\n");
  let fn = "";
  for (const l of lines) {
    const m = /^(?:static\s+)?(?:void|bool|uint16_t|String|int|uint8_t)\s+(?:__attribute__\(\(noinline\)\)\s+)?(\w+)\s*\(/.exec(l);
    if (m) fn = m[1];
    if (/\btft\.\w+\(/.test(l) && !/^static Adafruit_ST7735/.test(l)) assert.ok(["tftLine", "drawStationWork", "initTft"].includes(fn), `tft.* hors des fonctions prévues : ${fn} : ${l.trim()}`);
  }
  assert.match(stripped, /auto wk = \[&\]\(\) \{ drawStationWork\(\); \};\s*\n\s*if \(!podWorkRun\(wk, &ni\)\)/);
  assert.match(stripped, /auto wk = \[&\]\(\) \{ tft\.initR\(INITR_BLACKTAB\)/);
  assert.match(stripped, /sgp40Measure\(h10, t10, v\)/);
  assert.ok(/podWorkRun\(wk, &ni\)/.test(stripped.slice(stripped.indexOf("readSgp40"))), "le bus I2C passe par la pile de travail");
  assert.equal(/\bWiFi\.(?!begin|status|firmwareVersion|macAddress|RSSI|localIP)/.test(stripped), false);
  assert.equal(/\bSerial\.print/.test(stripped.replace(/logfEmit[\s\S]*?\n}\n/, "")), false, "Serial.print direct interdit hors logfEmit");
});

test("STATION : câblage documenté dans l'en-tête et cohérent avec les définitions", () => {
  assert.match(ino, /DHT_PIN\s+2\b/); assert.match(ino, /TFT_CS\s+10\b/); assert.match(ino, /TFT_DC\s+9\b/); assert.match(ino, /TFT_RST\s+8\b/);
  for (const t of ["D2", "D10", "D9", "D8", "D11", "D13", "SDA", "SCL", "5 V"]) assert.ok(ino.slice(0, 3500).includes(t), `câblage : ${t}`);
});

// ── OTA R4-B dans la station (26/10/2026) ──────────────────────────────────────────────────────────────
const client = rd(dir, "pod_ota_r4_client.h");
test("STATION OTA : copies identiques du noyau (podOtaR4.h) et de la pile Ed25519 (podEdStack.h)", () => {
  assert.equal(rd(dir, "podOtaR4.h"), rd(root, "consensus-pod/src/podOtaR4.h"));
  assert.equal(rd(dir, "podEdStack.h"), rd(root, "consensus-pod/src/adapters/podEdStack.h"));
});
test("STATION OTA : éteinte par défaut (POD_OTA_R4 = 0), le client n'est inclus que sous le drapeau, séquence de version par drapeau de banc seulement", () => {
  assert.match(ino, /#ifndef POD_OTA_R4\n#define POD_OTA_R4 0\n#endif/);
  assert.match(ino, /#if POD_OTA_R4\n#include "pod_ota_r4_client\.h"/);
  assert.match(ino, /#define OTAR4_COMPILED_SEQ 1/);
});
test("STATION OTA : la programmation n'est atteignable qu'APRÈS consommation du ticket, une seule fois, jamais ota.begin / download", () => {
  const c = client.replace(/\/\/[^\n]*/g, "");
  assert.equal((c.match(/g_ota\.update\(/g) ?? []).length, 1, "un seul appel de programmation");
  assert.equal(/\.begin\(OTAR4_PATH\)|\.download\(/.test(c), false, "ni ota.begin(chemin) (supprime le fichier) ni ota.download");
  const iConsume = c.indexOf("podotar4::consume(g_sess)"), iProg = c.indexOf("programCall();");
  assert.ok(iConsume > 0 && iProg > iConsume, "consume() avant programCall()");
  assert.ok(c.indexOf("hostConnected()") < iConsume, "contrôle de l'hôte USB avant le ticket consommé");
  assert.match(c, /programCall\(\) \{[\s\S]*?podWifiRun\(f, &ni\)/, "l'appel au module passe par podWifiRun");
});
test("STATION OTA : data flash — blocs 2 et 3 seulement, un effacement + un programme de 24 o, jamais EEPROM.update, périphérique fermé avant usage", () => {
  const c = client.replace(/\/\/[^\n]*/g, "");
  assert.match(c, /if \(blk != SEQ_BLOCK_A && blk != SEQ_BLOCK_B\) return false;/);
  assert.match(c, /d\.erase\(a, FLASH_BLOCK\) != 0/); assert.match(c, /d\.program\(in, a, 24\) == 0/);
  assert.match(c, /d\.deinit\(\); return d;/);
  assert.equal(/EEPROM\.(update|write|put)\(/.test(c), false);
});
test("STATION OTA : échec fermé sans clé publique de publication ; clés/secrets/drapeaux de banc ignorés par git", () => {
  assert.match(client, /aucune clé publique de publication compilée : OTA INACTIVE \(échec fermé\)/);
  const gi = rd(root, ".gitignore");
  for (const p of ["arduino_uno_r4/**/pod_ota_r4_keys.h", "arduino_uno_r4/**/pod_build_flags.h", "arduino_uno_r4/**/pod_lab_ca.h", "arduino_uno_r4/**/secrets.h"]) assert.ok(gi.includes(p), p);
});
