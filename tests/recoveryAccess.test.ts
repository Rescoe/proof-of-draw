// tests/recoveryAccess.test.ts — récupération durable d'accès au profil, œuvres manquées, télémétrie de perte de session (04/11/2026).
// Prouvé ici : logique pure (jeton signé, révocation par epoch, sélection des œuvres manquées, famille de navigateur) + garde-fous STATIQUES des routes.
// NON prouvé ici : le comportement réel d'un iPhone (Safari, ITP), le cookie en production, l'affichage sur carte.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { signRecoveryToken, parseRecoveryToken, extractRecoveryToken } from "../lib/recoveryToken";
import { pickMissedWorks, type MissedBlockLike, type MissedRules } from "../lib/missedWorks";
import { uaFamily } from "../lib/uaFamily";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const SECRET = "secret-de-test-0123456789";
const AID = "be4e0a80-d6bf-40e0-9960-575e777f732c";

// ─── Jeton de récupération ────────────────────────────────────────────────────

test("jeton : émission puis lecture, aller-retour exact", async () => {
  const t = await signRecoveryToken(AID, 0, SECRET);
  assert.match(t, /^r1\.[A-Za-z0-9_-]+\.0\.[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(await parseRecoveryToken(t, SECRET), { artistId: AID, epoch: 0 });
});

test("jeton : un lien collé tel quel, avec espaces et retours, est accepté", async () => {
  const t = await signRecoveryToken(AID, 3, SECRET);
  const link = `  https://proof-of-draw.vercel.app/retrouver#k=${t}\n`;
  assert.equal(extractRecoveryToken(link), t);
  assert.deepEqual(await parseRecoveryToken(link, SECRET), { artistId: AID, epoch: 3 });
});

test("jeton : mauvais secret, signature altérée, id altéré, epoch altéré, préfixe inconnu ⇒ tous refusés", async () => {
  const t = await signRecoveryToken(AID, 1, SECRET);
  assert.equal(await parseRecoveryToken(t, "autre-secret"), null);
  const [p, id, ep, sig] = t.split(".");
  const flip = (s: string) => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
  assert.equal(await parseRecoveryToken([p, id, ep, flip(sig)].join("."), SECRET), null);
  assert.equal(await parseRecoveryToken([p, Buffer.from("autre-profil-1234").toString("base64url"), ep, sig].join("."), SECRET), null);
  assert.equal(await parseRecoveryToken([p, id, "2", sig].join("."), SECRET), null);
  assert.equal(await parseRecoveryToken(["r2", id, ep, sig].join("."), SECRET), null);
  assert.equal(await parseRecoveryToken("", SECRET), null);
  assert.equal(await parseRecoveryToken(42, SECRET), null);
  assert.equal(await parseRecoveryToken("x".repeat(500), SECRET), null);
});

test("jeton : un cookie de session ne peut pas passer pour un jeton (séparation de domaine)", async () => {
  const { createHmac } = await import("node:crypto");
  const forged = `r1.${Buffer.from(AID).toString("base64url")}.0.${createHmac("sha256", SECRET).update(`${AID}:0`).digest("base64url").slice(0, 22)}`;
  assert.equal(await parseRecoveryToken(forged, SECRET), null);
});

test("jeton : l'epoch distingue deux émissions (révocation = epoch + 1)", async () => {
  const a = await signRecoveryToken(AID, 0, SECRET);
  const b = await signRecoveryToken(AID, 1, SECRET);
  assert.notEqual(a, b);
  const pa = await parseRecoveryToken(a, SECRET);
  assert.equal(pa?.epoch, 0);
  assert.equal((await parseRecoveryToken(b, SECRET))?.epoch, 1);
});

test("jeton : entrées invalides refusées à l'émission", async () => {
  await assert.rejects(() => signRecoveryToken("a/b", 0, SECRET));
  await assert.rejects(() => signRecoveryToken(AID, -1, SECRET));
  await assert.rejects(() => signRecoveryToken(AID, 1.5, SECRET));
});

// ─── Œuvres manquées ──────────────────────────────────────────────────────────

const B = (i: number, over: Partial<MissedBlockLike> = {}): MissedBlockLike => ({ blockHash: "h".repeat(63) + (i % 10), blockIndex: i, poolScreen: "eink29bwr", workTitle: `Œuvre ${i}`, minedAt: 1_000 + i, ...over });
const rules = (over: Partial<MissedRules> = {}): MissedRules => ({ screen: "eink29bwr", lastShownIndex: 123, animCapable: false, showsFixed: true, acceptsConverted: false, ...over });

test("manquées : seuls les blocs APRÈS le dernier affiché, du plus récent au plus ancien", () => {
  const out = pickMissedWorks([B(125), B(131), B(123), B(130), B(127)], rules());
  assert.deepEqual(out.map((w) => w.blockIndex), [131, 130, 127, 125]);
});

test("manquées : un écran e-ink ne reçoit jamais une animation, un firmware capable oui", () => {
  const blocks = [B(131, { kind: "animation" }), B(130)];
  assert.deepEqual(pickMissedWorks(blocks, rules()).map((w) => w.blockIndex), [130]);
  const dyn = pickMissedWorks(blocks, rules({ screen: "tft28", animCapable: true, acceptsConverted: true }));
  assert.deepEqual(dyn.map((w) => [w.blockIndex, w.kind]), [[131, "animation"], [130, "drawing"]]);
});

test("manquées : autre type d'écran sans conversion ⇒ absent ; avec conversion ⇒ présent", () => {
  const blocks = [B(131, { poolScreen: "eink27bw" })];
  assert.equal(pickMissedWorks(blocks, rules()).length, 0);
  assert.equal(pickMissedWorks(blocks, rules({ acceptsConverted: true })).length, 1);
});

test("manquées : écran dynamique réglé « animations seulement » ⇒ aucun dessin fixe, mais les animations oui", () => {
  const blocks = [B(131, { kind: "animation" }), B(130)];
  const out = pickMissedWorks(blocks, rules({ screen: "tft28", animCapable: true, showsFixed: false, acceptsConverted: true }));
  assert.deepEqual(out.map((w) => w.kind), ["animation"]);
});

test("manquées : jamais d'affichage confirmé ⇒ tout le récent, borné ; limite respectée ; entrées nulles ignorées", () => {
  const blocks = Array.from({ length: 12 }, (_, i) => B(i + 1));
  assert.equal(pickMissedWorks([null, ...blocks, null], rules({ lastShownIndex: null })).length, 5);
  assert.equal(pickMissedWorks(blocks, rules({ lastShownIndex: null, limit: 2 })).length, 2);
  assert.equal(pickMissedWorks(blocks, rules({ lastShownIndex: 12 })).length, 0);
});

test("manquées : titre / artiste vides ⇒ null, pas de texte inventé", () => {
  const [w] = pickMissedWorks([B(131, { workTitle: "  ", drawArtistName: undefined, artistName: "" })], rules());
  assert.equal(w.title, null);
  assert.equal(w.artist, null);
});

// ─── Famille de navigateur ────────────────────────────────────────────────────

test("uaFamily : iOS ancien Safari, navigateur intégré, Chrome Android, vide", () => {
  assert.equal(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1"), "iOS 12 · Safari");
  assert.equal(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0"), "iOS 17 · Instagram");
  assert.equal(uaFamily("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"), "Android 13 · Chrome");
  assert.equal(uaFamily(""), "inconnu");
  assert.equal(uaFamily(null), "inconnu");
});

test("uaFamily : ne conserve ni modèle d'appareil, ni build, ni identifiant", () => {
  const out = uaFamily("Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014) AppleWebKit/537.36 Chrome/120.0.6099.144 Mobile Safari/537.36");
  assert.equal(out, "Android 13 · Chrome");
  assert.doesNotMatch(out, /SM-S918B|TP1A|120\./);
});

// ─── Garde-fous STATIQUES des routes ─────────────────────────────────────────

test("routes : récupération — limite d'essais, aucun SCAN Redis, cookie sans parcours de liste", () => {
  const r = read("app/api/artist/recover/route.ts");
  assert.match(r, /checkRateLimit\(\{ route: "artist-recover"/);
  assert.doesNotMatch(r, /scan\(|getDeviceIdsByArtist|getAllDevices/);
  assert.match(r, /setSession\(res, \{ deviceIds: session\.deviceIds, artistId: profile\.artistId \}\)/);   // on AJOUTE le profil, on ne retire aucun ESP du cookie
  const lib = read("lib/recovery.ts");
  assert.match(lib, /epoch !== parsed\.epoch/);   // révocation effective
});

test("routes : émission / rotation du jeton réservées à une session qui a un profil", () => {
  const r = read("app/api/artist/recovery/route.ts");
  assert.match(r, /if \(session\.artistId\) return session\.artistId;/);
  assert.equal((r.match(/resolveSessionArtist\(session\)/g) ?? []).length, 1, "repli ancien cookie seulement ; pas de double lecture en usage normal");
  assert.match(r, /status: 401/);
  assert.match(r, /action !== "rotate"/);
});

test("onboard : le pairCode d'un appareil déjà lié restaure SON profil et ne fabrique pas une session hybride", () => {
  const r = read("app/api/onboard/route.ts");
  assert.match(r, /if \(owner\) \{\s*profile = owner;/);
  assert.doesNotMatch(r, /resolveSessionArtist\(session\)\) \?\? owner/);
  assert.match(r, /deviceIds: owner \? \[device\.deviceId\] : Array\.from/);
});

test("routes : code d'appairage — propriétaire seulement, jamais en cache, limite de lecture", () => {
  const r = read("app/api/devices/pair-code/route.ts");
  assert.match(r, /sessionOwnsDevice\(deviceId\)/);
  assert.match(r, /no-store/);
  assert.match(r, /checkRateLimit\(\{ route: "pair-code"/);
  assert.ok(r.indexOf("sessionOwnsDevice") < r.indexOf("getDevice("), "la propriété est vérifiée AVANT de lire l'appareil");
});

test("routes : œuvres manquées — propriétaire seulement, lecture seule, aucune écriture Redis", () => {
  const r = read("app/api/my-devices/[deviceId]/missed/route.ts");
  assert.match(r, /sessionOwnsDevice\(deviceId\)/);
  assert.doesNotMatch(r, /redis\.(set|del|incr|lpush|sadd|expire)\(/);
  assert.match(r, /checkRateLimit\(\{ route: "missed"/);
  assert.match(r, /rec\?\.lastConsensusBlockIndex/, "une frame personnelle ne fait pas perdre le curseur consensus");
});

test("routes : télémétrie de perte — échantillonnée (1/h/IP), n'échoue jamais, ne stocke ni IP ni identifiant", () => {
  const r = read("app/api/artist/session-lost/route.ts");
  assert.match(r, /limit: 1, windowSec: 3600/);
  assert.match(r, /catch \{\s*\n\s*return NextResponse\.json\(\{ ok: true, sampled: false \}\)/);
  assert.match(r, /lpush\("stat:sesslost:ua", family\)/);
  assert.match(r, /const family = `\$\{uaFamily\(req\.headers\.get\("user-agent"\)\)\} · \$\{day\}`/);   // la seule donnée stockée : famille + jour
  assert.doesNotMatch(r, /getSession|deviceId|artistId/);
});

test("interface : la page de récupération lit la clé dans le FRAGMENT puis l'efface de l'adresse", () => {
  const p = read("app/retrouver/page.tsx");
  assert.match(p, /window\.location\.hash/);
  assert.match(p, /history\.replaceState/);
  assert.doesNotMatch(p, /searchParams|location\.search/);
});

test("interface : tout accès au stockage local est protégé (navigation privée)", () => {
  const c = read("app/profile/Recovery.tsx");
  for (const m of c.matchAll(/localStorage\.(getItem|setItem|removeItem)/g)) {
    const before = c.slice(Math.max(0, m.index! - 80), m.index!);
    assert.match(before, /try \{/, "localStorage hors try : " + m[0]);
  }
});

test("interface : le profil monte la garde de session, la sauvegarde d'accès et le bouton « Rattraper »", () => {
  const page = read("app/profile/page.tsx");
  assert.match(page, /<SessionGuard hasProfile=\{!!profile\} loading=\{loadingProf\} \/>/);
  assert.match(page, /\{profile && <RecoveryBackup \/>\}/);
  assert.match(read("app/profile/DevicesPanel.tsx"), /<CatchUp deviceId=\{d\.deviceId\} \/>/);
});
