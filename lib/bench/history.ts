// lib/bench/history.ts — historique annuler / rétablir de l'éditeur d'animation (réducteur PUR, testé).
//
// Un « Doc » = les images, leurs délais et l'image courante. Les images sont immuables (copie sur écriture, voir draw.ts) : un instantané
// ne copie que des références, donc 100 pas d'historique restent légers. Annuler restaure aussi l'image courante de l'instantané :
// l'éditeur revient là où la modification a eu lieu.
//
//   begin   : enregistre l'état actuel dans le passé (début d'un trait, d'un glissement de curseur…) — vide le « rétablir »
//   patch   : modifie le Doc SANS historique (les étapes d'un même trait : un trait = un seul pas d'annulation)
//   commit  : begin + patch (une opération en un coup : remplir, décaler, ajouter une image…)
//   nav     : change l'image courante SANS historique (naviguer n'est pas une modification)
//   step    : image suivante / précédente en boucle (clavier, lecture de l'aperçu), SANS historique
//   undo / redo / reset

import type { Frame } from "@/lib/bench/draw";

/** `handmade` : faux pour un modèle de test chargé (jamais enregistré dans la galerie), vrai dès qu'on modifie — et annuler restaure aussi cet état. */
export interface Doc { frames: Frame[]; delays: number[]; cur: number; handmade?: boolean }
export interface Hist { doc: Doc; past: Doc[]; future: Doc[] }
export type Act =
  | { type: "begin" }
  | { type: "patch"; fn: (d: Doc) => Doc }
  | { type: "commit"; fn: (d: Doc) => Doc }
  | { type: "nav"; cur: number }
  | { type: "step"; delta: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; doc: Doc };

export const HISTORY_MAX = 100;

export const initHist = (doc: Doc): Hist => ({ doc, past: [], future: [] });

const pushPast = (past: Doc[], d: Doc): Doc[] => (past.length >= HISTORY_MAX ? [...past.slice(past.length - HISTORY_MAX + 1), d] : [...past, d]);
const clampCur = (d: Doc): Doc => (d.cur >= 0 && d.cur < d.frames.length ? d : { ...d, cur: Math.max(0, Math.min(d.frames.length - 1, d.cur)) });

export function histReducer(h: Hist, a: Act): Hist {
  switch (a.type) {
    case "begin": return { doc: h.doc, past: pushPast(h.past, h.doc), future: [] };
    case "patch": return { ...h, doc: clampCur(a.fn(h.doc)) };
    case "commit": return { doc: clampCur(a.fn(h.doc)), past: pushPast(h.past, h.doc), future: [] };
    case "nav": return h.doc.cur === a.cur ? h : { ...h, doc: clampCur({ ...h.doc, cur: a.cur }) };
    case "step": {
      const n = h.doc.frames.length;
      return n < 2 ? h : { ...h, doc: { ...h.doc, cur: (((h.doc.cur + a.delta) % n) + n) % n } };
    }
    case "undo": {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      return { doc: prev, past: h.past.slice(0, -1), future: [h.doc, ...h.future] };
    }
    case "redo": {
      if (!h.future.length) return h;
      const [next, ...rest] = h.future;
      return { doc: next, past: pushPast(h.past, h.doc), future: rest };
    }
    case "reset": return initHist(a.doc);
  }
}
