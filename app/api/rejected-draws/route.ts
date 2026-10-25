// app/api/rejected-draws/route.ts
// Dessins rejetés (Redis: rejected:draws, 50 derniers) + candidat EN ATTENTE de décision (avec les votes déjà reçus).
//
// 25/10/2026 : (1) un candidat qui expire sans quorum n'apparaissait qu'à la création du candidat SUIVANT (« N+1 ») : la lecture réconcilie maintenant le candidat perdu (lib/rejectedArchive.ts,
// idempotent, au mieux) ; (2) `pending` montre le candidat en cours, qui l'a reçu, combien de votes sont arrivés, et lesquels (accepte / refuse, v2 vérifié ou écho) : la cause d'un dessin qui ne s'affiche pas
// est visible AVANT son expiration ; (3) chaque entrée porte `candidateId` : l'image se charge à la demande par /api/rejected-image.
// Coût Redis : lecture CDN 20 s ; au plus 3 GET (pointeur, courant, copie) pour la réconciliation + 1 LRANGE + 2 GET (courant, votes) — tous les 20 s au plus quel que soit le nombre de lecteurs.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getCurrentCandidate, getVotes } from "@/lib/chain";
import { reconcileLostCandidate, type ArchiveKV } from "@/lib/rejectedArchive";
import { settleExpired } from "@/lib/quorumHealth";
import { describeVote, type VoteLike } from "@/lib/validationSummary";

export interface RejectedDraw {
  deviceId: string;
  screen: string;
  drawScore: number;
  score: number;
  reason: string;
  rejectedAt: number;
  workTitle?: string | null;
  drawArtistName?: string | null;
  candidateId?: string;
}

export interface PendingVote { deviceId: string; verdict: "accept" | "reject"; v: 1 | 2; detail: string }
export interface PendingCandidate {
  candidateId: string;
  deviceId: string;
  screen: string;
  workTitle?: string | null;
  drawArtistName?: string | null;
  submittedAt: number;
  expiresAt: number;
  poolSize: number;
  quorumNeeded: number;
  votes: PendingVote[];
}

function quorumNeeded(poolSize: number, ratio = parseFloat(process.env.QUORUM_RATIO ?? "0.51")): number {
  return Math.max(1, Math.ceil(poolSize * ratio));
}

async function pendingCandidate(): Promise<PendingCandidate | null> {
  const cand = await getCurrentCandidate().catch(() => null);
  if (!cand) return null;
  const vm = await getVotes().catch(() => null);
  const votes: PendingVote[] = [];
  if (vm && vm.candidateId === cand.candidateId) {
    for (const [deviceId, v] of Object.entries(vm.votes ?? {})) {
      const d = describeVote(v as unknown as VoteLike);
      votes.push({ deviceId, verdict: d.verdict, v: d.voteVersion, detail: d.detail });
    }
  }
  return {
    candidateId: cand.candidateId, deviceId: cand.deviceId, screen: cand.poolScreen,
    workTitle: cand.workTitle ?? null, drawArtistName: cand.drawArtistName ?? cand.artistName ?? null,
    submittedAt: cand.submittedAt, expiresAt: cand.expiresAt, poolSize: cand.poolSize, quorumNeeded: quorumNeeded(cand.poolSize), votes,
  };
}

export async function GET(_req: NextRequest) {
  // Un candidat expiré sans décision est enregistré dès maintenant, pas au candidat suivant (au mieux : un échec ne bloque pas la lecture).
  const lost = await reconcileLostCandidate(redis as unknown as ArchiveKV).catch((e) => { console.error("[rejected-draws] réconciliation échouée:", e instanceof Error ? e.message : "erreur"); return null; });
  if (lost) await settleExpired(lost.candidateId);   // quorum vivant : les appareils actifs qui n'ont pas voté pour ce candidat expiré sortent du quorum (lib/quorumHealth.ts)

  const [raw, pending] = await Promise.all([redis.lrange<string>("rejected:draws", 0, 49), pendingCandidate()]);

  const entries: RejectedDraw[] = [];
  for (const item of raw ?? []) {
    try {
      const parsed = typeof item === "string" ? JSON.parse(item) : item;
      entries.push(parsed as RejectedDraw);
    } catch {
      // skip malformed
    }
  }

  return NextResponse.json({ rejected: entries, total: entries.length, pending }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } });
}
