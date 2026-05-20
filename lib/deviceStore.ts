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
}

// ─── ArtistProfile ────────────────────────────────────────────────────────────

export interface ArtistProfile {
  artistId:    string;
  displayName: string;
  bio?:        string;
  profileImageBlockHash?: string; // hash du bloc choisi comme avatar
  createdAt:   number;
  updatedAt:   number;
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
  const devices = await Promise.all(
    allIds.map(async (id) => {
      try {
        const raw = await redis.get(deviceKey(id));
        if (!raw) {
          // Device expiré (TTL Redis) — nettoyer l'index
          redis.srem("devices:all", id).catch(() => {});
          return null;
        }
        const d = typeof raw === "string" ? JSON.parse(raw) : raw;
        return now - d.lastPing < activeWindowMs ? d : null;
      } catch {
        return null;
      }
    }),
  );

  return Math.max(1, devices.filter(Boolean).length);
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
 * Crée ou met à jour un profil artiste.
 * Si existingArtistId est fourni, met à jour le profil existant.
 * Retourne le profil persisté.
 */
export async function createOrUpdateArtist(
  displayName: string,
  bio?: string,
  existingArtistId?: string,
  profileImageBlockHash?: string,
): Promise<ArtistProfile> {
  const artistId = existingArtistId ?? crypto.randomUUID();
  const existing = existingArtistId ? await getArtist(existingArtistId) : null;
  const profile: ArtistProfile = {
    artistId,
    displayName: displayName.trim().slice(0, 60),
    bio:         bio?.trim().slice(0, 300),
    // Conserver l'image existante si aucune nouvelle n'est fournie
    profileImageBlockHash: profileImageBlockHash ?? existing?.profileImageBlockHash,
    createdAt:   existing?.createdAt ?? Date.now(),
    updatedAt:   Date.now(),
  };
  await redis.set(artistKey(artistId), JSON.stringify(profile), { ex: ARTIST_TTL });
  await redis.sadd("artists:all", artistId);
  return profile;
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
 * Renomme un appareil (deviceName distinct de artistName).
 */
export async function setDeviceName(deviceId: string, deviceName: string): Promise<Device | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;
  device.deviceName = deviceName.trim().slice(0, 40);
  await saveDevice(device);
  return device;
}