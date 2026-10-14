// tests/tft28VoteCanary.test.ts — LOT8B2E V4 : canari de VOTE du UNO R4 + TFT 2,8″ (POD_VOTE_CANARY), HÔTE seulement. Garantie visée : AU PLUS UNE tentative de vote, même après reset ou coupure pendant le POST.
//
//   1. production inchangée : avec POD_VOTE_CANARY = 0 le texte du sketch est IDENTIQUE à celui de V3-FIX1 (firmware-backups/2026-10-13_avant-vote-v4-canary) ; drapeau à 0 dans le dépôt ;
//   2. règles statiques du canari (backend isolé, épinglage, verrou écrit AVANT la connexion du POST, g_voteScratch absent, boucle sans affichage / ACK / toucher / animation) ;
//   3. scénarios dynamiques sur le sketch COMPLET compilé avec -DPOD_VOTE_CANARY=1 (réseau scripté, vraie crypto, EEPROM simulée qui SURVIT aux redémarrages) : succès, refus, timeout, écriture partielle, réponse perdue,
//      reset avant / pendant le POST, allocation impossible, EEPROM indisponible / corrompue / tronquée / version inconnue, candidat réannoncé ou différent, hash / taille / écran divergents ;
//   4. MATRICE DE COUPURES : coupure à CHAQUE octet de CHAQUE écriture du verrou (3 écritures × 17 octets × 2 modes de déchirure) : jamais plus d'un POST, jamais de POST avant que le verrou soit prouvé ;
//   5. mutants : chaque protection supprimée est REFUSÉE.
//   Aucun test n'est ignoré silencieusement (pré-vol explicite). Voir docs/LOT_8B2E_R4_TFT28_VOTE_V4_CANARY_2026_10_13.md.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { ROOT, readText, undoAckStateFix, ACK_FIX_NEW } from "./helpers/tft28Source";
import { ownTmp } from "./helpers/ownTmp";
import { reachFrom } from "./helpers/voteCanaryReach";
import { voteMessageV2 } from "../lib/podVote";
import { verifyEd25519 } from "../lib/ed25519";

const choice = findCompiler();
console.log(`[tft28VoteCanary] ${describeChoice(choice)}`);
const cryptoCandidates = [process.env.POD_CRYPTO_SRC, path.join(os.homedir(), "Documents", "Arduino", "libraries", "Crypto", "src"), path.join(os.homedir(), "Arduino", "libraries", "Crypto", "src")].filter((x): x is string => !!x);
const cryptoSrc = cryptoCandidates.find((d) => fs.existsSync(path.join(d, "Ed25519.cpp")));
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const fwd = (p: string) => p.replace(/\\/g, "/");
const SK = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4"), HOST = path.join(ROOT, "consensus-pod", "host"), MOCK = path.join(HOST, "tft28");
const INO_SRC = readText("arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino");
const BACKUP = readText("firmware-backups/2026-10-13_avant-vote-v4-canary/pod_uno_r4.ino");
const tmp = ownTmp("tft28vc-");   // supprimé à la sortie du processus (tests/helpers/ownTmp.ts)

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
const RAW = 153600;
function content(seed: number): Buffer {
  const b = Buffer.alloc(RAW); let i = 0;
  for (let y = 0; y < 320; y++) for (let x = 0; x < 240; x++) {
    const a = ((((x >> 4) + (y >> 4) + seed) & 1) ^ ((((x * 3 + y * 5 + seed) % 11) === 0) ? 1 : 0));
    const v = a ? (0x07e0 ^ (seed & 0xff)) : 0xffff; b[i++] = v & 255; b[i++] = v >> 8;
  }
  return b;
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const SEED = 5, GOOD_HASH = sha(content(SEED));
const PIN_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_HASH = "0".repeat(64);

let nBuild = 0;
const exeCache = new Map<string, string>();
/** Compile le sketch COMPLET (production + POD_VOTE_CANARY) contre le harnais d'hôte. `ino` peut être muté ; `host` = hôte du backend. */
interface BuildOpts { allowProd?: boolean; extra?: string[] }   // TFT28-PROD-VOTE-CANARY-1 : consentement local (pod_vote_pins.h : POD_VOTE_ALLOW_PRODUCTION 1) et drapeaux supplémentaires (appliqués EN DERNIER)
function build(ino: string = INO_SRC, host = "iso.example.test", canary = true, opts: BuildOpts = {}): string {
  const key = `${createHash("sha1").update(ino).digest("hex")}|${host}|${canary}|${opts.allowProd ? "P" : ""}|${(opts.extra ?? []).join(" ")}`;
  const hit = exeCache.get(key); if (hit) return hit;
  const dir = path.join(tmp, `vc-${nBuild++}`), sk = path.join(dir, "sk"); fs.mkdirSync(sk, { recursive: true });
  for (const f of ["podEdStack.h", "podNetStack.h", "pod_http.h", "pod_bench.h", "pod_bench_stream.h", "pod_metrics.h", "pod_metrics_table.h", "pod_vote_r4.h", "pod_sd_stack.h"]) fs.copyFileSync(path.join(SK, f), path.join(sk, f));
  fs.writeFileSync(path.join(sk, "pod_sd_stack.h"), fs.readFileSync(path.join(SK, "pod_sd_stack.h"), "utf8").replace("static bool onSd(const char* what, F& f) {", "static bool onSd(const char* what, F& f) { ++g_hwOnSd;"));   // V4-FIX1 : compte les appels à onSd (copie de test)
  fs.copyFileSync(path.join(MOCK, "pod_ssl_bounded.h"), path.join(sk, "pod_ssl_bounded.h"));
  fs.writeFileSync(path.join(sk, "sketch_body.inc"), ino);
  const exe = path.join(dir, "vh");
  compileHarness(choice.path!, fwd(path.join(HOST, "tft28_vote_harness.cpp")), fwd(exe), [
    "-std=gnu++17", "-O1", "-w", "-fno-strict-aliasing", "-DPOD_CANARY=0", "-DPOD_RENDER_V1=0", "-DPOD_HOST_REAL_CRYPTO=1",
    ...(canary ? ["-DPOD_VOTE_CANARY=1", `-DPOD_VOTE_BACKEND_HOST="${host}"`, `-DPOD_VOTE_PIN_ID="${PIN_ID}"`, `-DPOD_VOTE_PIN_HASH="${GOOD_HASH}"`] : []),
    ...(opts.allowProd ? ["-DPOD_VOTE_ALLOW_PRODUCTION=1"] : []), ...(opts.extra ?? []),
    `-I${fwd(sk)}`, `-I${fwd(cryptoSrc!)}`, `-I${fwd(MOCK)}`, "-isystem", fwd(ajDir!),
    "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0", ...ensureLib().map(fwd)]);
  const out = exe + (process.platform === "win32" ? ".exe" : "");
  exeCache.set(key, out);
  return out;
}

interface Result { facts: Record<string, string>; posts: Array<Record<string, unknown>>; logs: string[] }
const memo = new Map<string, Result>();
function run(exe: string, sc: string, hash = GOOD_HASH): Result {
  const key = `${exe}|${sc}|${hash}`; const hit = memo.get(key); if (hit) return hit;
  const r = runProcess(fwd(exe), [sc, String(SEED), hash], 120000);
  assert.equal(r.status, 0, `scénario ${sc} : sortie ${r.status}\n${(r.stdout || "").slice(-1200)}${r.stderr || ""}`);
  const facts: Record<string, string> = {}, posts: Array<Record<string, unknown>> = [], logs: string[] = [];
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    if (line.startsWith("FACT ")) { const k = line.slice(5, line.indexOf("=")); facts[k] = line.slice(line.indexOf("=") + 1); }
    else if (line.startsWith("POST ")) posts.push(JSON.parse(line.slice(5)));
    else if (line.startsWith("LOG ")) logs.push(line.slice(4));
  }
  const res = { facts, posts, logs }; memo.set(key, res); return res;
}
const n = (r: Result, k: string) => Number(r.facts[k]);
const logHas = (r: Result, s: string) => r.logs.some((l) => l.includes(s));
const signatureOk = (r: Result, p: Record<string, unknown>) => verifyEd25519(r.facts.pubkey, voteMessageV2({ deviceId: String(p.deviceId), candidateId: String(p.candidateId), rawHash: String(p.rawHash), e: Number(p.e), t: Number(p.t), r: Number(p.r), verdict: p.verdict as "accept" | "reject" }), String(p.signature));

// ── référence INDÉPENDANTE du format du verrou (CRC-32 d'IEEE, 16 octets) ─────────────────────────────────────────────────────────────────────
function crc32(b: Buffer): number { let c = 0xffffffff; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
interface Rec { blank: boolean; valid: boolean; state?: number; outcome?: number; ver?: number }
function parseRec(hex: string): Rec {
  const b = Buffer.from(hex, "hex"); if (b.length !== 16) return { blank: false, valid: false };
  if (b.every((x) => x === 0xff)) return { blank: true, valid: false };
  const magic = b.readUInt32LE(0), ver = b[4], state = b[5], outcome = b[6], crc = b.readUInt32LE(12);
  const valid = magic === 0x564c4b31 && ver === 1 && (state === 0x5a || state === 0xc3) && crc === crc32(b.subarray(0, 12));
  return { blank: false, valid, state, outcome, ver };
}
const ATTEMPTED = 0x5a, COMPLETED = 0xc3;

// ── 0. pré-vol toolchain : explicite, jamais silencieux ──────────────────────────────────────────────────────────────────────────────
test("V4 — PRÉ-VOL : compilateur C++ >= 11, Crypto 0.4.0 et ArduinoJson présents et compilables — sinon ÉCHEC avec la cause (aucun test de ce fichier n'est ignoré)", () => {
  assert.ok(choice.path, `aucun compilateur C++ trouvé. ${describeChoice(choice)} — définir CXX (ex. CXX=C:/Users/<vous>/tools/winlibs-14.2/mingw64/bin/g++.exe) et mettre son dossier bin dans PATH.`);
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(choice.version);
  assert.ok(m && Number(m[1]) >= 11, `compilateur INCOMPATIBLE : ${choice.version} (g++ >= 11 exigé ; g++ 10.2 ne construit pas le harnais Crypto). Installer WinLibs 14.2 et définir CXX.`);
  assert.ok(cryptoSrc, "bibliothèque Crypto 0.4.0 introuvable : définir POD_CRYPTO_SRC");
  assert.ok(ajDir, "ArduinoJson 7.x introuvable : définir ARDUINOJSON_DIR");
  assert.doesNotThrow(() => ensureLib(), `compilation de la bibliothèque Crypto IMPOSSIBLE avec ${choice.version}`);
});

// ── 1. production inchangée ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Vue « POD_VOTE_CANARY = 0 » : évalue `#if POD_VOTE_CANARY` / `#if !POD_VOTE_CANARY` / `#else` / `#endif` (les autres conditionnelles sont conservées telles quelles) et retire le bloc du drapeau. */
function offView(src: string): string {
  const out: string[] = []; const st: Array<{ ours: boolean; active: boolean }> = [];
  const keep = () => st.every((s) => !s.ours || s.active);
  for (const line of src.replace(/\/\/ POD_VOTE_CANARY \(LOT8B2E V4\)[\s\S]*?#ifndef POD_VOTE_CANARY\n#define POD_VOTE_CANARY 0\n#endif\n/, "").replace(/\/\/ POD_PREVIEW_ENROLL \(LOT TFT28-PREVIEW-ENROLL-1\)[\s\S]*?#define POD_NOHW 0\n#endif\n\n/, "").split("\n")) {
    const t = line.trim();
    if (/^#if\s+(POD_VOTE_CANARY|POD_NOHW|POD_PREVIEW_ENROLL)\s*$/.test(t)) { st.push({ ours: true, active: false }); continue; }
    if (/^#if\s+!(POD_VOTE_CANARY|POD_NOHW|POD_PREVIEW_ENROLL)\s*$/.test(t)) { st.push({ ours: true, active: true }); continue; }
    if (/^#(if|ifdef|ifndef)\b/.test(t)) { st.push({ ours: false, active: true }); if (keep()) out.push(line); continue; }
    if (/^#else\b/.test(t) && st.length && st[st.length - 1].ours) { st[st.length - 1].active = !st[st.length - 1].active; continue; }
    if (/^#endif\b/.test(t)) { const top = st.pop(); if (top && !top.ours && keep()) out.push(line); continue; }
    if (keep()) out.push(line);
  }
  return out.join("\n");
}
test("V4 — PRODUCTION INCHANGÉE : POD_VOTE_CANARY = 0 par défaut (jamais commité à 1) et le texte du sketch vu avec POD_VOTE_CANARY = 0 est IDENTIQUE à V3-FIX1", () => {
  assert.match(INO_SRC, /#ifndef POD_VOTE_CANARY\n#define POD_VOTE_CANARY 0\n#endif/);
  assert.doesNotMatch(INO_SRC, /#define POD_VOTE_CANARY 1\b/);
  assert.match(INO_SRC, /#define POD_CANARY 0\b/); assert.match(INO_SRC, /#define POD_RENDER_V1 0\b/); assert.match(INO_SRC, /#define POD_VOTE_V1 0\b/);
  assert.equal(undoAckStateFix(offView(INO_SRC)), BACKUP, "identique à V3-FIX1 modulo le SEUL delta TFT28-ACK-STATE-FIX1 (queue de doFetchFrame)");
  assert.ok(offView(INO_SRC).includes(ACK_FIX_NEW), "le delta documenté est bien présent dans la production");
});

// ── 2. règles statiques du canari ─────────────────────────────────────────────────────────────────────────────────────────────────────
function staticViolations(ino: string): string[] {
  const v: string[] = [];
  const inCanary = (re: RegExp) => re.test(ino);
  if (!inCanary(/#if POD_CANARY \|\| POD_VOTE_V1\n    #error/)) v.push("POD_VOTE_CANARY exige POD_CANARY = 0 et POD_VOTE_V1 = 0 (#error)");
  if (!inCanary(/#if !defined\(POD_VOTE_BACKEND_HOST\) \|\| !defined\(POD_VOTE_PIN_ID\) \|\| !defined\(POD_VOTE_PIN_HASH\)\n    #error/)) v.push("hôte du backend et épinglage obligatoires (#error)");
  if (!inCanary(/static_assert\(sizeof\(POD_VOTE_PIN_HASH\) == 65/) || !inCanary(/static_assert\(sizeof\(POD_VOTE_PIN_ID\) >= 9 && sizeof\(POD_VOTE_PIN_ID\) <= 65/)) v.push("hash épinglé de 64 caractères et identifiant de 8 à 64 caractères vérifiés à la compilation");
  if (!inCanary(/#define POD_VOTE_PIN_SCREEN "tft28"\n  #define POD_VOTE_PIN_BYTES  153600/)) v.push("profil épinglé tft28, taille 153 600");
  if (!inCanary(/#if POD_VOTE_CANARY\n#define SERVER_HOST       POD_VOTE_BACKEND_HOST[^\n]*\n#else\n#if POD_PREVIEW_ENROLL\n#define SERVER_HOST       POD_PREVIEW_HOST[^\n]*\n#else\n#define SERVER_HOST       "proof-of-draw\.vercel\.app"\n#endif\n#endif/)) v.push("SERVER_HOST = backend isolé en canari de vote");
  if (!inCanary(/if \(strcasecmp\(SERVER_HOST, "proof-of-draw\.vercel\.app"\) == 0\) return "hote = PRODUCTION/)) v.push("la porte refuse l'hôte de production");
  if (!inCanary(/if \(!why\) why = voteCanaryGateWhy\(\);/)) v.push("la porte de vote inclut le verrou et l'hôte");
  // verrou : deux blocs de 1 Ko distincts, hors du bloc 0 (clés), relecture vérifiée, aucun effacement
  const offs = /static const int VL_OFF_A = (\d+), VL_OFF_B = (\d+), VL_NEED = (\d+);/.exec(ino);
  if (!offs || Math.floor(+offs[1] / 1024) === Math.floor(+offs[2] / 1024) || +offs[1] < 1024 || +offs[2] < 1024 || +offs[3] <= +offs[2]) v.push("emplacements du verrou : deux blocs de 1 Ko DISTINCTS, hors du bloc 0 des clés");
  const lock = ino.slice(ino.indexOf("static bool vlWriteVerified("), ino.indexOf("// Issue finale"));
  if (!/EEPROM\.put\(off, want\);\n  VoteLockRec got;\n  return vlReadSlot\(off, got\) == VL_VALID && memcmp\(&got, &want, sizeof\(got\)\) == 0;/.test(lock)) v.push("écriture du verrou suivie d'une RELECTURE comparée");
  if (!/if \(voteLockStatus\(\) != VLS_FREE\) return false;[\s\S]*vlWriteVerified\(VL_OFF_A, r\)\) return false;\n  return vlWriteVerified\(VL_OFF_B, r\);/.test(lock)) v.push("ATTEMPTED écrit et vérifié dans LES DEUX emplacements, après contrôle LIBRE");
  if (/EEPROM\.(write|update)\(|erase|\.clear\(/.test(ino.slice(ino.indexOf("static bool votePinMatches("), ino.indexOf("// Instrument de pile PRINCIPALE")))) v.push("le verrou n'est jamais effacé ni écrit octet par octet");
  // ordre dans la phase POST : verrou prouvé AVANT la connexion
  const post = ino.slice(ino.indexOf("static VoteOutcome __attribute__((noinline)) votePhasePost("), ino.indexOf("static VoteOutcome __attribute__((noinline)) doValidateV2("));
  const iLock = post.indexOf("voteLockCommitAttempt()"), iHttp = post.indexOf('httpCall("POST"'), iAtt = post.indexOf("g_vcAttempted = true;"), iOut = post.indexOf("voteLockRecordOutcome(");
  if (!(iLock > 0 && iLock < iHttp && iAtt > iLock && iAtt < iHttp && iOut > iHttp)) v.push("ordre : voteLockCommitAttempt() ET g_vcAttempted AVANT httpCall(POST), issue enregistrée APRÈS");
  if (!/if \(!voteLockCommitAttempt\(\)\) \{[^\n]*AUCUN POST[^\n]*return VOTE_NOT_SENT; \}/.test(post)) v.push("persistance impossible => AUCUN POST");
  // épinglage et g_voteScratch
  if (!/#if !POD_VOTE_CANARY\nstatic uint8_t g_voteScratch\[4736\];\n#endif/.test(ino)) v.push("g_voteScratch absent du build de vote");
  if (!/podCheckStream\(c\.rd, kind, bytes, nullptr, 0, g_voteChunk, sizeof\(g_voteChunk\), &chk\);/.test(ino)) v.push("lecture du candidat sans tampon de travail dans le build de vote");
  if (!/return strcmp\(id, POD_VOTE_PIN_ID\) == 0 && strcmp\(screen, POD_VOTE_PIN_SCREEN\) == 0 && bytes == \(size_t\)POD_VOTE_PIN_BYTES && strcmp\(hash, POD_VOTE_PIN_HASH\) == 0;/.test(ino)) v.push("épinglage : identifiant, écran, taille ET hash");
  if (!/if \(pendingCandidateId != POD_VOTE_PIN_ID\) \{ vcAbstain/.test(ino)) v.push("candidat annoncé par le pull != épinglé : aucune requête");
  if (!/if \(kind != POD_TFT28 \|\| bytes != \(size_t\)POD_VOTE_PIN_BYTES\)/.test(ino)) v.push("défense en profondeur : profil / taille revérifiés avant la lecture");
  // boucle dédiée : ni toucher, ni animation, ni banc d'essai, ni observation, ni ACK
  const loop = /static void voteCanaryLoop\(\) \{\n([\s\S]*?)\n\}\n#endif/.exec(ino);
  if (!loop) v.push("voteCanaryLoop introuvable");
  else if (/serviceTouch|drainTouch|runResidentAnim|doBenchPoll|doObsConfirm|ackFrame|doFetchFrame|maybeFetchAnim|restoreLastFrame|tft\./.test(loop[1])) v.push("voteCanaryLoop : aucun toucher / animation / banc d'essai / observation / ACK / affichage");
  if (!/void loop\(\) \{\n#if POD_VOTE_CANARY\n  voteCanaryLoop\(\);\n#else/.test(ino)) v.push("loop() délègue à voteCanaryLoop() en tout premier");
  if (!/#if !POD_VOTE_CANARY\n    restoreLastFrame\(\);/.test(ino)) v.push("setup : pas de restoration d'image en canari de vote");
  if (!/#if POD_NOHW\n  return true;[^\n]*\n#else/.test(ino)) v.push("doPull : frame / animation / banc d'essai ignorés en canari de vote");
  if (!/vcLockBoot\(\);\n  if \(g_vcHalted\) return;/.test(ino)) v.push("verrou pris au démarrage : setup() s'arrête AVANT le Wi-Fi");
  if (!/if \(g_vcAttempted\) vcHalt\("tentative unique effectuee"\);/.test(ino)) v.push("arrêt définitif après la tentative");
  if (!/if \(alert\) \{ g_vcHalted = true; for \(;;\)/.test(ino)) v.push("marge de pile < 128 o : verrou silencieux");
  if (/\bPOD_VOTE_V1 1\b/.test(ino)) v.push("voie v1 absente");
  return v;
}
test("V4 — règles STATIQUES : backend isolé, épinglage, verrou à deux emplacements écrit et relu AVANT le POST, g_voteScratch absent, boucle sans affichage / ACK / toucher / animation, arrêt définitif", () => {
  assert.deepEqual(staticViolations(INO_SRC), []);
});

/** V4-FIX1 : TOUT ce qui est atteignable depuis setup() et loop() / voteCanaryLoop() dans le build de vote : aucune fonction ni aucun accès d'écran, de tactile, de carte SD, d'animation, d'ACK. */
function reachViolations(ino: string): string[] {
  const r = reachFrom(ino, ["setup", "loop", "voteCanaryLoop"]);
  const v = r.hits.map((h) => `${h.fn} : ${h.what}`);
  for (const must of ["setup", "voteCanaryLoop", "doRegister", "doPull", "doValidate", "doValidateV2", "votePhasePost", "voteLockCommitAttempt", "httpCall", "selfTestEd25519", "vcLockBoot"]) if (!r.funcs.includes(must)) v.push(`l'analyse n'atteint pas ${must} (analyse vide de sens)`);
  if (r.funcs.length < 60) v.push(`seulement ${r.funcs.length} fonctions atteignables : analyse suspecte`);
  if (!/pinMode\(TFT_CS, OUTPUT\);   digitalWrite\(TFT_CS, HIGH\);\n  pinMode\(STMPE_CS, OUTPUT\); digitalWrite\(STMPE_CS, HIGH\);\n  pinMode\(SD_CS, OUTPUT\);    digitalWrite\(SD_CS, HIGH\);\n\n#if POD_NOHW\n#if POD_PREVIEW_ENROLL\n  logf\("\[ENROLL\] ecran[^\n]*\n#else\n  logf\("\[VOTE-CANARY\] ecran, tactile et carte SD NON initialises/.test(ino)) v.push("les trois CS restent à HIGH (contention évitée) puis AUCUNE initialisation d'écran / tactile / SD");
  if (!/if \(!paired\) vcHalt\("appareil NON appaire/.test(ino)) v.push("carte non appairée => arrêt définitif (aucun QR, aucun onboarding)");
  return v;
}
test("V4-FIX1 — PORTÉE : aucune fonction d'affichage, de tactile, de carte SD, d'animation ou d'ACK n'est atteignable depuis setup() / loop() / voteCanaryLoop() dans le build de vote (analyse sur TOUT le chemin atteignable, pas seulement la boucle)", () => {
  assert.deepEqual(reachViolations(INO_SRC), []);
});
test("V4-FIX1 — PORTÉE, mutants : réintroduire tft.begin(), initSD(), un dessin d'erreur ou d'onboarding dans register, la fin de doPull ou l'ancien loop() est REFUSÉ", () => {
  const muts: Array<[string, (i: string) => string]> = [
    ["setup initialise l'écran (tft.begin)", (i) => firstOnly(i, '  logf("[VOTE-CANARY] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  tft.begin();")],
    ["setup initialise la carte SD", (i) => firstOnly(i, '  logf("[VOTE-CANARY] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  initSD();")],
    ["setup initialise le tactile", (i) => firstOnly(i, '  logf("[VOTE-CANARY] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  touchOk = ts.begin();")],
    ["erreur Wi-Fi dessinée (module absent)", (i) => firstOnly(i, 'logf("[WIFI] module absent : arret (aucun dessin)");', 'tftStatus("Module WiFi absent", "", C_RED);')],
    ["erreur Wi-Fi dessinée (échec)", (i) => firstOnly(i, 'logf("[WIFI] échec (aucun dessin) : redemarrage");', 'tftStatus("WiFi FAIL", "Redemarrage...", C_RED);')],
    ["register échoué dessiné", (i) => firstOnly(i, 'logf("[REGISTER] echec HTTP (journal seulement, aucun dessin) : nouvel essai dans 5 s"); return false; }', "registerShowFailure(); return false; }")],
    ["register appairé dessiné (Connecté)", (i) => firstOnly(i, "  if (!paired) vcHalt(", "  registerShowConnected();\n  if (!paired) vcHalt(")],
    ["carte non appairée : onboarding / QR affiché", (i) => firstOnly(i, "  if (!paired) vcHalt(", "  if (!paired) registerShowOnboarding();\n  if (!paired) vcHalt(")],
    ["doPull traite de nouveau les frames", (i) => firstOnly(i, "#if POD_NOHW\n  return true;", "#if 0\n  return true;")],
    ["loop() reprend le corps d'origine", (i) => firstOnly(i, "  voteCanaryLoop();\n#else", "  voteCanaryLoop();\n#endif\n#if 1")],
    ["voteCanaryLoop appelle serviceTouch", (i) => firstOnly(i, "static void voteCanaryLoop() {\n", "static void voteCanaryLoop() {\n  serviceTouch();\n")],
    ["voteCanaryLoop restaure l'image", (i) => firstOnly(i, "static void voteCanaryLoop() {\n", "static void voteCanaryLoop() {\n  restoreLastFrame();\n")],
    ["doValidate acquitte (ACK)", (i) => firstOnly(i, "    pendingCandidateId = \"\";                                // effacé APRÈS le classement de l'issue\n", "    pendingCandidateId = \"\";\n    ackFrame(lastFrameId);\n")],
  ];
  for (const [label, f] of muts) {
    const mutated = f(INO_SRC);
    assert.notEqual(mutated, INO_SRC, `mutation sans effet : ${label}`);
    assert.notDeepEqual(reachViolations(mutated), [], `mutant de portée NON refusé : ${label}`);
  }
});

// ── 3. scénarios dynamiques ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const exeV4 = () => build();
const attemptedBoth = (r: Result, tag = "b1") => parseRec(r.facts[`${tag}_slotB`]).valid && parseRec(r.facts[`${tag}_slotB`]).state === ATTEMPTED && parseRec(r.facts[`${tag}_slotA`]).valid;
const OUTCOME = { SENT_UNKNOWN: 1, ACCEPTED: 2, REFUSED: 3, SIG: 4, HASH: 5 };
type Chk = (exe: string, ino?: string) => string[];
const CHECKS: Record<string, Chk> = {
  // succès : un POST conforme et signé, verrou ATTEMPTED dans les deux emplacements (vérifié par une référence INDÉPENDANTE), issue enregistrée, arrêt définitif, mesures de pile et de tas à chaque étape
  success: (exe) => {
    const v: string[] = []; const r = run(exe, "vc-ok");
    if (n(r, "boot1_halted") !== 0 || n(r, "b1_posts") !== 1 || n(r, "b1_validates") !== 1 || n(r, "b1_reads") !== 1 || n(r, "b1_halted") !== 1 || n(r, "b1_attempted") !== 1) v.push("vc-ok : 1 validate, 1 lecture, 1 POST, canari arrêté");
    const p = r.posts[0]; if (!p || p.v !== 2 || p.candidateId !== PIN_ID || p.rawHash !== GOOD_HASH || p.verdict !== "accept" || !signatureOk(r, p)) v.push("vc-ok : POST conforme et signature valide");
    const A = parseRec(r.facts.b1_slotA), B = parseRec(r.facts.b1_slotB);
    if (!B.valid || B.state !== ATTEMPTED) v.push("vc-ok : emplacement B = ATTEMPTED valide");
    if (!A.valid || A.state !== COMPLETED || A.outcome !== OUTCOME.ACCEPTED) v.push("vc-ok : emplacement A = COMPLETED, issue ACCEPTED");
    if (n(r, "b1_puts") !== 3) v.push("vc-ok : trois écritures de page exactement (A, B, issue)");
    for (const tag of ["boot", "avant VoteWork", "apres VoteWork (alloue)", "apres lecture du candidat", "apres signature", "avant persistance ATTEMPTED", "apres persistance ATTEMPTED (verrou verifie)", "apres POST et classement", "fin du vote"])
      if (!r.logs.some((l) => l.includes(`[VOTE-CANARY] ${tag} : pile principale`) && /marge -?\d+\) \| tas libre \d+, plus grand bloc \d+/.test(l))) v.push(`vc-ok : mesure de pile et de tas « ${tag} » absente`);
    if (!logHas(r, "ARRET DEFINITIF : tentative unique effectuee")) v.push("vc-ok : arrêt définitif journalisé");
    if (n(r, "vw_live") !== 0) v.push("vc-ok : VoteWork libéré");
    return v;
  },
  // refus, timeout, écriture partielle, réponse perdue : une seule tentative, verrou PRIS, aucune seconde
  outcomes: (exe) => {
    const v: string[] = [];
    for (const [sc, code] of [["vc-reject", OUTCOME.HASH], ["vc-refused", OUTCOME.REFUSED], ["vc-sig403", OUTCOME.SIG], ["vc-timeout", OUTCOME.SENT_UNKNOWN], ["vc-lost", OUTCOME.SENT_UNKNOWN], ["vc-partial", OUTCOME.SENT_UNKNOWN]] as const) {
      const r = run(exe, sc);
      if (n(r, "b1_posts") !== 1 && sc !== "vc-timeout" && sc !== "vc-lost") v.push(`${sc} : le POST est parti`);
      if (n(r, "b1_posts") !== 1) v.push(`${sc} : exactement un POST vu par le serveur`);
      if (n(r, "b1_halted") !== 1 || n(r, "b1_attempted") !== 1 || n(r, "lock_status") !== 1) v.push(`${sc} : canari arrêté, verrou PRIS`);
      if (!attemptedBoth(r) && parseRec(r.facts.b1_slotA).outcome !== code) v.push(`${sc} : verrou ATTEMPTED / issue ${code} enregistrés`);
      if (parseRec(r.facts.b1_slotA).outcome !== code) v.push(`${sc} : issue ${code} dans le verrou`);
      if (n(r, "b1_validates") !== 1 || n(r, "b1_reads") !== 1) v.push(`${sc} : aucune seconde requête`);
    }
    return v;
  },
  // reset PENDANT/APRÈS le POST : la requête est partie, le verrou est déjà prouvé ; au redémarrage : aucun second POST, aucun réseau
  resetDuringPost: (exe) => {
    const r = run(exe, "vc-reset-post"); const v: string[] = [];
    if (n(r, "b1_posts") !== 1 || n(r, "b1_crashed") !== 1) v.push("vc-reset-post : le POST est parti puis le courant est coupé");
    if (!attemptedBoth(r) && !parseRec(r.facts.b1_slotB).valid) v.push("vc-reset-post : verrou ATTEMPTED déjà prouvé avant le POST");
    if (n(r, "boot2_halted") !== 1 || n(r, "b2_posts") !== 1 || n(r, "b2_validates") !== n(r, "b1_validates")) v.push("vc-reset-post : au redémarrage, verrou PRIS, aucun réseau, aucun second POST");
    return v;
  },
  // reset AVANT le POST (rien d'écrit) : la tentative n'a pas eu lieu, un seul vote suivra au redémarrage
  resetBeforePost: (exe) => {
    const r = run(exe, "vc-reset-before"); const v: string[] = [];
    if (n(r, "b1_posts") !== 0 || n(r, "b1_crashed") !== 1) v.push("vc-reset-before : coupure à la première écriture : aucun POST");
    if (n(r, "b2_posts") !== 1 || n(r, "b2_halted") !== 1) v.push("vc-reset-before : au redémarrage le verrou est LIBRE : exactement un vote");
    return v;
  },
  allocFail: (exe) => {
    const r = run(exe, "vc-alloc"); const v: string[] = [];
    if (n(r, "b1_posts") !== 1 || n(r, "b1_reads") !== 1 || n(r, "b1_validates") !== 2 || n(r, "vw_allocs") !== 2 || n(r, "vw_live") !== 0) v.push("vc-alloc : allocation de VoteWork refusée : AUCUNE lecture (1 seule au total), la passe suivante vote une fois");
    if (!logHas(r, "mémoire insuffisante (VoteWork)") || !logHas(r, "ABSTENTION : VoteWork non allouable")) v.push("vc-alloc : journal explicite");
    return v;
  },
  eeprom: (exe) => {
    const v: string[] = [];
    const s = run(exe, "vc-eeprom-short");
    if (n(s, "boot1_halted") !== 1 || n(s, "b1_validates") !== 0 || n(s, "b1_posts") !== 0 || n(s, "lock_status") !== 2 || !logHas(s, "INDISPONIBLE")) v.push("vc-eeprom-short : EEPROM trop courte => arrêt au démarrage, AUCUN réseau");
    const a = run(exe, "vc-eeprom-noalloc");
    if (n(a, "b1_posts") !== 0 || n(a, "b1_attempted") !== 0 || n(a, "b1_halted") !== 1 || n(a, "b1_reads") !== 3 || !logHas(a, "persistance ATTEMPTED impossible ou non verifiee : AUCUN POST")) v.push("vc-eeprom-noalloc : écriture sans effet (page non allouable) => relecture échoue => AUCUN POST, arrêt après 3 passages");
    return v;
  },
  // verrou absent / corrompu / tronqué / version inconnue
  lockStates: (exe) => {
    const v: string[] = [];
    const ok = run(exe, "vc-pre:blank");
    if (n(ok, "b1_posts") !== 1) v.push("vc-pre:blank : verrou LIBRE (absent) => le vote est permis, une fois");
    for (const variant of ["A-attempted", "B-attempted", "both-attempted", "completed", "garbage-A", "garbage-B", "truncated", "one-byte", "version2", "bad-magic", "bad-state", "bad-crc"]) {
      const r = run(exe, `vc-pre:${variant}`);
      if (n(r, "boot1_halted") !== 1 || n(r, "b1_validates") !== 0 || n(r, "b1_posts") !== 0 || n(r, "lock_status") !== 1) v.push(`vc-pre:${variant} : verrou non vierge => arrêt au démarrage, AUCUN réseau, aucun POST`);
    }
    // verrou pris APRÈS le démarrage : la porte de vote elle-même le voit (aucune requête)
    for (const variant of ["A-attempted", "garbage-B", "truncated"]) {
      const r = run(exe, `vc-gate:${variant}`);
      if (n(r, "boot1_halted") !== 0 || n(r, "b1_validates") !== 0 || n(r, "b1_posts") !== 0 || !logHas(r, "porte FERMEE : verrou de vote deja pris ou non vierge")) v.push(`vc-gate:${variant} : verrou pris après le démarrage => porte FERMÉE, AUCUNE requête`);
    }
    return v;
  },
  // épinglage : candidat différent, identifiant / écran / taille / hash annoncés divergents, v1, contenu altéré
  pins: (exe) => {
    const v: string[] = [];
    const none = (sc: string, r: Result, reads: number, why: string) => { if (n(r, "b1_posts") !== 0 || n(r, "b1_reads") !== reads || n(r, "b1_halted") !== 1 || n(r, "b1_attempted") !== 0 || n(r, "lock_status") !== 0 || !logHas(r, why)) v.push(`${sc} : abstention sans POST, verrou intact`); };
    const o = run(exe, "vc-other-id"); none("vc-other-id", o, 0, "candidat annonce != candidat epingle"); if (n(o, "b1_validates") !== 0) v.push("vc-other-id : aucune requête validate-candidate pour un candidat non épinglé");
    none("vc-announce-other-id", run(exe, "vc-announce-other-id"), 0, "identifiant / ecran / taille / hash annonces != epinglage");
    none("vc-screen", run(exe, "vc-screen"), 0, "identifiant / ecran / taille / hash annonces != epinglage");
    none("vc-bytes", run(exe, "vc-bytes"), 0, "identifiant / ecran / taille / hash annonces != epinglage");
    none("vc-oled", run(exe, "vc-oled"), 0, "identifiant / ecran / taille / hash annonces != epinglage");
    none("vc-hash-announced", run(exe, "vc-ok", OTHER_HASH), 0, "identifiant / ecran / taille / hash annonces != epinglage");
    none("vc-v1", run(exe, "vc-v1"), 0, "candidat v1 annonce");
    none("vc-altered", run(exe, "vc-altered"), 1, "abstention definitive : hash recu != hash epingle");
    return v;
  },
  stackAlert: (exe) => { const r = run(exe, "vc-stack-alert"); return n(r, "b1_stopped") === 1 && n(r, "b1_posts") === 0 && n(r, "b1_validates") === 1 && n(r, "b1_reads") === 0 && n(r, "lock_status") === 0 ? [] : ["vc-stack-alert : marqueur de pile détruit => verrou silencieux AVANT toute lecture, aucun POST"]; },
  productionHost: (_exe, ino) => {
    const r = run(build(ino ?? INO_SRC, "proof-of-draw.vercel.app"), "vc-ok");
    return n(r, "b1_validates") === 0 && n(r, "b1_posts") === 0 && n(r, "lock_status") === 0 && logHas(r, "hote = PRODUCTION") ? [] : ["hôte de production : la porte de vote doit refuser (aucune requête, aucun POST, verrou intact)"];
  },
};
/** Compteurs d'accès matériel : TOUS à zéro (écran, tactile, SD, onSd) + aucune requête d'image, d'ACK, d'observation, de banc d'essai. */
function zeroHardware(tag: string, r: Result): string[] {
  const v: string[] = [];
  for (const k of ["hw_tft", "hw_touch", "hw_sd", "hw_onsd", "tft_bus", "tft_fills", "tft_texts", "tft_windows", "touch_polls", "sd_opens", "sd_writes", "sd_reads", "sd_removes", "acks", "pullframes", "obs", "bench"]) if (n(r, `b1_${k}`) !== 0) v.push(`${tag} : ${k} = ${r.facts[`b1_${k}`]} (attendu 0)`);
  return v;
}
CHECKS.bootNominal = (exe) => {   // vrai setup() puis vraie boucle, candidat épinglé annoncé avec une frame, une animation, un banc d'essai et une observation (tous ignorés)
  const r = run(exe, "vc-boot:vote"); const v = zeroHardware("vc-boot:vote", r);
  if (n(r, "b1_posts") !== 1 || n(r, "b1_validates") !== 1 || n(r, "b1_reads") !== 1 || n(r, "b1_halted") !== 1 || n(r, "registers") !== 1 || n(r, "paired") !== 1) v.push("vc-boot:vote : démarrage nominal puis UN vote, canari arrêté");
  const p = r.posts[0]; if (!p || p.candidateId !== PIN_ID || !signatureOk(r, p)) v.push("vc-boot:vote : POST conforme et signé");
  if (n(r, "lock_status") !== 1) v.push("vc-boot:vote : verrou pris");
  return v;
};
CHECKS.bootRegisterFail = (exe) => {   // register échoue deux fois (HTTP 500) puis réussit : journal seulement, aucun dessin
  const r = run(exe, "vc-boot:regfail"); const v = zeroHardware("vc-boot:regfail", r);
  if (n(r, "registers") !== 3 || n(r, "b1_posts") !== 1) v.push("vc-boot:regfail : 2 échecs de register journalisés puis le démarrage aboutit (3 requêtes), un vote");
  if (!logHas(r, "echec HTTP (journal seulement, aucun dessin)")) v.push("vc-boot:regfail : échec journalisé par la liaison série seulement");
  return v;
};
CHECKS.bootUnpaired = (exe) => {   // carte NON appairée : arrêt définitif, aucun périphérique, aucune requête de vote
  const r = run(exe, "vc-boot:unpaired"); const v = zeroHardware("vc-boot:unpaired", r);
  if (n(r, "b1_halted") !== 1 || n(r, "b1_posts") !== 0 || n(r, "b1_validates") !== 0 || n(r, "b1_reads") !== 0 || n(r, "pulls") !== 0 || n(r, "lock_status") !== 0 || n(r, "paired") !== 0) v.push("vc-boot:unpaired : arrêt définitif, 0 pull, 0 validate, 0 lecture, 0 POST, verrou intact");
  if (!logHas(r, "appareil NON appaire") || !logHas(r, "aucun QR, aucun ecran d'onboarding")) v.push("vc-boot:unpaired : cause journalisée");
  if (logHas(r, "[BOOT] pr") || logHas(r, "premier pull imm")) v.push("vc-boot:unpaired : setup() sort immédiatement après l'arrêt définitif : aucun faux « [BOOT] prêt », aucun « premier pull immédiat »");
  if (!logHas(r, "ARRET DEFINITIF")) v.push("vc-boot:unpaired : l'arrêt définitif est journalisé");
  return v;
};
CHECKS.hwSanity = (exe) => {   // sensibilité : appeler directement les fonctions d'affichage / SD / toucher incrémente bien les compteurs
  const r = run(exe, "vc-sanity");
  return n(r, "san_hw_tft") > 0 && n(r, "san_hw_touch") > 0 && n(r, "san_hw_sd") > 0 && n(r, "san_hw_onsd") > 0 ? [] : ["vc-sanity : les compteurs (écran, tactile, SD, onSd) doivent s'incrémenter quand on appelle ces fonctions (sinon les zéros ne prouvent rien)"];
};
for (const id of Object.keys(CHECKS)) {
  test(`V4 — scénarios « ${id} » sur le canari de vote : aucune violation`, () => { assert.deepEqual(CHECKS[id](exeV4()), []); });
}

// ── 4. matrice de coupures du verrou ─────────────────────────────────────────────────────────────────────────────────────────────────
CHECKS.cutMatrix = (exe) => {
  const v: string[] = [];
  for (let put = 1; put <= 3; put++) for (let bytes = 0; bytes <= 16; bytes++) for (const mode of [0, 1]) {
    const tag = `vc-cut:${put}:${bytes}:${mode}`; const r = run(exe, tag);
    const b1 = n(r, "b1_posts"), b2 = n(r, "b2_posts");
    if (n(r, "b1_crashed") !== 1) v.push(`${tag} : la coupure a eu lieu`);
    if (b2 > 1) v.push(`${tag} : PLUS D'UN POST au total (${b2})`);
    if (b1 === 1 && b2 !== 1) v.push(`${tag} : un POST était parti, un second est parti au redémarrage`);
    if (put <= 2 && b1 !== 0) v.push(`${tag} : un POST est parti AVANT que le verrou soit prouvé`);
    if (put === 3 && b1 !== 1) v.push(`${tag} : la coupure de l'écriture d'issue survient après le POST`);
    if (b1 === 1 && !(parseRec(r.facts.b1_slotB).valid && parseRec(r.facts.b1_slotB).state === ATTEMPTED)) v.push(`${tag} : après le POST, l'emplacement B porte ATTEMPTED valide`);
    if (b1 === 0 && b2 === 1) {   // un vote au redémarrage n'est permis que si le verrou était ENTIÈREMENT vierge
      if (!parseRec(r.facts.b1_slotA).blank || !parseRec(r.facts.b1_slotB).blank) v.push(`${tag} : vote au redémarrage alors que le verrou n'était pas vierge`);
    }
    if (b1 === 0 && b2 === 0 && parseRec(r.facts.b1_slotA).blank && parseRec(r.facts.b1_slotB).blank && put <= 2 && bytes === 0 && mode === 0 && put === 1) v.push(`${tag} : coupure sans effet sur la flash : le vote doit être possible au redémarrage`);
    if (n(r, "boot2_halted") === 0 && n(r, "b2_halted") !== 1 && b2 === 1) v.push(`${tag} : canari non arrêté après le vote`);
  }
  return v;
};
test("V4 — MATRICE DE COUPURES : coupure à chaque octet de chacune des 3 écritures du verrou (2 modes de déchirure) : jamais plus d'un POST, jamais de POST avant le verrou prouvé, redémarrage fermé", () => {
  assert.deepEqual(CHECKS.cutMatrix(exeV4()), []);
});

// ── 5. défense en profondeur : g_voteScratch absent ne permet AUCUN vote non-tft28 même si l'épinglage était contourné ────────────────────────────────
test("V4 — g_voteScratch retiré : même avec l'épinglage d'écran et le contrôle de profil SUPPRIMÉS, un candidat oled096 n'est pas votable (PodFeeder exige un tampon) — preuve que le retrait est sûr", () => {
  const rm = (i: string) => {
    let s = i.replace(/ && strcmp\(screen, POD_VOTE_PIN_SCREEN\) == 0 && bytes == \(size_t\)POD_VOTE_PIN_BYTES/, "");
    s = s.replace("  if (kind != POD_TFT28 || bytes != (size_t)POD_VOTE_PIN_BYTES) { logf(\"[VOTE-CANARY] profil / taille != epinglage : aucune lecture\"); return false; }", "");
    return s;
  };
  const mutated = rm(INO_SRC); assert.notEqual(mutated, INO_SRC);
  const r = run(build(mutated), "vc-oled");
  assert.equal(n(r, "b1_posts"), 0, "aucun POST pour un candidat oled096 même sans épinglage d'écran");
  assert.equal(n(r, "lock_status"), 0, "verrou intact");
  assert.ok(logHas(r, "lecture/calcul impossible") || logHas(r, "identifiant / ecran / taille / hash annonces != epinglage"));
});

// ── 6. mutants ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const firstOnly = (src: string, from: string, to: string) => { const i = src.indexOf(from); assert.ok(i >= 0, `motif obsolète : ${from.slice(0, 90)}`); assert.equal(src.indexOf(from, i + 1), -1, `motif ambigu : ${from.slice(0, 90)}`); return src.slice(0, i) + to + src.slice(i + from.length); };
const MUTANTS: Array<[string, (i: string) => string, string[]]> = [
  ["setup initialise l'écran (tft.begin)", (i) => firstOnly(i, '  logf("[VOTE-CANARY] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  tft.begin();"), ["bootNominal"]],
  ["setup initialise la carte SD (initSD, onSd)", (i) => firstOnly(i, '  logf("[VOTE-CANARY] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");', "  initSD();"), ["bootNominal"]],
  ["register échoué dessiné", (i) => firstOnly(i, 'logf("[REGISTER] echec HTTP (journal seulement, aucun dessin) : nouvel essai dans 5 s"); return false; }', "registerShowFailure(); return false; }"), ["bootRegisterFail"]],
  ["V4-FIX2 : setup() continue après l'arrêt définitif (faux « [BOOT] prêt »)", (i) => firstOnly(i, "  if (g_vcHalted) return;                               // V4-FIX2", "  // V4-FIX2"), ["bootUnpaired"]],
  ["carte non appairée : onboarding affiché", (i) => firstOnly(i, "  if (!paired) vcHalt(", "  if (!paired) registerShowOnboarding();\n  if (!paired) vcHalt("), ["bootUnpaired"]],
  ["la persistance ATTEMPTED qui échoue n'empêche plus le POST", (i) => firstOnly(i, "  if (!voteLockCommitAttempt()) {", "  if (false) {"), ["eeprom", "cutMatrix"]],
  ["l'écriture du verrou n'est pas relue", (i) => firstOnly(i, "  return vlReadSlot(off, got) == VL_VALID && memcmp(&got, &want, sizeof(got)) == 0;", "  (void)got; return true;"), ["eeprom"]],
  ["ATTEMPTED n'est écrit que dans l'emplacement A", (i) => firstOnly(i, "  return vlWriteVerified(VL_OFF_B, r);", "  return true;"), ["success", "cutMatrix"]],
  ["le verrou est écrit APRÈS le POST", (i) => firstOnly(firstOnly(i, "  if (!voteLockCommitAttempt()) { logf(\"[VOTE-CANARY] persistance ATTEMPTED impossible ou non verifiee : AUCUN POST\"); return VOTE_NOT_SENT; }\n  g_vcAttempted = true;", ""), "  const VoteOutcome vo = voteFinish(vCode, vResp);", "  (void)voteLockCommitAttempt(); g_vcAttempted = true;\n  const VoteOutcome vo = voteFinish(vCode, vResp);"), ["resetDuringPost", "cutMatrix"]],
  ["le verrou n'est « pris » que si l'emplacement A l'est", (i) => firstOnly(i, "return (sa == VL_BLANK && sb == VL_BLANK) ? VLS_FREE : VLS_HELD;", "return (sa == VL_BLANK) ? VLS_FREE : VLS_HELD;"), ["lockStates", "cutMatrix"]],
  ["un enregistrement corrompu est traité comme vierge", (i) => firstOnly(i, "  return VL_INVALID;\n}", "  return VL_BLANK;\n}"), ["lockStates", "cutMatrix"]],
  ["seul un enregistrement VALIDE prend le verrou", (i) => firstOnly(i, "return (sa == VL_BLANK && sb == VL_BLANK) ? VLS_FREE : VLS_HELD;", "return (sa != VL_VALID && sb != VL_VALID) ? VLS_FREE : VLS_HELD;"), ["lockStates", "cutMatrix"]],
  ["la porte n'exige plus le verrou LIBRE", (i) => firstOnly(i, '  if (st != VLS_FREE) return "verrou de vote deja pris ou non vierge (tentative unique)";\n', ""), ["lockStates"]],
  ["le démarrage ne s'arrête plus quand le verrou est pris", (i) => firstOnly(i, "  if (st != VLS_FREE) vcHalt(", "  if (false) vcHalt("), ["lockStates", "eeprom"]],
  ["l'hôte de production n'est plus refusé", (i) => firstOnly(i, 'if (strcasecmp(SERVER_HOST, "proof-of-draw.vercel.app") == 0) return', 'if (false) return'), ["productionHost"]],
  ["l'identifiant épinglé n'est plus contrôlé", (i) => firstOnly(i, "return strcmp(id, POD_VOTE_PIN_ID) == 0 && ", "return "), ["pins"]],
  ["l'écran épinglé n'est plus contrôlé", (i) => firstOnly(i, " && strcmp(screen, POD_VOTE_PIN_SCREEN) == 0", ""), ["pins"]],
  ["la taille épinglée n'est plus contrôlée", (i) => firstOnly(i, " && bytes == (size_t)POD_VOTE_PIN_BYTES && strcmp(hash,", " && strcmp(hash,"), ["pins"]],
  ["le hash épinglé n'est plus contrôlé", (i) => firstOnly(i, " && strcmp(hash, POD_VOTE_PIN_HASH) == 0;", ";"), ["pins"]],
  ["le candidat annoncé par le pull n'est plus comparé", (i) => firstOnly(i, "  if (pendingCandidateId != POD_VOTE_PIN_ID) {", "  if (false) {"), ["pins"]],
  ["le canari ne s'arrête plus après la tentative", (i) => firstOnly(i, '  if (g_vcAttempted) vcHalt("tentative unique effectuee");', "  if (false) vcHalt(\"\");"), ["success", "outcomes"]],
  ["l'abstention définitive sur contenu altéré est supprimée", (i) => firstOnly(i, '  if (strcmp(announcedHash.c_str(), w.chk.hash) != 0) g_vcStopWhy = "abstention definitive : hash recu != hash epingle";', ""), ["pins"]],
  ["la marge de pile < 128 o ne verrouille plus", (i) => firstOnly(i, "  if (alert) { g_vcHalted = true; for (;;) { __asm volatile(\"nop\"); } }", ""), ["stackAlert"]],
  ["la mesure de pile après la signature est supprimée", (i) => firstOnly(i, '{ vcCheck("apres signature"); out =', "{ out ="), ["success"]],
  ["l'issue n'est plus enregistrée", (i) => firstOnly(i, "  voteLockRecordOutcome((uint8_t)vo);\n", ""), ["success", "outcomes"]],
  ["l'allocation de VoteWork qui échoue ne compte plus comme passage", (i) => firstOnly(i, '  if (!w) vcAbstain("VoteWork non allouable (nouvelle tentative permise)");', ""), ["allocFail"]],
];
test(`V4 — MUTANTS exécutés (${MUTANTS.length}) : chaque protection supprimée est REFUSÉE par la vérification visée`, () => {
  for (const [label, edit, ids] of MUTANTS) {
    const ino = edit(INO_SRC);
    assert.notEqual(ino, INO_SRC, `mutation sans effet : ${label}`);
    let viol: string[];
    try { const exe = build(ino); viol = ids.flatMap((id) => CHECKS[id](exe, ino)); } catch (e) { viol = [`harnais en échec : ${String(e).slice(0, 160)}`]; }
    assert.notDeepEqual(viol, [], `mutant NON refusé par ${ids.join(" / ")} : ${label}`);
  }
});
test("V4 — MUTANTS statiques : verrou après le POST, g_voteScratch réintroduit, boucle qui affiche, drapeau à 1 sont REFUSÉS par les règles statiques", () => {
  const muts: Array<[string, (i: string) => string]> = [
    ["g_voteScratch réintroduit dans le build de vote", (i) => firstOnly(i, "#if !POD_VOTE_CANARY\nstatic uint8_t g_voteScratch[4736];\n#endif", "static uint8_t g_voteScratch[4736];")],
    ["ordre : le POST avant le verrou", (i) => firstOnly(i, "  vcCheck(\"avant persistance ATTEMPTED\");\n  if (!voteLockCommitAttempt())", "  vcCheck(\"avant persistance ATTEMPTED\");\n  { String r0; httpCall(\"POST\", \"/x\", &body, r0); }\n  if (!voteLockCommitAttempt())")],
    ["la boucle du canari appelle serviceTouch()", (i) => firstOnly(i, "static void voteCanaryLoop() {\n", "static void voteCanaryLoop() {\n  serviceTouch();\n")],
    ["les deux emplacements dans le même bloc de 1 Ko", (i) => firstOnly(i, "VL_OFF_B = 6144", "VL_OFF_B = 5200")],
    ["emplacement dans le bloc 0 (clés)", (i) => firstOnly(i, "VL_OFF_A = 5120", "VL_OFF_A = 600")],
    ["effacement automatique du verrou", (i) => firstOnly(i, "static void voteLockRecordOutcome(", "static void voteLockWipe() { EEPROM.update(VL_OFF_A, 0xFF); }\nstatic void voteLockRecordOutcome(")],
    ["doPull traite les frames en canari de vote (retour anticipé désactivé)", (i) => firstOnly(i, "#if POD_NOHW\n  return true;", "#if 0\n  return true;")],
    ["restoreLastFrame() actif en canari de vote", (i) => firstOnly(i, "#if !POD_VOTE_CANARY\n    restoreLastFrame();", "#if 1\n    restoreLastFrame();")],
  ];
  for (const [label, f] of muts) assert.notDeepEqual(staticViolations(f(INO_SRC)), [], `mutant statique NON refusé : ${label}`);
});

// ── 7. LOT TFT28-PROD-VOTE-CANARY-1 : consentement LOCAL au vote réel contre la production ───────────────────────────────────────────
const PROD_HOST = "proof-of-draw.vercel.app";
const prodConsentExe = () => build(INO_SRC, PROD_HOST, true, { allowProd: true });
const throwsWith = (fn: () => unknown, re: RegExp, what: string) => { let msg = ""; try { fn(); } catch (e) { msg = String((e as Error).message ?? e); } assert.ok(msg, `${what} : la compilation aurait dû ÉCHOUER`); assert.match(msg, re, `${what} : échec pour une autre raison que le garde-fou attendu`); };

test("PRODUCTION (consentement) — drapeau absent par défaut, jamais commité à 1 (sketch ni modèle), erreurs de compilation présentes", () => {
  assert.doesNotMatch(INO_SRC, /^[ \t]*#define POD_VOTE_ALLOW_PRODUCTION 1/m);
  assert.match(INO_SRC, /#ifndef POD_VOTE_ALLOW_PRODUCTION\n    #define POD_VOTE_ALLOW_PRODUCTION 0\n  #endif/);
  for (const re of [/#error "POD_VOTE_ALLOW_PRODUCTION vaut 0 \(ou absent\) ou exactement 1"/, /#error "POD_VOTE_ALLOW_PRODUCTION = 1 exige POD_CANARY = 0, POD_RENDER_V1 = 0, POD_VOTE_V1 = 0 et POD_PREVIEW_ENROLL = 0"/, /#error "POD_VOTE_CANARY exige POD_PREVIEW_ENROLL = 0/, /static_assert\(__builtin_strcmp\(POD_VOTE_BACKEND_HOST, "proof-of-draw\.vercel\.app"\) == 0, "POD_VOTE_ALLOW_PRODUCTION = 1/]) assert.match(INO_SRC, re);
  const ex = readText("arduino_uno_r4/pod_uno_r4/pod_vote_pins.h.example");
  assert.doesNotMatch(ex, /^[ \t]*#define POD_VOTE_ALLOW_PRODUCTION/m, "le modèle ne doit proposer le consentement qu'en commentaire");
});
test("PRODUCTION (consentement) — SANS consentement : la production est refusée, MAJUSCULES comprises (le DNS ignore la casse) : aucune requête de vote, aucun POST, verrou intact", () => {
  for (const host of [PROD_HOST, "PROOF-OF-DRAW.VERCEL.APP", "Proof-Of-Draw.Vercel.App"]) {
    const r = run(build(INO_SRC, host), "vc-ok");
    assert.equal(n(r, "b1_validates"), 0, host); assert.equal(n(r, "b1_posts"), 0, host); assert.equal(n(r, "lock_status"), 0, host);
    assert.ok(logHas(r, "hote = PRODUCTION"), host); assert.ok(!logHas(r, "VOTE REEL SUR PRODUCTION"), host);
  }
});
test("PRODUCTION (consentement) — AVEC le consentement local : la production est acceptée, avertissement « VOTE REEL SUR PRODUCTION », et le vote unique se déroule comme avant (verrou avant POST, un seul POST, arrêt)", () => {
  const exe = prodConsentExe();
  assert.deepEqual(CHECKS.success(exe), []);
  const r = run(exe, "vc-boot:vote");   // vrai setup() : le bandeau est écrit au démarrage
  assert.ok(logHas(r, "ATTENTION : VOTE REEL SUR PRODUCTION"), "bandeau de vote réel absent");
  assert.ok(!logHas(r, "hote = PRODUCTION"), "la porte ne doit plus refuser la production avec consentement");
  assert.equal(n(r, "b1_posts"), 1, "un seul POST, depuis le démarrage complet");
  const iso = run(build(), "vc-boot:vote");
  assert.ok(!logHas(iso, "VOTE REEL SUR PRODUCTION"), "aucun bandeau de production sur un hôte isolé sans consentement");
});
test("PRODUCTION (consentement) — les garanties du vote unique tiennent AUSSI sur la production : issues, verrou, reset, démarrage, états du verrou, alerte de pile", () => {
  const exe = prodConsentExe();
  for (const id of ["outcomes", "resetDuringPost", "resetBeforePost", "allocFail", "eeprom", "lockStates", "pins", "stackAlert", "bootNominal", "bootRegisterFail", "bootUnpaired"]) assert.deepEqual(CHECKS[id](exe), [], id);
});
test("PRODUCTION (consentement) — la matrice de coupures du verrou tient sur la production (jamais plus d'un POST)", () => {
  assert.deepEqual(CHECKS.cutMatrix(prodConsentExe()), []);
});
test("PRODUCTION (consentement) — le consentement avec un AUTRE hôte, une valeur invalide ou un autre drapeau de build est REFUSÉ À LA COMPILATION", () => {
  throwsWith(() => build(INO_SRC, "iso.example.test", true, { allowProd: true }), /POD_VOTE_ALLOW_PRODUCTION = 1 n'est valable QUE/, "consentement + hôte isolé");
  throwsWith(() => build(INO_SRC, "PROOF-OF-DRAW.VERCEL.APP", true, { allowProd: true }), /POD_VOTE_ALLOW_PRODUCTION = 1 n'est valable QUE/, "consentement + hôte en majuscules");
  throwsWith(() => build(INO_SRC, "preview.proof-of-draw.vercel.app", true, { allowProd: true }), /POD_VOTE_ALLOW_PRODUCTION = 1 n'est valable QUE/, "consentement + alias");
  for (const bad of ["2", "-1", "10"]) throwsWith(() => build(INO_SRC, PROD_HOST, true, { extra: [`-DPOD_VOTE_ALLOW_PRODUCTION=${bad}`] }), /POD_VOTE_ALLOW_PRODUCTION vaut 0|invalid|non défini|not defined|undeclared/i, `valeur ${bad}`);
  for (const flag of ["POD_CANARY", "POD_RENDER_V1", "POD_VOTE_V1", "POD_PREVIEW_ENROLL"]) throwsWith(() => build(INO_SRC, PROD_HOST, true, { allowProd: true, extra: [`-D${flag}=1`] }), /POD_VOTE_ALLOW_PRODUCTION = 1 exige|POD_VOTE_CANARY exige/, `consentement + ${flag} = 1`);
});
test("PRODUCTION (consentement) — DÉFENSE EN PROFONDEUR : sans le static_assert, la porte d'EXÉCUTION refuse encore le consentement avec un autre hôte ; sans les deux, le vote partirait (le test détecte ce mutant)", () => {
  const noAssert = firstOnly(INO_SRC, '"proof-of-draw.vercel.app") == 0, "POD_VOTE_ALLOW_PRODUCTION = 1 n\'est valable', '"proof-of-draw.vercel.app") >= -1000, "POD_VOTE_ALLOW_PRODUCTION = 1 n\'est valable');
  const r = run(build(noAssert, "iso.example.test", true, { allowProd: true }), "vc-ok");
  assert.equal(n(r, "b1_posts"), 0); assert.equal(n(r, "lock_status"), 0); assert.ok(logHas(r, "consentement production avec un autre hote"));
  const noGate = firstOnly(noAssert, 'return "consentement production avec un autre hote (incoherent)";', 'return nullptr;');
  const m = run(build(noGate, "iso.example.test", true, { allowProd: true }), "vc-ok");
  assert.notEqual(n(m, "b1_posts"), 0, "mutant : sans la porte d'exécution, un vote partirait — le test précédent le détecte");
});
test("PRODUCTION (consentement) — PORTÉE : le build de production avec consentement n'atteint, depuis setup() / loop(), aucun écran, tactile, carte SD, animation ni ACK", () => {
  const r = reachFrom(INO_SRC, ["setup", "loop", "voteCanaryLoop"]);
  assert.deepEqual(r.hits, []);
  for (const must of ["doRegister", "doValidateV2", "votePhasePost", "voteCanaryGateWhy"]) assert.ok(r.funcs.includes(must), `l'analyse n'atteint pas ${must}`);
});
