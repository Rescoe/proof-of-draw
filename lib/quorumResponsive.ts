// lib/quorumResponsive.ts — feuille sans dépendance : un appareil compte-t-il dans le quorum ? (voir lib/quorumHealth.ts pour la règle et le règlement des candidats expirés)
export function maxMissedFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.QUORUM_MAX_MISSED);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Faux après trop de candidats expirés sans le vote de l'appareil ; jamais utilisé pour REFUSER un vote (un appareil exclu reste invité et se réhabilite en votant). */
export function isResponsiveVoter(d: { missedVotes?: number } | null | undefined, max: number = maxMissedFromEnv()): boolean {
  return (d?.missedVotes ?? 0) < max;
}
