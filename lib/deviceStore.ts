// lib/deviceStore.ts
// Persistance via Upstash Redis (Vercel KV)
// TTL 48h natif Redis — pas de setInterval, pas de cleanup serveur
// Toutes les fonctions sont async

import { redis } from "@/lib/redis";
import { decrementDeviceCount, incrementDeviceCount } from "@/lib/rateLimit";

export interface Device {
  deviceId:   string;
  mac:        string;   // sensible — jamais exposé publiquement
  screens:    string[];
  firmware:   string;
  artistName?: string;              // rétrocompat — remplacé par ArtistProfile.displayName
  deviceName?: string;             // nom humain de l'appareil (distinct du nom d'artiste)
  artistId?:  string;              // lien vers ArtistProfile
  pairCode:   string;   // sensible — jamais exposé publiquement
  lastSeen:   number;
  lastPing:   number;
  framesSent: number;
  createdAt:  number;

  // ── Axe 2 : ESP en prêt public ──────────────────────────────────────────────
  publicMode?: boolean;             // toggle manuel : l'ESP est disponible pour d'autres artistes
  lastFrameReceivedAt?: number;     // mis à jour sur /api/ack-frame
  publicKey?: string;               // clé publique ED25519 hex 64 chars (firmware v2+)
}

// ─── ArtistProfile ────────────────────────────────────────────────────────────

export interface ArtistProfile {
  artistId:    string;
  displayName: string;
  /** Identifiant URL unique : /artists/{slug} — normalisé depuis displayName ou saisi manuellement */
  slug?:       string;
  bio?:        string;
  profileImageBlockHash?: string;
  profileImageCrop?: { cx: number; cy: number; zoom: number };
  createdAt:   number;
  updatedAt:   number;
}

/**
 * Normalise une chaîne en slug URL-safe :
 * minuscules, sans accents, espaces → tirets, caractères non-alphanum supprimés,
 * 3–30 caractères.
 */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // supprime les accents
    .replace(/[^a-z0-9]+/g, "-")                          // non-alphanum → tiret
    .replace(/^-+|-+$/g, "")                              // trim tirets
    .slice(0, 30);
}

export interface PublicDevice {
  artistName: string;
  screens:    string[];
  isOnline:   boolean;
  lastSeen:   number;
}

export interface OwnedDevice {
  deviceId:   string;
  artistName?: string;
  deviceName?: string;
  artistId?:  string;
  screens:    string[];
  firmware:   string;
  framesSent: number;
  lastPing:   number;
  lastSeen:   number;
  createdAt:  number;
  isOnline:   boolean;
  hasPairCode: boolean;
  publicMode?: boolean;
  lastFrameReceivedAt?: number;
}

const TTL_SECONDS = 48 * 60 * 60;
const ONLINE_MS   = 10 * 60 * 1000;

function deviceKey(deviceId: string)    { return `device:${deviceId}`; }
function macKey(mac: string)            { return `mac:${mac}`; }
function pairKey(code: string)          { return `pair:${code.toUpperCase()}`; }
function artistKey(artistId: string)    { return `artist:${artistId}`; }
function artistDevKey(deviceId: string) { return `artist:device:${deviceId}`; }
function slugKey(slug: string)          { return `artist:slug:${slug}`; }
function linkCodeKey(code: string)      { return `artist:link:${code.toUpperCase()}`; }

function isOnline(d: Device): boolean {
  return Date.now() - d.lastPing < ONLINE_MS;
}

function generateDeviceId(): string {
  return "dev_" + Math.random().toString(36).slice(2, 10).toUpperCase();
}

function generatePairCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part(4)}${part(4)}`;
}

export function toPublicDevice(d: Device): PublicDevice {
  return {
    artistName: d.artistName ?? "Artiste inconnu",
    screens:    d.screens,
    isOnline:   isOnline(d),
    lastSeen:   d.lastSeen,
  };
}

export function toOwnedDevice(d: Device): OwnedDevice {
  return {
    deviceId:           d.deviceId,
    artistName:         d.artistName,
    deviceName:         d.deviceName,
    artistId:           d.artistId,
    screens:            d.screens,
    firmware:           d.firmware,
    framesSent:         d.framesSent,
    lastPing:           d.lastPing,
    lastSeen:           d.lastSeen,
    createdAt:          d.createdAt,
    isOnline:           isOnline(d),
    hasPairCode:        !!d.pairCode,
    publicMode:         d.publicMode ?? false,
    lastFrameReceivedAt: d.lastFrameReceivedAt,
  };
}

// ─── Lecture / écriture ───────────────────────────────────────────────────────

async function saveDevice(device: Device): Promise<void> {
  // 3 clés : device:id, mac:xxx, pair:CODE — toutes avec TTL 48h
  await Promise.all([
    redis.set(deviceKey(device.deviceId), JSON.stringify(device), { ex: TTL_SECONDS }),
    redis.set(macKey(device.mac), device.deviceId, { ex: TTL_SECONDS }),
    redis.set(pairKey(device.pairCode), device.deviceId, { ex: TTL_SECONDS }),
  ]);
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  const raw = await redis.get<string>(deviceKey(deviceId));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw as Device; } catch { return null; }
}

export async function getDeviceByMac(mac: string): Promise<Device | null> {
  const deviceId = await redis.get<string>(macKey(mac));
  if (!deviceId) return null;
  return getDevice(deviceId);
}

export async function getDeviceByPairCode(code: string): Promise<Device | null> {
  const deviceId = await redis.get<string>(pairKey(code.toUpperCase()));
  if (!deviceId) return null;
  return getDevice(deviceId);
}

export async function registerDevice(
  mac: string,
  screens: string[],
  firmware: string
): Promise<{ device: Device; isNew: boolean }> {
  const existing = await getDeviceByMac(mac);

  if (existing) {
    existing.firmware = firmware;
    existing.screens  = screens;
    existing.lastSeen = Date.now();
    await saveDevice(existing);
    // S'assurer que l'index global contient bien ce device (idempotent)
    await redis.sadd("devices:all", existing.deviceId);
    return { device: existing, isNew: false };
  }

  const device: Device = {
    deviceId:   generateDeviceId(),
    mac,
    screens,
    firmware,
    pairCode:   generatePairCode(),
    lastSeen:   Date.now(),
    lastPing:   Date.now(),
    framesSent: 0,
    createdAt:  Date.now(),
  };

  await saveDevice(device);
  await redis.sadd("devices:all", device.deviceId);
  await incrementDeviceCount();
  console.log(`[deviceStore] NEW ${device.deviceId} (mac: ${mac})`);
  return { device, isNew: true };
}

export async function pingDevice(deviceId: string): Promise<Device | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;
  device.lastSeen = Date.now();
  device.lastPing = Date.now();
  await saveDevice(device);
  return device;
}

export async function setArtistName(deviceId: string, artistName: string): Promise<Device | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;
  device.artistName = artistName;
  await saveDevice(device);
  return device;
}

export async function rotatePairCode(deviceId: string): Promise<string | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;
  // Supprime l'ancienne clé pair
  await redis.del(pairKey(device.pairCode));
  device.pairCode = generatePairCode();
  await saveDevice(device);
  return device.pairCode;
}

export async function incrementFramesSent(deviceId: string): Promise<void> {
  const device = await getDevice(deviceId);
  if (!device) return;
  device.framesSent += 1;
  // Pas de saveDevice complet ici — on fait un simple incr pour éviter 3 writes
  // On met juste à jour le champ dans le device stocké
  await redis.set(deviceKey(deviceId), JSON.stringify({ ...device }), { ex: TTL_SECONDS });
}

export async function getAllDevices(): Promise<Device[]> {
  let cursor = 0;
  const keys: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, { match: "device:*", count: 100 });
    cursor = Number(next);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);

  if (keys.length === 0) return [];
  const values = await redis.mget<(string | null)[]>(...keys);
  return values
    .filter((v): v is string => !!v)
    .map((v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } })
    .filter((v): v is Device => v !== null);
}

export async function deleteDevice(deviceId: string): Promise<void> {
  const device = await getDevice(deviceId);
  if (!device) return;
  await Promise.all([
    redis.del(deviceKey(deviceId)),
    redis.del(macKey(device.mac)),
    redis.del(pairKey(device.pairCode)),
    redis.srem("devices:all", deviceId),
  ]);
  await decrementDeviceCount();
}

/**
 * Compte les devices actifs sur l'ensemble du réseau (tous écrans confondus).
 * Un device est "actif" si son lastPing est récent (< ACTIVE_WINDOW_MS).
 * Utilisé pour le quorum global de validation Proof-of-Draw.
 */
export async function getGlobalActiveCount(activeWindowMs = 30 * 60 * 1000): Promise<number> {
  const allIds = (await redis.smembers("devices:all")) as string[];
  if (!allIds || allIds.length === 0) return 1; // minimum 1 pour éviter division par zéro

  const now = Date.now();
  const values = await redis.mget<(string | null)[]>(...allIds.map(deviceKey));

  // Nettoyer les IDs expirés en fire-and-forget
  const expired = allIds.filter((_, i) => !values[i]);
  if (expired.length > 0) {
    Promise.all(expired.map((id) => redis.srem("devices:all", id))).catch(() => {});
  }

  const devices = values.map((raw) => {
    if (!raw) return null;
    try {
      const d = typeof raw === "string" ? JSON.parse(raw) : raw;
      // N'inclure que les devices APPAIRÉS (artistId ou artistName défini)
      // et actifs (lastPing récent).
      // Les devices en onboarding (non appairés) ne participent pas au quorum :
      // ils pourraient déclencher un poolSize > 1 pendant l'appairage et bloquer
      // indéfiniment le minage.
      const isPaired  = !!(d.artistId || d.artistName);
      const isActive  = now - d.lastPing < activeWindowMs;
      return (isPaired && isActive) ? d : null;
    } catch {
      return null;
    }
  });

  const count = devices.filter(Boolean).length;
  // Minimum 1 : si aucun device appairé actif, on autorise 1 vote pour éviter
  // un blocage total (e.g. tous les devices hors ligne momentanément)
  return Math.max(1, count);
}

// ─── Axe 2 : ESP en prêt public ──────────────────────────────────────────────

/**
 * Active ou désactive le mode prêt public (toggle manuel).
 */
export async function setPublicMode(deviceId: string, enabled: boolean): Promise<Device | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;
  device.publicMode = enabled;
  await saveDevice(device);
  return device;
}

/**
 * Retourne tous les devices en mode public et online.
 * Un device est "disponible" si publicMode=true.
 */
export async function getPublicDevices(): Promise<Device[]> {
  const all = await getAllDevices();
  return all.filter((d) => d.publicMode === true);
}

/**
 * Met à jour lastFrameReceivedAt lors d'un ack-frame.
 * Désactive publicMode si l'artiste a repris son ESP (il reçoit à nouveau des frames).
 */
export async function ackFrameReceived(deviceId: string): Promise<void> {
  const device = await getDevice(deviceId);
  if (!device) return;
  device.lastFrameReceivedAt = Date.now();
  await saveDevice(device);
}

// ─── Profils artistes ─────────────────────────────────────────────────────────

const ARTIST_TTL = 90 * 24 * 3600; // 90 jours

export async function getArtist(artistId: string): Promise<ArtistProfile | null> {
  const raw = await redis.get(artistKey(artistId));
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw as ArtistProfile; } catch { return null; }
}

/**
 * Cherche le profil artiste associé à un device.
 * Utilise la clé inverse `artist:device:{deviceId}` pour éviter un scan.
 */
export async function getArtistByDevice(deviceId: string): Promise<ArtistProfile | null> {
  const rawId = await redis.get(artistDevKey(deviceId));
  if (!rawId) return null;
  const artistId = typeof rawId === "string" ? rawId : String(rawId);
  return getArtist(artistId);
}

/**
 * Cherche un profil artiste par son slug URL.
 * Retourne null si slug inconnu.
 */
export async function getArtistBySlug(slug: string): Promise<ArtistProfile | null> {
  const artistId = await redis.get<string>(slugKey(slug));
  if (!artistId) return null;
  return getArtist(typeof artistId === "string" ? artistId : String(artistId));
}

/**
 * Vérifie si un slug est disponible.
 * Retourne true si libre ou si le slug appartient déjà à currentArtistId.
 */
export async function isSlugAvailable(slug: string, currentArtistId?: string): Promise<boolean> {
  const existing = await redis.get<string>(slugKey(slug));
  if (!existing) return true;
  const id = typeof existing === "string" ? existing : String(existing);
  return id === currentArtistId;
}

/**
 * Retourne tous les deviceIds liés à un artistId (via scan des devices).
 * Utilisé lors de la fusion de sessions cross-device.
 */
export async function getDeviceIdsByArtist(artistId: string): Promise<string[]> {
  // On scanne les clés artist:device:* — plus rapide qu'un getAllDevices()
  let cursor = 0;
  const ids: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, { match: "artist:device:*", count: 100 });
    cursor = Number(next);
    for (const key of batch as string[]) {
      const val = await redis.get<string>(key);
      const aid = val ? (typeof val === "string" ? val : String(val)) : null;
      if (aid === artistId) {
        // Extrait le deviceId depuis la clé "artist:device:{deviceId}"
        ids.push((key as string).replace("artist:device:", ""));
      }
    }
  } while (cursor !== 0);
  return ids;
}

/**
 * Crée ou met à jour un profil artiste.
 * Si slug fourni : valide unicité + gère l'index artist:slug:{slug}.
 * Si pas de slug sur un nouveau profil : auto-génère depuis displayName.
 */
export async function createOrUpdateArtist(
  displayName: string,
  bio?: string,
  existingArtistId?: string,
  profileImageBlockHash?: string,
  profileImageCrop?: { cx: number; cy: number; zoom: number },
  slug?: string,
): Promise<ArtistProfile> {
  const artistId = existingArtistId ?? crypto.randomUUID();
  const existing = existingArtistId ? await getArtist(existingArtistId) : null;

  // Résolution du slug :
  // 1. Si fourni explicitement → valider + utiliser
  // 2. Si profil existant avait déjà un slug → conserver
  // 3. Nouveau profil sans slug → auto-générer depuis displayName
  let resolvedSlug = slug ?? existing?.slug;
  if (!resolvedSlug) {
    resolvedSlug = normalizeSlug(displayName);
    // En cas de collision sur un nouveau profil, ajouter un suffixe numérique
    if (resolvedSlug.length < 3) resolvedSlug = `artist-${artistId.slice(0, 6)}`;
    let candidate = resolvedSlug;
    let suffix = 2;
    while (!(await isSlugAvailable(candidate, artistId))) {
      candidate = `${resolvedSlug}-${suffix++}`;
    }
    resolvedSlug = candidate;
  }

  const profile: ArtistProfile = {
    artistId,
    displayName: displayName.trim().slice(0, 60),
    slug:        resolvedSlug,
    bio:         bio?.trim().slice(0, 300),
    profileImageBlockHash: profileImageBlockHash ?? existing?.profileImageBlockHash,
    profileImageCrop:      profileImageCrop ?? existing?.profileImageCrop,
    createdAt:   existing?.createdAt ?? Date.now(),
    updatedAt:   Date.now(),
  };

  // Si le slug a changé, supprimer l'ancien index
  if (existing?.slug && existing.slug !== resolvedSlug) {
    await redis.del(slugKey(existing.slug));
  }

  await Promise.all([
    redis.set(artistKey(artistId), JSON.stringify(profile), { ex: ARTIST_TTL }),
    redis.set(slugKey(resolvedSlug), artistId, { ex: ARTIST_TTL }),
    redis.sadd("artists:all", artistId),
  ]);
  return profile;
}

/**
 * Supprime complètement un profil artiste de la base.
 * - Retire le profil, le slug, la membership dans artists:all.
 * - Déliaison de tous les devices (supprime artist:device:{id}, efface device.artistId).
 * - Les blocs de la blockchain restent intacts (attributions au moment du minage).
 */
export async function deleteArtist(artistId: string): Promise<void> {
  const profile = await getArtist(artistId);
  if (!profile) return;

  // Trouver tous les devices liés à cet artiste
  const deviceIds = await getDeviceIdsByArtist(artistId);

  await Promise.all([
    redis.del(artistKey(artistId)),
    redis.srem("artists:all", artistId),
    ...(profile.slug ? [redis.del(slugKey(profile.slug))] : []),
    ...deviceIds.map(async (deviceId) => {
      // Supprimer la clé inverse
      await redis.del(artistDevKey(deviceId));
      // Effacer artistId sur le device lui-même
      const device = await getDevice(deviceId);
      if (device) {
        device.artistId = undefined;
        device.artistName = undefined;
        await saveDevice(device);
      }
    }),
  ]);
}

// ─── Codes de liaison cross-device ───────────────────────────────────────────

const LINK_CODE_TTL = 600; // 10 minutes
const LINK_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateLinkCode(): string {
  const part = (n: number) =>
    Array.from({ length: n }, () =>
      LINK_CODE_CHARS[Math.floor(Math.random() * LINK_CODE_CHARS.length)]
    ).join("");
  return `${part(4)}-${part(4)}`;
}

interface LinkCodePayload {
  artistId:  string;
  createdAt: number;
}

/**
 * Génère un code de liaison (10 min) permettant à un autre navigateur
 * de rejoindre le même profil artiste.
 */
export async function createLinkCode(artistId: string): Promise<{ code: string; expiresAt: number }> {
  const code = generateLinkCode();
  const payload: LinkCodePayload = { artistId, createdAt: Date.now() };
  await redis.set(linkCodeKey(code), JSON.stringify(payload), { ex: LINK_CODE_TTL });
  return { code, expiresAt: Date.now() + LINK_CODE_TTL * 1000 };
}

/**
 * Valide un code de liaison et retourne l'artistId associé.
 * Invalide (DEL) le code après usage.
 */
export async function consumeLinkCode(code: string): Promise<string | null> {
  const raw = await redis.get<string>(linkCodeKey(code));
  if (!raw) return null;
  try {
    const payload: LinkCodePayload = typeof raw === "string" ? JSON.parse(raw) : raw;
    await redis.del(linkCodeKey(code));
    return payload.artistId;
  } catch {
    return null;
  }
}

/**
 * Lie un device à un profil artiste (stocke le lien dans la clé inverse
 * et met à jour le champ artistId sur le device).
 */
export async function linkDeviceToArtist(deviceId: string, artistId: string): Promise<void> {
  const device = await getDevice(deviceId);
  if (!device) return;
  device.artistId = artistId;
  await Promise.all([
    saveDevice(device),
    redis.set(artistDevKey(deviceId), artistId, { ex: ARTIST_TTL }),
  ]);
}

/**
 * Met à jour la clé publique ED25519 d'un device (envoyée à chaque register).
 * No-op si la clé est identique à celle déjà stockée.
 */
export async function updateDevicePublicKey(deviceId: string, publicKey: string): Promise<void> {
  const device = await getDevice(deviceId);
  if (!device || device.publicKey === publicKey) return;
  device.publicKey = publicKey;
  await saveDevice(device);
}

/**
 * Renomme un appareil (deviceName distinct de artistName).
 */
export async function setDeviceName(deviceId: string, deviceName: string): Promise<Device | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;
  device.deviceName = deviceName.trim().slice(0, 40);
  await saveDevice(device);
  return device;
}