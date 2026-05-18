// app/api/rejected-draws/route.ts
// Expose la liste des dessins rejetés (Redis: rejected:draws) — 50 derniers max.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export interface RejectedDraw {
  deviceId: string;
  screen: string;
  drawScore: number;
  score: number;
  reason: string;
  rejectedAt: number;
  workTitle?: string | null;
  drawArtistName?: string | null;
}

export async function GET(_req: NextRequest) {
  const raw = await redis.lrange<string>("rejected:draws", 0, 49);

  const entries: RejectedDraw[] = [];
  for (const item of raw ?? []) {
    try {
      const parsed = typeof item === "string" ? JSON.parse(item) : item;
      entries.push(parsed as RejectedDraw);
    } catch {
      // skip malformed
    }
  }

  return NextResponse.json({ rejected: entries, total: entries.length });
}
