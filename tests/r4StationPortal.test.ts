// tests/r4StationPortal.test.ts — station R4 TFT 1,8″ : Wi-Fi hors binaire (portail), carte de la data flash sans chevauchement, contrôle « aucun Wi-Fi dans l'image » (+ mutants), outil de build sans secrets.h.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkImage, parseSecretsH, parseForbiddenFile, buildDirFindings, MARK_COMPILED, MARK_RECORD } from "../ota-lab/r4-ota5/tools/wifi-guard.mjs";

const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const D = "arduino_uno_r4/pod_uno_r4_tft18_env";
const ino = read(`${D}/pod_uno_r4_tft18_env.ino`);

// ── Carte de la data flash (8 Ko : octets 0..8191, blocs de 1 Ko) ──────────────────────────────────────────────
function flashMap() {
  const num = (re: RegExp, src = ino) => { const m = re.exec(src); assert.ok(m, String(re)); return Number(m![1]); };
  const slots = num(/#define OWNED_SLOTS_MAX\s+(\d+)/), hashLen = num(/#define OWNED_HASH_LEN\s+(\d+)/), slotsOff = num(/#define EEPROM_OWNED_SLOTS_OFF\s+(\d+)/);
  const cfg = read(`${D}/pod_wifi_cfg.h`);
  const wifiOff = num(/#define POD_WIFI_REC_OFF (\d+)/, cfg), wifiLen = num(/static const int LEN = (\d+);/, cfg);
  const ota = read(`${D}/podOtaR4.h`);
  const blkA = num(/SEQ_BLOCK_A = (\d+)/, ota), blkB = num(/SEQ_BLOCK_B = (\d+)/, ota), blk = num(/FLASH_BLOCK = (\d+)u/, ota);
  return [
    { name: "clé privée", from: num(/#define EEPROM_PRIVKEY_OFF\s+(\d+)/), len: 32 },
    { name: "dernier bloc connu", from: num(/#define EEPROM_BLOCKHASH_OFF\s+(\d+)/), len: 32 },
    { name: "drapeau clés générées", from: num(/#define EEPROM_FLAG_OFF\s+(\d+)/), len: 1 },
    { name: "clé publique", from: num(/#define EEPROM_PUBKEY_OFF\s+(\d+)/), len: 32 },
    { name: "écran d'appairage montré", from: num(/#define EEPROM_ONBOARDING_OFF\s+(\d+)/), len: 1 },
    { name: "blocs possédés (tête, compte, 10 emplacements)", from: num(/#define EEPROM_OWNED_HEAD_OFF\s+(\d+)/), len: 2 + 0 },
    { name: "emplacements des blocs possédés", from: slotsOff, len: slots * hashLen },
    { name: "enregistrement Wi-Fi (portail)", from: wifiOff, len: wifiLen },
    { name: "séquence OTA bloc A (data flash, blocs 2/3)", from: blkA * blk, len: blk },
    { name: "séquence OTA bloc B", from: blkB * blk, len: blk },
  ];
}
test("data flash de la station : aucune zone ne se chevauche (identité, blocs possédés, Wi-Fi, séquences OTA)", () => {
  const z = flashMap().sort((a, b) => a.from - b.from);
  for (let i = 1; i < z.length; i++) assert.ok(z[i - 1].from + z[i - 1].len <= z[i].from, `${z[i - 1].name} [${z[i - 1].from}..${z[i - 1].from + z[i - 1].len}) chevauche ${z[i].name} [${z[i].from}..)`);
  const byName = (n: string) => z.find((x) => x.name.startsWith(n))!;
  assert.deepEqual([byName("enregistrement Wi-Fi").from, byName("enregistrement Wi-Fi").len], [512, 105]);
  assert.ok(byName("emplacements").from + byName("emplacements").len <= 512, "l'identité tient entièrement sous l'enregistrement Wi-Fi");
  assert.equal(byName("séquence OTA bloc A").from, 2048); assert.equal(byName("séquence OTA bloc B").from, 3072);
  assert.ok(z.every((x) => x.from + x.len <= 8192), "tout tient dans les 8 Ko");
  // aucune autre zone dans la station : pas de verrou de vote (canari TFT 2,8″ seulement), pas de journal de canari (bloc 7, e-ink 2,9″ seulement)
  assert.doesNotMatch(ino, /voteLock|VOTE_LOCK|EEPROM_LOCK/i);
  assert.doesNotMatch(ino, /DataFlashBlockDevice|podFfBoot|0x1C00/, "la station n'écrit pas le bloc 7");
});
test("le module du portail n'écrit QUE [OFF, OFF+LEN) : jamais l'identité, ni la séquence OTA, ni un verrou", () => {
  const cfg = read(`${D}/pod_wifi_cfg.h`);
  const writes = [...cfg.matchAll(/\be\.write\(([^;]*?)\)/g)].map((m) => m[1]);
  assert.ok(writes.length >= 2);
  for (const w of writes) assert.match(w, /^OFF \+ i,/, `écriture hors de l'enregistrement : e.write(${w})`);
  assert.doesNotMatch(cfg, /DataFlash|FlashBlock|erase/i);
  const portal = read(`${D}/pod_wifi_portal_r4.h`);
  const eeWrites = [...portal.matchAll(/EEPROM\.(?:update|write)\(([^;]*?)\)/g)].map((m) => m[1]);
  for (const w of eeWrites) assert.match(w, /^addr|a,|OFF|podwifi::OFF|i,/, `écriture EEPROM inattendue dans le portail : ${w}`);
});

// ── Wi-Fi hors binaire : source ─────────────────────────────────────────────────────────────────────────────────
test("mode portail : aucune constante SSID/mot de passe, secrets.h jamais inclus, marqueur et version, fenêtre série, portail rouvrable", () => {
  const i = ino.indexOf("#if POD_WIFI_PORTAL\n  static char g_wifiSsid");
  assert.ok(i > 0);
  const branch = ino.slice(i, ino.indexOf("#else", i));
  assert.doesNotMatch(branch, /secrets\.h|SECRET_WIFI/);
  assert.match(branch, /const char\* WIFI_SSID\s+= g_wifiSsid;/); assert.match(branch, /const char\* WIFI_PASSWORD = g_wifiPass;/);
  assert.match(ino, /#ifndef POD_WIFI_PORTAL\n#define POD_WIFI_PORTAL 0\n#endif/, "0 par défaut");
  assert.match(ino, /#if POD_WIFI_PORTAL\n#include "pod_wifi_portal\.h"\nconst char POD_WIFI_MODE_MARK\[\] __attribute__\(\(used, retain\)\) = "PODWIFI:record-v1";\n#else\nconst char POD_WIFI_MODE_MARK\[\] __attribute__\(\(used, retain\)\) = "PODWIFI:compiled-v1";/);
  assert.ok(ino.includes('logf("[WIFI] mode: %s", POD_WIFI_MODE_MARK)'), "marqueur référencé (sinon éliminé par l'éditeur de liens)");
  assert.match(ino, /#ifndef FIRMWARE_VERSION\n#define FIRMWARE_VERSION\s+"r4tft18-2\.7"\n\/\/ POD_WIFI_BEGIN\n#if POD_WIFI_PORTAL\n#undef FIRMWARE_VERSION\n#define FIRMWARE_VERSION\s+"r4tft18-2\.8"/);
  assert.match(ino, /#if POD_WIFI_PORTAL\n  wifiStartup\(\);\n#else/, "setup() passe par wifiStartup()");
  assert.ok(ino.includes('"WIFI-PORTAL"') && ino.includes("podportal::decide(have, false, false, forced)"), "portail rouvrable (commande série) et automatique si la box a changé");
  assert.ok(ino.includes("podportalr4::run(reason, mac, wifiScan, wifiApStart, wifiApStop, portalScreen, nullptr)"), "même moteur que la UNO R4 e-ink 2,9″");
  for (const m of ["Premiere connexion", "Wi-Fi introuvable", "Wi-Fi enregistre", "CONNECTE TON WI-FI", "choisis ta box Wi-Fi"]) assert.ok(ino.includes(m), `message TFT : ${m}`);
  assert.doesNotMatch(ino.slice(ino.indexOf("static void portalScreenImpl"), ino.indexOf("static void __attribute__((noinline)) portalScreen(")), /WIFI_SSID|g_wifiSsid|g_wifiPass/, "l'écran du portail n'affiche jamais les identifiants de la box");
});
test("capacités conservées dans le mode portail : DHT22, SGP40 et indice, écran de station, microSD, animations, vote, ACK, OTA R4 signée, canal canary", () => {
  for (const k of ["#define POD_SENSORS", "#define POD_ENV_DISPLAY", "#define POD_SD_CS_PIN", "#define POD_OTA_R4"]) assert.ok(ino.includes(k), k);
  for (const k of ["doValidate", "ackFrame", "sdInit", "sgp40", "DHT", 'otar4::setServer', "otar4::confirmBoot"]) assert.ok(new RegExp(k, "i").test(ino + read(`${D}/pod_ota_r4_client.h`)), k);
  assert.match(read(`${D}/pod_ota_r4_client.h`), /#define OTAR4_CHANNEL "canary"/);
  assert.ok(fs.existsSync(`${D}/pod_wifi_portal_r4.h`) && fs.existsSync(`${D}/pod_wifi_portal.h`) && fs.existsSync(`${D}/pod_wifi_cfg.h`));
});
test("copies du portail identiques aux sources (une seule architecture de provisionnement)", () => {
  const same = (a: string, b: string) => assert.equal(read(a), read(b), `${a} != ${b}`);
  same(`${D}/pod_wifi_portal_r4.h`, "arduino_uno_r4/pod_uno_r4_eink29/pod_wifi_portal_r4.h");
  same(`${D}/pod_wifi_cfg.h`, "esp8266/_shared/pod_wifi_cfg.h");
  same(`${D}/pod_wifi_portal.h`, "esp8266/_shared/pod_wifi_portal.h");
});

// ── Contrôle d'image : recherche d'OCTETS + marqueurs, mutants ──────────────────────────────────────────────────
const SSID = "BoxTest-4242", PASS = "mot-de-passe-test-777";
const clean = () => Buffer.concat([Buffer.alloc(300, 0x11), Buffer.from(MARK_RECORD), Buffer.alloc(300, 0x22)]);
test("wifi-guard : image propre acceptée ; valeurs fournies absentes", () => {
  const r = checkImage(clean(), [SSID, PASS]);
  assert.equal(r.ok, true); assert.equal(r.checked, 2);
});
const mutants: Array<[string, () => Buffer, string[]]> = [
  ["SSID présent dans l'image", () => Buffer.concat([clean(), Buffer.from(SSID)]), [SSID, PASS]],
  ["mot de passe présent dans l'image", () => Buffer.concat([clean(), Buffer.from("xx" + PASS + "yy")]), [SSID, PASS]],
  ["mot de passe présent, SSID seul fourni (le nouveau Wi-Fi est dans la liste)", () => Buffer.concat([clean(), Buffer.from(PASS)]), [PASS]],
  ["marqueur de Wi-Fi compilé", () => Buffer.concat([clean(), Buffer.from(MARK_COMPILED)]), [SSID]],
  ["marqueur hors binaire absent", () => Buffer.alloc(600, 0x33), [SSID]],
  ["liste interdite vide (échec fermé)", () => clean(), []],
];
for (const [name, mk, forbidden] of mutants) test(`wifi-guard MUTANT refusé : ${name}`, () => {
  const r = checkImage(mk(), forbidden);
  assert.equal(r.ok, false, "le contrôle n'a pas détecté le binaire contaminé");
  for (const f of r.findings) { assert.ok(!f.includes(SSID) && !f.includes(PASS), "un finding contient une valeur secrète"); }
});
test("wifi-guard : analyse de secrets.h, fichiers interdits, secrets.h réel dans le build, et AUCUNE valeur dans la sortie", () => {
  assert.deepEqual(parseSecretsH(`#define SECRET_WIFI_SSID "${SSID}"\n#define SECRET_WIFI_PASSWORD "${PASS}"\n`), [SSID, PASS]);
  assert.deepEqual(parseSecretsH(`#define SECRET_WIFI_SSID "VOTRE_SSID"\n#define SECRET_WIFI_PASSWORD "your-password"\n`), [], "gabarit ignoré");
  assert.deepEqual(parseForbiddenFile(`# commentaire\n${SSID}\n\nab\n${PASS}\n`), [SSID, PASS]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wg-"));
  try {
    fs.writeFileSync(path.join(tmp, "secrets.h"), `#define SECRET_WIFI_SSID "${SSID}"\n#define SECRET_WIFI_PASSWORD "${PASS}"\n`);
    assert.equal(buildDirFindings(tmp).length, 1);
    fs.writeFileSync(path.join(tmp, "secrets.h"), `#define SECRET_WIFI_SSID "VOTRE_SSID"\n#define SECRET_WIFI_PASSWORD "VOTRE_MDP"\n`);
    assert.equal(buildDirFindings(tmp).length, 0);
    // CLI de bout en bout : image contaminée => code 1, et ni stdout ni stderr ne contiennent les valeurs
    const bin = path.join(tmp, "bad.bin"); fs.writeFileSync(bin, Buffer.concat([clean(), Buffer.from(SSID)]));
    const forb = path.join(tmp, "forb.txt"); fs.writeFileSync(forb, `${SSID}\n${PASS}\n`);
    const r = spawnSync(process.execPath, ["ota-lab/r4-ota5/tools/wifi-guard.mjs", "--bin", bin, "--forbid-file", forb], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.ok(!(r.stdout + r.stderr).includes(SSID) && !(r.stdout + r.stderr).includes(PASS), "valeur secrète affichée");
    const ok = path.join(tmp, "ok.bin"); fs.writeFileSync(ok, clean());
    const r2 = spawnSync(process.execPath, ["ota-lab/r4-ota5/tools/wifi-guard.mjs", "--bin", ok, "--forbid-file", forb], { encoding: "utf8" });
    assert.equal(r2.status, 0, r2.stderr);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test("publication et build : le contrôle est BLOQUANT et le build n'emporte jamais secrets.h", () => {
  const pub = read("ota-lab/r4-ota5/tools/publish-r4-release.mjs");
  assert.match(pub, /wifi-guard\.mjs/); assert.match(pub, /if \(g\.status !== 0\) die\("wifi-guard : "/);
  assert.ok(pub.indexOf("wifi-guard.mjs") < pub.indexOf("copyFileSync(join(rel, \"manifest.txt\")"), "le contrôle précède toute copie dans public/");
  const b = read("ota-lab/r4-ota5/tools/build-r4-station.mjs");
  assert.match(b, /if \(f === "secrets\.h" \|\| f === "pod_build_flags\.h" \|\| f === "pod_ota_r4_keys\.h"\) continue;/);
  assert.match(b, /POD_WIFI_PORTAL=1/); assert.match(b, /wifi-guard\.mjs/); assert.match(b, /--build-dir/);
  assert.doesNotMatch(b + pub, /\.seed|private/i, "aucune lecture de graine privée");
});
