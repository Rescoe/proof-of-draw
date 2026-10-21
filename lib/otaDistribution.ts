import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyEd25519 } from "@/lib/ed25519";
import { eligibleForRelease, type OtaManifest, type OtaDeviceState } from "@/lib/otaManifest";
import { OTA_SIG_LEN } from "@/lib/otaTrailer";

// lib/otaDistribution.ts — DISTRIBUTION OTA SERVEUR, PURE et INACTIVE (18/10/2026). Spécification : docs/ADR_DISTRIBUTION_OTA_ESP8266_2026_10_18.md.
// Rien n'est branché : aucune route de /api/pull ne l'appelle, la route /firmware/<release>/image.bin répond 404 tant que OTA_DIST_MODE ≠ « on » ET que OTA_TICKET_SECRET + OTA_TRUSTED_KEYS n'existent pas.
//
// Authentification de l'APPAREIL (le serveur n'authentifie pas /api/pull : un deviceId ne vaut pas secret, une URL difficile à deviner ne vaut pas authentification) :
//   1. l'annonce porte un DÉFI  c = HMAC-SHA256(OTA_TICKET_SECRET, "pod-ota-challenge-v1|deviceId|releaseId|exp")  — sans Redis, valable jusqu'à `exp` (30 min) ;
//   2. l'appareil SIGNE  "pod-ota-fetch-v1|deviceId|releaseId|exp|c"  avec sa clé privée Ed25519 d'identité (celle du vote) ;
//   3. le serveur vérifie le défi (temps constant), l'expiration, puis la signature avec la clé PUBLIQUE enregistrée de l'appareil.
// Quiconque connaît un deviceId peut obtenir un défi ; sans la clé privée de l'appareil il ne peut pas le signer ⇒ pas d'image. L'image est de toute façon signée (RSA) : la confidentialité n'est pas son rôle, la liaison à l'appareil l'est.
// Aucune clé privée de publication ici : le serveur ne reçoit que des clés PUBLIQUES (OTA_TRUSTED_KEYS) pour vérifier les manifestes.

export const OTA_CHALLENGE_DOMAIN = "pod-ota-challenge-v1";
export const OTA_FETCH_DOMAIN = "pod-ota-fetch-v1";
export const OTA_TICKET_MIN_SECRET = 32;
export const OTA_TICKET_TTL_SEC = 1800;
export const OTA_FETCH_LIMIT = 3;            // téléchargements par appareil
export const OTA_FETCH_WINDOW_SEC = 3600;    // et par heure — quota des téléchargements AUTHENTIFIÉS (signature d'appareil valide) : un tiers ne peut pas le consommer
export const OTA_PRELIMIT_PER_WINDOW = 20;    // tentatives NON authentifiées par IP et par fenêtre (freine l'abus de Redis / du CPU sans toucher au quota de l'appareil)
export const OTA_PRELIMIT_WINDOW_SEC = 600;
/** Octets ajoutés à la région signée dans le fichier servi : signature RSA (256) + champ de longueur (4). */
export const OTA_FILE_OVERHEAD = OTA_SIG_LEN + 4;

/** Clé Redis de l'interrupteur d'urgence : `SET ota:kill 1` coupe l'annonce ET le téléchargement. Lue dans le MGET de /api/pull (mode on seulement). */
export const OTA_KILL_KEY = "ota:kill";
/** Séquence OTA installée déclarée par l'appareil dans `?o=` de /api/pull (non authentifiée : elle ne sert qu'à NE PAS annoncer à un appareil déjà à jour). Hors 0..1 000 000 ou illisible : 0. */
export const parseOtaSeqParam = (raw: string | null | undefined): number => (typeof raw === "string" && /^\d{1,7}$/.test(raw) && Number(raw) <= 1_000_000 ? Number(raw) : 0);

export type OtaDistMode = "off" | "on";
export const otaDistModeFromEnv = (env: NodeJS.ProcessEnv = process.env): OtaDistMode => (env.OTA_DIST_MODE === "on" ? "on" : "off");
export const otaTicketSecret = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const s = env.OTA_TICKET_SECRET;
  return typeof s === "string" && s.length >= OTA_TICKET_MIN_SECRET ? s : null;
};

const DEVICE_ID = /^dev_[A-Z0-9]{8}$/;
const RELEASE_ID = /^[A-Za-z0-9._+-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export function otaChallenge(secret: string, deviceId: string, releaseId: string, exp: number): string {
  if (secret.length < OTA_TICKET_MIN_SECRET) throw new Error("secret trop court");
  if (!DEVICE_ID.test(deviceId) || !RELEASE_ID.test(releaseId) || !Number.isInteger(exp) || exp <= 0) throw new Error("paramètres invalides");
  return createHmac("sha256", secret).update(`${OTA_CHALLENGE_DOMAIN}|${deviceId}|${releaseId}|${exp}`).digest("hex");
}
export function verifyOtaChallenge(secret: string, deviceId: string, releaseId: string, exp: number, c: string): boolean {
  try {
    if (!HEX64.test(c)) return false;
    return timingSafeEqual(Buffer.from(otaChallenge(secret, deviceId, releaseId, exp), "hex"), Buffer.from(c, "hex"));
  } catch { return false; }
}
/** Le message que l'appareil signe (UTF-8). */
export const otaFetchMessage = (deviceId: string, releaseId: string, exp: number, challenge: string): string => `${OTA_FETCH_DOMAIN}|${deviceId}|${releaseId}|${exp}|${challenge}`;

// ── annonce (ajoutée à la réponse de /api/pull SEULEMENT pour un appareil éligible ; ≤ 260 octets de JSON) ─────────────────────────────────────
// `u` (chemin) n'est PLUS annoncé (20/10/2026) : il est dérivé de `r` des deux côtés (otaImagePath) — l'appareil ne suit jamais une URL fournie par le serveur de pull.
export interface OtaAnnouncement { r: string; s: number; m: number; v: string; z: number; k: 0 | 1; e: number; c: string }
export const OTA_ANNOUNCE_MAX_JSON = 200;
/** Chemin de l'image d'une release : forme unique, calculée (jamais lue dans l'annonce). */
export const otaImagePath = (releaseId: string): string => `/firmware/${releaseId}/image.bin`;

/**
 * Seuls les firmwares qui LISENT `ota` (et dont le JSON de pull est dimensionné pour) reçoivent l'annonce : un firmware plus ancien obtient exactement la même réponse qu'avant
 * (son DynamicJsonDocument est dimensionné au plus juste ; ≈ 330 o de plus pourraient faire échouer son pull). À monter avec chaque famille dont le client est livré.
 */
export const OTA_CLIENT_FIRMWARE: Readonly<Record<string, readonly [number, number]>> = { tft18: [2, 7] };
export function otaClientCapable(firmware: string | null | undefined): boolean {
  const m = /^([a-z0-9]+)-(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(firmware ?? "").trim().toLowerCase());
  if (!m || !Object.prototype.hasOwnProperty.call(OTA_CLIENT_FIRMWARE, m[1])) return false;
  const [maj, min] = OTA_CLIENT_FIRMWARE[m[1]], a = Number(m[2]), b = Number(m[3]);
  return a > maj || (a === maj && b >= min);
}

export interface OtaDeviceView { deviceId: string; firmware: string; otaSeq?: number; publicKey?: string }
/** Famille d'un appareil = préfixe de son firmware déclaré (« tft18-2.5 » → « tft18 »). */
/** Familles OTA connues (famille de la release ← préfixe du firmware déclaré). Un firmware absent de cette table n'est JAMAIS éligible. */
export const OTA_FAMILIES: Readonly<Record<string, string>> = { tft18: "esp8266-tft18" };
export const familyOfFirmware = (fw: string): string => { const p = /^([a-z0-9]+)-\d+\.\d+/.exec(String(fw).trim().toLowerCase())?.[1] ?? ""; return Object.prototype.hasOwnProperty.call(OTA_FAMILIES, p) ? OTA_FAMILIES[p] : ""; };

/** État vu par le serveur : le canal d'un appareil n'est pas déclaré aujourd'hui, c'est l'appartenance (canaryDevices / vague) qui décide ; une séquence installée inconnue vaut 0 (l'appareil refuse lui-même un « pas plus récent »). */
export function deviceStateFor(m: OtaManifest, d: OtaDeviceView): OtaDeviceState {
  return { deviceId: d.deviceId, family: familyOfFirmware(d.firmware), firmware: d.firmware, otaSeq: d.otaSeq ?? 0, channel: m.channel };
}

/** Parmi les manifestes ACTIFS et déjà vérifiés, le plus récent (otaSeq) dont cet appareil est éligible ; null sinon. */
export function pickRelease(manifests: readonly OtaManifest[], d: OtaDeviceView, now: number): OtaManifest | null {
  let best: OtaManifest | null = null;
  for (const m of manifests) {
    if (d.firmware === m.firmwareVersion) continue;                               // déjà à cette version
    if (!eligibleForRelease(m, deviceStateFor(m, d), now).eligible) continue;
    if (!best || m.otaSeq > best.otaSeq) best = m;
  }
  return best;
}

export interface AnnounceInput { mode: OtaDistMode; secret: string | null; killed: boolean; manifests: readonly OtaManifest[]; device: OtaDeviceView; now: number }
/** null = aucune annonce (route inactive, kill-switch, aucune release éligible). Aucune commande Redis : `killed` vient du MGET que /api/pull fait déjà. */
export function otaAnnouncement(i: AnnounceInput): OtaAnnouncement | null {
  if (i.mode !== "on" || !i.secret || i.killed) return null;
  if (!otaClientCapable(i.device.firmware) || !i.device.publicKey || !HEX64.test(i.device.publicKey)) return null;   // pas de client lisant `ota`, ou pas de clé d'appareil : rien à annoncer
  const m = pickRelease(i.manifests, i.device, i.now);
  if (!m) return null;
  const exp = Math.floor(i.now / 1000) + OTA_TICKET_TTL_SEC;
  const a: OtaAnnouncement = { r: m.releaseId, s: m.otaSeq, m: m.minOtaSeq, v: m.firmwareVersion, z: m.size, k: m.signature.keyId === "ota-a" ? 0 : 1, e: exp, c: otaChallenge(i.secret, i.device.deviceId, m.releaseId, exp) };
  if (JSON.stringify(a).length > OTA_ANNOUNCE_MAX_JSON) throw new Error("annonce OTA trop grosse pour le JSON léger de /api/pull");
  return a;
}

// ── route de téléchargement ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type FetchQuery = { ok: true; deviceId: string; exp: number; challenge: string; sig: string } | { ok: false; error: string };
/** Requête STRICTE : exactement ?d=…&e=…&c=…&g=…, dans cet ordre (aucun paramètre en plus : pas de contournement de cache ni de journalisation). */
export function parseFetchQuery(rawSearch: string): FetchQuery {
  if (typeof rawSearch !== "string" || rawSearch.length === 0 || rawSearch.length > 300) return { ok: false, error: "requête invalide" };
  const m = /^\?d=(dev_[A-Z0-9]{8})&e=(\d{1,12})&c=([0-9a-f]{64})&g=([0-9a-f]{128})$/.exec(rawSearch);
  if (!m) return { ok: false, error: "paramètres : exactement d, e, c, g, dans cet ordre" };
  return { ok: true, deviceId: m[1], exp: Number(m[2]), challenge: m[3], sig: m[4] };
}

export interface OtaRelease { manifest: OtaManifest; file: Buffer }
export interface FetchDeps {
  mode: OtaDistMode;
  secret: string | null;
  trustedKeysPresent: boolean;
  now: number;
  releaseId: string;
  fileName: string;
  rawSearch: string;
  /** Release vérifiée (signature du manifeste, région ↔ manifeste) ou null. Aucun Redis. */
  loadRelease: (releaseId: string) => OtaRelease | null;
  /** Interrupteur d'urgence (Redis) : true = tout est coupé. */
  isKilled: () => Promise<boolean>;
  /** Limite des tentatives NON authentifiées, par IP du demandeur (jamais par appareil : un tiers ne doit pas pouvoir verrouiller un appareil). true = sous la limite. */
  preLimitOk: () => Promise<boolean>;
  /** Quota des téléchargements de l'appareil — consommé SEULEMENT après une signature d'appareil valide et une éligibilité. true = sous la limite. */
  rateLimitOk: (deviceId: string) => Promise<boolean>;
  loadDevice: (deviceId: string) => Promise<{ publicKey?: string; firmware: string; otaSeq?: number } | null>;
  log?: (line: string) => void;
}
const fail = (message: string, status: number, extra: Record<string, string> = {}) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...extra } });

/**
 * Ordre des contrôles — AUCUN n'accède à Redis avant l'étape 6 :
 *  1. inactive (mode ≠ on, OTA_TICKET_SECRET ou OTA_TRUSTED_KEYS absents)         → 404 ;   2. nom de fichier ≠ image.bin ou release mal formée → 404 ;
 *  3. requête stricte                                                              → 400 ;   4. défi HMAC (temps constant)                       → 403 ;   5. non expiré → 410 ; release inconnue → 404 ;
 *  6. Redis : interrupteur d'urgence → 503 · limite des tentatives non authentifiées PAR IP → 429 · appareil connu AVEC clé publique → 403 ;
 *  7. signature Ed25519 de l'appareil sur le message → 403 ;   8. éligibilité (famille, canal, canari, vague, date) → 403 ;
 *  9. QUOTA de l'appareil (3 / h) → 429 : consommé seulement ici, donc seulement par une requête AUTHENTIFIÉE et éligible ;
 * 10. 200 : octets exacts du fichier signé, Cache-Control private/no-store (jamais mis en cache partagé).
 * Pourquoi : avant le 21/10/2026 le quota par appareil était compté AVANT la signature ; un tiers qui obtenait un défi (le pull n'est pas authentifié) pouvait envoyer 3 signatures invalides et faire refuser (429) l'appareil légitime.
 * Coût Redis : requête refusée à la signature = 4 commandes (interrupteur 1, limite par IP 2, appareil 1) — comme avant ; téléchargement réussi = 6 (+ quota 2), une fois par version.
 */
export async function otaImageResponse(d: FetchDeps): Promise<NextResponse> {
  const log = d.log ?? ((l: string) => console.log(l));
  if (d.mode !== "on" || !d.secret || !d.trustedKeysPresent) return fail("route inactive", 404);
  if (d.fileName !== "image.bin" || !RELEASE_ID.test(d.releaseId)) return fail("introuvable", 404);
  const q = parseFetchQuery(d.rawSearch);
  if (!q.ok) return fail(q.error, 400);
  if (!verifyOtaChallenge(d.secret, q.deviceId, d.releaseId, q.exp, q.challenge)) return fail("défi invalide", 403);
  if (q.exp * 1000 <= d.now) return fail("défi expiré", 410);
  const rel = d.loadRelease(d.releaseId);
  if (!rel) return fail("release inconnue", 404);

  if (await d.isKilled()) { log(`[ota-image] KILL device=${q.deviceId}`); return fail("distribution suspendue", 503, { "Retry-After": "3600" }); }
  if (!(await d.preLimitOk())) return fail("trop de tentatives", 429, { "Retry-After": String(OTA_PRELIMIT_WINDOW_SEC) });
  const dev = await d.loadDevice(q.deviceId);
  if (!dev || !dev.publicKey || !HEX64.test(dev.publicKey)) return fail("appareil inconnu ou sans clé", 403);
  if (!HEX128.test(q.sig) || !verifyEd25519(dev.publicKey, otaFetchMessage(q.deviceId, d.releaseId, q.exp, q.challenge), q.sig)) { log(`[ota-image] SIGNATURE REFUSEE device=${q.deviceId}`); return fail("signature d'appareil invalide", 403); }
  if (!pickRelease([rel.manifest], { deviceId: q.deviceId, firmware: dev.firmware, otaSeq: dev.otaSeq }, d.now)) return fail("appareil non éligible", 403);
  if (!(await d.rateLimitOk(q.deviceId))) return fail("trop de téléchargements", 429, { "Retry-After": String(OTA_FETCH_WINDOW_SEC) });

  log(`[ota-image] OK device=${q.deviceId} release=${d.releaseId} seq=${rel.manifest.otaSeq}`);
  return new NextResponse(new Uint8Array(rel.file), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream", "Content-Length": String(rel.file.length),
      "Cache-Control": "private, no-store", "X-Ota-Seq": String(rel.manifest.otaSeq), "X-Ota-Region-Sha256": rel.manifest.sha256,
    },
  });
}
