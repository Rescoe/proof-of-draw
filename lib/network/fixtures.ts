// lib/network/fixtures.ts — jeu de données SYNTHÉTIQUE et DÉTERMINISTE du réseau, pour développer et tester la vue réseau à n'importe quelle échelle
// (1, 5, 20, 100, 500 appareils) SANS lire Redis (quota). Réservé au développement : fixtureCount() renvoie null en production.
//
// Utilisation (développement uniquement) : ajouter ?fixture=<n> à l'URL de la page ; la page le transmet à :
//   getNetworkSnapshotFor(fixture)                       (lib/network/source.ts)
//   /api/network/displays?fixture=n                      images « actuellement affichées » (métadonnées)
//   /api/network/activity-log?fixture=n                  événements récents (votes, validations, blocs, animations)
//   /api/network/display-image?frameId=fixture-…&screen= vignette synthétique (n'importe quel frameId « fixture-… »)
// Mêmes n ⇒ mêmes appareils, mêmes artistes, mêmes affichages (à l'horloge près : les horodatages sont relatifs à `now`).
//
// Le jeu contient volontairement des cas pénibles : artistes homonymes (clés différentes), appareils non associés, matériel inconnu, appareil sans écran,
// firmware ancien (sans animation), appareils hors ligne, affichages récents (< 5 min) et anciens (jours).

import { assembleNetworkSnapshot, toNetworkDevice, type DeviceRecord, type NetworkDevice, type NetworkSnapshot } from "@/lib/networkSnapshot";
import type { PublicShown } from "@/lib/displayState";
import type { LogEvent } from "@/app/api/network/activity-log/route";
import { publicDeviceId } from "@/lib/network/publicId";
import { SCREEN_PROFILES, type ScreenId } from "@/lib/screenProfiles";
import { rgbaToScreenPayload } from "@/lib/canvasToScreen";

export const FIXTURE_MAX = 800;

/** Nombre d'appareils demandé par `?fixture=n`, ou null (absent, invalide, ou PRODUCTION). */
export function fixtureCount(param: string | null | undefined, env: string | undefined = process.env.NODE_ENV): number | null {
  if (env === "production") return null;
  if (param === null || param === undefined || param === "") return null;
  const n = Number.parseInt(String(param), 10);
  return Number.isInteger(n) && n >= 0 && n <= FIXTURE_MAX ? n : null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const ARTIST_NAMES = ["Roubzi", "Neo", "Claude", "Mira", "Atelier Nord", "Lune", "Pixel Paul", "Sora", "Ondine", "Kasimir", "Yuki", "Basalte", "Éloïse", "Tango", "Nadir", "Fenek", "Opale", "Vesper", "Cyan", "Hugo", "Zélie", "Ombre", "Brume", "Ilot"];
const TITLES = ["Mouche", "Vie mort", "Horizon", "Nuit blanche", "Sans titre", "Petit soleil", "Marée", "Chat de gouttière", "Signal", "Portrait au trait", "Forêt", "Idée fixe"];

type Kind = { firmware: string; screens: string[]; weight: number };
const KINDS: Kind[] = [
  { firmware: "multiscreen-2.2", screens: ["eink27bw", "oled096"], weight: 14 },
  { firmware: "multiscreen-2.1", screens: ["eink27bw", "oled096"], weight: 4 },   // ancien : sans animation
  { firmware: "tft18-2.2", screens: ["tft18"], weight: 14 },
  { firmware: "tft18-2.1", screens: ["tft18"], weight: 3 },
  { firmware: "2.0", screens: ["eink29bwr"], weight: 22 },
  { firmware: "eink27bw-2.0", screens: ["eink27bw"], weight: 6 },
  { firmware: "r4tft28-2.4", screens: ["tft28"], weight: 18 },
  { firmware: "r4tft28-2.3", screens: ["tft28"], weight: 3 },
  { firmware: "r4eink29-1.0", screens: ["eink29bwr"], weight: 10 },
  { firmware: "mystery-9.9", screens: ["tft18"], weight: 3 },                      // matériel inconnu
  { firmware: "", screens: [], weight: 3 },                                         // appareil sans écran
];
const KIND_TOTAL = KINDS.reduce((s, k) => s + k.weight, 0);

function pickKind(r: number): Kind {
  let x = r * KIND_TOTAL;
  for (const k of KINDS) { x -= k.weight; if (x < 0) return k; }
  return KINDS[0];
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function fakeDeviceId(rand: () => number): string {
  let s = "dev_";
  for (let i = 0; i < 8; i++) s += ID_CHARS[Math.floor(rand() * ID_CHARS.length)];
  return s;
}

/** Appareils synthétiques (fiches internes) — déterministes pour un n donné. */
export function buildFixtureRecords(n: number, now: number = Date.now()): DeviceRecord[] {
  const rand = mulberry32(0x9e3779b1 ^ (n * 2654435761));
  const artistCount = n === 0 ? 0 : Math.max(1, Math.min(n, Math.round(n / 3.2)));
  const artists: { id: string; name: string }[] = [];
  for (let i = 0; i < artistCount; i++) {
    const base = ARTIST_NAMES[i % ARTIST_NAMES.length];
    // homonymes : à partir de 6 artistes, le 4e porte le nom du 2e (profils différents)
    const name = i === 3 && artistCount >= 6 ? ARTIST_NAMES[1] : i >= ARTIST_NAMES.length ? `${base} ${Math.floor(i / ARTIST_NAMES.length) + 1}` : base;
    artists.push({ id: `art${(1000 + i).toString(36)}fix`, name });
  }

  const used = new Set<string>();
  const records: DeviceRecord[] = [];
  for (let i = 0; i < n; i++) {
    let id = fakeDeviceId(rand);
    while (used.has(id)) id = fakeDeviceId(rand);
    used.add(id);
    const kind = pickKind(rand());
    const roll = rand();
    // ≈ 6 % non associés ; ≈ 5 % avec un nom mais sans profil ; les autres rattachés à un profil
    const artist = roll < 0.06 ? null : artists[Math.floor(rand() * artists.length) % artists.length];
    const online = rand() < 0.7;
    const ageMs = online ? Math.floor(rand() * 8 * 60_000) : 40 * 60_000 + Math.floor(rand() * 5 * 86_400_000);
    records.push({
      deviceId: id,
      screens: [...kind.screens],
      firmware: kind.firmware,
      artistName: artist ? artist.name : undefined,
      ...(artist && roll >= 0.11 ? { artistId: artist.id } : {}),
      sceneCapability: kind.firmware.startsWith("tft18") || kind.firmware.startsWith("multiscreen") ? { sceneV1: true } : undefined,
      lastSeen: now - ageMs,
      lastPing: now - ageMs,
      framesSent: Math.floor(rand() * 60),
      createdAt: now - Math.floor((2 + rand() * 90) * 86_400_000),
    });
  }
  return records;
}

export function buildFixtureSnapshot(n: number, now: number = Date.now()): NetworkSnapshot {
  const devices: NetworkDevice[] = buildFixtureRecords(n, now).map((r) => toNetworkDevice(r, null, now));
  const snap = assembleNetworkSnapshot(devices, n % 3);
  return { ...snap, generatedAt: now, generatedAtIso: new Date(now).toISOString() };
}

/** « Qui affiche quoi » synthétique : ≈ 65 % des écrans ont une image confirmée ; certaines < 5 min (flux récents), d'autres anciennes. */
export function buildFixtureDisplays(snapshot: NetworkSnapshot, now: number = Date.now()): Record<string, Record<string, PublicShown>> {
  const out: Record<string, Record<string, PublicShown>> = {};
  for (const d of snapshot.devices) {
    for (const s of d.screens) {
      const h = hash32(`${d.publicId}:${s.screen}`);
      const r = mulberry32(h);
      if (r() > 0.65) continue;
      const bucket = r();
      const ageMs = bucket < 0.15 ? Math.floor(r() * 4 * 60_000) : bucket < 0.4 ? Math.floor(r() * 3_600_000) : Math.floor(r() * 3 * 86_400_000);
      const anaRoll = r();
      (out[d.deviceId] ??= {})[s.screen] = {
        frameId: `fixture-${h.toString(16).padStart(8, "0")}`,
        screen: s.screen,
        shownAt: now - ageMs,
        kind: anaRoll < 0.1 ? "ana" : "human",
        workTitle: TITLES[Math.floor(r() * TITLES.length)],
        artistName: d.artistName,
        blockIndex: 40 + Math.floor(r() * 60),
        mode: "frame",
        ...(d.capabilities.animationScreens.includes(s.screen) && r() < 0.15 ? { isAnimation: true } : {}),
        hasImage: true,
      };
    }
  }
  return out;
}

/** Événements récents synthétiques (même forme que /api/network/activity-log), dont des votes d'appareils du jeu. */
export function buildFixtureEvents(snapshot: NetworkSnapshot, now: number = Date.now()): LogEvent[] {
  const events: LogEvent[] = [];
  const online = snapshot.devices.filter((d) => d.isOnline);
  const r = mulberry32(snapshot.devices.length * 7919 + 13);
  const pick = <T,>(xs: T[]): T | undefined => xs[Math.floor(r() * xs.length)];

  events.push({ id: "fixture-pending", type: "VALIDATION_PENDING", ts: now - 40_000, screen: "tft28", artistName: pick(snapshot.devices)?.artistName ?? "Artiste", drawScore: 12,
    validatorCount: Math.min(2, online.length), poolSize: Math.max(1, online.length), workTitle: "Mouche", message: "VALIDATION en attente" });
  for (let i = 0; i < Math.min(8, online.length); i++) {
    const d = online[i];
    events.push({ id: `fixture-vote-${i}`, type: "VALIDATION_VOTE", ts: now - (30 + i * 55) * 1000, deviceRef: d.publicId,
      screen: d.screens[0]?.screen, message: `VOTE · ${d.publicId.slice(0, 12)} · score ${40 + Math.floor(r() * 40)}%` });
  }
  for (let i = 0; i < 3; i++) {
    const d = pick(snapshot.devices);
    events.push({ id: `fixture-block-${i}`, type: "BLOCK_MINED", ts: now - (2 + i * 6) * 60_000, screen: d?.screens[0]?.screen, artistName: d?.artistName,
      blockIndex: 90 - i, workTitle: TITLES[(i * 5) % TITLES.length], message: `BLOC #${90 - i}` });
  }
  const a = pick(snapshot.devices);
  events.push({ id: "fixture-anim", type: "ANIMATION", ts: now - 9 * 60_000, artistName: a?.artistName, workTitle: "Marée", message: "ANIMATION · Marée" });
  return events.sort((x, y) => y.ts - x.ts);
}

/** Vignette synthétique pour un frameId « fixture-… » : motif déterministe au format de l'écran. */
export function fixtureImage(frameId: string, screen: string): { screen: string; black?: string; red?: string; buffer?: string } | null {
  const profile = SCREEN_PROFILES[screen as ScreenId];
  if (!profile) return null;
  const w = profile.width, h = profile.height;
  const seed = hash32(frameId);
  const palette = [[0, 0, 0], [255, 255, 255], [204, 0, 0], [0, 170, 80]];
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = palette[(((x >> 3) ^ (y >> 3)) + (seed >> 5) + ((x * y) >> 9)) & 3];
      const i = (y * w + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  const p = rgbaToScreenPayload(px, screen as ScreenId) as { screen: string; black?: string; red?: string; buffer?: string };
  return p;
}
