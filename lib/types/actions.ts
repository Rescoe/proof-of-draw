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
  | "clear"   // effacement complet → remet le score au checkpoint précédent (ou 0)
  | "undo"    // annulation Ctrl+Z → -1
  | "redo";   // rétablissement Ctrl+Y → 0 (neutre)

export interface ActionEvent {
  kind: ActionKind;
  t: number;      // ms depuis le début de la session de dessin
  tool?: string;  // outil actif (brush, eraser, fill…)
  color?: string; // couleur active (#rrggbb)
}

/**
 * Événement de replay pixel-perfect.
 * Enregistre les coordonnées complètes pour reconstruire le dessin en temps réel.
 */
export interface ReplayEvent {
  kind: "down" | "move" | "up";
  t: number;       // ms depuis début session
  x: number;       // coordonnée canvas (px)
  y: number;       // coordonnée canvas (px)
  tool: string;
  color?: string;
  size?: number;
  pressure?: number; // pression stylet si disponible [0..1]
}

/**
 * Métriques d'enrichissement PoD — calculées depuis la séquence de replay.
 * Stockées séparément dans chain:replay:{hash} pour ne pas alourdir le bloc.
 */
export interface PodEnrichment {
  totalStrokes: number;        // nb de pointerDown→pointerUp
  totalPoints: number;         // nb total de points de replay
  avgStrokeLength: number;     // longueur moyenne d'un stroke en px
  sessionDurationMs: number;   // durée totale de la session
  uniqueColorsUsed: number;    // nb de couleurs distinctes utilisées
  undoCount: number;           // nb d'undos dans la session
  clearCount: number;          // nb de clears dans la session
}

/**
 * Calcule le Proof-of-Draw score depuis une séquence d'actions.
 *
 * Règles :
 *   - undo → -1
 *   - clear → remet le score au dernier checkpoint empilé (ou 0 si vide)
 *   - toute autre action (sauf redo) → +1
 *   - redo → neutre (0)
 *
 * Chaque clear empile le score courant sur une pile de checkpoints.
 * Un undo après un clear restaure le checkpoint précédent.
 */
export function scoreFromActions(actions: ActionEvent[]): number {
  const checkpointStack: number[] = [];
  let score = 0;
  let lastWasClear = false;

  for (const a of actions) {
    if (a.kind === "redo") {
      lastWasClear = false;
      continue;
    }
    if (a.kind === "clear") {
      checkpointStack.push(score);
      score = 0;
      lastWasClear = true;
      continue;
    }
    if (a.kind === "undo") {
      if (lastWasClear && checkpointStack.length > 0) {
        // Annuler le clear → restaurer le checkpoint
        score = checkpointStack.pop()!;
      } else {
        score -= 1;
      }
      lastWasClear = false;
      continue;
    }
    // stroke, erase, fill, shape, move → +1
    score += 1;
    lastWasClear = false;
  }

  return score;
}
