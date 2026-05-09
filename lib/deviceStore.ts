// lib/deviceStore.ts — FIXED: globalThis singleton pour dev Next.js
// Modèle device pull-based : plus d'IP/port, identification par MAC
// Cleanup automatique des devices inactifs depuis 48h

export interface Device {
  deviceId: string;
  mac: string;
  screens: string[];
  firmware: string;
  artistName?: string;
  pairCode: string;
  lastSeen: number;
  lastPing: number;
  framesSent: number;
  createdAt: number;
}

// ✅ FIX CRITIQUE : globalThis singleton (survit hot reload)
declare global {
  // eslint-disable-next-line no-var
  var __deviceStore: Map<string, Device> | undefined;
}

const devices = globalThis.__deviceStore ?? new Map<string, Device>();

if (!globalThis.__deviceStore) {
  globalThis.__deviceStore = devices;
  console.log("[deviceStore] ✅ globalThis singleton initialisé");
}

// ─── CLEANUP 48h ────────────────────────────────────────────────────────────
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

// ─── HELPERS (inchangés) ───────────────────────────────────────────────────
function generateDeviceId(): string {
  return "dev_" + Math.random().toString(36).slice(2, 10).toUpperCase();
}

function generatePairCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${part(4)}-${part(4)}`;
}

// ─── API PUBLIQUE (inchangée) ──────────────────────────────────────────────
export function registerDevice(mac: string, screens: string[], firmware: string): Device {
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
    pairCode: generatePairCode().replace(/-/g, ''), // ✅ ENLEVE TOUS les tirets
    lastSeen: Date.now(),
    lastPing: Date.now(),
    framesSent: 0,
    createdAt: Date.now(),
  };

  devices.set(device.deviceId, device);
  console.log(`[deviceStore] register: NEW ${device.deviceId} (mac: ${mac}, code: ${device.pairCode})`);
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