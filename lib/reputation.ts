// lib/reputation.ts — RÉPUTATION PAR PROFIL, fondée UNIQUEMENT sur des événements démontrables (pur + un script Redis). Lot 4 du plan de travail.
//
// Règle d'or (R4 du plan de collaboration) : jamais « minoritaire ⇒ menteur ». Six compteurs par profil :
//   validAccept / validReject  — conformes à la référence ;
//   falseAccept / falseReject  — la signature de l'appareil atteste une valeur CONTREDITE par la référence (ou un motif infirmé par ses propres valeurs) ;
//   dispute                    — désaccord cohérent en interne (autre hash signé, autres mesures) : NEUTRE, aucune pénalité ;
//   timeout                    — membre de la vague 1 qui n'a pas répondu : compté À PART, jamais assimilé à un mensonge.
// Agrégation UNE SEULE FOIS à la finalisation (ou au refus du candidat), en UNE commande Redis (un script de HINCRBY dans un hash), jamais en polling. Aucun effet bloquant : la
// réputation s'OBSERVE d'abord (phase d'observation) ; aucune décision ne s'appuie encore dessus.
// Coût Redis : +1 EVAL par candidat finalisé ou refusé (comité « enforce » seulement), 0 au repos.

import type { Candidate } from "@/lib/chain";
import { voterKey } from "@/lib/eligibility";
import { PPM } from "@/lib/podMetrics";
import type { CommitteeOutcome } from "@/lib/committee";
import { classifyVote, type ReputationEvent, type VoteV3 } from "@/lib/podProtocolV3";

export type RepEvent = ReputationEvent | "timeout";
export const REP_EVENTS: readonly RepEvent[] = ["validAccept", "validReject", "falseAccept", "falseReject", "dispute", "timeout"];
export const REP_KEY = "rep:v1";

export interface RepEntry { profileId: string; event: RepEvent }

/** Traduction d'un vote v2 stocké vers la forme v3 que `classifyVote` sait juger (le motif v2 « blank » devient « uniform »). */
function asV3Like(v: { deviceId: string; verdict?: "accept" | "reject"; reason?: string; entropy: number; transitions: number; rle: number; rawHash?: string }, candidate: Pick<Candidate, "v2">): VoteV3 {
  const reject = v.verdict === "reject";
  const ruleCode = !reject ? "ok" : v.reason === "blank" ? "uniform" : (["hash", "metrics", "noise", "format", "rules"].includes(v.reason ?? "") ? v.reason as VoteV3["ruleCode"] : "rules");
  return {
    deviceId: v.deviceId, candidateId: "", parentHash: "", metricsVersion: 2, rulesVersion: 1, rawHash: v.rawHash ?? candidate.v2?.rawHash ?? "", saltedHash: "",
    e: Math.round(v.entropy * PPM), t: Math.round(v.transitions * PPM), r: Math.round(v.rle * PPM), verdict: reject ? "reject" : "accept", ruleCode, vclass: "C0",
  };
}

/**
 * Événements d'un candidat décidé par le comité : un par vote v2 des profils de la fenêtre (le représentant de chaque profil), plus `timeout` pour chaque membre de la vague 1 resté
 * silencieux. Les votes de profils HORS comité, les votes hérités et les cartes contradictoires ne produisent AUCUN événement.
 */
export function reputationEntries(candidate: Pick<Candidate, "v2">, outcome: CommitteeOutcome): RepEntry[] {
  const out: RepEntry[] = [];
  if (!candidate.v2) return out;
  const ref = { rawHash: candidate.v2.rawHash, e: candidate.v2.e, t: candidate.v2.t, r: candidate.v2.r };
  outcome.votes.forEach((v) => out.push({ profileId: voterKey(v), event: classifyVote(asV3Like(v, candidate), ref) }));
  outcome.disputes.forEach((p) => out.push({ profileId: p, event: "dispute" }));
  outcome.silent.forEach((p) => out.push({ profileId: p, event: "timeout" }));
  return out;
}

/** Arguments du script (champ « profil|événement », incrément), regroupés : un profil ne produit au plus qu'une ligne par événement. */
export function reputationArgs(entries: readonly RepEntry[]): string[] {
  const n = new Map<string, number>();
  for (const e of entries) n.set(`${e.profileId}|${e.event}`, (n.get(`${e.profileId}|${e.event}`) ?? 0) + 1);
  return [...n.entries()].flatMap(([field, count]) => [field, String(count)]);
}

export const REPUTATION_SCRIPT = [
  "local n = 0",
  "for i = 1, #ARGV, 2 do",
  "  redis.call('HINCRBY', KEYS[1], ARGV[i], tonumber(ARGV[i + 1]))",
  "  n = n + 1",
  "end",
  "return n",
].join("\n");

export interface RepRedis { eval(script: string, keys: string[], args: string[]): Promise<unknown> }

/** UNE commande Redis pour tous les événements. Ne lève jamais : la réputation ne doit en aucun cas empêcher de miner un bloc. */
export async function applyReputation(r: RepRedis, entries: readonly RepEntry[]): Promise<number> {
  const args = reputationArgs(entries);
  if (args.length === 0) return 0;
  try { return Number(await r.eval(REPUTATION_SCRIPT, [REP_KEY], args)) || 0; }
  catch (e) { console.error("[reputation] agrégation impossible (ignorée) :", e); return 0; }
}

/** Lecture d'un profil à partir du contenu du hash (HGETALL) : compteurs et taux de faux (sur un échantillon minimal). */
export function reputationOf(hash: Record<string, string> | null | undefined, profileId: string, minSample = 10) {
  const c = Object.fromEntries(REP_EVENTS.map((e) => [e, Number(hash?.[`${profileId}|${e}`] ?? 0)])) as Record<RepEvent, number>;
  const judged = c.validAccept + c.validReject + c.falseAccept + c.falseReject;
  return { counts: c, judged, falseRate: judged >= minSample ? (c.falseAccept + c.falseReject) / judged : null };
}
