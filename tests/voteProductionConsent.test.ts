// tests/voteProductionConsent.test.ts — LOT TFT28-PROD-VOTE-CANARY-1 : contrôle hors ligne des épingles (scripts/check-vote-pins.js) avec le consentement LOCAL au vote réel sur la production.
//   production SANS consentement : refusée ; AVEC consentement : acceptée avec l'avertissement « VOTE RÉEL SUR PRODUCTION » ; consentement + autre hôte : refusé ; valeur invalide : refusée ;
//   alias de production : refusé même avec consentement ; fichier d'hôte d'appairage : la production n'y est jamais admise ; contrôles UUID / hash / fichier ignoré et non suivi conservés.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers/tft28Source";
import { ownTmp } from "./helpers/ownTmp";

const tmp = ownTmp("voteprod-");   // supprimé à la sortie du processus
const SCRIPT = path.join(ROOT, "scripts", "check-vote-pins.js");
const ID = "123e4567-e89b-12d3-a456-426614174000", HASH = "a".repeat(64), PROD = "proof-of-draw.vercel.app";
let n = 0;
function pins(lines: string[], name = "pod_vote_pins.h"): string {
  const dir = path.join(tmp, `p-${n++}`); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name); fs.writeFileSync(f, lines.join("\n") + "\n"); return f;
}
const base = (host: string, extra: string[] = [], id = ID, hash = HASH) => [`#define POD_VOTE_BACKEND_HOST "${host}"`, `#define POD_VOTE_PIN_ID "${id}"`, `#define POD_VOTE_PIN_HASH "${hash}"`, ...extra];
function check(file: string) { const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf8" }); return { status: r.status, out: String(r.stdout), err: String(r.stderr) }; }

test("PRODUCTION — sans consentement : REFUSÉE (hôte de production exact)", () => {
  const r = check(pins(base(PROD)));
  assert.equal(r.status, 1); assert.match(r.err, /hôte = PRODUCTION : refusé SANS le consentement local/);
});
test("PRODUCTION — consentement commenté ou à 0 : REFUSÉE", () => {
  assert.equal(check(pins(base(PROD, ["// #define POD_VOTE_ALLOW_PRODUCTION 1"]))).status, 1);
  assert.equal(check(pins(base(PROD, ["#define POD_VOTE_ALLOW_PRODUCTION 0"]))).status, 1);
});
test("PRODUCTION — avec le consentement local : ACCEPTÉE, avec l'avertissement « VOTE RÉEL SUR PRODUCTION »", () => {
  const r = check(pins(base(PROD, ["#define POD_VOTE_ALLOW_PRODUCTION 1"])));
  assert.equal(r.status, 0, r.err); assert.match(r.out, /ATTENTION : VOTE RÉEL SUR PRODUCTION/); assert.match(r.out, /PRODUCTION, consentement local/);
});
test("PRODUCTION — le consentement ne s'applique QU'à l'hôte de production exact : autre hôte, alias et casse sont refusés", () => {
  const a = check(pins(base("iso-preview.example.test", ["#define POD_VOTE_ALLOW_PRODUCTION 1"])));
  assert.equal(a.status, 1); assert.match(a.err, /consentement incohérent/);
  const b = check(pins(base("preview.proof-of-draw.vercel.app", ["#define POD_VOTE_ALLOW_PRODUCTION 1"])));
  assert.equal(b.status, 1); assert.match(b.err, /alias de production/);
  const c = check(pins(base("PROOF-OF-DRAW.VERCEL.APP", ["#define POD_VOTE_ALLOW_PRODUCTION 1"])));
  assert.equal(c.status, 1);   // majuscules : nom de domaine en minuscules exigé
});
test("PRODUCTION — valeur de consentement invalide : REFUSÉE", () => {
  for (const v of ["2", "true", "yes", ""]) assert.equal(check(pins(base(PROD, [`#define POD_VOTE_ALLOW_PRODUCTION ${v}`]))).status, 1, `valeur « ${v} » aurait dû être refusée`);
});
test("PRODUCTION — les contrôles UUID et hash restent actifs AVEC le consentement", () => {
  assert.equal(check(pins(base(PROD, ["#define POD_VOTE_ALLOW_PRODUCTION 1"], "pas-un-uuid"))).status, 1);
  assert.equal(check(pins(base(PROD, ["#define POD_VOTE_ALLOW_PRODUCTION 1"], ID, "A".repeat(64)))).status, 1);
  assert.equal(check(pins(base(PROD, ["#define POD_VOTE_ALLOW_PRODUCTION 1"], ID, "a".repeat(63)))).status, 1);
  assert.equal(check(pins(["#define POD_VOTE_BACKEND_HOST \"<hote>\"", "#define POD_VOTE_ALLOW_PRODUCTION 1"])).status, 1);
});
test("PRODUCTION — le fichier d'hôte d'appairage (pod_preview_host.h) n'admet JAMAIS la production, consentement ou non", () => {
  assert.equal(check(pins([`#define POD_PREVIEW_HOST "${PROD}"`], "pod_preview_host.h")).status, 1);
  assert.equal(check(pins([`#define POD_PREVIEW_HOST "${PROD}"`, "#define POD_VOTE_ALLOW_PRODUCTION 1"], "pod_preview_host.h")).status, 1);
  assert.equal(check(pins(['#define POD_PREVIEW_HOST "iso-preview.example.test"'], "pod_preview_host.h")).status, 0);
});
test("PRODUCTION — fichier du dépôt : le modèle est refusé, un pod_vote_pins.h local serait ignoré et non suivi (contrôle git conservé)", () => {
  const ex = check(path.join(ROOT, "arduino_uno_r4", "pod_uno_r4", "pod_vote_pins.h.example"));
  assert.equal(ex.status, 1);
  const ls = spawnSync("git", ["ls-files", "--", "arduino_uno_r4"], { cwd: ROOT, encoding: "utf8" }).stdout || "";
  assert.ok(!/pod_vote_pins\.h$/m.test(ls), "pod_vote_pins.h SUIVI par git");
  assert.equal(spawnSync("git", ["check-ignore", "-q", "arduino_uno_r4/pod_uno_r4/pod_vote_pins.h"], { cwd: ROOT }).status, 0, "pod_vote_pins.h doit être ignoré par git");
  assert.match(fs.readFileSync(path.join(ROOT, "arduino_uno_r4", "pod_uno_r4", "pod_vote_pins.h.example"), "utf8"), /\/\/ #define POD_VOTE_ALLOW_PRODUCTION 1/, "le modèle ne doit proposer le consentement qu'en commentaire");
});

// ── Précondition : SAUVEGARDE du candidat avant le vote (scripts/verify-candidate-backup.ts) ──────────────────────────────────────────
import { createHash } from "node:crypto";
const VERIFY = path.join(ROOT, "scripts", "verify-candidate-backup.ts");
const RAW = Buffer.alloc(153600); for (let i = 0; i < RAW.length; i++) RAW[i] = (i * 31 + (i >> 8)) & 0xff;
const RAW_HASH = createHash("sha256").update(RAW).digest("hex");
const cand = (over: Record<string, unknown> = {}) => ({ candidateId: ID, deviceId: "dev_ABCD1234", artistName: "x", poolScreen: "tft28", payload: { screen: "tft28", buffer: RAW.toString("base64") }, imageHash: "i".repeat(64), actionsHash: "a".repeat(64), drawScore: 1, score: 0.5, submittedAt: Date.now() - 1000, expiresAt: Date.now() + 3_600_000, poolSize: 1, v2: { screen: "tft28", rawBytes: 153600, rawHash: RAW_HASH }, ...over });
function verify(obj: unknown, pinsLines?: string[]) {
  const dir = path.join(tmp, `b-${n++}`); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "export.json"); fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj));
  const args = ["--import", "tsx", VERIFY, f]; if (pinsLines) { const pf = path.join(dir, "pod_vote_pins.h"); fs.writeFileSync(pf, pinsLines.join("\n") + "\n"); args.push(pf); }
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: ROOT }); return { status: r.status, out: String(r.stdout), err: String(r.stderr) };
}
const pinsFor = (id: string, hash: string) => [`#define POD_VOTE_BACKEND_HOST "${PROD}"`, `#define POD_VOTE_PIN_ID "${id}"`, `#define POD_VOTE_PIN_HASH "${hash}"`, "#define POD_VOTE_ALLOW_PRODUCTION 1"];

test("SAUVEGARDE — une sauvegarde complète et cohérente est acceptée (avec et sans épingles)", () => {
  assert.equal(verify(cand()).status, 0);
  const r = verify(cand(), pinsFor(ID, RAW_HASH)); assert.equal(r.status, 0, r.err); assert.match(r.out, /épingles identiques/);
});
test("SAUVEGARDE — refus : image absente (export tronqué), contenu qui ne correspond pas au hash, taille ou écran différents, métadonnée manquante, candidat expiré, JSON invalide", () => {
  const bad: Array<[string, unknown]> = [
    ["payload absent", cand({ payload: {} })], ["buffer vide", cand({ payload: { buffer: "" } })],
    ["contenu altéré", cand({ payload: { screen: "tft28", buffer: Buffer.concat([RAW.subarray(0, 100), Buffer.from([RAW[100] ^ 1]), RAW.subarray(101)]).toString("base64") } })],
    ["contenu trop court", cand({ payload: { screen: "tft28", buffer: RAW.subarray(0, 1000).toString("base64") } })],
    ["rawBytes différent", cand({ v2: { screen: "tft28", rawBytes: 153599, rawHash: RAW_HASH } })], ["écran différent", cand({ v2: { screen: "oled096", rawBytes: 153600, rawHash: RAW_HASH } })],
    ["rawHash différent", cand({ v2: { screen: "tft28", rawBytes: 153600, rawHash: "0".repeat(64) } })], ["rawHash absent", cand({ v2: { screen: "tft28", rawBytes: 153600 } })],
    ["candidateId invalide", cand({ candidateId: "pas-un-uuid" })], ["deviceId manquant", cand({ deviceId: undefined })], ["actionsHash manquant", cand({ actionsHash: undefined })],
    ["expiresAt manquant", cand({ expiresAt: undefined })], ["candidat expiré", cand({ expiresAt: Date.now() - 1 })], ["JSON invalide", "{pas du json"],
  ];
  for (const [label, obj] of bad) assert.equal(verify(obj).status, 1, `« ${label} » aurait dû être refusé`);
});
test("SAUVEGARDE — refus : les épingles ne correspondent pas à la sauvegarde (identifiant ou hash)", () => {
  assert.equal(verify(cand(), pinsFor("123e4567-e89b-12d3-a456-426614174999", RAW_HASH)).status, 1);
  assert.equal(verify(cand(), pinsFor(ID, "b".repeat(64))).status, 1);
});
