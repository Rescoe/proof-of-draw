// tests/wifiMsFirmware.test.ts — branchement STATIQUE du portail Wi-Fi, du Wi-Fi hors binaire et du client OTA dans le MULTISCREEN ESP8266 (e-ink 2,7″ + OLED), 23/10/2026.
// Ce que cela NE prouve PAS : le comportement réel du point d'accès, de l'OLED, de l'e-ink et de la flash sur la carte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.join(__dirname, "..");
const INO = "esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino";
const BASELINE = "b94bfb9";   // dernier commit du sketch AVANT ce lot
const BASELINE_PIN = process.env.MS_BASELINE ?? "";
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

export function stripMs(src: string): string {
  const out: string[] = []; let skip = false;
  for (const line of src.split("\n")) {
    if (line.includes("POD_MS_BEGIN")) { skip = true; continue; }
    if (skip) { if (line.includes("POD_MS_END")) skip = false; continue; }
    out.push(line);
  }
  return out.join("\n").replace('#define FIRMWARE_VERSION "multiscreen-2.7"', '#define FIRMWARE_VERSION "multiscreen-2.5"');   // seule différence voulue hors marqueurs : la version déclarée
}
export function msViolations(i: string): string[] {
  const v: string[] = [];
  // profil de distribution : portail, Wi-Fi hors binaire et OTA activés ; migration (secrets.h) éteinte
  for (const m of ["POD_WIFI_FROM_RECORD", "POD_WIFI_PORTAL", "POD_OTA", "POD_OTA_CLIENT"]) if (!new RegExp(`#ifndef ${m}\\n#define ${m} 1\\b`).test(i)) v.push(`${m} doit valoir 1 par défaut (profil de distribution)`);
  if (!i.includes("#ifndef POD_WIFI_MIGRATE\n#define POD_WIFI_MIGRATE 0\n#endif")) v.push("POD_WIFI_MIGRATE doit valoir 0 (jamais de Wi-Fi dans un binaire distribué)");
  if (!i.includes('#define POD_OTA_FAMILY "esp8266-multiscreen"')) v.push("famille OTA liée à la signature");
  if (!i.includes("#define POD_WIFI_REC_OFF 1540")) v.push("enregistrement Wi-Fi APRÈS les 1540 octets existants (l'image OLED sauvegardée occupe 99..1122)");
  if (!i.includes("#define EEPROM_OTA_OFF         1668") || !i.includes("static_assert(EEPROM_OTA_OFF >= 1540 + 128")) v.push("zone OTA après la zone Wi-Fi");
  if (!i.includes("#define EEPROM_SIZE            1696")) v.push("EEPROM de 1696 octets avec Wi-Fi/OTA");
  if (!i.includes("POD_WIFI_PORTAL && !POD_WIFI_FROM_RECORD\n  #error") || !i.includes("POD_OTA_CLIENT && !POD_WIFI_FROM_RECORD")) v.push("portail et client OTA exigent le Wi-Fi hors binaire (#error sinon)");
  if (!i.includes("if (g_podPullOk) podotaesp::confirmHealthy();")) v.push("démarrage SAIN = register ET premier pull décodé");
  if (!i.includes("podotaesp::maybeRun();")) v.push("point d'appel sûr de l'OTA dans loop()");
  if (!i.includes('url += "&o="')) v.push("séquence installée annoncée au pull");
  if (!i.includes("DynamicJsonDocument doc(3072);")) v.push("document du pull agrandi pour le bloc ota");
  if (!/portalOpen\(podportal::R_NO_RECORD\)/.test(i) || !/portalOpen\(wantPortal \? podportal::R_BUTTON : podportal::R_CONNECT_FAILED\)/.test(i)) v.push("ouvertures du portail");
  const scr = i.slice(i.indexOf("static void portalScreen("), i.indexOf("\n}\n", i.indexOf("static void portalScreen(")));
  if (!scr.includes("qrFits(v, strlen(qr))") || !scr.includes("oled.display();")) v.push("écran du portail sur l'OLED, capacité du QR vérifiée");
  if (/\bepd\.|e27Display/.test(scr)) v.push("le portail ne touche pas l'e-ink");
  for (const m of i.matchAll(/Serial\.(?:print|printf|printf_P|println)\(([^;]*)\);/g)) {
    const a = m[1].replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/\bg_wifiSsid\b|\bg_wifiPass\b|WIFI_SSID|WIFI_PASSWORD|storedPass|\bpw\b/.test(a)) v.push("journal pouvant contenir un identifiant : " + m[0].slice(0, 80));
  }
  return v;
}
const ino = read(INO);
test("MULTISCREEN : toutes les options à 0 ⇒ le sketch est EXACTEMENT celui d'avant le lot (au texte près)", () => {
  const ref = BASELINE_PIN || BASELINE;
  const base = execFileSync("git", ["show", `${ref}:${INO}`], { cwd: root, encoding: "utf8", maxBuffer: 20_000_000 }).replace(/\r\n/g, "\n");
  // LOT 1 (28/10/2026) : seule modification volontaire — une frame n'efface plus le candidat ; la ligne retirée est restaurée avant la comparaison
  assert.equal(stripMs(ino.replace(/^  \/\/ LOT 1 \(28\/10\/2026\) : une frame n'efface PAS le candidat[^\n]*\n/gm, '  pendingCandidateId    = "";\n')), base);
});
test("MULTISCREEN : branchement du portail et du client OTA — aucune violation", () => { assert.deepEqual(msViolations(ino), []); });
test("MULTISCREEN : les en-têtes partagés du dossier sont identiques à leurs originaux", () => {
  for (const n of ["pod_wifi_cfg.h", "pod_wifi_portal.h", "pod_wifi_portal_esp.h", "pod_ota_esp.h", "pod_ota_tls.h", "pod_ota_tls_roots.h", "pod_ota_keys_test.h", "podOta.h"]) {
    const master = n === "podOta.h" ? "consensus-pod/src/podOta.h" : `esp8266/_shared/${n}`;
    assert.equal(read(`esp8266/esp_eink_2.7BW_OLED/${n}`), read(master), n);
  }
});
test("MULTISCREEN MUTANTS : Wi-Fi sur l'image OLED sauvegardée, OTA actif par défaut, portail qui touche l'e-ink, santé sans pull ⇒ tous détectés", () => {
  const muts: Array<[string, string, string]> = [
    ["enregistrement Wi-Fi sur l'image OLED", "#define POD_WIFI_REC_OFF 1540", "#define POD_WIFI_REC_OFF 512"],
    ["OTA éteint par défaut", "#ifndef POD_OTA\n#define POD_OTA 1", "#ifndef POD_OTA\n#define POD_OTA 0"],
    ["portail éteint par défaut", "#ifndef POD_WIFI_PORTAL\n#define POD_WIFI_PORTAL 1", "#ifndef POD_WIFI_PORTAL\n#define POD_WIFI_PORTAL 0"],
    ["migration active par défaut", "#ifndef POD_WIFI_MIGRATE\n#define POD_WIFI_MIGRATE 0", "#ifndef POD_WIFI_MIGRATE\n#define POD_WIFI_MIGRATE 1"],
    ["famille d'un autre écran", '#define POD_OTA_FAMILY "esp8266-multiscreen"', '#define POD_OTA_FAMILY "esp8266-tft18"'],
    ["santé sans pull", "if (g_podPullOk) podotaesp::confirmHealthy();", "podotaesp::confirmHealthy();"],
    ["capacité du QR non vérifiée", "qrFits(v, strlen(qr))", "true"],
    ["EEPROM trop petite", "#define EEPROM_SIZE            1696", "#define EEPROM_SIZE            1540"],
  ];
  for (const [name, a, b] of muts) { assert.ok(ino.includes(a), "motif absent : " + name); assert.notDeepEqual(msViolations(ino.replace(a, () => b)), [], "mutant survivant : " + name); }
});
