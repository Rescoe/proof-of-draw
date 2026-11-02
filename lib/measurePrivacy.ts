// lib/measurePrivacy.ts — CONFIDENTIALITÉ PAR GRANDEUR des mesures d'un appareil (02/11/2026). Fonctions PURES, testées dans tests/measurePrivacy.test.ts.
//
// Pourquoi : la qualité de l'air (SGP40) révèle la présence à la maison ; la température et l'humidité, beaucoup moins. Le propriétaire choisit, PAR APPAREIL et PAR GRANDEUR, ce qui est public.
//
// Modèle (liste blanche) :
//   • `measuresPublic === false` (interrupteur historique de l'appareil) = RIEN n'est public, quelle que soit la liste ;
//   • sinon `measuresPublicKinds` (liste explicite choisie par le propriétaire) ; absente = défaut du registre (`MEASURE_KINDS[k].visibility === "public"` : température et humidité) ;
//   • une grandeur "never" (brut du SGP40), inconnue du registre ou nouvelle n'est JAMAIS publique tant que le registre ne la déclare pas ;
//   • intersection avec les grandeurs réellement déclarées par l'appareil.
// Le filtrage est fait CÔTÉ SERVEUR, avant toute réponse publique ou tout cache partagé : `publicKindsOf` pour la décision, `filterPublic`/`filterPublicLatest` pour les données.
//
// COÛT REDIS : ZÉRO commande de plus à la lecture (le réglage vit dans la fiche appareil déjà lue par /api/sensor?public=1 et par le snapshot réseau) ; un changement de réglage = 1 lecture + 1 écriture de la fiche (≈ 2 commandes, action manuelle rare).

import { MEASURE_KINDS, isMeasureKind, measureKindsOf, type Measure, type MeasureKind, type MeasureValues } from "./measures";

export interface PrivacyFields { measuresPublic?: boolean; measuresPublicKinds?: unknown; screens?: unknown; sensors?: unknown }

/** Une grandeur peut-elle être rendue publique par le propriétaire ? ("never" et inconnue : non, jamais.) */
export const isShareable = (k: unknown): k is MeasureKind => isMeasureKind(k) && MEASURE_KINDS[k].visibility !== "never";

/** Grandeurs par défaut publiques (registre), parmi `kinds`. */
export const defaultPublicKinds = (kinds: MeasureKind[]): MeasureKind[] => kinds.filter((k) => MEASURE_KINDS[k].visibility === "public");

/** Nettoie une liste reçue (corps de requête ou fiche) : tableau, grandeurs partageables connues, sans doublon ; null si ce n'est pas un tableau. */
export function sanitizePublicKinds(raw: unknown): MeasureKind[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter(isShareable))];
}

/** Choix du propriétaire (ou défaut du registre), SANS l'interrupteur général : sert à l'interface du propriétaire, jamais à une réponse publique. */
export function chosenPublicKinds(device: PrivacyFields): MeasureKind[] {
  const declared = measureKindsOf(device);
  const allowed = sanitizePublicKinds(device.measuresPublicKinds) ?? defaultPublicKinds(declared);
  return declared.filter((k) => allowed.includes(k) && isShareable(k));
}

/** Grandeurs de l'appareil VISIBLES DU PUBLIC (vue réseau, historique public, profil d'artiste). */
export function publicKindsOf(device: PrivacyFields): MeasureKind[] {
  return device.measuresPublic === false ? [] : chosenPublicKinds(device);
}

/** Ne garde dans chaque mesure que les grandeurs publiques ; une mesure sans aucune grandeur publique disparaît (ni heure, ni trace de présence). */
export function filterPublic(measures: Measure[], allowed: readonly MeasureKind[]): Measure[] {
  if (allowed.length === 0) return [];
  const out: Measure[] = [];
  for (const m of measures) {
    const v: MeasureValues = {};
    for (const k of allowed) if (m.v[k] !== undefined) v[k] = m.v[k];
    if (Object.keys(v).length > 0) out.push({ t: m.t, v });
  }
  return out;
}

/** Même règle pour UNE mesure (dernière mesure du snapshot réseau) ; null si rien de public. */
export function filterPublicLatest(m: Measure | null, allowed: readonly MeasureKind[]): Measure | null {
  return m ? (filterPublic([m], allowed)[0] ?? null) : null;
}
