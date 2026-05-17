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
  artistName?: string;
  pairCode:   string;   // sensible — jamais exposé publiquement
  lastSeen:   number;
  lastPing:   number;
  framesSent: number;
  createdAt:  number;

  // ── Axe 2 : ESP en prêt public ──────────────────────────────────────────────
  publicMode?: boolean;             // toggle manuel : l'ESP est disponible pour d'autres artistes
  lastFrameReceivedAt?: number;     // mis à jour sur /api/ack-frame
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

function deviceKey(deviceId: string) { return `device:${deviceId}`; }
function macKey(mac: string)         { return `mac:${mac}`; }
function pairKey(code: string)       { return `pair:${code.toUpperCase()}`; }

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
  ]);
  await decrementDeviceCount();
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