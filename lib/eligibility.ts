// lib/eligibility.ts — QUI A LE DROIT DE VOTER, et combien de voix compte un profil (pur, sans Redis). Lot 2 du plan de travail (docs/LOT_2_IDENTITE_ELIGIBILITE_2026_10_07.md).
//
// Constats traités (note Claude K3, K4 ; audit GPT § 5.4) :
//   • le POOL du quorum ne comptait que les appareils APPAIRÉS actifs, mais les routes de vote acceptaient tout appareil enregistré et actif : des appareils non appairés votaient
//     sans jamais compter au dénominateur (trois faux appareils suffisaient face à quatre vrais) ;
//   • le vote est par APPAREIL (cinq cartes = cinq voix) ; l'auteur peut voter pour sa propre œuvre.
// Règle (mode « enforce ») : un appareil vote s'il est APPAIRÉ, ACTIF, assez ANCIEN (et, si demandé, muni d'une CLÉ) et n'est PAS de l'auteur ; chaque PROFIL compte UNE voix quel que soit
// son nombre de cartes ; sous 3 profils indépendants, mode « bootstrap » ÉTIQUETÉ : les profils de l'auteur sont admis (sinon un réseau d'un seul propriétaire ne pourrait plus miner),
// jamais présenté comme « validé par le réseau ».
// Trois modes (variable ELIGIBILITY_MODE) : « off » (défaut : comportement INCHANGÉ), « shadow » (calcule et JOURNALISE ce qui serait refusé, sans effet), « enforce ».
// Coût Redis : AUCUN (le pool réutilise les lectures déjà faites ; les routes de vote réutilisent l'appareil et le candidat déjà lus).

import type { Device } from "@/lib/deviceStore";

export type EligibilityMode = "off" | "shadow" | "enforce";
export interface EligibilityConfig {
  /** ancienneté minimale de l'appareil (createdAt) — 24 h par défaut ; 0 = pas de condition */
  minAgeMs: number;
  /** fenêtre « actif » (lastPing) */
  activeWindowMs: number;
  /** exiger une clé publique (vote signé) ; faux par défaut : les anciens firmwares continuent de voter en v1 */
  requireKey: boolean;
  /** sous ce nombre de profils indépendants (hors auteur) : mode bootstrap */
  bootstrapBelow: number;
}

export const DEFAULT_ELIGIBILITY: EligibilityConfig = { minAgeMs: 24 * 3600 * 1000, activeWindowMs: 45 * 60 * 1000, requireKey: false, bootstrapBelow: 3 };

export function eligibilityModeFromEnv(env: NodeJS.ProcessEnv = process.env): EligibilityMode {
  const v = (env.ELIGIBILITY_MODE ?? "off").trim().toLowerCase();
  return v === "enforce" || v === "shadow" ? v : "off";
}

export function eligibilityConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EligibilityConfig {
  const hours = Number(env.ELIGIBILITY_MIN_AGE_HOURS);
  const below = Number(env.ELIGIBILITY_BOOTSTRAP_BELOW);
  return {
    ...DEFAULT_ELIGIBILITY,
    minAgeMs: Number.isFinite(hours) && env.ELIGIBILITY_MIN_AGE_HOURS !== undefined && env.ELIGIBILITY_MIN_AGE_HOURS !== "" ? Math.max(0, hours) * 3600 * 1000 : DEFAULT_ELIGIBILITY.minAgeMs,
    requireKey: env.ELIGIBILITY_REQUIRE_KEY === "true",
    bootstrapBelow: Number.isInteger(below) && below >= 1 ? below : DEFAULT_ELIGIBILITY.bootstrapBelow,
  };
}

type DeviceLike = Pick<Device, "deviceId" | "artistId" | "artistName" | "lastPing" | "createdAt" | "publicKey">;

const IMPLICIT_PREFIX = "esp_";   // même convention que lib/deviceStore.ts (artiste implicite d'un ESP appairé par son nom)

/** Profil auquel appartient un appareil : son ArtistProfile, sinon l'artiste implicite `esp_{deviceId}` s'il est appairé par un nom, sinon `null` (non appairé). */
export function profileIdOf(d: Pick<Device, "deviceId" | "artistId" | "artistName">): string | null {
  if (d.artistId) return d.artistId;
  if (d.artistName && d.artistName.trim()) return `${IMPLICIT_PREFIX}${d.deviceId}`;
  return null;
}

export type IneligibleReason = "unpaired" | "inactive" | "too-young" | "no-key" | "author" | "not-in-electorate";

/** Taille maximale de l'électorat FIGÉ stocké dans le candidat (≈ 1,6 Ko). Au-delà : `overflow` — le contrôle redevient dynamique (le comité, borné à 2K, reste la protection à grande échelle). */
export const ELECTORATE_MAX = 64;
export type DeviceEligibility = { eligible: true; profileId: string } | { eligible: false; reason: IneligibleReason; profileId: string | null };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Profils « auteur » d'un candidat (exclus du comité) : le profil du propriétaire de l'appareil qui reçoit le dessin, plus — si le dessin vient d'un artiste invité (prêt public) —
 * tout appareil dont le nom d'artiste est celui du dessinateur (rapprochement par nom : meilleure information disponible, il n'existe pas d'identifiant de dessinateur).
 */
export function authorProfilesOf(owner: Pick<Device, "deviceId" | "artistId" | "artistName"> | null, drawArtistName: string | undefined, all: readonly Pick<Device, "deviceId" | "artistId" | "artistName">[]): string[] {
  const out = new Set<string>();
  const ownerProfile = owner ? profileIdOf(owner) : null;
  if (ownerProfile) out.add(ownerProfile);
  if (drawArtistName && drawArtistName.trim()) for (const d of all) { const p = profileIdOf(d); if (p && d.artistName && norm(d.artistName) === norm(drawArtistName)) out.add(p); }
  return [...out].sort();
}

/** Éligibilité d'UN appareil. `authorProfiles` + `includeAuthor=false` : l'auteur est exclu ; `includeAuthor=true` (bootstrap) : admis. */
export function evaluateDevice(d: DeviceLike, now: number, cfg: EligibilityConfig, authorProfiles: readonly string[], includeAuthor: boolean): DeviceEligibility {
  const profileId = profileIdOf(d);
  if (!profileId) return { eligible: false, reason: "unpaired", profileId: null };
  if (!(now - d.lastPing < cfg.activeWindowMs)) return { eligible: false, reason: "inactive", profileId };
  if (cfg.minAgeMs > 0 && !(now - d.createdAt >= cfg.minAgeMs)) return { eligible: false, reason: "too-young", profileId };
  if (cfg.requireKey && !d.publicKey) return { eligible: false, reason: "no-key", profileId };
  if (!includeAuthor && authorProfiles.includes(profileId)) return { eligible: false, reason: "author", profileId };
  return { eligible: true, profileId };
}

export type PoolPlanKind = "none" | "bootstrap" | "independent";
export interface PoolPlan {
  kind: PoolPlanKind;
  /** profils dont un appareil peut voter (distincts) */
  profiles: string[];
  /** profils indépendants (hors auteur) */
  independentProfiles: number;
  /** dénominateur du quorum = nombre de PROFILS éligibles (≥ 1 : même minimum que le quorum historique) */
  poolSize: number;
  authorProfiles: string[];
}

/** Plan du pool pour un candidat : indépendant (≥ bootstrapBelow profils hors auteur), bootstrap (auteur admis, étiqueté) ou aucun éligible. */
export function planPool(devices: readonly DeviceLike[], authorProfiles: readonly string[], now: number, cfg: EligibilityConfig): PoolPlan {
  const independent = new Set<string>(), withAuthor = new Set<string>();
  for (const d of devices) {
    const a = evaluateDevice(d, now, cfg, authorProfiles, false);
    if (a.eligible) { independent.add(a.profileId); withAuthor.add(a.profileId); continue; }
    if (a.reason === "author") { const b = evaluateDevice(d, now, cfg, authorProfiles, true); if (b.eligible) withAuthor.add(b.profileId); }
  }
  const authors = [...authorProfiles];
  if (independent.size >= cfg.bootstrapBelow) return { kind: "independent", profiles: [...independent].sort(), independentProfiles: independent.size, poolSize: independent.size, authorProfiles: authors };
  if (withAuthor.size > 0) return { kind: "bootstrap", profiles: [...withAuthor].sort(), independentProfiles: independent.size, poolSize: withAuthor.size, authorProfiles: authors };
  return { kind: "none", profiles: [], independentProfiles: 0, poolSize: 1, authorProfiles: authors };
}

/** Ce que le candidat mémorise (champ additif `eligibility`) pour que les routes de vote décident SANS relire la liste des appareils. */
export interface CandidateEligibility {
  mode: "shadow" | "enforce";
  plan: PoolPlanKind;
  authorProfiles: string[];
  /** nombre de profils éligibles au moment du dépôt */
  profiles: number;
  independentProfiles: number;
  /**
   * ÉLECTORAT FIGÉ au dépôt (liste triée des profils, ≤ ELECTORATE_MAX) : seuls ces profils peuvent voter, et le dénominateur du quorum est exactement sa taille. Sans cela (version précédente)
   * l'éligibilité était recalculée au vote : un profil devenu actif après le dépôt votait hors dénominateur (audit GPT). Absent = candidat antérieur ou électorat trop grand (`overflow`).
   */
  profileIds?: string[];
  overflow?: true;
}

/**
 * Mode d'éligibilité RÉELLEMENT retenu pour un candidat (audit GPT FIX2). Au-delà de ELECTORATE_MAX profils l'électorat ne peut pas être figé : le contrôle redevient dynamique et le décalage
 * numérateur/dénominateur réapparaît. Seul le comité « enforce » (fenêtre bornée à 2K profils, décision sur ces seuls profils) l'écarte ; sans lui, « enforce » est donc ramené à « shadow »
 * pour CE candidat (quorum historique entier, journal seul) plutôt que de laisser un quorum incohérent. Aucun effet quand l'électorat tient dans la liste figée.
 */
export function effectiveEligibilityMode(mode: "shadow" | "enforce", plan: PoolPlan, committeeEnforces: boolean): { mode: "shadow" | "enforce"; downgraded: boolean } {
  if (mode === "enforce" && plan.profiles.length > ELECTORATE_MAX && !committeeEnforces) return { mode: "shadow", downgraded: true };
  return { mode, downgraded: false };
}

export function candidateEligibilityOf(mode: "shadow" | "enforce", plan: PoolPlan): CandidateEligibility {
  const frozen = plan.profiles.length <= ELECTORATE_MAX ? { profileIds: [...plan.profiles].sort() } : { overflow: true as const };
  return { mode, plan: plan.kind, authorProfiles: plan.authorProfiles, profiles: plan.profiles.length, independentProfiles: plan.independentProfiles, ...frozen };
}

export type VoteGate =
  | { action: "allow"; profileId: string | null }
  | { action: "refuse"; status: 403 | 409; reason: IneligibleReason | "profile-already-voted" | "no-eligible-profile"; profileId: string | null }
  | { action: "shadow-refuse"; reason: IneligibleReason | "profile-already-voted" | "no-eligible-profile"; profileId: string | null };

/**
 * Décision d'une route de vote pour UN appareil. Aucun accès Redis. `priorVoterProfiles` = profils déjà représentés par un AUTRE appareil (lus dans la carte des votes déjà chargée).
 * - mode off / candidat sans `eligibility` (déposé avant l'activation) : toujours « allow » (comportement historique) ;
 * - shadow : « shadow-refuse » (journalisation seulement) là où enforce refuserait ;
 * - enforce : refuse un appareil inéligible (403), un profil déjà représenté par un autre appareil (409) ou un plan « aucun profil éligible » (403).
 */
export function voteGate(opts: { mode: EligibilityMode; eligibility: CandidateEligibility | undefined; device: DeviceLike; now: number; cfg: EligibilityConfig; priorVoterProfiles: ReadonlySet<string> }): VoteGate {
  const { mode, eligibility, device, now, cfg } = opts;
  if (mode === "off" || !eligibility) return { action: "allow", profileId: null };
  const verdict = ((): VoteGate => {
    if (eligibility.plan === "none") return { action: "refuse", status: 403, reason: "no-eligible-profile", profileId: profileIdOf(device) };
    // ÉLECTORAT FIGÉ : l'appartenance à la liste du dépôt décide ; ni l'activité ni l'ancienneté ne sont recalculées (un appareil qui vote vient de se manifester).
    if (eligibility.profileIds) {
      const profileId = profileIdOf(device);
      if (!profileId) return { action: "refuse", status: 403, reason: "unpaired", profileId: null };
      if (eligibility.plan !== "bootstrap" && eligibility.authorProfiles.includes(profileId)) return { action: "refuse", status: 403, reason: "author", profileId };
      if (!eligibility.profileIds.includes(profileId)) return { action: "refuse", status: 403, reason: "not-in-electorate", profileId };
      if (opts.priorVoterProfiles.has(profileId)) return { action: "refuse", status: 409, reason: "profile-already-voted", profileId };
      return { action: "allow", profileId };
    }
    const a = evaluateDevice(device, now, cfg, eligibility.authorProfiles, eligibility.plan === "bootstrap");
    if (!a.eligible) return { action: "refuse", status: 403, reason: a.reason, profileId: a.profileId };
    if (opts.priorVoterProfiles.has(a.profileId)) return { action: "refuse", status: 409, reason: "profile-already-voted", profileId: a.profileId };
    return { action: "allow", profileId: a.profileId };
  })();
  if (verdict.action === "refuse" && (mode === "shadow" || eligibility.mode === "shadow")) return { action: "shadow-refuse", reason: verdict.reason, profileId: verdict.profileId };
  if (verdict.action === "allow") return { action: "allow", profileId: mode === "enforce" && eligibility.mode === "enforce" ? verdict.profileId : null };
  return verdict;
}

/** Clé de dédoublonnage d'un vote : le profil s'il est enregistré (mode enforce), sinon l'appareil (comportement historique). */
export const voterKey = (v: { deviceId: string; profileId?: string }): string => v.profileId ?? v.deviceId;
