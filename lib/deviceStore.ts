// lib/deviceStore.ts
// Store en mémoire via globalThis (survit hot reload en dev)
// ⚠️  AVERTISSEMENT PROD : ce store est in-process.
//     Sur un environnement serverless multi-instance (Vercel, etc.),
//     chaque instance a son propre store. Un ESP qui se connecte à l'instance A
//     ne sera pas visible depuis l'instance B.
//     Pour un MVP mono-instance (Railway, Render, VPS, etc.) c'est suffisant.
//     Si vous passez sur Vercel, il faudra une persistance externe (Redis, KV, etc.).

export interface Device {
  deviceId: string;
  mac: string;           // sensible – ne jamais exposer publiquement
  screens: string[];
  firmware: string;
  artistName?: string;
  pairCode: string;      // sensible – ne jamais exposer publiquement
  lastSeen: number;
  lastPing: number;
  framesSent: number;
  createdAt: number;
}

// Vue publique : aucune donnée sensible
export interface PublicDevice {
  artistName: string;
  screens: string[];
  isOnline: boolean;     // true si lastPing < 10min
  lastSeen: number;
}

// Vue propriétaire : données utiles pour gérer son device, sans MAC ni pairCode brut
export interface OwnedDevice {
  deviceId: string;
  artistName?: string;
  screens: string[];
  firmware: string;
  framesSent: number;
  lastPing: number;
  lastSeen: number;
  createdAt: number;
  isOnline: boolean;
  hasPairCode: boolean;  // indique qu'un code existe, sans l'exposer
}

// ─── Singleton globalThis ────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __deviceStore: Map<string, Device> | undefined;
}

const devices = globalThis.__deviceStore ?? new Map<string, Device>();
if (!globalThis.__deviceStore) {
  globalThis.__deviceStore = devices;
  console.log("[deviceStore] ✅ globalThis singleton initialisé");
}

// ─── Cleanup 48h ────────────────────────────────────────────────────────────
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const INACTIVE_TTL_MS = 48 * 60 * 60 * 1000;

function runCleanup() {
  const now = Date.now();
  for (const [id, device] of devices.entries()) {
    if (now - device.lastSeen > INACTIVE_TTL_MS) {
      console.log(`[deviceStore] cleanup: ${id} (mac: ${device.mac})`);
      devices.delete(id);
    }
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

// ─── Helpers internes ────────────────────────────────────────────────────────
function generateDeviceId(): string {
  return "dev_" + Math.random().toString(36).slice(2, 10).toUpperCase();
}

function generatePairCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n: number) =>
    Array.from({ length: n }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  return `${part(4)}${part(4)}`; // 8 chars sans tirets
}

function isOnline(device: Device): boolean {
  return Date.now() - device.lastPing < 10 * 60 * 1000; // < 10min
}

// ─── Projections ─────────────────────────────────────────────────────────────
export function toPublicDevice(d: Device): PublicDevice {
  return {
    artistName: d.artistName ?? "Artiste inconnu",
    screens: d.screens,
    isOnline: isOnline(d),
    lastSeen: d.lastSeen,
  };
}

export function toOwnedDevice(d: Device): OwnedDevice {
  return {
    deviceId: d.deviceId,
    artistName: d.artistName,
    screens: d.screens,
    firmware: d.firmware,
    framesSent: d.framesSent,
    lastPing: d.lastPing,
    lastSeen: d.lastSeen,
    createdAt: d.createdAt,
    isOnline: isOnline(d),
    hasPairCode: !!d.pairCode,
  };
}

// ─── API publique ─────────────────────────────────────────────────────────────
export function registerDevice(
  mac: string,
  screens: string[],
  firmware: string
): Device {
  const existing = getDeviceByMac(mac);
  if (existing) {
    existing.firmware = firmware;
    existing.screens = screens;
    existing.lastSeen = Date.now();
    devices.set(existing.deviceId, existing);
    console.log(`[deviceStore] register: update ${existing.deviceId} (mac: ${mac})`);
    return existing;
  }

  const device: Device = {
    deviceId: generateDeviceId(),
    mac,
    screens,
    firmware,
    pairCode: generatePairCode(),
    lastSeen: Date.now(),
    lastPing: Date.now(),
    framesSent: 0,
    createdAt: Date.now(),
  };

  devices.set(device.deviceId, device);
  console.log(
    `[deviceStore] register: NEW ${device.deviceId} (mac: ${mac}, code: ${device.pairCode})`
  );
  return device;
}

export function pingDevice(deviceId: string): Device | null {
  const device = devices.get(deviceId);
  if (!device) return null;
  device.lastSeen = Date.now();
  device.lastPing = Date.now();
  devices.set(deviceId, device);
  return device;
}

export function setArtistName(deviceId: string, artistName: string): Device | null {
  const device = devices.get(deviceId);
  if (!device) return null;
  device.artistName = artistName;
  devices.set(deviceId, device);
  console.log(`[deviceStore] artistName: ${deviceId} → "${artistName}"`);
  return device;
}

export function rotatePairCode(deviceId: string): string | null {
  const device = devices.get(deviceId);
  if (!device) return null;
  device.pairCode = generatePairCode();
  devices.set(deviceId, device);
  console.log(`[deviceStore] pairCode rotated: ${deviceId}`);
  return device.pairCode;
}

export function incrementFramesSent(deviceId: string): void {
  const device = devices.get(deviceId);
  if (device) {
    device.framesSent += 1;
    devices.set(deviceId, device);
  }
}

export function getDevice(deviceId: string): Device | undefined {
  return devices.get(deviceId);
}

export function getDeviceByMac(mac: string): Device | undefined {
  for (const d of devices.values()) {
    if (d.mac === mac) return d;
  }
  return undefined;
}

export function getAllDevices(): Device[] {
  return Array.from(devices.values());
}

export function deleteDevice(deviceId: string): boolean {
  return devices.delete(deviceId);
}