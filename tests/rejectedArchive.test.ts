// tests/rejectedArchive.test.ts — REJECTED-CANDIDATE-ARCHIVE-1 : un candidat refusé ou perdu laisse une entrée dans « Rejetés » ET une copie complète récupérable ; un bloc miné ne laisse rien.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ARCHIVE_LAST_KEY, REJECTED_KEEP, REJECTED_LIST, archiveKey, archiveOnCreate, dropArchive, reconcileLostCandidate, recordRejected, rejectedEntry, type ArchiveKV } from "../lib/rejectedArchive";
import type { Candidate } from "../lib/chain";

function fakeKV() {
  const kv = new Map<string, string>(); const lists = new Map<string, string[]>(); let cmds = 0;
  const api: ArchiveKV = {
    async set(k, v) { cmds++; kv.set(k, v); return "OK"; },
    async get(k) { cmds++; return kv.has(k) ? kv.get(k)! : null; },
    async del(...ks) { cmds++; let n = 0; for (const k of ks) if (kv.delete(k)) n++; return n; },
    async lpush(k, ...vs) { cmds++; const l = lists.get(k) ?? []; l.unshift(...vs); lists.set(k, l); return l.length; },
    async ltrim(k, a, b) { cmds++; const l = lists.get(k) ?? []; lists.set(k, l.slice(a, b + 1)); return "OK"; },
  };
  return { api, kv, lists, cmds: () => cmds };
}
const cand = (id: string): Candidate => ({ candidateId: id, deviceId: "dev_AAAAAAAA", artistName: "Roubzi", poolScreen: "oled096", payload: { screen: "oled096", buffer: "AA==" }, imageHash: "i", actionsHash: "a", drawScore: 14, actionSequence: [], score: 0.47, submittedAt: 1, expiresAt: 2, poolSize: 3, workTitle: "Vote fleur" } as unknown as Candidate);

test("création : copie complète sans expiration + pointeur (2 commandes)", async () => {
  const t = fakeKV(); await archiveOnCreate(t.api, cand("c1"));
  assert.equal(t.cmds(), 2); assert.equal(t.kv.get(ARCHIVE_LAST_KEY), "c1"); assert.equal(JSON.parse(t.kv.get(archiveKey("c1"))!).payload.buffer, "AA==", "payload COMPLET conservé");
});
test("bloc miné : la copie et le pointeur disparaissent, rien dans « Rejetés » (1 commande)", async () => {
  const t = fakeKV(); await archiveOnCreate(t.api, cand("c1")); const before = t.cmds(); await dropArchive(t.api, "c1");
  assert.equal(t.cmds() - before, 1); assert.equal(t.kv.size, 0); assert.equal(t.lists.get(REJECTED_LIST), undefined);
});
test("refus : entrée lisible par l'onglet (mêmes champs), copie CONSERVÉE, pointeur supprimé", async () => {
  const t = fakeKV(); await archiveOnCreate(t.api, cand("c1"));
  const e = await recordRejected(t.api, cand("c1"), "refusé par le réseau (2/3)", 1000);
  const listed = JSON.parse(t.lists.get(REJECTED_LIST)![0]);
  assert.deepEqual(listed, e);
  for (const k of ["deviceId", "screen", "drawScore", "score", "reason", "rejectedAt", "workTitle", "drawArtistName"]) assert.ok(k in listed, k);
  assert.equal(listed.screen, "oled096"); assert.equal(listed.workTitle, "Vote fleur"); assert.equal(listed.drawArtistName, "Roubzi"); assert.equal(listed.candidateId, "c1");
  assert.ok(t.kv.has(archiveKey("c1")), "la copie complète reste récupérable"); assert.ok(!t.kv.has(ARCHIVE_LAST_KEY), "pointeur supprimé : pas de double enregistrement");
});
test("expiration passive : le candidat SUIVANT réconcilie — le précédent est enregistré « expiré ou remplacé sans quorum »", async () => {
  const t = fakeKV(); await archiveOnCreate(t.api, cand("c1"));
  const e = await reconcileLostCandidate(t.api, 5000);
  assert.ok(e); assert.equal(e!.candidateId, "c1"); assert.match(e!.reason, /expiré ou remplacé sans quorum/); assert.equal(t.lists.get(REJECTED_LIST)!.length, 1);
  assert.ok(t.kv.has(archiveKey("c1"))); assert.ok(!t.kv.has(ARCHIVE_LAST_KEY));
  assert.equal(await reconcileLostCandidate(t.api, 6000), null, "idempotent : rien de plus au passage suivant"); assert.equal(t.lists.get(REJECTED_LIST)!.length, 1);
});
test("un candidat miné puis un autre créé : aucune entrée parasite ; refus puis création : pas de doublon", async () => {
  const t = fakeKV(); await archiveOnCreate(t.api, cand("c1")); await dropArchive(t.api, "c1");
  assert.equal(await reconcileLostCandidate(t.api), null); assert.equal(t.lists.get(REJECTED_LIST), undefined);
  await archiveOnCreate(t.api, cand("c2")); await recordRejected(t.api, cand("c2"), "refusé par le comité");
  assert.equal(await reconcileLostCandidate(t.api), null); assert.equal(t.lists.get(REJECTED_LIST)!.length, 1);
});
test("pointeur sans copie, ou copie illisible : nettoyé sans écrire d'entrée ni échouer", async () => {
  const t = fakeKV(); t.kv.set(ARCHIVE_LAST_KEY, "ghost"); assert.equal(await reconcileLostCandidate(t.api), null); assert.ok(!t.kv.has(ARCHIVE_LAST_KEY));
  t.kv.set(ARCHIVE_LAST_KEY, "bad"); t.kv.set(archiveKey("bad"), "pas du json"); assert.equal(await reconcileLostCandidate(t.api), null); assert.ok(!t.kv.has(ARCHIVE_LAST_KEY));
  assert.equal(t.lists.get(REJECTED_LIST), undefined);
});
test("la liste est bornée à 200 entrées (l'app en lit 50)", async () => {
  const t = fakeKV(); for (let i = 0; i < REJECTED_KEEP + 25; i++) await recordRejected(t.api, cand("c" + i), "r", i);
  assert.equal(t.lists.get(REJECTED_LIST)!.length, REJECTED_KEEP); assert.equal(JSON.parse(t.lists.get(REJECTED_LIST)![0]).candidateId, "c" + (REJECTED_KEEP + 24));
});
test("rejectedEntry : champs facultatifs absents => null, nom d'artiste de repli", () => {
  const e = rejectedEntry({ candidateId: "x", deviceId: "d", poolScreen: "tft28", drawScore: 1, score: 0.5 } as never, "r", 9); assert.equal(e.workTitle, null); assert.equal(e.drawArtistName, null);
  assert.equal(rejectedEntry({ ...cand("y"), drawArtistName: undefined } as never, "r", 9).drawArtistName, "Roubzi");
});
test("câblage : submit-candidate réconcilie puis archive ; validation-result enregistre les refus et supprime la copie d'un bloc miné ; toujours rattrapé (jamais bloquant)", () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  const sub = read("app/api/submit-candidate/route.ts"), val = read("app/api/validation-result/route.ts");
  assert.match(sub, /reconcileLostCandidate\([\s\S]*?\.catch\(/); assert.match(sub, /await setCandidate\(candidate\);[\s\S]*?archiveOnCreate\([\s\S]*?\.catch\(/);
  assert.equal((val.match(/recordRejected\(/g) ?? []).length, 2, "refus par le comité ET refus par le réseau");
  assert.match(val, /dropArchive\([\s\S]*?\.catch\(/);
  assert.ok(sub.indexOf("reconcileLostCandidate(") < sub.indexOf("await setCandidate(candidate);"), "réconciliation AVANT la création");
});
