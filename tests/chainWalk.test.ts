// tests/chainWalk.test.ts — explorateur de la chaîne canonique (25/10/2026) : parcours depuis la tête, pagination au-delà de 100 blocs, recherche, filtres, parents manquants, cycles, orphelins, images de la page seulement.
// Redis est simulé par un dictionnaire en mémoire : aucun accès à un vrai Redis.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GENESIS, walkCanonicalChain, selectPage, type WalkDeps } from "../lib/chainWalk";
import type { Block } from "../lib/chain";

const hex = (n: number) => n.toString(16).padStart(64, "a");
function mkBlock(i: number, over: Partial<Block> = {}): Block {
  return {
    blockIndex: i, blockHash: hex(i + 1), parentHash: i === 0 ? GENESIS : hex(i), imageHash: hex(1000 + i), actionsHash: hex(2000 + i),
    artistName: i % 2 ? "Roubzi" : "Claude", drawArtistName: i % 2 ? "Roubzi" : "Claude", workTitle: `Oeuvre ${i}`, deviceId: i % 3 ? "dev_AAAAAAAA" : "dev_BBBBBBBB",
    poolScreen: i % 4 === 0 ? "oled096" : "eink29bwr", kind: i % 10 === 0 && i > 0 ? "animation" : "draw", minedAt: 1_700_000_000_000 + i,
    ...over,
  } as unknown as Block;
}
function world(n: number, extra: Block[] = []) {
  const store = new Map<string, Block>();
  const chain: Block[] = [];
  for (let i = 0; i < n; i++) { const b = mkBlock(i); chain.push(b); store.set(b.blockHash, b); }
  for (const b of extra) store.set(b.blockHash, b);
  const calls = { one: 0, many: 0, manyHashes: 0, recent: 0 };
  const head = chain[chain.length - 1];
  const deps = (over: Partial<WalkDeps> = {}): WalkDeps => ({
    head: async () => head,
    recent: async () => { calls.recent++; return chain.slice(-100).reverse().map((b) => b.blockHash); },   // chain:recent = 100 derniers, le plus récent d'abord
    many: async (hs) => { calls.many++; calls.manyHashes += hs.length; return hs.map((h) => store.get(h) ?? null); },
    one: async (h) => { calls.one++; return store.get(h) ?? null; },
    ...over,
  });
  return { store, chain, head, calls, deps };
}

test("parcours complet : de la tête (#116) au genesis (#0), sans trou ni doublon", async () => {
  const w = world(117);
  const r = await walkCanonicalChain(w.deps());
  assert.equal(r.complete, true); assert.equal(r.stopped, undefined);
  assert.deepEqual(r.blocks.map((b) => b.blockIndex), Array.from({ length: 117 }, (_, i) => 116 - i));
  assert.equal(w.calls.recent, 1, "une seule lecture de la fenêtre récente");
  assert.equal(w.calls.many, 1, "100 blocs en une commande");
  assert.equal(w.calls.one, 17, "seuls les blocs au-delà de la fenêtre de 100 sont lus un par un"); // 117 − 1 tête − 99 de la fenêtre = 17
});

test("coût : chaîne de 30 blocs = fenêtre seule, aucun GET unitaire ; chaîne vide = résultat vide", async () => {
  const w = world(30);
  const r = await walkCanonicalChain(w.deps());
  assert.equal(r.blocks.length, 30); assert.equal(w.calls.one, 0);
  const empty = await walkCanonicalChain({ head: async () => null, recent: async () => [], many: async () => [], one: async () => null });
  assert.deepEqual(empty, { blocks: [], complete: true });
});

test("pagination au-delà de 100 blocs : les pages 5 et suivantes atteignent le bloc #0", async () => {
  const w = world(117);
  const all = (await walkCanonicalChain(w.deps())).blocks;
  const p1 = selectPage(all, { page: 1, limit: 20 });
  assert.equal(p1.total, 117); assert.equal(p1.pages, 6);
  assert.deepEqual(p1.blocks.map((b) => b.blockIndex), Array.from({ length: 20 }, (_, i) => 116 - i));
  const p5 = selectPage(all, { page: 5, limit: 20 });
  assert.equal(p5.blocks[0].blockIndex, 36); assert.equal(p5.blocks.length, 20);
  const p6 = selectPage(all, { page: 6, limit: 20 });
  assert.deepEqual(p6.blocks.map((b) => b.blockIndex), [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].slice(0, 17));
  assert.equal(p6.blocks[p6.blocks.length - 1].blockIndex, 0, "la dernière page contient le bloc #0");
  assert.equal(selectPage(all, { page: 99, limit: 20 }).page, 6, "page hors limites ramenée à la dernière");
  assert.equal(selectPage(all, { page: 0, limit: 20 }).page, 1);
});

test("recherche exacte du bloc #1, d'un ancien bloc par hash, imageHash, actionsHash, artiste, titre et deviceId — sur toute la chaîne", async () => {
  const w = world(117);
  const all = (await walkCanonicalChain(w.deps())).blocks;
  const one = selectPage(all, { q: "1", page: 1, limit: 20 });
  assert.deepEqual(one.blocks.map((b) => b.blockIndex), [1], "q=1 trouve exactement le bloc #1 (ancien, hors des 100 derniers)");
  assert.deepEqual(selectPage(all, { q: "116", page: 1, limit: 20 }).blocks.map((b) => b.blockIndex), [116]);
  assert.ok(selectPage(all, { q: "999", page: 1, limit: 20 }).total === 0, "numéro inexistant : retombe sur la recherche texte (aucun résultat ici)");
  const byHash = selectPage(all, { q: hex(6), page: 1, limit: 20 });       // hash du bloc #5
  assert.deepEqual(byHash.blocks.map((b) => b.blockIndex), [5]);
  assert.deepEqual(selectPage(all, { q: hex(1003), page: 1, limit: 20 }).blocks.map((b) => b.blockIndex), [3]);
  assert.deepEqual(selectPage(all, { q: hex(2004), page: 1, limit: 20 }).blocks.map((b) => b.blockIndex), [4]);
  assert.equal(selectPage(all, { q: "oeuvre 2", page: 1, limit: 100 }).blocks.every((b) => /Oeuvre 2/.test(String(b.workTitle))), true);
  assert.equal(selectPage(all, { q: "roubzi", page: 1, limit: 100 }).total, 58);
  assert.equal(selectPage(all, { q: "dev_bbbbbbbb", page: 1, limit: 100 }).total, 39);
  assert.equal(selectPage(all, { q: "introuvable", page: 1, limit: 20 }).total, 0);
});

test("filtres écran et nature sur toute la chaîne ; total, pages et page recalculés après filtrage", async () => {
  const w = world(117);
  const all = (await walkCanonicalChain(w.deps())).blocks;
  const oled = selectPage(all, { screen: "oled096", page: 1, limit: 20 });
  assert.equal(oled.total, 30); assert.equal(oled.pages, 2);
  assert.ok(oled.blocks.some((b) => b.blockIndex === 4) || selectPage(all, { screen: "oled096", page: 2, limit: 20 }).blocks.some((b) => b.blockIndex === 4), "un ancien bloc OLED est trouvé");
  const anim = selectPage(all, { kind: "animation", page: 1, limit: 20 });
  assert.equal(anim.total, 11); assert.equal(anim.pages, 1); assert.equal(anim.blocks.every((b) => b.kind === "animation"), true);
  const draws = selectPage(all, { kind: "draw", page: 1, limit: 100 });
  assert.equal(draws.total, 106);
  const both = selectPage(all, { kind: "animation", screen: "eink29bwr", page: 3, limit: 20 });
  assert.equal(both.page, 1, "page ramenée dans [1, pages] après filtrage");
});

test("parent manquant : arrêt propre avec les blocs déjà lus, chaîne marquée incomplète", async () => {
  const w = world(150);
  w.store.delete(hex(21));                     // le bloc #20 manque
  const r = await walkCanonicalChain(w.deps());
  assert.equal(r.complete, false); assert.equal(r.stopped, "missing-parent");
  assert.equal(r.blocks[r.blocks.length - 1].blockIndex, 21);
  const w2 = world(150);
  w2.store.set(hex(21), null as unknown as Block);   // illisible
  assert.equal((await walkCanonicalChain(w2.deps())).stopped, "missing-parent");
});

test("cycle : le parcours s'arrête au premier bloc déjà vu, sans boucle infinie", async () => {
  const w = world(150);
  const loop = { ...w.store.get(hex(40))!, parentHash: hex(130) };   // le bloc #39 repointe vers #129 (déjà vu)
  w.store.set(hex(40), loop as Block);
  const r = await walkCanonicalChain(w.deps());
  assert.equal(r.stopped, "cycle"); assert.equal(r.complete, false);
  assert.equal(new Set(r.blocks.map((b) => b.blockHash)).size, r.blocks.length, "aucun bloc en double");
});

test("chaîne anormalement longue : tronquée au plafond", async () => {
  const w = world(300);
  const r = await walkCanonicalChain(w.deps(), 120);
  assert.equal(r.stopped, "too-long"); assert.equal(r.blocks.length, 120); assert.equal(r.complete, false);
});

test("blocs orphelins : jamais affichés (seule la chaîne reliée à la tête est parcourue) ; une fenêtre récente incohérente est ignorée", async () => {
  const orphans = [mkBlock(500, { blockHash: hex(9001), parentHash: hex(9000) }), mkBlock(77, { blockHash: hex(9002), parentHash: hex(40), workTitle: "Fourche" })];
  const w = world(117, orphans);
  const r = await walkCanonicalChain(w.deps());
  assert.equal(r.blocks.some((b) => b.workTitle === "Fourche" || b.blockIndex === 500), false);
  assert.equal(r.blocks.length, 117);
  // fenêtre récente fausse (contient un orphelin et ne prolonge pas la tête) : le parcours retombe sur les parents et reste correct
  const bad = await walkCanonicalChain(w.deps({ recent: async () => [w.head.blockHash, hex(9002), hex(9001)] }));
  assert.equal(bad.complete, true); assert.equal(bad.blocks.length, 117);
  assert.equal(bad.blocks.some((b) => b.blockHash === hex(9002)), false);
  // fenêtre récente vide : parcours unitaire complet
  const none = await walkCanonicalChain(w.deps({ recent: async () => [] }));
  assert.equal(none.blocks.length, 117);
});

test("la route ne lit les images que des blocs de la page demandée, n'utilise plus chain:recent ni SCAN", () => {
  const route = fs.readFileSync(path.join(__dirname, "..", "app", "api", "blocks", "route.ts"), "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join(" ");
  assert.match(route, /getBlockImages\(sel\.blocks\.map/);
  assert.doesNotMatch(route, /chain:recent|lrange|scan\(|SCAN/i);
  assert.doesNotMatch(route, /getBlockImages\(chain\.blocks/);
  const chain = fs.readFileSync(path.join(__dirname, "..", "lib", "chain.ts"), "utf8");
  const fn = chain.slice(chain.indexOf("export async function getCanonicalChain"), chain.indexOf("// ── Lecture groupée pour /api/pull"));
  assert.doesNotMatch(fn, /\.scan\(|SCAN|chain:block:\*/);
  assert.match(fn, /unstable_cache/);
  assert.equal(selectPage(Array.from({ length: 117 }, (_, i) => mkBlock(i)), { page: 2, limit: 20 }).blocks.length, 20, "une page = 20 blocs");
});
