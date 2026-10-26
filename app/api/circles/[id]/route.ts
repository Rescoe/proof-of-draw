// GET /api/circles/{id} → le cercle (membres seulement ; non-membre = 404 identique à « inexistant ») ; DELETE {confirmName} → suppression (propriétaire).
import { NextRequest } from "next/server";
import { circleRoute, readBody, realClock } from "@/lib/circlesRedis";
import { deleteCircle, getCircle } from "@/lib/circles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => ({ circle: await getCircle(kv, me, (await params).id, realClock) }));
export const DELETE = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => { await deleteCircle(kv, me, (await params).id, (await readBody(req)).confirmName); });
