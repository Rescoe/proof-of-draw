// app/firmware/[release]/[file]/route.ts
// GET /firmware/<releaseId>/image.bin?d=<deviceId>&e=<exp>&c=<défi>&g=<signature Ed25519 de l'appareil> — image OTA signée, réservée à l'appareil qui y a droit.
//
// INACTIVE par défaut : 404 tant que OTA_DIST_MODE n'est pas « on » ET que OTA_TICKET_SECRET (≥ 32 caractères) et OTA_TRUSTED_KEYS (clés PUBLIQUES de publication) n'existent pas.
// Aucune clé privée ici. Contrôles et ordre : lib/otaDistribution.ts (otaImageResponse). COÛT REDIS : 0 pour toute requête refusée avant l'étape 6 ; au plus 3 commandes ensuite
// (interrupteur d'urgence, limite de débit, lecture de l'appareil) — jamais de polling : un appareil télécharge une fois par version.
// Spécification : docs/ADR_DISTRIBUTION_OTA_ESP8266_2026_10_18.md.

import { NextRequest } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { checkRateLimit } from "@/lib/rateLimit";
import { OTA_FETCH_LIMIT, OTA_FETCH_WINDOW_SEC, OTA_KILL_KEY, otaDistModeFromEnv, otaImageResponse, otaTicketSecret } from "@/lib/otaDistribution";
import { trustedKeysFromEnv } from "@/lib/otaReleases";
import { otaReleases } from "@/lib/otaRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(req: NextRequest, ctx: { params: Promise<{ release: string; file: string }> }) {
  const { release, file } = await ctx.params;
  return otaImageResponse({
    mode: otaDistModeFromEnv(), secret: otaTicketSecret(), trustedKeysPresent: trustedKeysFromEnv() !== null, now: Date.now(),
    releaseId: release, fileName: file, rawSearch: req.nextUrl.search,
    loadRelease: (id) => otaReleases().find((r) => r.manifest.releaseId === id) ?? null,
    isKilled: async () => !!(await redis.get(OTA_KILL_KEY)),
    rateLimitOk: async (deviceId) => (await checkRateLimit({ route: "ota-image", id: deviceId, limit: OTA_FETCH_LIMIT, windowSec: OTA_FETCH_WINDOW_SEC })).allowed,
    loadDevice: async (deviceId) => { const d = await getDevice(deviceId); return d ? { publicKey: d.publicKey, firmware: d.firmware } : null; },
  });
}
