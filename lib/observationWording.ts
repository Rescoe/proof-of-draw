// lib/observationWording.ts — vocabulaire de l'« observation » d'un bloc (champs `obsConfirmed` / `revalidated[].observerIds`) pour l'interface.
//
// RÈGLE (Lot 0S, 06/10/2026 ; audit K7) : /api/obs-confirm enregistre qu'un appareil a REÇU la tâche et renvoyé les hashes qu'on lui avait donnés. Il ne recalcule RIEN
// (pas de SHA-256 du bloc, pas de replay) et son message n'est pas signé. L'interface dit donc « réception confirmée » et ne dit JAMAIS « revérifié », « revalidé »,
// « validé » ou « recalculé ». Cette vérification réelle d'un bloc par un appareil est un chantier futur (feuille de route, phase « Preuves vérifiables »).
// Coût Redis : AUCUN (libellés seulement).

export const OBS_FIELD_LABEL = "Réception";
export const OBS_FIELD_VALUE = "Confirmée par l’appareil";

export const OBS_NOTE = "Un appareil a confirmé avoir reçu la tâche d’observation. Il n’a pas recalculé le bloc : ce n’est pas une vérification.";

export const OBS_SECTION_TITLE = (n: number): string => `Réceptions confirmées (${n} appareil${n > 1 ? "s" : ""})`;
export const OBS_BADGE = (confirmed: number, total: number): string => `${confirmed}/${total} reçues`;
export const OBS_ROW_CONFIRMED = (n: number): string => `✓ ${n} réception${n > 1 ? "s" : ""} confirmée${n > 1 ? "s" : ""}`;
export const OBS_ROW_PENDING = "⏳ en attente";

export const OBS_CHIP = "reçu ✓";
export const OBS_CHIP_TITLE = "Réception confirmée par l’appareil — aucun recalcul du bloc";

/** Mots qui laisseraient croire qu'un appareil a recalculé ou vérifié le bloc : interdits dans les libellés d'observation. */
export const OBS_FORBIDDEN_WORDS = /revérifi|re-vérifi|revalid|re-valid|recalcul|validation|validé|vérifié|observer/i;
