// app/api/ana-art/check/route.ts
// Manual trigger for an ANA feed check (the "bouton" in the gallery/device
// settings that checks now instead of waiting for the next opted-in device
// pull) — see lib/anaFeed.ts for the actual pull+ingest logic. No auth: this
// only ever reads from ANA and writes tagged blocks/frames for devices that
// already opted in — running it early or often changes nothing unsafe, the
// dedup set in lib/anaFeed.ts makes repeated calls a no-op past the first.

import { NextResponse } from "next/server";
import { checkAnaFeedNow } from "@/lib/anaFeed";

export async function POST() {
  const result = await checkAnaFeedNow();
  return NextResponse.json({ ok: true, ...result });
}
