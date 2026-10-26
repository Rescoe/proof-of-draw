// DELETE /api/circles/{id}/members {artistId} → le PROPRIÉTAIRE retire un membre (jamais lui-même).
import { NextRequest } from "next/server";
import { circleRoute, readBody } from "@/lib/circlesRedis";
import { removeMember } from "@/lib/circles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const DELETE = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => { await removeMember(kv, me, (await params).id, (await readBody(req)).artistId); });
