import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// LOT8B2C-ESP8266-EINK27-OLED-CANARY-1 — canari de l'ESP8266 e-ink 2,7″ BW + OLED (rendu v1, frame personnelle, AUCUN vote).
// (1) règles statiques : drapeaux 0/0 au dépôt, OFF == firmware d'avant au texte près, tout le canari sous « #if POD_RENDER_V1 && POD_CANARY », rien de R4/WiFiS3, OLED inchangé ;
// (2) exécution HÔTE du CODE RÉEL (fragments extraits de l'.ino et du pilote) contre un environnement ESP8266 simulé (consensus-pod/host/esp_mock + esp27_mock.h) : OFF, ON, CANARI, avec et sans chemin de vote ;
// (3) contrôles négatifs : chaque garde supprimée est REFUSÉE par le harnais.
// Rien ici n'est une mesure sur carte : BearSSL réel, tas réel, durées BUSY réelles, orientation physique et chien de garde matériel restent à observer (docs/LOT_8B2C_ESP8266_EINK27_OLED_CANARY_2026_10_13.md).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const DIR = "esp8266/esp_eink_2.7BW_OLED";
const INO = `${DIR}/esp_eink_2.7BW_OLED.ino`;
const DRV = `${DIR}/epd2in7_V2.cpp`;
const BK = "firmware-backups/2026-10-13_avant-canari-esp8266-eink27-oled";
const INC_RE = /#include "pod_canary_flags\.h"[^\n]*\n/;   // FIX2 : en-tête des drapeaux (source unique, partagée par le sketch et le pilote)
const trimEnds = (s: string) => s.replace(INC_RE, "").replace(/[ 	]+$/gm, "");   // la sauvegarde est normalisée (espaces finaux) : on compare sans eux
const readBk = (p: string) => trimEnds(read(`${BK}/${p}`));
const CANARY_RE = /#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g;
const stripLine = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str?: string) => str ?? "");

function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, `région introuvable : ${a} … ${b}`);
  return src.slice(i, j);
}
function fnAtColumn0(src: string, header: string): string {
  const i = src.indexOf("\n" + header + "\n") + 1;
  assert.ok(i > 0, `fonction introuvable : ${header}`);
  const j = src.indexOf("\n}\n", i);
  return src.slice(i, j + 3);
}

// ── 1. règles statiques ───────────────────────────────────────────────────────────────
test("dépôt : POD_RENDER_V1 = 0 et POD_CANARY = 0 ; aucun drapeau à 1", () => {
  const s = read(INO);
  assert.match(s, /#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0/);
  assert.match(s, /#ifndef POD_CANARY\n#define POD_CANARY 0 /);
  assert.equal((s.match(/#define POD_CANARY\b/g) ?? []).length, 1);
  assert.doesNotMatch(s, /#define POD_(RENDER_V1|CANARY) 1\b/);
});

test("OFF : retirer les blocs de canari et le drapeau redonne le firmware d'avant AU TEXTE PRÈS (sketch ET pilote)", () => {
  const s = read(INO).replace(CANARY_RE, "").replace(/#ifndef POD_CANARY\n#define POD_CANARY 0 [^\n]*\n#endif\n/, "");
  assert.equal(trimEnds(s), readBk(`esp_eink_2.7BW_OLED.ino`));
  assert.equal(trimEnds(read(DRV).replace(CANARY_RE, "")), readBk(`epd2in7_V2.cpp`));
});

test("FIX2 : les drapeaux ont UNE source (pod_canary_flags.h, 0/0), incluse par le sketch ET par le pilote ; le pilote ne définit aucun drapeau", () => {
  const h = read(`${DIR}/pod_canary_flags.h`);
  assert.equal(h.replace(/^\/\/.*\n/gm, ""), "#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0\n#endif\n#ifndef POD_CANARY\n#define POD_CANARY 0\n#endif\n");
  assert.match(read(INO), /\/\/ POD_RENDER_V1_BEGIN\n#include "pod_canary_flags\.h"/);
  assert.match(read(DRV), /#include "epd2in7_V2\.h"\n#include "pod_canary_flags\.h"/);
  assert.doesNotMatch(read(DRV), /#define POD_(RENDER_V1|CANARY)\b/);
});

test("tout le code du canari est sous « #if POD_RENDER_V1 && POD_CANARY » ; chaînes du sketch en flash (F / PSTR)", () => {
  const src = read(INO), prod = stripLine(src.replace(CANARY_RE, ""));
  assert.doesNotMatch(prod, /canary[A-Z]\w*\(|PodCanary|g_pc\w+|PCP_|\[CANARY\]|PCR_MAGIC/, "du code de canari existe hors des blocs gardés");
  const code = stripLine([...src.matchAll(CANARY_RE)].map((m) => m[0]).join("\n"));
  assert.doesNotMatch(code, /Serial\.(?:print|println)\(\s*"/, "Serial.print(\"…\") en RAM");
  assert.doesNotMatch(code, /Serial\.printf\(/, "Serial.printf (format en RAM) : utiliser printf_P(PSTR())");
  assert.ok((code.match(/printf_P\(PSTR\(/g) ?? []).length >= 8);
  assert.doesNotMatch(code, /httpPost|httpGet|HTTPClient|WiFiClientSecure|Ed25519|signED25519|validation-result|set_new_handler|operator\s+new/);
  assert.doesNotMatch(code, /^\s*static\s+String\b/m);
});

test("R4/WiFiS3 non copié dans le firmware ESP8266 2,7″", () => {
  const dir = path.join(root, DIR);
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(ino|h|cpp)$/.test(f)) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), "utf8"), /PodBoundedSSL|pod_ssl_bounded|podNetStack|podNetRun|podWifiRun|podWorkRun|PodEd\b|_SSLCLIENTRECEIVE|podLinkerAddr|WiFiSSLClient/, f);
  }
});

test("canari : aucun vote — doValidate et doObsConfirm retournent avant tout réseau ; aucune route nouvelle", () => {
  const src = read(INO), before = readBk(`esp_eink_2.7BW_OLED.ino`);
  const routes = (s: string) => [...stripLine(s).matchAll(/"(\/api\/[a-z-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(routes(src), routes(before), "le canari n'ajoute aucune route");
  for (const header of ["bool doValidate() {", "bool doObsConfirm() {"]) {
    const fn = fnAtColumn0(src, header);
    const reach = fn.slice(0, fn.indexOf("#endif\n"));
    assert.match(reach, /^bool \w+\(\) \{\n#if POD_RENDER_V1 && POD_CANARY\n/, `${header} : retour anticipé en tête`);
    assert.doesNotMatch(stripLine(reach), /httpGet|httpPost|doValidateV2|doRegister|signED25519|Ed25519|malloc|free\(|validation-result/);
    assert.match(reach, /return (true|false);/);
  }
  assert.match(fnAtColumn0(src, "bool doValidate() {"), /AUCUN vote en build canari/);
});

test("canari : l'ACK décide du succès — pré-vol, ACK, PUIS état acquitté ; aucune marque acquittée avant l'ACK", () => {
  const src = read(INO);
  const body = between(src, "  // LOT8B2C-27 : en canari le RÉSULTAT de l'ACK décide du succès.", "  return true;\n#endif");
  const i = body.indexOf("canaryTlsPreflight(PCP_ACK"), j = body.indexOf("ackFrame(frameId, SCREEN_E27)"), k = body.indexOf("lastFrameIdE27        = frameId;"), d = body.indexOf("canaryStep(PCP_DONE");
  const bz = body.indexOf("g_pcBusyTimeouts > 0 || g_pcBusyMaxMs > POD_CANARY_BUSY_ALERT_MS");
  assert.ok(bz > 0 && bz < i && i < j && j < k && k < d, "ordre : refus BUSY, pré-vol, ACK, état acquitté, TERMINE");
  assert.match(body.slice(bz, i), /return false;/, "BUSY anormal : retour false avant tout pré-vol / ACK");
  assert.match(src, /g_pcBusyCalls = g_pcBusyTotalMs = g_pcBusyMaxMs = g_pcBusyTimeouts = 0;/, "compteurs BUSY remis à zéro avant le rendu de cette frame");
  assert.match(src, /canaryClen != \(int\)E27_BUF_SIZE \|\| canarySurplus > 0/, "Content-Length exact exigé (−1 refusé)");
  assert.doesNotMatch(src, /canaryClen >= 0/);
  assert.equal((src.match(/canaryStep\(PCP_DONE/g) ?? []).length, 1);
  assert.match(body, /if \(!ackFrame\(frameId, SCREEN_E27\)\) \{[\s\S]*?return false;/);
  assert.doesNotMatch(body.slice(0, k), /lastFrameIdE27\s*=/, "rien n'est marqué acquitté avant l'ACK");
});

test("OLED : le code OLED/bus de production n'est pas touché (ensureOLEDReady, activateSPI, tickerStep, onboarding identiques au firmware d'avant)", () => {
  const now = trimEnds(read(INO).replace(CANARY_RE, "")), before = readBk(`esp_eink_2.7BW_OLED.ino`);
  for (const [a, b] of [["void activateSPI() {", "// ─── FONT 5×7"], ["// ─── OLED ──────", "void displayKeyMaterialOnce() {"]] as const)
    assert.equal(between(now, a, b).replace(/#ifndef POD_CANARY[\s\S]*?#endif\n/, ""), between(before, a, b));
});

test("seuils du pré-vol BearSSL : iobuf 16 384 + 512 + pile de poussée 6 200", () => {
  const s = read(INO);
  assert.match(s, /#define POD_CANARY_TLS_MIN_HEAP  24000UL/);
  assert.match(s, /#define POD_CANARY_TLS_MIN_BLOCK 17000UL/);
  assert.ok(16384 + 512 + 6200 === 23096 && 24000 >= 23096 + 900);
});

test("pilote : BUSY de production inchangé (illimité) ; en canari plafond de 20 s mesuré", () => {
  const s = read(DRV);
  assert.match(s, /#define POD_CANARY_BUSY_CEIL_MS 20000UL/);
  assert.equal(trimEnds(s.replace(CANARY_RE, "")), readBk(`epd2in7_V2.cpp`));
});

// ── 2. exécution hôte ────────────────────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[esp8266Eink27OledCanary] ${describeChoice(choice)}`);
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : false;
const skipVote = skipHost || (!ajDir ? "ArduinoJson introuvable (ARDUINOJSON_DIR) — harnais de vote IGNORÉ" : false);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "esp27-"));

type Mut = (name: string, s: string) => string;
function extractAll(mut?: Mut): Record<string, string> {
  const ino = read(INO), drv = read(DRV);
  const m = mut ?? ((_n: string, s: string) => s);
  return {
    "esp27_cfg.inc": m("cfg", between(ino, "#define SERVER_URL", "// ─── EEPROM helpers")),
    "esp27_bus.inc": m("bus", between(ino, "void activateSPI() {", "// ─── FONT 5×7")),
    "esp27_ack.inc": m("ack", fnAtColumn0(ino, "bool ackFrame(const String& frameId, const char* screen) {")),
    "esp27_display.inc": m("display", between(ino, "// ─── OLED ──────", "void displayKeyMaterialOnce() {")),
    "esp27_fetch.inc": m("fetch", between(ino, "extern podanimesp::State g_anim;", "// ─── BANC D'ESSAI D'ANIMATION SUR L'OLED")),
    "esp27_pull.inc": m("pull", fnAtColumn0(ino, "bool doPull() {")),
    "esp27_vote.inc": m("vote", fnAtColumn0(ino, "bool doObsConfirm() {") + "\n" + fnAtColumn0(ino, "bool doValidate() {")),
    "esp27_driver.inc": m("driver", between(drv, "#if POD_RENDER_V1 && POD_CANARY\n// LOT8B2C-27 : compteurs", "/**\n *  @brief: module reset") + "\n" + between(drv, "// POD_RENDER_V1_BEGIN\nbool Epd::DisplayStream", "// POD_RENDER_V1_END")),
  };
}
function build(v1: number, canary: number, vote: boolean, mut?: Mut): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  for (const [f, t] of Object.entries(extractAll(mut))) fs.writeFileSync(path.join(dir, f), t);
  const out = path.join(dir, "harness");
  const args = ["-std=c++17", "-O1", "-w", `-DPOD_RENDER_V1=${v1}`, `-DPOD_CANARY=${canary}`, ...(vote ? ["-DHARNESS_VOTE=1", "-isystem", ajDir!, "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0"] : []),
    `-I${dir}`, `-I${path.join(root, "consensus-pod", "host", "esp_mock")}`, `-I${path.join(root, DIR)}`, path.join(root, "consensus-pod", "host", "esp27_frame_harness.cpp"), "-o", out];
  const r = runProcess(choice.path!, args, 180000);
  assert.equal(r.status, 0, `compilation du harnais impossible\n${r.stderr.slice(-2500)}`);
  return out;
}
function run(exe: string): { status: number | null; out: string } { const r = runProcess(exe, [], 120000); return { status: r.status, out: r.stdout + r.stderr }; }

const CONFIGS: [string, number, number][] = [["OFF", 0, 0], ["ON (POD_RENDER_V1=1, canari éteint)", 1, 0], ["CANARI (1/1)", 1, 1]];
for (const [name, v1, can] of CONFIGS) {
  test(`HÔTE ${name} : code réel — nominal (flash et RAM), fragmentation, tronqué, trop long, allocation, TLS, ACK refusé, panneau, bus/OLED, BUSY, fuites`, { skip: skipHost }, () => {
    const r = run(build(v1, can, false));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out.trim(), /^PASS \d+$/);
  });
  test(`HÔTE ${name} avec chemin de vote : canari = aucun vote, production inchangée`, { skip: skipVote }, () => {
    const r = run(build(v1, can, true));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out.trim(), /^PASS \d+$/);
  });
}

// ── 3. contrôles négatifs ─────────────────────────────────────────────────────────────────────────────────────────────────
const MUTANTS: [string, number, number, boolean, string, string, string][] = [
  // [nom, v1, canary, vote, fragment, motif, remplacement]
  ["ACK avant le rendu", 1, 1, false, "fetch", "  if (podRenderAndShowE27(e27Buf) != 2) {", "  ackFrame(frameId, SCREEN_E27);\n  if (podRenderAndShowE27(e27Buf) != 2) {"],
  ["ACK malgré échec du rendu", 1, 1, false, "fetch", "if (podRenderAndShowE27(e27Buf) != 2) {", "if (podRenderAndShowE27(e27Buf) == 99) {"],
  ["garde Content-Length / surplus supprimée (canari)", 1, 1, false, "fetch", "if (canaryClen != (int)E27_BUF_SIZE || canarySurplus > 0) {", "if (false) {"],
  ["refus du corps inattendu sans effet (bRead conservé)", 1, 1, false, "fetch", "        bRead = 0;   // retombe", "        // retombe"],
  ["pré-vol TLS avant téléchargement supprimé", 1, 1, false, "fetch", "if (!canaryTlsPreflight(PCP_PLANE_DEST,", "if (false && !canaryTlsPreflight(PCP_PLANE_DEST,"],
  ["BUSY plafonné/long : le refus avant l'ACK est supprimé", 1, 1, false, "fetch", "if (g_pcBusyTimeouts > 0 || g_pcBusyMaxMs > POD_CANARY_BUSY_ALERT_MS) {", "if (false) {"],
  ["BUSY : seul le plafonnement refuse (un BUSY long non plafonné passe)", 1, 1, false, "fetch", "if (g_pcBusyTimeouts > 0 || g_pcBusyMaxMs > POD_CANARY_BUSY_ALERT_MS) {", "if (g_pcBusyTimeouts > 0) {"],
  ["BUSY : compteurs non remis à zéro avant le rendu", 1, 1, false, "fetch", "  g_pcBusyCalls = g_pcBusyTotalMs = g_pcBusyMaxMs = g_pcBusyTimeouts = 0;", "  ;"],
  ["Content-Length −1 accepté (canari)", 1, 1, false, "fetch", "if (canaryClen != (int)E27_BUF_SIZE || canarySurplus > 0) {", "if ((canaryClen >= 0 && canaryClen != (int)E27_BUF_SIZE) || canarySurplus > 0) {"],
  ["ACK : pré-vol supprimé", 1, 1, false, "fetch", "if (!canaryTlsPreflight(PCP_ACK,", "if (false && !canaryTlsPreflight(PCP_ACK,"],
  ["ACK : résultat ignoré", 1, 1, false, "fetch", "if (!ackFrame(frameId, SCREEN_E27)) {", "if (ackFrame(frameId, SCREEN_E27) && false) {"],
  ["ACK : frame marquée acquittée avant l'ACK", 1, 1, false, "fetch", "  hasDisplayedFrame = true;\n  if (g_pcBusyTimeouts > 0 ||", "  hasDisplayedFrame = true; lastFrameIdE27 = frameId;\n  if (g_pcBusyTimeouts > 0 ||"],
  ["plan non libéré après le rendu", 1, 0, false, "fetch", "  free(e27Buf);                                        // libéré AVANT l'ACK", "  // plan conservé"],
  ["vote autorisé en canari", 1, 1, true, "vote", "AUCUN vote en build canari", "VOTE AUTORISE"],
  ["vote : ni oubli ni retour anticipé en canari (le vote s'exécute)", 1, 1, true, "vote", "    pendingCandidateId = \"\";\n  }\n  return false;\n#endif", "  }\n#endif"],
  ["vote : candidat non oublié en canari", 1, 1, true, "vote", "    pendingCandidateId = \"\";\n  }\n  return false;\n#endif", "  }\n  return false;\n#endif"],
  ["pull : banc d'essai/animation non neutralisés en canari", 1, 1, true, "pull", "newBenchMode = false; newAnimHash = \"\"; newAnimBytes = 0;", ""],
  ["producteur sans yield (pilote)", 1, 0, false, "driver", "yield();", ""],
  ["producteur > 32 octets (pilote)", 1, 0, false, "driver", "unsigned char chunk[32];", "unsigned char chunk[64];"],
  ["BUSY : plafond du canari supprimé", 1, 1, false, "driver", "if (millis() - t0 > POD_CANARY_BUSY_CEIL_MS)", "if (false)"],
  ["abandon du canari sur 2 resets anormaux supprimé", 1, 1, false, "cfg", "if (g_pcRtc.abn >= 2) {", "if (false) {"],
  ["OLED non ré-initialisé après l'e-ink (oledReady reste vrai)", 1, 0, false, "fetch", "  oledReady = false;         // GPIO12", "  // GPIO12"],
  ["sonde OLED du canari retirée", 1, 1, false, "cfg", "static void canaryOledProbe() {\n", "static void canaryOledProbe() { return;\n"],
  ["SPI non terminé après le panneau", 1, 0, false, "display", "  SPI.end();\n", "  \n"],
];
for (const [name, v1, can, vote, frag, from, to] of MUTANTS) {
  test(`CONTRÔLE NÉGATIF : « ${name} » est REFUSÉ par le harnais`, { skip: vote ? skipVote : skipHost }, () => {
    let applied = false;
    const exe = build(v1, can, vote, (n, s) => {
      if (n !== frag) return s;
      assert.ok(s.includes(from), `mutation « ${name} » : motif introuvable dans ${frag}`);
      applied = true;
      return s.split(from).join(to);
    });
    assert.ok(applied);
    const r = run(exe);
    assert.ok(r.status !== 0 || !/^PASS \d+$/.test(r.out.trim()), `mutation « ${name} » NON détectée`);
  });
}
