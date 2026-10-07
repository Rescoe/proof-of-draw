import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { analyzeClip } from "../lib/animV3";
import { animV3EnforceRequested, animV3ModeFromEnv } from "../lib/animV3Mode";
import { animShadowLine } from "../lib/animShadow";
import { CLIP_CACHE_MAX_SEC, candidateClipResponse } from "../lib/animClipResponse";
import { CLIP_TICKET_MIN_SECRET, clipPointer, clipTicket, clipTicketExp, clipTicketSecret, clipUrl, parseClipQuery, verifyClipTicket } from "../lib/clipTicket";
import { ANIM_V3_CAPABILITY, animRepresentatives, isRepresentative } from "../lib/animReps";
import { DEFAULT_ELIGIBILITY } from "../lib/eligibility";
import type { Candidate } from "../lib/chain";
import { blankFrame, enc } from "./helpers/animV3Vectors";

// Lot 6B-2 — mode ANIM_V3_MODE (off/shadow SEULEMENT), ticket HMAC, route /api/candidate-clip (inactive par défaut, ticket vérifié AVANT Redis, paramètres exacts), shadow sans effet, représentants.
// Les lectures du candidat (Redis) sont injectées et COMPTÉES.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const SECRET = "s".repeat(40), OTHER = "o".repeat(40), CAND = "123e4567-e89b-42d3-a456-426614174000", OTHER_CAND = "223e4567-e89b-42d3-a456-426614174000";
const NOW = 1_800_000_000_000, EXPIRES = NOW + 20 * 60_000;

const scene = (k: number) => { const f = blankFrame(); for (let y = 0; y < 10; y++) for (let x = 0; x < 6 + k; x++) f[(y + k) * 16 + (x >> 3)] |= 0x80 >> (x & 7); return f; };
const clipBin = enc([scene(1), scene(2), scene(3)], [100, 100, 100], 0xf800, 0x07e0);
const candidate = (over: Partial<Candidate> = {}): Candidate => ({ candidateId: CAND, expiresAt: EXPIRES, anim: { clip: Buffer.from(clipBin).toString("base64") }, ...over } as unknown as Candidate);
const query = (over: { candidateId?: string; exp?: number; t?: string } = {}) => {
  const id = over.candidateId ?? CAND, exp = over.exp ?? clipTicketExp(EXPIRES);
  return `?${clipUrl(id, exp, over.t ?? clipTicket(SECRET, id, exp)).split("?")[1]}`;
};
function harness(c: Candidate | null = candidate()) {
  const calls = { loads: 0 }, logs: string[] = [];
  const run = (o: { rawSearch: string; mode?: "off" | "shadow"; secret?: string | null; now?: number; cand?: Candidate | null }) =>
    candidateClipResponse({ rawSearch: o.rawSearch, mode: o.mode ?? "shadow", secret: o.secret === undefined ? SECRET : o.secret, now: o.now ?? NOW, loadCurrent: async () => { calls.loads++; return o.cand === undefined ? c : o.cand; }, log: (l) => logs.push(l) });
  return { calls, logs, run };
}

test("ANIM_V3_MODE : « off » par défaut ; « shadow » ; « enforce » est IMPOSSIBLE (ramené à shadow, signalé) ; toute autre valeur = off ; aucun mode « strict » n'existe", () => {
  const env = (v?: string) => (v === undefined ? {} : { ANIM_V3_MODE: v }) as unknown as NodeJS.ProcessEnv;
  for (const v of [undefined, "", "  ", "off", "OFF", "on", "true", "1", "strict", "enforc", "shadow ; enforce"]) assert.equal(animV3ModeFromEnv(env(v)), "off", String(v));
  for (const v of ["shadow", "SHADOW", " shadow "]) { assert.equal(animV3ModeFromEnv(env(v)), "shadow", v); assert.equal(animV3EnforceRequested(env(v)), false); }
  for (const v of ["enforce", "ENFORCE"]) { assert.equal(animV3ModeFromEnv(env(v)), "shadow", "enforce ⇒ shadow"); assert.equal(animV3EnforceRequested(env(v)), true); }
  const src = read("lib/animV3Mode.ts");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /"enforce"\s*:\s*\w|type AnimV3Mode\s*=.*enforce/, "le type ne contient pas « enforce »");
  assert.match(src, /export type AnimV3Mode = "off" \| "shadow";/);
});

test("ticket HMAC : HMAC-SHA256(secret, « candidate-clip-v1|candidateId|exp »), identique pour tous les validateurs, vérifié en temps constant ; secret < 32 caractères = route inactive", () => {
  const exp = clipTicketExp(EXPIRES);
  assert.equal(exp, Math.floor(EXPIRES / 1000));
  assert.equal(clipTicket(SECRET, CAND, exp), createHmac("sha256", SECRET).update(`candidate-clip-v1|${CAND}|${exp}`).digest("hex"));
  assert.equal(clipTicket(SECRET, CAND, exp), clipTicket(SECRET, CAND, exp), "commun et déterministe");
  assert.equal(verifyClipTicket(SECRET, CAND, exp, clipTicket(SECRET, CAND, exp)), true);
  const t = clipTicket(SECRET, CAND, exp);
  for (const [s, c, e, tt] of [[OTHER, CAND, exp, t], [SECRET, OTHER_CAND, exp, t], [SECRET, CAND, exp + 1, t], [SECRET, CAND, exp, t.replace(/.$/, (x) => (x === "0" ? "1" : "0"))], [SECRET, CAND, exp, t.toUpperCase()], [SECRET, CAND, exp, t.slice(1)], [SECRET, CAND, exp, ""], [SECRET, CAND, exp, "z".repeat(64)], [SECRET, "pas-un-uuid", exp, t]] as const)
    assert.equal(verifyClipTicket(s, c, e, tt), false, `${c} ${e} ${tt.slice(0, 8)}`);
  assert.equal(verifyClipTicket("court", CAND, exp, t), false, "ne lève jamais"); assert.throws(() => clipTicket("court", CAND, exp));
  assert.equal(clipTicketSecret({} as NodeJS.ProcessEnv), null);
  assert.equal(clipTicketSecret({ CLIP_TICKET_SECRET: "x".repeat(CLIP_TICKET_MIN_SECRET - 1) } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(clipTicketSecret({ CLIP_TICKET_SECRET: "x".repeat(CLIP_TICKET_MIN_SECRET) } as unknown as NodeJS.ProcessEnv), "x".repeat(CLIP_TICKET_MIN_SECRET));
  const p = clipPointer(SECRET, { candidateId: CAND, expiresAt: EXPIRES });
  assert.equal(p.exp, exp); assert.equal(p.url, `/api/candidate-clip?candidateId=${CAND}&exp=${exp}&t=${t}`); assert.ok(p.url.length < 200);
});

test("requête STRICTE : exactement candidateId, exp, t — dans cet ordre, formats exacts ; tout le reste est refusé AVANT Redis (une URL de plus = un défaut de cache de plus)", () => {
  const ok = query();
  assert.equal(parseClipQuery(ok).ok, true);
  const t = clipTicket(SECRET, CAND, clipTicketExp(EXPIRES)), exp = clipTicketExp(EXPIRES);
  const bad = [
    "", "?", `${ok}&x=1`, `${ok}&`, `${ok}#frag`, `${ok}&t=${t}`, ok.replace("?", "?x=1&"),                                   // paramètre en plus, doublon
    `?exp=${exp}&candidateId=${CAND}&t=${t}`, `?t=${t}&candidateId=${CAND}&exp=${exp}`,                                        // autre ordre
    `?candidateId=${CAND}&exp=${exp}`, `?candidateId=${CAND}&t=${t}`,                                                          // paramètre manquant
    `?candidateId=${CAND.toUpperCase()}&exp=${exp}&t=${t}`, `?candidateId=${CAND}&exp=${exp}&t=${t.toUpperCase()}`,           // casse
    `?candidateId=${CAND}&exp=0${exp}&t=${t}`, `?candidateId=${CAND}&exp=${exp}.5&t=${t}`, `?candidateId=${CAND}&exp=-${exp}&t=${t}`, `?candidateId=${CAND}&exp=%31${String(exp).slice(1)}&t=${t}`, `?candidateId=${CAND}&exp=&t=${t}`,
    `?%63andidateId=${CAND}&exp=${exp}&t=${t}`, `?candidateId=${CAND}&%65xp=${exp}&t=${t}`, `?candidateId=${CAND}&exp=${exp}&%74=${t}`,   // noms ré-encodés
    `?candidateId=${CAND}&exp=${exp}&t=${t.slice(1)}`, `?candidateId=${"g".repeat(36)}&exp=${exp}&t=${t}`, `?candidateId=${CAND}&exp=${"9".repeat(13)}&t=${t}`, `?candidateId=${CAND}\n&exp=${exp}&t=${t}`, `?candidateId=${CAND}&exp=${exp}&t=${t} `, `?candidateId=${CAND}&exp=${exp}&t=${t}`.padEnd(400, "a"),
  ];
  for (const b of bad) assert.equal(parseClipQuery(b).ok, false, JSON.stringify(b).slice(0, 90));
  assert.deepEqual(parseClipQuery(ok), { ok: true, candidateId: CAND, exp, t });
});

test("route /api/candidate-clip : INACTIVE sans mode shadow ou sans CLIP_TICKET_SECRET ; toute requête refusée coûte 0 lecture Redis ; une requête valide en coûte UNE", async () => {
  const h = harness();
  assert.equal((await h.run({ rawSearch: query(), mode: "off" })).status, 404);
  assert.equal((await h.run({ rawSearch: query(), secret: null })).status, 404);
  assert.equal(h.calls.loads, 0, "route inactive : aucune lecture");
  const refusals: Array<[string, number, Parameters<typeof h.run>[0]]> = [
    ["paramètre en plus", 400, { rawSearch: `${query()}&cache=bust` }], ["autre ordre", 400, { rawSearch: `?exp=${clipTicketExp(EXPIRES)}&candidateId=${CAND}&t=${clipTicket(SECRET, CAND, clipTicketExp(EXPIRES))}` }],
    ["sans paramètre", 400, { rawSearch: "" }], ["identifiant invalide", 400, { rawSearch: "?candidateId=../../etc&exp=1&t=" + "a".repeat(64) }],
    ["ticket d'un autre secret", 403, { rawSearch: query({ t: clipTicket(OTHER, CAND, clipTicketExp(EXPIRES)) }) }], ["ticket d'un autre candidat", 403, { rawSearch: query({ t: clipTicket(SECRET, OTHER_CAND, clipTicketExp(EXPIRES)) }) }],
    ["ticket altéré", 403, { rawSearch: query({ t: "0".repeat(64) }) }], ["exp modifié", 403, { rawSearch: query({ exp: clipTicketExp(EXPIRES) + 1, t: clipTicket(SECRET, CAND, clipTicketExp(EXPIRES)) }) }],
    ["ticket expiré", 410, { rawSearch: query(), now: EXPIRES + 1_000 }],
  ];
  for (const [name, status, o] of refusals) {
    const r = await h.run(o);
    assert.equal(r.status, status, name); assert.equal(r.headers.get("cache-control"), "no-store", `${name} : jamais mis en cache`);
  }
  for (let i = 0; i < 200; i++) await h.run({ rawSearch: `?candidateId=${CAND}&exp=${i + 1}&t=${"f".repeat(64)}` });   // 200 appels directs avec de faux tickets
  assert.equal(h.calls.loads, 0, "AUCUNE lecture Redis pour une requête sans ticket valide (le rate-limit de validate-candidate ne protège pas un appel direct : le ticket, si)");
  const ok = await h.run({ rawSearch: query() });
  assert.equal(ok.status, 200); assert.equal(h.calls.loads, 1, "UNE lecture par exécution (défaut de cache)");
  assert.deepEqual(h.logs, [`[candidate-clip] MISS candidate=${CAND.slice(0, 8)}`], "une ligne de journal par défaut de cache, aucun compteur Redis");
});

test("réponse 200 : octets EXACTS du clip, cache immuable borné par l'expiration, en-têtes de contrôle ; les cas « candidat absent / autre / sans clip / autre expiration » sont des 404 no-store (1 lecture)", async () => {
  const h = harness();
  const r = await h.run({ rawSearch: query() });
  assert.equal(r.status, 200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()), clipBin);
  const a = analyzeClip(clipBin);
  assert.equal(r.headers.get("x-clip-hash"), createHash("sha256").update(clipBin).digest("hex")); assert.equal(r.headers.get("x-anim-root"), a.animRoot);
  assert.equal(r.headers.get("x-clip-frames"), "3"); assert.equal(r.headers.get("x-metrics-version"), "2"); assert.equal(r.headers.get("content-length"), String(clipBin.length));
  const cc = r.headers.get("cache-control")!;
  assert.match(cc, /^public, s-maxage=\d+, max-age=\d+, immutable$/);
  const sMax = Number(/s-maxage=(\d+)/.exec(cc)![1]);
  assert.ok(sMax >= 1 && sMax <= CLIP_CACHE_MAX_SEC && sMax <= Math.floor(clipTicketExp(EXPIRES) - NOW / 1000), `s-maxage ${sMax} ≤ temps restant : jamais servi au-delà de l'expiration`);
  for (const [name, cand] of [["aucun candidat", null], ["un autre candidat", candidate({ candidateId: OTHER_CAND })], ["sans clip", { ...candidate(), anim: undefined } as unknown as Candidate], ["autre expiration", candidate({ expiresAt: EXPIRES + 5_000 })]] as const) {
    const hh = harness(); const rr = await hh.run({ rawSearch: query(), cand });
    assert.equal(rr.status, 404, name); assert.equal(rr.headers.get("cache-control"), "no-store"); assert.equal(hh.calls.loads, 1, name);
  }
  // un clip dont le format est refusé est SERVI quand même (un appareil doit pouvoir voter « format ») ; sans racine d'animation
  const broken = { ...candidate(), anim: { clip: Buffer.from(clipBin.slice(0, 100)).toString("base64") } } as unknown as Candidate;
  const rb = await harness(broken).run({ rawSearch: query() });
  assert.equal(rb.status, 200); assert.equal(rb.headers.get("x-anim-root"), null); assert.equal((await rb.arrayBuffer()).byteLength, 100);
});

test("SHADOW : la référence v3 est journalisée, sans AUCUN effet ; ne lève jamais ; aucune commande Redis ; seule la route de dépôt l'appelle, et seulement en mode shadow", () => {
  const line = animShadowLine(candidate())!, a = analyzeClip(clipBin);
  assert.ok(line.startsWith(`[anim-v3] SHADOW candidate=${CAND.slice(0, 8)} règle=ok images=3 E=${a.E} T=${a.T} R=${a.R} S=${a.S}`), line);
  assert.ok(line.includes(`animRoot=${a.animRoot.slice(0, 12)}`) && line.includes(`framesRoot=${a.framesRoot.slice(0, 12)}`));
  assert.equal(animShadowLine({ candidateId: CAND } as Candidate), null);
  assert.match(animShadowLine({ candidateId: CAND, anim: { clip: Buffer.from(clipBin.slice(0, 50)).toString("base64") } } as unknown as Candidate)!, /règle=format/);
  assert.match(animShadowLine({ candidateId: CAND, anim: { clip: "%%%pas-du-base64%%%" } } as unknown as Candidate)!, /règle=format/);
  assert.doesNotThrow(() => animShadowLine({ candidateId: CAND, anim: { clip: 12 as unknown as string } } as unknown as Candidate));
  assert.match(animShadowLine({ candidateId: CAND, anim: { clip: Buffer.from(enc([scene(1), scene(1)], [100, 100])).toString("base64") } } as unknown as Candidate)!, /règle=static/);
  const shadow = read("lib/animShadow.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(shadow, /redis|fetch\(|process\.env|\.set\(|setCandidate/i, "aucun accès Redis ni écriture");
  const sub = read("app/api/submit-candidate/route.ts");
  assert.match(sub, /if \(candidate\.anim && animV3ModeFromEnv\(\) === "shadow"\) \{/);
  assert.ok(sub.indexOf("await setCandidate(candidate)") < sub.indexOf("animShadowLine(candidate)"), "journalisé APRÈS le dépôt : n'influence ni le candidat ni le quorum");
  assert.equal((sub.match(/animShadowLine\(/g) ?? []).length, 1);
  assert.doesNotMatch(read("app/api/pull/route.ts") + read("app/api/validate-candidate/route.ts") + read("app/api/validation-result/route.ts"), /animShadow|animV3Mode|ANIM_V3_MODE/, "aucun effet sur le vote, le pull ou le bloc");
});

test("représentants : UN appareil par profil (plus petit deviceId actif, éligible et déclarant « anim-v3 ») ; aucun appareil actuel n'en déclare : liste VIDE ; > 64 profils : pas d'animation v3", () => {
  const H = 3600_000;
  const d = (id: string, over: Record<string, unknown> = {}) => ({ deviceId: `dev_${id}`, artistId: `art_${id.slice(0, 1)}`, artistName: `A${id}`, lastPing: NOW - 60_000, createdAt: NOW - 72 * H, caps: [ANIM_V3_CAPABILITY], ...over });
  const devices = [d("A2"), d("A1"), d("A3", { caps: [] }), d("B9"), d("B8", { lastPing: NOW - 5 * H }), d("C1", { createdAt: NOW - H }), d("D1", { artistId: undefined, artistName: undefined }), d("E1", { caps: ["autre"] })];
  const reps = animRepresentatives(devices, ["art_A", "art_B", "art_C", "art_D", "art_E"], NOW, DEFAULT_ELIGIBILITY)!;
  assert.deepEqual(reps, { art_A: "dev_A1", art_B: "dev_B9" }, "A : plus petit ; B : B8 inactif écarté ; C trop jeune ; D non appairé ; E sans capacité");
  assert.equal(isRepresentative(reps, "art_A", "dev_A1"), true); assert.equal(isRepresentative(reps, "art_A", "dev_A2"), false, "un autre appareil du même profil est refusé");
  assert.equal(isRepresentative(reps, "art_Z", "dev_Z1"), false); assert.equal(isRepresentative(reps, null, "dev_A1"), false); assert.equal(isRepresentative(reps, "constructor", "dev_A1"), false);
  assert.deepEqual(animRepresentatives(devices.map((x) => ({ ...x, caps: undefined })), ["art_A", "art_B"], NOW, DEFAULT_ELIGIBILITY), {}, "aucun firmware actuel ne déclare « anim-v3 » : personne ne représente, personne ne reçoit de ticket");
  assert.equal(animRepresentatives(devices, Array.from({ length: 65 }, (_, i) => `art_${i}`), NOW, DEFAULT_ELIGIBILITY), null);
  assert.equal(Object.keys(animRepresentatives(Array.from({ length: 200 }, (_, i) => d(`P${String(i).padStart(3, "0")}`, { artistId: `art_p${i}` })), Array.from({ length: 64 }, (_, i) => `art_p${i}`), NOW, DEFAULT_ELIGIBILITY)!).length, 64, "≤ 64 téléchargements");
});

test("câblage de la route : mode, secret et clip servis par le module testé ; aucune écriture, aucun polling, aucune autre route ne distribue de ticket", () => {
  const route = read("app/api/candidate-clip/route.ts").replace(/\/\/.*$/gm, "");
  assert.match(route, /candidateClipResponse\(\{ rawSearch: req\.nextUrl\.search, mode: animV3ModeFromEnv\(\), secret: clipTicketSecret\(\), now: Date\.now\(\), loadCurrent: getCurrentCandidate \}\)/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.doesNotMatch(route, /redis|setInterval|\.set\(|\.del\(/i);
  const resp = read("lib/animClipResponse.ts").replace(/\/\/.*$/gm, "");
  assert.ok(resp.indexOf("verifyClipTicket(") < resp.indexOf("o.loadCurrent()") && resp.indexOf("parseClipQuery(") < resp.indexOf("o.loadCurrent()") && resp.indexOf("q.exp * 1000 <= o.now") < resp.indexOf("o.loadCurrent()"), "ticket, requête et expiration contrôlés AVANT la lecture");
  assert.equal((resp.match(/o\.loadCurrent\(\)/g) ?? []).length, 1, "une seule lecture");
  assert.match(read("lib/clipTicket.ts"), /timingSafeEqual/);
});
