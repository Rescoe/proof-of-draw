// app/api/candidate-clip/route.ts
// GET /api/candidate-clip?candidateId=…&exp=…&t=… — octets EXACTS du clip PBC1 du candidat animation (Lot 6B-2, docs/SPEC_PODANIM_V3.md § 7), pour qu'un appareil le relise en flux AVANT de voter.
//
// INACTIVE par défaut : 404 tant que ANIM_V3_MODE n'est pas « shadow » ET que CLIP_TICKET_SECRET (≥ 32 caractères) n'existe pas. Aucun ticket n'est distribué aux firmwares actuels.
// Ticket HMAC commun au candidat, vérifié AVANT toute lecture Redis ; paramètres exactement candidateId, exp, t (aucun autre, ordre fixe) ; voir lib/animClipResponse.ts.
// COÛT REDIS : 1 lecture du candidat par exécution de la route (défaut de cache CDN) avec ticket valide ; 0 pour toute requête refusée ; aucun polling.

import { NextRequest } from "next/server";
import { getCurrentCandidate } from "@/lib/chain";
import { animV3ModeFromEnv } from "@/lib/animV3Mode";
import { candidateClipResponse } from "@/lib/animClipResponse";
import { clipTicketSecret } from "@/lib/clipTicket";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return candidateClipResponse({ rawSearch: req.nextUrl.search, mode: animV3ModeFromEnv(), secret: clipTicketSecret(), now: Date.now(), loadCurrent: getCurrentCandidate });
}
