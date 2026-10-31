// lib/quorumNeeded.ts — NOMBRE D'APPROBATIONS exigé pour miner un candidat (31/10/2026). Fonction pure, source unique (chain.ts, « Rejetés », diagnostic).
//
// Avant : ceil(réseau × 0,51). Avec 4 validateurs il fallait 3 votes (une majorité STRICTE) ; or l'auteur et deux appareils lents suffisaient à bloquer tout le réseau :
// le 31/10/2026 plus aucun dessin n'était miné (réseau de 4, 3 votes exigés, personne ne votait à temps).
// Désormais, en dessous de QUORUM_ADAPTIVE_BELOW appareils (défaut 10), la moitié suffit (ceil(réseau × 0,5)) ; au-dessus, ratio habituel (QUORUM_RATIO, défaut 0,51).
// Ne change PAS l'exigence d'au moins une approbation v2 (vote recalculé et signé) ni la vérification des signatures : seul le nombre d'approbations baisse.
const DEFAULT_RATIO = 0.51;
const SMALL_RATIO = 0.5;
const DEFAULT_BELOW = 10;

export function quorumNeeded(poolSize: number, env: NodeJS.ProcessEnv = process.env): number {
  const pool = Number.isFinite(poolSize) ? Math.max(1, Math.floor(poolSize)) : 1;
  const ratio = parseFloat(env.QUORUM_RATIO ?? "") || DEFAULT_RATIO;
  const belowRaw = env.QUORUM_ADAPTIVE_BELOW;
  const below = belowRaw === undefined || belowRaw.trim() === "" ? DEFAULT_BELOW : Number(belowRaw);   // 0 = désactivé (retour à la règle historique)
  const r = Number.isFinite(below) && below > 0 && pool < below ? Math.min(ratio, SMALL_RATIO) : ratio;
  return Math.max(1, Math.ceil(pool * r));
}
