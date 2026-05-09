import fs from "fs";
import path from "path";
import { ScreenId } from "./screenProfiles";

export interface Device {
  id: string;
  name: string;
  ip: string;
  port: number;
  screens: ScreenId[];
  lastPing?: number;
  lastDraw?: number;
  framesSent: number;
}

const DATA_PATH = path.join(process.cwd(), "data", "devices.json");

function ensureDataDir() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, "[]");
}

export function getDevices(): Device[] {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function saveDevices(devices: Device[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_PATH, JSON.stringify(devices, null, 2));
}

export function getDevice(id: string): Device | undefined {
  return getDevices().find((d) => d.id === id);
}

export function upsertDevice(device: Device) {
  const devices = getDevices();
  const idx = devices.findIndex((d) => d.id === device.id);
  if (idx >= 0) devices[idx] = device;
  else devices.push(device);
  saveDevices(devices);
}

export function updateDevicePing(id: string) {
  const devices = getDevices();
  const d = devices.find((d) => d.id === id);
  if (d) {
    d.lastPing = Date.now();
    saveDevices(devices);
  }
}

export function incrementFrameCount(id: string) {
  const devices = getDevices();
  const d = devices.find((d) => d.id === id);
  if (d) {
    d.framesSent = (d.framesSent || 0) + 1;
    d.lastDraw = Date.now();
    saveDevices(devices);
  }
}
