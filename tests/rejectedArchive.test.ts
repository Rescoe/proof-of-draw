// tests/rejectedArchive.test.ts — REJECTED-CANDIDATE-ARCHIVE-1 + FIX1 : un candidat refusé ou perdu laisse une entrée dans « Rejetés » ET une copie récupérable, BORNÉE ; un bloc miné ne laisse rien ;
// chaque transition est atomique, idempotente, et ne touche jamais le pointeur d'un autre candidat.
// Les scripts Lua sont exécutés pour de VRAI (fengari) quand il est disponible (FENGARI_DIR) ; le même scénario tourne contre un miroir JavaScript (toujours exécuté).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ARCHIVE_LAST_KEY, ARCHIVE_PREFIX, ARCHIVE_TTL_SEC, CAD_SCRIPT, CREATE_SCRIPT, FINALIZE_SCRIPT, REJECTED_KEEP, REJECTED_LIST,
  archiveKey, archiveOnCreate, dropArchive, finalKey, reconcileLostCandidate, recordRejected, rejectedEntry, type ArchiveKV,
} from "../lib/rejectedArchive";
import type { Candidate } from "../lib/chain";
import { MiniRedis, loadFengari, runLua } from "./helpers/miniRedis";

const fengari = loadFengari();

/** Miroir JavaScript (même sémantique que les scripts) — sert de contrôle croisé et garantit un test même sans fengari. */
function mirror(store: MiniRedis, script: string, keys: string[], args: string[]): number {
  const g = (k: string) => store.exec(["GET", k]) as string | null;
  if (script === CREATE_SCRIPT) { store.exec(["SET", keys[0], args[0], "EX", args[2]]); store.exec(["SET", keys[1], args[1]]); return 1; }
  if (script === CAD_SCRIPT) { return g(keys[0]) === args[0] ? (store.exec(["DEL", keys[0]]) as number) : 0; }
  if (script === FINALIZE_SCRIPT) {
    const [kind, id, entry, keep, finalTtl, archTtl, prefix] = args;
    if (kind === "expired" && store.exec(["EXISTS", keys[4]]) === 1) return 2;
    if (store.exec(["SET", keys[0], kind, "NX", "EX", finalTtl]) === null) { if (g(keys[2]) === id) store.exec(["DEL", keys[2]]); return 0; }
    if (kind === "mined") store.exec(["DEL", keys[1]]);
    else {
      store.exec(["LPUSH", keys[3], entry]);
      const old = store.exec(["LRANGE", keys[3], keep, "-1"]) as string[];
      if (old.length > 0) { store.exec(["LTRIM", keys[3], "0", String(Number(keep) - 1)]); for (const e of old) { try { const d = JSON.parse(e); if (typeof d?.candidateId === "string") store.exec(["DEL", prefix + d.candidateId]); } catch { /* ignoré */ } } }
      store.exec(["EXPIRE", keys[1], archTtl]);
    }
    if (g(keys[2]) === id) store.exec(["DEL", keys[2]]);
    return 1;
  }
  throw new Error("script inconnu");
}

type Engine = "lua" | "miroir";
const engines: { name: Engine; skip: string | false }[] = [{ name: "miroir", skip: false }, { name: "lua", skip: fengari ? false : "fengari absent (définir FENGARI_DIR) — scripts Lua NON exécutés ici" }];

function world(engine: Engine) {
  const store = new MiniRedis();
  let evalFail = 0;   // N-ième eval qui échoue AVANT d'être appliqué (connexion perdue) ; 0 = aucun
  let evals = 0;
  const kv: ArchiveKV = {
    async get(k) { return store.exec(["GET", k]); },
    async eval(script, keys, args) {
      evals++;
      if (evalFail && evals === evalFail) { evalFail = 0; throw new Error("connexion perdue avant l'exécution"); }
      return engine === "lua" ? runLua(fengari!, store, script, keys, args) : mirror(store, script, keys, args);
    },
  };
  return { store, kv, failEval: (n: number) => { evals = 0; evalFail = n; } };
}

const cand = (id: string, extra: Record<string, unknown> = {}): Candidate => ({ candidateId: id, deviceId: "dev_AAAAAAAA", artistName: "Roubzi", poolScreen: "oled096", payload: { screen: "oled096", buffer: "A".repeat(1024) }, imageHash: "i", actionsHash: "a", drawScore: 14, actionSequence: [], score: 0.47, submittedAt: 1, expiresAt: 2, poolSize: 3, workTitle: "Vote fleur", ...extra } as unknown as Candidate);
const archives = (s: MiniRedis) => [...s.kv.keys()].filter((k) => k.startsWith(ARCHIVE_PREFIX));
const list = (s: MiniRedis) => (s.lists.get(REJECTED_LIST) ?? []).map((e) => JSON.parse(e));

for (const { name, skip } of engines) {
  const T = (title: string, fn: (w: ReturnType<typeof world>) => Promise<void> | void) => test(`[${name}] ${title}`, { skip }, async () => { await fn(world(name)); });

  T("création : copie complète avec TTL de sécurité + pointeur, en UNE commande", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    assert.equal(w.store.commands, 2 /* SET + SET dans le script ; le script compte 2 commandes Redis, 1 EVAL côté réseau */);
    assert.equal(w.store.kv.get(ARCHIVE_LAST_KEY), "c1");
    assert.equal(JSON.parse(w.store.kv.get(archiveKey("c1"))!).payload.buffer.length, 1024, "payload COMPLET conservé");
    assert.equal(w.store.ttl.get(archiveKey("c1")), ARCHIVE_TTL_SEC, "filet de sécurité : TTL de 90 jours");
  });

  T("bloc miné : copie et pointeur disparaissent, rien dans « Rejetés », et plus JAMAIS enregistrable (idempotent)", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    await dropArchive(w.kv, "c1"); await dropArchive(w.kv, "c1");   // répétition de la même finalisation
    assert.equal(archives(w.store).length, 0); assert.equal(w.store.kv.has(ARCHIVE_LAST_KEY), false); assert.equal(list(w.store).length, 0);
    assert.equal(await recordRejected(w.kv, cand("c1"), "refusé trop tard"), null, "un candidat miné n'est jamais rejeté");
    assert.equal(list(w.store).length, 0);
    assert.equal(w.store.kv.get(finalKey("c1")), "mined");
  });

  T("candidat miné jamais ajouté à rejected:draws, même si la copie et le pointeur survivent (suppression ratée) puis réconciliation", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    w.store.kv.set(finalKey("c1"), "mined");            // le marqueur « miné » a été posé, la suite de la finalisation n'a pas eu lieu
    assert.equal(await reconcileLostCandidate(w.kv), null, "pas de faux rejet");
    assert.equal(list(w.store).length, 0);
    assert.equal(w.store.kv.has(ARCHIVE_LAST_KEY), false, "pointeur nettoyé (il était le sien)");
  });

  T("refus : entrée lisible par l'onglet (mêmes champs), copie CONSERVÉE, pointeur supprimé, UNE seule entrée même si répété", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    const e = await recordRejected(w.kv, cand("c1"), "refusé par le réseau (2/3)", 1000);
    assert.ok(e); assert.deepEqual(list(w.store)[0], e);
    for (const k of ["deviceId", "screen", "drawScore", "score", "reason", "rejectedAt", "workTitle", "drawArtistName", "candidateId"]) assert.ok(k in list(w.store)[0], k);
    assert.ok(w.store.kv.has(archiveKey("c1")), "la copie complète reste récupérable tant que l'entrée est dans la liste");
    assert.ok(!w.store.kv.has(ARCHIVE_LAST_KEY));
    assert.equal(await recordRejected(w.kv, cand("c1"), "refusé par le réseau (2/3)", 2000), null, "répétition : rien de plus");
    assert.equal(list(w.store).length, 1);
  });

  T("expiration passive : le candidat SUIVANT réconcilie — enregistré UNE seule fois", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    const e = await reconcileLostCandidate(w.kv, 5000);
    assert.ok(e); assert.equal(e!.candidateId, "c1"); assert.match(e!.reason, /expiré ou remplacé sans quorum/);
    assert.equal(await reconcileLostCandidate(w.kv, 6000), null, "idempotent : rien de plus au passage suivant");
    assert.equal(list(w.store).length, 1); assert.ok(w.store.kv.has(archiveKey("c1")));
    // la réconciliation répétée avec un pointeur resté en place ne crée pas de doublon non plus
    w.store.kv.set(ARCHIVE_LAST_KEY, "c1");
    assert.equal(await reconcileLostCandidate(w.kv), null); assert.equal(list(w.store).length, 1); assert.ok(!w.store.kv.has(ARCHIVE_LAST_KEY));
  });

  T("candidat encore COURANT (vivant) ou en cours de finalisation : jamais déclaré perdu", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    w.store.kv.set("candidate:current", JSON.stringify({ candidateId: "c1" }));
    assert.equal(await reconcileLostCandidate(w.kv), null); assert.equal(list(w.store).length, 0); assert.ok(w.store.kv.has(ARCHIVE_LAST_KEY));
    w.store.kv.delete("candidate:current");
    w.store.kv.set("candidate:finalizing:c1", "1");   // claimFinalization posé : le minage est en cours
    assert.equal(await reconcileLostCandidate(w.kv), null); assert.equal(list(w.store).length, 0, "pas de faux rejet pendant le minage");
  });

  T("nouveau candidat créé PENDANT la finalisation de l'ancien : le pointeur du nouveau n'est jamais supprimé", async (w) => {
    await archiveOnCreate(w.kv, cand("A"));
    await archiveOnCreate(w.kv, cand("B"));        // B est créé avant que A ait fini de se finaliser
    await dropArchive(w.kv, "A");                  // finalisation tardive de A (miné)
    assert.equal(w.store.kv.get(ARCHIVE_LAST_KEY), "B", "pointeur de B intact");
    assert.ok(w.store.kv.has(archiveKey("B")));
    assert.ok(!w.store.kv.has(archiveKey("A")));
    await recordRejected(w.kv, cand("A"), "tardif");   // déjà finalisé : sans effet
    assert.equal(w.store.kv.get(ARCHIVE_LAST_KEY), "B"); assert.equal(list(w.store).length, 0);
    // et inversement : A rejeté en retard ne touche pas B
    const w2 = world(name); await archiveOnCreate(w2.kv, cand("A")); await archiveOnCreate(w2.kv, cand("B"));
    await recordRejected(w2.kv, cand("A"), "refus tardif"); assert.equal(w2.store.kv.get(ARCHIVE_LAST_KEY), "B"); assert.equal(list(w2.store).length, 1);
  });

  T("aucune suppression du pointeur appartenant à un autre candidateId (compare-et-supprime)", async (w) => {
    w.store.kv.set(ARCHIVE_LAST_KEY, "B");
    await w.kv.eval(CAD_SCRIPT, [ARCHIVE_LAST_KEY], ["A"]); assert.equal(w.store.kv.get(ARCHIVE_LAST_KEY), "B");
    await w.kv.eval(CAD_SCRIPT, [ARCHIVE_LAST_KEY], ["B"]); assert.equal(w.store.kv.has(ARCHIVE_LAST_KEY), false);
    // pointeur sans copie : nettoyé, sans entrée ni échec ; copie illisible : idem
    w.store.kv.set(ARCHIVE_LAST_KEY, "ghost"); assert.equal(await reconcileLostCandidate(w.kv), null); assert.ok(!w.store.kv.has(ARCHIVE_LAST_KEY));
    w.store.kv.set(ARCHIVE_LAST_KEY, "bad"); w.store.kv.set(archiveKey("bad"), "pas du json"); assert.equal(await reconcileLostCandidate(w.kv), null); assert.ok(!w.store.kv.has(ARCHIVE_LAST_KEY));
    assert.equal(list(w.store).length, 0);
  });

  T("plus de 200 candidats rejetés : la liste ET les copies volumineuses sont réellement bornées", async (w) => {
    const N = REJECTED_KEEP + 60;
    for (let i = 0; i < N; i++) { await archiveOnCreate(w.kv, cand("c" + i)); await recordRejected(w.kv, cand("c" + i), "r", i); }
    assert.equal(list(w.store).length, REJECTED_KEEP);
    assert.equal(list(w.store)[0].candidateId, "c" + (N - 1));
    assert.equal(archives(w.store).length, REJECTED_KEEP, "une copie par entrée de la liste, pas une de plus");
    for (const e of list(w.store)) assert.ok(w.store.kv.has(archiveKey(e.candidateId)), "chaque entrée garde sa copie");
    for (let i = 0; i < 60; i++) assert.ok(!w.store.kv.has(archiveKey("c" + i)), "entrée sortie de la liste => copie supprimée");
    // toute copie porte un TTL (filet de sécurité)
    for (const k of archives(w.store)) assert.equal(w.store.ttl.get(k), ARCHIVE_TTL_SEC);
  });

  T("échec de connexion AVANT l'exécution : ni faux rejet, ni perte du candidat courant ; la reprise finalise une seule fois", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    w.failEval(1);
    await assert.rejects(() => recordRejected(w.kv, cand("c1"), "refus"));
    assert.equal(list(w.store).length, 0); assert.ok(w.store.kv.has(archiveKey("c1"))); assert.equal(w.store.kv.get(ARCHIVE_LAST_KEY), "c1");
    const e = await recordRejected(w.kv, cand("c1"), "refus (reprise)");
    assert.ok(e); assert.equal(list(w.store).length, 1);
    assert.equal(await recordRejected(w.kv, cand("c1"), "encore"), null); assert.equal(list(w.store).length, 1);
    // échec à la création : le candidat courant n'est pas concerné (l'appelant rattrape) et rien de partiel n'est écrit
    const w2 = world(name); w2.failEval(1);
    await assert.rejects(() => archiveOnCreate(w2.kv, cand("c2")));
    assert.equal(w2.store.kv.size, 0, "création atomique : ni copie sans pointeur, ni pointeur sans copie");
  });

  T("échec de la réconciliation : le pointeur reste, la reprise enregistre une seule fois", async (w) => {
    await archiveOnCreate(w.kv, cand("c1"));
    w.failEval(1);
    await assert.rejects(() => reconcileLostCandidate(w.kv));
    assert.equal(list(w.store).length, 0); assert.equal(w.store.kv.get(ARCHIVE_LAST_KEY), "c1");
    assert.ok(await reconcileLostCandidate(w.kv)); assert.equal(await reconcileLostCandidate(w.kv), null); assert.equal(list(w.store).length, 1);
  });
}

test("rejectedEntry : champs facultatifs absents => null, nom d'artiste de repli", () => {
  const e = rejectedEntry({ candidateId: "x", deviceId: "d", poolScreen: "tft28", drawScore: 1, score: 0.5 } as never, "r", 9); assert.equal(e.workTitle, null); assert.equal(e.drawArtistName, null);
  assert.equal(rejectedEntry({ ...cand("y"), drawArtistName: undefined } as never, "r", 9).drawArtistName, "Roubzi");
});

test("scripts : aucune écriture hors des clés prévues ; le pointeur n'est jamais supprimé sans comparaison ; la copie des entrées sorties est supprimée DANS le script", () => {
  assert.match(FINALIZE_SCRIPT, /'SET', KEYS\[1\], kind, 'NX'/);
  assert.match(FINALIZE_SCRIPT, /GET', KEYS\[3\]\) == ARGV\[2\] then redis\.call\('DEL', KEYS\[3\]\)/);
  assert.equal((FINALIZE_SCRIPT.match(/DEL', KEYS\[3\]/g) ?? []).length, 2, "deux suppressions du pointeur, toutes deux conditionnelles");
  assert.equal((FINALIZE_SCRIPT.match(/if redis\.call\('GET', KEYS\[3\]\) == ARGV\[2\]/g) ?? []).length, 2);
  assert.match(FINALIZE_SCRIPT, /LTRIM[\s\S]*DEL', ARGV\[7\] \.\. d\.candidateId/);
  assert.match(CAD_SCRIPT, /GET', KEYS\[1\]\) == ARGV\[1\]/);
  assert.doesNotMatch(CREATE_SCRIPT + FINALIZE_SCRIPT + CAD_SCRIPT, /FLUSH|KEYS\s*\*/i);
});

test("câblage : submit-candidate réconcilie puis archive ; validation-result enregistre les refus et finalise le miné ; toujours rattrapé (jamais bloquant)", () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  const sub = read("app/api/submit-candidate/route.ts"), val = read("app/api/validation-result/route.ts");
  assert.match(sub, /reconcileLostCandidate\([\s\S]*?\.catch\(/); assert.match(sub, /await setCandidate\(candidate\);[\s\S]*?archiveOnCreate\([\s\S]*?\.catch\(/);
  assert.equal((val.match(/recordRejected\(/g) ?? []).length, 2, "refus par le comité ET refus par le réseau");
  assert.match(val, /dropArchive\([\s\S]*?\.catch\(/);
  assert.ok(sub.indexOf("reconcileLostCandidate(") < sub.indexOf("await setCandidate(candidate);"), "réconciliation AVANT la création");
});
