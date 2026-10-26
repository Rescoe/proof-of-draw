import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CircleError, MAX_JOINED, MAX_MEMBERS, MAX_OWNED, MAX_PENDING, MESSAGES_KEPT, MESSAGE_MAX, RATE, TTL_CIRCLE_SEC, TTL_INVITE_SEC, TTL_MESSAGES_SEC,
  cancelInvite, cleanMessage, cleanName, createCircle, deleteCircle, getCircle, inviteArtist, leaveCircle, listMessages, listMine, postMessage, removeMember, respondInvite,
  circleKey, invitesKey, joinedKey, membersKey, msgsKey, pendingKey,
  type ArtistLookup, type CircleKV, type Clock, type Me,
} from "../lib/circles";

/** Mémoire minimale qui respecte la sémantique des commandes Redis utilisées ; enregistre les TTL posés. */
function memoryKV() {
  const str = new Map<string, string>(), sets = new Map<string, Set<string>>(), hashes = new Map<string, Map<string, string>>(), lists = new Map<string, string[]>(), counters = new Map<string, number>();
  const ttl = new Map<string, number>();
  const kv: CircleKV = {
    async get(k) { return str.get(k) ?? null; },
    async set(k, v, ex) { str.set(k, v); if (ex) ttl.set(k, ex); },
    async del(...ks) { for (const k of ks) { str.delete(k); sets.delete(k); hashes.delete(k); lists.delete(k); ttl.delete(k); } },
    async sadd(k, m) { (sets.get(k) ?? sets.set(k, new Set()).get(k)!).add(m); },
    async srem(k, m) { sets.get(k)?.delete(m); },
    async smembers(k) { return [...(sets.get(k) ?? [])]; },
    async hset(k, f, v) { (hashes.get(k) ?? hashes.set(k, new Map()).get(k)!).set(f, v); },
    async hget(k, f) { return hashes.get(k)?.get(f) ?? null; },
    async hdel(k, f) { hashes.get(k)?.delete(f); },
    async hgetall(k) { return Object.fromEntries(hashes.get(k) ?? []); },
    async lpush(k, v) { (lists.get(k) ?? lists.set(k, []).get(k)!).unshift(v); },
    async ltrim(k, a, b) { const l = lists.get(k); if (l) lists.set(k, l.slice(a, b + 1)); },
    async lrange(k, a, b) { return (lists.get(k) ?? []).slice(a, b + 1); },
    async expire(k, sec) { ttl.set(k, sec); },
    async setnx(k, v, ex) { if (str.has(k)) return false; str.set(k, v); ttl.set(k, ex); return true; },
    async incr(k, windowSec) { const n = (counters.get(k) ?? 0) + 1; counters.set(k, n); if (!ttl.has(k)) ttl.set(k, windowSec); return n; },
  };
  return { kv, ttl, str, sets, hashes, lists, counters };
}
let t = 1_800_000_000_000, n = 0;
const clock: Clock = { now: () => (t += 1000), newId: () => (++n).toString(16).padStart(20, "0") };
const artists: Record<string, string> = { zoe: "Zoé", ana: "Ana", bob: "Bob", eve: "Eve", mia: "Mia" };
const id4 = (k: string) => `a_${k}_0001`;   // identifiants valides (≥ 4 caractères)
const ME = (k: string): Me => ({ artistId: id4(k), displayName: artists[k] });
const lookup: ArtistLookup = async (aid) => { const k = Object.keys(artists).find((x) => id4(x) === aid); return k ? { artistId: aid, displayName: artists[k] } : null; };
async function code(p: Promise<unknown>): Promise<{ status: number; code: string; message: string } | "ok"> {
  try { await p; return "ok"; } catch (e) { if (e instanceof CircleError) return { status: e.status, code: e.code, message: e.message }; throw e; }
}

async function setup() {
  const m = memoryKV();
  const c = await createCircle(m.kv, ME("zoe"), "Les voisins", clock);
  return { ...m, circle: c };
}

test("création : nom borné et nettoyé ; le créateur est propriétaire ET membre ; clés avec TTL", async () => {
  const { kv, ttl, circle } = await setup();
  assert.equal(circle.name, "Les voisins"); assert.equal(circle.ownerId, id4("zoe"));
  const v = await getCircle(kv, ME("zoe"), circle.id, clock);
  assert.deepEqual(v.members.map((x) => [x.name, x.isOwner]), [["Zoé", true]]);
  assert.equal(ttl.get(circleKey(circle.id)), TTL_CIRCLE_SEC); assert.equal(ttl.get(membersKey(circle.id)), TTL_CIRCLE_SEC); assert.equal(ttl.get(joinedKey(id4("zoe"))), TTL_CIRCLE_SEC);
  assert.equal(cleanName("  A  "), null); assert.equal(cleanName("x".repeat(41)), null); assert.equal(cleanName(" Mon\u0000  cercle‮ "), "Mon cercle"); assert.equal(cleanName(12), null);
  assert.equal(((await code(createCircle(kv, ME("zoe"), "", clock))) as { code: string }).code, "invalid_name");
});

test("limites de création : débit 5 par jour ; 5 cercles possédés au plus ; 10 cercles au total", async () => {
  const c = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };
  const m = memoryKV();
  for (let i = 0; i < RATE.create.limit; i++) assert.equal(await c(createCircle(m.kv, ME("zoe"), `Cercle ${i}`, clock)), "ok");
  assert.equal(await c(createCircle(m.kv, ME("zoe"), "Un de trop", clock)), "rate_limited");
  // plafond de possession, indépendamment du débit : 5 cercles déjà possédés
  const m2 = memoryKV();
  for (let i = 0; i < MAX_OWNED; i++) { const id = (500 + i).toString(16).padStart(20, "0"); await m2.kv.set(circleKey(id), JSON.stringify({ id, name: `P${i}x`, ownerId: id4("ana"), ownerName: "Ana", createdAt: 1 })); await m2.kv.hset(membersKey(id), id4("ana"), "Ana"); await m2.kv.sadd(joinedKey(id4("ana")), id); }
  assert.equal(await c(createCircle(m2.kv, ME("ana"), "Sixième", clock)), "too_many_owned");
  // plafond d'appartenance : 10 cercles (dont aucun possédé)
  const m3 = memoryKV();
  for (let i = 0; i < MAX_JOINED; i++) { const id = (900 + i).toString(16).padStart(20, "0"); await m3.kv.set(circleKey(id), JSON.stringify({ id, name: `J${i}x`, ownerId: id4("zoe"), ownerName: "Zoé", createdAt: 1 })); await m3.kv.hset(membersKey(id), id4("eve"), "Eve"); await m3.kv.sadd(joinedKey(id4("eve")), id); }
  assert.equal(await c(createCircle(m3.kv, ME("eve"), "Onzième", clock)), "too_many_circles");
});

test("CONSENTEMENT : inviter n'ajoute personne ; seul l'invité accepte ; refuser ne laisse aucune trace", async () => {
  const { kv, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock);
  // pas membre tant qu'elle n'a pas accepté : le cercle est invisible pour elle
  assert.deepEqual(await code(getCircle(kv, ME("ana"), circle.id, clock)), { status: 404, code: "not_found", message: "Cercle introuvable." });
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).members.length, 1);
  const mine = await listMine(kv, ME("ana"), clock);
  assert.equal(mine.circles.length, 0); assert.equal(mine.invites.length, 1); assert.equal(mine.invites[0].circleName, "Les voisins"); assert.equal(mine.invites[0].fromName, "Zoé");
  // un tiers qui connaît l'identifiant du cercle ne peut RIEN accepter à la place d'Ana
  assert.equal(((await code(respondInvite(kv, ME("bob"), circle.id, true, clock))) as { status: number }).status, 404);
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).members.length, 1);
  await respondInvite(kv, ME("ana"), circle.id, true, clock);
  const v = await getCircle(kv, ME("zoe"), circle.id, clock);
  assert.deepEqual(v.members.map((x) => x.name).sort(), ["Ana", "Zoé"]); assert.deepEqual(v.pending, []);
  assert.equal((await listMine(kv, ME("ana"), clock)).circles.length, 1);
  // refus : retrait de l'invitation des deux côtés
  await inviteArtist(kv, ME("zoe"), circle.id, id4("bob"), lookup, clock);
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).pending!.length, 1);
  await respondInvite(kv, ME("bob"), circle.id, false, clock);
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).pending!.length, 0);
  assert.equal((await listMine(kv, ME("bob"), clock)).invites.length, 0);
  assert.equal(((await code(respondInvite(kv, ME("bob"), circle.id, true, clock))) as { status: number }).status, 404, "l'invitation refusée n'existe plus");
});

test("INVITATIONS : propriétaire seulement, profil réel, pas de doublon, pas soi-même, plafonds, TTL 30 jours", async () => {
  const { kv, ttl, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock);
  assert.equal(ttl.get(invitesKey(id4("ana"))), TTL_INVITE_SEC); assert.equal(ttl.get(pendingKey(circle.id)), TTL_INVITE_SEC);
  const c = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };
  assert.equal(await c(inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock)), "already_invited");
  assert.equal(await c(inviteArtist(kv, ME("zoe"), circle.id, id4("zoe"), lookup, clock)), "self_invite");
  assert.equal(await c(inviteArtist(kv, ME("zoe"), circle.id, "a_ghost_0001", lookup, clock)), "unknown_artist");
  assert.equal(await c(inviteArtist(kv, ME("zoe"), circle.id, "../x", lookup, clock)), "invalid_artist");
  await respondInvite(kv, ME("ana"), circle.id, true, clock);
  assert.equal(await c(inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock)), "already_member");
  // un MEMBRE non propriétaire ne peut pas inviter
  assert.equal(await c(inviteArtist(kv, ME("ana"), circle.id, id4("bob"), lookup, clock)), "owner_only");
  assert.equal(MAX_PENDING <= MAX_MEMBERS, true);
});

test("plafonds : cercle complet (membres + invitations) ; MAX_JOINED à l'acceptation ; invitation périmée refusée", async () => {
  const m = memoryKV();
  const circle = await createCircle(m.kv, ME("zoe"), "Grand cercle", clock);
  for (let i = 0; i < MAX_MEMBERS - 2; i++) await m.kv.hset(membersKey(circle.id), `a_fill_${i}000`, `F${i}`);   // + la propriétaire = MAX_MEMBERS - 1 membres
  const c = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };
  assert.equal(await c(inviteArtist(m.kv, ME("zoe"), circle.id, id4("ana"), lookup, clock)), "ok");
  assert.equal(await c(inviteArtist(m.kv, ME("zoe"), circle.id, id4("bob"), lookup, clock)), "circle_full");
  // MAX_JOINED
  const m2 = memoryKV();
  const circle2 = await createCircle(m2.kv, ME("zoe"), "Cercle plein", clock);
  await inviteArtist(m2.kv, ME("zoe"), circle2.id, id4("eve"), lookup, clock);
  for (let i = 0; i < MAX_JOINED; i++) await m2.kv.sadd(joinedKey(id4("eve")), `${(1000 + i).toString(16).padStart(20, "0")}`);
  assert.equal(await c(respondInvite(m2.kv, ME("eve"), circle2.id, true, clock)), "too_many_circles");
  assert.equal((await getCircle(m2.kv, ME("zoe"), circle2.id, clock)).members.length, 1, "pas ajoutée");
  // invitation périmée (> 30 j)
  const m3 = memoryKV(); const circle3 = await createCircle(m3.kv, ME("zoe"), "Vieux cercle", clock);
  await inviteArtist(m3.kv, ME("zoe"), circle3.id, id4("mia"), lookup, clock);
  const old: Clock = { now: () => clock.now() + (TTL_INVITE_SEC + 5) * 1000, newId: clock.newId };
  assert.equal(await c(respondInvite(m3.kv, ME("mia"), circle3.id, true, old)), "not_found");
  assert.equal((await listMine(m3.kv, ME("mia"), old)).invites.length, 0);
});

test("DROITS d'un non-membre : EXACTEMENT la même réponse qu'un cercle inexistant, pour toutes les opérations", async () => {
  const { kv, circle } = await setup();
  const ghost = "f".repeat(20);
  const stranger = ME("eve");
  const ops: Array<[string, (id: string) => Promise<unknown>]> = [
    ["voir", (id) => getCircle(kv, stranger, id, clock)],
    ["lire les messages", (id) => listMessages(kv, stranger, id)],
    ["écrire un message", (id) => postMessage(kv, stranger, id, "salut", clock)],
    ["quitter", (id) => leaveCircle(kv, stranger, id)],
    ["inviter", (id) => inviteArtist(kv, stranger, id, id4("bob"), lookup, clock)],
    ["retirer", (id) => removeMember(kv, stranger, id, id4("zoe"))],
    ["annuler une invitation", (id) => cancelInvite(kv, stranger, id, id4("bob"))],
    ["supprimer", (id) => deleteCircle(kv, stranger, id, "Les voisins")],
    ["répondre", (id) => respondInvite(kv, stranger, id, true, clock)],
  ];
  for (const [name, op] of ops) {
    const real = await code(op(circle.id)), none = await code(op(ghost)), bad = await code(op("pas-un-id"));
    assert.deepEqual(real, none, `${name} : cercle réel ≠ cercle inexistant (fuite d'existence)`);
    assert.deepEqual(real, bad, `${name} : identifiant invalide distinguable`);
    assert.equal((real as { status: number }).status, 404, name);
  }
  // le cercle est intact
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).members.length, 1);
  assert.equal((await listMine(kv, stranger, clock)).circles.length, 0);
});

test("départ et retrait : un membre peut quitter ; le propriétaire ne le peut pas ; le propriétaire retire un membre (jamais lui-même) ; l'ancien membre perd tout accès", async () => {
  const { kv, circle } = await setup();
  for (const k of ["ana", "bob"]) { await inviteArtist(kv, ME("zoe"), circle.id, id4(k), lookup, clock); await respondInvite(kv, ME(k), circle.id, true, clock); }
  const c = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };
  assert.equal(await c(leaveCircle(kv, ME("zoe"), circle.id)), "owner_cannot_leave");
  await leaveCircle(kv, ME("ana"), circle.id);
  assert.equal((await listMine(kv, ME("ana"), clock)).circles.length, 0);
  assert.equal(await c(getCircle(kv, ME("ana"), circle.id, clock)), "not_found");
  assert.equal(await c(removeMember(kv, ME("bob"), circle.id, id4("zoe"))), "owner_only", "un membre ne retire personne");
  assert.equal(await c(removeMember(kv, ME("zoe"), circle.id, id4("zoe"))), "cannot_remove_owner");
  assert.equal(await c(removeMember(kv, ME("zoe"), circle.id, id4("eve"))), "not_a_member");
  await removeMember(kv, ME("zoe"), circle.id, id4("bob"));
  assert.equal(await c(listMessages(kv, ME("bob"), circle.id)), "not_found");
  assert.equal(await c(postMessage(kv, ME("bob"), circle.id, "encore là ?", clock)), "not_found");
  assert.equal((await listMine(kv, ME("bob"), clock)).circles.length, 0);
  assert.deepEqual((await getCircle(kv, ME("zoe"), circle.id, clock)).members.map((x) => x.name), ["Zoé"]);
});

test("suppression : propriétaire seul, nom retapé ; nettoie les index des membres et les invitations en attente ; efface messages", async () => {
  const { kv, str, sets, hashes, lists, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock); await respondInvite(kv, ME("ana"), circle.id, true, clock);
  await inviteArtist(kv, ME("zoe"), circle.id, id4("bob"), lookup, clock);   // en attente
  await postMessage(kv, ME("ana"), circle.id, "bonjour", clock);
  const c = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };
  assert.equal(await c(deleteCircle(kv, ME("ana"), circle.id, "Les voisins")), "owner_only");
  assert.equal(await c(deleteCircle(kv, ME("zoe"), circle.id, "Les voisin")), "confirm_mismatch");
  assert.equal(await c(deleteCircle(kv, ME("zoe"), circle.id, undefined)), "confirm_mismatch");
  await deleteCircle(kv, ME("zoe"), circle.id, " Les voisins ");
  assert.equal(str.has(circleKey(circle.id)) || hashes.has(membersKey(circle.id)) || hashes.has(pendingKey(circle.id)) || lists.has(msgsKey(circle.id)), false);
  assert.equal((sets.get(joinedKey(id4("ana")))?.size ?? 0), 0); assert.equal((sets.get(joinedKey(id4("zoe")))?.size ?? 0), 0);
  assert.equal((await listMine(kv, ME("bob"), clock)).invites.length, 0, "l'invitation en attente est annulée");
  assert.equal(await c(respondInvite(kv, ME("bob"), circle.id, true, clock)), "not_found");
});

test("annulation d'invitation : propriétaire seulement ; l'invité ne peut plus accepter", async () => {
  const { kv, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock);
  const c = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };
  assert.equal(await c(cancelInvite(kv, ME("ana"), circle.id, id4("ana"))), "not_found", "l'invitée n'est pas membre : 404");
  await cancelInvite(kv, ME("zoe"), circle.id, id4("ana"));
  assert.equal(await c(respondInvite(kv, ME("ana"), circle.id, true, clock)), "not_found");
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).members.length, 1);
});

test("les invitations en attente ne sont visibles que du propriétaire", async () => {
  const { kv, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock); await respondInvite(kv, ME("ana"), circle.id, true, clock);
  await inviteArtist(kv, ME("zoe"), circle.id, id4("bob"), lookup, clock);
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).pending!.length, 1);
  assert.equal((await getCircle(kv, ME("ana"), circle.id, clock)).pending, null);
});

test("messages : texte seul, nettoyé et borné, réservé aux membres ; 50 derniers ; débit ; TTL", async () => {
  const { kv, ttl, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock); await respondInvite(kv, ME("ana"), circle.id, true, clock);
  const c = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };
  assert.equal(cleanMessage(""), null); assert.equal(cleanMessage("x".repeat(MESSAGE_MAX + 1)), null); assert.equal(cleanMessage(" a\u0007b‮c "), "a b c"); assert.equal(cleanMessage({}), null);
  assert.equal(await c(postMessage(kv, ME("ana"), circle.id, "   ", clock)), "invalid_message");
  const m = await postMessage(kv, ME("ana"), circle.id, "Salut <b>tout</b> le monde", clock);
  assert.equal(m.text, "Salut <b>tout</b> le monde", "le texte reste du texte (l'interface l'échappe) ; aucune interprétation");
  assert.equal(m.authorName, "Ana");
  assert.equal(ttl.get(msgsKey(circle.id)), TTL_MESSAGES_SEC);
  const list = await listMessages(kv, ME("zoe"), circle.id);
  assert.equal(list.length, 1); assert.equal(list[0].authorId, id4("ana"));
  assert.equal(await c(listMessages(kv, ME("eve"), circle.id)), "not_found");
  // 50 derniers seulement + débit : on injecte directement pour dépasser sans déclencher le limiteur
  for (let i = 0; i < MESSAGES_KEPT + 10; i++) { await kv.lpush(msgsKey(circle.id), JSON.stringify({ id: String(i), at: i, authorId: id4("ana"), authorName: "Ana", text: `m${i}` })); await kv.ltrim(msgsKey(circle.id), 0, MESSAGES_KEPT - 1); }
  assert.equal((await listMessages(kv, ME("zoe"), circle.id)).length, MESSAGES_KEPT);
  let limited = "ok";
  for (let i = 0; i < RATE.message.limit + 2; i++) { limited = await c(postMessage(kv, ME("zoe"), circle.id, `msg ${i}`, clock)); if (limited !== "ok") break; }
  assert.equal(limited, "rate_limited");
});

test("index orphelins : un cercle supprimé ou un retrait laissent un index qui est nettoyé à la lecture, jamais un cercle fantôme", async () => {
  const { kv, sets, circle } = await setup();
  await kv.sadd(joinedKey(id4("ana")), circle.id);                      // index sans adhésion réelle
  await kv.sadd(joinedKey(id4("ana")), "e".repeat(20));                 // cercle inexistant
  assert.equal((await listMine(kv, ME("ana"), clock)).circles.length, 0);
  assert.equal(sets.get(joinedKey(id4("ana")))!.size, 0);
  assert.equal(((await code(getCircle(kv, ME("ana"), circle.id, clock))) as { status: number }).status, 404, "l'index seul ne donne AUCUN accès : la source de vérité est la liste des membres");
});

// ── isolation : rien d'un cercle ne fuit vers le public, aucun média ─────────
const root = path.join(__dirname, "..");
const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test("ISOLATION : seuls les routes /api/circles, leur enveloppe et la page /circles touchent aux cercles ; ni galerie, ni réseau, ni recherche, ni annuaire, ni consensus", () => {
  const allowed = (f: string) => f.startsWith(path.join("app", "api", "circles")) || f.startsWith(path.join("app", "circles")) || ["lib/circles.ts", "lib/circlesRedis.ts", "lib/navLinks.ts", "app/NavMenu.tsx"].includes(f.replace(/\\/g, "/"))
    || f.startsWith("tests") || f.startsWith("docs") || f.startsWith(path.join("app", "learn")) || f === "lib/learnCatalog.ts";
  const offenders = [...walk("app"), ...walk("lib")].filter((f) => /\.(ts|tsx)$/.test(f) && !allowed(f))
    .filter((f) => /lib\/circles|artist:circles|circle:invites|\/api\/circles/.test(fs.readFileSync(path.join(root, f), "utf8")));
  assert.deepEqual(offenders, [], `fichiers qui touchent aux cercles hors périmètre : ${offenders.join(", ")}`);
});

test("AUCUN média : les routes de cercles n'acceptent que du JSON borné (pas de multipart, pas d'image, pas de blob) ; aucun stockage objet", () => {
  const files = walk(path.join("app", "api", "circles")).map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n") + fs.readFileSync(path.join(root, "lib/circlesRedis.ts"), "utf8") + fs.readFileSync(path.join(root, "lib/circles.ts"), "utf8");
  assert.doesNotMatch(files, /formData|multipart|image\/(png|jpeg|gif)|base64|blob|put\(|@vercel\/blob|s3|r2\./i);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies).filter((d) => /blob|aws|s3|cloudinary|r2|storage/i.test(d)), [], "aucune dépendance de stockage ajoutée");
});

test("routes : chacune passe par l'enveloppe (profil de session obligatoire), jamais de cache, jamais de sondage", () => {
  for (const f of walk(path.join("app", "api", "circles"))) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(src, /circleRoute\(/, f);
    assert.match(src, /export const dynamic = "force-dynamic"/, f);
  }
  const env = fs.readFileSync(path.join(root, "lib/circlesRedis.ts"), "utf8");
  assert.match(env, /private, no-store/); assert.match(env, /resolveSessionArtist\(await getSession\(\)\)/); assert.match(env, /status: 401|, 401\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "lib/circles.ts"), "utf8"), /Date\.now\(|Math\.random|setInterval|redis\.(scan|keys)\(/);
});

// ── correctif : invitations expirées et concurrence ───────────────────────────
const DAY = 86400 * 1000;
const later = (ms: number): Clock => ({ now: () => clock.now() + ms, newId: clock.newId });
const cc = async (p: Promise<unknown>) => { const r = await code(p); return r === "ok" ? "ok" : r.code; };

test("EXPIRATION : ancienne et récente invitation dans le MÊME hash au TTL renouvelé — l'ancienne n'est ni affichée, ni comptée, ni bloquante ; une nouvelle reste possible", async () => {
  const { kv, ttl, hashes, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock);            // ancienne
  const future = later((TTL_INVITE_SEC + 3600) * 1000);                               // ... 30 j + 1 h plus tard
  await inviteArtist(kv, ME("zoe"), circle.id, id4("bob"), lookup, future);           // récente : renouvelle le TTL collectif
  assert.equal(ttl.get(pendingKey(circle.id)), TTL_INVITE_SEC, "le TTL du hash a bien été renouvelé");
  // cas défavorable : l'ancienne entrée est (re)présente dans le hash dont le TTL vient d'être renouvelé
  await kv.hset(pendingKey(circle.id), id4("ana"), JSON.stringify({ name: "Ana", at: clock.now() - (TTL_INVITE_SEC + 10) * 1000 }));
  await kv.hset(invitesKey(id4("ana")), circle.id, JSON.stringify({ circleName: circle.name, fromId: id4("zoe"), fromName: "Zoé", at: clock.now() - (TTL_INVITE_SEC + 10) * 1000 }));
  assert.equal(hashes.get(pendingKey(circle.id))!.size, 2, "ancienne + récente cohabitent");
  const v = await getCircle(kv, ME("zoe"), circle.id, future);
  assert.deepEqual(v.pending!.map((p) => p.artistId), [id4("bob")], "l'ancienne n'est pas affichée");
  assert.equal(hashes.get(pendingKey(circle.id))!.has(id4("ana")), false, "retirée du hash du cercle");
  assert.equal(hashes.get(invitesKey(id4("ana")))?.has(circle.id) ?? false, false, "retirée aussi chez l'invitée");
  assert.equal((await listMine(kv, ME("ana"), future)).invites.length, 0);
});

test("EXPIRATION : une invitation périmée ne compte dans AUCUN plafond (membres + attente, MAX_PENDING) ; la réinviter est possible", async () => {
  const m = memoryKV();
  const circle = await createCircle(m.kv, ME("zoe"), "Cercle actif", clock);
  // MAX_PENDING invitations périmées posées directement (cercle « actif » dont le hash n'a jamais expiré)
  const old = clock.now() - (TTL_INVITE_SEC + 10) * 1000;
  for (let i = 0; i < MAX_PENDING; i++) {
    const aid = `a_old${i}_0001`;
    await m.kv.hset(pendingKey(circle.id), aid, JSON.stringify({ name: `Old${i}`, at: old }));
    await m.kv.hset(invitesKey(aid), circle.id, JSON.stringify({ circleName: circle.name, fromId: id4("zoe"), fromName: "Zoé", at: old }));
  }
  assert.deepEqual((await getCircle(m.kv, ME("zoe"), circle.id, clock)).pending, [], "aucune périmée affichée");
  assert.equal(m.hashes.get(pendingKey(circle.id))!.size, 0, "toutes nettoyées du cercle");
  assert.equal(m.hashes.get(invitesKey("a_old0_0001"))!.has(circle.id), false, "et chez l'invité");
  // sans lecture préalable : inviter nettoie puis compte seulement les fraîches
  const m2 = memoryKV();
  const c2 = await createCircle(m2.kv, ME("zoe"), "Cercle plein de vieilles", clock);
  for (let i = 0; i < MAX_PENDING; i++) await m2.kv.hset(pendingKey(c2.id), `a_old${i}_0001`, JSON.stringify({ name: `Old${i}`, at: old }));
  assert.equal(await cc(inviteArtist(m2.kv, ME("zoe"), c2.id, id4("ana"), lookup, clock)), "ok", "les périmées ne bloquent pas (ni MAX_PENDING ni MAX_MEMBERS)");
  assert.deepEqual([...m2.hashes.get(pendingKey(c2.id))!.keys()], [id4("ana")]);
  // l'invité périmé peut être réinvité
  const m3 = memoryKV(); const c3 = await createCircle(m3.kv, ME("zoe"), "Réinvitation", clock);
  await inviteArtist(m3.kv, ME("zoe"), c3.id, id4("mia"), lookup, clock);
  const f = later((TTL_INVITE_SEC + 5) * 1000);
  assert.equal(await cc(inviteArtist(m3.kv, ME("zoe"), c3.id, id4("mia"), lookup, f)), "ok");
});

test("EXPIRATION : la réponse TARDIVE à l'ancienne invitation nettoie les deux côtés et répond 404", async () => {
  const { kv, hashes, circle } = await setup();
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock);
  await inviteArtist(kv, ME("zoe"), circle.id, id4("bob"), lookup, clock);
  const f = later((TTL_INVITE_SEC + 5) * 1000);
  assert.equal(await cc(respondInvite(kv, ME("ana"), circle.id, true, f)), "not_found");
  assert.equal(hashes.get(invitesKey(id4("ana")))!.has(circle.id), false, "côté invitée");
  assert.equal(hashes.get(pendingKey(circle.id))!.has(id4("ana")), false, "côté cercle");
  assert.equal(hashes.get(pendingKey(circle.id))!.has(id4("bob")), true, "l'autre invitation n'est pas touchée (elle sera nettoyée à sa propre lecture)");
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).members.length, 1, "personne n'est ajouté");
  // refus tardif identique
  assert.equal(await cc(respondInvite(kv, ME("bob"), circle.id, false, clock)), "ok");
});

/** Même mémoire, mais chaque commande cède la main plusieurs fois : force l'entrelacement de deux requêtes simultanées. */
function yielding(kv: CircleKV): CircleKV {
  const wrap = Object.fromEntries(Object.entries(kv).map(([k, fn]) => [k, async (...a: unknown[]) => { for (let i = 0; i < 4; i++) await Promise.resolve(); return (fn as (...x: unknown[]) => Promise<unknown>)(...a); }]));
  return wrap as unknown as CircleKV;
}

test("CONCURRENCE : deux acceptations simultanées à la limite ne dépassent JAMAIS MAX_MEMBERS (verrou court par cercle) ; la seconde reçoit 409 « réessaie »", async () => {
  const m = memoryKV();
  const circle = await createCircle(m.kv, ME("zoe"), "Dernière place", clock);
  for (let i = 0; i < MAX_MEMBERS - 2; i++) await m.kv.hset(membersKey(circle.id), `a_fill_${i}000`, `F${i}`);   // MAX_MEMBERS - 1 membres avec la propriétaire
  await inviteArtist(m.kv, ME("zoe"), circle.id, id4("ana"), lookup, clock);
  await m.kv.hset(invitesKey(id4("bob")), circle.id, JSON.stringify({ circleName: circle.name, fromId: id4("zoe"), fromName: "Zoé", at: clock.now() }));   // 2e invitation valide (posée directement)
  const ykv = yielding(m.kv);
  const [a, b] = await Promise.all([code(respondInvite(ykv, ME("ana"), circle.id, true, clock)), code(respondInvite(ykv, ME("bob"), circle.id, true, clock))]);
  const results = [a, b].map((r) => (r === "ok" ? "ok" : r.code)).sort();
  assert.deepEqual(results, ["circle_busy", "ok"], "une seule entre, l'autre est refusée proprement");
  assert.equal(m.hashes.get(membersKey(circle.id))!.size, MAX_MEMBERS, "exactement MAX_MEMBERS");
  assert.equal(m.str.has("lock:circle:" + circle.id), false, "verrou libéré");
  // sans verrou la même course dépasserait : on le montre en retirant le verrou (preuve que le test détecte le défaut)
  const m2 = memoryKV();
  const c2 = await createCircle(m2.kv, ME("zoe"), "Sans verrou", clock);
  for (let i = 0; i < MAX_MEMBERS - 2; i++) await m2.kv.hset(membersKey(c2.id), `a_fill_${i}000`, `F${i}`);
  for (const k of ["ana", "bob"]) await m2.kv.hset(invitesKey(id4(k)), c2.id, JSON.stringify({ circleName: c2.name, fromId: id4("zoe"), fromName: "Zoé", at: clock.now() }));
  const nolock = { ...yielding(m2.kv), setnx: async () => true } as CircleKV;
  await Promise.all([respondInvite(nolock, ME("ana"), c2.id, true, clock), respondInvite(nolock, ME("bob"), c2.id, true, clock)]);
  assert.equal(m2.hashes.get(membersKey(c2.id))!.size, MAX_MEMBERS + 1, "témoin : sans verrou, la limite est dépassée");
});

test("VERROU : échec fermé (déjà tenu → 409, rien n'est modifié), TTL court, libéré après succès ET après erreur, jamais le verrou d'un autre", async () => {
  const { kv: base, str, circle } = await setup();
  let lockTtl = -1;
  const kv: CircleKV = { ...base, setnx: async (k, v, ex) => { lockTtl = ex; return base.setnx(k, v, ex); } };
  str.set("lock:circle:" + circle.id, "autre-jeton");
  assert.equal(await cc(inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock)), "circle_busy");
  assert.equal((await getCircle(kv, ME("zoe"), circle.id, clock)).pending!.length, 0, "aucune invitation écrite");
  assert.equal(str.get("lock:circle:" + circle.id), "autre-jeton", "le verrou d'un autre n'est jamais relâché");
  str.delete("lock:circle:" + circle.id);
  await inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock);
  assert.equal(str.has("lock:circle:" + circle.id), false, "libéré après succès");
  assert.equal(lockTtl, 10, "TTL de 10 s");
  assert.equal(await cc(inviteArtist(kv, ME("zoe"), circle.id, id4("ana"), lookup, clock)), "already_invited");
  assert.equal(str.has("lock:circle:" + circle.id), false, "libéré après une erreur métier");
});
