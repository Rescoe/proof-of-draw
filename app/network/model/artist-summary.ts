// Résumé d'un artiste pour sa fiche (panneau de la page Réseau) — pur, sans Redis ni React : testé dans tests/networkModel.test.ts.
// Source unique : le snapshot réseau (déjà chargé) + les affichages CONFIRMÉS par ACK (déjà chargés par useLiveDisplays). Aucune requête de plus.
import type { PublicShown } from "@/lib/displayState";
import type { NetworkDevice } from "@/lib/networkSnapshot";
import type { ArtistGroup } from "./groups";

export type ArtistScreenRow = {
  screen: string;
  label: string;
  /** Ce que l'écran affiche, SEULEMENT si l'appareil l'a confirmé (ACK du firmware). */
  shown?: PublicShown;
};

export type ArtistDeviceRow = {
  device: NetworkDevice;
  lastActivity: number;
  screens: ArtistScreenRow[];
};

export type RecentWork = {
  key: string;
  publicId: string;
  screen: string;
  screenLabel: string;
  title: string;
  shownAt: number;
  isAnimation: boolean;
  blockIndex?: number;
};

export type ArtistSummary = {
  devices: ArtistDeviceRow[];
  recentWorks: RecentWork[];
  framesSent: number;
  confirmedScreens: number;
  lastActivity: number;
};

type DisplaysLike = Record<string, Record<string, PublicShown>> | null | undefined;

const activityOf = (d: NetworkDevice): number => Math.max(d.lastSeen || 0, d.lastPing || 0, d.recentFrame?.createdAt || 0);

/** En ligne d'abord, puis le plus récemment actif, puis identifiant public (ordre total et stable). */
export function summarizeArtist(artist: ArtistGroup, displays: DisplaysLike, maxWorks = 6): ArtistSummary {
  const devices: ArtistDeviceRow[] = artist.devices
    .map((device) => ({
      device,
      lastActivity: activityOf(device),
      screens: device.screens.map((s) => ({ screen: s.screen, label: s.label, shown: displays?.[device.deviceId]?.[s.screen] })),
    }))
    .sort((a, b) => Number(b.device.isOnline) - Number(a.device.isOnline) || b.lastActivity - a.lastActivity || a.device.publicId.localeCompare(b.device.publicId));

  const works: RecentWork[] = [];
  for (const row of devices) {
    for (const s of row.screens) {
      if (!s.shown) continue;
      works.push({
        key: `${row.device.publicId}:${s.screen}`,
        publicId: row.device.publicId,
        screen: s.screen,
        screenLabel: s.label,
        title: s.shown.workTitle?.trim() || "Sans titre",
        shownAt: s.shown.shownAt,
        isAnimation: !!s.shown.isAnimation,
        ...(typeof s.shown.blockIndex === "number" ? { blockIndex: s.shown.blockIndex } : {}),
      });
    }
  }
  works.sort((a, b) => b.shownAt - a.shownAt || a.key.localeCompare(b.key));

  return {
    devices,
    recentWorks: works.slice(0, Math.max(0, maxWorks)),
    framesSent: artist.devices.reduce((total, d) => total + (d.framesSent || 0), 0),
    confirmedScreens: works.length,
    lastActivity: artist.lastActivity,
  };
}
