import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ELIGIBILITY, authorProfilesOf, candidateEligibilityOf, eligibilityConfigFromEnv, eligibilityModeFromEnv, evaluateDevice, planPool, profileIdOf, voteGate, voterKey,
  type CandidateEligibility, type EligibilityConfig,
} from "../lib/eligibility";
import { castVoteOn, countAccepts, countRejects, countV2Accepts, countVoters, type Candidate, type ValidationVote, type VoteMap, type VoteRedis } from "../lib/chain";

// Lot 2 — identité et éligibilité. Scénarios HOSTILES : faux appareils non appairés, cartes multiples d'un même profil, auteur votant pour lui-même, profils trop jeunes,
// profil dont les cartes se contredisent. Le mode « off » doit rester STRICTEMENT identique à l'historique.
const NOW = 1_800_000_000_000;
const H = 3600 * 1000;
const cfg: EligibilityConfig = { ...DEFAULT_ELIGIBILITY };
type Dev = { deviceId: string; artistId?: string; artistName?: string; lastPing: number; createdAt: number; publicKey?: string };
const dev = (id: string, over: Partial<Dev> = {}): Dev => ({ deviceId: `dev_${id}`, artistName: `Artiste ${id}`, lastPing: NOW - 60_000, createdAt: NOW - 72 * H, ...over });
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

test("modes et configuration depuis l'environnement : « off » par défaut, valeurs invalides = off, 24 h d'ancienneté par défaut", () => {
  const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;
  assert.equal(eligibilityModeFromEnv(env({})), "off");
  assert.equal(eligibilityModeFromEnv(env({ ELIGIBILITY_MODE: "ENFORCE" })), "enforce");
  assert.equal(eligibilityModeFromEnv(env({ ELIGIBILITY_MODE: "shadow" })), "shadow");
  for (const v of ["", "on", "true", "strict", "1"]) assert.equal(eligibilityModeFromEnv(env({ ELIGIBILITY_MODE: v })), "off", v);
  assert.equal(eligibilityConfigFromEnv(env({})).minAgeMs, 24 * H);
  assert.equal(eligibilityConfigFromEnv(env({ ELIGIBILITY_MIN_AGE_HOURS: "0" })).minAgeMs, 0);
  assert.equal(eligibilityConfigFromEnv(env({ ELIGIBILITY_MIN_AGE_HOURS: "2" })).minAgeMs, 2 * H);
  assert.equal(eligibilityConfigFromEnv(env({ ELIGIBILITY_MIN_AGE_HOURS: "abc" })).minAgeMs, 24 * H);
  assert.equal(eligibilityConfigFromEnv(env({ ELIGIBILITY_REQUIRE_KEY: "true" })).requireKey, true);
  assert.equal(eligibilityConfigFromEnv(env({})).requireKey, false);
  assert.equal(eligibilityConfigFromEnv(env({ ELIGIBILITY_BOOTSTRAP_BELOW: "5" })).bootstrapBelow, 5);
  assert.equal(eligibilityConfigFromEnv(env({ ELIGIBILITY_BOOTSTRAP_BELOW: "0" })).bootstrapBelow, 3);
});

test("profil : ArtistProfile s'il existe, sinon artiste implicite d'un ESP appairé par son nom, sinon aucun (non appairé)", () => {
  assert.equal(profileIdOf({ deviceId: "dev_A", artistId: "art_1", artistName: "x" }), "art_1");
  assert.equal(profileIdOf({ deviceId: "dev_A", artistName: "Roubzi" }), "esp_dev_A");
  assert.equal(profileIdOf({ deviceId: "dev_A", artistName: "   " }), null);
  assert.equal(profileIdOf({ deviceId: "dev_A" }), null);
});

test("éligibilité d'un appareil : non appairé, inactif, trop jeune, sans clé (si exigée), auteur — bornes exactes", () => {
  const ev = (d: Dev, c = cfg, a: string[] = [], inc = false) => evaluateDevice(d, NOW, c, a, inc);
  assert.deepEqual(ev(dev("A")), { eligible: true, profileId: "esp_dev_A" });
  assert.deepEqual(ev(dev("A", { artistName: undefined })), { eligible: false, reason: "unpaired", profileId: null });
  assert.equal(ev(dev("A", { lastPing: NOW - cfg.activeWindowMs + 1 })).eligible, true, "juste dans la fenêtre");
  assert.deepEqual(ev(dev("A", { lastPing: NOW - cfg.activeWindowMs })), { eligible: false, reason: "inactive", profileId: "esp_dev_A" });
  assert.equal(ev(dev("A", { createdAt: NOW - 24 * H })).eligible, true, "exactement 24 h : éligible");
  assert.equal((ev(dev("A", { createdAt: NOW - 24 * H + 1 })) as { reason: string }).reason, "too-young");
  assert.equal((ev(dev("A"), { ...cfg, requireKey: true }) as { reason: string }).reason, "no-key");
  assert.equal(ev(dev("A", { publicKey: "ab".repeat(32) }), { ...cfg, requireKey: true }).eligible, true);
  assert.equal((ev(dev("A"), cfg, ["esp_dev_A"]) as { reason: string }).reason, "author");
  assert.equal(ev(dev("A"), cfg, ["esp_dev_A"], true).eligible, true, "bootstrap : l'auteur est admis");
  assert.equal(ev(dev("A", { createdAt: NOW - 1 * H }), { ...cfg, minAgeMs: 0 }).eligible, true, "ancienneté 0 = aucune condition");
});

test("profils auteur : propriétaire de l'appareil + artiste invité retrouvé par son nom (sans casse)", () => {
  const all = [dev("A", { artistId: "art_1", artistName: "Roubzi" }), dev("B", { artistName: "Invitée" }), dev("C", { artistName: "Autre" })];
  assert.deepEqual(authorProfilesOf(all[0], undefined, all), ["art_1"]);
  assert.deepEqual(authorProfilesOf(all[0], "  invitée ", all), ["art_1", "esp_dev_B"].sort());
  assert.deepEqual(authorProfilesOf(null, "inconnue", all), []);
});

test("HOSTILE — 50 faux appareils non appairés : aucun profil, aucune voix, le pool reste celui des vrais", () => {
  const real = ["A", "B", "C", "D"].map((i) => dev(i));
  const fakes = Array.from({ length: 50 }, (_, i) => dev(`F${i}`, { artistName: undefined }));
  const plan = planPool([...real, ...fakes], ["esp_dev_A"], NOW, cfg);
  assert.equal(plan.kind, "independent");
  assert.equal(plan.poolSize, 3, "B, C, D : l'auteur A est exclu, les 50 faux ne comptent pas");
  assert.deepEqual(plan.profiles, ["esp_dev_B", "esp_dev_C", "esp_dev_D"]);
});

test("HOSTILE — cinq cartes d'un même profil : UNE voix au pool ; un profil trop jeune ou inactif n'en compte pas", () => {
  const sameProfile = ["1", "2", "3", "4", "5"].map((i) => dev(`P${i}`, { artistId: "art_multi" }));
  const others = [dev("B"), dev("C")];
  const young = dev("Y", { createdAt: NOW - 1 * H });
  const stale = dev("S", { lastPing: NOW - 2 * H });
  const plan = planPool([...sameProfile, ...others, young, stale], ["esp_dev_A"], NOW, cfg);
  assert.equal(plan.kind, "independent");
  assert.deepEqual(plan.profiles, ["art_multi", "esp_dev_B", "esp_dev_C"]);
  assert.equal(plan.poolSize, 3, "5 cartes = 1 profil ; jeune et inactif ne comptent pas");
});

test("plan : sous 3 profils indépendants → BOOTSTRAP (l'auteur est admis, étiqueté) ; personne → « none » (pool minimal 1, comme le quorum historique)", () => {
  // réseau d'un seul propriétaire : 4 cartes, un seul profil = l'auteur
  const solo = ["1", "2", "3", "4"].map((i) => dev(`S${i}`, { artistId: "art_solo" }));
  const planSolo = planPool(solo, ["art_solo"], NOW, cfg);
  assert.equal(planSolo.kind, "bootstrap");
  assert.equal(planSolo.independentProfiles, 0);
  assert.equal(planSolo.poolSize, 1, "un profil, une voix : le réseau d'un propriétaire continue de miner, mais en validation PARTIELLE");
  // deux profils indépendants + l'auteur
  const two = planPool([...solo, dev("B"), dev("C")], ["art_solo"], NOW, cfg);
  assert.equal(two.kind, "bootstrap"); assert.equal(two.independentProfiles, 2); assert.equal(two.poolSize, 3);
  const none = planPool([dev("F", { artistName: undefined })], [], NOW, cfg);
  assert.deepEqual([none.kind, none.poolSize, none.profiles], ["none", 1, []]);
  assert.equal(planPool([], [], NOW, cfg).kind, "none");
});

const elig = (over: Partial<CandidateEligibility> = {}): CandidateEligibility => ({ mode: "enforce", plan: "independent", authorProfiles: ["esp_dev_A"], profiles: 3, independentProfiles: 3, ...over });
const gate = (mode: "off" | "shadow" | "enforce", d: Dev, e: CandidateEligibility | undefined, prior: string[] = []) => voteGate({ mode, eligibility: e, device: d, now: NOW, cfg, priorVoterProfiles: new Set(prior) });

test("porte de vote — « off » ou candidat antérieur à l'activation : TOUJOURS autorisé, aucun profil estampillé (comportement historique)", () => {
  for (const d of [dev("A"), dev("F", { artistName: undefined }), dev("S", { lastPing: 0 })]) {
    assert.deepEqual(gate("off", d, elig()), { action: "allow", profileId: null });
    assert.deepEqual(gate("enforce", d, undefined), { action: "allow", profileId: null });
    assert.deepEqual(gate("shadow", d, undefined), { action: "allow", profileId: null });
  }
});

test("porte de vote — enforce : auteur 403, non appairé 403, inactif 403, profil déjà représenté 409, éligible autorisé ET profil estampillé", () => {
  assert.deepEqual(gate("enforce", dev("B"), elig()), { action: "allow", profileId: "esp_dev_B" });
  assert.deepEqual(gate("enforce", dev("A"), elig()), { action: "refuse", status: 403, reason: "author", profileId: "esp_dev_A" });
  assert.deepEqual(gate("enforce", dev("F", { artistName: undefined }), elig()), { action: "refuse", status: 403, reason: "unpaired", profileId: null });
  assert.equal((gate("enforce", dev("S", { lastPing: NOW - 2 * H }), elig()) as { reason: string }).reason, "inactive");
  assert.equal((gate("enforce", dev("Y", { createdAt: NOW - H }), elig()) as { reason: string }).reason, "too-young");
  assert.deepEqual(gate("enforce", dev("B2", { artistId: "art_b" }), elig(), ["art_b"]), { action: "refuse", status: 409, reason: "profile-already-voted", profileId: "art_b" });
  assert.deepEqual(gate("enforce", dev("X"), elig({ plan: "none" })), { action: "refuse", status: 403, reason: "no-eligible-profile", profileId: "esp_dev_X" });
});

test("porte de vote — bootstrap : l'auteur est admis (étiqueté) mais un profil ne vote toujours qu'une fois", () => {
  const e = elig({ plan: "bootstrap", independentProfiles: 1 });
  assert.deepEqual(gate("enforce", dev("A"), e), { action: "allow", profileId: "esp_dev_A" });
  assert.equal((gate("enforce", dev("A"), e, ["esp_dev_A"]) as { status: number }).status, 409);
});

test("porte de vote — shadow : ne refuse JAMAIS (journal seulement) et n'estampille aucun profil ; un candidat « shadow » reste non contraignant même si l'environnement passe en enforce", () => {
  assert.deepEqual(gate("shadow", dev("A"), elig({ mode: "shadow" })), { action: "shadow-refuse", reason: "author", profileId: "esp_dev_A" });
  assert.deepEqual(gate("shadow", dev("B"), elig({ mode: "shadow" })), { action: "allow", profileId: null });
  assert.deepEqual(gate("shadow", dev("A"), elig()), { action: "shadow-refuse", reason: "author", profileId: "esp_dev_A" }, "environnement shadow : candidat enforce non contraignant");
  assert.deepEqual(gate("enforce", dev("A"), elig({ mode: "shadow" })), { action: "shadow-refuse", reason: "author", profileId: "esp_dev_A" }, "candidat déposé en shadow : non contraignant");
  assert.deepEqual(gate("enforce", dev("B"), elig({ mode: "shadow" })), { action: "allow", profileId: null });
});

test("candidateEligibilityOf : mémorise le plan sans la liste des profils (coût de stockage borné)", () => {
  const plan = planPool([dev("A"), dev("B"), dev("C"), dev("D")], ["esp_dev_A"], NOW, cfg);
  const e = candidateEligibilityOf("enforce", plan);
  assert.deepEqual(e, { mode: "enforce", plan: "independent", authorProfiles: ["esp_dev_A"], profiles: 3, independentProfiles: 3 });
  assert.ok(JSON.stringify(e).length < 160);
});

// ── comptage : une voix par profil, abstention en cas de contradiction ───────────────────────────────────────────────────────────────────────────
const vote = (deviceId: string, over: Partial<ValidationVote> = {}): ValidationVote => ({ deviceId, entropy: 0.5, transitions: 0.5, rle: 0.5, score: 0.5, signature: "", votedAt: 1, ...over });
const map = (...votes: ValidationVote[]): VoteMap => ({ candidateId: "c1", votes: Object.fromEntries(votes.map((v) => [v.deviceId, v])) });

test("comptage : cinq approbations d'un même profil = UNE ; sans profil (historique) = une par appareil, comme avant", () => {
  const same = map(...["A", "B", "C", "D", "E"].map((i) => vote(`dev_${i}`, { profileId: "art_multi" })));
  assert.equal(countAccepts(same), 1); assert.equal(countVoters(same), 1);
  const legacy = map(...["A", "B", "C", "D", "E"].map((i) => vote(`dev_${i}`)));
  assert.equal(countAccepts(legacy), 5); assert.equal(countRejects(legacy), 0);
  assert.equal(voterKey(vote("dev_A")), "dev_A"); assert.equal(voterKey(vote("dev_A", { profileId: "art_1" })), "art_1");
});

test("comptage : deux cartes d'un profil qui se CONTREDISENT → le profil s'abstient (ni approbation ni refus), quel que soit l'ordre d'arrivée", () => {
  const a = map(vote("dev_A", { profileId: "p1" }), vote("dev_B", { profileId: "p1", v: 2, verdict: "reject" }), vote("dev_C", { profileId: "p2" }));
  const b = map(vote("dev_B", { profileId: "p1", v: 2, verdict: "reject" }), vote("dev_C", { profileId: "p2" }), vote("dev_A", { profileId: "p1" }));
  for (const m of [a, b]) { assert.equal(countAccepts(m), 1, "seul p2 approuve"); assert.equal(countRejects(m), 0, "p1 s'abstient"); assert.equal(countVoters(m), 2); }
  assert.equal(countV2Accepts(map(vote("dev_A", { profileId: "p1", v: 2 }), vote("dev_B", { profileId: "p1", v: 2 }))), 1, "approbations v2 d'un profil : une seule");
});

function fakeRedis() {
  const store = new Map<string, string>();
  const r: VoteRedis = {
    async eval(_s, keys, args) {
      const raw = store.get(keys[0]); if (!raw) return [-1];
      const m = JSON.parse(raw) as VoteMap; if (m.candidateId !== args[0]) return [-1];
      if (m.votes[args[1]] !== undefined) return [0, raw];
      m.votes[args[1]] = JSON.parse(args[2]); const enc = JSON.stringify(m); store.set(keys[0], enc); return [1, enc];
    },
    async get(k) { return store.get(k) ?? null; },
    async set(k, v) { store.set(k, v); return "OK"; },
  };
  return { r, store };
}
const cand = (poolSize: number) => ({ candidateId: "c1", poolSize } as unknown as Candidate);

test("HOSTILE — quorum : 5 cartes du MÊME profil face à un pool de 3 profils n'atteignent PAS le quorum (2 profils requis) ; deux profils l'atteignent", async () => {
  const { r, store } = fakeRedis();
  store.set("candidate:votes", JSON.stringify({ candidateId: "c1", votes: {} }));
  let last = { quorumReached: false, voteCount: 0, needed: 0 };
  for (const i of ["A", "B", "C", "D", "E"]) last = await castVoteOn(r, vote(`dev_${i}`, { profileId: "art_multi" }), cand(3), undefined) as typeof last;
  assert.equal(last.needed, 2); assert.equal(last.voteCount, 1); assert.equal(last.quorumReached, false, "une voix, quel que soit le nombre de cartes");
  const second = await castVoteOn(r, vote("dev_Z", { profileId: "art_autre" }), cand(3), undefined);
  assert.equal(second.quorumReached, true); assert.equal(second.voteCount, 2);
});

test("HOSTILE — l'avant-Lot 2 reste identique : sans profil, 3 cartes d'un pool de 4 atteignent le quorum comme avant (mode « off »)", async () => {
  const { r, store } = fakeRedis();
  store.set("candidate:votes", JSON.stringify({ candidateId: "c1", votes: {} }));
  let res = { quorumReached: false } as { quorumReached: boolean };
  for (const i of ["A", "B", "C"]) res = await castVoteOn(r, vote(`dev_${i}`), cand(4), undefined);
  assert.equal(res.quorumReached, true, "ceil(4×0,51)=3");
});

// ── câblage : les routes appellent la porte, et « off » n'ajoute AUCUN accès Redis ───────────────────────────────────────────────────────────────
test("câblage : validate-candidate, validation-result et submit-candidate utilisent lib/eligibility ; « off » garde getGlobalActiveCount ; aucun SCAN ni nouvelle commande", () => {
  const sub = read("app/api/submit-candidate/route.ts");
  assert.match(sub, /eligMode === "off"[\s\S]{0,80}getGlobalActiveCount\(\)/, "mode off : appel historique inchangé");
  assert.match(sub, /getPoolSnapshot\(\)/);
  assert.match(sub, /eligMode === "enforce" \? plan\.poolSize : snap\.legacyCount/, "shadow : quorum inchangé");
  const val = read("app/api/validate-candidate/route.ts"), res = read("app/api/validation-result/route.ts");
  for (const src of [val, res]) { assert.match(src, /voteGate\(/); assert.match(src, /eligibilityModeFromEnv\(\)/); assert.doesNotMatch(src, /\.scan\(|redis\.keys/); }
  assert.match(res, /gate\.status/, "403/409 renvoyés par la porte");
  assert.match(res, /voterProfileId \? \{ profileId: voterProfileId \}/, "le profil n'est estampillé que si la porte l'a décidé");
  const store = read("lib/deviceStore.ts");
  assert.match(store, /export async function getPoolSnapshot[\s\S]*?smembers\("devices:all"\)[\s\S]*?mget</, "même lecture que getGlobalActiveCount : 1 SMEMBERS + 1 MGET");
  assert.equal((store.match(/export async function getGlobalActiveCount/g) ?? []).length, 1, "getGlobalActiveCount conservée");
});

// ── libellé honnête + route de récupération de clé ──────────────────────────────────────────────────────────────────────────────────────────────
test("libellé du niveau de validation : « partielle » en bootstrap, jamais « validé par le réseau » ; pluriels corrects", async () => {
  const { validationLabel } = await import("../lib/validationWording");
  const boot = validationLabel({ eligibility: "enforce", plan: "bootstrap", independentProfiles: 1, distinctProfiles: 1 });
  assert.match(boot.value, /Partielle/); assert.match(boot.note, /pas validé par un réseau indépendant/);
  assert.doesNotMatch(boot.value + boot.note, /validé par le réseau(?! indépendant)/);
  assert.equal(validationLabel({ eligibility: "enforce", plan: "independent", independentProfiles: 3, distinctProfiles: 3 }).value, "3 profils distincts, auteur exclu");
  assert.equal(validationLabel({ eligibility: "enforce", plan: "independent", independentProfiles: 3, distinctProfiles: 1 }).value, "1 profil distinct, auteur exclu");
  assert.match(validationLabel({ eligibility: "enforce", plan: "none", independentProfiles: 0, distinctProfiles: 0 }).value, /Aucun profil éligible/);
  assert.match(read("app/BlockDetail.tsx"), /block\.validation && <MetaRow label="Validation"/);
});

test("reset-key : droits du PROPRIÉTAIRE vérifiés AVANT toute lecture ; confirmation explicite ; aucune boucle ; efface la clé sans toucher au reste de la fiche", () => {
  const route = read("app/api/my-devices/[deviceId]/reset-key/route.ts");
  assert.ok(route.indexOf("sessionOwnsDevice(deviceId)") > 0 && route.indexOf("sessionOwnsDevice(deviceId)") < route.indexOf("resetDeviceKey("), "droits avant lecture/écriture");
  assert.match(route, /confirm: true requis/);
  assert.doesNotMatch(route, /setInterval|\.scan\(|redis\.keys/);
  const store = read("lib/deviceStore.ts");
  const fn = store.slice(store.indexOf("export async function resetDeviceKey"), store.indexOf("export async function setDeviceName")).split("/**")[0];
  assert.match(fn, /delete device\.publicKey/); assert.match(fn, /saveDevice\(device\)/);
  assert.doesNotMatch(fn, /artistId|artistName|deviceName|pairCode/, "ne modifie que la clé");
});

test("pull : en enforce un appareil inéligible n'est pas invité à valider (économie de requêtes) ; sans effet en off/shadow ; aucune lecture de plus", () => {
  const pull = read("app/api/pull/route.ts");
  assert.match(pull, /eligibilityModeFromEnv\(\) === "enforce"/);
  assert.match(pull, /voteGate\(\{ mode: "enforce"/);
  assert.match(pull, /if \(!alreadyVoted && !notEligible\)/);
  assert.doesNotMatch(pull.slice(pull.indexOf("Éligibilité (Lot 2"), pull.indexOf("Éligibilité (Lot 2") + 1500), /redis\.(get|mget|set|eval|smembers)/, "aucun accès Redis ajouté");
});
