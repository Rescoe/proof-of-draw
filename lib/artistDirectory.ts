// lib/artistDirectory.ts
// SOURCE UNIQUE DE VÉRITÉ pour "qui est artiste, quels appareils et quels blocs
// lui appartiennent". Avant ce module, trois définitions divergeaient :
//   • annuaire / fiche publique : devices dont device.artistId === profil (vivants seulement)
//   • "mon profil"             : devices du COOKIE de session (peut inclure d'anciens ids)
//   • /api/devices?mine=1      : cookie ∪ clés inverses artist:device:*
// et un appareil ré-enregistré (nouvel id après coupure) n'était plus rattaché
// à son profil alors que ses anciens blocs l'étaient — d'où avatar/blocs manquants
// sur la fiche publique et un artiste "fantôme" de plus dans l'annuaire.
//
// Modèle retenu :
//   Profil artiste  = artist:{id}  (existence vérifiée, jamais supposée depuis artists:all)
//   Appartenance    = clé inverse artist:device:{deviceId} → artistId. Elle survit à la
//                     suppression/ré-enregistrement d'un device : c'est l'attribution
//                     DURABLE des blocs minés sous d'anciens ids. device.artistId n'en est
//                     que la copie sur l'appareil vivant (les deux sont écrits ensemble par
//                     linkDeviceToArtist ; toute lecture passe par ce module).
//   Artiste implicite = ESP appairé (nom choisi) sans profil valide : dérivé à la volée
//                     (voir deviceStore.implicitArtistProfile), un par ESP non rattaché.

import { redis } from "@/lib/redis";
import {
  getArtist, getAllDevices, isImplicitArtistDevice, implicitArtistProfile,
  IMPLICIT_ARTIST_PREFIX, type ArtistProfile, type Device,
} from "@/lib/deviceStore";
import { getBlockByHash, getBlockImage, type Block, type BlockImagePayload } from "@/lib/chain";

const ARTISTS_ALL = "artists:all";
const BLOCKS_MAX  = 24;

export interface ArtistEntry {
  profile:     ArtistProfile;
  implicit:    boolean;   // true = ESP sans profil (id "esp_{deviceId}")
  deviceIds:   string[];  // appareils VIVANTS de l'artiste
  deviceCount: number;
}

// ─── Appartenance ─────────────────────────────────────────────────────────────

/** Toutes les clés inverses artist:device:* → Map<deviceId, artistId> (un seul scan + mget). */
async function readReverseLinks(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor = 0;
  const keys: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, { match: "artist:device:*", count: 200 });
    cursor = Number(next);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);
  if (keys.length === 0) return map;
  const vals = await redis.mget<(string | null)[]>(...keys);
  keys.forEach((k, i) => {
    const v = vals[i];
    if (v) map.set(k.replace("artist:device:", ""), typeof v === "string" ? v : String(v));
  });
  return map;
}

/**
 * Tous les deviceIds attribuables à un profil : appareils vivants liés
 * (device.artistId) ∪ ids historiques (clés inverses, y compris d'appareils
 * supprimés/ré-enregistrés — leurs blocs minés restent au profil).
 */
export async function getArtistDeviceIds(artistId: string, devices?: Device[]): Promise<Set<string>> {
  const [all, reverse] = await Promise.all([devices ?? getAllDevices(), readReverseLinks()]);
  const ids = new Set<string>();
  for (const d of all) if (d.artistId === artistId) ids.add(d.deviceId);
  for (const [deviceId, aid] of reverse) if (aid === artistId) ids.add(deviceId);
  return ids;
}

/** Profil artiste auquel appartient un appareil (clé inverse d'abord, sinon device.artistId), s'il existe encore. */
export async function resolveArtistIdForDevices(deviceIds: string[], devices?: Device[]): Promise<string | null> {
  if (deviceIds.length === 0) return null;
  const all = devices ?? (await getAllDevices());
  const byId = new Map(all.map((d) => [d.deviceId, d]));
  for (const id of deviceIds) {
    const rev = await redis.get<string>(`artist:device:${id}`);
    const aid = rev ? String(rev) : byId.get(id)?.artistId;
    if (aid && (await getArtist(aid))) return aid;
  }
  return null;
}

// ─── Annuaire ─────────────────────────────────────────────────────────────────

/**
 * Liste complète des artistes : profils réellement existants + un artiste
 * implicite par ESP nommé sans profil valide. Nettoie au passage les ids
 * orphelins de artists:all (profil expiré/supprimé). Tri : plus récent d'abord.
 */
export async function listArtists(): Promise<ArtistEntry[]> {
  const [ids, devices] = await Promise.all([
    redis.smembers(ARTISTS_ALL).then((r) => (r as string[]) ?? []),
    getAllDevices(),
  ]);

  const loaded = await Promise.all(ids.map(async (id) => [id, await getArtist(id)] as const));
  const stale  = loaded.filter(([, p]) => !p).map(([id]) => id);
  if (stale.length > 0) redis.srem(ARTISTS_ALL, ...stale).catch(() => {}); // nettoyage opportuniste
  const profiles = loaded.map(([, p]) => p).filter((p): p is ArtistProfile => !!p);

  const validIds = new Set(profiles.map((p) => p.artistId));

  const entries: ArtistEntry[] = profiles.map((profile) => {
    const live = devices.filter((d) => d.artistId === profile.artistId).map((d) => d.deviceId);
    return { profile, implicit: false, deviceIds: live, deviceCount: live.length };
  });

  // ESP nommés dont le profil est absent (jamais rattachés OU profil expiré) → artiste implicite
  for (const d of devices) {
    const orphanLink = !!d.artistId && !validIds.has(d.artistId);
    if (isImplicitArtistDevice(d) || (orphanLink && d.artistName?.trim())) {
      entries.push({ profile: implicitArtistProfile(d), implicit: true, deviceIds: [d.deviceId], deviceCount: 1 });
    }
  }

  return entries.sort((a, b) => b.profile.createdAt - a.profile.createdAt);
}

export { IMPLICIT_ARTIST_PREFIX };

// ─── Blocs d'un artiste ───────────────────────────────────────────────────────

export interface ArtistBlock {
  blockHash:      string;
  blockIndex:     number;
  imageHash:      string;
  workTitle?:     string;
  artistName:     string;
  drawArtistName?: string;
  poolScreen:     string;
  score:          number;
  drawScore:      number;
  minedAt:        number;
  displayTime:    number;
  validatorIds:   string[];
  isArtist:       boolean;  // dessiné par un appareil de l'artiste
  isMiner:        boolean;  // miné (vote décisif) par un appareil de l'artiste
  isOwner:        boolean;  // actuellement possédé par un appareil de l'artiste
  imagePayload:   BlockImagePayload | null;
}

/**
 * Blocs liés à un ensemble d'appareils (dessinés, minés ou possédés), du plus
 * récent au plus ancien. Sources unifiées : listes permanentes par appareil
 * (chain:device:{id}:blocks|drawn|owned) ∪ fenêtre chain:recent — plus de dépendance
 * aux 100 derniers blocs seulement.
 */
export async function getArtistBlocks(deviceIds: Set<string>, limit = BLOCKS_MAX): Promise<ArtistBlock[]> {
  if (deviceIds.size === 0) return [];
  const ids = [...deviceIds];

  const [recent, perDevice] = await Promise.all([
    redis.lrange<string>("chain:recent", 0, 99),
    Promise.all(ids.map(async (id) => {
      const [mined, drawn, owned] = await Promise.all([
        redis.lrange<string>(`chain:device:${id}:blocks`, 0, 99),
        redis.lrange<string>(`chain:device:${id}:drawn`, 0, 99),
        redis.smembers(`chain:device:${id}:owned`) as Promise<string[]>,
      ]);
      return [...(mined ?? []), ...(drawn ?? []), ...(owned ?? [])];
    })),
  ]);

  const hashes = [...new Set([...(recent ?? []), ...perDevice.flat()])];

  const rows = await Promise.all(hashes.map(async (hash) => {
    try {
      const b = await getBlockByHash(hash);
      if (!b) return null;
      const isArtist = deviceIds.has(b.deviceId);
      const isMiner  = !!b.minerDeviceId && deviceIds.has(b.minerDeviceId);
      const isOwner  = !!b.ownerDeviceId && deviceIds.has(b.ownerDeviceId);
      if (!isArtist && !isMiner && !isOwner) return null;
      return { b, isArtist, isMiner, isOwner };
    } catch { return null; }
  }));

  const top = rows
    .filter((r): r is { b: Block; isArtist: boolean; isMiner: boolean; isOwner: boolean } => !!r)
    .sort((x, y) => y.b.minedAt - x.b.minedAt)
    .slice(0, limit);

  return Promise.all(top.map(async ({ b, isArtist, isMiner, isOwner }): Promise<ArtistBlock> => ({
    blockHash: b.blockHash, blockIndex: b.blockIndex, imageHash: b.imageHash,
    workTitle: b.workTitle, artistName: b.artistName, drawArtistName: b.drawArtistName,
    poolScreen: b.poolScreen, score: b.score, drawScore: b.drawScore, minedAt: b.minedAt,
    displayTime: b.displayTime, validatorIds: b.validatorIds,
    isArtist, isMiner, isOwner,
    imagePayload: (await getBlockImage(b.blockHash)) ?? null,
  })));
}

/** Image de profil résolue DIRECTEMENT par son hash (indépendante de toute fenêtre de blocs). */
export async function getProfileImagePayload(profile: ArtistProfile): Promise<BlockImagePayload | null> {
  if (!profile.profileImageBlockHash) return null;
  return (await getBlockImage(profile.profileImageBlockHash)) ?? null;
}
