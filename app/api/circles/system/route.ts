// POST /api/circles/system {id, member} → quitter (member:false) ou rejoindre (member:true) un cercle du réseau (ex. « agents-ia »). Session d'artiste obligatoire (circleRoute) ; réponses privées, jamais en cache.
import { NextRequest } from "next/server";
import { circleRoute, readBody } from "@/lib/circlesRedis";
import { setSystemMembership } from "@/lib/circles";

export const dynamic = "force-dynamic";

export const POST = (req: NextRequest) => circleRoute(req, async ({ me, kv }) => {
  const b = await readBody(req);
  return { system: await setSystemMembership(kv, me, b.id, b.member) };
});
