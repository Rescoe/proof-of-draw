import { join } from "node:path";
import { loadAllReleases, trustedKeysFromEnv } from "@/lib/otaReleases";
import type { OtaRelease } from "@/lib/otaDistribution";

// lib/otaRegistry.ts — releases OTA VÉRIFIÉES, chargées UNE FOIS par instance serverless (20/10/2026). Partagé par /api/pull (annonce) et /firmware/<release>/image.bin (téléchargement).
// Aucun accès Redis, aucune clé privée. N'est importé dynamiquement par /api/pull QUE si OTA_DIST_MODE=on (un pull « off » ne lit ni ne vérifie aucun fichier).
// Coût d'un chargement à froid : lecture de ota-releases/** + une vérification RSA de manifeste et de fichier par release (quelques ms) ; en mémoire ensuite.

let cache: { releases: OtaRelease[]; skipped: Array<{ dir: string; errors: string[] }> } | null = null;

export function otaReleases(): OtaRelease[] {
  if (!cache) {
    const keys = trustedKeysFromEnv();
    const r = keys ? loadAllReleases(join(process.cwd(), "ota-releases"), keys) : { releases: [], skipped: [] };
    cache = { releases: r.releases, skipped: r.skipped };
    for (const s of r.skipped) console.warn(`[ota-registry] release ignorée ${s.dir} : ${s.errors.join(" ; ")}`);   // jamais de secret : seulement des motifs
  }
  return cache.releases;
}
/** Tests uniquement. */
export function resetOtaRegistryForTests(): void { cache = null; }
