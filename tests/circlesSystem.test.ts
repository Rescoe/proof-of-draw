// tests/circlesSystem.test.ts — cercles du réseau (« Agents IA », 30/10/2026) : inscrit par défaut, on peut quitter puis rejoindre ; rien n'est caché, aucune écriture à l'inscription.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CircleError, SYSTEM_CIRCLES, TTL_CIRCLE_SEC, leftSystemKey, listSystem, setSystemMembership, type CircleKV, type Me } from "../lib/circles";

function kv() {
  const sets = new Map<string, Set<string>>(), ttl = new Map<string, number>(); let writes = 0;
  const k = {
    async smembers(key: string) { return [...(sets.get(key) ?? [])]; },
    async sadd(key: string, m: string) { writes++; (sets.get(key) ?? sets.set(key, new Set()).get(key)!).add(m); },
    async srem(key: string, m: string) { writes++; sets.get(key)?.delete(m); },
    async expire(key: string, sec: number) { ttl.set(key, sec); },
  } as unknown as CircleKV;
  return { k, ttl, writes: () => writes };
}
const me: Me = { artistId: "artist_abc123", displayName: "Alice" };

test("un artiste est membre d'« Agents IA » par défaut, sans aucune écriture", async () => {
  const { k, writes } = kv();
  const v = await listSystem(k, me);
  assert.deepEqual(v.map((c) => [c.id, c.member]), [["agents-ia", true]]);
  assert.equal(writes(), 0, "l'inscription par défaut n'écrit rien");
  assert.equal(SYSTEM_CIRCLES[0].href, "/gallery-ana");
});

test("quitter puis rejoindre : seul le choix de quitter est stocké (TTL 365 j) ; les autres artistes ne sont pas touchés", async () => {
  const { k, ttl } = kv();
  let v = await setSystemMembership(k, me, "agents-ia", false);
  assert.equal(v[0].member, false);
  assert.equal(ttl.get(leftSystemKey(me.artistId)), TTL_CIRCLE_SEC);
  assert.equal((await listSystem(k, { artistId: "artist_other9", displayName: "Bob" }))[0].member, true);
  v = await setSystemMembership(k, me, "agents-ia", true);
  assert.equal(v[0].member, true);
  assert.deepEqual(await k.smembers(leftSystemKey(me.artistId)), []);
});

test("identifiant inconnu ou valeur non booléenne : refusé sans écriture", async () => {
  const { k, writes } = kv();
  await assert.rejects(() => setSystemMembership(k, me, "inconnu", false), (e) => e instanceof CircleError && e.status === 404);
  await assert.rejects(() => setSystemMembership(k, me, "agents-ia", "oui"), (e) => e instanceof CircleError && e.status === 400);
  await assert.rejects(() => setSystemMembership(k, me, { id: 1 }, true), (e) => e instanceof CircleError && e.status === 404);
  assert.equal(writes(), 0);
});

test("routes et interface : GET /api/circles ajoute `system`, POST /api/circles/system passe par circleRoute (session d'artiste), la page propose Quitter / Rejoindre", () => {
  const r = fs.readFileSync("app/api/circles/route.ts", "utf8");
  assert.match(r, /system: await listSystem\(kv, me\)/);
  const s = fs.readFileSync("app/api/circles/system/route.ts", "utf8");
  assert.match(s, /circleRoute\(req/); assert.match(s, /setSystemMembership\(kv, me, b\.id, b\.member\)/);
  const ui = fs.readFileSync("app/circles/CirclesClient.tsx", "utf8");
  assert.match(ui, /Cercles du réseau/); assert.match(ui, /"\/api\/circles\/system"/); assert.match(ui, /Quitter/); assert.match(ui, /Rejoindre/);
});
