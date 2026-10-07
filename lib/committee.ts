// lib/committee.ts — COMITÉ DE VALIDATION côté serveur (pur, sans Redis) : plan au dépôt du candidat, vague courante, porte de vote, décision. Lot 4 du plan de travail
// (docs/LOT_4_COMITE_MINEUR_REPUTATION_2026_10_07.md). Il s'appuie sur la référence lib/podProtocolV3.ts (graine = chaîne + contenu, rangs, seuil ⌈2K/3⌉, règle des sièges).
//
// Trois modes (COMMITTEE_MODE) : « off » (défaut : AUCUN effet, quorum historique ⌈0,51 × électorat⌉), « shadow » (le comité est calculé, journalisé et comparé, sans effet),
// « enforce » (le comité DÉCIDE). Le comité n'existe que pour un candidat à contenu v2 (image fixe) ET quand l'éligibilité est en « enforce » (il tire parmi les PROFILS éligibles) ;
// une animation (vote encore v1) suit toujours le quorum historique.
// Limite assumée (SIMULATION § 3) : la graine est calculable par l'auteur AVANT la soumission (grinding) tant qu'une balise aléatoire postérieure n'existe pas ; ne pas annoncer de
// tolérance aux profils malhonnêtes au-delà de la validation par le serveur.
// Coût Redis : AUCUN en soi (le plan se calcule avec les lectures existantes ; +1 lecture de la tête de chaîne par candidat dans la route de dépôt).

import type { ValidationVote, VoteMap } from "@/lib/chain";
import { voterKey, type PoolPlan } from "@/lib/eligibility";
import { NOISE_E, NOISE_T, committeeWindow, decide, effectiveVoters, selectCommittee, type Committee, type Decision, type Verdict } from "@/lib/podProtocolV3";

export type CommitteeMode = "off" | "shadow" | "enforce";
export const committeeModeFromEnv = (env: NodeJS.ProcessEnv = process.env): CommitteeMode => {
  const v = (env.COMMITTEE_MODE ?? "off").trim().toLowerCase();
  return v === "enforce" || v === "shadow" ? v : "off";
};
/** Délai avant la vague 2 (suppléants) — proposé : 10 min (le TTL du candidat est de 30 min). */
export const waveDelayMsFromEnv = (env: NodeJS.ProcessEnv = process.env): number => {
  const m = Number(env.COMMITTEE_WAVE2_MINUTES);
  return (Number.isFinite(m) && env.COMMITTEE_WAVE2_MINUTES !== undefined && env.COMMITTEE_WAVE2_MINUTES !== "" && m > 0 ? m : 10) * 60_000;
};

/** Ce que le candidat mémorise (champ additif `committee`) : au plus 2K identifiants de profils (≤ 14) — coût de stockage borné quel que soit le réseau. */
export interface CandidateCommittee {
  state: "shadow" | "enforce";
  mode: "bootstrap" | "committee";
  K: number;
  threshold: number;
  /** les 2K premiers rangs (vague 1 = K premiers) */
  ranked: string[];
  /** graine : bloc précédent + contenu (rawHash). Mémorisés pour qu'un tiers recalcule les rangs. */
  parentHash: string;
  contentHash: string;
  waveDelayMs: number;
}

export function planCandidateCommittee(args: { state: "shadow" | "enforce"; plan: PoolPlan; parentHash: string; contentHash: string; waveDelayMs: number }): CandidateCommittee | null {
  if (args.plan.kind === "none") return null;
  // plan « independent » : auteur déjà exclu de plan.profiles ; plan « bootstrap » : les profils de l'auteur sont admis (comité étiqueté « partiel », tous doivent approuver)
  const c = selectCommittee({ eligibleProfiles: args.plan.profiles, authorProfileId: null, contentHash: args.contentHash, parentHash: args.parentHash, bootstrap: args.plan.kind === "bootstrap" });
  if (c.mode === "none") return null;
  return { state: args.state, mode: c.mode === "bootstrap" ? "bootstrap" : "committee", K: c.K, threshold: c.threshold, ranked: c.ranked.slice(0, Math.min(2 * c.K, c.ranked.length)), parentHash: args.parentHash, contentHash: args.contentHash, waveDelayMs: args.waveDelayMs };
}

export const toCommittee = (c: CandidateCommittee): Committee => ({ mode: c.mode, K: c.K, threshold: c.threshold, ranked: c.ranked });
export const currentWave = (c: Pick<CandidateCommittee, "waveDelayMs">, submittedAt: number, now: number): 1 | 2 => (now - submittedAt >= c.waveDelayMs ? 2 : 1);

export type CommitteeRefusal = "not-in-committee" | "wave-not-open" | "v1-not-admitted";
export type CommitteeGate =
  | { action: "allow" }
  | { action: "refuse"; status: 403 | 409; reason: CommitteeRefusal }
  | { action: "shadow-refuse"; reason: CommitteeRefusal };

/** Un profil vote s'il siège dans la fenêtre de la vague courante ET vote en v2 (le vote hérité recopie le score du serveur : il ne siège pas). */
export function committeeGate(opts: { mode: CommitteeMode; committee: CandidateCommittee | undefined; profileId: string | null; wave: 1 | 2; isV2: boolean }): CommitteeGate {
  const { mode, committee } = opts;
  if (mode === "off" || !committee) return { action: "allow" };
  const refusal = ((): { status: 403 | 409; reason: CommitteeRefusal } | null => {
    if (!opts.profileId || !committeeWindow(toCommittee(committee), 2).includes(opts.profileId)) return { status: 403, reason: "not-in-committee" };
    if (!committeeWindow(toCommittee(committee), opts.wave).includes(opts.profileId)) return { status: 403, reason: "wave-not-open" };
    if (!opts.isV2) return { status: 409, reason: "v1-not-admitted" };
    return null;
  })();
  if (!refusal) return { action: "allow" };
  return mode === "shadow" || committee.state === "shadow" ? { action: "shadow-refuse", reason: refusal.reason } : { action: "refuse", ...refusal };
}

/**
 * Un refus v2 ne COMPTE que s'il est objectivement vrai pour le contenu connu du serveur (SIMULATION § 1 : sans cela 20 % de profils malhonnêtes faisaient refuser 16 à 32 % des bons
 * contenus). Motifs vérifiables : image uniforme (`blank` en v2) et bruit pur, AVEC les mêmes mesures que la référence. Tout autre refus (hash, métriques…) est un « dispute » :
 * conservé, journalisé, mais il ne bloque rien.
 */
export function rejectIsObjective(vote: { reason?: string; e: number; t: number; r: number }, ref: { e: number; t: number; r: number }): boolean {
  if (vote.e !== ref.e || vote.t !== ref.t || vote.r !== ref.r) return false;
  if (vote.reason === "blank") return ref.e === 0 && ref.t === 0;
  if (vote.reason === "noise") return ref.e > NOISE_E && ref.t > NOISE_T;
  return false;
}

export interface CommitteeOutcome {
  decision: Decision;
  /** profils effectifs (≤ K, dans l'ordre des rangs) */
  effective: string[];
  /** vote représentatif de chaque profil effectif (le plus petit deviceId parmi ses cartes), dans l'ordre des rangs : ce sont les REÇUS du bloc */
  votes: ValidationVote[];
  /** profils de la vague 1 qui n'ont envoyé AUCUN vote (un refus « dispute » est une réponse) */
  silent: string[];
  /** profils de la fenêtre dont le refus n'est pas objectif (« dispute » : neutre, ne compte pas) */
  disputes: string[];
}

/** Décision rejouable à partir de la carte des votes. Un profil sans vote v2 valide ne compte pas ; des cartes qui se contredisent = abstention ; un refus « dispute » = abstention. */
export function committeeOutcome(c: CandidateCommittee, wave: 1 | 2, voteMap: VoteMap | null): CommitteeOutcome {
  const committee = toCommittee(c);
  const byProfile = new Map<string, ValidationVote[]>();
  const responded = new Set<string>(), disputed = new Set<string>();
  for (const v of Object.values(voteMap?.votes ?? {})) {
    responded.add(voterKey(v));
    if (v.disputed) { disputed.add(voterKey(v)); continue; }
    if (v.v !== 2) continue;
    const k = voterKey(v);
    byProfile.set(k, [...(byProfile.get(k) ?? []), v]);
  }
  const verdicts = new Map<string, Verdict>();
  const representative = new Map<string, ValidationVote>();
  for (const [profile, list] of byProfile) {
    const rejects = list.some((v) => v.verdict === "reject"), accepts = list.some((v) => v.verdict !== "reject");
    if (rejects && accepts) continue;   // cartes contradictoires : le profil s'abstient
    verdicts.set(profile, rejects ? "reject" : "accept");
    representative.set(profile, [...list].sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0))[0]);
  }
  const effective = effectiveVoters(committee, wave, verdicts);
  const decision = decide(committee, wave, verdicts);
  const silent = committeeWindow(committee, 1).filter((p) => !responded.has(p));
  const window2 = new Set(committeeWindow(committee, 2));
  return { decision, effective, votes: effective.map((p) => representative.get(p)!), silent, disputes: [...disputed].filter((p) => window2.has(p)).sort() };
}
