// lib/electorate.ts — QUI COMPTE DANS LE QUORUM ET POURQUOI (LOT 2, 28/10/2026). Fonctions PURES (aucun accès Redis) : une seule source de vérité pour le décompte du quorum
// (getGlobalActiveCount / getPoolSnapshot), le résumé figé au dépôt d'un candidat et le diagnostic en lecture seule (scripts/diag-electorate.ts).
//
// Pourquoi : le 27/10/2026 un candidat a expiré avec « réseau de 1 validateur » sans que personne puisse dire pourquoi. Ce « 1 » pouvait être un vrai validateur OU le plancher de getGlobalActiveCount
// (« minimum 1 pour éviter une division par zéro »). Le candidat porte désormais un résumé BORNÉ de l'électorat tel qu'il était à son dépôt.
//
// Règle de décompte (inchangée, seulement nommée) : un appareil est compté s'il est appairé, actif (lastPing < fenêtre), n'est pas un capteur seul (règle actuelle, voir docs/PLAN_RESEAU_…),
// son firmware sait voter en v2 et il n'a pas dépassé le seuil de manques consécutifs (QUORUM_MAX_MISSED, 3 par défaut depuis le 28/10/2026). Un appareil exclu pour manques reste INVITÉ à voter et revient au premier vote.
import { participatesInVoteNetwork, isValidatorNode, votesAnimV3 } from "@/lib/voteCapability";
import { isSensorScreens } from "@/lib/measures";
import { isResponsiveVoter, maxMissedFromEnv } from "@/lib/quorumResponsive";

export type ExclusionReason = "not-paired" | "inactive" | "sensor-only" | "firmware-not-capable" | "missed-votes";
export const EXCLUSION_REASONS: readonly ExclusionReason[] = ["not-paired", "inactive", "sensor-only", "firmware-not-capable", "missed-votes"];
export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  "not-paired": "non appairé",
  inactive: "inactif",
  "sensor-only": "capteur seul",
  "firmware-not-capable": "firmware sans vote v2",
  "missed-votes": "exclu après des manques",
};

/** Résumé BORNÉ de l'électorat (≈ 100 octets en JSON) : jamais d'identifiant, de nom, de MAC, de code d'appairage ni de clé. */
export interface PoolSummary {
  total: number;                                          // fiches lisibles (index devices:all)
  counted: number;                                        // appareils réellement comptés
  floor: boolean;                                         // vrai si AUCUN appareil n'est compté et que le plancher « 1 » s'applique : le « réseau de 1 » n'est alors pas un validateur
  excluded: Partial<Record<ExclusionReason, number>>;     // exclusions par raison (zéros omis)
  maxMissed: number;                                      // seuil de manques consécutifs appliqué
  animV3: number;                                         // parmi les appareils comptés, combien savent voter une animation v3 (0 tant qu'aucun firmware ne la déclare) : la couverture exigée AVANT de passer le mode d'animation de « shadow » à « enforce »
  at: number;                                             // date du calcul (ms)
}

export interface DeviceLike { screens?: readonly string[] | null; firmware?: string | null; caps?: readonly string[] | null; artistId?: string | null; artistName?: string | null; lastPing?: number; missedVotes?: number }

/** Raison de l'exclusion d'un appareil, ou null s'il est compté. Ordre de priorité : non appairé, inactif, capteur seul, firmware incapable, manques. */
export function exclusionReason(d: DeviceLike, now: number, activeWindowMs: number, env: NodeJS.ProcessEnv = process.env): ExclusionReason | null {
  if (!(d.artistId || d.artistName)) return "not-paired";
  if (!(now - (d.lastPing ?? 0) < activeWindowMs)) return "inactive";
  if (isSensorScreens(d.screens) && !isValidatorNode(d)) return "sensor-only";   // un validateur sans écran (capacité déclarée + famille autorisée) est compté
  if (!participatesInVoteNetwork(d, env)) return "firmware-not-capable";
  if (!isResponsiveVoter(d, maxMissedFromEnv(env))) return "missed-votes";
  return null;
}

/** Décompte et résumé à partir des fiches lues (null = fiche absente / illisible : ignorée). Le nombre rendu garde le plancher historique de 1. */
export function summarizePool(devices: ReadonlyArray<DeviceLike | null>, now: number, activeWindowMs: number, env: NodeJS.ProcessEnv = process.env): { count: number; summary: PoolSummary } {
  const excluded: Partial<Record<ExclusionReason, number>> = {};
  let counted = 0, total = 0, animV3 = 0;
  for (const d of devices) {
    if (!d) continue;
    total++;
    const why = exclusionReason(d, now, activeWindowMs, env);
    if (why === null) { counted++; if (votesAnimV3(d)) animV3++; } else excluded[why] = (excluded[why] ?? 0) + 1;
  }
  return { count: Math.max(1, counted), summary: { total, counted, floor: counted === 0, excluded, maxMissed: maxMissedFromEnv(env), animV3, at: now } };
}

/** Texte court pour « Rejetés » et le diagnostic : « 1 compté sur 8 (5 inactifs, 1 exclu après 3 manques) ». */
export function poolSummaryText(s: PoolSummary): string {
  const bits = EXCLUSION_REASONS.filter((r) => (s.excluded[r] ?? 0) > 0).map((r) => `${s.excluded[r]} ${EXCLUSION_LABEL[r]}`);
  const head = s.floor ? `aucun appareil compté sur ${s.total} (plancher de 1)` : `${s.counted} compté(s) sur ${s.total}`;
  const tail = `${head}${bits.length ? " : " + bits.join(", ") : ""}`;
  return `${tail} ; ${s.animV3} capable(s) de voter une animation v3`;
}

/** Valide un résumé relu depuis Redis / une archive (défensif : le champ est facultatif et peut venir d'une ancienne version). */
export function readPoolSummary(raw: unknown): PoolSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100000 ? v : null);
  const total = n(r.total), counted = n(r.counted), maxMissed = n(r.maxMissed), animV3 = r.animV3 === undefined ? 0 : n(r.animV3), at = typeof r.at === "number" ? r.at : null;   // animV3 absent (candidat du 28/10 matin) = 0
  if (total === null || counted === null || maxMissed === null || animV3 === null || at === null || typeof r.floor !== "boolean") return null;
  const excluded: Partial<Record<ExclusionReason, number>> = {};
  const ex = (r.excluded && typeof r.excluded === "object" ? r.excluded : {}) as Record<string, unknown>;
  for (const k of EXCLUSION_REASONS) { const v = n(ex[k]); if (v !== null && v > 0) excluded[k] = v; }
  return { total, counted, floor: r.floor, excluded, maxMissed, animV3, at };
}
