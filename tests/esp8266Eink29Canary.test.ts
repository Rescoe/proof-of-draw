import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// LOT8B2C-ESP8266-EINK29-CANARY-1 — canari de l'ESP8266 e-ink 2,9″ BWR (rendu v1, frame personnelle, AUCUN vote).
// (1) règles statiques : drapeaux 0/0 au dépôt, OFF == firmware d'avant au texte près, tout le canari sous « #if POD_RENDER_V1 && POD_CANARY », rien de R4/WiFiS3 copié ;
// (2) exécution HÔTE du CODE RÉEL (fragments extraits de l'.ino et du pilote) contre un environnement ESP8266 simulé (consensus-pod/host/esp_mock) en trois configurations : OFF, ON, CANARI ;
// (3) contrôles négatifs : chaque garde supprimée est REFUSÉE par le harnais.
// Rien ici n'est une mesure sur carte : BearSSL réel, tas réel, durées réelles et chien de garde matériel restent à observer (docs/LOT_8B2C_ESP8266_EINK29_CANARY_2026_10_12.md).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino";
const DRV = "esp8266/esp_eink_2.9BWR/epd2in9b_V4.cpp";
const BACKUP = "firmware-backups/2026-10-12_avant-canari-esp8266-eink29/esp_eink_2.9BWR.ino";
const CANARY_RE = /#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g;
const stripLine = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str?: string) => str ?? "");

function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  assert.ok(i >= 0 && j > i, `région introuvable : ${a} … ${b}`);
  return src.slice(i, j);
}
function fnAtColumn0(src: string, header: string): string {   // du en-tête à la première ligne « } » seule (les fonctions extraites n'ont pas d'accolade fermante à la colonne 0 avant leur fin)
  const i = src.indexOf("\n" + header + "\n") + 1;
  assert.ok(i > 0, `fonction introuvable : ${header}`);
  const j = src.indexOf("\n}\n", i);
  return src.slice(i, j + 3);
}

// ── 1. règles statiques ───────────────────────────────────────────────────────────────────────────────────────────────
test("dépôt : POD_RENDER_V1 = 0 et POD_CANARY = 0 ; aucun drapeau à 1", () => {
  const s = read(INO);
  assert.match(s, /#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0\n#endif/);
  assert.match(s, /#ifndef POD_CANARY\n#define POD_CANARY 0 /);
  assert.equal((s.match(/#define POD_CANARY\b/g) ?? []).length, 1);
  assert.doesNotMatch(s, /#define POD_(RENDER_V1|CANARY) 1\b/);
});

test("OFF : retirer les blocs de canari et le drapeau redonne le firmware d'avant AU TEXTE PRÈS (aucun octet de production n'a bougé)", () => {
  const now = read(INO), before = read(BACKUP);
  const s = now.replace(CANARY_RE, "").replace(/#ifndef POD_CANARY\n#define POD_CANARY 0 [^\n]*\n#endif\n/, "");
  assert.equal(s, before);
});

test("tout le code du canari est sous « #if POD_RENDER_V1 && POD_CANARY » ; aucune fonction canari en production ; chaînes en flash (F / PSTR)", () => {
  const src = read(INO), prod = stripLine(src.replace(CANARY_RE, ""));
  assert.doesNotMatch(prod, /canary[A-Z]\w*\(|PodCanary|g_pc\w+|PCP_|\[CANARY\]|PCR_MAGIC/, "du code de canari existe hors des blocs gardés");
  const blocks = [...src.matchAll(CANARY_RE)].map((m) => m[0]).join("\n");
  const code = stripLine(blocks);
  // aucun littéral destiné au port série en RAM : Serial.print/println/printf avec un littéral NU (sans F()/PSTR())
  assert.doesNotMatch(code, /Serial\.(?:print|println)\(\s*"/, "Serial.print(\"…\") en RAM");
  assert.doesNotMatch(code, /Serial\.printf\(/, "Serial.printf (format en RAM) : utiliser printf_P(PSTR())");
  assert.ok((code.match(/printf_P\(PSTR\(/g) ?? []).length >= 8);
  // pas de réseau ni de vote dans le canari ; pas de new_handler ; pas de String globale
  assert.doesNotMatch(code, /httpPost|httpGet|HTTPClient|WiFiClientSecure|Ed25519|signED25519|validation-result|set_new_handler|operator\s+new/);
  assert.doesNotMatch(code, /^\s*static\s+String\b/m);
});

test("R4/WiFiS3 non copié : ni PodBoundedSSL, ni podNetStack, ni podWifiRun, ni podWorkRun, ni trampoline, ni _SSLCLIENTRECEIVE dans le firmware ESP8266", () => {
  const dir = path.join(root, "esp8266", "esp_eink_2.9BWR");
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(ino|h|cpp)$/.test(f)) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), "utf8"), /PodBoundedSSL|pod_ssl_bounded|podNetStack|podNetRun|podWifiRun|podWorkRun|PodEd\b|_SSLCLIENTRECEIVE|podLinkerAddr|WiFiSSLClient/, f);
  }
  for (const f of ["pod_ssl_bounded.h", "podNetStack.h", "podEdStack.h"]) assert.ok(!fs.existsSync(path.join(dir, f)), f);
});

test("canari : aucun vote — doValidate et doObsConfirm retournent avant tout réseau ; aucune route nouvelle ; routes de production inchangées", () => {
  const src = read(INO), before = read(BACKUP);
  const routes = (s: string) => [...stripLine(s).matchAll(/"(\/api\/[a-z-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(routes(src.replace(CANARY_RE, "")), routes(before), "routes de production inchangées");
  assert.deepEqual(routes(src), routes(before), "le canari n'ajoute aucune route");
  const vote = fnAtColumn0(src, "bool doValidate() {");
  const view = vote.replace(/^#if POD_RENDER_V1 && POD_CANARY\n/gm, "").replace(/^#endif\n/gm, "");
  const reach = view.slice(0, view.indexOf("return true;") + "return true;".length);
  assert.doesNotMatch(stripLine(reach), /httpGet|httpPost|doValidateV2|doRegister|signED25519|Ed25519|malloc|free\(|validation-result/);
  assert.match(reach, /AUCUN vote en build canari/);
});

test("pas d'accélération du polling : doPull retourne true après un échec de doFetchFrame (nouvel essai à PULL_INTERVAL) ; intervalles inchangés", () => {
  const s = read(INO);
  assert.match(s, /bool fetchOk = doFetchFrame\(newFrameId, newFrameSource\);[\s\S]*?if \(!fetchOk\) \{[\s\S]*?prochaine tentative dans 60s[\s\S]*?\}\s*return true;/);
  assert.match(s, /#define PULL_INTERVAL   60000UL/);
  assert.equal(s.split("nextPullIntervalMs").length, read(BACKUP).split("nextPullIntervalMs").length);
});

test("modèle mémoire documenté dans le code : BearSSL iobuf 16 384 + 512, pile de poussée 6 200 — les seuils du pré-vol en découlent", () => {
  const s = read(INO);
  assert.match(s, /#define POD_CANARY_TLS_MIN_HEAP  24000UL/);
  assert.match(s, /#define POD_CANARY_TLS_MIN_BLOCK 17000UL/);
  assert.ok(16384 + 512 + 6200 === 23096 && 24000 >= 23096 + 900);
});

// ── 2. exécution hôte ───────────────────────────────────────────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[esp8266Eink29Canary] ${describeChoice(choice)}`);
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : false;
const skipVote = skipHost || (!ajDir ? "ArduinoJson introuvable (ARDUINOJSON_DIR) — harnais de vote IGNORÉ" : false);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "esp29-"));

type Mut = (name: string, s: string) => string;
function extractAll(mut?: Mut): Record<string, string> {
  const ino = read(INO), drv = read(DRV);
  const m = mut ?? ((_n: string, s: string) => s);
  return {
    "esp_cfg.inc": m("cfg", between(ino, "#define SERVER_URL", "// ─── EEPROM layout")),
    "esp_state.inc": m("state", between(ino, "// ─── ÉCRAN ─", "// ─── EEPROM helpers")),
    "esp_display.inc": m("display", between(ino, "// ─── AFFICHAGE E-INK", "// ─── AFFICHAGE CLÉ PUBLIQUE")),
    "esp_ack.inc": m("ack", fnAtColumn0(ino, "bool ackFrame(const String& frameId) {")),
    "esp_fetch.inc": m("fetch", between(ino, "// ─── DEBUG HEAP", "// ─── PULL LÉGER")),
    "esp_vote.inc": m("vote", fnAtColumn0(ino, "bool doObsConfirm() {") + "\n" + fnAtColumn0(ino, "bool doValidate() {")),
    "esp_driver.inc": m("driver", between(drv, "// POD_RENDER_V1_BEGIN\nbool Epd::DisplayStream", "// POD_RENDER_V1_END")),
  };
}
const exeCache = new Map<string, string>();
function build(label: string, v1: number, canary: number, vote: boolean, mut?: Mut): string {
  const key = `${label}-${v1}-${canary}-${vote}`;
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  for (const [f, t] of Object.entries(extractAll(mut))) fs.writeFileSync(path.join(dir, f), t);
  const out = path.join(dir, "harness");
  const args = ["-std=c++17", "-O1", "-w", `-DPOD_RENDER_V1=${v1}`, `-DPOD_CANARY=${canary}`, ...(vote ? ["-DHARNESS_VOTE=1", "-isystem", ajDir!, "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0"] : []),
    `-I${dir}`, `-I${path.join(root, "consensus-pod", "host", "esp_mock")}`, `-I${path.join(root, "esp8266", "esp_eink_2.9BWR")}`, path.join(root, "consensus-pod", "host", "esp_frame_harness.cpp"), "-o", out];
  const r = runProcess(choice.path!, args, 180000);
  assert.equal(r.status, 0, `compilation du harnais (${key}) impossible\n${r.stderr.slice(-2500)}`);
  exeCache.set(key, out);
  return out;
}
function run(exe: string): { status: number | null; out: string } { const r = runProcess(exe, [], 120000); return { status: r.status, out: r.stdout + r.stderr }; }

const CONFIGS: [string, number, number][] = [["OFF", 0, 0], ["ON (POD_RENDER_V1=1, canari éteint)", 1, 0], ["CANARI (1/1)", 1, 1]];
for (const [name, v1, can] of CONFIGS) {
  test(`HÔTE ${name} : code réel de doFetchFrame / rendu / pilote — nominal, fragmentation, tronqué, trop long, allocation, TLS fermé avant rendu, ACK après succès, échecs fermés`, { skip: skipHost }, () => {
    const r = run(build("frame", v1, can, false));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out.trim(), /^PASS \d+$/);
  });
}
test("HÔTE CANARI : vote interdit (doValidate / doObsConfirm) ; production : chemin de vote inchangé (OFF, ON)", { skip: skipVote }, () => {
  for (const [, v1, can] of CONFIGS) { const r = run(build("vote", v1, can, true)); assert.equal(r.status, 0, r.out); assert.match(r.out.trim(), /^PASS \d+$/); }
});

// ── 3. contrôles négatifs : le harnais REFUSE chaque garde supprimée ────────────────────────────────────────────────────────
const MUTANTS: [string, number, number, boolean, string, string, string][] = [
  // [nom, v1, canary, vote, fragment ciblé, motif, remplacement]
  ["ACK avant le rendu", 1, 1, false, "fetch", "ackFrame(frameId);\n", "ackFrame(frameId);\n"],   // remplacé ci-dessous (déplacement)
  ["rendu pendant TLS (client détruit trop tard)", 1, 0, false, "fetch", "    http.end();\n\n    Serial.printf(\"[FETCHFRAME] lu black", "    http.end();\n    if (podRenderAndShow() != 2) return false;\n\n    Serial.printf(\"[FETCHFRAME] lu black"],
  ["plans non libérés sur lecture incomplète", 1, 1, false, "fetch", "    if (bRead != BUF_SIZE || rRead != BUF_SIZE) {\n      Serial.println(\"[FETCHFRAME] lecture incomplète\");\n      free(blackBuf); blackBuf = nullptr;\n      free(redBuf);   redBuf   = nullptr;\n      return false;", "    if (bRead != BUF_SIZE || rRead != BUF_SIZE) {\n      Serial.println(\"[FETCHFRAME] lecture incomplète\");\n      return false;"],
  ["ACK malgré lecture incomplète", 1, 1, false, "fetch", "    if (bRead != BUF_SIZE || rRead != BUF_SIZE) {", "    if (false) {"],
  ["ACK malgré échec du rendu", 1, 1, false, "fetch", "  if (podRenderAndShow() != 2) {", "  if (podRenderAndShow() == 99) {"],
  ["garde Content-Length / surplus supprimée (canari)", 1, 1, false, "fetch", "if ((canaryClen >= 0 && canaryClen != (int)(2 * BUF_SIZE)) || canarySurplus > 0) {", "if (false) {"],
  ["pré-vol TLS supprimé (canari)", 1, 1, false, "fetch", "if (!canaryTlsPreflight()) {", "if (false) {"],
  ["plan rouge non libéré si le second malloc échoue", 1, 0, false, "fetch", "    free(blackBuf); blackBuf = nullptr;\n    free(redBuf);   redBuf   = nullptr;\n    return false;\n  }\n  memset(blackBuf", "    return false;\n  }\n  memset(blackBuf"],
  ["vote autorisé en canari", 1, 1, true, "vote", "AUCUN vote en build canari", "VOTE AUTORISE"],
  ["vote : candidat non oublié en canari", 1, 1, true, "vote", "    pendingCandidateId = \"\";\n  }\n  return true;\n#endif", "  }\n  return true;\n#endif"],
  ["vote : ni oubli ni retour anticipé en canari (le vote s'exécute)", 1, 1, true, "vote", "    pendingCandidateId = \"\";\n  }\n  return true;\n#endif", "  }\n#endif"],
  ["producteur sans yield (pilote)", 1, 0, false, "driver", "yield();", ""],
  ["producteur > 32 octets (pilote)", 1, 0, false, "driver", "unsigned char chunk[32];", "unsigned char chunk[64];"],
  ["abandon du canari sur 2 resets anormaux supprimé", 1, 1, false, "state", "if (g_pcRtc.abn >= 2) {", "if (false) {"],
  ["arrêt sûr : phase RTC non écrite", 1, 1, false, "state", "ESP.rtcUserMemoryWrite(0, (uint32_t*)&g_pcRtc, sizeof(g_pcRtc));\n  const uint32_t now", "const uint32_t now"],
];
for (const [name, v1, can, vote, frag, from, to] of MUTANTS) {
  test(`CONTRÔLE NÉGATIF : « ${name} » est REFUSÉ par le harnais`, { skip: vote ? skipVote : skipHost }, () => {
    let replacement = to;
    let target = from;
    if (name === "ACK avant le rendu") {
      // déplace l'ACK avant le rendu : l'ordre ACK/panneau doit être détecté
      target = "#if POD_RENDER_V1\n  // ── Rendu v1 en flux";
      replacement = "  ackFrame(frameId);\n#if POD_RENDER_V1\n  // ── Rendu v1 en flux";
    }
    let applied = false;
    const exe = build("mut", v1, can, vote, (n, s) => {
      if (n !== frag) return s;
      assert.ok(s.includes(target), `mutation « ${name} » : motif introuvable dans ${frag}`);
      applied = true;
      return s.split(target).join(replacement);
    });
    assert.ok(applied);
    const r = run(exe);
    assert.ok(r.status !== 0 || !/^PASS \d+$/.test(r.out.trim()), `mutation « ${name} » NON détectée`);
  });
}
