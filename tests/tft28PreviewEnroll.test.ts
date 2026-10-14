// tests/tft28PreviewEnroll.test.ts — LOT TFT28-PREVIEW-ENROLL-1 : build d'APPAIRAGE Preview du UNO R4 + TFT 2,8″ (POD_PREVIEW_ENROLL), HÔTE seulement.
// Garantie visée : Wi-Fi puis /api/register UNIQUEMENT ; journal série du deviceId et du pairCode ; arrêt définitif AVANT tout pull ; AUCUN écran / tactile / carte SD ; aucune route de pull, de candidat, de vote ou d'ACK atteignable.
//   1. production inchangée : POD_PREVIEW_ENROLL = 0 par défaut, jamais commité à 1, hôte local ignoré par git, texte du sketch (vue « drapeaux à 0 ») IDENTIQUE à V3-FIX1 ;
//   2. règles statiques (garde-fous de compilation, refus de la production) et PORTÉE : tout ce qui est atteignable depuis setup() et loop() ;
//   3. scénarios dynamiques sur le VRAI setup() + loop() : non appairé, déjà appairé, register en échec (HTTP 500, jamais de réponse), production refusée ;
//   4. mutants : chaque protection supprimée est REFUSÉE.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { ROOT, readText, voteCanaryOffView } from "./helpers/tft28Source";
import { ownTmp } from "./helpers/ownTmp";
import { reachFrom } from "./helpers/voteCanaryReach";

const choice = findCompiler();
console.log(`[tft28PreviewEnroll] ${describeChoice(choice)}`);
const cryptoCandidates = [process.env.POD_CRYPTO_SRC, path.join(os.homedir(), "Documents", "Arduino", "libraries", "Crypto", "src"), path.join(os.homedir(), "Arduino", "libraries", "Crypto", "src")].filter((x): x is string => !!x);
const cryptoSrc = cryptoCandidates.find((d) => fs.existsSync(path.join(d, "Ed25519.cpp")));
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const fwd = (p: string) => p.replace(/\\/g, "/");
const SK = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4"), HOST = path.join(ROOT, "consensus-pod", "host"), MOCK = path.join(HOST, "tft28");
const INO = "arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino";
const INO_SRC = readText(INO);
const tmp = ownTmp("tft28en-");   // supprimé à la sortie du processus (tests/helpers/ownTmp.ts)
const PREVIEW_HOST = "iso-preview.example.test";

let libObjs: string[] | null = null;
function ensureLib(): string[] {
  if (libObjs) return libObjs;
  libObjs = [];
  for (const n of ["Ed25519", "Curve25519", "BigNumberUtil", "SHA512", "SHA256", "Hash", "Crypto"]) {
    const o = path.join(tmp, `${n}.o`);
    const r = runProcess(choice.path!, ["-std=c++11", "-O2", "-w", "-c", `-I${cryptoSrc}`, path.join(cryptoSrc!, `${n}.cpp`), "-o", o]);
    assert.equal(r.status, 0, `compilation de la bibliothèque Crypto (${n}) : ${r.stderr}`);
    libObjs.push(o);
  }
  return libObjs;
}

let nBuild = 0;
const exeCache = new Map<string, string>();
/** Compile le sketch COMPLET avec POD_PREVIEW_ENROLL = 1 et le fichier d'hôte LOCAL `pod_preview_host.h` contre le harnais d'hôte. `ino` peut être muté. */
function build(ino: string = INO_SRC, host = PREVIEW_HOST): string {
  const key = `${createHash("sha1").update(ino).digest("hex")}|${host}`;
  const hit = exeCache.get(key); if (hit) return hit;
  const dir = path.join(tmp, `en-${nBuild++}`), sk = path.join(dir, "sk"); fs.mkdirSync(sk, { recursive: true });
  for (const f of ["podEdStack.h", "podNetStack.h", "pod_http.h", "pod_bench.h", "pod_bench_stream.h", "pod_metrics.h", "pod_metrics_table.h", "pod_vote_r4.h"]) fs.copyFileSync(path.join(SK, f), path.join(sk, f));
  fs.writeFileSync(path.join(sk, "pod_sd_stack.h"), fs.readFileSync(path.join(SK, "pod_sd_stack.h"), "utf8").replace("static bool onSd(const char* what, F& f) {", "static bool onSd(const char* what, F& f) { ++g_hwOnSd;"));
  fs.copyFileSync(path.join(MOCK, "pod_ssl_bounded.h"), path.join(sk, "pod_ssl_bounded.h"));
  fs.writeFileSync(path.join(sk, "pod_preview_host.h"), `#define POD_PREVIEW_HOST "${host}"\n`);
  fs.writeFileSync(path.join(sk, "sketch_body.inc"), ino);
  const exe = path.join(dir, "eh");
  compileHarness(choice.path!, fwd(path.join(HOST, "tft28_enroll_harness.cpp")), fwd(exe), [
    "-std=gnu++17", "-O1", "-w", "-fno-strict-aliasing", "-DPOD_CANARY=0", "-DPOD_RENDER_V1=0", "-DPOD_HOST_REAL_CRYPTO=1", "-DPOD_PREVIEW_ENROLL=1",
    `-I${fwd(sk)}`, `-I${fwd(cryptoSrc!)}`, `-I${fwd(MOCK)}`, "-isystem", fwd(ajDir!),
    "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0", ...ensureLib().map(fwd)]);
  const out = exe + (process.platform === "win32" ? ".exe" : "");
  exeCache.set(key, out);
  return out;
}

interface Result { facts: Record<string, string>; logs: string[]; reqs: string[] }
const memo = new Map<string, Result>();
function run(exe: string, sc: string): Result {
  const key = `${exe}|${sc}`; const hit = memo.get(key); if (hit) return hit;
  const r = runProcess(fwd(exe), [sc], 120000);
  assert.equal(r.status, 0, `scénario ${sc} : sortie ${r.status}\n${(r.stdout || "").slice(-1200)}${r.stderr || ""}`);
  const facts: Record<string, string> = {}, logs: string[] = [], reqs: string[] = [];
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    if (line.startsWith("FACT ")) { const k = line.slice(5, line.indexOf("=")); facts[k] = line.slice(line.indexOf("=") + 1); }
    else if (line.startsWith("LOG ")) logs.push(line.slice(4));
    else if (line.startsWith("REQ ")) reqs.push(line.slice(4));
  }
  const res = { facts, logs, reqs }; memo.set(key, res); return res;
}
const n = (r: Result, k: string) => Number(r.facts[k]);
const logHas = (r: Result, s: string) => r.logs.some((l) => l.includes(s));

/** Aucun accès matériel (écran, tactile, carte SD, onSd), aucune requête hors /api/register. */
function noHardwareNoOtherRoute(tag: string, r: Result): string[] {
  const v: string[] = [];
  for (const k of ["hw_tft", "hw_touch", "hw_sd", "hw_onsd", "tft_bus", "tft_fills", "tft_texts", "tft_windows", "touch_polls", "sd_opens", "sd_writes", "sd_reads", "sd_removes"]) if (n(r, k) !== 0) v.push(`${tag} : ${k} = ${r.facts[k]} (attendu 0)`);
  for (const k of ["pulls", "validates", "reads", "posts", "acks", "pullframes", "clips", "obs", "bench"]) if (n(r, k) !== 0) v.push(`${tag} : requêtes ${k} = ${r.facts[k]} (attendu 0)`);
  if (r.reqs.some((p) => !p.startsWith("/api/register"))) v.push(`${tag} : requête hors /api/register : ${r.reqs.filter((p) => !p.startsWith("/api/register")).join(", ")}`);
  if (n(r, "lock_blank") !== 1) v.push(`${tag} : le verrou de vote (octets 5120 – 7167) a été touché`);
  if (n(r, "eeprom_puts") !== 0) v.push(`${tag} : écriture EEPROM inattendue`);
  if (logHas(r, "[BOOT] pr") || logHas(r, "premier pull")) v.push(`${tag} : faux « [BOOT] prêt » / « premier pull »`);
  if (r.logs.some((l) => l.includes("[VOTE") || l.includes("[VALIDATE") || l.includes("[PULL") || l.includes("[FRAME") || l.includes("[ACK") || l.includes("[TOUCH") || l.includes("[SD"))) v.push(`${tag} : ligne de journal de vote / pull / affichage / ACK / SD`);
  return v;
}

const CHECKS: Record<string, (exe: string) => string[]> = {};
CHECKS.unpaired = (exe) => {
  const r = run(exe, "unpaired"); const v = noHardwareNoOtherRoute("unpaired", r);
  if (n(r, "registers") !== 1 || n(r, "requests_total") !== 1) v.push("unpaired : exactement UNE requête /api/register, rien d'autre (200 tours de loop() compris)");
  if (n(r, "enroll_halted") !== 1 || n(r, "paired") !== 0 || n(r, "registered") !== 1) v.push("unpaired : enregistré, non appairé, arrêt définitif");
  if (!logHas(r, "pairCode=WXYZ2345") || !logHas(r, "deviceId=dev_TEST0002") || !logHas(r, `https://${PREVIEW_HOST}/onboard?code=WXYZ2345`)) v.push("unpaired : deviceId, pairCode et lien d'appairage journalisés");
  if (!logHas(r, "ARRET DEFINITIF")) v.push("unpaired : arrêt définitif journalisé");
  if (!logHas(r, `hote ${PREVIEW_HOST}`)) v.push("unpaired : l'hôte du bandeau est celui du fichier local");
  return v;
};
CHECKS.paired = (exe) => {
  const r = run(exe, "paired"); const v = noHardwareNoOtherRoute("paired", r);
  if (n(r, "registers") !== 1 || n(r, "requests_total") !== 1) v.push("paired : exactement UNE requête /api/register");
  if (n(r, "enroll_halted") !== 1 || n(r, "paired") !== 1) v.push("paired : déjà appairé, arrêt définitif");
  if (!logHas(r, "DEJA appaire") || logHas(r, "pairCode=")) v.push("paired : confirmation journalisée, SANS pairCode");
  return v;
};
CHECKS.regfail = (exe) => {
  const r = run(exe, "regfail"); const v = noHardwareNoOtherRoute("regfail", r);
  if (n(r, "registers") !== 6 || n(r, "requests_total") !== 6) v.push("regfail : 6 essais /api/register au plus puis arrêt (limite serveur 5 / min / IP : essais espacés de 15 s)");
  if (n(r, "enroll_halted") !== 1 || n(r, "registered") !== 0) v.push("regfail : non enregistré, arrêt définitif");
  if (!logHas(r, "register impossible apres 6 essais")) v.push("regfail : cause journalisée");
  return v;
};
CHECKS.http500 = (exe) => {
  const r = run(exe, "http500"); const v = noHardwareNoOtherRoute("http500", r);
  if (n(r, "registers") !== 6 || n(r, "enroll_halted") !== 1 || n(r, "registered") !== 0) v.push("http500 : 6 essais puis arrêt définitif");
  return v;
};
CHECKS.productionRefused = (exe) => {   // hôte « PROOF-OF-DRAW.VERCEL.APP » : passe la garde de compilation (casse) mais le refus d'EXÉCUTION l'arrête avant le Wi-Fi
  const r = run(exe, "unpaired"); const v: string[] = [];
  if (n(r, "requests_total") !== 0) v.push("production : aucune requête");
  if (n(r, "enroll_halted") !== 1 || !logHas(r, "hote = PRODUCTION (refuse)")) v.push("production : refus journalisé, arrêt définitif");
  if (logHas(r, "[WIFI]")) v.push("production : aucun Wi-Fi n'a été tenté");
  for (const k of ["hw_tft", "hw_touch", "hw_sd", "hw_onsd"]) if (n(r, k) !== 0) v.push(`production : ${k} != 0`);
  return v;
};

// ── 0. pré-vol toolchain ──────────────────────────────────────────────────────────────────
test("APPAIRAGE — PRÉ-VOL : compilateur C++ >= 11, Crypto et ArduinoJson présents — sinon ÉCHEC avec la cause", () => {
  assert.ok(choice.path, `aucun compilateur C++ trouvé. ${describeChoice(choice)} — définir CXX et mettre son dossier bin dans PATH.`);
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(choice.version);
  assert.ok(m && Number(m[1]) >= 11, `compilateur INCOMPATIBLE : ${choice.version} (g++ >= 11 exigé).`);
  assert.ok(cryptoSrc, "bibliothèque Crypto 0.4.0 introuvable : définir POD_CRYPTO_SRC");
  assert.ok(ajDir, "ArduinoJson 7.x introuvable : définir ARDUINOJSON_DIR");
  assert.doesNotThrow(() => ensureLib(), `compilation de la bibliothèque Crypto IMPOSSIBLE avec ${choice.version}`);
});

// ── 1. production inchangée ───────────────────────────────────────────────────────────────
test("APPAIRAGE — PRODUCTION INCHANGÉE : drapeau à 0 (jamais commité à 1), hôte local ignoré et non suivi, texte vu avec les drapeaux à 0 IDENTIQUE à V3-FIX1", () => {
  assert.match(INO_SRC, /#ifndef POD_PREVIEW_ENROLL\n#define POD_PREVIEW_ENROLL 0\n#endif/);
  assert.doesNotMatch(INO_SRC, /^#define POD_PREVIEW_ENROLL 1/m);
  const bak = readText("firmware-backups/2026-10-13_avant-vote-v4-canary/pod_uno_r4.ino");
  assert.equal(voteCanaryOffView(INO_SRC), bak, "le texte du sketch (POD_VOTE_CANARY, POD_PREVIEW_ENROLL, POD_NOHW à 0) diffère de V3-FIX1");
  assert.ok(fs.existsSync(path.join(SK, "pod_preview_host.h.example")), "modèle de l'hôte local absent");
  const ls = spawnSync("git", ["ls-files", "--", "arduino_uno_r4"], { cwd: ROOT, encoding: "utf8" }).stdout || "";
  assert.ok(!/pod_preview_host\.h$/m.test(ls), "pod_preview_host.h SUIVI par git");
  assert.equal(spawnSync("git", ["check-ignore", "-q", "arduino_uno_r4/pod_uno_r4/pod_preview_host.h"], { cwd: ROOT }).status, 0, "pod_preview_host.h doit être ignoré par git");
  assert.match(readText(".gitignore"), /arduino_uno_r4\/\*\*\/pod_preview_host\.h/);
  const backupBackup = readText("firmware-backups/2026-10-14_avant-preview-enroll/pod_uno_r4.ino");
  assert.ok(backupBackup.length > 100000, "sauvegarde d'avant le lot absente");
});

// ── 2. règles statiques et portée ─────────────────────────────────────────────────────────
test("APPAIRAGE — garde-fous de compilation et refus de la production (statique)", () => {
  assert.match(INO_SRC, /#error "POD_PREVIEW_ENROLL exige POD_CANARY = 0, POD_VOTE_V1 = 0 et POD_VOTE_CANARY = 0/);
  assert.match(INO_SRC, /#error "POD_PREVIEW_ENROLL exige POD_PREVIEW_HOST/);
  assert.ok(INO_SRC.includes('static_assert(__builtin_strcmp(POD_PREVIEW_HOST, "proof-of-draw.vercel.app") != 0'), "garde de compilation contre la production absente");
  assert.match(INO_SRC, /if \(strcasecmp\(SERVER_HOST, "proof-of-draw\.vercel\.app"\) == 0\) \{ enrollHalt\("hote = PRODUCTION \(refuse\)"\); return; \}/);
  assert.match(INO_SRC, /#define SERVER_HOST       POD_PREVIEW_HOST /);
  assert.match(INO_SRC, /for \(int att = 0; !registered && att < 6; att\+\+\) \{ if \(doRegister\(\)\) break; delay\(15000\); \}/);
});
test("APPAIRAGE — PORTÉE : depuis setup() et loop(), AUCUNE fonction d'écran / tactile / SD / pull / candidat / vote / verrou / ACK / image n'est atteignable", () => {
  const r = reachFrom(INO_SRC, ["setup", "loop"], "enroll");
  assert.deepEqual(r.hits, [], `accès interdit atteignable : ${JSON.stringify(r.hits)}`);
  for (const must of ["setup", "loop", "doRegister", "registerExchange", "enrollReport", "enrollHalt", "registerLog", "selfTestEd25519", "wifiBegin"]) assert.ok(r.funcs.includes(must), `l'analyse n'atteint pas ${must} (analyse vide ou casse)`);
  for (const mustNot of ["doPull", "doValidate", "voteCanaryLoop", "ackFrame", "doFetchFrame", "initSD", "tftStatus", "restoreLastFrame", "serviceTouch", "netReadCandidate"]) assert.ok(!r.funcs.includes(mustNot), `${mustNot} atteignable depuis setup() / loop() dans le build d'appairage`);
});

// ── 3. scénarios dynamiques ───────────────────────────────────────────────────────────────
for (const id of ["unpaired", "paired", "regfail", "http500"]) {
  test(`APPAIRAGE — scénario « ${id} » sur le VRAI setup() + loop() : aucune violation`, () => { assert.deepEqual(CHECKS[id](build()), []); });
}
test("APPAIRAGE — hôte de production (casse différente) : REFUSÉ à l'exécution, avant le Wi-Fi, aucune requête", () => {
  assert.deepEqual(CHECKS.productionRefused(build(INO_SRC, "PROOF-OF-DRAW.VERCEL.APP")), []);
});
test("APPAIRAGE — SENSIBILITÉ des compteurs : appeler directement l'écran, le tactile et la carte SD les incrémente (sinon les zéros ne prouveraient rien)", () => {
  // Le build d'appairage du harnais ne les appelle jamais ; on compile une variante qui initialise l'écran, le tactile et la SD pour montrer que les compteurs réagissent.
  const mutated = INO_SRC.replace('  logf("[ENROLL] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  tft.begin(); ts.begin(); (void)ts.touched(); initSD();");
  assert.notEqual(mutated, INO_SRC);
  const r = run(build(mutated), "unpaired");
  assert.ok(n(r, "hw_tft") > 0 && n(r, "hw_touch") > 0 && n(r, "hw_sd") > 0, "les compteurs écran / tactile / SD doivent réagir");
});

// ── 4. mutants ────────────────────────────────────────────────────────────────────────────
const firstOnly = (src: string, from: string, to: string) => { const i = src.indexOf(from); assert.ok(i >= 0, `motif obsolète : ${from.slice(0, 90)}`); assert.equal(src.indexOf(from, i + 1), -1, `motif ambigu : ${from.slice(0, 90)}`); return src.slice(0, i) + to + src.slice(i + from.length); };
const MUTANTS: Array<[string, (i: string) => string, string[]]> = [
  ["l'arrêt définitif n'est plus posé", (i) => firstOnly(i, "enrollHalt(registered ?", "(void)(registered ?"), ["unpaired", "paired", "regfail"]],
  ["setup initialise l'écran (tft.begin)", (i) => firstOnly(i, '  logf("[ENROLL] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  tft.begin();"), ["unpaired"]],
  ["setup initialise la carte SD (initSD)", (i) => firstOnly(i, '  logf("[ENROLL] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  initSD();"), ["unpaired"]],
  ["échec de register dessiné", (i) => firstOnly(i, 'logf("[REGISTER] echec HTTP (journal seulement, aucun dessin) : nouvel essai dans 5 s"); return false; }', "registerShowFailure(); return false; }"), ["regfail", "http500"]],
  ["carte non appairée : onboarding affiché", (i) => firstOnly(i, "#if POD_PREVIEW_ENROLL\n  enrollReport();", "#if POD_PREVIEW_ENROLL\n  if (!paired) registerShowOnboarding();\n  enrollReport();"), ["unpaired"]],
  ["loop() reprend le pull", (i) => firstOnly(i, "  delay(1000);                                          // arret definitif : ni reseau, ni peripherique", "  if (!doPull()) delay(1000);"), ["unpaired", "paired"]],
  ["boucle de register non bornée", (i) => firstOnly(i, "att < 6;", "att < 100;"), ["regfail", "http500"]],
  ["la production n'est plus refusée à l'exécution", (i) => firstOnly(i, 'if (strcasecmp(SERVER_HOST, "proof-of-draw.vercel.app") == 0) {', "if (0) {"), ["productionRefused"]],
  ["le pairCode n'est plus journalisé", (i) => firstOnly(i, "pairCode=%s -> ouvrir https://%s/onboard?code=%s avec la session Preview\", SERVER_HOST, deviceId.c_str(), pairCode.c_str(), SERVER_HOST, pairCode.c_str());", "-> ouvrir https://%s/onboard avec la session Preview\", SERVER_HOST, deviceId.c_str(), SERVER_HOST);"), ["unpaired"]],
];
test(`APPAIRAGE — MUTANTS exécutés (${MUTANTS.length}) : chaque protection supprimée est REFUSÉE par la vérification visée`, () => {
  for (const [label, mut, killers] of MUTANTS) {
    const ino = mut(INO_SRC); assert.notEqual(ino, INO_SRC, `mutant sans effet : ${label}`);
    const host = killers.includes("productionRefused") ? "PROOF-OF-DRAW.VERCEL.APP" : PREVIEW_HOST;
    const exe = build(ino, host);
    const failed = killers.some((k) => { const sc = k === "productionRefused" ? "unpaired" : k; try { const key = `${exe}|${sc}`; memo.delete(key); return CHECKS[k](exe).length > 0; } catch { return true; } });
    assert.ok(failed, `mutant NON refusé par ${killers.join(" / ")} : ${label}`);
  }
});
test("APPAIRAGE — MUTANTS statiques : portée (appel de doPull dans setup, ancien tail de setup), drapeau à 1, hôte de production accepté à la compilation", () => {
  const reachBad = (ino: string) => reachFrom(ino, ["setup", "loop"], "enroll").hits.length > 0;
  assert.ok(reachBad(firstOnly(INO_SRC, "  delay(1000);                                          // arret definitif : ni reseau, ni peripherique", "  doPull();")), "doPull dans loop() doit être refusé");
  assert.ok(reachBad(firstOnly(INO_SRC, "  enrollHalt(registered ?", "  restoreLastFrame(); enrollHalt(registered ?")), "restoreLastFrame dans setup() doit être refusé");
  assert.ok(reachBad(firstOnly(INO_SRC, "  enrollHalt(registered ?", "  serviceTouch(); enrollHalt(registered ?")), "serviceTouch dans setup() doit être refusé");
  assert.ok(reachBad(firstOnly(INO_SRC, "  enrollHalt(registered ?", "  doValidate(); enrollHalt(registered ?")), "doValidate dans setup() doit être refusé");
  assert.ok(reachBad(firstOnly(INO_SRC, "  enrollHalt(registered ?", "  ackFrame(String(\"x\")); enrollHalt(registered ?")), "ackFrame dans setup() doit être refusé");
  assert.doesNotMatch(firstOnly(INO_SRC, "#define POD_PREVIEW_ENROLL 0", "#define POD_PREVIEW_ENROLL 1"), /^#define POD_PREVIEW_ENROLL 0/m);
});

// ── 5. refus de la production À LA COMPILATION ────────────────────────────────────────────
test("APPAIRAGE — l'hôte de production dans pod_preview_host.h est REFUSÉ par la compilation (static_assert) ; l'absence du fichier aussi (#error)", () => {
  assert.throws(() => build(INO_SRC, "proof-of-draw.vercel.app"), (e: unknown) => e instanceof Error, "la compilation avec l'hôte de production aurait dû échouer");
  // fichier d'hôte absent : le sketch doit s'arrêter par #error (pas de repli silencieux sur la production)
  const dir = path.join(tmp, `en-nohost-${nBuild++}`), sk = path.join(dir, "sk"); fs.mkdirSync(sk, { recursive: true });
  fs.writeFileSync(path.join(sk, "probe.cpp"), `#define POD_CANARY 0\n#define POD_VOTE_V1 0\n#define POD_VOTE_CANARY 0\n#define POD_PREVIEW_ENROLL 1\n#if __has_include("pod_preview_host.h")\n#include "pod_preview_host.h"\n#endif\n#ifndef POD_PREVIEW_HOST\n#error "POD_PREVIEW_ENROLL exige POD_PREVIEW_HOST"\n#endif\nint main(){}\n`);
  const r = runProcess(choice.path!, ["-std=gnu++17", "-fsyntax-only", path.join(sk, "probe.cpp")]);
  assert.notEqual(r.status, 0, "sans pod_preview_host.h la compilation doit échouer");
  assert.match(String(r.stderr), /POD_PREVIEW_HOST/);
  assert.match(INO_SRC, /#ifndef POD_PREVIEW_HOST\n    #error "POD_PREVIEW_ENROLL exige POD_PREVIEW_HOST/);
});
