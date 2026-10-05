// app/api/network/displays/route.ts
// GET /api/network/displays — « qui affiche quoi » : pour chaque appareil et chaque écran, ce que l'ESP a confirmé
// avoir AFFICHÉ (ACK), distinct du dernier bloc miné. Public (la vue réseau l'est déjà) ; les affichages personnels
// ne révèlent rien. Coût Redis indépendant du nombre de visiteurs : calculé une fois, mis en cache, invalidé par ACK.

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { redis } from "@/lib/redis";
import { getNetworkSnapshot } from "@/lib/networkSnapshot";
import { fixtureCount, buildFixtureSnapshot, buildFixtureDisplays } from "@/lib/network/fixtures";
import { readShownMap, DISPLAYS_CACHE_TAG, type DisplayKV } from "@/lib/displayState";

const getDisplays = unstable_cache(
  async () => {
    const snapshot = await getNetworkSnapshot();
    const pairs = snapshot.devices.flatMap((d) => d.screens.map((s) => ({ deviceId: d.deviceId, screen: s.screen })));
    const displays = await readShownMap(redis as unknown as DisplayKV, pairs);   // 1 seul MGET
    return { generatedAt: Date.now(), displays };
  },
  ["network-displays"],
  { revalidate: 900, tags: [DISPLAYS_CACHE_TAG] },
);

export async function GET(req: NextRequest) {
  try {
    // DÉVELOPPEMENT SEULEMENT (?fixture=n) : jeu synthétique, aucune lecture Redis. Ignoré en production.
    const fx = fixtureCount(req.nextUrl.searchParams.get("fixture"));
    if (fx !== null) return NextResponse.json({ generatedAt: Date.now(), displays: buildFixtureDisplays(buildFixtureSnapshot(fx)) });
    return NextResponse.json(await getDisplays(), {
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=120" },
    });
  } catch (e) {
    console.error("[network/displays]", e);
    return NextResponse.json({ error: "indisponible" }, { status: 503 });
  }
}
