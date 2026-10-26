// POST /api/circles/{id}/leave → un membre (non propriétaire) quitte le cercle.
import { NextRequest } from "next/server";
import { circleRoute } from "@/lib/circlesRedis";
import { leaveCircle } from "@/lib/circles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => { await leaveCircle(kv, me, (await params).id); });
