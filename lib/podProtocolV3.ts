// lib/podProtocolV3.ts — IMPLÉMENTATION DE RÉFÉRENCE (pure, sans Redis, sans réseau) du protocole de consensus « v3 ».
//
// ⚠ BROUILLON À GELER PAR GPT (Lot 1, docs/SPEC_PROTOCOLE_V3.md). Ce module N'EST BRANCHÉ SUR AUCUNE ROUTE : il ne change ni le vote v2, ni le quorum, ni les blocs existants,
// ni aucun firmware. Il fixe les FORMATS (message signé, nonce, règles, racine de Merkle, comité, mineur, bloc v2) et produit les vecteurs d'or
// (tests/fixtures/pod-v3-vectors.json) que les autres implémentations (vérificateur indépendant, C++ hôte, firmwares) devront reproduire à l'octet près.
// Aucune fonction ici n'appelle Math.random() ni Date.now() : tout est rejouable par un tiers.

import { createHash } from "node:crypto";

export const PROTOCOL = { voteVersion: 3, metricsVersion: 2, rulesVersion: 1, blockVersion: 2 } as const;
export const PPM = 1_000_000;

// ─── Hachage ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();
export const sha256Hex = (data: Uint8Array | string): string => sha256(data).toString("hex");
const HEX64 = /^[0-9a-f]{64}$/;
const DEVICE_RE = /^dev_[A-Z0-9]{8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ─── Règles N2 (rulesVersion 1) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Objectives uniquement : jamais de critère esthétique. « uniform » remplace le motif v2 « blank » (une image TOUTE PLEINE est aussi uniforme).
export const RULE_CODES = ["ok", "hash", "metrics", "uniform", "noise", "format", "rules"] as const;
export type RuleCode = (typeof RULE_CODES)[number];
export type Verdict = "accept" | "reject";
export const VOTE_CLASSES = ["C0", "C1", "C2"] as const;
export type VoteClass = (typeof VOTE_CLASSES)[number];

export const NOISE_E = 980_000;
export const NOISE_T = 900_000;

/** Ordre d'évaluation figé : format → hash → uniform → noise → ok. Le serveur ET les appareils appliquent EXACTEMENT cette fonction. */
export function evaluateRules(input: { formatOk: boolean; hashOk: boolean; e: number; t: number }): { verdict: Verdict; ruleCode: RuleCode } {
  if (!input.formatOk) return { verdict: "reject", ruleCode: "format" };
  if (!input.hashOk) return { verdict: "reject", ruleCode: "hash" };
  if (input.e === 0 && input.t === 0) return { verdict: "reject", ruleCode: "uniform" };
  if (input.e > NOISE_E && input.t > NOISE_T) return { verdict: "reject", ruleCode: "noise" };
  return { verdict: "accept", ruleCode: "ok" };
}

// ─── Hash salé par appareil (preuve de lecture) ─────────────────────────────────────────────────────────────────────────────────────────
/** nonce = SHA-256("pod-nonce-v3|" candidateId "|" parentHash "|" deviceId) — 32 octets bruts. */
export function saltNonce(candidateId: string, parentHash: string, deviceId: string): Buffer {
  return sha256(`pod-nonce-v3|${candidateId}|${parentHash}|${deviceId}`);
}
/** saltedHash = SHA-256( nonce ‖ contenu brut ) en hexadécimal minuscule. Recopier la réponse d'un autre appareil est impossible (le nonce contient deviceId). */
export function saltedHash(nonce: Uint8Array, raw: Uint8Array): string {
  return createHash("sha256").update(nonce).update(raw).digest("hex");
}

// ─── Message de vote v3 (signé en Ed25519, UTF-8) ───────────────────────────────────────────────────────────────────────────────────────
export interface VoteV3 {
  deviceId: string; candidateId: string; parentHash: string;
  metricsVersion: number; rulesVersion: number;
  rawHash: string; saltedHash: string;
  e: number; t: number; r: number;
  verdict: Verdict; ruleCode: RuleCode; vclass: VoteClass;
}

export function voteMessageV3(v: VoteV3): string {
  return ["pod-vote-v3", v.deviceId, v.candidateId, v.parentHash, v.metricsVersion, v.rulesVersion, v.rawHash, v.saltedHash, v.e, v.t, v.r, v.verdict, v.ruleCode, v.vclass].join("|");
}

const isPpm = (n: number) => Number.isInteger(n) && n >= 0 && n <= PPM;

/** Lecture stricte d'un message signé (null = invalide). Un accept porte `ok`, un reject ne porte JAMAIS `ok`. */
export function parseVoteMessageV3(msg: string): VoteV3 | null {
  const p = msg.split("|");
  if (p.length !== 14 || p[0] !== "pod-vote-v3") return null;
  const [, deviceId, candidateId, parentHash, mv, rv, rawHash, salted, es, ts, rs, verdict, ruleCode, vclass] = p;
  const num = (s: string) => (/^\d{1,7}$/.test(s) ? Number(s) : NaN);
  const v: VoteV3 = { deviceId, candidateId, parentHash, metricsVersion: num(mv), rulesVersion: num(rv), rawHash, saltedHash: salted, e: num(es), t: num(ts), r: num(rs), verdict: verdict as Verdict, ruleCode: ruleCode as RuleCode, vclass: vclass as VoteClass };
  if (!DEVICE_RE.test(deviceId) || !UUID_RE.test(candidateId) || !HEX64.test(parentHash) || !HEX64.test(rawHash) || !HEX64.test(salted)) return null;
  if (!isPpm(v.e) || !isPpm(v.t) || !isPpm(v.r) || !Number.isInteger(v.metricsVersion) || !Number.isInteger(v.rulesVersion)) return null;
  if (verdict !== "accept" && verdict !== "reject") return null;
  if (!(RULE_CODES as readonly string[]).includes(ruleCode) || !(VOTE_CLASSES as readonly string[]).includes(vclass)) return null;
  if ((verdict === "accept") !== (ruleCode === "ok")) return null;
  return voteMessageV3(v) === msg ? v : null;   // forme canonique uniquement (pas de zéros en tête, pas d'espaces)
}

// ─── Racine de Merkle des reçus (votesRoot) ─────────────────────────────────────────────────────────────────────────────────────────────
// feuille = SHA-256( 0x00 ‖ UTF-8( message "|" signatureHex "|" clePubliqueHex ) ) ; nœud = SHA-256( 0x01 ‖ gauche ‖ droite ) ; un nœud IMPAIR est PROMU tel quel
// (pas de duplication) ; ordre des feuilles = ordre des rangs du comité (déterministe) ; arbre vide = SHA-256("pod-merkle-v3-empty").
export function voteLeaf(message: string, sigHex: string, pubHex: string): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(`${message}|${sigHex}|${pubHex}`, "utf8")]));
}
const node = (l: Buffer, r: Buffer) => sha256(Buffer.concat([Buffer.from([0x01]), l, r]));

export function merkleRoot(leaves: Buffer[]): string {
  if (leaves.length === 0) return sha256Hex("pod-merkle-v3-empty");
  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0].toString("hex");
}

export interface MerkleStep { sibling: string; side: "left" | "right" }
export function merkleProof(leaves: Buffer[], index: number): MerkleStep[] {
  if (index < 0 || index >= leaves.length) throw new Error("index hors arbre");
  const proof: MerkleStep[] = [];
  let level = leaves, i = index;
  while (level.length > 1) {
    const sib = i ^ 1;
    if (sib < level.length) proof.push({ sibling: level[sib].toString("hex"), side: sib < i ? "left" : "right" });
    const next: Buffer[] = [];
    for (let k = 0; k < level.length; k += 2) next.push(k + 1 < level.length ? node(level[k], level[k + 1]) : level[k]);
    level = next; i = i >> 1;
  }
  return proof;
}
export function verifyMerkleProof(leaf: Buffer, proof: MerkleStep[], rootHex: string): boolean {
  let h = leaf;
  for (const s of proof) {
    if (!HEX64.test(s.sibling)) return false;
    const sib = Buffer.from(s.sibling, "hex");
    h = s.side === "left" ? node(sib, h) : node(h, sib);
  }
  return h.toString("hex") === rootHex;
}

// ─── Comité (profils éligibles → membres, rangs, seuil, décision) ───────────────────────────────────────────────────────────────────────
export const COMMITTEE_MAX = 7;
export const BOOTSTRAP_BELOW = 3;   // moins de 3 profils éligibles non-auteurs ⇒ mode « bootstrap » (validation partielle, étiquetée)

/**
 * GRAINE du comité = SHA-256("pod-committee-seed-v3|" parentHash "|" contentHash). Elle dérive de la CHAÎNE (parentHash) et du CONTENU (rawHash d'une image fixe, animRoot d'une animation) :
 * elle ne dépend PAS du candidateId (un UUID que le serveur choisit : il aurait pu en essayer plusieurs) ni d'un horodatage. Le contenu est celui que les appareils recalculent : toute
 * personne qui a le bloc précédent et l'image retrouve la même graine.
 * Limite assumée (grinding) : l'AUTEUR peut modifier quelques pixels pour changer la graine ; il ne peut ni voter (exclu), ni connaître d'avance les profils malveillants
 * éligibles sans les avoir déjà ; la parade est l'éligibilité (appairage, ancienneté), pas la cryptographie (docs/SPEC_PROTOCOLE_V3.md § 9).
 */
export const committeeSeed = (parentHash: string, contentHash: string): string => sha256Hex(`pod-committee-seed-v3|${parentHash}|${contentHash}`);
/** rang = SHA-256("pod-committee-v3|" graine "|" profileId) ; tri croissant (hex), puis profileId. */
export const committeeRank = (seed: string, profileId: string): string => sha256Hex(`pod-committee-v3|${seed}|${profileId}`);
export const threshold = (K: number): number => Math.ceil((2 * K) / 3);

export interface Committee {
  mode: "none" | "bootstrap" | "committee";
  K: number;
  threshold: number;
  /** profils éligibles (auteur exclu) classés ; la 1ʳᵉ vague = les K premiers, la 2ᵉ (repli séquentiel) = les min(2K, n) premiers. */
  ranked: string[];
}

export function selectCommittee(input: { eligibleProfiles: readonly string[]; authorProfileId: string | null; contentHash: string; parentHash: string; bootstrap?: boolean }): Committee {
  const seed = committeeSeed(input.parentHash, input.contentHash);
  const pool = [...new Set(input.eligibleProfiles)].filter((p) => p !== input.authorProfileId);
  const ranked = pool.map((p) => ({ p, r: committeeRank(seed, p) })).sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : a.p < b.p ? -1 : a.p > b.p ? 1 : 0)).map((x) => x.p);
  if (ranked.length === 0) return { mode: "none", K: 0, threshold: 0, ranked };
  const K = Math.min(COMMITTEE_MAX, ranked.length);
  // « bootstrap » : sous BOOTSTRAP_BELOW profils, OU imposé par l'appelant (le plan d'éligibilité a dû admettre les profils de l'auteur) ; seuil = TOUS les membres
  const boot = input.bootstrap === true || ranked.length < BOOTSTRAP_BELOW;
  return { mode: boot ? "bootstrap" : "committee", K, threshold: boot ? K : threshold(K), ranked };
}

/** Membres dont le vote compte : vague 1 = K premiers, vague 2 (après délai sans décision) = jusqu'à 2K. Borne le coût (≤ 2K votes) quel que soit le nombre d'appareils. */
export const committeeWindow = (c: Committee, wave: 1 | 2): string[] => c.ranked.slice(0, wave === 1 ? c.K : Math.min(2 * c.K, c.ranked.length));

/**
 * RÈGLE DES SIÈGES (simulateur S1, docs/SIMULATION_PROTOCOLE_V3_2026_10_07.md) : parmi les votants de la fenêtre, seuls les K PREMIERS RANGS comptent. Les suppléants de la vague 2 ne font que
 * remplacer les silencieux : l'électorat effectif ne grossit jamais. (Avec la fenêtre qui double et une tolérance de refus inchangée, 20 % de profils malhonnêtes refusaient à tort 32 % des bons
 * contenus ; avec les sièges : 17 %.) Les reçus enregistrés d'un bloc sont exactement ces votants effectifs, dans l'ordre des rangs (≤ K).
 */
export function effectiveVoters(c: Committee, wave: 1 | 2, votes: ReadonlyMap<string, Verdict>): string[] {
  const out: string[] = [];
  for (const m of committeeWindow(c, wave)) { if (votes.has(m)) out.push(m); if (out.length >= c.K) break; }
  return out;
}

export type Decision = { state: "pending" | "accept" | "reject"; accepts: number; rejects: number; needed: number; rejectLimit: number };
/**
 * Décision rejouable sur les votants EFFECTIFS (règle des sièges). accept ⇔ accepts ≥ T ET rejects ≤ K−T ; reject ⇔ rejects ≥ K−T+1. Une finalisation « accept » dont le jeu de votes
 * ENREGISTRÉ ne satisfait pas ces deux conditions est invalide (un vérificateur le détecte).
 */
export function decide(c: Committee, wave: 1 | 2, votes: ReadonlyMap<string, Verdict>): Decision {
  let accepts = 0, rejects = 0;
  for (const profile of effectiveVoters(c, wave, votes)) { if (votes.get(profile) === "accept") accepts++; else rejects++; }
  const needed = c.threshold, rejectLimit = c.K - c.threshold;   // rejets tolérés
  if (c.mode === "none") return { state: "pending", accepts, rejects, needed, rejectLimit };
  if (accepts >= needed && rejects <= rejectLimit) return { state: "accept", accepts, rejects, needed, rejectLimit };
  if (rejects >= rejectLimit + 1) return { state: "reject", accepts, rejects, needed, rejectLimit };
  return { state: "pending", accepts, rejects, needed, rejectLimit };
}

// ─── Mineur déterministe (équité conservée : poids inverse du nombre de blocs déjà minés) ─────────────────────────────────────────────────
/** graine du mineur = SHA-256("pod-miner-v3|" graine du comité "|" votesRoot) : elle dépend des REÇUS FINALISÉS (que ni le serveur ni l'auteur ne peuvent choisir avant le vote). */
export const minerSeed = (seed: string, votesRoot: string): string => sha256Hex(`pod-miner-v3|${seed}|${votesRoot}`);
export const minerWeight = (minedBlocks: number): number => Math.floor(PPM / (minedBlocks + 1));

/** Parmi les profils ayant approuvé (liste triée par profileId pour être canonique) : tirage = (8 premiers octets de la graine) mod somme des poids. */
export function drawMiner(input: { parentHash: string; contentHash: string; votesRoot: string; accepted: readonly { profileId: string; minedBlocks: number }[] }): string | null {
  const list = [...input.accepted].sort((a, b) => (a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0));
  if (list.length === 0) return null;
  const total = list.reduce((s, x) => s + BigInt(minerWeight(x.minedBlocks)), BigInt(0));
  let u = BigInt("0x" + minerSeed(committeeSeed(input.parentHash, input.contentHash), input.votesRoot).slice(0, 16)) % total;
  for (const x of list) { const w = BigInt(minerWeight(x.minedBlocks)); if (u < w) return x.profileId; u -= w; }
  return list[list.length - 1].profileId;   // inatteignable (u < total)
}

// ─── Bloc v2 : hachage canonique (ordre des clés FIGÉ ; score en ppm ENTIER, plus de flottant) ──────────────────────────────────────────
export interface BlockCanonicalV2 {
  parentHash: string; imageHash: string; actionsHash: string;
  /** rawHash (image fixe) ou animRoot (animation) : permet à un tiers de RECALCULER la graine du comité et du mineur. */
  contentHash: string;
  deviceId: string; poolScreen: string;
  validatorProfileIds: string[]; scorePpm: number; minedAt: number; animRoot?: string;
  votesRoot: string;
  /** « quorum » = règle HISTORIQUE (⌈0,51 × électorat⌉, committeeK = taille de l'électorat) : transitoire, avant le comité (lot 4) */
  committeeMode: Committee["mode"] | "quorum"; committeeK: number;
}
export function blockCanonicalV2(b: BlockCanonicalV2): string {
  return JSON.stringify({
    blockVersion: PROTOCOL.blockVersion, metricsVersion: PROTOCOL.metricsVersion, rulesVersion: PROTOCOL.rulesVersion,
    parentHash: b.parentHash, imageHash: b.imageHash, actionsHash: b.actionsHash, contentHash: b.contentHash, deviceId: b.deviceId, poolScreen: b.poolScreen,
    validatorProfileIds: [...b.validatorProfileIds].sort(), scorePpm: b.scorePpm, minedAt: b.minedAt,
    ...(b.animRoot ? { animRoot: b.animRoot } : {}),
    votesRoot: b.votesRoot, committeeMode: b.committeeMode, committeeK: b.committeeK,
  });
}
export const blockHashV2 = (b: BlockCanonicalV2): string => sha256Hex(blockCanonicalV2(b));

// ─── Réputation : événements OBJECTIVEMENT démontrables seulement ───────────────────────────────────────────────────────────────────────
// Jamais « minoritaire ⇒ menteur ». `dispute` (le vote est cohérent en interne mais diffère de la référence) est NEUTRE : aucune pénalité.
export type ReputationEvent = "validAccept" | "validReject" | "falseAccept" | "falseReject" | "dispute";
export interface ReferenceV2 { rawHash: string; e: number; t: number; r: number }

export function classifyVote(vote: VoteV3, ref: ReferenceV2): ReputationEvent {
  const hashOk = vote.rawHash === ref.rawHash;
  const metricsOk = vote.e === ref.e && vote.t === ref.t && vote.r === ref.r;
  const expected = evaluateRules({ formatOk: true, hashOk: true, e: ref.e, t: ref.t });
  if (vote.verdict === "accept") return hashOk && metricsOk && expected.verdict === "accept" ? "validAccept" : "falseAccept";
  // reject : valide si le motif invoqué est vrai pour la RÉFÉRENCE ; contradictoire si l'appareil signe lui-même des valeurs qui INFIRMENT son motif
  if (vote.ruleCode === "hash") return hashOk ? "falseReject" : "dispute";                         // « mon hash diffère » alors qu'il signe le même hash
  if (vote.ruleCode === "uniform" || vote.ruleCode === "noise") {
    if (expected.ruleCode === vote.ruleCode && metricsOk) return "validReject";
    return metricsOk ? "falseReject" : "dispute";                                                   // mêmes mesures que la référence mais motif faux ⇒ prouvé faux
  }
  if (vote.ruleCode === "metrics") return metricsOk && hashOk ? "falseReject" : "dispute";
  return "dispute";                                                                                  // format / rules : non démontrable par le contenu seul
}
