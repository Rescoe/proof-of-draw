// tests/tft28VoteHarness.test.ts — LOT8B2E V1 (harnais de référence), V2 (sécurité de la voie de vote) puis V3 (phases + VoteWork au tas, marge de pile >= 256 o) : harnais de VOTE de bout en bout du firmware UNO R4 + TFT 2,8″ (PRODUCTION), HÔTE seulement.
//
//   consensus-pod/host/tft28_vote_harness.cpp exécute le sketch complet (réseau scripté, piles dédiées réelles, VRAIE bibliothèque Crypto : SHA-256 et Ed25519) et imprime des FAITS ; CE fichier rend les verdicts avec un calcul
//   INDÉPENDANT : contenu, SHA-256 (Node), métriques (lib/podMetrics.ts), message signé (lib/podVote.ts) et vérification de la signature (lib/ed25519.ts, OpenSSL).
//   V1 avait établi l'état de RÉFÉRENCE et listé huit écarts (R-H1, R-H2, R-H3a, R-H3b, R-H4a, R-H4b, R-H5, R-M1). V2 les CORRIGE : le test affirme maintenant le comportement CORRIGÉ (plus de liste d'écarts).
//   Chaque protection est verrouillée par un ou plusieurs MUTANTS du sketch : supprimer la porte, ignorer `fault`, transformer SENT_UNKNOWN en NOT_SENT, réactiver v1, journaliser avant l'arrêt sûr… est REFUSÉ par la vérification visée.
//   INVARIANT S14 sur tous les scénarios : un vote ne produit ni affichage, ni écriture de carte, ni ACK, ni téléchargement d'image, ni observation.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { ROOT, readText, voteCanaryOffView } from "./helpers/tft28Source";
import { metricsFromRaw } from "../lib/podMetrics";
import { voteMessageV2 } from "../lib/podVote";
import { verifyEd25519 } from "../lib/ed25519";

const choice = findCompiler();
console.log(`[tft28Vote] ${describeChoice(choice)}`);
const cryptoCandidates = [process.env.POD_CRYPTO_SRC, path.join(os.homedir(), "Documents", "Arduino", "libraries", "Crypto", "src"), path.join(os.homedir(), "Arduino", "libraries", "Crypto", "src")].filter((x): x is string => !!x);
const cryptoSrc = cryptoCandidates.find((d) => fs.existsSync(path.join(d, "Ed25519.cpp")));
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skip = false;   // V3 : AUCUN test de ce fichier n'est ignoré silencieusement : le pré-vol « toolchain » ci-dessous ÉCHOUE explicitement si le compilateur ou Crypto sont incompatibles
const fwd = (p: string) => p.replace(/\\/g, "/");
const SK = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4"), HOST = path.join(ROOT, "consensus-pod", "host"), MOCK = path.join(HOST, "tft28");
const INO_SRC = voteCanaryOffView(readText("arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino"));   // V4 : la production (POD_VOTE_CANARY = 0) ; le canari de vote a ses propres tests (tft28VoteCanary.test.ts)
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
function build(ino: string = INO_SRC): string {
  const dir = path.join(tmp, `vh-${nBuild++}`), sk = path.join(dir, "sk"); fs.mkdirSync(sk, { recursive: true });
  for (const f of ["podEdStack.h", "podNetStack.h", "pod_http.h", "pod_bench.h", "pod_bench_stream.h", "pod_metrics.h", "pod_metrics_table.h", "pod_vote_r4.h", "pod_sd_stack.h"]) fs.copyFileSync(path.join(SK, f), path.join(sk, f));
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
const REF = metricsFromRaw("tft28", GOOD), BLANK = content(-1), REF_BLANK = metricsFromRaw("tft28", BLANK);

interface Result { facts: Record<string, string>; posts: Array<Record<string, unknown>>; logs: string[]; raw: string }
const memo = new Map<string, Result>();
function run(exe: string, sc: string, seed = SEED, hash = GOOD_HASH): Result {
  const key = `${exe}|${sc}|${seed}|${hash}`;
  const hit = memo.get(key); if (hit) return hit;
  const r = runProcess(fwd(exe), [sc, String(seed), hash], 120000);
  assert.equal(r.status, 0, `scénario ${sc} : sortie ${r.status}\n${(r.stdout || "").slice(-1500)}${r.stderr || ""}`);
  const facts: Record<string, string> = {}, posts: Array<Record<string, unknown>> = [], logs: string[] = [];
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    if (line.startsWith("FACT ")) { const k = line.slice(5, line.indexOf("=")); facts[k] = line.slice(line.indexOf("=") + 1); }
    else if (line.startsWith("POST ")) posts.push(JSON.parse(line.slice(5)));
    else if (line.startsWith("LOG ")) logs.push(line.slice(4));
  }
  const res = { facts, posts, logs, raw: r.stdout || "" };
  memo.set(key, res);
  return res;
}
const n = (res: Result, k: string) => Number(res.facts[k]);
const signatureOk = (res: Result, p: Record<string, unknown>) => {
  const msg = voteMessageV2({ deviceId: String(p.deviceId), candidateId: String(p.candidateId), rawHash: String(p.rawHash), e: Number(p.e), t: Number(p.t), r: Number(p.r), verdict: p.verdict as "accept" | "reject" });
  return verifyEd25519(res.facts.pubkey, msg, String(p.signature));
};
const logHas = (res: Result, s: string) => res.logs.some((l) => l.includes(s));
const outcomeOf = (res: Result) => { const m = res.logs.map((l) => /issue du vote : (\w+) \(code (-?\d+)\)/.exec(l)).filter(Boolean) as RegExpExecArray[]; return m.map((x) => `${x[1]}:${x[2]}`); };
const CAND = "11111111-2222-3333-4444-555555555555";
const SPENT = CAND;

/** S14 : un vote ne produit ni affichage, ni écriture / ouverture de la carte, ni ACK, ni téléchargement d'image, ni observation ; l'œuvre courante est inchangée. */
function s14(label: string, r: Result): string[] {
  return (n(r, "vote_acks") !== 0 || n(r, "vote_pullframes") !== 0 || n(r, "vote_obs") !== 0 || n(r, "vote_bus_delta") !== 0 || n(r, "vote_fills_delta") !== 0 || n(r, "vote_sd_writes_delta") !== 0 || n(r, "vote_sd_opens_delta") !== 0 || n(r, "vote_sd_files_delta") !== 0 || r.facts.vote_frame_unchanged !== "1"
    ? [`${label} : le vote ne doit produire ni affichage, ni écriture de carte, ni ACK, ni téléchargement d'image, ni observation`] : []);
}
/** Aucun vote, aucune lecture du candidat, aucune signature : la ligne de journal attendue et un candidat oublié (boîte aux lettres vidée après classement). */
function noVote(label: string, r: Result, why: string, opts: { reads?: number; validates?: number } = {}): string[] {
  const v: string[] = [];
  if (n(r, "posts") !== 0) v.push(`${label} : AUCUN POST attendu`);
  if (n(r, "reads") !== (opts.reads ?? 0)) v.push(`${label} : lectures du candidat attendues = ${opts.reads ?? 0}`);
  if (n(r, "validates") !== (opts.validates ?? 0)) v.push(`${label} : requêtes validate-candidate attendues = ${opts.validates ?? 0}`);
  if (!logHas(r, why)) v.push(`${label} : journal « ${why} » attendu`);
  if (r.facts.pending !== "-") v.push(`${label} : candidat oublié après classement`);
  if (r.facts.spent !== "-") v.push(`${label} : un abandon local ne dépense pas le candidat`);
  if (outcomeOf(r).some((o) => !o.startsWith("NOT_SENT"))) v.push(`${label} : aucune issue autre que NOT_SENT`);
  if (n(r, "safe_stop") !== 0) v.push(`${label} : pas d'arrêt sûr`);
  return v;
}

// ─── les VÉRIFICATIONS (chacune = un ensemble de scénarios + un verdict) ─────────────────────────────────────────────────
type Check = (exe: string) => string[];
const CHECKS: Record<string, Check> = {
  // 1. vote v2 nominal, conforme à la référence indépendante
  nominal: (exe) => {
    const v: string[] = []; const r = run(exe, "nominal"); const p = r.posts[0];
    if (n(r, "validates") !== 1 || n(r, "reads") !== 1 || n(r, "posts") !== 1) return ["nominal : 1 validate, 1 lecture du candidat et 1 POST exactement"];
    if (p.v !== 2 || p.rawHash !== GOOD_HASH || p.e !== REF.e || p.t !== REF.t || p.r !== REF.r) v.push("nominal : hash et métriques du POST == référence indépendante (Node / lib/podMetrics.ts)");
    if (p.verdict !== "accept" || "reason" in p) v.push("nominal : verdict accept sans motif");
    if (!signatureOk(r, p)) v.push("nominal : la signature Ed25519 du POST doit se vérifier avec la clé publique de l'appareil (message pod-vote-v2)");
    if (p.deviceId !== r.facts.deviceId || p.candidateId !== r.facts.candidateId) v.push("nominal : identifiants du POST");
    if (r.facts.pending !== "-") v.push("nominal : le candidat est oublié après le classement (pas de second vote possible)");
    if (r.facts.pending_at_post !== CAND) v.push("nominal : pendingCandidateId n'est PAS effacé avant le classement de l'issue (encore posé quand le POST part)");
    if (JSON.stringify(outcomeOf(r)) !== JSON.stringify(["ACCEPTED:200"])) v.push(`nominal : issue ACCEPTED (200) attendue, vue ${outcomeOf(r)}`);
    if (r.facts.spent !== SPENT) v.push("nominal : un vote accepté dépense le candidat");
    if (n(r, "ret") !== 0) v.push("nominal : bloc non miné quand le serveur ne le dit pas");
    const m = run(exe, "mined"); if (n(m, "ret") !== 1 || !logHas(m, "BLOC MINÉ")) v.push("mined : blockMined:true → doValidate retourne vrai");
    const b = run(exe, "nominal", -1, sha(BLANK)); const q = b.posts[0];
    if (n(b, "posts") !== 1 || q?.verdict !== "reject" || q?.reason !== "blank" || q?.e !== REF_BLANK.e || q?.t !== REF_BLANK.t || !signatureOk(b, q)) v.push("blank : refus signé, motif « blank », métriques et signature conformes");
    return v;
  },
  // 10. hash divergent (D-V2 gelée) : ABSTENTION, zéro POST, zéro signature envoyée
  altered: (exe) => { const r = run(exe, "altered"); return noVote("altered (D-V2)", r, "ABSTENTION", { reads: 1, validates: 1 }); },
  // 7. candidat tronqué ; plus : silence, défaut en cours de route
  incomplete: (exe) => { const v: string[] = []; for (const sc of ["truncated", "stalled", "fault-midway"]) v.push(...noVote(sc, run(exe, sc), "lecture/calcul impossible", { reads: 1, validates: 1 })); return v; },
  // 8. taille exacte mais défaut collant du client TLS
  faultSticky: (exe) => noVote("fault-after-last (R-H3a)", run(exe, "fault-after-last"), "lecture du candidat REFUSEE", { reads: 1, validates: 1 }),
  // 9. taille exacte mais lecteur incomplet
  readerIncomplete: (exe) => noVote("longer (R-H3b)", run(exe, "longer"), "lecteur INCOMPLET", { reads: 1, validates: 1 }),
  // signature impossible
  signFail: (exe) => { const r = run(exe, "sign-fail"); const v = noVote("sign-fail", r, "vote NON envoyé", { reads: 1, validates: 1 }); return v; },
  // écran inconnu
  unknownScreen: (exe) => noVote("unknown-screen", run(exe, "unknown-screen"), "écran inconnu", { reads: 0, validates: 1 }),
  // 2-5. porte de sécurité : aucune requête du tout
  gateKeys: (exe) => noVote("keys-not-loaded (R-H1)", run(exe, "keys-not-loaded"), "porte FERMEE : cles non chargees"),
  gateSelfTest: (exe) => noVote("selftest-fail (R-H1)", run(exe, "selftest-fail"), "porte FERMEE : auto-test Ed25519 non reussi"),
  gateRegistered: (exe) => noVote("not-registered (R-H1)", run(exe, "not-registered"), "porte FERMEE : appareil non enregistre"),
  gatePaired: (exe) => noVote("not-paired (R-H1)", run(exe, "not-paired"), "porte FERMEE : appareil non appaire"),
  // 6. candidat v1 : zéro lecture, zéro POST
  v1: (exe) => { const r = run(exe, "v1-announced"); return noVote("v1-announced (R-H2)", r, "AUCUN vote (POD_VOTE_V1 = 0)", { reads: 0, validates: 1 }); },
  // 11. POST non exécuté : -4 => NOT_SENT, message honnête, candidat NON dépensé
  postNotExecuted: (exe) => {
    const r = run(exe, "post-not-executed"); const v: string[] = [];
    if (n(r, "posts") !== 0) v.push("post-not-executed : le POST n'est pas parti");
    if (JSON.stringify(outcomeOf(r)) !== JSON.stringify(["NOT_SENT:-4"])) v.push(`post-not-executed : NOT_SENT (-4) attendu, vu ${outcomeOf(r)}`);
    if (!logHas(r, "NON envoyé") || logHas(r, "PU atteindre") || logHas(r, "403 = signature")) v.push("post-not-executed : journal « NON envoyé » (jamais « 403 = signature »)");
    if (r.facts.spent !== "-") v.push("post-not-executed : la requête n'est pas partie => candidat NON dépensé");
    return v;
  },
  // 12. POST possiblement exécuté, résultat inconnu : -5 et HTTP 5xx
  postUnknown: (exe) => {
    const v: string[] = [];
    for (const [sc, code] of [["post-executed-rejected", -5], ["post-500", 500]] as const) {
      const r = run(exe, sc);
      if (n(r, "posts") !== 1) v.push(`${sc} : le POST est parti (le serveur le voit)`);
      if (JSON.stringify(outcomeOf(r)) !== JSON.stringify([`SENT_UNKNOWN:${code}`])) v.push(`${sc} : SENT_UNKNOWN (${code}) attendu, vu ${outcomeOf(r)}`);
      if (!logHas(r, "PU atteindre le serveur") || logHas(r, "vote NON envoyé") || logHas(r, "403 = signature")) v.push(`${sc} : journal « a PU atteindre le serveur » (jamais « non envoyé »)`);
      if (r.facts.spent !== SPENT) v.push(`${sc} : candidat dépensé (aucune nouvelle tentative automatique)`);
      if (n(r, "registers") !== 0) v.push(`${sc} : aucune ré-inscription déduite d'une issue indéterminée`);
    }
    return v;
  },
  // 18. aucune répétition automatique après SENT_UNKNOWN (et après toute issue qui a pu partir)
  noRepeat: (exe) => {
    const v: string[] = [];
    const u = run(exe, "double-unknown");
    if (n(u, "posts") !== 1 || n(u, "reads") !== 1 || n(u, "validates") !== 1) v.push("double-unknown : après SENT_UNKNOWN, le même candidat ré-annoncé ne produit ni validate, ni lecture, ni POST (1/1/1 au total)");
    if (!logHas(u, "aucune nouvelle tentative automatique")) v.push("double-unknown : refus journalisé");
    const f = run(exe, "double-forgetful");
    if (n(f, "posts") !== 1 || n(f, "reads") !== 1) v.push("double-forgetful : même un serveur qui ne se souvient pas du vote n'est plus revoté (verrou RAM ; le verrou EEPROM persistant est le lot V4)");
    const d = run(exe, "double");
    if (n(d, "posts") !== 1 || n(d, "reads") !== 1) v.push("double : 1 seul POST, 1 seule lecture");
    // NOT_SENT : la requête n'est pas partie => une nouvelle tentative (candidat ré-annoncé) reste PERMISE
    const t = run(exe, "double-notsent");
    if (n(t, "posts") !== 1 || n(t, "reads") !== 2 || n(t, "validates") !== 2 || JSON.stringify(outcomeOf(t)) !== JSON.stringify(["NOT_SENT:-4", "ACCEPTED:200"])) v.push("double-notsent : après NOT_SENT une nouvelle tentative est permise (2 lectures, 1 seul POST au total)");
    return v;
  },
  // 14. refus du serveur (409) ; 15. signature refusée ; 16. hash refusé
  serverRefusals: (exe) => {
    const v: string[] = [];
    const r = run(exe, "post-409");
    if (JSON.stringify(outcomeOf(r)) !== JSON.stringify(["REFUSED_BY_SERVER:409"]) || n(r, "registers") !== 0 || r.facts.registered !== "1" || r.facts.spent !== SPENT) v.push("post-409 : REFUSED_BY_SERVER, aucune ré-inscription, candidat dépensé");
    const s = run(exe, "sig-403");
    if (JSON.stringify(outcomeOf(s)) !== JSON.stringify(["SIGNATURE_REFUSED:403"])) v.push("sig-403 : SIGNATURE_REFUSED (403) attendu");
    if (n(s, "posts") !== 1 || n(s, "registers_before_loop") !== 0) v.push("sig-403 : AUCUNE ré-inscription dans doValidate");
    if (n(s, "registers") !== 1 || n(s, "registered") !== 1) v.push("sig-403 : une seule ré-inscription, au tour de loop() suivant");
    if (!logHas(s, "re-register au prochain tour de loop")) v.push("sig-403 : la ré-inscription différée est journalisée");
    const h = run(exe, "hash-422");
    if (JSON.stringify(outcomeOf(h)) !== JSON.stringify(["HASH_REFUSED:422"]) || n(h, "registers") !== 0 || h.facts.registered !== "1") v.push("hash-422 : HASH_REFUSED (422), aucune ré-inscription");
    return v;
  },
  // 17. GUARD : arrêt sûr AVANT toute sortie — rien n'est écrit après la dernière ligne qui précède la transaction
  guard: (exe) => {
    const v: string[] = [];
    for (const [sc, last, posts] of [["guard-on-read", "[HTTP GET] /api/candidate-frame -> 200", 0], ["guard-on-post", "[VALIDATE2] signature en 0 ms", 1]] as const) {
      const r = run(exe, sc);
      if (n(r, "safe_stop") !== 1) v.push(`${sc} : GUARD => arrêt sûr`);
      if (r.facts.last_log !== last) v.push(`${sc} : AUCUNE ligne de journal après la cause de l'arrêt (dernière ligne attendue : « ${last} », vue « ${r.facts.last_log} »)`);
      if (logHas(r, "pile réseau dédiée")) v.push(`${sc} : le message d'échec de la pile ne doit PAS être journalisé avant l'arrêt sûr`);
      if (n(r, "log_len_at_stop") !== n(r, "log_len_final")) v.push(`${sc} : rien n'est écrit entre l'arrêt et la fin`);
      if (n(r, "posts") !== posts) v.push(`${sc} : POSTs vus par le serveur = ${posts}`);
      if (r.facts.spent !== "-") v.push(`${sc} : aucune issue classée (arrêt avant)`);
    }
    return v;
  },
  // table des issues
  classify: (exe) => {
    const r = runProcess(fwd(exe), ["classify"], 60000); const got = (r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("CLASS "));
    const want = ["200|{}|ACCEPTED", "-4||NOT_SENT", "-2||NOT_SENT", "-1||SENT_UNKNOWN", "-3||SENT_UNKNOWN", "-5||SENT_UNKNOWN", "-6||NOT_SENT", "-7||SENT_UNKNOWN", "403|{\"error\":\"Signature invalide\"}|SIGNATURE_REFUSED", "403|{\"error\":\"autre\"}|REFUSED_BY_SERVER",
      "422|{}|HASH_REFUSED", "400|{}|REFUSED_BY_SERVER", "409|{}|REFUSED_BY_SERVER", "429|{}|REFUSED_BY_SERVER", "500|{}|SENT_UNKNOWN", "503|{}|SENT_UNKNOWN", "302||REFUSED_BY_SERVER",
      "409|Signature|REFUSED_BY_SERVER", "500|Signature|SENT_UNKNOWN", "-5|Signature|SENT_UNKNOWN", "-4|Signature|NOT_SENT"].map((x) => `CLASS ${x}`);
    return got.length === want.length && got.every((l, i) => l === want[i]) ? [] : [`table des issues : attendu ${JSON.stringify(want)}, vu ${JSON.stringify(got)}`];
  },
};
// ─── V3 : VoteWork au tas, nettoyage, échecs de mémoire, usage de g_voteScratch ────────────────────────────────────────────────────
const SAFE_STOP_SCENARIOS = new Set(["guard-on-read", "guard-on-post"]);
/** Un POST est VALIDE s'il est conforme à la référence indépendante (hash, métriques, verdict, identifiants) ET sa signature se vérifie. */
function validPost(res: Result, p: Record<string, unknown>): boolean {
  return p.v === 2 && p.deviceId === res.facts.deviceId && p.candidateId === res.facts.candidateId && p.rawHash === GOOD_HASH && p.e === REF.e && p.t === REF.t && p.r === REF.r && p.verdict === "accept" && !("reason" in p) && signatureOk(res, p);
}
CHECKS.voteWorkFail = (exe) => {
  const v: string[] = []; const r = run(exe, "votework-fail");
  if (n(r, "vw_allocs") !== 1) v.push("votework-fail : une seule allocation de VoteWork tentée");
  if (n(r, "reads") !== 0 || n(r, "posts") !== 0) v.push("votework-fail : AUCUNE lecture du candidat, AUCUN POST");
  if (n(r, "validates") !== 1) v.push("votework-fail : seule la requête validate-candidate a eu lieu");
  if (!logHas(r, "mémoire insuffisante (VoteWork)") || outcomeOf(r).length !== 0) v.push("votework-fail : journal explicite, aucune issue de vote classée");
  if (r.facts.spent !== "-") v.push("votework-fail : NOT_SENT => candidat NON dépensé");
  if (n(r, "vw_live") !== 0) v.push("votework-fail : aucun objet VoteWork vivant");
  // nouvelle tentative permise (le pull ré-annonce le candidat) : elle réussit et ne vote qu'UNE fois
  const d = run(exe, "double-vwfail");
  if (n(d, "vw_allocs") !== 2 || n(d, "posts") !== 1 || n(d, "reads") !== 1 || n(d, "validates") !== 2 || d.facts.spent !== SPENT || n(d, "vw_live") !== 0) v.push("double-vwfail : après un refus d'allocation, la ré-annonce réussit (2 allocations, 1 lecture, 1 POST) et rien ne reste vivant");
  if (d.posts.length === 1 && !validPost(d, d.posts[0])) v.push("double-vwfail : le vote de la seconde tentative est conforme et signé");
  return v;
};
CHECKS.cleanup = (exe) => ALL_SCENARIOS_FOR_S14.filter((sc) => !SAFE_STOP_SCENARIOS.has(sc)).flatMap((sc) => {
  const r = run(exe, sc); const v: string[] = [];
  if (n(r, "vw_live") !== 0) v.push(`${sc} : VoteWork non libéré (fuite) sur ce chemin`);
  if (n(r, "vw_allocs") > 2) v.push(`${sc} : au plus UNE allocation par tentative`);
  return v;
});
/** Échecs de mémoire (String) à CHAQUE point du chemin de vote : jamais un vote tronqué, mal signé ou aux mauvais identifiants ; jamais de fuite. */
CHECKS.memoryFailures = (exe) => {
  const v: string[] = []; const total = n(run(exe, "strcount"), "str_allocs");
  if (!(total >= 30 && total <= 200)) return [`strcount : nombre d'allocations String inattendu (${total})`];
  for (let k = 1; k <= total; k++) {
    const r = run(exe, `strfail:${k}`);
    if (n(r, "posts") > 1) v.push(`strfail:${k} : plus d'un POST`);
    if (n(r, "posts") === 1 && !validPost(r, r.posts[0])) v.push(`strfail:${k} : un POST non conforme / mal signé est parti`);
    if (n(r, "vw_live") !== 0) v.push(`strfail:${k} : VoteWork non libéré`);
    if (n(r, "posts") === 0 && r.facts.spent !== "-") v.push(`strfail:${k} : aucun POST mais candidat dépensé`);
    if (n(r, "safe_stop") !== 0) v.push(`strfail:${k} : arrêt sûr inattendu`);
  }
  return v;
};
// ─── V3-FIX1 : écriture PARTIELLE de la requête (client.print() rend moins d'octets que req.length(), connexion ouverte : des octets ont PU partir) ─────────
CHECKS.partialWrite = (exe) => {
  const v: string[] = []; const r = run(exe, "partial-write");
  if (JSON.stringify(outcomeOf(r)) !== JSON.stringify(["SENT_UNKNOWN:-7"])) v.push(`partial-write : SENT_UNKNOWN (-7) attendu, vu ${outcomeOf(r)}`);
  if (n(r, "posts") !== 1) v.push("partial-write : les octets sont partis, le serveur simulé a vu le POST (jamais classé NOT_SENT)");
  if (r.facts.spent !== SPENT) v.push("partial-write : candidat DÉPENSÉ");
  if (logHas(r, "Vote OK") || logHas(r, "BLOC MINÉ") || logHas(r, "vote NON envoyé") || n(r, "ret") !== 0) v.push("partial-write : aucun succès annoncé, jamais « non envoyé »");
  if (!logHas(r, "PU atteindre le serveur") || n(r, "registers") !== 0 || r.facts.registered !== "1") v.push("partial-write : journal « a PU atteindre le serveur », aucune ré-inscription");
  const d = run(exe, "double-partial");
  if (n(d, "posts") !== 1 || n(d, "reads") !== 1 || n(d, "validates") !== 1 || !logHas(d, "aucune nouvelle tentative automatique")) v.push("double-partial : aucune répétition automatique après l'écriture partielle (1 validate, 1 lecture, 1 POST au total)");
  return v;
};
/** Les chemins image / ACK qui utilisent Conn restent FERMÉS sur une écriture partielle (-7). */
CHECKS.connPaths = (exe) => {
  const v: string[] = [];
  const ok = run(exe, "frame-nominal");
  if (n(ok, "ret") !== 1 || n(ok, "acks") !== 1 || n(ok, "pullframes") !== 1 || n(ok, "bus_delta") !== 153600 || ok.facts.frame_unchanged !== "0") v.push("frame-nominal (sensibilité) : image affichée (153 600 o sur le bus), 1 ACK, œuvre courante remplacée");
  const f = run(exe, "frame-partial");
  if (n(f, "ret") !== 0 || n(f, "acks") !== 0 || n(f, "bus_delta") !== 0 || f.facts.frame_unchanged !== "1") v.push("frame-partial : écriture partielle de la requête d'image => AUCUN affichage, AUCUN ACK, œuvre courante inchangée");
  if (!logHas(f, "pull-frame -> -7") || !f.facts.last_log.includes("image incomplète — pas d'ACK")) v.push("frame-partial : journal honnête (-7, « image incomplète — pas d'ACK »)");
  const a = run(exe, "ack-partial");
  if (!a.facts.last_log.includes("-> FAIL") || logHas(a, "[ACK] frame-nouvelle -> OK")) v.push("ack-partial : l'ACK partiellement écrit est journalisé FAIL, jamais OK");
  return v;
};
/** g_voteScratch est UTILISÉ sur le TFT : le serveur propose n'importe quel écran (app/api/validate-candidate/route.ts) ; un candidat oled096 (1 024 o) exige le tampon de travail. */
const OLED_RAW = Buffer.alloc(1024); for (let i = 0; i < 1024; i++) OLED_RAW[i] = (i * 37 + (i >> 3) * 11 + 5) & 0xff;
CHECKS.scratchUsed = (exe) => {
  const v: string[] = []; const r = run(exe, "oled-candidate", SEED, sha(OLED_RAW)); const m = metricsFromRaw("oled096", OLED_RAW);
  const p = r.posts[0];
  if (n(r, "posts") !== 1 || !p) return ["oled-candidate : un candidat oled096 proposé au TFT doit être voté (le tampon g_voteScratch est UTILISÉ)"];
  if (p.rawHash !== sha(OLED_RAW) || p.e !== m.e || p.t !== m.t || p.r !== m.r) v.push("oled-candidate : hash et métriques == référence indépendante (oled096)");
  if (!signatureOk(r, p)) v.push("oled-candidate : signature valide");
  if (n(r, "vw_live") !== 0) v.push("oled-candidate : VoteWork libéré");
  return v;
};
const ALL_SCENARIOS_FOR_S14 = ["nominal", "mined", "altered", "truncated", "stalled", "fault-midway", "fault-after-last", "longer", "sign-fail", "unknown-screen", "keys-not-loaded", "selftest-fail", "not-registered", "not-paired", "v1-announced", "post-not-executed",
  "post-executed-rejected", "post-500", "post-409", "sig-403", "hash-422", "guard-on-read", "guard-on-post", "double", "double-unknown", "double-forgetful", "double-notsent", "votework-fail", "double-vwfail", "partial-write", "double-partial"];
CHECKS.s14 = (exe) => ALL_SCENARIOS_FOR_S14.flatMap((sc) => s14(sc, run(exe, sc)));
const violationsOf = (exe: string, ids: string[]) => ids.flatMap((id) => CHECKS[id](exe));

// ─── vérifications statiques du sketch (les cinq sites de la pile réseau, le drapeau v1, l'auto-test) ─────────────────────
const SITES: Array<[string, string]> = [["HTTP ", "httpCall"], ["FRAME", "doFetchFrame"], ["VALIDATE2", "netReadCandidate"], ["BENCH", "clip du banc d'essai"], ["ANIM", "netGetBlockClipToSd"]];
function staticViolations(ino: string): string[] {
  const v: string[] = [];
  const fn = /static void __attribute__\(\(noinline\)\) netStackFailed\(const char\* tag, const char\* arg, const PodNetInfo& ni, const char\* tail\) \{\n([\s\S]*?)\n\}\n/.exec(ino);
  if (!fn) return ["netStackFailed absent"];
  if (!/^  if \(ni\.err == POD_NET_GUARD\) logfSafeStop\(\);\n  logf\(/.test(fn[1])) v.push("netStackFailed : logfSafeStop() sur GUARD AVANT tout journal");
  if (fn[1].includes("String") || fn[1].includes("malloc") || fn[1].includes("new ")) v.push("netStackFailed : aucune allocation / String");
  for (const [tag, where] of SITES) if (!new RegExp(`netStackFailed\\("${tag}", `).test(ino)) v.push(`site « ${where} » : doit appeler netStackFailed("${tag}", …)`);
  if ((ino.match(/netStackFailed\(/g) ?? []).length !== 6) v.push("netStackFailed : 1 définition + 5 sites exactement");
  if ((ino.match(/pile réseau dédiée : %s/g) ?? []).length !== 1) v.push("le message « pile réseau dédiée » n'existe que dans netStackFailed");
  if (!/#ifndef POD_VOTE_V1\n#define POD_VOTE_V1 0\n#endif/.test(ino)) v.push("POD_VOTE_V1 vaut 0 par défaut");
  // vue « POD_VOTE_V1 = 0 » : aucun reste de la voie v1
  const view = ino.replace(/#if POD_VOTE_V1\n[\s\S]*?\n#endif\n/g, "");
  if (/doValidateV1|signED25519|"entropy|%d\.%03d/.test(view)) v.push("voie v1 encore atteignable avec POD_VOTE_V1 = 0 (doValidateV1 / signED25519 / entropy / formatage flottant)");
  if (!/g_edSelfTestOk = ok;/.test(ino)) v.push("l'auto-test Ed25519 doit publier son résultat (g_edSelfTestOk)");
  if (!/enum VoteOutcome : uint8_t \{ VOTE_NOT_SENT = 0, VOTE_SENT_UNKNOWN = 1, VOTE_ACCEPTED = 2, VOTE_REFUSED_BY_SERVER = 3, VOTE_SIGNATURE_REFUSED = 4, VOTE_HASH_REFUSED = 5 \};/.test(ino)) v.push("VoteOutcome : six issues exactement");
  if (ino.includes("403 = signature")) v.push("le message trompeur « 403 = signature, 422 = … » est supprimé");
  if (!/if \(!voteGate\(\)\) \{ pendingCandidateId = ""; return false; \}/.test(ino)) v.push("doValidate : porte appelée avant toute requête");
  const gateAt = ino.indexOf("if (!voteGate())"), getAt = ino.indexOf('httpCall("GET", "/api/validate-candidate');
  if (!(gateAt > 0 && gateAt < getAt)) v.push("doValidate : la porte précède /api/validate-candidate");
  // V3 : phases noinline, VoteWork au tas, cadre de doValidateV2 sans gros objet
  for (const f of ["votePhaseRead", "votePhaseSign", "votePhasePost", "voteFinish", "netReadCandidate", "doValidateV2"]) if (!new RegExp(`static [A-Za-z]+ __attribute__\\(\\(noinline\\)\\) ${f}\\(`).test(ino)) v.push(`${f} doit être noinline (phase à cadre propre)`);
  const d2 = /static VoteOutcome __attribute__\(\(noinline\)\) doValidateV2\([^)]*\) \{\n([\s\S]*?)\n\}\n/.exec(ino);
  if (!d2) v.push("doValidateV2 introuvable");
  else {
    if (/PodCheck|uint8_t sig|String body|String msg|podVoteMessage|PodEd::|httpCall\(|snprintf/.test(d2[1])) v.push("doValidateV2 ne porte plus aucun gros objet ni appel profond (tout est dans VoteWork / les phases)");
    if (!/VoteWork\* const w = new \(std::nothrow\) VoteWork\(\);\n  if \(!w\) \{[^\n]*return VOTE_NOT_SENT; \}\n/.test(d2[1])) v.push("VoteWork alloué au tas (nothrow) AVANT toute lecture ; échec => NOT_SENT");
    if ((d2[1].match(/delete w;/g) ?? []).length !== 1 || (d2[1].match(/return /g) ?? []).length !== 2) v.push("un seul delete et deux sorties (échec d'allocation, fin) : VoteWork libéré sur tous les chemins");
    if (d2[1].indexOf("new (std::nothrow) VoteWork") > d2[1].indexOf("votePhaseRead")) v.push("VoteWork alloué avant la phase de lecture");
  }
  if ((ino.match(/new \(std::nothrow\) VoteWork\(\)/g) ?? []).length !== 1) v.push("une seule allocation de VoteWork");
  const phases = ino.slice(ino.indexOf("static bool __attribute__((noinline)) votePhaseRead("), ino.indexOf("static VoteOutcome __attribute__((noinline)) doValidateV2("));
  if (/snprintf|sprintf|bytesToHex\(/.test(phases)) v.push("phases du vote : ni snprintf, ni String temporaire pour la signature (hexadécimal écrit dans VoteWork)");
  if (!/if \(msg\.length\(\) != want\)/.test(phases) || !/if \(!ok\) \{ logf\("\[VALIDATE2\] corps du vote incomplet/.test(phases)) v.push("message et corps du vote contrôlés par leur longueur (aucune troncature silencieuse)");
  if (!/static uint8_t g_voteChunk\[256\];\nstatic uint8_t g_voteScratch\[4736\];/.test(ino)) v.push("g_voteChunk / g_voteScratch restent statiques (voir § 5 du lot V3 : g_voteScratch est utilisé sur le TFT)");
  if (!/if \(!ok\) return -6;\n    if \(!client\.connect\(SERVER_HOST, 443\)\) return -2;\n    const size_t sent = client\.print\(req\);/.test(ino)) v.push("Conn::request : requête construite EN TOUT OU RIEN avant la connexion (-6 si non construite, rien n'est émis)");
  if (/String req = String\(method\)/.test(ino)) v.push("Conn::request : plus de concaténation silencieuse de la requête");
  if (!/const size_t sent = client\.print\(req\);\n    if \(sent != \(size_t\)req\.length\(\)\) return -7;/.test(ino)) v.push("Conn::request : le nombre d'octets écrits est contrôlé (écriture partielle => -7)");
  if (!/if \(code < 0\) return VOTE_SENT_UNKNOWN;/.test(ino) || /code == -7\) return VOTE_NOT_SENT|code == -7 \|\|[^\n]*VOTE_NOT_SENT/.test(ino)) v.push("-7 est SENT_UNKNOWN, jamais NOT_SENT");
  // chaque appelant de Conn::request n'agit que sur HTTP 200 (donc jamais sur -7) ; le canari fait décider l'ACK
  const reqCalls = [...ino.matchAll(/const int code = c\.request\(/g)];
  if (reqCalls.length !== 4) v.push(`4 appelants image / clip / candidat de Conn::request (vu ${reqCalls.length})`);
  for (const m of reqCalls) if (!/code == 200|code == 404/.test(ino.slice(m.index!, m.index! + 700))) v.push("un appelant de Conn::request agit sans tester le code HTTP 200 (donc sur -7)");
  if (!/const bool acked = ackFrame\(frameId\);/.test(ino) || !/if \(!acked\)/.test(ino)) v.push("canari : l'ACK (code != 200, donc aussi -7) décide du succès");
  if (/le prochain cycle votera/.test(ino)) v.push("commentaire faux : après SIGNATURE_REFUSED le candidat courant est DÉPENSÉ, il n'est pas revoté au prochain cycle");
  return v;
}

// ─── PRÉ-VOL toolchain (V3) : explicite, jamais silencieux ─────────────────────────────────────────────────────────────────
test("V3 — PRÉ-VOL : compilateur C++ >= 11, bibliothèques Crypto 0.4.0 et ArduinoJson présentes, bibliothèque Crypto compilable — sinon ÉCHEC avec la cause (aucun test de ce fichier n'est ignoré)", () => {
  assert.ok(choice.path, `aucun compilateur C++ trouvé. ${describeChoice(choice)} — définir CXX (ex. CXX=C:/Users/<vous>/tools/winlibs-14.2/mingw64/bin/g++.exe) et mettre son dossier bin dans PATH.`);
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(choice.version);
  assert.ok(m && Number(m[1]) >= 11, `compilateur INCOMPATIBLE : ${choice.version} (g++ >= 11 exigé : le harnais compile la bibliothèque Crypto réelle et le sketch en gnu++17 ; g++ 10.2 échoue à construire le harnais Crypto — jamais ignoré). Installer WinLibs 14.2 et définir CXX.`);
  assert.ok(cryptoSrc, "bibliothèque Crypto 0.4.0 introuvable : définir POD_CRYPTO_SRC (dossier src de Crypto 0.4.0)");
  assert.ok(ajDir, "ArduinoJson 7.x introuvable : définir ARDUINOJSON_DIR (dossier src)");
  assert.doesNotThrow(() => ensureLib(), `compilation de la bibliothèque Crypto IMPOSSIBLE avec ${choice.version} — toolchain incompatible`);
});

// ─── tests ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("V2 — vérifications STATIQUES du sketch : gestionnaire commun des cinq sites de pile réseau, POD_VOTE_V1 = 0 sans reste de la voie v1, état de l'auto-test, six issues", () => {
  assert.deepEqual(staticViolations(INO_SRC), []);
});
test("V2 — périmètre : drapeaux à 0 ; aucun fichier de serveur, de protocole ni d'affichage touché ; le canari (sans vote) est inchangé", () => {
  assert.match(INO_SRC, /#define POD_RENDER_V1 0\b/); assert.match(INO_SRC, /#define POD_CANARY 0\b/);
  assert.match(INO_SRC, /#else\n\/\/ CANARI SANS VOTE : ni lecture du candidat, ni calcul de métriques, ni signature[\s\S]*?static bool doValidate\(\) \{\n  pendingCandidateId = "";\n  return false;\n\}\n#endif/);
  const h = fs.readFileSync(path.join(HOST, "tft28_vote_harness.cpp"), "utf8");
  assert.doesNotMatch(h, /#define\s+POD_CANARY\s+1/);
});

for (const id of Object.keys(CHECKS)) {
  test(`V2 — vérification « ${id} » sur le firmware corrigé : aucune violation`, { skip }, () => {
    assert.deepEqual(CHECKS[id](build()), []);
  });
}

// ─── mutants : chaque protection supprimée est REFUSÉE par la vérification visée ──────────────────────────────────────────
const firstOnly = (src: string, from: string, to: string) => { const i = src.indexOf(from); assert.ok(i >= 0, `motif obsolète : ${from.slice(0, 80)}`); assert.equal(src.indexOf(from, i + 1), -1, `motif ambigu : ${from.slice(0, 80)}`); return src.slice(0, i) + to + src.slice(i + from.length); };
const GATE = 'const char* why = !keysLoaded ? "cles non chargees" : !g_edSelfTestOk ? "auto-test Ed25519 non reussi" : !registered ? "appareil non enregistre" : !paired ? "appareil non appaire" : nullptr;';
const STOPLOG = '  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf("[%s%s] pile réseau dédiée';
const MUTANTS: Array<[string, (ino: string) => string, string[]]> = [
  ["l'abstention sur hash divergent est supprimée (D-V2)", (i) => firstOnly(i, "if (strcmp(announcedHash.c_str(), w.chk.hash) != 0) {", "if (false) {"), ["altered"]],
  ["le défaut collant du client TLS est ignoré (fault)", (i) => firstOnly(i, "else if (chk.ok && !(rdComplete && rdFault == 0)) {", "else if (chk.ok && !rdComplete) {"), ["faultSticky"]],
  ["le lecteur HTTP incomplet est ignoré (complete)", (i) => firstOnly(i, "else if (chk.ok && !(rdComplete && rdFault == 0)) {", "else if (chk.ok && rdFault != 0) {"), ["readerIncomplete"]],
  ["fault ET complete ignorés", (i) => firstOnly(i, "else if (chk.ok && !(rdComplete && rdFault == 0)) {", "else if (false) {"), ["faultSticky", "readerIncomplete"]],
  ["la porte ignore keysLoaded", (i) => firstOnly(i, GATE, GATE.replace('!keysLoaded ? "cles non chargees" : ', "")), ["gateKeys"]],
  ["la porte ignore l'auto-test Ed25519", (i) => firstOnly(i, GATE, GATE.replace('!g_edSelfTestOk ? "auto-test Ed25519 non reussi" : ', "")), ["gateSelfTest"]],
  ["la porte ignore l'enregistrement", (i) => firstOnly(i, GATE, GATE.replace('!registered ? "appareil non enregistre" : ', "")), ["gateRegistered"]],
  ["la porte ignore l'appairage", (i) => firstOnly(i, GATE, GATE.replace('!paired ? "appareil non appaire" : ', "")), ["gatePaired"]],
  ["la porte n'est plus appelée", (i) => firstOnly(i, "if (!voteGate()) {", "if (false) {"), ["gateKeys", "gateSelfTest", "gateRegistered", "gatePaired"]],
  ["la voie v1 est réactivée (POD_VOTE_V1 = 1)", (i) => firstOnly(i, "#define POD_VOTE_V1 0", "#define POD_VOTE_V1 1"), ["v1"]],
  ["SENT_UNKNOWN devient NOT_SENT", (i) => firstOnly(i, "  if (code < 0) return VOTE_SENT_UNKNOWN;", "  if (code < 0) return VOTE_NOT_SENT;"), ["classify", "postUnknown"]],
  ["-4 n'est plus NOT_SENT", (i) => firstOnly(i, "  if (code == -4 || code == -2 || code == -6) return VOTE_NOT_SENT;", "  if (code == -2 || code == -6) return VOTE_NOT_SENT;"), ["classify", "postNotExecuted"]],
  ["HTTP 5xx n'est plus indéterminé", (i) => firstOnly(i, "  if (code >= 500) return VOTE_SENT_UNKNOWN;\n", ""), ["classify", "postUnknown"]],
  ["la ré-inscription se fonde sur la seule sous-chaîne « Signature »", (i) => firstOnly(i, '  if (code == 403 && resp.indexOf("Signature") >= 0) return VOTE_SIGNATURE_REFUSED;', '  if (resp.indexOf("Signature") >= 0) return VOTE_SIGNATURE_REFUSED;'), ["classify"]],
  ["le candidat n'est plus dépensé après un vote qui a pu partir", (i) => firstOnly(i, "    if (out != VOTE_NOT_SENT) voteMarkSpent(candidateId);", ""), ["noRepeat", "postUnknown", "nominal"]],
  ["NOT_SENT dépense aussi le candidat", (i) => firstOnly(i, "    if (out != VOTE_NOT_SENT) voteMarkSpent(candidateId);", "    voteMarkSpent(candidateId);"), ["noRepeat", "postNotExecuted"]],
  ["le verrou « dépensé » n'est plus consulté", (i) => firstOnly(firstOnly(i, "if (voteSpent(pendingCandidateId)) {", "if (false) {"), "if (voteSpent(candidateId)) {", "if (false) {"), ["noRepeat"]],
  ["le verrou « dépensé » n'est consulté qu'après la requête validate (aucune garde amont)", (i) => firstOnly(i, "if (voteSpent(pendingCandidateId)) {", "if (false) {"), ["noRepeat"]],
  ["pendingCandidateId est effacé AVANT le classement de l'issue", (i) => firstOnly(i, "    const VoteOutcome out = doValidateV2(", '    pendingCandidateId = "";\n    const VoteOutcome out = doValidateV2('), ["nominal"]],
  ["pendingCandidateId n'est jamais effacé après l'issue", (i) => firstOnly(i, '    pendingCandidateId = "";                                // effacé APRÈS le classement de l\'issue\n', ""), ["nominal"]],
  ["le journal précède l'arrêt sûr sur GUARD", (i) => firstOnly(i, STOPLOG, '  logf("[VALIDATE2] avant arret");\n' + STOPLOG), ["guard"]],
  ["l'arrêt sûr sur GUARD est supprimé", (i) => firstOnly(i, STOPLOG, '  logf("[%s%s] pile réseau dédiée'), ["guard"]],
  ["httpCall n'utilise plus le gestionnaire commun", (i) => firstOnly(i, 'netStackFailed("HTTP ", method, ni,', 'logf("[HTTP %s] x", method); (void)('), ["guard"]],
  ["netReadCandidate n'utilise plus le gestionnaire commun", (i) => firstOnly(i, 'netStackFailed("VALIDATE2", "", ni, " — pas de vote");', 'logf("[VALIDATE2] x");'), ["guard"]],
  ["la lecture incomplète n'empêche plus le vote", (i) => firstOnly(i, "if (!w.chk.ok) {", "if (false) {"), ["incomplete", "faultSticky", "readerIncomplete"]],
  ["l'échec de la signature n'empêche plus le vote", (i) => firstOnly(i, '{ logf("[VALIDATE2] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return false; }', '{ logf("[VALIDATE2] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); }'), ["signFail"]],
  ["le verdict envoyé est l'inverse du verdict signé", (i) => firstOnly(i, 'voteAppend(body, w.accept ? "accept" : "reject")', 'voteAppend(body, w.accept ? "reject" : "accept")'), ["nominal"]],
  ["la métrique e envoyée est celle de t", (i) => firstOnly(i, 'voteAppendNum(body, (unsigned long)w.chk.m.e)', 'voteAppendNum(body, (unsigned long)w.chk.m.t)'), ["nominal"]],
  ["la ré-inscription est faite DANS doValidate", (i) => firstOnly(i, "registered = false; break;", "registered = false; doRegister(); break;"), ["serverRefusals"]],
  ["la signature refusée ne déclenche plus la ré-inscription", (i) => firstOnly(i, "registered = false; break;", "break;"), ["serverRefusals"]],
  ["SENT_UNKNOWN est journalisé « vote NON envoyé »", (i) => firstOnly(i, "vote a PU atteindre le serveur, issue INDÉTERMINÉE — aucune nouvelle tentative automatique de ce candidat", "vote NON envoyé : la requête n'a pas été émise"), ["postUnknown"]],
  ["le vote déclenche un ACK", (i) => firstOnly(i, 'reportMem("VALIDATE2-après");\n  return out;', 'reportMem("VALIDATE2-après");\n  ackFrame(lastFrameId);\n  return out;'), ["s14"]],
  ["le vote touche à l'écran", (i) => firstOnly(i, 'reportMem("VALIDATE2-avant");', 'reportMem("VALIDATE2-avant"); tft.fillScreen(C_BLACK);'), ["s14"]],
  ["le vote écrit sur la carte SD", (i) => firstOnly(i, 'reportMem("VALIDATE2-avant");', 'reportMem("VALIDATE2-avant"); { File mf = SD.open("/pod/vote.txt", FILE_WRITE); if (mf) mf.close(); }'), ["s14"]],
  // V3
  ["la requête HTTP tronquée en silence est envoyée quand même (-6 supprimé)", (i) => firstOnly(i, "    if (!ok) return -6;\n", ""), ["memoryFailures"]],
  ["-6 (requête non construite) n'est plus NOT_SENT", (i) => firstOnly(i, "  if (code == -4 || code == -2 || code == -6) return VOTE_NOT_SENT;", "  if (code == -4 || code == -2) return VOTE_NOT_SENT;"), ["classify"]],
  ["l'écriture partielle de la requête est ignorée (-7 supprimé)", (i) => firstOnly(i, "if (sent != (size_t)req.length()) return -7;", ""), ["partialWrite", "connPaths"]],
  ["-7 (écriture partielle) est classé NOT_SENT", (i) => firstOnly(i, "  if (code == -4 || code == -2 || code == -6) return VOTE_NOT_SENT;", "  if (code == -4 || code == -2 || code == -6 || code == -7) return VOTE_NOT_SENT;"), ["classify", "partialWrite"]],
  ["VoteWork n'est plus libéré", (i) => firstOnly(i, "  delete w;", ""), ["cleanup", "voteWorkFail"]],
  ["l'échec d'allocation de VoteWork est ignoré", (i) => firstOnly(i, "  if (!w) { logf(", "  if (false) { logf("), ["voteWorkFail"]],
  ["la signature est tentée même si la lecture a échoué", (i) => firstOnly(i, "votePhaseRead(*w, candidateId, screenName, bytes, announcedHash) && votePhaseSign(*w, candidateId)", "(votePhaseRead(*w, candidateId, screenName, bytes, announcedHash) || true) && votePhaseSign(*w, candidateId)"), ["incomplete", "altered"]],
  ["le contrôle de longueur du message signé est supprimé", (i) => firstOnly(i, "if (msg.length() != want) {", "if (false) {"), ["memoryFailures"]],
  ["le contrôle de complétude du corps est supprimé", (i) => firstOnly(i, '  if (!ok) { logf("[VALIDATE2] corps du vote incomplet', '  if (false) { logf("[VALIDATE2] corps du vote incomplet'), ["memoryFailures"]],
  ["voteAppend ne contrôle plus la longueur ajoutée", (i) => firstOnly(i, "  return s.length() == n + (unsigned)strlen(p);", "  return true;"), ["memoryFailures"]],
  ["g_voteScratch réduit à 1 octet (le candidat OLED n'est plus votable)", (i) => firstOnly(i, "static uint8_t g_voteScratch[4736];", "static uint8_t g_voteScratch[1];"), ["scratchUsed"]],
];
test(`V2 — MUTANTS exécutés (${MUTANTS.length}) : chaque protection supprimée est REFUSÉE par la vérification visée`, { skip }, () => {
  for (const [label, edit, ids] of MUTANTS) {
    const ino = edit(INO_SRC);
    assert.notEqual(ino, INO_SRC, `mutation sans effet : ${label}`);
    let viol: string[];
    try { viol = violationsOf(build(ino), ids); } catch (e) { viol = [`harnais en échec : ${String(e).slice(0, 200)}`]; }   // un mutant qui fait boucler ou planter est aussi refusé
    assert.notDeepEqual(viol, [], `mutant NON refusé par ${ids.join(" / ")} : ${label}`);
  }
});

// ─── mutants STATIQUES (sites non exécutables par ce harnais : doFetchFrame, banc d'essai, clip historique) ───────────────────
test("V2 — MUTANTS statiques : un site de pile réseau qui retourne à son journal propre, un arrêt sûr placé après le journal, un drapeau v1 à 1 ou un auto-test muet sont REFUSÉS", () => {
  const muts: Array<[string, (i: string) => string]> = [
    ["doFetchFrame journalise lui-même", (i) => firstOnly(i, 'netStackFailed("FRAME", "", ni, " — pas d\'ACK ; l\'écran a pu être partiellement ou totalement redessiné");', 'logf("[FRAME] pile réseau dédiée : %s", podNetWhy(ni));')],
    ["le clip du banc d'essai journalise lui-même", (i) => firstOnly(i, 'netStackFailed("BENCH", "", ni, " — clip NON retenu");', 'logf("[BENCH] pile réseau dédiée : %s", podNetWhy(ni));')],
    ["netGetBlockClipToSd journalise lui-même", (i) => firstOnly(i, 'netStackFailed("ANIM", "", ni, " — clip NON retenu");', 'logf("[ANIM] pile réseau dédiée : %s", podNetWhy(ni));')],
    ["le gestionnaire commun journalise avant l'arrêt sûr", (i) => firstOnly(i, STOPLOG, '  logf("[%s%s] pile réseau dédiée : %s", tag, arg, podNetWhy(ni));\n  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf("[%s%s] pile réseau dédiée')],
    ["POD_VOTE_V1 vaut 1", (i) => firstOnly(i, "#define POD_VOTE_V1 0", "#define POD_VOTE_V1 1")],
    ["l'auto-test Ed25519 ne publie plus son résultat", (i) => firstOnly(i, "  g_edSelfTestOk = ok;", "")],
    ["doValidateV1 hors de #if POD_VOTE_V1", (i) => firstOnly(i, "#if POD_VOTE_V1\n// Ancien chemin", "#if 1\n// Ancien chemin")],
  ];
  for (const [label, f] of muts) assert.notDeepEqual(staticViolations(f(INO_SRC)), [], `mutant statique NON refusé : ${label}`);
});

test("V3 — MESURE ARCHIVÉE (analyse statique de l'ELF de production, cœur 1.6.0) : marge de la pile principale >= 256 o sur TOUTES les voies du vote, >= 320 o sur le chemin nominal ; V2 : 152 o", () => {
  const rows = (f: string) => new Map(readText(`docs/mesures/8B2E_V3_2026_10_13/${f}`).split("\n").filter((l) => l.startsWith("| ")).map((l) => { const c = l.split("|").map((x) => x.trim()); return [c[1], Number(c[7])] as [string, number]; }));
  const v3 = rows("pile-principale-statique-v3_off_160.txt"), v2 = rows("pile-principale-statique-v2_off_160.txt");
  for (const f of ["doValidateV2", "votePhaseRead", "votePhaseSign", "votePhasePost", "voteFinish", "netReadCandidate", "httpCall", "doValidateDecode"]) assert.ok(v3.get(f)! >= 256, `${f} : marge ${v3.get(f)} o < 256 o`);
  assert.ok(v3.get("doValidateV2")! >= 320, `chemin nominal du vote : marge ${v3.get("doValidateV2")} o < 320 o (objectif)`);
  assert.equal(v2.get("doValidateV2"), 152, "référence V2 : 152 o");
});

test("V2 — la liste des écarts V1 est soldée : R-H1, R-H2, R-H3a, R-H3b, R-H4a, R-H4b, R-H5 et R-M1 sont tous corrigés (les vérifications ci-dessus le prouvent) ; R-B3 reste partiel (verrou RAM seulement)", { skip }, () => {
  const exe = build();
  const f = run(exe, "double-forgetful");
  assert.equal(n(f, "posts"), 1, "serveur sans mémoire : un second vote n'est plus envoyé tant que le démarrage dure");
  assert.equal(f.facts.spent, SPENT);
});
