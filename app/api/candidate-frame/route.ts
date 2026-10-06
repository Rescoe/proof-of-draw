// app/api/candidate-frame/route.ts
// GET /api/candidate-frame?candidateId=… — contenu BRUT du candidat courant, pour que les appareils le revérifient (chantier « validation réelle », P2).
//
//   Corps : octets bruts, dans l'ordre canonique de lib/podMetrics.ts (tampon unique ; noir ‖ rouge pour l'e-ink 2,9″). Pas de JSON, pas de base64
//   (même principe que /api/pull-frame). En-têtes : X-Screen-Type, X-Raw-Hash (SHA-256 hex du corps), X-Metrics-Version.
//   Les ESP8266 le lisent EN FLUX (readFull() en boucle) : hash SHA-256 + métriques entières sans jamais garder l'image en mémoire.
//
// COÛT REDIS : 1 lecture du candidat à la PREMIÈRE requête ; la réponse 200 est immuable par candidateId (UUID) → servie ensuite par le CDN :
// le coût ne dépend pas du nombre de validateurs. Le contenu n'a rien de secret (il est publié dans la galerie une fois le bloc miné).
// CACHE : seule la réponse 200 est mise en cache ; les erreurs (400/404/500) sont `no-store` (voir lib/candidateFrameResponse.ts).

import { NextRequest } from "next/server";
import { getCurrentCandidate } from "@/lib/chain";
import { candidateFrameResponse } from "@/lib/candidateFrameResponse";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return candidateFrameResponse(req.nextUrl.searchParams.get("candidateId") ?? "", getCurrentCandidate);
}
