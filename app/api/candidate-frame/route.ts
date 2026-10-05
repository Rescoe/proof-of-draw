// app/api/candidate-frame/route.ts
// GET /api/candidate-frame?candidateId=… — contenu BRUT du candidat courant, pour que les appareils le revérifient (chantier « validation réelle », P2).
//
//   Corps : octets bruts, dans l'ordre canonique de lib/podMetrics.ts (tampon unique ; noir ‖ rouge pour l'e-ink 2,9″). Pas de JSON, pas de base64
//   (même principe que /api/pull-frame). En-têtes : X-Screen-Type, X-Raw-Hash (SHA-256 hex du corps), X-Metrics-Version.
//   Les ESP8266 le lisent EN FLUX (readFull() en boucle) : hash SHA-256 + métriques entières sans jamais garder l'image en mémoire.
//
// COÛT REDIS : 1 lecture du candidat à la PREMIÈRE requête ; la réponse est immuable par candidateId (UUID) → servie ensuite par le CDN :
// le coût ne dépend pas du nombre de validateurs. Le contenu n'a rien de secret (il est publié dans la galerie une fois le bloc miné).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentCandidate } from "@/lib/chain";
import { isPodScreen, rawContent } from "@/lib/podMetrics";
import { METRICS_VERSION } from "@/lib/podMetrics";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get("candidateId") ?? "";
  if (!UUID_RE.test(candidateId)) return NextResponse.json({ error: "candidateId invalide" }, { status: 400 });

  const candidate = await getCurrentCandidate();
  if (!candidate || candidate.candidateId !== candidateId || !candidate.v2) {
    return NextResponse.json({ error: "Candidat introuvable ou sans spécification v2" }, { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } });
  }
  const screen = candidate.v2.screen;
  if (!isPodScreen(screen)) return NextResponse.json({ error: "écran non géré" }, { status: 404 });

  let body: Uint8Array;
  try { body = rawContent(screen, candidate.payload as { buffer?: string; black?: string; red?: string }); }
  catch { return NextResponse.json({ error: "contenu illisible" }, { status: 500 }); }

  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
      "Cache-Control": "public, s-maxage=1800, max-age=1800, immutable",
      "X-Screen-Type": screen,
      "X-Raw-Hash": candidate.v2.rawHash,
      "X-Metrics-Version": String(METRICS_VERSION),
    },
  });
}
