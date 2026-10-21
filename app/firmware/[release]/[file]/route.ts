// app/firmware/[release]/[file]/route.ts
// GET /firmware/<releaseId>/image.bin?d=<deviceId>&e=<exp>&c=<défi>&g=<signature Ed25519 de l'appareil> — image OTA signée, réservée à l'appareil qui y a droit.
//
// INACTIVE par défaut : 404 tant que OTA_DIST_MODE n'est pas « on » ET que OTA_TICKET_SECRET (≥ 32 caractères) et OTA_TRUSTED_KEYS (clés PUBLIQUES de publication) n'existent pas.
// Aucune clé privée ici. Contrôles et ordre : lib/otaDistribution.ts (otaImageResponse). COÛT REDIS : 0 pour toute requête refusée avant l'étape 6 ; au plus 4 commandes ensuite
// (interrupteur d'urgence, limite par IP, lecture de l'appareil) ; le quota de l'appareil (2 commandes) n'est compté qu'après une signature valide — jamais de polling : un appareil télécharge une fois par version.
// Spécification : docs/ADR_DISTRIBUTION_OTA_ESP8266_2026_10_18.md.

import { NextRequest } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { checkRateLimit, getIP } from "@/lib/rateLimit";
import { OTA_FETCH_LIMIT, OTA_FETCH_WINDOW_SEC, OTA_KILL_KEY, OTA_PRELIMIT_PER_WINDOW, OTA_PRELIMIT_WINDOW_SEC, otaDistModeFromEnv, otaImageResponse, otaTicketSecret } from "@/lib/otaDistribution";
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
    preLimitOk: async () => (await checkRateLimit({ route: "ota-image-pre", id: getIP(req), limit: OTA_PRELIMIT_PER_WINDOW, windowSec: OTA_PRELIMIT_WINDOW_SEC })).allowed,
    rateLimitOk: async (deviceId) => (await checkRateLimit({ route: "ota-image", id: deviceId, limit: OTA_FETCH_LIMIT, windowSec: OTA_FETCH_WINDOW_SEC })).allowed,
    loadDevice: async (deviceId) => { const d = await getDevice(deviceId); return d ? { publicKey: d.publicKey, firmware: d.firmware } : null; },
  });
}
