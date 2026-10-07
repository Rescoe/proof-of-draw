// lib/animationWording.ts — libellés PUBLICS des animations dans la galerie.
//
// RÈGLE (LOT0S-AUDIT-FIX1, 06/10/2026) : une animation est aujourd'hui votée en v1 (les appareils recopient le score du serveur) ; ce que le bloc garantit, c'est que le clip
// et l'EMPREINTE DE CHAQUE IMAGE sont consignés et recalculables par n'importe qui (bouton « Vérifier image par image » de la fiche du bloc). On ne dit donc JAMAIS qu'une
// animation est « validée image par image » : la validation par calcul des images est un chantier futur (feuille de route : « Animations validées par calcul »).
// Coût Redis : AUCUN (libellés seulement).

export const ANIM_CHIP_TITLE = "Animation : l’empreinte de chaque image est consignée dans le bloc et peut être recalculée. Le vote des appareils est encore de type v1 (écho du score du serveur) : les images ne sont pas encore validées par calcul.";

/** Formulations interdites dans un texte public : elles affirment une validation image par image qui n'existe pas encore. */
export const ANIM_FORBIDDEN_CLAIM = /valid(?:é|ée|és|ées|ation)\s+(?:de\s+)?(?:chaque\s+)?image\s+par\s+image|valid(?:é|ée|és|ées)\s+image\s+(?:par|après)\s+image/i;
