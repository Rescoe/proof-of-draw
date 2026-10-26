// POST /api/circles/{id}/invite {artistId} → le PROPRIÉTAIRE invite (l'invité doit accepter) ; DELETE {artistId} → annule une invitation en attente.
import { NextRequest } from "next/server";
import { artistLookup, circleRoute, readBody, realClock } from "@/lib/circlesRedis";
import { cancelInvite, inviteArtist } from "@/lib/circles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => { await inviteArtist(kv, me, (await params).id, (await readBody(req)).artistId, artistLookup, realClock); }, 201);
export const DELETE = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => { await cancelInvite(kv, me, (await params).id, (await readBody(req)).artistId); });
