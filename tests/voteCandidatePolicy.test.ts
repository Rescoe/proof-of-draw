// LOT 1 (28/10/2026) — voter sans perdre le candidat ni la mémoire (station R4 `pod_uno_r4_tft18_env`).
//  • règles pures (pod_vote_policy.h) exécutées sur l'hôte + MUTANTS : chaque règle supprimée doit être détectée ;
//  • invariants du sketch : une frame n'efface plus le candidat, plus de tampon statique de 4 736 o, raisons d'abstention bornées, jamais de faux refus quand l'allocation échoue.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

const root = path.join(__dirname, "..");
const D = path.join(root, "arduino_uno_r4/pod_uno_r4_tft18_env");
const rd = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ino = rd(path.join(D, "pod_uno_r4_tft18_env.ino"));
const cc = findCompiler();

function runHarness(headerDir: string): { status: number | null; lines: string[]; err: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "votepol-"));
  const exe = path.join(tmp, "h");
  const r0 = runProcess(cc.path as string, ["-std=c++11", "-Wall", "-Wextra", "-Werror", `-I${headerDir}`, `-I${D}`, "-o", exe, path.join(root, "consensus-pod/host/vote_policy_harness.cpp")], 60000);
  if (r0.status !== 0) return { status: r0.status, lines: [], err: `${r0.stdout}\n${r0.stderr}` };
  const r = runProcess(exe, [], 30000);
  return { status: r.status, lines: r.stdout.trim().split(/\r?\n/), err: r.stderr };
}

const EXPECTED = [
  "TRY1 1 0", "TRY2 1 0", "TRY3 0 1",                       // deux essais gardés, le troisième abandonne
  "REANNOUNCED gaveup=1",                                   // ré-annoncé par le serveur : ne repart pas
  "OTHER gaveup=0 tries=0",                                 // un autre candidat repart à zéro
  "CLASSIFIED tries=0 keep=1",                              // une issue classée remet le compteur à zéro
  "SCRATCH oled=1024 eink27=0 eink29=4736 tft18=0 tft28=0", // tampon seulement quand le format l'exige
  "TRANSIENT -5:1 -4:1 -2:1 0:1 200:0 204:0 301:0 400:0 403:0 404:0 409:0 422:0 429:0 500:1 503:1",
  "READRETRY -5:1 -4:1 -2:1 0:1 200:1 204:0 301:0 400:0 403:0 404:0 409:0 422:0 429:0 500:1 503:1",
];

test("pod_vote_policy.h : essais par candidat, tampon à la demande, pannes transitoires (code réel sur l'hôte)", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const r = runHarness(D);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.lines, EXPECTED);
});

test("MUTANTS : chaque règle supprimée de pod_vote_policy.h est détectée", { skip: cc.path ? false : describeChoice(cc) }, () => {
  const src = rd(path.join(D, "pod_vote_policy.h"));
  const mutants: [string, string, string][] = [
    ["jamais garder (abandon immédiat)", "return ++t.tries < VOTE_MAX_TRIES;", "return false;"],
    ["toujours garder (boucle sans fin)", "return ++t.tries < VOTE_MAX_TRIES;", "return true;"],
    ["un candidat abandonné repart", "return t.tries >= VOTE_MAX_TRIES;", "return false;"],
    ["l'issue classée ne remet pas à zéro", "static inline void podVoteClassified(PodVoteTries& t) { t.tries = 0; }", "static inline void podVoteClassified(PodVoteTries& t) { (void)t; }"],
    ["un autre candidat ne remet pas à zéro", "t.tries = 0; }\n}\n/** Le candidat a déjà", "}\n}\n/** Le candidat a déjà"],
    ["tampon réservé pour tous les formats", "return k == POD_OLED096 ? 1024 : (k == POD_EINK29BWR ? 4736 : 0);", "return 4736;"],
    ["un refus 4xx est vu comme transitoire", "return code <= 0 || code >= 500;", "return code <= 0 || code >= 400;"],
    ["un téléchargement incomplet n'est pas réessayé", "return podHttpTransient(httpCode) || httpCode == 200;", "return podHttpTransient(httpCode);"],
  ];
  for (const [name, from, to] of mutants) {
    assert.ok(src.includes(from), `mutant « ${name} » : motif introuvable dans l'en-tête`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votepol-mut-"));
    fs.writeFileSync(path.join(dir, "pod_vote_policy.h"), src.replace(from, to));
    const r = runHarness(dir);
    const killed = r.status !== 0 || JSON.stringify(r.lines) !== JSON.stringify(EXPECTED);
    assert.ok(killed, `mutant survivant : ${name}`);
  }
});

function fnBody(name: string): string {
  const i = ino.indexOf(name);
  assert.ok(i >= 0, `${name} introuvable`);
  const m = /\n}\n/.exec(ino.slice(i));
  return ino.slice(i, i + (m ? m.index : 3000));
}

test("sketch : une frame (doFetchFrame) n'efface JAMAIS le candidat en attente — et le contrôle détecte la suppression volontaire du correctif", () => {
  const body = fnBody("static bool doFetchFrame(");
  const clears = (b: string) => /pendingCandidateId\s*=\s*""/.test(b);
  assert.equal(clears(body), false, "doFetchFrame ne doit pas effacer pendingCandidateId");
  assert.equal(clears(body.replace("ackFrame(frameId);", 'pendingCandidateId = ""; ackFrame(frameId);')), true, "mutant : l'effacement réintroduit doit être vu");
  // le candidat n'est retiré que par doValidate (issue classée) ou par l'abandon voteKeepOrDrop
  const outside = ino.split("\n").map((l, n) => ({ l, n })).filter(({ l }) => /pendingCandidateId\s*=\s*""/.test(l) && !/^String pendingCandidateId/.test(l));   // la déclaration globale n'est pas un effacement
  const where = outside.map(({ n }) => { const before = ino.split("\n").slice(0, n + 1).join("\n"); const starts = [...before.matchAll(/\nstatic [^\n]*\{[ \t]*(?:\/\/[^\n]*)?(?=\n)/g)]; if (!starts.length) return "?"; const line = starts[starts.length - 1][0]; const ids = [...line.matchAll(/(\w+)\([^()]*\)\s*(?:const\s*)?\{/g)]; return ids.length ? ids[ids.length - 1][1] : "?"; });
  for (const w of where) assert.ok(["voteKeepOrDrop", "doValidate"].includes(w) || w === "?", `effacement hors du vote : ${w}`);
});

test("sketch : plus de tampon de vote STATIQUE de 4 736 o ; le tampon est pris au tas seulement si le format l'exige, et son échec est une abstention (jamais un refus)", () => {
  assert.equal(/g_voteScratch\[/.test(ino), false, "g_voteScratch retiré");
  const body = fnBody("static void __attribute__((noinline)) netReadCandidate(");
  assert.match(body, /podScratchNeed\(kind\)/);
  assert.match(body, /need \? \(uint8_t\*\)malloc\(need\) : nullptr/);
  assert.match(body, /if \(need && !scratch\) \{[^}]*g_abstainWhy = "memoire"; g_voteRetry = true;/);
  assert.match(body, /free\(scratch\);/);
  assert.match(body, /podCheckStream\(c\.rd, kind, bytes, scratch, need,/);
  // un échec d'allocation n'atteint jamais le verdict : chk remis à zéro puis retour avant la lecture
  const idx = body.indexOf('g_abstainWhy = "memoire"');
  assert.ok(idx > 0 && body.indexOf("return;", idx) > idx && body.indexOf("return;", idx) < body.indexOf("auto tx"), "retour avant toute lecture");
});

test("sketch : raisons d'abstention BORNÉES et stables ; le vote classé retire le candidat, l'échec transitoire le garde", () => {
  const allowed = new Set(["memoire", "pile-reseau", "http", "telechargement", "signature", "post", "ecran-inconnu", ""]);
  const used = [...ino.matchAll(/g_abstainWhy = (?:"([a-z-]*)"|chk\.http == 200 \? "([a-z-]+)" : "([a-z-]+)")/g)].flatMap((m) => [m[1], m[2], m[3]].filter((x) => x !== undefined)) as string[];
  assert.ok(used.length >= 7);
  for (const u of used) assert.ok(allowed.has(u), `raison d'abstention non prévue : ${u}`);
  const dv = fnBody("static bool doValidate()");
  assert.match(dv, /podVoteTrack\(g_vt, pendingCandidateId\.c_str\(\)\);/);
  assert.match(dv, /if \(podVoteGaveUp\(g_vt\)\)/);
  assert.match(dv, /if \(g_voteRetry\) voteKeepOrDrop\(g_abstainWhy\); else \{ pendingCandidateId = ""; podVoteClassified\(g_vt\); \}/);
  assert.match(dv, /if \(podHttpTransient\(vc\)\) voteKeepOrDrop\("validate-candidate"\)/);
  // le POST est « transitoire » seulement quand il n'est PAS parti (-4) : pas de double envoi sur une issue incertaine
  assert.match(ino, /if \(code == -4\) \{ g_abstainWhy = "post"; g_voteRetry = true; \}/);
  assert.equal(/podHttpTransient\(code\)/.test(fnBody("static bool doValidateV2(")), false, "le POST n'utilise pas la règle HTTP générale");
});

test("ESP8266 (BWR, multiscreen e-ink 2,7″ + OLED, e-ink 2,7″ seul) : AUCUNE fonction doFetchFrame* n'efface le candidat en attente ; le BWR ne réserve plus 4 736 o pour tous les formats", () => {
  const sketches = ["esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino", "esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino", "esp8266/esp_eink_2.7BW/esp_eink_2.7BW.ino"];
  const clearsInFetch = (text: string): string[] => {              // fonctions doFetchFrame* qui effacent le candidat
    const bad: string[] = [];
    let fn = "";
    text.split("\n").forEach((l, i) => {
      const m = /^(?:static\s+)?(?:inline\s+)?[A-Za-z_][\w:<>*&\s]*?\s+\**(\w+)\s*\([^;]*\)\s*(?:const\s*)?\{\s*(?:\/\/.*)?$/.exec(l);
      if (m && !/^\s/.test(l) && !/^(if|for|while|switch)\b/.test(l)) fn = m[1];
      if (/pendingCandidateId\s*=\s*""/.test(l) && !/^String pendingCandidateId/.test(l) && /^doFetchFrame/.test(fn)) bad.push(`${fn}:${i + 1}`);
    });
    return bad;
  };
  for (const f of sketches) assert.deepEqual(clearsInFetch(rd(path.join(root, f))), [], `${f} : une frame ne doit pas effacer le candidat`);
  const bwr = rd(path.join(root, sketches[0]));
  assert.equal(/malloc\(POD_SCRATCH_BYTES\)/.test(bwr), false, "plus de réservation systématique de 4 736 o");
  assert.match(bwr, /if \(kind == POD_OLED096 \|\| kind == POD_EINK29BWR\) \{\s*scratchLen = POD_SCRATCH_BYTES;/);
  assert.match(bwr, /\[VOTE\] abstention : memoire/);
  // mutant : réintroduire l'effacement dans une fonction doFetchFrame doit être vu par le contrôle
  const mutated = bwr.replace('lastFrameWasConsensus = (frameSource == "consensus");\n  // LOT 1', 'lastFrameWasConsensus = (frameSource == "consensus");\n  pendingCandidateId = "";\n  // LOT 1');
  assert.notEqual(mutated, bwr, "le motif du mutant existe");
  assert.ok(clearsInFetch(mutated).length >= 1, "mutant : réintroduire l'effacement dans doFetchFrame est vu par le contrôle");
});
