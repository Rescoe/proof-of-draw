// lib/types/actions.ts
// Types du Proof-of-Draw score et séquence d'actions de dessin.
//
// Chaque action représente un geste atomique de l'artiste.
// Le score est calculé côté client et vérifié côté serveur.

export type ActionKind =
  | "stroke"  // pinceau : pointerdown → pointerup → +1
  | "erase"   // gomme : pointerdown → pointerup → +1
  | "fill"    // remplissage bucket → +1
  | "shape"   // ligne / rect / ellipse pointerup → +1
  | "move"    // import image / déplacement → +1
  | "undo"    // annulation Ctrl+Z → -1
  | "redo";   // rétablissement Ctrl+Y → 0 (neutre)

export interface ActionEvent {
  kind: ActionKind;
  t: number;      // ms depuis le début de la session de dessin
  tool?: string;  // outil actif (brush, eraser, fill…)
  color?: string; // couleur active (#rrggbb)
}

/**
 * Calcule le Proof-of-Draw score depuis une séquence d'actions.
 * undo = -1, toute autre action = +1
 * Un score ≤ 0 signifie un dessin vide / essentiellement annulé.
 */
export function scoreFromActions(actions: ActionEvent[]): number {
  return actions.reduce((acc, a) => {
    if (a.kind === "undo") return acc - 1;
    return acc + 1;
  }, 0);
}
