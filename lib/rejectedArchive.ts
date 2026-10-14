// lib/rejectedArchive.ts — ARCHIVE DES CANDIDATS REFUSÉS OU PERDUS (REJECTED-CANDIDATE-ARCHIVE-1, 14/10/2026).
//
// Problème : l'onglet « Rejetés » lit la liste Redis `rejected:draws`, que PERSONNE n'écrivait ; un candidat refusé ou expiré disparaissait avec `candidate:current` (TTL 30 min).
// Principe (la chaîne ne perd rien, les refus non plus) :
//   - à la création d'un candidat : copie COMPLÈTE `candidate:archive:{id}` (sans expiration) + pointeur `candidate:last` = id            (+2 commandes, une fois par dessin)
//   - bloc miné                    : la copie n'a plus d'objet (le bloc contient tout) -> supprimée, pointeur supprimé                  (+2 commandes)
//   - refus (comité / réseau)      : entrée dans `rejected:draws` (50 dernières lues par l'app, 200 gardées), copie CONSERVÉE, pointeur supprimé (+3 commandes)
//   - expiration sans quorum       : passive (Redis supprime la clé) : réconciliée à la création du candidat SUIVANT : si le pointeur existe encore, le précédent a été perdu -> entrée « expiré
//                                    ou remplacé sans quorum », copie conservée                                                       (+2 à +5 commandes, une fois par dessin)
// Aucune commande en dehors de ces événements rares : le budget Redis du repos est inchangé. Tout est « au mieux » : un échec d'archive n'interrompt JAMAIS le minage ni le dépôt (les appels sont rattrapés).
import type { Candidate } from "@/lib/chain";

/** Sous-ensemble de Redis utilisé (injectable pour les tests). */
export interface ArchiveKV {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  lpush(key: string, ...values: string[]): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
}

export const REJECTED_LIST = "rejected:draws";
export const REJECTED_KEEP = 200;
export const ARCHIVE_LAST_KEY = "candidate:last";
export const archiveKey = (candidateId: string) => `candidate:archive:${candidateId}`;

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
  candidateId: string;   // additif : retrouve la copie complète `candidate:archive:{candidateId}`
}

type CandidateLike = Pick<Candidate, "candidateId" | "deviceId" | "poolScreen" | "drawScore" | "score"> & Partial<Pick<Candidate, "workTitle" | "drawArtistName" | "artistName">>;

export function rejectedEntry(c: CandidateLike, reason: string, now: number): RejectedEntry {
  return {
    deviceId: c.deviceId, screen: c.poolScreen, drawScore: c.drawScore, score: c.score, reason, rejectedAt: now,
    workTitle: c.workTitle ?? null, drawArtistName: c.drawArtistName ?? c.artistName ?? null, candidateId: c.candidateId,
  };
}

/** À la création du candidat : copie complète sans expiration + pointeur « dernier candidat ». */
export async function archiveOnCreate(kv: ArchiveKV, candidate: Candidate): Promise<void> {
  await Promise.all([kv.set(archiveKey(candidate.candidateId), JSON.stringify(candidate)), kv.set(ARCHIVE_LAST_KEY, candidate.candidateId)]);
}

/** Bloc miné : la copie n'a plus d'objet. */
export async function dropArchive(kv: ArchiveKV, candidateId: string): Promise<void> {
  await kv.del(archiveKey(candidateId), ARCHIVE_LAST_KEY);
}

/** Candidat refusé : entrée lisible par l'onglet « Rejetés » ; la copie complète est CONSERVÉE ; le pointeur est supprimé (déjà traité). */
export async function recordRejected(kv: ArchiveKV, candidate: CandidateLike, reason: string, now: number = Date.now()): Promise<RejectedEntry> {
  const entry = rejectedEntry(candidate, reason, now);
  await kv.lpush(REJECTED_LIST, JSON.stringify(entry));
  await Promise.all([kv.ltrim(REJECTED_LIST, 0, REJECTED_KEEP - 1), kv.del(ARCHIVE_LAST_KEY)]);
  return entry;
}

/** Avant la création du candidat SUIVANT : le précédent a-t-il été perdu (expiré ou remplacé sans quorum) ? Si oui, l'enregistrer. Retourne l'entrée écrite, ou null. */
export async function reconcileLostCandidate(kv: ArchiveKV, now: number = Date.now()): Promise<RejectedEntry | null> {
  const lastId = await kv.get(ARCHIVE_LAST_KEY);
  if (typeof lastId !== "string" || lastId.length === 0) return null;
  const raw = await kv.get(archiveKey(lastId));
  if (!raw) { await kv.del(ARCHIVE_LAST_KEY); return null; }
  let c: CandidateLike | null = null;
  try { c = typeof raw === "string" ? JSON.parse(raw) : (raw as CandidateLike); } catch { c = null; }
  if (!c || typeof c.candidateId !== "string") { await kv.del(ARCHIVE_LAST_KEY); return null; }
  return recordRejected(kv, c, "expiré ou remplacé sans quorum", now);
}
