// POST /api/circles/{id}/respond {accept: boolean} → l'INVITÉ accepte ou refuse SA propre invitation (le consentement ne peut venir que de sa session).
import { NextRequest } from "next/server";
import { circleRoute, readBody, realClock } from "@/lib/circlesRedis";
import { CircleError, respondInvite } from "@/lib/circles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => {
  const accept = (await readBody(req)).accept;
  if (typeof accept !== "boolean") throw new CircleError(400, "invalid_answer", "Réponse attendue : accepter ou refuser.");
  await respondInvite(kv, me, (await params).id, accept, realClock);
});
