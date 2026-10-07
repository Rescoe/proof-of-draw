// lib/animReps.ts — UN appareil représentant par profil pour une animation v3 (Lot 6B-2, docs/SPEC_PODANIM_V3.md § 7 bis, décision A10). Pur, sans Redis. NON BRANCHÉ : aucune route ne l'appelle.
//
// Pourquoi : sans comité, tous les profils de l'électorat figé (≤ 64) peuvent voter ; un artiste qui possède plusieurs cartes ferait télécharger le clip plusieurs fois. On fige donc, au dépôt du candidat,
// UN appareil par profil : le plus petit `deviceId` parmi les appareils ÉLIGIBLES, ACTIFS et qui ont DÉCLARÉ la capacité « anim-v3 ». Tant qu'aucun firmware ne déclare cette capacité (elle n'existe pas :
// lot 8), la liste est VIDE : aucun appareil actuel n'est représentant, aucun ne reçoit de ticket. Un profil sans représentant s'abstient (aucun remplaçant : c'est le prix de la borne de 64 téléchargements).

import { ELECTORATE_MAX, evaluateDevice, profileIdOf, type EligibilityConfig } from "@/lib/eligibility";
import type { Device } from "@/lib/deviceStore";

export const ANIM_V3_CAPABILITY = "anim-v3";
export type RepDevice = Pick<Device, "deviceId" | "artistId" | "artistName" | "lastPing" | "createdAt" | "publicKey"> & { caps?: readonly string[] };

/** `null` si l'électorat n'est pas figeable (> ELECTORATE_MAX profils) : pas d'animation v3 (retour au chemin v1). Sinon profil → appareil représentant (profils sans représentant absents). */
export function animRepresentatives(devices: readonly RepDevice[], electorate: readonly string[], now: number, cfg: EligibilityConfig): Record<string, string> | null {
  if (electorate.length > ELECTORATE_MAX) return null;
  const members = new Set(electorate), best = new Map<string, string>();
  for (const d of devices) {
    const profile = profileIdOf(d);
    if (!profile || !members.has(profile)) continue;
    if (!d.caps?.includes(ANIM_V3_CAPABILITY)) continue;
    if (!evaluateDevice(d, now, cfg, [], true).eligible) continue;
    const cur = best.get(profile);
    if (cur === undefined || d.deviceId < cur) best.set(profile, d.deviceId);
  }
  return Object.fromEntries([...best.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Cet appareil est-il le représentant figé de son profil ? (un autre appareil du même profil : refusé AVANT tout téléchargement, `not-representative`). */
export const isRepresentative = (reps: Readonly<Record<string, string>>, profileId: string | null, deviceId: string): boolean =>
  profileId !== null && Object.prototype.hasOwnProperty.call(reps, profileId) && reps[profileId] === deviceId;
