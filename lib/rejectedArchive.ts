// lib/rejectedArchive.ts — ARCHIVE DES CANDIDATS REFUSÉS OU PERDUS (REJECTED-CANDIDATE-ARCHIVE-1, 14/10/2026 ; FIX1, 15/10/2026).
//
// Problème : l'onglet « Rejetés » lit la liste Redis `rejected:draws`, que PERSONNE n'écrivait ; un candidat refusé ou expiré disparaissait avec `candidate:current` (TTL 30 min).
//
// Principe (la chaîne ne perd rien, les refus non plus — mais la mémoire reste BORNÉE) :
//   - création d'un candidat : copie COMPLÈTE `candidate:archive:{id}` + pointeur `candidate:last` = id, en UNE transaction Lua (jamais l'un sans l'autre) ;
//   - FIN de vie d'un candidat : UNE transition atomique et IDEMPOTENTE, décidée par `candidate:final:{id}` (SET NX) — le PREMIER état gagne, pour toujours :
//        mined    : copie supprimée, aucune entrée « Rejetés » ;
//        rejected : entrée dans `rejected:draws` (200 gardées ; l'app en lit 50), copie conservée tant que l'entrée est dans la liste ;
//        expired  : comme rejected, motif « expiré ou remplacé sans quorum » (réconciliation au candidat SUIVANT, seulement si rien ne l'a finalisé et s'il n'est pas en cours de finalisation) ;
//   - BORNE : quand une entrée sort de la liste (plus de 200), la copie `candidate:archive:{son id}` est supprimée DANS LA MÊME transaction ;
//     filet de sécurité : toute copie porte un TTL de 90 jours (ARCHIVE_TTL_SEC) — un orphelin (panne entre deux événements, aucun candidat ensuite) disparaît seul ; `candidate:final:{id}` : petit (≈ 10 o), même TTL ;
//   - POINTEUR : `candidate:last` n'est supprimé QUE s'il contient l'id du candidat qui se termine (comparaison dans le script) : la fin d'un ancien candidat ne peut jamais effacer le pointeur d'un nouveau.
// Coût Redis : création +1 commande (EVAL), fin de vie +1 (EVAL), réconciliation +2/+3 (GET pointeur, GET courant, GET copie, EVAL) par dessin ; rien en dehors de ces événements (budget du repos inchangé).
// Tout est « au mieux » côté appelant : un échec d'archive n'interrompt JAMAIS le minage ni le dépôt (les appels sont rattrapés).
// Les scripts lisent/suppriment `candidate:archive:<id>` dont l'id vient d'une entrée de liste (clé construite dans le script : Redis NON clusterisé, comme Upstash ; voir docs).
import type { Candidate } from "@/lib/chain";

/** Sous-ensemble de Redis utilisé (injectable pour les tests). */
export interface ArchiveKV {
  get(key: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export const REJECTED_LIST = "rejected:draws";
export const REJECTED_KEEP = 200;
export const ARCHIVE_LAST_KEY = "candidate:last";
export const ARCHIVE_TTL_SEC = 90 * 24 * 3600;
export const ARCHIVE_PREFIX = "candidate:archive:";
export const archiveKey = (candidateId: string) => `${ARCHIVE_PREFIX}${candidateId}`;
export const finalKey = (candidateId: string) => `candidate:final:${candidateId}`;
/** Verrou posé par `claimFinalization` (lib/chain.ts) : un candidat en cours de finalisation n'est jamais déclaré perdu. */
export const finalizingKey = (candidateId: string) => `candidate:finalizing:${candidateId}`;
const CURRENT_KEY = "candidate:current";

export type FinalKind = "mined" | "rejected" | "expired";

/** Création atomique : copie complète (avec TTL) + pointeur. KEYS = [archive, last] ; ARGV = [json, id, ttl]. */
export const CREATE_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
redis.call('SET', KEYS[2], ARGV[2])
return 1`;

/**
 * Fin de vie atomique et idempotente. KEYS = [final, archive, last, list, finalizing] ;
 * ARGV = [kind, id, entryJson, keep, finalTtl, archiveTtl, archivePrefix].
 * Retour : 1 = transition appliquée ; 0 = déjà finalisé (rien d'écrit, pointeur nettoyé seulement s'il est le nôtre) ; 2 = en cours de finalisation (expiré refusé).
 */
export const FINALIZE_SCRIPT = `
local kind = ARGV[1]
if kind == 'expired' and redis.call('EXISTS', KEYS[5]) == 1 then return 2 end
if not redis.call('SET', KEYS[1], kind, 'NX', 'EX', tonumber(ARGV[5])) then
  if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
  return 0
end
if kind == 'mined' then
  redis.call('DEL', KEYS[2])
else
  redis.call('LPUSH', KEYS[4], ARGV[3])
  local keep = tonumber(ARGV[4])
  local old = redis.call('LRANGE', KEYS[4], keep, -1)
  if #old > 0 then
    redis.call('LTRIM', KEYS[4], 0, keep - 1)
    for _, e in ipairs(old) do
      local ok, d = pcall(cjson.decode, e)
      if ok and type(d) == 'table' and type(d.candidateId) == 'string' then redis.call('DEL', ARGV[7] .. d.candidateId) end
    end
  end
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[6]))
end
if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
return 1`;

/** Compare-et-supprime : le pointeur n'est effacé que s'il appartient à l'id donné. KEYS = [last] ; ARGV = [id]. */
export const CAD_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

/** Même forme que `RejectedDraw` de /api/rejected-draws (le lecteur ne change pas). */
export interface RejectedEntry {
  deviceId: string;
  screen: string;
  drawScore: number;
  score: number;
  reason: string;
  rejectedAt: number;
  workTitle?: string | null;
  drawArtistName?: string | null;
  candidateId: string;   // additif : retrouve la copie complète `candidate:archive:{candidateId}` tant que l'entrée est dans la liste
}

type CandidateLike = Pick<Candidate, "candidateId" | "deviceId" | "poolScreen" | "drawScore" | "score"> & Partial<Pick<Candidate, "workTitle" | "drawArtistName" | "artistName" | "poolSize" | "submittedAt">>;

export function rejectedEntry(c: CandidateLike, reason: string, now: number): RejectedEntry {
  return {
    deviceId: c.deviceId, screen: c.poolScreen, drawScore: c.drawScore, score: c.score, reason, rejectedAt: now,
    workTitle: c.workTitle ?? null, drawArtistName: c.drawArtistName ?? c.artistName ?? null, candidateId: c.candidateId,
  };
}

/** À la création du candidat : copie complète (TTL de sécurité) + pointeur « dernier candidat », en une transaction. */
export async function archiveOnCreate(kv: ArchiveKV, candidate: Candidate): Promise<void> {
  await kv.eval(CREATE_SCRIPT, [archiveKey(candidate.candidateId), ARCHIVE_LAST_KEY], [JSON.stringify(candidate), candidate.candidateId, String(ARCHIVE_TTL_SEC)]);
}

async function finalize(kv: ArchiveKV, kind: FinalKind, candidateId: string, entry: RejectedEntry | null): Promise<number> {
  const r = await kv.eval(
    FINALIZE_SCRIPT,
    [finalKey(candidateId), archiveKey(candidateId), ARCHIVE_LAST_KEY, REJECTED_LIST, finalizingKey(candidateId)],
    [kind, candidateId, entry ? JSON.stringify(entry) : "", String(REJECTED_KEEP), String(ARCHIVE_TTL_SEC), String(ARCHIVE_TTL_SEC), ARCHIVE_PREFIX],
  );
  return Number(r);
}

/** Bloc miné : la copie n'a plus d'objet ; le candidat ne pourra JAMAIS être enregistré comme refusé ou expiré. Idempotent. */
export async function dropArchive(kv: ArchiveKV, candidateId: string): Promise<void> {
  await finalize(kv, "mined", candidateId, null);
}

/** Candidat refusé : entrée lisible par l'onglet « Rejetés » (une seule fois par candidat), copie conservée tant que l'entrée est dans la liste. Retourne l'entrée écrite, ou null si le candidat était déjà finalisé. */
export async function recordRejected(kv: ArchiveKV, candidate: CandidateLike, reason: string, now: number = Date.now()): Promise<RejectedEntry | null> {
  const entry = rejectedEntry(candidate, reason, now);
  return (await finalize(kv, "rejected", candidate.candidateId, entry)) === 1 ? entry : null;
}

/** Motif d'un candidat perdu : toujours « expiré ou remplacé sans quorum », complété (quand la copie le dit) par la taille du réseau, le quorum attendu et la durée sans décision. */
export function expiredReason(c: CandidateLike, now: number): string {
  const parts: string[] = [];
  if (typeof c.poolSize === "number" && c.poolSize >= 0) {
    const ratio = parseFloat(process.env.QUORUM_RATIO ?? "0.51");
    parts.push(`réseau de ${c.poolSize} validateur(s), ${Math.max(1, Math.ceil(c.poolSize * ratio))} vote(s) nécessaire(s)`);
  }
  if (typeof c.submittedAt === "number" && now > c.submittedAt) parts.push(`${Math.round((now - c.submittedAt) / 60000)} min sans décision`);
  return parts.length ? `expiré ou remplacé sans quorum (${parts.join(" · ")})` : "expiré ou remplacé sans quorum";
}

/** Avant la création du candidat SUIVANT : le précédent a-t-il été perdu (expiré ou remplacé sans quorum) ? Si oui, et seulement si rien ne l'a déjà finalisé, l'enregistrer. Retourne l'entrée écrite, ou null. */
export async function reconcileLostCandidate(kv: ArchiveKV, now: number = Date.now()): Promise<RejectedEntry | null> {
  const lastId = await kv.get(ARCHIVE_LAST_KEY);
  if (typeof lastId !== "string" || lastId.length === 0) return null;
  const cleanPointer = () => kv.eval(CAD_SCRIPT, [ARCHIVE_LAST_KEY], [lastId]);
  // Encore le candidat COURANT (vivant) : pas perdu.
  const currentRaw = await kv.get(CURRENT_KEY);
  if (currentRaw) {
    try { const cur = typeof currentRaw === "string" ? JSON.parse(currentRaw) : (currentRaw as { candidateId?: string }); if (cur?.candidateId === lastId) return null; } catch { /* courant illisible : on continue */ }
  }
  const raw = await kv.get(archiveKey(lastId));
  if (!raw) { await cleanPointer(); return null; }
  let c: CandidateLike | null = null;
  try { c = typeof raw === "string" ? JSON.parse(raw) : (raw as CandidateLike); } catch { c = null; }
  if (!c || typeof c.candidateId !== "string" || c.candidateId !== lastId) { await cleanPointer(); return null; }
  const entry = rejectedEntry(c, expiredReason(c, now), now);
  return (await finalize(kv, "expired", lastId, entry)) === 1 ? entry : null;
}
