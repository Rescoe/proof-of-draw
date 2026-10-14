import { isSensorScreens } from "@/lib/measures";

// lib/voteCapability.ts — « RÉSEAU DE VOTE RÉEL » (14/10/2026) : quels appareils savent voter en v2 ? (pur, sans Redis, testé)
//
// Principe : un appareil dont le firmware déclaré (champ `firmware` de /api/register) NE SAIT PAS faire le vote v2 (recalcul du hash et des métriques, signature Ed25519) :
//   - n'est plus compté dans le quorum (getGlobalActiveCount / getPoolSnapshot) ;
//   - ne reçoit plus rien de /api/pull (ni image, ni bloc, ni candidat) ;
//   - ne vote plus (/api/validation-result et /api/validate-candidate le refusent : 403).
// Les capteurs seuls (screens = ["sensor"]) sont HORS de ce mécanisme : ils n'ont jamais voté.
// Source de vérité = la version envoyée par l'appareil lui-même ; liste = les firmwares du dépôt qui contiennent `doValidateV2` (vote v2). Une version PLUS ANCIENNE ou inconnue est exclue.
// Interrupteur d'urgence : VOTE_ONLY_NETWORK=false dans les variables Vercel (puis redéploiement) rétablit le comportement d'avant pour tous.

/** Préfixe de firmware → version minimale (majeure, mineure) qui sait voter en v2. */
export const VOTE_V2_FIRMWARE: Record<string, [number, number]> = {
  r4tft28: [2, 5],          // UNO R4 + TFT 2,8″
  r4eink29: [1, 1],         // UNO R4 + e-ink 2,9″ BWR
  r4eink27: [1, 1],         // UNO R4 + e-ink 2,7″
  r4multiscreen: [1, 1],    // UNO R4 + e-ink 2,7″ + OLED
  r4tft18: [1, 1],          // UNO R4 + TFT 1,8″
  multiscreen: [2, 5],      // ESP8266 + e-ink 2,7″ + OLED
  eink27bw: [2, 1],         // ESP8266 + e-ink 2,7″
  eink29bwr: [2, 3],        // ESP8266 + e-ink 2,9″ BWR (le 14/10/2026 : « 2.2 » nu devient « eink29bwr-2.3 », reconnaissable)
  tft18: [2, 4],            // ESP8266 + TFT 1,8″
};

/** Ce firmware (chaîne déclarée par l'appareil) sait-il voter en v2 ? */
export function voteV2Capable(firmware: string | null | undefined): boolean {
  const f = String(firmware ?? "").trim().toLowerCase();
  const m = /^([a-z0-9]+)-(\d+)\.(\d+)/.exec(f);
  if (!m) return false;
  const min = VOTE_V2_FIRMWARE[m[1]];
  if (!min) return false;
  const major = Number(m[2]), minor = Number(m[3]);
  return major > min[0] || (major === min[0] && minor >= min[1]);
}

/** Réseau « vote réel seulement » : actif PAR DÉFAUT ; `VOTE_ONLY_NETWORK=false` (ou 0 / off / non) le désactive. */
export function voteOnlyNetwork(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.VOTE_ONLY_NETWORK ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off" || v === "non" || v === "no");
}

/** Cet appareil participe-t-il au réseau de vote ? Capteur seul : hors mécanisme (jamais exclu ici, jamais compté ailleurs). Sinon : réseau ouvert, ou firmware capable. */
export function participatesInVoteNetwork(device: { screens?: readonly string[] | null; firmware?: string | null } | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!device) return false;
  if (device.screens && isSensorScreens(device.screens)) return true;   // capteur seul : hors mécanisme
  if (!voteOnlyNetwork(env)) return true;
  return voteV2Capable(device.firmware);
}
