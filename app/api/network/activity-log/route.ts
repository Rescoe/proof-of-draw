// GET /api/network/activity-log
// Retourne les événements globaux récents synthétisés depuis Redis.
// Utilisé par le terminal global de la home page.
// Aucune donnée sensible (pas de MAC, pairCode, payload image).

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseBlocks, getCurrentCandidate, getVotes } from "@/lib/chain";
import type { Block } from "@/lib/chain";
import { recentAnimationEvents } from "@/lib/anim/store";

export const dynamic = "force-dynamic";

export type LogEventType =
  | "BLOCK_MINED"
  | "VALIDATION_PENDING"
  | "VALIDATION_VOTE"
  | "ANIMATION"
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

// QUOTA REDIS (règle primordiale) : cette route était interrogée toutes les 5 s par chaque onglet de la page d'accueil (2 composants), et
// coûtait ≈ 36 commandes par appel (30 `GET` de blocs un par un) → ≈ 50 000 commandes/h par onglet ouvert. Désormais :
//   • les blocs sont lus par UN SEUL `MGET` ;
//   • la réponse est calculée au plus une fois toutes les CACHE_MS par instance serveur ET mise en cache CDN (s-maxage) : le coût Redis
//     ne dépend plus du nombre de visiteurs ;
//   • les clients n'interrogent plus qu'onglet visible, toutes les 30 s (lib/usePolling.ts).
const CACHE_MS = 30_000;
let memo: { at: number; body: { events: LogEvent[]; generatedAt: number } } | null = null;
let inflight: Promise<{ events: LogEvent[]; generatedAt: number }> | null = null;

export async function GET() {
  try {
    if (memo && Date.now() - memo.at < CACHE_MS) return respond(memo.body);
    if (!inflight) inflight = build().then((b) => { memo = { at: Date.now(), body: b }; return b; }).finally(() => { inflight = null; });
    return respond(await inflight);
  } catch (err) {
    console.error("[/api/network/activity-log]", err);
    return NextResponse.json({ events: [], generatedAt: Date.now() });
  }
}

function respond(body: { events: LogEvent[]; generatedAt: number }) {
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}

async function build(): Promise<{ events: LogEvent[]; generatedAt: number }> {
  {
    const [hashes, candidate, voteMap] = await Promise.all([
      redis.lrange<string>("chain:recent", 0, RECENT_MAX - 1),
      getCurrentCandidate(),
      getVotes(),
    ]);

    const events: LogEvent[] = [];

    // ── Blocs récents ──────────────────────────────────────────────────────────
    if (hashes && hashes.length > 0) {
      const blocks: Block[] = await parseBlocks(hashes);   // 1 seul MGET

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
    // ── Animations de la galerie « Animations » (faites à la main, banc d'essai) ───────────────────────
    try {
      for (const a of await recentAnimationEvents(5)) {
        events.push({
          id: `anim-${a.id}`, type: "ANIMATION", ts: a.createdAt, artistName: a.author, workTitle: a.title,
          message: `ANIMATION · ${a.title} · ${a.author} · ${a.frames} images`,
        });
      }
    } catch { /* la galerie d'animations ne doit jamais casser le journal */ }

    events.sort((a, b) => b.ts - a.ts);

    return { events: events.slice(0, 50), generatedAt: Date.now() };
  }
}
