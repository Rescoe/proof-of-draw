// lib/chainWalk.ts — parcours de la chaîne CANONIQUE (de chain:head jusqu'au genesis) et sélection d'une page de l'explorateur (25/10/2026).
// Pur : toutes les lectures Redis sont injectées (tests sans Redis). Aucune écriture, aucun SCAN : seuls les blocs reliés à la tête par leurs `parentHash` sont vus (les orphelins n'apparaissent jamais).
import type { Block } from "./chain";

export const GENESIS = "0".repeat(64);
/** Garde-fou : une chaîne plus longue que cela est tronquée (cycle ou donnée anormale), jamais parcourue sans fin. */
export const MAX_CHAIN_WALK = 20000;

export interface WalkDeps {
  /** Tête de chaîne, ou null si la chaîne est vide. */
  head: () => Promise<Block | null>;
  /** Les derniers hashes (le plus récent d'abord) : amorce du parcours en UNE commande, vérifiée bloc par bloc. */
  recent: () => Promise<string[]>;
  /** Plusieurs blocs en une commande, alignés sur `hashes` (null = absent ou illisible). */
  many: (hashes: string[]) => Promise<(Block | null)[]>;
  /** Un bloc (parcours au-delà de la fenêtre récente). */
  one: (hash: string) => Promise<Block | null>;
}

export interface WalkResult {
  blocks: Block[];            // du plus récent (la tête) au plus ancien atteint
  complete: boolean;          // true si le genesis est atteint
  stopped?: "missing-parent" | "cycle" | "too-long";
}

/**
 * Suit les `parentHash` depuis la tête jusqu'au genesis. S'arrête proprement (résultat partiel, `stopped` renseigné) sur un parent absent/illisible,
 * un cycle ou une chaîne anormalement longue. La liste `chain:recent` n'est qu'une amorce : un hash qui ne prolonge pas la chaîne est ignoré.
 */
export async function walkCanonicalChain(d: WalkDeps, maxBlocks = MAX_CHAIN_WALK): Promise<WalkResult> {
  const head = await d.head();
  if (!head) return { blocks: [], complete: true };
  const blocks: Block[] = [head];
  const seen = new Set<string>([head.blockHash]);
  let cursor = head;

  const step = (next: Block | null): "ok" | WalkResult["stopped"] => {
    if (!next) return "missing-parent";
    if (seen.has(next.blockHash)) return "cycle";
    if (blocks.length >= maxBlocks) return "too-long";
    seen.add(next.blockHash);
    blocks.push(next);
    cursor = next;
    return "ok";
  };
  const done = (stopped?: WalkResult["stopped"]): WalkResult => ({ blocks, complete: !stopped && cursor.parentHash === GENESIS, ...(stopped ? { stopped } : {}) });

  // 1. Amorce : la fenêtre récente (1 LRANGE + 1 MGET) ; chaque bloc doit être le parent du précédent, sinon on retombe sur le parcours un par un.
  if (cursor.parentHash !== GENESIS) {
    const recent = (await d.recent()).filter((h) => typeof h === "string" && h.length > 0);
    const start = recent.indexOf(head.blockHash);
    const candidates = start >= 0 ? recent.slice(start + 1) : [];
    if (candidates.length > 0) {
      const found = await d.many(candidates);
      for (let i = 0; i < found.length; i++) {
        const b = found[i];
        if (!b || b.blockHash !== candidates[i] || b.blockHash !== cursor.parentHash) break;   // la fenêtre ne prolonge plus la chaîne canonique
        const r = step(b);
        if (r !== "ok") return done(r);
        if (cursor.parentHash === GENESIS) break;
      }
    }
  }

  // 2. Suite : un bloc à la fois (le parent n'est connu qu'après lecture de l'enfant).
  while (cursor.parentHash !== GENESIS) {
    const r = step(await d.one(cursor.parentHash));
    if (r !== "ok") return done(r);
  }
  return done();
}

// ─── Sélection d'une page ───────────────────────────────────────────────────

export function matchesQuery(block: Block, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    block.blockHash.toLowerCase().startsWith(ql) ||
    block.imageHash.toLowerCase().startsWith(ql) ||
    (block.actionsHash ?? "").toLowerCase().startsWith(ql) ||
    !!block.artistName?.toLowerCase().includes(ql) ||
    (block.drawArtistName ?? "").toLowerCase().includes(ql) ||
    (block.deviceOwnerName ?? "").toLowerCase().includes(ql) ||
    (block.workTitle ?? "").toLowerCase().includes(ql) ||
    !!block.deviceId?.toLowerCase().includes(ql) ||
    String(block.blockIndex) === q.trim()
  );
}

export interface PageQuery { q?: string; screen?: string; kind?: string; page: number; limit: number }
export interface PageResult { blocks: Block[]; total: number; page: number; pages: number; limit: number }

/** Filtre toute la chaîne, trie par `blockIndex` décroissant, puis découpe la page demandée (la page est ramenée dans [1, pages]). */
export function selectPage(all: Block[], q: PageQuery): PageResult {
  let blocks = all;
  if (q.q) {
    // Un numéro exact (« 1 », « 116 ») désigne CE bloc : sinon « 1 » noierait le bloc #1 parmi tous les titres, hash et artistes qui contiennent ce chiffre.
    const exact = /^[0-9]{1,9}$/.test(q.q.trim()) ? blocks.filter((b) => b.blockIndex === Number(q.q!.trim())) : [];
    blocks = exact.length > 0 ? exact : blocks.filter((b) => matchesQuery(b, q.q!));
  }
  if (q.screen) blocks = blocks.filter((b) => b.poolScreen === q.screen);
  if (q.kind === "animation") blocks = blocks.filter((b) => b.kind === "animation");
  if (q.kind === "draw") blocks = blocks.filter((b) => b.kind !== "animation");
  blocks = [...blocks].sort((a, b) => b.blockIndex - a.blockIndex);
  const total = blocks.length;
  const pages = Math.ceil(total / q.limit) || 1;
  const page = Math.min(Math.max(1, q.page), pages);
  return { blocks: blocks.slice((page - 1) * q.limit, page * q.limit), total, page, pages, limit: q.limit };
}
