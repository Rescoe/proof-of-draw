// lib/queue.ts
// Frame store via Upstash Redis
// Une frame par (device, screen) — pas de queue longue, TTL 15min : si l'ESP
// ne pull pas dans ce délai, la frame expire seule.
//
// Historiquement une seule frame par DEVICE (pas par écran) — correct tant
// qu'un device n'avait qu'un seul type d'écran. Un device multi-écran (ex.
// esp_eink_2.7BW_OLED : eink27bw + oled096 sur le même ESP) casse cette
// hypothèse : le pont ANA (lib/anaFeed.ts) stocke une frame par type d'écran
// opté-in, en boucle — sur l'ancienne clé unique par device, la deuxième
// écriture écrasait purement et simplement la première avant même que le
// device ait pu la pull une seule fois. Confirmé par simulation et par le
// symptôme rapporté : OLED (écrit avant eink27bw dans SCREEN_IDS) perdait
// systématiquement contre eink27bw, jamais l'inverse.
//
// Le firmware envoie déjà &screen= explicitement sur /api/pull-frame (voir
// esp_eink_2.7BW_OLED.ino, commentaire "obligatoire — device multi-screen")
// — donc cette correction est purement côté stockage/lookup, sans aucun
// changement de protocole ni de firmware.

import { redis } from "@/lib/redis";

export interface StoredFrame {
  screen:    string;
  payload:   FramePayload;
  storedAt:  number;
  deviceId?: string;
  frameId:   string;
}

export type FramePayload =
  | { screen: "oled096";   buffer: string }
  | { screen: "eink27bw";  buffer: string }
  | { screen: "tft18";     buffer: string }
  | { screen: "eink29bwr"; black: string; red: string }
  | { screen: string; buffer?: string; black?: string; red?: string };

const FRAME_TTL = 15 * 60;

export function frameKey(deviceId: string, screen: string) { return `frame:${deviceId}:${screen}`; }

// Upstash peut retourner un objet déjà parsé OU une string JSON — on gère les deux
function parseFrame(raw: unknown): StoredFrame | null {
  try {
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw) as StoredFrame;
    if (typeof raw === "object") return raw as StoredFrame;
    return null;
  } catch {
    return null;
  }
}

export function storeFrame(
  screenId: string,
  payload: FramePayload,
  deviceId?: string
): void {
  const frame: StoredFrame = {
    screen:   screenId,
    payload,
    storedAt: Date.now(),
    deviceId,
    frameId:  Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  };

  if (deviceId) {
    redis.set(frameKey(deviceId, screenId), JSON.stringify(frame), { ex: FRAME_TTL });
    console.log(`[queue] frame stockée device=${deviceId} screen=${screenId}`);
  }
}

/**
 * Cherche une frame en attente pour ce device, parmi les écrans donnés.
 * Un device mono-écran passe un tableau à un seul élément (lookup direct,
 * même comportement qu'avant). Un device multi-écran (/api/pull, qui ne
 * sait pas encore lequel de ses écrans a une frame en attente) passe la
 * liste complète de device.screens — la plus ancienne frame trouvée gagne,
 * pour que les deux écrans tournent équitablement plutôt que l'un affamant
 * l'autre.
 */
export async function getFrameForDevice(
  deviceId: string,
  screens: string[]
): Promise<StoredFrame | null> {
  if (screens.length === 0) return null;
  const raws = await Promise.all(screens.map(s => redis.get(frameKey(deviceId, s))));
  const frames = raws.map(parseFrame).filter((f): f is StoredFrame => f !== null);
  if (frames.length === 0) return null;
  return frames.reduce((oldest, f) => (f.storedAt < oldest.storedAt ? f : oldest));
}

export async function clearFrameForDeviceAck(
  deviceId: string,
  screens: string[],
  frameId: string
): Promise<boolean> {
  for (const screen of screens) {
    const raw = await redis.get(frameKey(deviceId, screen));
    const frame = parseFrame(raw);
    if (frame && frame.frameId === frameId) {
      await redis.del(frameKey(deviceId, screen));
      return true;
    }
  }
  return false;
}

// Compat legacy
export function getFrameForScreen(_screenId: string): StoredFrame | null { return null; }
export function clearFrame(_screenId: string): void {}
export function clearFrameForDevice(_deviceId: string, _screens: string[]): void {}
export function listFrames(): StoredFrame[] { return []; }