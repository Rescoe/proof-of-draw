// Rapport d'essai (28/10/2026) : le vote CROISÉ est détecté, l'issue est exacte, aucun secret n'apparaît.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { trialOutcome, trialReport, trialRows, type TrialCandidate, type TrialDevice, type TrialVote } from "../lib/trialReport";

const NOW = Date.UTC(2026, 9, 28, 12, 0);
const dev = (id: string, firmware: string, screens: string[]): [string, TrialDevice] => [id, { deviceId: id, firmware, screens }];
const DEVICES = new Map<string, TrialDevice>([dev("dev_BWR00001", "eink29bwr-2.12", ["eink29bwr"]), dev("dev_TFT00001", "r4tft18-2.3", ["tft18"]), dev("dev_MS000001", "multiscreen-2.8", ["oled096", "eink27bw"]), dev("dev_OLD00001", "2.0", ["eink29bwr"])]);
const cand = (over: Partial<TrialCandidate> = {}): TrialCandidate => ({ candidateId: "5992f133-85bf-412e-9960-5c8342b5f500", poolScreen: "tft18", workTitle: "Essai", poolSize: 3, expiresAt: NOW + 10 * 60_000, v2: { e: 120000, t: 30000, r: 8000, rawBytes: 40960 }, ...over });
const v2 = (deviceId: string, over: Partial<TrialVote> = {}): TrialVote => ({ deviceId, v: 2, verdict: "accept", e: 120000, t: 30000, r: 8000, votedAt: NOW - 1000, ...over });

test("vote croisé : un BWR et un multiscreen qui votent un candidat TFT 1,8″ sont comptés ; le TFT qui vote son propre format ne l'est pas", () => {
  const rows = trialRows(cand(), [v2("dev_BWR00001"), v2("dev_TFT00001"), v2("dev_MS000001")], DEVICES);
  assert.deepEqual(rows.map((r) => [r.deviceId, r.crossFormat]), [["dev_BWR00001", true], ["dev_TFT00001", false], ["dev_MS000001", true]]);
  assert.ok(rows.every((r) => r.kind === "v2" && r.metricsMatch === true));
  const rep = trialReport(cand(), [v2("dev_BWR00001"), v2("dev_TFT00001"), v2("dev_MS000001")], DEVICES, null, NOW);
  assert.match(rep, /Votes croisés v2 .*: \*\*2\*\* — dev_BWR00001 \[eink29bwr → tft18\] accept ; dev_MS000001 \[oled096\+eink27bw → tft18\] accept/);
});

test("métriques différentes de la référence : signalées ; refus « blank » visible avec son motif", () => {
  const rows = trialRows(cand(), [v2("dev_BWR00001", { e: 0, t: 0, r: 6987, verdict: "reject", reason: "blank" })], DEVICES);
  assert.equal(rows[0].metricsMatch, false);
  assert.equal(rows[0].reason, "blank");
  assert.match(trialReport(cand(), [v2("dev_BWR00001", { e: 0, t: 0, r: 6987, verdict: "reject", reason: "blank" })], DEVICES, null, NOW), /\| reject \| blank \| NON \|/);
});

test("issue exacte : miné, expiré (les refus ne finalisent rien), en cours (ce qu'il manque)", () => {
  const c = cand({ poolSize: 1 });
  const acc = trialRows(c, [v2("dev_TFT00001")], DEVICES), rej = trialRows(c, [v2("dev_TFT00001", { verdict: "reject", reason: "blank" })], DEVICES);
  assert.match(trialOutcome(c, acc, "mined", NOW), /^BLOC MINÉ — 1 acceptation\(s\), 0 refus, quorum 1 sur un réseau de 1/);
  assert.match(trialOutcome(c, rej, "expired", NOW), /^EXPIRÉ sans décision — 0 acceptation\(s\), 1 refus.*les refus ne finalisent rien/);
  assert.match(trialOutcome(cand(), [], null, NOW), /^EN COURS — 0 acceptation\(s\), 0 refus, quorum 2 sur un réseau de 3 ; manque 2 acceptation\(s\)/);
  assert.match(trialOutcome(cand({ expiresAt: NOW - 1 }), [], null, NOW), /^EXPIRÉ \(non encore réglé\)/);
});

test("animation : vote v1 écho signalé comme tel (contenu non recalculé) ; appareil capable sans vote listé ; électorat figé affiché", () => {
  const a = cand({ kind: "animation", poolScreen: "oled096", v2: null, pool: { total: 4, counted: 2, floor: false, excluded: { inactive: 2 }, maxMissed: 3, at: NOW } });
  const rep = trialReport(a, [{ deviceId: "dev_MS000001", votedAt: NOW }], DEVICES, null, NOW);
  assert.match(rep, /ANIMATION : vote v1 « écho », contenu non recalculé/);
  assert.match(rep, /v1-echo \| accept \(écho v1, contenu non recalculé\)/);
  assert.match(rep, /Électorat au dépôt : 2 compté\(s\) sur 4 : 2 inactif/);
  assert.match(rep, /Appareils capables de voter sans vote enregistré pour ce candidat : .*dev_BWR00001 \(eink29bwr-2\.12\).*dev_TFT00001/);
  assert.equal(rep.includes("dev_OLD00001 (2.0)"), false, "un firmware sans vote v2 n'est pas listé comme capable");
});

test("aucun secret : le rapport ne lit ni MAC, ni code d'appairage, ni clé ; le script n'utilise que le jeton LECTURE SEULE", () => {
  const root = path.join(__dirname, "..");
  const lib = fs.readFileSync(path.join(root, "lib/trialReport.ts"), "utf8"), script = fs.readFileSync(path.join(root, "scripts/trial-report.ts"), "utf8");
  for (const forbidden of [/\bmac\b/i, /pairCode/, /publicKey|privateKey/, /signature/i]) assert.equal(forbidden.test(lib.replace(/\/\/.*$/gm, "")), false, String(forbidden));
  assert.match(script, /KV_REST_API_READ_ONLY_TOKEN/);
  assert.equal(/KV_REST_API_TOKEN\b/.test(script.replace(/KV_REST_API_READ_ONLY_TOKEN/g, "")), false, "aucun repli sur le jeton d'écriture");
  assert.equal(/redis\.(set|del|sadd|srem|lpush|rpush|eval|expire|incr|hset|zadd|pipeline|multi)\(/.test(script), false, "aucune écriture Redis");
  assert.equal(/redis\.(keys|scan|flushdb|flushall)\(/i.test(script), false);
});

test("candidat archivé : seuls les identifiants des votants subsistent — le rapport le dit au lieu d'inventer un verdict", () => {
  const rep = trialReport(cand({ poolSize: 1 }), [{ deviceId: "dev_TFT00001", detailLost: true }], DEVICES, "expired", NOW);
  assert.match(rep, /inconnu \| inconnu \(détail du vote non conservé après expiration\)/);
  assert.match(rep, /EXPIRÉ sans décision — 0 acceptation\(s\), 0 refus, 1 vote\(s\) de détail non conservé/);
  assert.equal(/accept \(écho v1/.test(rep), false);
});
