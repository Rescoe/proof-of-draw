// lib/animClipResponse.ts — réponse de GET /api/candidate-clip (Lot 6B-2), isolée de la route pour être testable SANS Redis (la lecture du candidat est injectée et COMPTÉE par les tests).
//
// Ordre des contrôles — AUCUN n'accède à Redis avant le dernier :
//   1. route inactive (ANIM_V3_MODE = off, ou CLIP_TICKET_SECRET absent/trop court)            → 404 no-store, 0 lecture ;
//   2. requête : exactement ?candidateId=…&exp=…&t=… (ordre, formats, aucun paramètre en plus)  → 400 no-store, 0 lecture ;
//   3. ticket HMAC valide (temps constant)                                                      → 403 no-store, 0 lecture ;
//   4. ticket non expiré                                                                        → 410 no-store, 0 lecture ;
//   5. UNE lecture du candidat courant ; il doit être CE candidat, porter un clip, et `exp` doit égaler `clipTicketExp(candidate.expiresAt)` → sinon 404 no-store ;
//   6. 200 : octets exacts du clip (≤ 9 216 o), IMMUABLE pour cette URL jusqu'à l'expiration.
// Coût Redis : 1 lecture par EXÉCUTION de la route (= défaut de cache CDN) avec ticket valide ; 0 sinon. Chaque exécution journalise une ligne MISS (aucun compteur Redis : ce serait une commande de plus).

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { Candidate } from "@/lib/chain";
import { analyzeClip } from "@/lib/animV3";
import type { AnimV3Mode } from "@/lib/animV3Mode";
import { clipTicketExp, parseClipQuery, verifyClipTicket } from "@/lib/clipTicket";

export const CLIP_CACHE_ERROR = "no-store";
export const CLIP_CACHE_MAX_SEC = 1800;

const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": CLIP_CACHE_ERROR } });

export interface ClipResponseOptions {
  /** chaîne de requête BRUTE (`new URL(req.url).search`, « ?… » ou vide) */
  rawSearch: string;
  mode: AnimV3Mode;
  secret: string | null;
  now: number;
  /** lecture du candidat courant (UNE commande Redis) : appelée seulement APRÈS tous les contrôles sans Redis */
  loadCurrent: () => Promise<Candidate | null>;
  log?: (line: string) => void;
}

export async function candidateClipResponse(o: ClipResponseOptions): Promise<NextResponse> {
  const log = o.log ?? ((l: string) => console.log(l));
  if (o.mode === "off" || !o.secret) return fail("route inactive", 404);
  const q = parseClipQuery(o.rawSearch);
  if (!q.ok) return fail(q.error, 400);
  if (!verifyClipTicket(o.secret, q.candidateId, q.exp, q.t)) return fail("ticket invalide", 403);
  if (q.exp * 1000 <= o.now) return fail("ticket expiré", 410);

  const candidate = await o.loadCurrent();
  // journal des défauts de cache (AUCUN compteur Redis) : `votersExpected` = taille de l'électorat figé du candidat (profils ; borne haute des demandeurs), sinon son poolSize, sinon « ? »
  const voters = candidate?.eligibility?.profileIds?.length ?? candidate?.poolSize;
  log(`[candidate-clip] MISS candidate=${q.candidateId.slice(0, 8)} votersExpected=${typeof voters === "number" ? voters : "?"}`);
  if (!candidate || candidate.candidateId !== q.candidateId || !candidate.anim || clipTicketExp(candidate.expiresAt) !== q.exp) return fail("candidat introuvable", 404);

  let body: Uint8Array;
  try { body = new Uint8Array(Buffer.from(candidate.anim.clip, "base64")); } catch { return fail("clip illisible", 500); }
  if (body.length === 0) return fail("clip illisible", 500);
  const a = analyzeClip(body);
  const remaining = Math.max(1, Math.min(CLIP_CACHE_MAX_SEC, Math.floor(q.exp - o.now / 1000)));
  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      "Cache-Control": `public, s-maxage=${remaining}, max-age=${remaining}, immutable`,
      "X-Clip-Hash": createHash("sha256").update(body).digest("hex"),
      ...(a.formatOk ? { "X-Anim-Root": a.animRoot, "X-Clip-Frames": String(a.N) } : {}),
      "X-Metrics-Version": "2",
    },
  });
}
