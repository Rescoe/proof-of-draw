// lib/podSim.ts — SIMULATEUR S1 du protocole v3 (en mémoire, déterministe, SANS réseau, SANS Redis, SANS nœud hôte).
//
// Il appelle directement l'implémentation de référence (lib/podProtocolV3.ts) : comité, graine, vagues, décision. Deux modèles de menace :
//   M1 « serveur honnête » : le serveur réapplique les règles N2 et vérifie hash/métriques (spec § 4, constat K15). Un « accept » d'un profil malhonnête sur un contenu qui viole une règle est
//        INVALIDE : il ne compte pas (équivaut à un silence). Les malhonnêtes ne peuvent donc que REFUSER un bon contenu (nuisance) ou se taire.
//   M2 « le comité seul décide » : AUCUNE vérification serveur ; les malhonnêtes votent à l'inverse de la vérité. C'est la garantie du comité en soi (futur réseau décentralisé).
// Variante M1b « le serveur valide AUSSI les refus » : un « reject » dont le motif objectif (uniform/noise) est FAUX pour le contenu connu du serveur est invalide ; un « reject hash »
//        avec un autre hash signé est un « dispute » (classifyVote) qui ne peut PAS bloquer. Les malhonnêtes ne peuvent alors que se taire.
// Deux règles de décision en vague 2 : « seats » (RÉFÉRENCE : K sièges, les K premiers RANGS parmi les votants) et « window » (ancienne règle : la fenêtre double, la tolérance de refus reste K−T).
// Un profil malhonnête répond TOUJOURS (pire cas) ; un profil honnête répond avec la probabilité `pOnline`.
// Aucune des fonctions n'appelle Math.random ni Date.now : un même (paramètres, graine) donne toujours les mêmes chiffres.

import { committeeWindow, decide, selectCommittee, sha256Hex, type Committee, type Decision, type Verdict } from "./podProtocolV3";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ThreatModel = "M1" | "M1b" | "M2";
export type DecisionRule = "window" | "seats";
export interface SimParams {
  /** nombre de profils éligibles (auteur compris) */
  n: number;
  /** fraction de profils malhonnêtes parmi les éligibles non-auteurs */
  f: number;
  /** probabilité qu'un profil HONNÊTE réponde (en ligne) pendant une vague */
  pOnline: number;
  model: ThreatModel;
  /** règle de décision : « seats » (défaut = référence) ou « window » (ancienne règle, comparaison) */
  rule?: DecisionRule;
  /** le contenu est-il objectivement bon (accept attendu) ou mauvais (uniforme/bruit : reject attendu) ? */
  content: "good" | "bad";
}

export interface TrialResult {
  /** « accept » / « reject » finalisé, ou « stall » (aucune décision après la vague 2) */
  outcome: "accept" | "reject" | "stall";
  /** vague où la décision est tombée (0 = jamais) */
  wave: 0 | 1 | 2;
  /** nombre de votes COMPTÉS (dans la fenêtre) */
  votesCounted: number;
  mode: "none" | "bootstrap" | "committee";
}

const hex = (rng: () => number) => sha256Hex(`h${rng()}${rng()}`);

/** Mélange de Fisher-Yates (déterministe pour une graine donnée, indépendant de l'algorithme de tri du moteur JS). */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** ANCIENNE règle « window » (première version du brouillon) : tous les votants de la fenêtre comptent, la fenêtre double en vague 2 mais la tolérance de refus reste K−T. Gardée pour la COMPARAISON. */
export function decideWindow(c: Committee, wave: 1 | 2, votes: ReadonlyMap<string, Verdict>): Decision {
  const win = new Set(committeeWindow(c, wave));
  let accepts = 0, rejects = 0;
  for (const [profile, verdict] of votes) { if (!win.has(profile)) continue; if (verdict === "accept") accepts++; else rejects++; }
  const needed = c.threshold, rejectLimit = c.K - c.threshold;
  if (c.mode === "none") return { state: "pending", accepts, rejects, needed, rejectLimit };
  if (accepts >= needed && rejects <= rejectLimit) return { state: "accept", accepts, rejects, needed, rejectLimit };
  if (rejects >= rejectLimit + 1) return { state: "reject", accepts, rejects, needed, rejectLimit };
  return { state: "pending", accepts, rejects, needed, rejectLimit };
}

/** Un tirage : population, auteur, comité (K ≤ 7), vague 1, puis vague 2 (repli) si aucune décision. */
export function runTrial(p: SimParams, rng: () => number): TrialResult {
  const profiles = Array.from({ length: p.n }, (_, i) => `art_${i}`);
  const author = profiles[Math.floor(rng() * p.n)];
  const others = profiles.filter((x) => x !== author);
  const bad = new Set<string>();
  const nBad = Math.round(p.f * others.length);
  shuffle(others, rng).slice(0, nBad).forEach((x) => bad.add(x));

  const committee = selectCommittee({ eligibleProfiles: profiles, authorProfileId: author, contentHash: hex(rng), parentHash: hex(rng) });
  const truth: Verdict = p.content === "good" ? "accept" : "reject";
  const opposite: Verdict = truth === "accept" ? "reject" : "accept";
  const votes = new Map<string, Verdict>();
  const respond = (profile: string) => {
    if (votes.has(profile)) return;
    if (bad.has(profile)) {
      // M1 : un accept qui viole les règles (mauvais contenu) est invalidé par le serveur = silence ; un reject sur un bon contenu reste un vote valide (nuisance)
      if ((p.model === "M1" || p.model === "M1b") && opposite === "accept") return;
      if (p.model === "M1b") return;   // le refus à tort d'un bon contenu est invalidé par le serveur : silence
      votes.set(profile, opposite);
    } else if (rng() < p.pOnline) votes.set(profile, truth);
  };
  for (const wave of [1, 2] as const) {
    for (const m of committeeWindow(committee, wave)) respond(m);
    const d = p.rule === "window" ? decideWindow(committee, wave, votes) : decide(committee, wave, votes);
    if (d.state !== "pending") return { outcome: d.state, wave, votesCounted: d.accepts + d.rejects, mode: committee.mode };
  }
  const d = p.rule === "window" ? decideWindow(committee, 2, votes) : decide(committee, 2, votes);
  return { outcome: "stall", wave: 0, votesCounted: d.accepts + d.rejects, mode: committee.mode };
}

export interface SimSummary {
  trials: number;
  accept: number; reject: number; stall: number;   // proportions
  wave1: number; wave2: number;                     // proportions décidées à la vague 1 / 2
  meanVotes: number; maxVotes: number;
}

export function summarize(p: SimParams, trials: number, seed: number): SimSummary {
  const rng = mulberry32(seed);
  let a = 0, r = 0, s = 0, w1 = 0, w2 = 0, sum = 0, max = 0;
  for (let i = 0; i < trials; i++) {
    const t = runTrial(p, rng);
    if (t.outcome === "accept") a++; else if (t.outcome === "reject") r++; else s++;
    if (t.wave === 1) w1++; else if (t.wave === 2) w2++;
    sum += t.votesCounted; if (t.votesCounted > max) max = t.votesCounted;
  }
  return { trials, accept: a / trials, reject: r / trials, stall: s / trials, wave1: w1 / trials, wave2: w2 / trials, meanVotes: sum / trials, maxVotes: max };
}

// ─── Grinding : l'auteur essaie g contenus et ne soumet que celui dont le comité lui est favorable ───────────────────────────────────────────
// Le comité ne dépend que de (parentHash, contentHash) : TOUT est connu de l'auteur AVANT la soumission (le bloc précédent est public ; la liste des profils éligibles aussi).
// Il peut donc calculer HORS LIGNE le comité de g variantes de son image (quelques pixels changés) et soumettre la meilleure. Succès = au moins T complices dans les K membres.
export function grindingSuccess(opts: { n: number; f: number; tries: number; trials: number; seed: number }): number {
  const rng = mulberry32(opts.seed);
  let success = 0;
  for (let k = 0; k < opts.trials; k++) {
    const profiles = Array.from({ length: opts.n }, (_, i) => `art_${i}`);
    const author = "art_0";
    const others = profiles.filter((x) => x !== author);
    const nAcc = Math.round(opts.f * others.length);
    const accomplices = new Set(shuffle(others, rng).slice(0, nAcc));
    const parentHash = hex(rng);
    let won = false;
    for (let g = 0; g < opts.tries && !won; g++) {
      const c = selectCommittee({ eligibleProfiles: profiles, authorProfileId: author, contentHash: sha256Hex(`variante${k}-${g}`), parentHash });
      const members = committeeWindow(c, 1);
      const acc = members.filter((m) => accomplices.has(m)).length;
      if (c.mode === "committee" && acc >= c.threshold) won = true;
    }
    if (won) success++;
  }
  return success / opts.trials;
}

// ─── Référence : le quorum ACTUEL (vote v2) face à des faux appareils NON appairés (constat K4) ────────────────────────────────────────────────
// poolSize = appareils appairés actifs ; quorum = ⌈0,51 × poolSize⌉ approbations ; tout appareil enregistré et actif peut voter, appairé ou non.
export function v2QuorumAttack(pairedHonest: number, unpairedFakes: number): { quorum: number; fakesAloneFinalize: boolean; honestAloneFinalize: boolean } {
  const quorum = Math.max(1, Math.ceil(Math.max(1, pairedHonest) * 0.51));
  return { quorum, fakesAloneFinalize: unpairedFakes >= quorum, honestAloneFinalize: pairedHonest >= quorum };
}
/** v3 : un faux appareil n'a AUCUNE voix (non appairé = non éligible) ; des appareils d'un même profil comptent pour UNE voix. */
export function v3VotesFromDevices(devicesPerProfile: number[]): number { return devicesPerProfile.filter((d) => d > 0).length; }
