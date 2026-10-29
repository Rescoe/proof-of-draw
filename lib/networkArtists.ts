// lib/networkArtists.ts — « Artistes du réseau » de l'accueil (UX jalon 2, 29/10/2026) : fonction PURE, aucune lecture Redis (elle consomme le snapshot déjà chargé pour la carte).
// Bornée : au plus `max` artistes en sortie, quel que soit le nombre d'appareils ; un seul passage sur les appareils (regroupement par clé d'artiste), puis une sélection bornée
// (pas de tri complet de tous les artistes). Testée dans tests/networkArtists.test.ts.
import type { NetworkDevice } from "./networkSnapshot";

export interface NetworkArtistRow {
  artistKey: string;
  /** Identifiant de profil quand la clé est « a:<artistId> » (lien vers /artists/<id>), sinon null (artiste sans profil : pas de lien). */
  artistId: string | null;
  label: string;
  devices: number;
  online: number;
  /** Dernier signe de vie des appareils de l'artiste (ms epoch, 0 si inconnu). */
  lastActiveMs: number;
}

export interface NetworkArtistsSummary {
  /** Artistes distincts (clé « unassigned » exclue). */
  artists: number;
  /** Artistes ayant au moins un appareil en ligne. */
  artistsOnline: number;
  devices: number;
  devicesOnline: number;
  /** Les `max` artistes les plus récemment actifs (en ligne d'abord, puis dernier signe de vie décroissant). */
  active: NetworkArtistRow[];
}

const UNASSIGNED = "unassigned";

/** Plus « actif » = en ligne avant hors ligne ; à égalité de statut, le dernier signe de vie le plus récent ; à égalité complète, l'ordre alphabétique (stable, déterministe). */
const moreActive = (a: NetworkArtistRow, b: NetworkArtistRow) =>
  (a.online > 0) !== (b.online > 0) ? a.online > 0 : a.lastActiveMs !== b.lastActiveMs ? a.lastActiveMs > b.lastActiveMs : a.label.localeCompare(b.label, "fr") < 0;

export function networkArtists(devices: NetworkDevice[], max = 6): NetworkArtistsSummary {
  const byKey = new Map<string, NetworkArtistRow>();
  let devicesOnline = 0;
  for (const d of devices) {
    if (d.isOnline) devicesOnline++;
    const key = d.artistKey || UNASSIGNED;
    if (key === UNASSIGNED) continue;
    let row = byKey.get(key);
    if (!row) {
      row = { artistKey: key, artistId: key.startsWith("a:") ? key.slice(2) : null, label: d.artistName?.trim() || "Artiste", devices: 0, online: 0, lastActiveMs: 0 };
      byKey.set(key, row);
    }
    row.devices++;
    if (d.isOnline) row.online++;
    const seen = Math.max(d.lastPing || 0, d.lastSeen || 0);
    if (seen > row.lastActiveMs) row.lastActiveMs = seen;
  }
  // sélection bornée : on garde au plus `max` lignes triées (insertion), jamais un tri de tous les artistes
  const top: NetworkArtistRow[] = [];
  let artistsOnline = 0;
  for (const row of byKey.values()) {
    if (row.online > 0) artistsOnline++;
    let i = top.length;
    while (i > 0 && moreActive(row, top[i - 1])) i--;
    if (i < max) { top.splice(i, 0, row); if (top.length > max) top.pop(); }
  }
  return { artists: byKey.size, artistsOnline, devices: devices.length, devicesOnline, active: top };
}
