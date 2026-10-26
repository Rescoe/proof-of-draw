// GET /api/circles/{id}/messages → les 50 derniers messages TEXTE (membres seulement) ; POST {text} → publier (≤ 280 caractères, 10 / 10 min). Aucun média : voir docs/LOT_UX_4_CERCLES_2026_10_26.md.
import { NextRequest } from "next/server";
import { circleRoute, readBody, realClock } from "@/lib/circlesRedis";
import { listMessages, postMessage } from "@/lib/circles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => ({ messages: await listMessages(kv, me, (await params).id) }));
export const POST = (req: NextRequest, { params }: Ctx) => circleRoute(req, async ({ me, kv }) => ({ message: await postMessage(kv, me, (await params).id, (await readBody(req)).text, realClock) }), 201);
