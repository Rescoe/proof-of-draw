import { isSensorScreens } from "@/lib/measures";
import { ACTIVE_WINDOW_MS } from "@/lib/pullBudget";

// lib/voteCapability.ts — « RÉSEAU DE VOTE RÉEL » (14/10/2026) : quels appareils savent voter en v2 ? (pur, sans Redis, testé)
//
// Principe : un appareil dont le firmware déclaré (champ `firmware` de /api/register) NE SAIT PAS faire le vote v2 (recalcul du hash et des métriques, signature Ed25519) :
//   - n'est plus compté dans le quorum (getGlobalActiveCount / getPoolSnapshot) ;
//   - continue de RECEVOIR les images et les blocs de /api/pull (réception maintenue, décision du 14/10/2026 soir), mais n'est jamais invité à valider un candidat ;
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

// ── Capacités de vote DÉCLARÉES (28/10/2026, lot 5 du plan docs/PLAN_RESEAU_VALIDATEURS_ET_STATION_R4_2026_10_28.md) ───────────────────────────────────────────────
// Affichage (`screens`), mesure (`sensors`), vote (`caps`) et mise à jour à distance sont QUATRE capacités indépendantes. `caps` est une liste FERMÉE et bornée envoyée à /api/register ;
// une déclaration seule ne compte JAMAIS dans le quorum : le serveur exige aussi que la famille et la version du firmware soient autorisées, et le vote reste vérifié cryptographiquement.
export const VOTE_CAPS = ["vote-static-v2", "vote-anim-v3"] as const;
export type VoteCap = (typeof VOTE_CAPS)[number];

/** Lecture stricte de `caps` : tableau de 1 à 4 chaînes DISTINCTES de la liste fermée ; toute autre forme => undefined (aucune capacité déclarée). Jamais de texte libre persisté. */
export function parseVoteCaps(raw: unknown): VoteCap[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return undefined;
  const out: VoteCap[] = [];
  for (const c of raw) {
    if (typeof c !== "string" || !(VOTE_CAPS as readonly string[]).includes(c)) return undefined;
    if (!out.includes(c as VoteCap)) out.push(c as VoteCap);
  }
  return out;
}

/** Familles de validateurs SANS écran (UNO R4 / ESP + capteurs, aucun écran) : préfixe de firmware -> version minimale. VIDE aujourd'hui — aucun firmware de ce type n'existe ; le jour où il existe, ajouter sa famille ICI et dans la matrice. */
export const VALIDATOR_NODE_FIRMWARE: Record<string, [number, number]> = {};
/** Familles dont le firmware embarque réellement le vote d'animation v3 (calcul de chaque image). VIDE aujourd'hui : l'animation v3 n'est activée sur aucune carte (lot 6, mode `shadow`). */
export const VOTE_ANIM_V3_FIRMWARE: Record<string, [number, number]> = {};

function firmwareAtLeast(firmware: string | null | undefined, table: Record<string, [number, number]>): boolean {
  const f = String(firmware ?? "").trim().toLowerCase();
  const m = /^([a-z0-9]+)-(\d+)\.(\d+)(?:\.\d+)?$/.exec(f);
  if (!m) return false;
  const min = table[m[1]];
  if (!min) return false;
  const major = Number(m[2]), minor = Number(m[3]);
  return major > min[0] || (major === min[0] && minor >= min[1]);
}

/** Validateur SANS écran : profil capteur seul qui déclare `vote-static-v2` ET dont la famille/version est autorisée. Reçoit des candidats, jamais de frame d'affichage, n'entre dans aucune pool d'écran. */
export function isValidatorNode(device: { screens?: readonly string[] | null; firmware?: string | null; caps?: readonly string[] | null } | null | undefined): boolean {
  if (!device || !device.screens || !isSensorScreens(device.screens)) return false;
  return !!device.caps?.includes("vote-static-v2") && firmwareAtLeast(device.firmware, VALIDATOR_NODE_FIRMWARE);
}

/** Le firmware de cet appareil sait-il voter une animation v3 ? (table vide aujourd'hui => toujours faux) */
export function votesAnimV3(device: { firmware?: string | null; caps?: readonly string[] | null } | null | undefined): boolean {
  return !!device && !!device.caps?.includes("vote-anim-v3") && firmwareAtLeast(device.firmware, VOTE_ANIM_V3_FIRMWARE);
}

/** Ce firmware (chaîne déclarée par l'appareil) sait-il voter en v2 ? */
export function voteV2Capable(firmware: string | null | undefined): boolean {
  const f = String(firmware ?? "").trim().toLowerCase();
  const m = /^([a-z0-9]+)-(\d+)\.(\d+)(?:\.\d+)?$/.exec(f);   // ancrée aux deux bouts (VOTE-NETWORK-GATE-FIX1) : « r4tft28-2.5abc » ou « r4tft28-2.5-x » ne passent pas
  if (!m) return false;
  const min = VOTE_V2_FIRMWARE[m[1]] ?? VALIDATOR_NODE_FIRMWARE[m[1]];   // 28/10/2026 : + familles de validateurs SANS écran (table vide aujourd'hui : aucun firmware)
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

/**
 * Vote v1 (écho signé du score serveur) admis pour une ANIMATION : actif PAR DÉFAUT (28/10/2026) ; `ANIM_V1_VOTE=false` (ou 0 / off / non) le désactive.
 * Pourquoi : une animation n'a pas de spécification v2 (`v2: null`, app/api/submit-candidate : le clip PBC1 n'est pas rejoué par les appareils avant le lot 8), donc son seul vote possible est v1 — que
 * `voteAdmission` refusait pour TOUT candidat depuis le 14/10/2026 (403 v1-vote-refused) : aucune animation n'atteignait le quorum. Cette exception ne vaut QUE pour un candidat de nature « animation » ; les
 * dessins restent en vote v2 obligatoire. Elle admet l'identité (firmware capable, appairé, actif, signature Ed25519 stricte), PAS une revérification du contenu du clip.
 */
export function animationV1VoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.ANIM_V1_VOTE ?? "").trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off" || v === "non" || v === "no");
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
  device: { screens?: readonly string[] | null; firmware?: string | null; caps?: readonly string[] | null; artistId?: string | null; artistName?: string | null; lastPing?: number; lastSeen?: number } | null | undefined,
  isV2: boolean,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
  opts: { animationCandidate?: boolean } = {},
): VoteAdmission {
  if (!device) return { ok: false, status: 404, reason: "device-unknown", error: "Device inconnu" };
  if (!voteOnlyNetwork(env)) return { ok: true };
  if (device.screens && isSensorScreens(device.screens) && !isValidatorNode(device as never)) return { ok: false, status: 403, reason: "sensor-cannot-vote", error: "Un capteur ne vote pas" };
  if (!voteV2Capable(device.firmware)) return { ok: false, status: 403, reason: "firmware-not-vote-capable", error: "Firmware sans vote v2 : mise à jour requise" };
  if (!isV2 && !(opts.animationCandidate && animationV1VoteEnabled(env))) return { ok: false, status: 403, reason: "v1-vote-refused", error: "Vote v1 (écho du score) refusé : vote v2 requis" };
  if (!(device.artistId || device.artistName)) return { ok: false, status: 403, reason: "device-not-paired", error: "Appareil non appairé" };
  const lastPing = Number(device.lastPing) || 0;
  if (now - lastPing >= ACTIVE_WINDOW_MS) return { ok: false, status: 403, reason: "device-inactive", error: "Appareil inactif" };
  return { ok: true };
}
