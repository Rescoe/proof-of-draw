import { isSensorScreens } from "@/lib/measures";
import { ACTIVE_WINDOW_MS } from "@/lib/pullBudget";

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
  const m = /^([a-z0-9]+)-(\d+)\.(\d+)(?:\.\d+)?$/.exec(f);   // ancrée aux deux bouts (VOTE-NETWORK-GATE-FIX1) : « r4tft28-2.5abc » ou « r4tft28-2.5-x » ne passent pas
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

/** Résultat de l'admission d'un VOTE (VOTE-NETWORK-GATE-FIX1). */
export type VoteAdmission = { ok: true } | { ok: false; status: 403 | 404; reason: string; error: string };

/**
 * Un appareil peut-il VOTER ? Appliquée par /api/validation-result AVANT tout calcul. Quand `VOTE_ONLY_NETWORK` est actif :
 *   - un capteur seul ne vote jamais ;
 *   - le firmware déclaré doit savoir voter en v2 (déclaratif : la preuve cryptographique reste la signature v2, vérifiée par la route) ;
 *   - tout vote v1 (écho du score serveur, sans recalcul) est REFUSÉ ;
 *   - l'appareil doit être appairé ET actif au sens CANONIQUE du quorum : `now - lastPing < ACTIVE_WINDOW_MS` (même définition que getGlobalActiveCount, getPoolSnapshot et /api/validate-candidate ;
 *     `lastSeen`, que /api/register rafraîchit seul, ne compte PAS — VOTE-NETWORK-GATE-FIX2).
 * `VOTE_ONLY_NETWORK=false` : comportement historique (tout est admis ici ; les contrôles de la route restent).
 */
export function voteAdmission(
  device: { screens?: readonly string[] | null; firmware?: string | null; artistId?: string | null; artistName?: string | null; lastPing?: number; lastSeen?: number } | null | undefined,
  isV2: boolean,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): VoteAdmission {
  if (!device) return { ok: false, status: 404, reason: "device-unknown", error: "Device inconnu" };
  if (!voteOnlyNetwork(env)) return { ok: true };
  if (device.screens && isSensorScreens(device.screens)) return { ok: false, status: 403, reason: "sensor-cannot-vote", error: "Un capteur ne vote pas" };
  if (!voteV2Capable(device.firmware)) return { ok: false, status: 403, reason: "firmware-not-vote-capable", error: "Firmware sans vote v2 : mise à jour requise" };
  if (!isV2) return { ok: false, status: 403, reason: "v1-vote-refused", error: "Vote v1 (écho du score) refusé : vote v2 requis" };
  if (!(device.artistId || device.artistName)) return { ok: false, status: 403, reason: "device-not-paired", error: "Appareil non appairé" };
  const lastPing = Number(device.lastPing) || 0;
  if (now - lastPing >= ACTIVE_WINDOW_MS) return { ok: false, status: 403, reason: "device-inactive", error: "Appareil inactif" };
  return { ok: true };
}
