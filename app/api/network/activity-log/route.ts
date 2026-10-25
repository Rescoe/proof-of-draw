// GET /api/network/activity-log
// Retourne les événements globaux récents synthétisés depuis Redis.
// Utilisé par le terminal global de la home page.
// Aucune donnée sensible (pas de MAC, pairCode, payload image).

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseBlocks, getCurrentCandidate, getVotes, getCanonicalChain } from "@/lib/chain";
import type { Block } from "@/lib/chain";
import { recentAnimationEvents } from "@/lib/anim/store";
import { fixtureCount, buildFixtureSnapshot, buildFixtureEvents } from "@/lib/network/fixtures";
import { publicDeviceId } from "@/lib/network/publicId";
import { describeSummary, describeVote } from "@/lib/validationSummary";

export const dynamic = "force-dynamic";

export type LogEventType =
  | "BLOCK_MINED"
  | "VALIDATION_PENDING"
  | "VALIDATION_VOTE"
  | "ANIMATION"
  | "CANDIDATE_REJECTED"
  | "CHAIN_EMPTY";

export type LogEvent = {
  id: string;
  type: LogEventType;
  ts: number;
  screen?: string;
  /** Identifiant PUBLIC (pub_xxxxxxxxxxxx) de l'appareil concerné — jamais le deviceId réel. Même valeur que NetworkDevice.publicId. */
  deviceRef?: string;
  artistName?: string;
  blockIndex?: number;
  blockHash?: string;
  score?: number;
  drawScore?: number;
  validatorCount?: number;
  poolSize?: number;
  workTitle?: string;
  /** Niveau de validation réellement atteint (bloc) : « v2 vérifié×1 · v1 écho×0 ». Absent pour un bloc ancien. */
  votesLabel?: string;
  /** Vote : version (1 = écho du score serveur, 2 = recalculé par l'appareil), verdict, motif de refus, métriques entières en ppm. */
  voteVersion?: 1 | 2;
  verdict?: "accept" | "reject";
  reason?: string;
  metricsPpm?: { e: number; t: number; r: number };
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
type Body = { events: LogEvent[]; generatedAt: number };
// 25/10/2026 : `?days=N` (1 à 31) renvoie TOUTE la semaine (blocs de la chaîne canonique + dessins rejetés), pas seulement les 30 derniers blocs ; sans paramètre : comportement d'avant (50 événements récents).
// Mémoire et cache CDN par valeur de `days`. Coût Redis : la chaîne est mise en cache par hash de tête (lib/chain.ts getCanonicalChain) ; +1 LRANGE pour les rejets.
const memo = new Map<number, { at: number; body: Body }>();
const inflight = new Map<number, Promise<Body>>();
const MAX_EVENTS_WINDOW = 1500;

export async function GET(req: NextRequest) {
  try {
    // DÉVELOPPEMENT SEULEMENT (?fixture=n) : événements synthétiques, aucune lecture Redis. Ignoré en production.
    const fx = fixtureCount(req.nextUrl.searchParams.get("fixture"));
    if (fx !== null) return NextResponse.json({ events: buildFixtureEvents(buildFixtureSnapshot(fx)), generatedAt: Date.now() });
    const d = Math.floor(Number(req.nextUrl.searchParams.get("days") ?? "0"));
    const days = Number.isFinite(d) && d >= 1 ? Math.min(31, d) : 0;
    const hit = memo.get(days);
    if (hit && Date.now() - hit.at < CACHE_MS) return respond(hit.body);
    let p = inflight.get(days);
    if (!p) { p = build(days).then((b) => { memo.set(days, { at: Date.now(), body: b }); return b; }).finally(() => { inflight.delete(days); }); inflight.set(days, p); }
    return respond(await p);
  } catch (err) {
    console.error("[/api/network/activity-log]", err);
    return NextResponse.json({ events: [], generatedAt: Date.now() });
  }
}

function respond(body: { events: LogEvent[]; generatedAt: number }) {
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}

async function build(days: number): Promise<{ events: LogEvent[]; generatedAt: number }> {
  {
    const since = days > 0 ? Date.now() - days * 86_400_000 : 0;
    const [hashes, candidate, voteMap, chain, rejectedRaw] = await Promise.all([
      days > 0 ? Promise.resolve<string[]>([]) : redis.lrange<string>("chain:recent", 0, RECENT_MAX - 1),
      getCurrentCandidate(),
      getVotes(),
      days > 0 ? getCanonicalChain().catch(() => null) : Promise.resolve(null),
      days > 0 ? redis.lrange<string>("rejected:draws", 0, 199) : Promise.resolve<string[]>([]),
    ]);

    const events: LogEvent[] = [];

    // ── Blocs : les 30 derniers (comportement d'origine) ou, avec `days`, tous ceux de la fenêtre dans la chaîne canonique ──────────────
    const windowBlocks: Block[] | null = days > 0 ? (chain?.blocks ?? []).filter((b) => b.minedAt >= since) : null;
    if (windowBlocks || (hashes && hashes.length > 0)) {
      const blocks: Block[] = windowBlocks ?? await parseBlocks(hashes);   // 1 seul MGET (mode d'origine)

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
          ...(b.votesSummary ? { votesLabel: describeSummary(b.votesSummary) } : {}),
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
            deviceRef: publicDeviceId(devId),
            ...(() => { const d = describeVote(vote); return { voteVersion: d.voteVersion, verdict: d.verdict, ...(d.reason ? { reason: d.reason } : {}), ...(d.metricsPpm ? { metricsPpm: d.metricsPpm } : {}), message: `VOTE · ${publicDeviceId(devId)} · ${d.detail}` }; })(),
          });
        }
      }
    }

    // ── Dessins rejetés / expirés de la fenêtre (liste rejected:draws : 200 entrées, 90 jours) ─────────────────────────────────────────
    if (days > 0) {
      for (const item of rejectedRaw ?? []) {
        try {
          const r = (typeof item === "string" ? JSON.parse(item) : item) as { deviceId?: string; screen?: string; reason?: string; rejectedAt?: number; workTitle?: string | null; drawArtistName?: string | null; candidateId?: string };
          if (typeof r.rejectedAt !== "number" || r.rejectedAt < since) continue;
          const title = r.workTitle && r.workTitle !== "Sans titre" ? ` "${r.workTitle}"` : "";
          events.push({
            id: `rej-${r.candidateId ?? r.rejectedAt}`, type: "CANDIDATE_REJECTED", ts: r.rejectedAt, screen: r.screen,
            ...(r.deviceId ? { deviceRef: publicDeviceId(r.deviceId) } : {}), artistName: r.drawArtistName ?? undefined, workTitle: r.workTitle ?? undefined,
            reason: String(r.reason ?? "").slice(0, 200), message: `REJETÉ${title} · ${r.screen ?? "?"} · ${String(r.reason ?? "").slice(0, 160)}`,
          });
        } catch { /* entrée illisible : ignorée */ }
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

    return { events: events.slice(0, days > 0 ? MAX_EVENTS_WINDOW : 50), generatedAt: Date.now() };
  }
}
