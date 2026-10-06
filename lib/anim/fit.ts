// lib/anim/fit.ts — ajustement du canvas 128×64 à la zone disponible, et choix de la disposition (pur, testé).
//
// Problèmes corrigés (06/10/2026) : en paysage le canvas débordait de l'écran ; la boîte à outils était SOUS le canvas, donc le défilement de la page passait sur le canvas
// et déclenchait des traits parasites. Désormais l'atelier occupe tout l'écran (aucun défilement de page) et le canvas est calculé pour TENIR entièrement dans la scène.

export interface FitResult {
  /** Facteur d'agrandissement (pixels CSS par pixel d'image). */
  scale: number;
  /** Taille CSS du canvas. */
  width: number;
  height: number;
}

/**
 * Plus grand agrandissement qui fait tenir w×h dans la scène (marge `pad` de chaque côté). Entier dès que c'est ≥ 3 (pixels réguliers, plus lisibles),
 * fractionnaire en dessous (petits écrans) ; jamais < 0,5.
 */
export function fitCanvas(stageW: number, stageH: number, w: number, h: number, pad = 12): FitResult {
  const availW = Math.max(1, stageW - pad * 2), availH = Math.max(1, stageH - pad * 2);
  let scale = Math.min(availW / w, availH / h);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  if (scale >= 3) scale = Math.floor(scale);
  scale = Math.max(0.5, scale);
  return { scale, width: Math.round(w * scale), height: Math.round(h * scale) };
}

export type Layout = "stack" | "side";

export interface LayoutChoice {
  layout: Layout;
  /** Hauteur réduite (téléphone en paysage) : barres plus compactes. */
  dense: boolean;
}

/**
 * « side » (outils à gauche, options à droite) dès que la fenêtre est nettement plus large que haute ET assez large ; « stack » sinon (téléphone en portrait).
 * `dense` quand la hauteur est faible (téléphone en paysage ≈ 360 px).
 */
export function chooseLayout(viewW: number, viewH: number): LayoutChoice {
  const side = viewW >= 620 && viewW >= viewH * 1.12;
  return { layout: side ? "side" : "stack", dense: viewH < 520 };
}
