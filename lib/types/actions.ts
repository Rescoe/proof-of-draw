// lib/types/actions.ts
// Types du Proof-of-Draw score et séquence d'actions de dessin.
//
// Chaque action représente un geste atomique de l'artiste.
// Le score est calculé côté client et vérifié côté serveur.
//
// ── Évolution "moteur v2" (Pod Studio) ─────────────────────────────────────────
// Tous les champs ajoutés sont OPTIONNELS et tous les nouveaux `kind` sont
// additifs : un bloc enregistré avant le moteur v2 se relit et se score
// exactement comme avant. Un replay/une séquence d'actions produit(e) par le
// moteur v2 se reconnaît à `v: 2` sur son PREMIER événement.

export type ActionKind =
  | "stroke"  // pinceau : pointerdown → pointerup → +1
  | "erase"   // gomme : pointerdown → pointerup → +1
  | "fill"    // remplissage bucket → +1
  | "shape"   // ligne / rect / ellipse pointerup → +1
  | "move"    // (historique) import image / déplacement → +1
  | "clear"   // effacement complet → remet le score au checkpoint précédent (ou 0)
  | "undo"    // annulation Ctrl+Z → -1
  | "redo"    // rétablissement Ctrl+Y → 0 (neutre)
  | "text"        // (v2) texte pixel — compte comme un geste de dessin
  | "transform";  // (v2) sélection déplacée/dupliquée/retournée — crédit plafonné

export interface ActionEvent {
  kind: ActionKind;
  t: number;      // ms depuis le début de la session de dessin
  tool?: string;  // outil actif (brush, eraser, fill…)
  color?: string; // couleur active (#rrggbb)

  // ── v2 (optionnels) ───────────────────────────────────────────────────────
  v?: 2;          // marqueur : séquence produite par le moteur v2 (1re action)
  n?: number;     // pixels réellement modifiés par ce geste (0 = geste sans effet → 0 point)
  br?: string;    // brosse utilisée ("round", "pixel", "c:4x4:…")
  tx?: string;    // texture / trame ("solid", "b50", "hl", "c:…")
  sz?: number;    // taille du trait
  sy?: string;    // symétrie ("v", "h", "vh", "r6"…) si active
  op?: number;    // opacité % (écrans RGB565 uniquement)
}

/**
 * Événement de replay pixel-perfect.
 * Enregistre les coordonnées complètes pour reconstruire le dessin en temps réel.
 */
export interface ReplayEvent {
  kind: "down" | "move" | "up" | "clear" | "fill" | "shape" | "grad" | "sel" | "text";
  t: number;       // ms depuis début session
  x: number;       // coordonnée canvas (px)
  y: number;       // coordonnée canvas (px)
  tool?: string;   // absent sur les "move"/"up" du moteur v2 (déjà porté par le "down")
  color?: string;
  size?: number;
  pressure?: number; // pression stylet si disponible [0..1]
  id?: number;        // pointerId — isole les traits simultanés (multi-touch).
                       // Absent sur les replays enregistrés avant ce champ ;
                       // ces anciens événements sont alors traités comme un flux unique.
  x2?: number;         // point d'arrivée, uniquement pour kind "shape" / "grad"
  y2?: number;
  shapeType?: "line" | "rect" | "ellipse" | "poly"; // uniquement pour kind "shape"

  // ── v2 (optionnels) ───────────────────────────────────────────────────────
  v?: 2;           // 1er événement d'un replay produit par le moteur v2 : rejoué pixel-exact
  br?: string;     // brosse : id ("round", "square", "spray"…) ou "c:WxH:base64"
  tx?: string;     // texture/trame : "solid", "b12".."b88", "hl", "c:<16 hex>"
  op?: number;     // opacité % (1..100, écrans RGB565)
  sd?: number;     // graine du générateur pseudo-aléatoire (brosse "spray")
  sy?: string;     // symétrie : "v" | "h" | "vh" | "r3".."r8"
  cx?: number;     // centre de symétrie (coordonnées "bord de pixel")
  cy?: number;
  fl?: 0 | 1;      // forme pleine
  pp?: 0 | 1;      // pixel parfait (suppression des coins en L)
  fc?: 0 | 1;      // forme tracée depuis le centre
  pts?: number[];  // polygone / lasso : [x0,y0,x1,y1,…]
  c2?: string;     // 2e couleur (dégradé)
  gl?: 0 | 1;      // remplissage global (toutes les zones de même couleur)
  sel?: SelectionDesc; // description de la sélection pour kind "sel"
  m?: [number, number, number, number]; // matrice de transformation (retournements / rotations 90°)
  dx?: number;     // déplacement de la sélection
  dy?: number;
  cp?: 0 | 1;      // copie (la sélection d'origine reste en place)
  dl?: 0 | 1;      // suppression de la sélection
  s?: string;      // texte (kind "text")
  sc?: number;     // échelle du texte
  f?: number;      // index de frame (réservé au futur pipeline GIF/loop)
}

/** Sélection décrite de façon reproductible (résolue contre l'image au moment du geste). */
export type SelectionDesc =
  | { t: "rect"; x: number; y: number; w: number; h: number }
  | { t: "wand"; x: number; y: number; g: 0 | 1 }
  | { t: "poly"; pts: number[] };

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
 * Calcule le Proof-of-Draw score depuis une séquence d'actions (règles historiques).
 *
 * Règles :
 *   - undo → -1
 *   - clear → remet le score au dernier checkpoint empilé (ou 0 si vide)
 *   - toute autre action (sauf redo) → +1
 *   - redo → neutre (0)
 *
 * Chaque clear empile le score courant sur une pile de checkpoints.
 * Un undo après un clear restaure le checkpoint précédent.
 *
 * ⚠ Ces règles restent celles des séquences enregistrées AVANT le moteur v2.
 * Pour une séquence quelconque (ancienne ou v2), utiliser `scoreActions`
 * de `lib/drawEngine/scoring.ts`, qui choisit les bonnes règles.
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
