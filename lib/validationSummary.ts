// lib/validationSummary.ts — résumé HONNÊTE des votes d'un candidat / d'un bloc (pur, sans Redis), pour le journal en direct de l'app.
//
// Principe (CLAUDE.md « Chantier validation réelle ») : ne jamais présenter un vote hérité comme une validation vérifiée.
//   v2        = l'appareil a relu le dessin, recalculé le hash et les métriques entières et signé son verdict  → « vérifié »
//   v1 (écho) = l'appareil a renvoyé le score du serveur, sans calcul                                          → « écho », pas une validation
// Coût Redis : AUCUN (les votes sont déjà lus par /api/network/activity-log ; le résumé d'un bloc est écrit avec le bloc, additif).

export interface VoteLike {
  v?: number;
  verdict?: "accept" | "reject";
  reason?: string;
  suspect?: boolean;
  entropy?: number;
  transitions?: number;
  rle?: number;
  score?: number;
}

/** Résumé stocké dans le bloc (`Block.votesSummary`) : de quoi afficher le niveau réellement atteint, après la fin du candidat. */
export interface VotesSummary {
  v2: number;       // approbations v2 (recalculées par l'appareil)
  v1: number;       // approbations héritées (écho du score serveur)
  rejects: number;  // refus signés (v2)
}

export function summarizeVotes(votes: readonly VoteLike[], rejects = 0): VotesSummary {
  let v2 = 0, v1 = 0, rej = rejects;
  for (const v of votes) {
    if (v.verdict === "reject") { if (rejects === 0) rej++; continue; }
    if (v.v === 2) v2++; else v1++;
  }
  return { v2, v1, rejects: rej };
}

/** « v2 vérifié ×1 · v1 écho ×0 · refus ×0 » — texte court du journal. */
export function describeSummary(s: VotesSummary | null | undefined): string {
  if (!s) return "";
  return `v2 vérifié×${s.v2} · v1 écho×${s.v1}${s.rejects > 0 ? ` · refus×${s.rejects}` : ""}`;
}

export interface VoteDescription {
  voteVersion: 1 | 2;
  verdict: "accept" | "reject";
  reason?: string;
  suspect?: boolean;
  /** Métriques entières en ppm (v2 seulement) : e, t, r. */
  metricsPpm?: { e: number; t: number; r: number };
  /** Fin du message « VOTE · pub_xxx · score NN% » : les consommateurs existants (regex `score\s+(\d+)%`) restent compatibles. */
  detail: string;
}

export function describeVote(vote: VoteLike): VoteDescription {
  const pct = `${Math.round((vote.score ?? 0) * 100)}%`;
  if (vote.v === 2) {
    const verdict = vote.verdict === "reject" ? "reject" : "accept";
    const m = { e: Math.round((vote.entropy ?? 0) * 1e6), t: Math.round((vote.transitions ?? 0) * 1e6), r: Math.round((vote.rle ?? 0) * 1e6) };
    const base = `score ${pct} · v2 ${verdict === "accept" ? "✓ accepte" : `✗ refuse (${vote.reason ?? "?"})`} · e=${m.e} t=${m.t} r=${m.r}`;
    return { voteVersion: 2, verdict, ...(vote.reason ? { reason: vote.reason } : {}), ...(vote.suspect ? { suspect: true } : {}), metricsPpm: m, detail: vote.suspect ? `${base} · suspect` : base };
  }
  return { voteVersion: 1, verdict: "accept", detail: `score ${pct} · v1 écho du score serveur (non vérifié)` };
}
