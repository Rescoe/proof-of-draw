// tests/tft28VoteHarness.test.ts — LOT8B2E V1 : harnais de VOTE de bout en bout du firmware UNO R4 + TFT 2,8″ (PRODUCTION), sur le code ACTUEL, sans aucune correction fonctionnelle.
//
//   consensus-pod/host/tft28_vote_harness.cpp exécute le sketch complet (réseau scripté, piles dédiées réelles, VRAIE bibliothèque Crypto : SHA-256 et Ed25519) et imprime des FAITS ; CE fichier rend les verdicts avec un calcul
//   INDÉPENDANT : contenu, SHA-256 (Node), métriques (lib/podMetrics.ts), message signé (lib/podVote.ts) et vérification de la signature (lib/ed25519.ts, OpenSSL).
//   Trois familles :
//     1. COMPORTEMENT ACTUEL TENU (« hold ») : ce que le firmware fait aujourd'hui et qui est conforme à la règle (aucun vote sur données incomplètes, signature valide, un seul vote, ni affichage ni ACK, ré-inscription détachée…).
//        Verrouillé par des MUTANTS du sketch : chaque régression est refusée.
//     2. ÉCARTS CONNUS (« gaps ») : règles de l'audit (docs/AUDIT_VOTE_R4_TFT28_ET_PLAN_CANARI_VOTE_2026_10_13.md § 4) que le code actuel NE respecte PAS. Le test affirme qu'ils sont observés AUJOURD'HUI, et que la liste est exactement la liste
//        documentée : le jour où le lot V2 corrige un écart, ce test échoue et doit être mis à jour (écart retiré, assertion durcie). Aucun correctif n'est fait ici.
//     3. INVARIANT S14 sur tous les scénarios : un vote ne produit ni affichage, ni écriture de carte, ni ACK, ni téléchargement d'image, ni observation.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { ROOT, readText } from "./helpers/tft28Source";
import { metricsFromRaw } from "../lib/podMetrics";
import { voteMessageV2 } from "../lib/podVote";
import { verifyEd25519 } from "../lib/ed25519";

const choice = findCompiler();
console.log(`[tft28Vote] ${describeChoice(choice)}`);
const cryptoCandidates = [process.env.POD_CRYPTO_SRC, path.join(os.homedir(), "Documents", "Arduino", "libraries", "Crypto", "src"), path.join(os.homedir(), "Arduino", "libraries", "Crypto", "src")].filter((x): x is string => !!x);
const cryptoSrc = cryptoCandidates.find((d) => fs.existsSync(path.join(d, "Ed25519.cpp")));
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skip = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : !cryptoSrc ? "bibliothèque Crypto 0.4.0 introuvable (POD_CRYPTO_SRC)" : !ajDir ? "ArduinoJson introuvable (ARDUINOJSON_DIR)" : false;
const fwd = (p: string) => p.replace(/\\/g, "/");
const SK = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4"), HOST = path.join(ROOT, "consensus-pod", "host"), MOCK = path.join(HOST, "tft28");
const INO_SRC = readText("arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino");
const VOTE_H = readText("arduino_uno_r4/pod_uno_r4/pod_vote_r4.h");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tft28vote-"));

// ─── bibliothèque Crypto réelle, compilée une fois ───────────────────────────────────────────────────────────────────
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
function build(ino: string = INO_SRC, voteH: string = VOTE_H): string {
  const dir = path.join(tmp, `vh-${nBuild++}`), sk = path.join(dir, "sk"); fs.mkdirSync(sk, { recursive: true });
  for (const f of ["podEdStack.h", "podNetStack.h", "pod_http.h", "pod_bench.h", "pod_bench_stream.h", "pod_metrics.h", "pod_metrics_table.h"]) fs.copyFileSync(path.join(SK, f), path.join(sk, f));
  fs.writeFileSync(path.join(sk, "pod_vote_r4.h"), voteH);
  fs.writeFileSync(path.join(sk, "pod_sd_stack.h"), readText("arduino_uno_r4/pod_uno_r4/pod_sd_stack.h"));
  fs.copyFileSync(path.join(MOCK, "pod_ssl_bounded.h"), path.join(sk, "pod_ssl_bounded.h"));
  fs.writeFileSync(path.join(sk, "sketch_body.inc"), ino);
  const exe = path.join(dir, "vh");
  compileHarness(choice.path!, fwd(path.join(HOST, "tft28_vote_harness.cpp")), fwd(exe), [
    "-std=gnu++17", "-O1", "-w", "-fno-strict-aliasing", "-DPOD_CANARY=0", "-DPOD_RENDER_V1=0", "-DPOD_HOST_REAL_CRYPTO=1", `-I${fwd(sk)}`, `-I${fwd(cryptoSrc!)}`, `-I${fwd(MOCK)}`, "-isystem", fwd(ajDir!),
    "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0", ...ensureLib().map(fwd)]);
  return exe + (process.platform === "win32" ? ".exe" : "");
}

// ─── référence INDÉPENDANTE (même motif que le harnais C++, recalculé ici) ────────────────────────────────────────────
const RAW = 153600;
function content(seed: number): Buffer {
  const b = Buffer.alloc(RAW); if (seed < 0) return b;                   // graine -1 : image uniforme noire (« blank »)
  let i = 0;
  for (let y = 0; y < 320; y++) for (let x = 0; x < 240; x++) {
    const a = ((((x >> 4) + (y >> 4) + seed) & 1) ^ ((((x * 3 + y * 5 + seed) % 11) === 0) ? 1 : 0));
    const v = a ? (0x07e0 ^ (seed & 0xff)) : 0xffff; b[i++] = v & 255; b[i++] = v >> 8;
  }
  return b;
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const SEED = 5;
const GOOD = content(SEED), GOOD_HASH = sha(GOOD);
const ALTERED = Buffer.from(GOOD); ALTERED[1000] ^= 1;
const REF = metricsFromRaw("tft28", GOOD), REF_ALT = metricsFromRaw("tft28", ALTERED), BLANK = content(-1), REF_BLANK = metricsFromRaw("tft28", BLANK);

interface Result { facts: Record<string, string>; posts: Array<Record<string, unknown>>; logs: string[]; raw: string }
function run(exe: string, sc: string, seed = SEED, hash = GOOD_HASH): Result {
  const r = runProcess(fwd(exe), [sc, String(seed), hash], 120000);
  assert.equal(r.status, 0, `scénario ${sc} : sortie ${r.status}\n${(r.stdout || "").slice(-1500)}${r.stderr || ""}`);
  const facts: Record<string, string> = {}, posts: Array<Record<string, unknown>> = [], logs: string[] = [];
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    if (line.startsWith("FACT ")) { const k = line.slice(5, line.indexOf("=")); facts[k] = line.slice(line.indexOf("=") + 1); }
    else if (line.startsWith("POST ")) posts.push(JSON.parse(line.slice(5)));
    else if (line.startsWith("LOG ")) logs.push(line.slice(4));
  }
  return { facts, posts, logs, raw: r.stdout || "" };
}
const n = (res: Result, k: string) => Number(res.facts[k]);
const signatureOk = (res: Result, p: Record<string, unknown>) => {
  const msg = voteMessageV2({ deviceId: String(p.deviceId), candidateId: String(p.candidateId), rawHash: String(p.rawHash), e: Number(p.e), t: Number(p.t), r: Number(p.r), verdict: p.verdict as "accept" | "reject" });
  return verifyEd25519(res.facts.pubkey, msg, String(p.signature));
};
const logHas = (res: Result, s: string) => res.logs.some((l) => l.includes(s));

/** Verdicts du COMPORTEMENT ACTUEL TENU. Retourne la liste des violations (vide = conforme). */
function holdViolations(exe: string): string[] {
  const v: string[] = [];
  const S = (sc: string, seed = SEED, hash = GOOD_HASH) => run(exe, sc, seed, hash);
  const all: Array<[string, Result]> = [];
  const add = (label: string, res: Result) => { all.push([label, res]); return res; };

  // nominal : un seul vote v2, conforme à la référence indépendante
  { const r = add("nominal", S("nominal")); const p = r.posts[0];
    if (n(r, "validates") !== 1 || n(r, "reads") !== 1 || n(r, "posts") !== 1) v.push("nominal : 1 validate, 1 lecture du candidat et 1 POST exactement");
    else {
      if (p.v !== 2 || p.rawHash !== GOOD_HASH || p.e !== REF.e || p.t !== REF.t || p.r !== REF.r) v.push("nominal : hash et métriques du POST == référence indépendante (Node / lib/podMetrics.ts)");
      if (p.verdict !== "accept" || "reason" in p) v.push("nominal : verdict accept sans motif");
      if (!signatureOk(r, p)) v.push("nominal : la signature Ed25519 du POST doit se vérifier avec la clé publique de l'appareil (message pod-vote-v2)");
      if (p.deviceId !== r.facts.deviceId || p.candidateId !== r.facts.candidateId) v.push("nominal : identifiants du POST");
    }
    if (r.facts.pending !== "-") v.push("nominal : le candidat est oublié (pas de second vote possible)");
    if (n(r, "ret") !== 0) v.push("nominal : bloc non miné quand le serveur ne le dit pas"); }
  { const r = add("mined", S("mined")); if (n(r, "ret") !== 1 || !logHas(r, "BLOC MINÉ")) v.push("mined : blockMined:true → doValidate retourne vrai"); }
  // image uniforme : refus signé « blank »
  { const r = add("blank", S("nominal", -1, sha(BLANK))); const p = r.posts[0];
    if (n(r, "posts") !== 1 || p?.verdict !== "reject" || p?.reason !== "blank" || p?.e !== REF_BLANK.e || p?.t !== REF_BLANK.t || !signatureOk(r, p)) v.push("blank : refus signé, motif « blank », métriques et signature conformes"); }
  // contenu altéré : refus signé « hash » (protocole actuel ; décision D-V2)
  { const r = add("altered", S("altered")); const p = r.posts[0];
    if (n(r, "posts") !== 1 || p?.verdict !== "reject" || p?.reason !== "hash" || p?.rawHash !== sha(ALTERED) || p?.rawHash === GOOD_HASH || p?.e !== REF_ALT.e || !signatureOk(r, p)) v.push("altered : hash différent de l'annoncé → refus signé « hash » portant le hash RÉEL du contenu reçu"); }
  // données incomplètes : AUCUN vote
  for (const sc of ["truncated", "stalled", "fault-midway"]) { const r = add(sc, S(sc)); if (n(r, "posts") !== 0 || n(r, "reads") !== 1 || r.facts.pending !== "-" || !logHas(r, "lecture/calcul impossible")) v.push(`${sc} : données incomplètes → aucun POST, lecture tentée, candidat oublié, cause journalisée`); }
  // signature impossible : AUCUN vote
  { const r = add("sign-fail", S("sign-fail")); if (n(r, "posts") !== 0 || !logHas(r, "vote NON envoyé")) v.push("sign-fail : signature impossible → aucun POST, journal « vote NON envoyé »"); }
  // écran inconnu : aucune lecture, aucun vote
  { const r = add("unknown-screen", S("unknown-screen")); if (n(r, "reads") !== 0 || n(r, "posts") !== 0) v.push("unknown-screen : écran inconnu → ni lecture ni vote"); }
  // un seul vote même si le pull annonce de nouveau le candidat
  { const r = add("double", S("double")); if (n(r, "posts") !== 1 || n(r, "validates") !== 2 || n(r, "reads") !== 1) v.push("double : candidat ré-annoncé → 1 seul POST, 1 seule lecture (déjà voté)"); }
  // signature refusée par le serveur : ré-inscription DÉTACHÉE de doValidate
  { const r = add("sig-403", S("sig-403"));
    if (n(r, "posts") !== 1 || n(r, "registers_before_loop") !== 0) v.push("sig-403 : AUCUNE ré-inscription dans doValidate");
    if (n(r, "registers") !== 1 || n(r, "registered") !== 1) v.push("sig-403 : une seule ré-inscription, au tour de loop() suivant");
    if (!logHas(r, "re-register au prochain tour de loop")) v.push("sig-403 : la ré-inscription différée est journalisée"); }
  // 422 : pas de ré-inscription
  { const r = add("hash-422", S("hash-422")); if (n(r, "posts") !== 1 || n(r, "registers") !== 0 || n(r, "registered") !== 1) v.push("hash-422 : un refus 422 ne déclenche aucune ré-inscription"); }
  // S14 : ni affichage, ni carte, ni ACK, ni image, ni observation, œuvre courante inchangée
  for (const [label, r] of all) if (n(r, "vote_acks") !== 0 || n(r, "vote_pullframes") !== 0 || n(r, "vote_obs") !== 0 || n(r, "vote_bus_delta") !== 0 || n(r, "vote_fills_delta") !== 0 || n(r, "vote_sd_writes_delta") !== 0 || n(r, "vote_sd_opens_delta") !== 0 || n(r, "vote_sd_files_delta") !== 0 || r.facts.vote_frame_unchanged !== "1") v.push(`${label} : le vote ne doit produire ni affichage, ni écriture de carte, ni ACK, ni téléchargement d'image, ni observation`);
  return v;
}

/** Les ÉCARTS CONNUS : (identifiant, scénario, vrai si l'écart est observé AUJOURD'HUI). Ordre et contenu = ceux de l'audit § 4. */
const GAPS: Array<{ id: string; sc: string; seed?: number; observed: (r: Result) => boolean; text: string }> = [
  { id: "R-H1", sc: "keys-not-loaded", text: "clés non chargées : le firmware vote quand même, avec une signature INVALIDE", observed: (r) => n(r, "posts") === 1 && !signatureOk(r, r.posts[0]) },
  { id: "R-H2", sc: "v1-announced", text: "candidat v1 (écho du score serveur) : un vote v1 est envoyé", observed: (r) => n(r, "posts") === 1 && "entropy" in r.posts[0] && !("v" in r.posts[0]) },
  { id: "R-H3a", sc: "fault-after-last", text: "défaut collant du client TLS posé avec le dernier octet : le vote part quand même", observed: (r) => n(r, "posts") === 1 },
  { id: "R-H3b", sc: "longer", text: "réponse plus longue que la taille annoncée : le vote part quand même", observed: (r) => n(r, "posts") === 1 },
  { id: "R-H4a", sc: "post-not-executed", text: "POST NON exécuté (-4) : le journal parle de « 403 = signature, 422 = hash »", observed: (r) => n(r, "posts") === 0 && logHas(r, "Echec vote (-4) : 403 = signature") },
  { id: "R-H4b", sc: "post-executed-rejected", text: "POST exécuté mais rejeté localement (-5) : même message trompeur ; le serveur a pourtant compté le vote", observed: (r) => n(r, "posts") === 1 && logHas(r, "Echec vote (-5) : 403 = signature") },
  { id: "R-M1", sc: "guard-on-read", text: "garde de la pile réseau écrasée pendant la lecture du candidat : AUCUN arrêt sûr (le firmware journalise et continue)", observed: (r) => n(r, "guard_fired") === 1 && r.raw.length > 0 },
];

// ─── 1. comportement actuel tenu ──────────────────────────────────────────────────────────────────────────────────────
test("V1 — comportement ACTUEL du vote du TFT : conforme aux règles tenues (référence indépendante, signature vérifiée, aucun vote sur données incomplètes, un seul vote, ni affichage ni ACK, ré-inscription détachée)", { skip }, () => {
  assert.deepEqual(holdViolations(build()), []);
});

// ─── 2. écarts connus ─────────────────────────────────────────────────────────────────────────────────────────────────
test("V1 — ÉCARTS CONNUS (audit § 4) : observés AUJOURD'HUI, liste exacte ; un correctif du lot V2 doit retirer l'écart ET durcir l'assertion", { skip }, () => {
  const exe = build();
  const observed: string[] = [];
  for (const g of GAPS) if (g.observed(run(exe, g.sc, g.seed ?? SEED))) observed.push(g.id);
  assert.deepEqual(observed, GAPS.map((g) => g.id), "écart non observé : corrigé ? (lot V2) retirer l'écart de GAPS et durcir l'assertion correspondante");
  assert.deepEqual(GAPS.map((g) => g.id), ["R-H1", "R-H2", "R-H3a", "R-H3b", "R-H4a", "R-H4b", "R-M1"]);
});

// ─── 3. mutants du sketch : chaque régression est REFUSÉE ─────────────────────────────────────────────────────────────
const firstOnly = (src: string, from: string, to: string) => { const i = src.indexOf(from); assert.ok(i >= 0, `motif obsolète : ${from.slice(0, 70)}`); return src.slice(0, i) + to + src.slice(i + from.length); };
test("V1 — MUTANTS de la voie de vote : chaque régression est REFUSÉE par le harnais", { skip }, () => {
  const muts: Array<[string, (ino: string, h: string) => [string, string]]> = [
    ["le hash annoncé n'est plus comparé au hash calculé", (i, h) => [i, firstOnly(h, 'if (announcedHash != String(c.hash)) return "hash";', 'if (false) return "hash";')]],
    ["la lecture incomplète n'empêche plus le vote", (i, h) => [firstOnly(i, "if (!chk.ok) {", "if (false) {"), h]],
    ["l'échec de la signature n'empêche plus le vote", (i, h) => [firstOnly(i, '{ logf("[VALIDATE2] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return false; }', '{ logf("[VALIDATE2] signature impossible"); }'), h]],
    ["le candidat n'est plus oublié avant le vote v2 (second vote possible)", (i, h) => [firstOnly(i, "if (mode == 1) { pendingCandidateId = \"\"; return doValidateV2(", "if (mode == 1) { return doValidateV2("), h]],
    ["le verdict envoyé est l'inverse du verdict signé", (i, h) => [firstOnly(i, '"\\"verdict\\":\\"" + (accept ? "accept" : "reject")', '"\\"verdict\\":\\"" + (accept ? "reject" : "accept")'), h]],
    ["la métrique e envoyée est celle de t", (i, h) => [firstOnly(i, '"\\"e\\":" + String((unsigned long)chk.m.e)', '"\\"e\\":" + String((unsigned long)chk.m.t)'), h]],
    ["la ré-inscription est faite DANS doValidate", (i, h) => [firstOnly(i, 'registered = false; }   // SD-STACK-FIX1', 'registered = false; doRegister(); }   // SD-STACK-FIX1'), h]],
    ["la signature refusée (403) ne déclenche plus la ré-inscription", (i, h) => [firstOnly(i, 'if (vResp.indexOf("Signature") >= 0) { logf("[VALIDATE2] resynchronisation', 'if (false) { logf("[VALIDATE2] resynchronisation'), h]],
    ["le vote déclenche un ACK", (i, h) => [firstOnly(i, 'reportMem("VALIDATE2-après");\n  return mined;', 'reportMem("VALIDATE2-après");\n  ackFrame(lastFrameId);\n  return mined;'), h]],
    ["le vote touche à l'écran", (i, h) => [firstOnly(i, 'reportMem("VALIDATE2-avant");', 'reportMem("VALIDATE2-avant"); tft.fillScreen(C_BLACK);'), h]],
    ["le vote écrit sur la carte SD", (i, h) => [firstOnly(i, 'reportMem("VALIDATE2-avant");', 'reportMem("VALIDATE2-avant"); { File mf = SD.open("/pod/vote.txt", FILE_WRITE); if (mf) mf.close(); }'), h]],
  ];
  for (const [label, f] of muts) {
    const [ino, hdr] = f(INO_SRC, VOTE_H);
    assert.ok(ino !== INO_SRC || hdr !== VOTE_H, `mutation sans effet : ${label}`);
    const viol = holdViolations(build(ino, hdr));
    assert.notDeepEqual(viol, [], `mutant NON refusé : ${label}`);
  }
});

test("V1 — périmètre : aucun fichier de firmware, de serveur ou de protocole n'est modifié par ce lot (le harnais OBSERVE seulement)", () => {
  assert.match(INO_SRC, /#define POD_RENDER_V1 0\b/); assert.match(INO_SRC, /#define POD_CANARY 0\b/);
  const h = fs.readFileSync(path.join(HOST, "tft28_vote_harness.cpp"), "utf8");
  assert.doesNotMatch(h, /#define\s+POD_CANARY\s+1/);
});
