// lib/animV3.ts — RÉFÉRENCE PURE « pod-anim-v3 » : validation CALCULÉE d'une animation (clip PBC1). Lot 6B-1 (docs/SPEC_PODANIM_V3.md, R2).
//
// Pur : aucun Redis, aucun réseau, aucune route, aucun firmware. Il ne fait qu'une chose — à partir des OCTETS d'un clip PBC1, calculer exactement ce qu'un appareil recalcule en flux :
//   clipHash · pour chaque image : empreinte, e/t/r/s entiers (pod-metrics-2 sur la grille logique 128×64) et feuille de Merkle · framesRoot · animRoot · agrégats E/T/R/S · règles A1.
// Le noyau C++ (consensus-pod/src/podAnimV3.h) est vérifié BIT À BIT contre ce fichier (tests/animV3Core.test.ts, consensus-pod/test-vectors/anim-vectors.txt).
// Rien ici ne « juge » l'animation : les règles sont objectives (format, hash, statique, bruit pur).

import { CLIP, clipPixel, decodeClip } from "@/lib/bench/clip";
import { MetricsAccumulator, PPM } from "@/lib/podMetrics";
import { NOISE_E, NOISE_T, VOTE_CLASSES, merkleRoot, sha256, sha256Hex, type Verdict, type VoteClass } from "@/lib/podProtocolV3";

export const ANIM_V3 = {
  rulesVersion: 2,
  metricsVersion: 2,
  minFrames: 2,
  maxFrames: CLIP.MAX_FRAMES,
  maxClipBytes: CLIP.MAX_CLIP_BYTES,
  /** durée d'UN tour (loops = 0 imposé) */
  maxPlayMs: CLIP.MAX_PLAY_MS,
  votePrefix: "pod-vote-v3-anim",
  rootPrefix: "pod-anim-v3|pbc1|",
  leafTag: 0x02,
} as const;

/** Codes de règle d'une animation (jeu A1). `uniform` n'existe PAS pour les animations (une alternance noir/blanc est légitime). */
export const ANIM_RULE_CODES = ["ok", "format", "hash", "static", "noise", "rules"] as const;
export type AnimRuleCode = (typeof ANIM_RULE_CODES)[number];

const HEX64 = /^[0-9a-f]{64}$/;
const DEVICE_RE = /^dev_[A-Z0-9]{8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ─── Règles A1 (ordre FIGÉ : format → hash → static → noise → ok) ──────────────────────────────────────────────────────────────────────────
export function evaluateAnimRules(input: { formatOk: boolean; hashOk: boolean; allIdentical: boolean; E: number; T: number }): { verdict: Verdict; ruleCode: AnimRuleCode } {
  if (!input.formatOk) return { verdict: "reject", ruleCode: "format" };
  if (!input.hashOk) return { verdict: "reject", ruleCode: "hash" };
  if (input.allIdentical) return { verdict: "reject", ruleCode: "static" };
  if (input.E > NOISE_E && input.T > NOISE_T) return { verdict: "reject", ruleCode: "noise" };
  return { verdict: "accept", ruleCode: "ok" };
}

// ─── Engagements ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** feuille d'image = SHA-256( 0x02 ‖ empreinte (32 o) ‖ u32 e ‖ u32 t ‖ u32 r ‖ u8 délai ) — 46 octets hachés ; la feuille EST la feuille de Merkle (pas de second hachage). */
export function frameLeaf(frameHashHex: string, e: number, t: number, r: number, delayUnits: number): Buffer {
  if (!HEX64.test(frameHashHex)) throw new Error("empreinte d'image invalide");
  for (const v of [e, t, r]) if (!Number.isInteger(v) || v < 0 || v > PPM) throw new Error("métrique hors bornes");
  if (!Number.isInteger(delayUnits) || delayUnits < 2 || delayUnits > 255) throw new Error("délai hors bornes");
  const b = Buffer.alloc(46);
  b[0] = ANIM_V3.leafTag;
  Buffer.from(frameHashHex, "hex").copy(b, 1);
  b.writeUInt32BE(e, 33); b.writeUInt32BE(t, 37); b.writeUInt32BE(r, 41); b[45] = delayUnits;
  return sha256(b);
}

/** animRoot = SHA-256( "pod-anim-v3|pbc1|" clipHash "|" framesRoot "|" N "|" loops "|" fg "|" bg ) — texte ASCII, entiers en décimal canonique. */
export const animRootOf = (clipHash: string, framesRootHex: string, frames: number, loops: number, fg: number, bg: number): string =>
  sha256Hex(`${ANIM_V3.rootPrefix}${clipHash}|${framesRootHex}|${frames}|${loops}|${fg}|${bg}`);

// ─── Analyse d'un clip (ce que fait un appareil, en flux) ──────────────────────────────────────────────────────────────────────────────────
export interface AnimFrameInfo { hash: string; e: number; t: number; r: number; s: number; delayUnits: number; leaf: string }
export interface AnimAnalysis {
  /** format conforme au jeu A1 (hors comparaison au hash annoncé : `hash` est décidé par l'appelant) */
  formatOk: boolean;
  /** raison lisible de l'échec de format (diagnostic, jamais signée) */
  reason?: string;
  /** ruleCode « calculé seul » : `format` | `static` | `noise` | `ok` (le motif `hash` dépend de l'annonce du serveur) */
  ruleCode: Exclude<AnimRuleCode, "hash" | "rules">;
  clipHash: string;
  frames: AnimFrameInfo[];
  framesRoot: string;
  animRoot: string;
  N: number; loops: number; fg: number; bg: number;
  E: number; T: number; R: number; S: number;
  posterIndex: number;
  allIdentical: boolean;
}

const emptyFail = (bin: Uint8Array, reason: string): AnimAnalysis => ({
  formatOk: false, reason, ruleCode: "format", clipHash: sha256Hex(bin), frames: [], framesRoot: "", animRoot: "", N: 0, loops: 0, fg: 0, bg: 0, E: 0, T: 0, R: 0, S: 0, posterIndex: 0, allIdentical: false,
});

/** Métriques `pod-metrics-2` d'UNE image PBC1 : grille logique 128×64, ligne par ligne, gauche → droite, pixel allumé = 1 (indépendant de la mise en page en mémoire). */
export function frameMetrics(frame: Uint8Array): { e: number; t: number; r: number; s: number } {
  const acc = new MetricsAccumulator(CLIP.W, CLIP.H);
  for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) acc.push(clipPixel(frame, x, y));
  const m = acc.finish();
  return { e: m.e, t: m.t, r: m.r, s: m.s };
}

/** Analyse TOTALE : ne lève jamais, quel que soit le contenu. Jeu A1, ligne « format » : voir docs/SPEC_PODANIM_V3.md § 6. */
export function analyzeClip(bin: Uint8Array): AnimAnalysis {
  if (!(bin instanceof Uint8Array)) return emptyFail(new Uint8Array(0), "contenu illisible");
  if (bin.length > ANIM_V3.maxClipBytes) return emptyFail(bin, `clip de ${bin.length} octets (maximum ${ANIM_V3.maxClipBytes})`);
  let clip: ReturnType<typeof decodeClip>;
  try { clip = decodeClip(bin); } catch (e) { return emptyFail(bin, e instanceof Error ? e.message : "clip illisible"); }
  const n = clip.frames.length;
  if (n < ANIM_V3.minFrames || n > ANIM_V3.maxFrames) return emptyFail(bin, `${n} image(s) : 2 à 64 attendues`);
  if (clip.loops !== 0) return emptyFail(bin, "boucles ≠ 0 (la boucle sans fin est imposée)");
  if (clip.fg === clip.bg) return emptyFail(bin, "couleurs allumé et éteint identiques");
  if (clip.delaysMs.some((d) => !Number.isInteger(d / 10) || d / 10 < 2 || d / 10 > 255)) return emptyFail(bin, "délai hors bornes");
  if (clip.delaysMs.reduce((a, d) => a + d, 0) > ANIM_V3.maxPlayMs) return emptyFail(bin, "durée d'un tour trop longue");

  const frames: AnimFrameInfo[] = clip.frames.map((f, i) => {
    const m = frameMetrics(f), hash = sha256Hex(f), delayUnits = clip.delaysMs[i] / 10;
    return { hash, ...m, delayUnits, leaf: frameLeaf(hash, m.e, m.t, m.r, delayUnits).toString("hex") };
  });
  const framesRoot = merkleRoot(frames.map((f) => Buffer.from(f.leaf, "hex")));
  const clipHash = sha256Hex(bin);
  const mean = (pick: (f: AnimFrameInfo) => number) => Math.floor(frames.reduce((a, f) => a + pick(f), 0) / n);
  const E = mean((f) => f.e), T = mean((f) => f.t), R = mean((f) => f.r), S = mean((f) => f.s);
  let posterIndex = 0;
  for (let i = 1; i < n; i++) if (frames[i].s > frames[posterIndex].s) posterIndex = i;   // premier maximum
  const allIdentical = frames.every((f) => f.hash === frames[0].hash);
  const ruleCode = evaluateAnimRules({ formatOk: true, hashOk: true, allIdentical, E, T }).ruleCode as AnimAnalysis["ruleCode"];
  return { formatOk: true, ruleCode, clipHash, frames, framesRoot, animRoot: animRootOf(clipHash, framesRoot, n, clip.loops, clip.fg, clip.bg), N: n, loops: clip.loops, fg: clip.fg, bg: clip.bg, E, T, R, S, posterIndex, allIdentical };
}

// ─── Message de vote d'animation (domaine PROPRE, signé Ed25519 par l'appareil) ──────────────────────────────────────────────────────────────
export interface AnimVote {
  deviceId: string; candidateId: string; parentHash: string;
  metricsVersion: number; rulesVersion: number;
  clipHash: string; animRoot: string; saltedHash: string;
  /** 2..64 ; 0 SEULEMENT pour un rejet `format` dont N est inconnu (clip illisible) */
  frames: number;
  E: number; T: number; R: number; S: number;
  verdict: Verdict; ruleCode: AnimRuleCode; vclass: VoteClass;
}

export function animVoteMessage(v: AnimVote): string {
  return [ANIM_V3.votePrefix, v.deviceId, v.candidateId, v.parentHash, v.metricsVersion, v.rulesVersion, v.clipHash, v.animRoot, v.saltedHash, v.frames, v.E, v.T, v.R, v.S, v.verdict, v.ruleCode, v.vclass].join("|");
}

const isPpm = (n: number) => Number.isInteger(n) && n >= 0 && n <= PPM;

/** Lecture STRICTE (null = invalide) : 17 éléments, domaine exact, forme canonique, cohérences de § 3 bis de la spécification. */
export function parseAnimVoteMessage(msg: string): AnimVote | null {
  if (typeof msg !== "string") return null;
  const p = msg.split("|");
  if (p.length !== 17 || p[0] !== ANIM_V3.votePrefix) return null;
  const [, deviceId, candidateId, parentHash, mv, rv, clipHash, animRoot, salted, fr, Es, Ts, Rs, Ss, verdict, ruleCode, vclass] = p;
  const num = (s: string) => (/^\d{1,7}$/.test(s) ? Number(s) : NaN);
  const v: AnimVote = { deviceId, candidateId, parentHash, metricsVersion: num(mv), rulesVersion: num(rv), clipHash, animRoot, saltedHash: salted, frames: num(fr), E: num(Es), T: num(Ts), R: num(Rs), S: num(Ss), verdict: verdict as Verdict, ruleCode: ruleCode as AnimRuleCode, vclass: vclass as VoteClass };
  if (!DEVICE_RE.test(deviceId) || !UUID_RE.test(candidateId) || !HEX64.test(parentHash) || !HEX64.test(clipHash) || !HEX64.test(animRoot) || !HEX64.test(salted)) return null;
  if (v.metricsVersion !== ANIM_V3.metricsVersion || v.rulesVersion !== ANIM_V3.rulesVersion) return null;
  if (![v.E, v.T, v.R, v.S].every(isPpm)) return null;
  if (verdict !== "accept" && verdict !== "reject") return null;
  if (!(ANIM_RULE_CODES as readonly string[]).includes(ruleCode) || !(VOTE_CLASSES as readonly string[]).includes(vclass)) return null;
  if ((verdict === "accept") !== (ruleCode === "ok")) return null;
  // frames : 2..64, sauf l'exception UNIQUE d'un rejet `format` dont N est inconnu
  if (v.frames === 0) { if (!(verdict === "reject" && ruleCode === "format")) return null; }
  else if (!Number.isInteger(v.frames) || v.frames < ANIM_V3.minFrames || v.frames > ANIM_V3.maxFrames) return null;
  // refus sans calcul complet : E = T = R = S = 0
  if ((ruleCode === "format" || ruleCode === "hash") && (v.E !== 0 || v.T !== 0 || v.R !== 0 || v.S !== 0)) return null;
  return animVoteMessage(v) === msg ? v : null;
}

/**
 * Un refus d'animation ne COMPTE que si son motif objectif est vrai pour le clip connu (même principe que pour une image) : `static`, `noise`, `format`. `hash` et `rules` ne le sont jamais
 * (litige neutre). Les valeurs signées doivent aussi égaler la référence du serveur (sauf `format`, où rien n'est calculé).
 */
export function animRejectIsObjective(vote: Pick<AnimVote, "ruleCode" | "E" | "T" | "R" | "S">, ref: AnimAnalysis): boolean {
  if (vote.ruleCode === "format") return !ref.formatOk;
  if (!ref.formatOk) return false;
  if (vote.E !== ref.E || vote.T !== ref.T || vote.R !== ref.R || vote.S !== ref.S) return false;
  if (vote.ruleCode === "static") return ref.ruleCode === "static";
  if (vote.ruleCode === "noise") return ref.ruleCode === "noise";
  return false;
}
