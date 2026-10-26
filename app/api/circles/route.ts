// GET /api/circles → mes cercles + mes invitations ; POST /api/circles {name} → créer un cercle. Droits et limites : lib/circles.ts. Réponses privées, jamais mises en cache.
import { NextRequest } from "next/server";
import { circleRoute, readBody, realClock } from "@/lib/circlesRedis";
import { createCircle, listMine } from "@/lib/circles";

export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) => circleRoute(req, ({ me, kv }) => listMine(kv, me, realClock));
export const POST = (req: NextRequest) => circleRoute(req, async ({ me, kv }) => ({ circle: await createCircle(kv, me, (await readBody(req)).name, realClock) }), 201);
