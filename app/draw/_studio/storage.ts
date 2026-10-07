// app/draw/_studio/storage.ts
// Préférences (localStorage) et brouillon (IndexedDB) de l'éditeur.
// Tout est enveloppé dans try/catch : navigation privée, quota, stockage
// bloqué… l'éditeur doit fonctionner sans, jamais planter.

import type { SessionSnapshot } from "@/lib/drawEngine";
import type { GridSettings, Toolbox, ToolSettings } from "./types";

// ─── Préférences ─────────────────────────────────────────────────────────────

export interface StudioPrefs {
  toolbox: Toolbox;
  settings: Partial<ToolSettings>;
  recents: string[];          // couleurs récentes (#rrggbb)
  favorites: string[];        // couleurs favorites
  customBrushes: string[];    // ids "c:WxH:base64"
  customTextures: string[];   // ids "c:<16 hex>"
  grid: GridSettings;
  /** zone du cartel (hachures des bandes que le firmware efface) : affichée par défaut sur les écrans qui reçoivent un cartel gravé */
  cartel: boolean;
  penOnly: boolean;
  introSeen: boolean;
  nudges: { studio: boolean; pro: boolean };   // suggestions de boîte à outils déjà montrées
}

const PREFS_KEY = "pod_studio_prefs_v1";

export const DEFAULT_PREFS: StudioPrefs = {
  toolbox: "studio",
  settings: {},
  recents: [],
  favorites: [],
  customBrushes: [],
  customTextures: [],
  grid: { show: false, step: 8 },
  cartel: true,
  penOnly: true,
  introSeen: false,
  nudges: { studio: false, pro: false },
};

export function loadPrefs(): StudioPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<StudioPrefs>;
    return { ...DEFAULT_PREFS, ...p, grid: { ...DEFAULT_PREFS.grid, ...(p.grid ?? {}) } };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(p: StudioPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* stockage indisponible */ }
}

// ─── Cooldown (partagé entre les écrans d'un même appareil) ──────────────────

const cdKey = (deviceId: string) => `pod_cooldown_dev_${deviceId}`;
const legacyCdKey = (deviceId: string, screenId: string) => `pod_cooldown_${deviceId}_${screenId}`;

/** Fin du cooldown (ms epoch), 0 si aucun. Lit aussi l'ancienne clé par écran. */
export function loadCooldownUntil(deviceId: string, screenIds: string[] = []): number {
  let best = 0;
  try {
    for (const k of [cdKey(deviceId), ...screenIds.map(s => legacyCdKey(deviceId, s))]) {
      const v = parseInt(localStorage.getItem(k) ?? "0", 10);
      if (v > best) best = v;
    }
  } catch { /* ignore */ }
  return best > Date.now() ? best : 0;
}

export function saveCooldownUntil(deviceId: string, until: number) {
  try { localStorage.setItem(cdKey(deviceId), String(until)); } catch { /* ignore */ }
}

export function clearCooldown(deviceId: string) {
  try { localStorage.removeItem(cdKey(deviceId)); } catch { /* ignore */ }
}

// ─── Brouillon (IndexedDB) ───────────────────────────────────────────────────

export interface DraftData {
  v: 1;
  savedAt: number;
  snapshot: SessionSnapshot;
  title: string;
  guestName: string;
  elapsedMs: number;   // horloge de session au moment de la sauvegarde (temps actif)
  score: number;
}

const DB_NAME = "pod-studio";
const STORE = "drafts";
export const DRAFT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function saveDraft(key: string, data: DraftData): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
    } catch { db.close(); resolve(false); }
  });
}

export async function loadDraft(key: string): Promise<DraftData | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => {
        db.close();
        const d = req.result as DraftData | undefined;
        if (!d || d.v !== 1 || Date.now() - d.savedAt > DRAFT_MAX_AGE_MS) resolve(null);
        else resolve(d);
      };
      req.onerror = () => { db.close(); resolve(null); };
    } catch { db.close(); resolve(null); }
  });
}

export async function deleteDraft(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch { db.close(); resolve(); }
  });
}

// ─── Horloge de session ──────────────────────────────────────────────────────

/**
 * Horloge de "temps actif" : elle s'arrête quand l'onglet est caché et repart
 * de la valeur sauvegardée après restauration d'un brouillon. Ainsi `t` reste
 * monotone et cohérent pour analyzeReplay (durée de session, intervalles) —
 * un brouillon repris le lendemain ne produit pas une "session" de 20 heures.
 */
export class SessionClock {
  private base = 0;
  private resumedAt: number | null;

  constructor(startAt = 0) {
    this.base = startAt;
    this.resumedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  now(): number {
    if (this.resumedAt === null) return Math.round(this.base);
    return Math.round(this.base + (performance.now() - this.resumedAt));
  }

  /** Repart d'une valeur donnée (nouveau dessin, brouillon repris). */
  reset(startAt = 0) {
    this.base = startAt;
    this.resumedAt = performance.now();
  }

  pause() {
    if (this.resumedAt === null) return;
    this.base += performance.now() - this.resumedAt;
    this.resumedAt = null;
  }

  resume() {
    if (this.resumedAt === null) this.resumedAt = performance.now();
  }
}
