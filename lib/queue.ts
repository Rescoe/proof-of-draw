// lib/queue.ts
// Frame store en mémoire, groupé par screenId.
// L'ESP pull ses frames via GET /api/pull?deviceId=xxx
// Plus aucune logique HTTP vers IP device.

export interface StoredFrame {
  screen: string;
  payload: FramePayload;
  storedAt: number;
  deviceId?: string;
  frameId: string;  // ← AJOUTÉ
}

export type FramePayload =
  | { screen: "oled096"; buffer: string }
  | { screen: "eink27bw"; buffer: string }
  | { screen: "eink29bwr"; black: string; red: string }
  | { screen: string; buffer?: string; black?: string; red?: string }; // fallback générique

// Store principal : screenId → dernière frame
// On ne garde que la DERNIÈRE frame par écran (display réseau — pas de queue)
const frameStore = new Map<string, StoredFrame>();

// ─── API PUBLIQUE ────────────────────────────────────────────────────────────

/**
 * Ancienne signature : sendFrameNow(ip, port, payload)  →  SUPPRIMÉE
 * Nouvelle signature : storeFrame(screenId, payload, deviceId?)
 *
 * Stocke le dernier frame pour un type d'écran.
 * L'ESP récupèrera ce frame au prochain poll /api/pull
 */
export function storeFrame(
  screenId: string,
  payload: FramePayload,
  deviceId?: string
): void {
const frame: StoredFrame = {
  screen: screenId,
  payload,
  storedAt: Date.now(),
  deviceId,
  frameId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
};
  frameStore.set(screenId, frame);
  console.log(`[queue] frame stockée pour screen=${screenId}${deviceId ? ` device=${deviceId}` : ""}`);
}

/**
 * Récupère la dernière frame pour un screenId donné.
 * Utilisé par /api/pull
 */
export function getFrameForScreen(screenId: string): StoredFrame | null {
  return frameStore.get(screenId) ?? null;
}

/**
 * Récupère la meilleure frame pour un device donné.
 * Priorité : frame ciblée deviceId → frame générique pour ce screen
 * Le device doit fournir sa liste de screens.
 */
export function getFrameForDevice(deviceId: string, screens: string[]): StoredFrame | null {
  // 1. Chercher une frame explicitement ciblée sur ce device
  for (const frame of frameStore.values()) {
    if (frame.deviceId === deviceId) return frame;
  }

  // 2. Chercher la frame la plus récente parmi les screens supportés
  let best: StoredFrame | null = null;
  for (const screenId of screens) {
    const frame = frameStore.get(screenId);
    if (frame && (!best || frame.storedAt > best.storedAt)) {
      best = frame;
    }
  }
  return best;
}

/**
 * Efface la frame d'un screen (optionnel — pour reset manuel)
 */
export function clearFrame(screenId: string): void {
  frameStore.delete(screenId);
}

/**
 * Liste toutes les frames en attente (pour debug /admin)
 */
export function listFrames(): StoredFrame[] {
  return Array.from(frameStore.values());
}

/* evite qu'on renvoie la frame a l'infini*/

export function clearFrameForDevice(deviceId: string, screens: string[]): void {
  // Supprime la frame ciblée sur ce device
  for (const [key, frame] of frameStore.entries()) {
    if (frame.deviceId === deviceId) {
      frameStore.delete(key);
      return;
    }
  }
  // Supprime la frame générique pour ses screens
  for (const screenId of screens) {
    if (frameStore.has(screenId)) {
      frameStore.delete(screenId);
      return;
    }
  }
}

export function clearFrameForDeviceAck(
  deviceId: string,
  screens: string[],
  frameId: string
): boolean {
  for (const [key, frame] of frameStore.entries()) {
    if (frame.deviceId === deviceId && frame.frameId === frameId) {
      frameStore.delete(key);
      return true;
    }
  }

  for (const screenId of screens) {
    const frame = frameStore.get(screenId);
    if (frame && frame.frameId === frameId) {
      frameStore.delete(screenId);
      return true;
    }
  }

  return false;
}
