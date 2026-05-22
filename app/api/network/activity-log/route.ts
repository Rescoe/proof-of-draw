// GET /api/network/activity-log
// Retourne les événements globaux récents synthétisés depuis Redis.
// Utilisé par le terminal global de la home page.
// Aucune donnée sensible (pas de MAC, pairCode, payload image).

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getBlockByHash, getCurrentCandidate, getVotes } from "@/lib/chain";
import type { Block } from "@/lib/chain";

export const dynamic = "force-dynamic";

export type LogEventType =
  | "BLOCK_MINED"
  | "VALIDATION_PENDING"
  | "VALIDATION_VOTE"
  | "CHAIN_EMPTY";

export type LogEvent = {
  id: string;
  type: LogEventType;
  ts: number;
  screen?: string;
  artistName?: string;
  blockIndex?: number;
  blockHash?: string;
  score?: number;
  drawScore?: number;
  validatorCount?: number;
  poolSize?: number;
  workTitle?: string;
  message: string;
};

const RECENT_MAX = 30;

export async function GET() {
  try {
    const [hashes, candidate, voteMap] = await Promise.all([
      redis.lrange<string>("chain:recent", 0, RECENT_MAX - 1),
      getCurrentCandidate(),
      getVotes(),
    ]);

    const events: LogEvent[] = [];

    // ── Blocs récents ──────────────────────────────────────────────────────────
    if (hashes && hashes.length > 0) {
      const blocks = (
        await Promise.all(
          hashes.map(async (hash: string) => {
            try { return await getBlockByHash(hash); } catch { return null; }
          })
        )
      ).filter((b): b is Block => b !== null);

      for (const b of blocks) {
        const artist = b.drawArtistName || b.artistName || "?";
        const title  = b.workTitle && b.workTitle !== "Sans titre" ? ` "${b.workTitle}"` : "";
        events.push({
          id:             `block-${b.blockHash}`,
          type:           "BLOCK_MINED",
          ts:             b.minedAt,
          screen:         b.poolScreen,
          artistName:     artist,
          blockIndex:     b.blockIndex,
          blockHash:      b.blockHash,
          score:          b.score,
          drawScore:      b.drawScore,
          validatorCount: b.validatorIds?.length ?? 0,
          workTitle:      b.workTitle,
          message: `BLOC #${b.blockIndex}${title} · ${b.poolScreen} · ${artist} · PoD ${(b.drawScore * 100).toFixed(0)}%`,
        });
      }
    }

    // ── Candidat en validation ─────────────────────────────────────────────────
    if (candidate) {
      const voteCount = voteMap ? Object.keys(voteMap.votes).length : 0;
      const artist = candidate.drawArtistName || candidate.artistName || "?";
      const title  = candidate.workTitle && candidate.workTitle !== "Sans titre"
        ? ` "${candidate.workTitle}"`
        : "";
      events.push({
        id:           `candidate-${candidate.candidateId}`,
        type:         "VALIDATION_PENDING",
        ts:           candidate.submittedAt,
        screen:       candidate.poolScreen,
        artistName:   artist,
        score:        candidate.score,
        drawScore:    candidate.drawScore,
        poolSize:     candidate.poolSize,
        validatorCount: voteCount,
        workTitle:    candidate.workTitle,
        message: `VALIDATION${title} · ${candidate.poolScreen} · ${artist} · ${voteCount}/${candidate.poolSize} votes`,
      });

      // Votes individuels
      if (voteMap) {
        for (const [devId, vote] of Object.entries(voteMap.votes)) {
          events.push({
            id:      `vote-${candidate.candidateId}-${devId}`,
            type:    "VALIDATION_VOTE",
            ts:      vote.votedAt,
            screen:  candidate.poolScreen,
            message: `VOTE · ${devId.slice(0, 12)} · score ${(vote.score * 100).toFixed(0)}%`,
          });
        }
      }
    }

    // Trier par ts DESC (plus récent en premier)
    events.sort((a, b) => b.ts - a.ts);

    return NextResponse.json(
      { events: events.slice(0, 50), generatedAt: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[/api/network/activity-log]", err);
    return NextResponse.json({ events: [], generatedAt: Date.now() });
  }
}
