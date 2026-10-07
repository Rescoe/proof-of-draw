// lib/candidateFrameResponse.ts — réponse de GET /api/candidate-frame (contenu brut du candidat), isolée de la route pour être testable sans Redis.
//
// CACHE (Lot 0S, 06/10/2026) : seule la réponse 200 est immuable (UUID du candidat ⇒ contenu fixe). Toute AUTRE réponse (400, 404, 500) porte `Cache-Control: no-store` :
// auparavant le 404 « candidat introuvable » était mis en cache 30 s par le CDN, si bien qu'un validateur arrivant AVANT que le candidat soit publié empoisonnait l'URL
// (les autres validateurs recevaient le même 404 jusqu'à 30 s).
// COÛT REDIS : chemin nominal (200) inchangé — 1 lecture du candidat courant à la première requête, ensuite le CDN ; identifiant invalide (400) : aucune lecture.
// Chemin d'erreur 404 sur un identifiant VALIDE : +1 lecture par requête (plus de cache de 30 s) — coût d'erreur assumé, borné par le rate-limit de `validate-candidate` qui précède (docs/LOT_0S_…).

import { NextResponse } from "next/server";
import type { Candidate } from "@/lib/chain";
import { METRICS_VERSION, isPodScreen, rawContent } from "@/lib/podMetrics";

export const CANDIDATE_FRAME_CACHE_OK = "public, s-maxage=1800, max-age=1800, immutable";
export const CANDIDATE_FRAME_CACHE_ERROR = "no-store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": CANDIDATE_FRAME_CACHE_ERROR } });
}

/** `loadCurrent` : lecture du candidat courant (injectée pour les tests ; appelée seulement si l'identifiant est valide). */
export async function candidateFrameResponse(candidateId: string, loadCurrent: () => Promise<Candidate | null>): Promise<NextResponse> {
  if (!UUID_RE.test(candidateId)) return fail("candidateId invalide", 400);

  const candidate = await loadCurrent();
  if (!candidate || candidate.candidateId !== candidateId || !candidate.v2) return fail("Candidat introuvable ou sans spécification v2", 404);
  const screen = candidate.v2.screen;
  if (!isPodScreen(screen)) return fail("écran non géré", 404);

  let body: Uint8Array;
  try { body = rawContent(screen, candidate.payload as { buffer?: string; black?: string; red?: string }); }
  catch { return fail("contenu illisible", 500); }

  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      "Cache-Control": CANDIDATE_FRAME_CACHE_OK,
      "X-Screen-Type": screen,
      "X-Raw-Hash": candidate.v2.rawHash,
      "X-Metrics-Version": String(METRICS_VERSION),
    },
  });
}
