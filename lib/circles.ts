// lib/circles.ts — CERCLES PRIVÉS d'artistes (MVP : cercles, invitations, droits, messages TEXTE bornés ; AUCUN média binaire).
//
// Règles non négociables (décisions du porteur, 26/10/2026) :
//   • un cercle a UN propriétaire et des membres ; personne n'y entre SANS CONSENTEMENT : seule la session de l'invité peut accepter ;
//   • un membre peut quitter ; le propriétaire peut retirer un membre, annuler une invitation ou supprimer le cercle ;
//   • TOUTES les lectures et écritures sont vérifiées ICI, côté serveur, sur l'identité d'artiste de la session — l'interface ne protège rien ;
//   • un non-membre reçoit EXACTEMENT la même réponse (404) qu'un cercle inexistant : rien ne se déduit de la requête ;
//   • aucun contenu de cercle n'apparaît dans la galerie, la carte publique, les recherches ou les flux : ce module n'est importé que par les routes /api/circles (testé) ;
//   • rien d'un cercle n'entre dans un bloc ni dans le consensus.
//
// Logique PURE sur une interface `CircleKV` (les routes fournissent l'adaptateur Upstash, les tests une mémoire) : aucune horloge ni hasard implicites (`now`, `newId` injectés).
//
// Clés Redis (aucune sans borne) :
//   circle:{id}             JSON {id,name,ownerId,ownerName,createdAt}           TTL 365 j renouvelé à chaque écriture du cercle
//   circle:{id}:members     HASH artistId → nom au moment de l'adhésion          idem (≤ MAX_MEMBERS)
//   circle:{id}:pending     HASH invitéId → JSON {name,at}                        TTL 30 j (≤ MAX_PENDING), lecture réservée au propriétaire
//   circle:{id}:msgs        LIST de JSON {id,at,authorId,authorName,text}         50 derniers, TTL 90 j
//   artist:circles:{id}     SET des cercles de l'artiste                          TTL 365 j (≤ MAX_JOINED)
//   circle:invites:{id}     HASH circleId → JSON {circleName,fromId,fromName,at}  TTL 30 j (≤ MAX_INVITES_PER_ARTIST)
//   rl:circle:{action}:{artistId}  compteurs de débit avec fenêtre
// Invitations EXPIRÉES (30 j) : jamais affichées, jamais comptées dans un plafond ; chaque lecture qui les rencontre les retire DES DEUX côtés (circle:{id}:pending ET circle:invites:{invité}).
// Le TTL d'un HASH est renouvelé par chaque nouvelle invitation : il ne purge donc pas une entrée ancienne ; c'est la date `at` de chaque entrée qui fait foi. Nettoyage borné par les plafonds (≤ MAX_PENDING + entrées périmées
// déjà présentes), jamais de SCAN ni de KEYS.
// Concurrence : accepter et inviter prennent un VERROU COURT par cercle (`lock:circle:{id}`, SET NX EX 10 s, jeton propre, tentative UNIQUE : occupé = 409 « réessaie », échec FERMÉ) pour que deux acceptations
// simultanées ne dépassent pas MAX_MEMBERS. Course restante, assumée : plafonds PAR ARTISTE (MAX_OWNED / MAX_JOINED) si le MÊME artiste crée ou accepte deux cercles en même temps (dépassement de 1, sans effet sur les droits).
// Coût Redis : AUCUNE écriture ni lecture hors action de l'utilisateur ; aucun sondage. Liste « mes cercles » ≈ 4 commandes ; ouvrir un cercle = 2 à 4 ; publier un message = 6.

export const MAX_MEMBERS = 12;
export const MAX_PENDING = 10;
export const MAX_OWNED = 5;
export const MAX_JOINED = 10;
export const MAX_INVITES_PER_ARTIST = 20;
export const NAME_MIN = 2, NAME_MAX = 40;
export const MESSAGE_MAX = 280;
export const MESSAGES_KEPT = 50;
export const TTL_CIRCLE_SEC = 365 * 86400;
export const TTL_INVITE_SEC = 30 * 86400;
export const TTL_MESSAGES_SEC = 90 * 86400;
/** Débits : [action, limite, fenêtre en secondes] */
export const RATE = {
  create: { limit: 5, windowSec: 86400 },
  invite: { limit: 10, windowSec: 3600 },
  message: { limit: 10, windowSec: 600 },
} as const;

export const circleKey = (id: string) => `circle:${id}`;
export const membersKey = (id: string) => `circle:${id}:members`;
export const pendingKey = (id: string) => `circle:${id}:pending`;
export const msgsKey = (id: string) => `circle:${id}:msgs`;
export const joinedKey = (artistId: string) => `artist:circles:${artistId}`;
export const invitesKey = (artistId: string) => `circle:invites:${artistId}`;
export const lockKey = (id: string) => `lock:circle:${id}`;
export const LOCK_TTL_SEC = 10;
export const rateKey = (action: string, artistId: string) => `rl:circle:${action}:${artistId}`;

export const CIRCLE_ID_RE = /^[0-9a-f]{20}$/;
export const ARTIST_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export interface CircleKV {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, exSec?: number): Promise<void>;
  del(...ks: string[]): Promise<void>;
  sadd(k: string, m: string): Promise<void>;
  srem(k: string, m: string): Promise<void>;
  smembers(k: string): Promise<string[]>;
  hset(k: string, f: string, v: string): Promise<void>;
  hget(k: string, f: string): Promise<string | null>;
  hdel(k: string, f: string): Promise<void>;
  hgetall(k: string): Promise<Record<string, string>>;
  lpush(k: string, v: string): Promise<void>;
  ltrim(k: string, start: number, stop: number): Promise<void>;
  lrange(k: string, start: number, stop: number): Promise<string[]>;
  expire(k: string, sec: number): Promise<void>;
  /** SET NX EX : true si la clé a été posée (verrou obtenu), false si elle existait déjà */
  setnx(k: string, v: string, exSec: number): Promise<boolean>;
  /** INCR puis EXPIRE (NX) : retourne la valeur du compteur */
  incr(k: string, windowSec: number): Promise<number>;
}

export class CircleError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new CircleError(status, code, message); };
/** 404 unique pour « n'existe pas » ET « tu n'en fais pas partie » : jamais d'indice. */
const notFound = (): never => fail(404, "not_found", "Cercle introuvable.");

export interface Me { artistId: string; displayName: string }
export interface Clock { now: () => number; newId: () => string }
export interface ArtistLookup { (artistId: string): Promise<{ artistId: string; displayName: string } | null> }

export interface CircleMeta { id: string; name: string; ownerId: string; ownerName: string; createdAt: number }
export interface Invite { circleId: string; circleName: string; fromId: string; fromName: string; at: number }
export interface CircleMessage { id: string; at: number; authorId: string; authorName: string; text: string }

// ── Validation ───────────────────────────────────────────────────────────────
/** Texte d'affichage : sans caractères de contrôle ni espaces multiples ; longueur bornée. Retourne null si hors limites. */
export function cleanText(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex -- retrait volontaire des caractères de contrôle
  const t = raw.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= min && t.length <= max ? t : null;
}
export const cleanName = (raw: unknown) => cleanText(raw, NAME_MIN, NAME_MAX);
export const cleanMessage = (raw: unknown) => cleanText(raw, 1, MESSAGE_MAX);
export const isCircleId = (s: unknown): s is string => typeof s === "string" && CIRCLE_ID_RE.test(s);
export const isArtistId = (s: unknown): s is string => typeof s === "string" && ARTIST_ID_RE.test(s);

function parse<T>(raw: string | null): T | null { if (!raw) return null; try { return JSON.parse(raw) as T; } catch { return null; } }

async function rateLimit(kv: CircleKV, action: keyof typeof RATE, artistId: string) {
  const { limit, windowSec } = RATE[action];
  if ((await kv.incr(rateKey(action, artistId), windowSec)) > limit) fail(429, "rate_limited", "Trop d'actions en peu de temps : réessaie plus tard.");
}

const expired = (at: number, clock: Clock) => !(typeof at === "number") || clock.now() - at > TTL_INVITE_SEC * 1000;

/** Invitations en attente d'un cercle SANS les périmées ; celles-ci sont retirées des deux index (pending du cercle + invitation chez l'invité). Coût : 1 HGETALL + 2 HDEL par entrée périmée (borné par les plafonds). */
async function freshPending(kv: CircleKV, circleId: string, clock: Clock): Promise<Record<string, { name: string; at: number }>> {
  const raw = await kv.hgetall(pendingKey(circleId));
  const out: Record<string, { name: string; at: number }> = {};
  for (const [artistId, v] of Object.entries(raw)) {
    const p = parse<{ name: string; at: number }>(v);
    if (!p || expired(p.at, clock)) { await kv.hdel(pendingKey(circleId), artistId); await kv.hdel(invitesKey(artistId), circleId); continue; }
    out[artistId] = p;
  }
  return out;
}
/** Invitations reçues par un artiste SANS les périmées (retirées des deux index). */
async function freshInvites(kv: CircleKV, artistId: string, clock: Clock): Promise<Record<string, Omit<Invite, "circleId">>> {
  const raw = await kv.hgetall(invitesKey(artistId));
  const out: Record<string, Omit<Invite, "circleId">> = {};
  for (const [circleId, v] of Object.entries(raw)) {
    const inv = parse<Omit<Invite, "circleId">>(v);
    if (!inv || expired(inv.at, clock)) { await kv.hdel(invitesKey(artistId), circleId); await kv.hdel(pendingKey(circleId), artistId); continue; }
    out[circleId] = inv;
  }
  return out;
}

/** Verrou court par cercle : une seule tentative, échec FERMÉ (409), libéré dans tous les cas (le TTL de 10 s couvre un plantage). */
async function withLock<T>(kv: CircleKV, circleId: string, clock: Clock, fn: () => Promise<T>): Promise<T> {
  const token = clock.newId();
  if (!(await kv.setnx(lockKey(circleId), token, LOCK_TTL_SEC))) return fail(409, "circle_busy", "Le cercle est en cours de modification : réessaie dans un instant.");
  try { return await fn(); }
  finally { if ((await kv.get(lockKey(circleId))) === token) await kv.del(lockKey(circleId)); }
}

async function loadMeta(kv: CircleKV, id: string): Promise<CircleMeta | null> { return parse<CircleMeta>(await kv.get(circleKey(id))); }

/** Garde de DROIT : l'appelant doit être membre ; sinon 404 (identique à « inexistant »). Source de vérité = le HASH des membres. */
async function requireMember(kv: CircleKV, me: Me, id: unknown): Promise<{ meta: CircleMeta; isOwner: boolean }> {
  if (!isCircleId(id)) return notFound();
  const [meta, mine] = await Promise.all([loadMeta(kv, id), kv.hget(membersKey(id), me.artistId)]);
  if (!meta || mine === null) return notFound();
  return { meta, isOwner: meta.ownerId === me.artistId };
}
async function requireOwner(kv: CircleKV, me: Me, id: unknown) {
  const r = await requireMember(kv, me, id);
  if (!r.isOwner) fail(403, "owner_only", "Seul le propriétaire du cercle peut faire cela.");
  return r.meta;
}
async function touch(kv: CircleKV, id: string) { await Promise.all([kv.expire(circleKey(id), TTL_CIRCLE_SEC), kv.expire(membersKey(id), TTL_CIRCLE_SEC)]); }

// ── Cercles ──────────────────────────────────────────────────────────────────
export async function createCircle(kv: CircleKV, me: Me, nameRaw: unknown, clock: Clock): Promise<CircleMeta> {
  const name = cleanName(nameRaw);
  if (!name) fail(400, "invalid_name", `Le nom du cercle doit faire ${NAME_MIN} à ${NAME_MAX} caractères.`);
  await rateLimit(kv, "create", me.artistId);
  const mine = await listMine(kv, me, clock);
  if (mine.circles.filter((c) => c.isOwner).length >= MAX_OWNED) fail(409, "too_many_owned", `Tu peux posséder ${MAX_OWNED} cercles au plus.`);
  if (mine.circles.length >= MAX_JOINED) fail(409, "too_many_circles", `Tu peux appartenir à ${MAX_JOINED} cercles au plus.`);
  const id = clock.newId();
  const meta: CircleMeta = { id, name: name as string, ownerId: me.artistId, ownerName: me.displayName, createdAt: clock.now() };
  await kv.set(circleKey(id), JSON.stringify(meta), TTL_CIRCLE_SEC);
  await kv.hset(membersKey(id), me.artistId, me.displayName);
  await kv.expire(membersKey(id), TTL_CIRCLE_SEC);
  await kv.sadd(joinedKey(me.artistId), id);
  await kv.expire(joinedKey(me.artistId), TTL_CIRCLE_SEC);
  return meta;
}

export interface CircleSummary { id: string; name: string; ownerName: string; isOwner: boolean; memberCount: number }
/** Mes cercles (ceux dont je suis réellement membre) et mes invitations en attente. Les index orphelins sont nettoyés au passage. */
export async function listMine(kv: CircleKV, me: Me, clock: Clock): Promise<{ circles: CircleSummary[]; invites: Invite[] }> {
  const ids = (await kv.smembers(joinedKey(me.artistId))).filter(isCircleId);
  const rows = await Promise.all(ids.map(async (id) => {
    const [meta, members] = await Promise.all([loadMeta(kv, id), kv.hgetall(membersKey(id))]);
    return { id, meta, members };
  }));
  const circles: CircleSummary[] = [];
  for (const r of rows) {
    if (!r.meta || !(me.artistId in r.members)) { await kv.srem(joinedKey(me.artistId), r.id); continue; }   // cercle supprimé ou retrait : index nettoyé
    circles.push({ id: r.id, name: r.meta.name, ownerName: r.meta.ownerName, isOwner: r.meta.ownerId === me.artistId, memberCount: Object.keys(r.members).length });
  }
  const fresh = await freshInvites(kv, me.artistId, clock);
  const invites: Invite[] = Object.entries(fresh).map(([circleId, inv]) => ({ circleId, ...inv }));
  circles.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  invites.sort((a, b) => b.at - a.at);
  return { circles, invites };
}

export interface CircleView {
  id: string; name: string; ownerId: string; isOwner: boolean;
  members: { artistId: string; name: string; isOwner: boolean }[];
  /** invitations en attente : visibles du SEUL propriétaire */
  pending: { artistId: string; name: string; at: number }[] | null;
}
export async function getCircle(kv: CircleKV, me: Me, id: unknown, clock: Clock): Promise<CircleView> {
  const { meta, isOwner } = await requireMember(kv, me, id);
  const members = await kv.hgetall(membersKey(meta.id));
  let pending: CircleView["pending"] = null;
  if (isOwner) {
    const raw = await freshPending(kv, meta.id, clock);
    pending = Object.entries(raw).map(([artistId, p]) => ({ artistId, name: p.name, at: p.at })).sort((a, b) => b.at - a.at);
  }
  return {
    id: meta.id, name: meta.name, ownerId: meta.ownerId, isOwner,
    members: Object.entries(members).map(([artistId, name]) => ({ artistId, name, isOwner: artistId === meta.ownerId })).sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name, "fr")),
    pending,
  };
}

// ── Invitations ──────────────────────────────────────────────────────────────
/** Le PROPRIÉTAIRE invite un autre artiste (profil réel). L'invité n'est PAS ajouté : il doit accepter. */
export async function inviteArtist(kv: CircleKV, me: Me, id: unknown, targetId: unknown, lookup: ArtistLookup, clock: Clock): Promise<void> {
  const meta = await requireOwner(kv, me, id);
  if (!isArtistId(targetId)) fail(400, "invalid_artist", "Artiste invalide.");
  const target = await lookup(targetId as string);
  if (!target) fail(404, "unknown_artist", "Cet artiste n'a pas de profil : il ne peut pas être invité.");
  const t = target as { artistId: string; displayName: string };
  if (t.artistId === me.artistId) fail(400, "self_invite", "Tu fais déjà partie de ce cercle.");
  await rateLimit(kv, "invite", me.artistId);
  await withLock(kv, meta.id, clock, async () => {
    const [members, pending, invites] = await Promise.all([kv.hgetall(membersKey(meta.id)), freshPending(kv, meta.id, clock), freshInvites(kv, t.artistId, clock)]);   // périmées retirées, jamais comptées
    if (t.artistId in members) fail(409, "already_member", `${t.displayName} fait déjà partie du cercle.`);
    if (t.artistId in pending) fail(409, "already_invited", `${t.displayName} a déjà une invitation en attente.`);
    if (Object.keys(members).length + Object.keys(pending).length >= MAX_MEMBERS) fail(409, "circle_full", `Un cercle compte ${MAX_MEMBERS} membres au plus (invitations en attente comprises).`);
    if (Object.keys(pending).length >= MAX_PENDING) fail(409, "too_many_pending", `${MAX_PENDING} invitations en attente au plus.`);
    if (Object.keys(invites).length >= MAX_INVITES_PER_ARTIST) fail(409, "invitee_busy", "Cet artiste a déjà beaucoup d'invitations en attente.");
    const at = clock.now();
    await kv.hset(invitesKey(t.artistId), meta.id, JSON.stringify({ circleName: meta.name, fromId: me.artistId, fromName: me.displayName, at }));
    await kv.expire(invitesKey(t.artistId), TTL_INVITE_SEC);
    await kv.hset(pendingKey(meta.id), t.artistId, JSON.stringify({ name: t.displayName, at }));
    await kv.expire(pendingKey(meta.id), TTL_INVITE_SEC);
  });
}

/** Le propriétaire annule une invitation en attente. */
export async function cancelInvite(kv: CircleKV, me: Me, id: unknown, targetId: unknown): Promise<void> {
  const meta = await requireOwner(kv, me, id);
  if (!isArtistId(targetId)) fail(400, "invalid_artist", "Artiste invalide.");
  await kv.hdel(pendingKey(meta.id), targetId as string);
  await kv.hdel(invitesKey(targetId as string), meta.id);
}

/** L'INVITÉ accepte ou refuse. Seul l'artiste de la session peut répondre à SES invitations ; sans invitation valide : 404 (même réponse qu'un cercle inconnu). */
export async function respondInvite(kv: CircleKV, me: Me, id: unknown, accept: boolean, clock: Clock): Promise<void> {
  if (!isCircleId(id)) return notFound();
  const raw = await kv.hget(invitesKey(me.artistId), id);
  const inv = parse<Omit<Invite, "circleId">>(raw);
  if (!inv || expired(inv.at, clock)) {
    if (raw) { await kv.hdel(invitesKey(me.artistId), id); await kv.hdel(pendingKey(id), me.artistId); }   // périmée : retirée DES DEUX côtés
    return notFound();
  }
  if (!accept) { await kv.hdel(invitesKey(me.artistId), id); await kv.hdel(pendingKey(id), me.artistId); return; }
  await withLock(kv, id, clock, async () => {
    const meta = await loadMeta(kv, id);
    if (!meta) { await kv.hdel(invitesKey(me.artistId), id); return notFound(); }   // cercle supprimé entre-temps
    const members = await kv.hgetall(membersKey(id));
    if (me.artistId in members) { await kv.hdel(invitesKey(me.artistId), id); await kv.hdel(pendingKey(id), me.artistId); return; }   // déjà membre : idempotent
    if (Object.keys(members).length >= MAX_MEMBERS) fail(409, "circle_full", "Ce cercle est complet.");
    const joined = (await kv.smembers(joinedKey(me.artistId))).filter(isCircleId);
    if (joined.length >= MAX_JOINED) fail(409, "too_many_circles", `Tu peux appartenir à ${MAX_JOINED} cercles au plus : quitte-en un d'abord.`);
    await kv.hset(membersKey(id), me.artistId, me.displayName);
    await kv.sadd(joinedKey(me.artistId), id);
    await kv.expire(joinedKey(me.artistId), TTL_CIRCLE_SEC);
    await kv.hdel(invitesKey(me.artistId), id);
    await kv.hdel(pendingKey(id), me.artistId);
    await touch(kv, id);
  });
}

// ── Départ, retrait, suppression ─────────────────────────────────────────────
export async function leaveCircle(kv: CircleKV, me: Me, id: unknown): Promise<void> {
  const { meta, isOwner } = await requireMember(kv, me, id);
  if (isOwner) fail(409, "owner_cannot_leave", "Le propriétaire ne peut pas quitter son cercle : supprime-le.");
  await kv.hdel(membersKey(meta.id), me.artistId);
  await kv.srem(joinedKey(me.artistId), meta.id);
}

export async function removeMember(kv: CircleKV, me: Me, id: unknown, targetId: unknown): Promise<void> {
  const meta = await requireOwner(kv, me, id);
  if (!isArtistId(targetId)) fail(400, "invalid_artist", "Artiste invalide.");
  if (targetId === meta.ownerId) fail(409, "cannot_remove_owner", "Le propriétaire ne peut pas être retiré.");
  const there = await kv.hget(membersKey(meta.id), targetId as string);
  if (there === null) fail(404, "not_a_member", "Cet artiste ne fait pas partie du cercle.");
  await kv.hdel(membersKey(meta.id), targetId as string);
  await kv.srem(joinedKey(targetId as string), meta.id);
}

/** Suppression définitive : propriétaire seul, nom retapé. Retire le cercle de l'index de chaque membre et annule les invitations en attente. */
export async function deleteCircle(kv: CircleKV, me: Me, id: unknown, confirmName: unknown): Promise<void> {
  const meta = await requireOwner(kv, me, id);
  if (typeof confirmName !== "string" || confirmName.trim() !== meta.name) fail(400, "confirm_mismatch", "Retape exactement le nom du cercle pour le supprimer.");
  const [members, pending] = await Promise.all([kv.hgetall(membersKey(meta.id)), kv.hgetall(pendingKey(meta.id))]);
  for (const m of Object.keys(members)) await kv.srem(joinedKey(m), meta.id);
  for (const p of Object.keys(pending)) await kv.hdel(invitesKey(p), meta.id);
  await kv.del(circleKey(meta.id), membersKey(meta.id), pendingKey(meta.id), msgsKey(meta.id));
}

// ── Messages texte (bornés) ──────────────────────────────────────────────────
export async function postMessage(kv: CircleKV, me: Me, id: unknown, textRaw: unknown, clock: Clock): Promise<CircleMessage> {
  const { meta } = await requireMember(kv, me, id);
  const text = cleanMessage(textRaw);
  if (!text) fail(400, "invalid_message", `Le message doit faire 1 à ${MESSAGE_MAX} caractères.`);
  await rateLimit(kv, "message", me.artistId);
  const msg: CircleMessage = { id: clock.newId(), at: clock.now(), authorId: me.artistId, authorName: me.displayName, text: text as string };
  await kv.lpush(msgsKey(meta.id), JSON.stringify(msg));
  await kv.ltrim(msgsKey(meta.id), 0, MESSAGES_KEPT - 1);
  await kv.expire(msgsKey(meta.id), TTL_MESSAGES_SEC);
  return msg;
}

export async function listMessages(kv: CircleKV, me: Me, id: unknown): Promise<CircleMessage[]> {
  const { meta } = await requireMember(kv, me, id);
  const raws = await kv.lrange(msgsKey(meta.id), 0, MESSAGES_KEPT - 1);
  return raws.flatMap((r) => { const m = parse<CircleMessage>(r); return m ? [m] : []; });
}
