import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { verifyEd25519 } from "../lib/ed25519";
import {
  BOOTSTRAP_BELOW, COMMITTEE_MAX, classifyVote, committeeWindow, decide, drawMiner, evaluateRules, merkleProof, merkleRoot, minerWeight, parseVoteMessageV3, saltNonce, saltedHash,
  effectiveVoters, selectCommittee, sha256Hex, threshold, verifyMerkleProof, voteLeaf, voteMessageV3, blockHashV2, committeeSeed, type Verdict, type VoteV3,
} from "../lib/podProtocolV3";
import { buildVectors, CANDIDATE_ID, CONTENT_HASH, DEVICE_ID, PARENT_HASH } from "./helpers/podV3Vectors";

// Protocole v3 — BROUILLON (docs/SPEC_PROTOCOLE_V3.md) : implémentation de référence + vecteurs d'or. Rien n'est branché sur une route ni un firmware.
const root = path.join(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "pod-v3-vectors.json"), "utf8"));

test("vecteurs d'or : le fichier commité == la sortie du code (tout changement de format doit être versionné et régénéré volontairement)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildVectors())), fixture);
});

test("règles N2 (rulesVersion 1) : ordre format → hash → uniform → noise ; bornes strictes du bruit ; une image TOUTE PLEINE est « uniform » comme une image blanche", () => {
  const r = (e: number, t: number, hashOk = true, formatOk = true) => evaluateRules({ formatOk, hashOk, e, t }).ruleCode;
  assert.equal(r(523_000, 311_000), "ok");
  assert.equal(r(0, 0), "uniform");
  assert.equal(r(0, 1), "ok", "un seul des deux à zéro n'est pas uniforme");
  assert.equal(r(980_000, 900_001), "ok"); assert.equal(r(980_001, 900_000), "ok"); assert.equal(r(980_001, 900_001), "noise");
  assert.equal(r(0, 0, false), "hash", "le hash passe avant « uniform »");
  assert.equal(r(0, 0, false, false), "format", "le format passe avant tout");
  assert.equal(evaluateRules({ formatOk: true, hashOk: true, e: 0, t: 0 }).verdict, "reject");
});

test("hash salé : dépend du candidat, du parent ET de l'appareil ; recopier la réponse d'un autre appareil est détectable", () => {
  const raw = new Uint8Array(1024).map((_, i) => i & 255);
  const a = saltedHash(saltNonce(CANDIDATE_ID, PARENT_HASH, "dev_AAAAAAAA"), raw);
  const b = saltedHash(saltNonce(CANDIDATE_ID, PARENT_HASH, "dev_BBBBBBBB"), raw);
  const c = saltedHash(saltNonce(CANDIDATE_ID, sha256Hex("autre-parent"), "dev_AAAAAAAA"), raw);
  assert.notEqual(a, b); assert.notEqual(a, c);
  assert.notEqual(a, sha256Hex(raw), "différent du hash brut");
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("vote signé : le message se relit à l'identique, la signature Ed25519 est vérifiée par le vérificateur DU SERVEUR (lib/ed25519.ts)", () => {
  const v = fixture.vote;
  assert.equal(voteMessageV3(v.fields), v.message);
  assert.deepEqual(parseVoteMessageV3(v.message), v.fields);
  assert.equal(verifyEd25519(v.publicKeyHex, v.message, v.signatureHex), true);
  assert.equal(verifyEd25519(v.publicKeyHex, v.message.replace("|C0", "|C1"), v.signatureHex), false, "changer la classe invalide la signature");
  assert.equal(verifyEd25519(v.publicKeyHex, v.message.replace("|accept|ok|", "|reject|uniform|"), v.signatureHex), false, "changer le verdict invalide la signature");
  assert.equal(v.message.split("|").length, 14);
  assert.ok(v.message.startsWith("pod-vote-v3|"), "préfixe de domaine : pas de rejeu d'un vote v2");
});

test("lecture stricte : tout message hors forme canonique est refusé", () => {
  const good = fixture.vote.message as string;
  const bad = [
    good.replace("pod-vote-v3", "pod-vote-v2"), good + "|extra", good.replace("|accept|ok|", "|accept|uniform|"), good.replace("|accept|ok|", "|reject|ok|"),
    good.replace("|523000|", "|0523000|"), good.replace("|523000|", "|1000001|"), good.replace(/\|C0$/, "|C9"), good.replace("dev_AB12CD34", "dev_ab12cd34"), good.replace(PARENT_HASH, PARENT_HASH.toUpperCase()), "",
  ];
  for (const m of bad) assert.equal(parseVoteMessageV3(m), null, m.slice(0, 60));
});

test("Merkle : racines stables, preuves d'inclusion valides, preuve refusée si la feuille, la racine ou le côté change", () => {
  const leaves = (n: number) => Array.from({ length: n }, (_, i) => voteLeaf(`m${i}`, "ab".repeat(64), "cd".repeat(32)));
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const L = leaves(n), rootHex = merkleRoot(L);
    for (let i = 0; i < n; i++) assert.equal(verifyMerkleProof(L[i], merkleProof(L, i), rootHex), true, `n=${n} i=${i}`);
  }
  const L = leaves(5), rootHex = merkleRoot(L), proof = merkleProof(L, 2);
  assert.equal(verifyMerkleProof(L[3], proof, rootHex), false);
  assert.equal(verifyMerkleProof(L[2], proof, sha256Hex("x")), false);
  assert.equal(verifyMerkleProof(L[2], proof.map((s) => ({ ...s, side: s.side === "left" ? "right" as const : "left" as const })), rootHex), false);
  assert.notEqual(merkleRoot(leaves(3)), merkleRoot([...leaves(3), leaves(3)[2]]), "pas de duplication du dernier nœud : [a,b,c] ≠ [a,b,c,c]");
  assert.equal(merkleRoot([]), sha256Hex("pod-merkle-v3-empty"));
  assert.throws(() => merkleProof(L, 5));
});

test("comité : auteur exclu, un profil une fois, K ≤ 7, seuil ⌈2K/3⌉, bootstrap sous 3 profils, rang déterministe et indépendant de l'ordre d'entrée", () => {
  const P = ["art_alice", "art_bob", "art_carol", "art_dave", "art_erin", "art_frank", "art_grace", "art_heidi", "art_ivan"];
  const a = selectCommittee({ eligibleProfiles: P, authorProfileId: "art_carol", contentHash: CONTENT_HASH, parentHash: PARENT_HASH });
  const b = selectCommittee({ eligibleProfiles: [...P].reverse().concat(P), authorProfileId: "art_carol", contentHash: CONTENT_HASH, parentHash: PARENT_HASH });
  assert.deepEqual(a, b, "doublons et ordre sans effet");
  assert.ok(!a.ranked.includes("art_carol"), "auteur exclu");
  assert.equal(a.ranked.length, 8); assert.equal(a.K, COMMITTEE_MAX); assert.equal(a.threshold, 5); assert.equal(a.mode, "committee");
  assert.equal(committeeWindow(a, 1).length, 7); assert.equal(committeeWindow(a, 2).length, 8, "vague 2 bornée par 2K et par les éligibles");
  const other = selectCommittee({ eligibleProfiles: P, authorProfileId: "art_carol", contentHash: CONTENT_HASH, parentHash: sha256Hex("autre parent") });
  assert.notDeepEqual(a.ranked, other.ranked, "le tirage dépend du bloc précédent");
  for (const [K, T] of [[1, 1], [2, 2], [3, 2], [4, 3], [5, 4], [6, 4], [7, 5]]) assert.equal(threshold(K), T, `K=${K}`);
  assert.equal(selectCommittee({ eligibleProfiles: ["art_alice", "art_bob"], authorProfileId: null, contentHash: CONTENT_HASH, parentHash: PARENT_HASH }).mode, "bootstrap");
  assert.equal(BOOTSTRAP_BELOW, 3);
  const none = selectCommittee({ eligibleProfiles: ["art_carol"], authorProfileId: "art_carol", contentHash: CONTENT_HASH, parentHash: PARENT_HASH });
  assert.equal(none.mode, "none"); assert.equal(decide(none, 1, new Map()).state, "pending");
  const big = selectCommittee({ eligibleProfiles: Array.from({ length: 500 }, (_, i) => `art_${i}`), authorProfileId: null, contentHash: CONTENT_HASH, parentHash: PARENT_HASH });
  assert.equal(committeeWindow(big, 2).length, 14, "500 profils : jamais plus de 14 votes comptés (coût borné)");
});

test("décision : accepter exige ≥ T approbations ET ≤ K−T refus ; refuser dès K−T+1 refus ; les votes hors fenêtre sont ignorés", () => {
  const P = Array.from({ length: 9 }, (_, i) => `art_${i}`);
  const c = selectCommittee({ eligibleProfiles: P, authorProfileId: null, contentHash: CONTENT_HASH, parentHash: PARENT_HASH });   // K = 7, T = 5, tolérance 2 refus
  const w = committeeWindow(c, 1);
  const votes = (acc: number, rej: number): Map<string, Verdict> => { const m = new Map<string, Verdict>(); w.slice(0, acc).forEach((p) => m.set(p, "accept")); w.slice(acc, acc + rej).forEach((p) => m.set(p, "reject")); return m; };
  assert.equal(decide(c, 1, votes(4, 0)).state, "pending");
  assert.equal(decide(c, 1, votes(5, 0)).state, "accept");
  assert.equal(decide(c, 1, votes(5, 2)).state, "accept");
  assert.equal(decide(c, 1, votes(4, 3)).state, "reject");
  assert.equal(decide(c, 1, votes(0, 3)).state, "reject");
  assert.equal(decide(c, 1, new Map([...votes(3, 0), ...c.ranked.slice(7).map((p) => [p, "accept"] as [string, Verdict])])).state, "pending", "des approbations hors fenêtre ne comptent pas en vague 1");
  assert.equal(decide(c, 2, new Map([...votes(3, 0), ...c.ranked.slice(7).map((p) => [p, "accept"] as [string, Verdict])])).state, "accept", "vague 2 (repli séquentiel) : les suppléants des rangs 8-9 comptent : 3 + 2 = 5 ≥ T");
  assert.equal(decide(c, 2, new Map([...votes(3, 0), ["art_inconnu", "accept" as Verdict]])).state, "pending", "un profil hors classement ne compte jamais");
  const bootstrap = selectCommittee({ eligibleProfiles: ["art_a", "art_b"], authorProfileId: null, contentHash: CONTENT_HASH, parentHash: PARENT_HASH });
  assert.equal(decide(bootstrap, 1, new Map([["art_a", "accept" as Verdict]])).state, "pending", "bootstrap : tous les membres doivent approuver");
  assert.equal(decide(bootstrap, 1, new Map([["art_a", "accept" as Verdict], ["art_b", "accept" as Verdict]])).state, "accept");
  assert.equal(decide(bootstrap, 1, new Map([["art_a", "reject" as Verdict]])).state, "reject");
});

test("mineur : déterministe, rejouable, pondéré en sens inverse du nombre de blocs ; aucun appel à Math.random ni Date.now dans le module", () => {
  const accepted = [{ profileId: "art_dave", minedBlocks: 12 }, { profileId: "art_bob", minedBlocks: 0 }, { profileId: "art_alice", minedBlocks: 3 }];
  const base = { parentHash: PARENT_HASH, contentHash: CONTENT_HASH, votesRoot: sha256Hex("reçus") };
  const w1 = drawMiner({ ...base, accepted });
  const w2 = drawMiner({ ...base, accepted: [...accepted].reverse() });
  assert.equal(w1, w2, "l'ordre d'entrée est sans effet");
  assert.equal(drawMiner({ ...base, accepted: [] }), null);
  assert.equal(drawMiner({ ...base, accepted: [{ profileId: "art_solo", minedBlocks: 9 }] }), "art_solo");
  assert.equal(minerWeight(0), 1_000_000); assert.equal(minerWeight(3), 250_000); assert.equal(minerWeight(12), 76_923);
  // audit GPT : à partir de 10⁶ blocs le poids valait 0 (somme nulle ⇒ RangeError « Division by zero ») ; il est désormais ≥ 1 TOUJOURS
  for (const n of [999_999, 1_000_000, 1_000_001, 10_000_000, 4_294_967_295, 2 ** 40, Number.MAX_SAFE_INTEGER]) assert.ok(minerWeight(n) >= 1, String(n));
  assert.equal(minerWeight(999_999), 1); assert.equal(minerWeight(1_000_000), 1); assert.equal(minerWeight(-5), 1_000_000); assert.equal(minerWeight(NaN), 1_000_000); assert.equal(minerWeight(Infinity), 1_000_000);
  const huge = [{ profileId: "art_a", minedBlocks: 1_000_000 }, { profileId: "art_b", minedBlocks: 4_294_967_295 }];
  assert.doesNotThrow(() => drawMiner({ parentHash: PARENT_HASH, contentHash: CONTENT_HASH, votesRoot: sha256Hex("x"), accepted: huge }));
  assert.ok(["art_a", "art_b"].includes(drawMiner({ parentHash: PARENT_HASH, contentHash: CONTENT_HASH, votesRoot: sha256Hex("x"), accepted: huge })!));
  // équité statistique : sur 3000 tirages (reçus différents), le profil sans bloc gagne nettement plus que celui qui en a 12
  const wins: Record<string, number> = {};
  for (let i = 0; i < 3000; i++) { const id = drawMiner({ ...base, votesRoot: sha256Hex(`reçus${i}`), accepted })!; wins[id] = (wins[id] ?? 0) + 1; }
  assert.ok(wins.art_bob > wins.art_alice && wins.art_alice > wins.art_dave, JSON.stringify(wins));
  const src = fs.readFileSync(path.join(root, "lib", "podProtocolV3.ts"), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /Math\.random|Date\.now|new Date/);
});

test("bloc v2 : ordre des clés figé, score en ppm ENTIER, hash change si un champ change ; les validateurs sont triés", () => {
  const b = fixture.block.fields;
  assert.equal(blockHashV2(b), fixture.block.hash);
  assert.match(fixture.block.canonical, /^\{"blockVersion":2,"metricsVersion":2,"rulesVersion":1,"parentHash":/);
  assert.ok(Number.isInteger(b.scorePpm));
  assert.equal(blockHashV2({ ...b, validatorProfileIds: [...b.validatorProfileIds].reverse() }), fixture.block.hash, "l'ordre des validateurs est sans effet");
  for (const patch of [{ scorePpm: b.scorePpm + 1 }, { votesRoot: sha256Hex("x") }, { committeeK: 5 }, { minedAt: b.minedAt + 1 }, { parentHash: sha256Hex("p") }]) assert.notEqual(blockHashV2({ ...b, ...patch }), fixture.block.hash);
});

test("réputation : seules les contradictions DÉMONTRABLES comptent ; une divergence cohérente est un « dispute » neutre", () => {
  const events = Object.fromEntries(fixture.reputation.map((r: { name: string; event: string }) => [r.name, r.event]));
  assert.equal(events["accept conforme"], "validAccept");
  assert.equal(events["accept avec métriques fausses"], "falseAccept");
  assert.equal(events["accept avec hash faux"], "falseAccept");
  assert.equal(events["reject uniform justifié"], "validReject");
  assert.equal(events["reject uniform alors que la référence ne l'est pas, mêmes mesures signées"], "falseReject");
  assert.equal(events["reject uniform avec mesures différentes de la référence"], "dispute");
  assert.equal(events["reject hash en signant le même hash que la référence"], "falseReject");
  assert.equal(events["reject hash en signant un autre hash"], "dispute");
  const v = fixture.vote.fields as VoteV3;
  assert.equal(classifyVote({ ...v, verdict: "reject", ruleCode: "format" }, { rawHash: v.rawHash, e: v.e, t: v.t, r: v.r }), "dispute", "format : non démontrable par le contenu seul");
});

test("le module de référence n'est branché sur AUCUNE route ni aucun firmware (brouillon non gelé)", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next", ".git", "firmware-backups", ".claude"].includes(e.name)) walk(rel); }
    else if (/\.(tsx?|ino|h)$/.test(e.name) && fs.readFileSync(path.join(root, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").includes("podProtocolV3")) offenders.push(rel.replace(/\\/g, "/"));
  } };
  for (const d of ["app", "lib", "esp8266", "arduino_uno_r4"]) walk(d);
  // Importeurs AUTORISÉS : le simulateur S1 (hors ligne), le bloc v2 / vérificateur (lot 3) et le comité / mineur / réputation (lot 4) — tous derrière des interrupteurs éteints par défaut. Le MESSAGE DE VOTE v3 (voteMessageV3) n'est branché nulle part.
  assert.deepEqual(offenders.filter((f) => !["lib/podProtocolV3.ts", "lib/podSim.ts", "lib/blockReceipts.ts", "lib/podVerify.ts", "lib/committee.ts", "lib/reputation.ts", "lib/chain.ts", "lib/animV3.ts", "lib/podVerifyAnim.ts"].includes(f)), []);   // animV3 : référence pure des animations (6B-1) ; podVerifyAnim : vérificateur de bloc animation (6B-2) — aucune route de vote
  assert.ok(DEVICE_ID.startsWith("dev_"));
});

test("graine du comité : issue de la CHAÎNE et du CONTENU (jamais du candidatId choisi par le serveur) ; le mineur dépend en plus des REÇUS finalisés", () => {
  const P = ["art_alice", "art_bob", "art_carol", "art_dave", "art_erin", "art_frank", "art_grace", "art_heidi", "art_ivan"];
  const pick = (content: string, parent: string) => selectCommittee({ eligibleProfiles: P, authorProfileId: null, contentHash: content, parentHash: parent }).ranked;
  assert.deepEqual(pick(CONTENT_HASH, PARENT_HASH), pick(CONTENT_HASH, PARENT_HASH), "rejouable");
  assert.notDeepEqual(pick(CONTENT_HASH, PARENT_HASH), pick(sha256Hex("autre image"), PARENT_HASH), "un autre contenu change le tirage");
  assert.notDeepEqual(pick(CONTENT_HASH, PARENT_HASH), pick(CONTENT_HASH, sha256Hex("autre parent")), "un autre bloc précédent change le tirage");
  assert.equal(committeeSeed(PARENT_HASH, CONTENT_HASH), fixture.committee.seed);
  assert.equal(committeeSeed.length, 2, "la graine ne prend que (parentHash, contentHash) : aucun candidatId");
  const src = fs.readFileSync(path.join(root, "lib", "podProtocolV3.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const fnBodies = src.match(/export const (?:committeeSeed|committeeRank|minerSeed)[^\n]*/g) ?? [];
  assert.equal(fnBodies.length, 3);
  for (const f of fnBodies) assert.doesNotMatch(f, /candidateId/, f);
  // le miner change si les reçus changent (le serveur ne peut pas viser un mineur avant d'avoir les votes)
  const accepted = P.slice(0, 5).map((profileId) => ({ profileId, minedBlocks: 0 }));
  const winners = new Set(Array.from({ length: 40 }, (_, i) => drawMiner({ parentHash: PARENT_HASH, contentHash: CONTENT_HASH, votesRoot: sha256Hex(`r${i}`), accepted })));
  assert.ok(winners.size > 1, "le tirage varie avec les reçus");
});

test("règle des sièges : l'électorat effectif ne dépasse JAMAIS K (les suppléants remplacent les silencieux) ; les K premiers RANGS comptent", () => {
  const P = Array.from({ length: 9 }, (_, i) => `art_${i}`);
  const c = selectCommittee({ eligibleProfiles: P, authorProfileId: null, contentHash: CONTENT_HASH, parentHash: PARENT_HASH });   // K = 7, T = 5, tolérance 2 ; rangs 0..8
  // les 9 profils votent : rangs 0-4 approuvent, rangs 5-8 refusent
  const all = new Map<string, Verdict>(c.ranked.map((p, i) => [p, i < 5 ? "accept" : "reject"]));
  assert.deepEqual(effectiveVoters(c, 2, all), c.ranked.slice(0, 7), "seuls les 7 premiers rangs comptent");
  const d = decide(c, 2, all);
  assert.deepEqual([d.accepts, d.rejects, d.state], [5, 2, "accept"], "5 approbations, 2 refus tolérés : accepté (l'ancienne règle « fenêtre » aurait compté 4 refus et refusé)");
  // silencieux : les rangs 1 et 3 se taisent ; les suppléants (rangs 7 et 8) les remplacent dans l'ordre des rangs
  const silent = new Map(all); silent.delete(c.ranked[1]); silent.delete(c.ranked[3]);
  assert.deepEqual(effectiveVoters(c, 2, silent), [c.ranked[0], c.ranked[2], c.ranked[4], c.ranked[5], c.ranked[6], c.ranked[7], c.ranked[8]]);
  assert.equal(effectiveVoters(c, 1, silent).length, 5, "en vague 1 il n'y a pas de suppléants");
  // un vote tardif d'un rang meilleur prend la place d'un rang plus bas (déterministe, rejouable depuis les reçus)
  const late = new Map<string, Verdict>(); late.set(c.ranked[8], "accept");
  assert.deepEqual(effectiveVoters(c, 2, late), [c.ranked[8]]);
  assert.ok(effectiveVoters(c, 2, all).length <= c.K);
});
