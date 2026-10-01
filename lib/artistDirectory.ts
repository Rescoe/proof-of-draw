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
  linkDeviceToArtist, setArtistName, setDeviceName, getDevice, createOrUpdateArtist,
  IMPLICIT_ARTIST_PREFIX, type ArtistProfile, type Device,
} from "@/lib/deviceStore";
import type { SessionData } from "@/lib/session";
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

/**
 * Profil artiste de la session : celui du cookie, sinon celui d'un appareil de la session
 * (clé inverse / device.artistId), s'il existe encore. null = cette session n'a pas de profil.
 */
export async function resolveSessionArtist(session: SessionData, devices?: Device[]): Promise<ArtistProfile | null> {
  if (session.artistId) {
    const p = await getArtist(session.artistId);
    if (p) return p;
  }
  const id = await resolveArtistIdForDevices(session.deviceIds, devices);
  return id ? getArtist(id) : null;
}

/**
 * Garantit qu'une session qui possède des ESP a un profil artiste, sans rien demander :
 *  • profil existant (cookie ou ESP) → les ESP de la session sans profil le rejoignent ;
 *  • aucun profil → il est créé avec le nom du plus ancien ESP nommé de la session.
 * Ne reprend jamais un ESP déjà rattaché à un autre profil. null = session sans ESP nommé.
 */
export async function ensureSessionProfile(session: SessionData): Promise<ArtistProfile | null> {
  if (session.deviceIds.length === 0) return null;
  const devices = (await Promise.all(session.deviceIds.map((id) => getDevice(id)))).filter((d): d is Device => !!d);
  let profile = await resolveSessionArtist(session, devices);
  if (!profile) {
    const first = devices.filter((d) => !d.artistId && d.artistName?.trim()).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!first) return null;
    profile = await createOrUpdateArtist(first.artistName!.trim());
  }
  // Un ESP libéré (don) n'a plus de nom : il ne doit pas être ré-attaché par une ancienne session
  for (const d of devices) if (!d.artistId && d.artistName?.trim()) await attachDeviceToProfile(d.deviceId, profile, d);
  return profile;
}

/**
 * Rattache UN appareil à un profil : lien durable (device.artistId + clé inverse) et nom
 * d'artiste du profil. Le nom d'origine ("Roubzi Tft") devient le nom de l'appareil pour ne
 * pas être perdu. Rattachement AUTOMATIQUE (défaut) : ne reprend jamais un appareil déjà
 * rattaché à un AUTRE profil → false. `force` = choix explicite de l'utilisateur sur son appareil.
 */
export async function attachDeviceToProfile(
  deviceId: string, profile: ArtistProfile, device: Device, opts: { force?: boolean } = {},
): Promise<boolean> {
  if (!opts.force && device.artistId && device.artistId !== profile.artistId) return false;
  if (!device.deviceName && device.artistName && device.artistName !== profile.displayName) {
    await setDeviceName(deviceId, device.artistName);
  }
  await linkDeviceToArtist(deviceId, profile.artistId);
  await setArtistName(deviceId, profile.displayName);
  return true;
}

// ─── Annuaire ─────────────────────────────────────────────────────────────────

/**
 * Liste complète des artistes : profils réellement existants + un artiste
 * implicite par ESP nommé sans profil valide. Nettoie au passage les ids
 * orphelins de artists:all (profil expiré/supprimé). Tri : plus récent d'abord.
 * Un ESP rattaché à un profil n'est JAMAIS un artiste à part : il compte dans
 * deviceCount de son profil (même si l'id du profil manquait dans artists:all).
 */
export async function listArtists(): Promise<ArtistEntry[]> {
  const [ids, devices] = await Promise.all([
    redis.smembers(ARTISTS_ALL).then((r) => (r as string[]) ?? []),
    getAllDevices(),
  ]);

  // Profils référencés par un appareil mais absents de artists:all : on les relit
  // directement (et on répare l'index) plutôt que de transformer leurs ESP en artistes.
  const known    = new Set(ids);
  const linked   = [...new Set(devices.map((d) => d.artistId).filter((id): id is string => !!id && !known.has(id)))];
  const allIds   = [...ids, ...linked];

  const loaded = await Promise.all(allIds.map(async (id) => [id, await getArtist(id)] as const));
  const stale  = loaded.filter(([id, p]) => !p && known.has(id)).map(([id]) => id);
  if (stale.length > 0) redis.srem(ARTISTS_ALL, ...stale).catch(() => {}); // nettoyage opportuniste
  const healed = loaded.filter(([id, p]) => !!p && !known.has(id)).map(([id]) => id);
  if (healed.length > 0) redis.sadd(ARTISTS_ALL, healed[0], ...healed.slice(1)).catch(() => {});
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
export async function getArtistBlocks(deviceIds: Set<string>, limit = BLOCKS_MAX, artistId?: string): Promise<ArtistBlock[]> {
  const retainedHere = artistId ? ((await redis.smembers(`artist:retained:${artistId}`)) as string[]) : [];
  if (deviceIds.size === 0 && retainedHere.length === 0) return [];
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

  const hashes = [...new Set([...(recent ?? []), ...perDevice.flat(), ...retainedHere])];

  // Œuvres « conservées » lors du don d'un ESP : elles restent au profil qui les a gardées
  // et disparaissent de la vue du nouveau propriétaire de l'appareil.
  const keepers = hashes.length
    ? await redis.mget<(string | null)[]>(...hashes.map((h) => `chain:retained:${h}`))
    : [];
  const keptBy = new Map<string, string>();
  hashes.forEach((h, i) => { if (keepers[i]) keptBy.set(h, String(keepers[i])); });

  const rows = await Promise.all(hashes.map(async (hash) => {
    try {
      const b = await getBlockByHash(hash);
      if (!b) return null;
      const isArtist = deviceIds.has(b.deviceId);
      const isMiner  = !!b.minerDeviceId && deviceIds.has(b.minerDeviceId);
      const keeper   = keptBy.get(hash);
      if (keeper && keeper !== artistId) return null;
      const isOwner  = (!!b.ownerDeviceId && deviceIds.has(b.ownerDeviceId)) || !!keeper;
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

/** Hashes de tous les blocs liés à UN appareil (dessinés, minés ou possédés par lui). */
export async function relatedBlockHashes(deviceId: string): Promise<Set<string>> {
  const [mined, drawn, owned] = await Promise.all([
    redis.lrange<string>(`chain:device:${deviceId}:blocks`, 0, 499),
    redis.lrange<string>(`chain:device:${deviceId}:drawn`, 0, 499),
    redis.smembers(`chain:device:${deviceId}:owned`) as Promise<string[]>,
  ]);
  return new Set([...(mined ?? []), ...(drawn ?? []), ...(owned ?? [])]);
}

/** Image de profil résolue DIRECTEMENT par son hash (indépendante de toute fenêtre de blocs). */
export async function getProfileImagePayload(profile: ArtistProfile): Promise<BlockImagePayload | null> {
  if (!profile.profileImageBlockHash) return null;
  return (await getBlockImage(profile.profileImageBlockHash)) ?? null;
}
