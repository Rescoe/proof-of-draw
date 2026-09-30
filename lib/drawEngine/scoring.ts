// lib/drawEngine/scoring.ts
// Points de Proof-of-Draw, calculés à partir du journal d'actions.
//
// Module PUR (aucune dépendance DOM/React/serveur) : le client l'utilise pour
// afficher les points en direct, la galerie pour afficher la chronologie d'un
// bloc, et les validateurs peuvent recalculer le même score depuis
// `actionSequence` sans rien faire confiance au client.
//
// Deux jeux de règles, choisis automatiquement :
//   • séquences enregistrées AVANT le moteur v2 (pas de `v: 2`) → règles
//     historiques inchangées (`scoreFromActions`) ;
//   • séquences v2 → règles ci-dessous (piles annuler/rétablir exactes).
//
// Règles v2
//   +1  par geste de dessin qui a réellement modifié des pixels
//       (trait, remplissage/dégradé, forme, texte) ;
//    0  gomme, sélection non validée, geste sans effet (`n = 0`) ;
//   +1  par déplacement/transformation de sélection validé, MAIS le crédit est
//       plafonné à la moitié des gestes de dessin : impossible de gonfler le
//       score en déplaçant la même zone d'avant en arrière ;
//   annuler retire exactement les points du geste annulé, rétablir les rend ;
//   effacer tout remet le compteur à zéro (l'annuler le restaure).

import { ActionEvent, scoreFromActions } from "@/lib/types/actions";

export const PAINT_KINDS = new Set(["stroke", "fill", "shape", "text"]);
export const CREDIT_KINDS = new Set(["transform", "move"]);

export interface ScoreBreakdown {
  score: number;
  paint: number;           // gestes de dessin comptés
  transforms: number;      // transformations validées (avant plafonnement)
  credited: number;        // transformations réellement créditées
  version: 1 | 2;
}

export function isEngineV2(actions: ActionEvent[]): boolean {
  return actions.length > 0 && actions[0].v === 2;
}

const hasEffect = (a: ActionEvent) => a.n === undefined || a.n > 0;

interface Frame { a: ActionEvent; paint: number; transforms: number }

function scoreOf(paint: number, transforms: number): ScoreBreakdown {
  const credited = Math.min(transforms, Math.floor(paint / 2));
  return { score: paint + credited, paint, transforms, credited, version: 2 };
}

/** Score et détail à l'issue de la séquence complète. */
export function scoreBreakdown(actions: ActionEvent[]): ScoreBreakdown {
  if (!isEngineV2(actions)) {
    return { score: scoreFromActions(actions), paint: 0, transforms: 0, credited: 0, version: 1 };
  }
  const tl = simulate(actions);
  return tl.final;
}

export function scoreActions(actions: ActionEvent[]): number {
  return scoreBreakdown(actions).score;
}

/** Score courant après chaque action (pour la chronologie du détail d'un bloc). */
export function scoreTimeline(actions: ActionEvent[]): number[] {
  if (!isEngineV2(actions)) {
    // règles historiques, en cumul (undo = -1, clear = 0, redo = 0)
    const out: number[] = [];
    let running = 0;
    const checkpoints: number[] = [];
    let lastWasClear = false;
    for (const a of actions) {
      if (a.kind === "redo") { lastWasClear = false; }
      else if (a.kind === "clear") { checkpoints.push(running); running = 0; lastWasClear = true; }
      else if (a.kind === "undo") {
        if (lastWasClear && checkpoints.length > 0) running = checkpoints.pop()!; else running -= 1;
        lastWasClear = false;
      } else { running += 1; lastWasClear = false; }
      out.push(running);
    }
    return out;
  }
  return simulate(actions).timeline;
}

function simulate(actions: ActionEvent[]): { timeline: number[]; final: ScoreBreakdown } {
  const applied: Frame[] = [];
  const undone: Frame[] = [];
  const timeline: number[] = [];
  const top = () => applied[applied.length - 1];
  for (const a of actions) {
    if (a.kind === "undo") {
      const f = applied.pop();
      if (f) undone.push(f);
    } else if (a.kind === "redo") {
      const f = undone.pop();
      if (f) applied.push(f);
    } else {
      undone.length = 0;
      const prev = top();
      let paint = prev ? prev.paint : 0, transforms = prev ? prev.transforms : 0;
      if (a.kind === "clear") { paint = 0; transforms = 0; }
      else if (PAINT_KINDS.has(a.kind) && hasEffect(a)) paint++;
      else if (CREDIT_KINDS.has(a.kind) && hasEffect(a)) transforms++;
      applied.push({ a, paint, transforms });
    }
    const t = top();
    timeline.push(t ? scoreOf(t.paint, t.transforms).score : 0);
  }
  const t = top();
  return { timeline, final: t ? scoreOf(t.paint, t.transforms) : scoreOf(0, 0) };
}

// ─── Profil de savoir-faire (informatif) ─────────────────────────────────────
// Dérivé du journal d'actions : il n'entre PAS dans `drawScore` (qui reste le
// nombre de gestes), il sert à valoriser la variété des techniques employées
// — dans l'interface, dans la galerie et, plus tard, dans les calculs des
// validateurs.

export interface Achievement {
  id: string;
  label: string;
  hint: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first",    label: "Premier trait",   hint: "Poser un premier trait" },
  { id: "shapes",   label: "Formes",          hint: "Tracer une ligne, un rectangle ou une ellipse" },
  { id: "fill",     label: "Aplat",           hint: "Remplir une zone" },
  { id: "texture",  label: "Texture",         hint: "Peindre avec une trame ou un motif" },
  { id: "symmetry", label: "Symétrie",        hint: "Dessiner avec la symétrie" },
  { id: "gradient", label: "Dégradé",         hint: "Remplir avec un dégradé tramé" },
  { id: "select",   label: "Retouche",        hint: "Déplacer ou dupliquer une sélection" },
  { id: "text",     label: "Texte",           hint: "Écrire un texte pixel" },
  { id: "custom",   label: "Brosse maison",   hint: "Dessiner avec une brosse personnalisée" },
  { id: "variety",  label: "Touche-à-tout",   hint: "Utiliser 4 outils différents" },
  { id: "steady",   label: "Persévérance",    hint: "Atteindre 20 points" },
];

export interface CraftProfile {
  tools: string[];
  achievements: string[];   // ids débloqués
  score: number;
}

export function craftProfile(actions: ActionEvent[]): CraftProfile {
  const tools = new Set<string>();
  const got = new Set<string>();
  for (const a of actions) {
    if (a.kind === "undo" || a.kind === "redo" || a.kind === "clear") continue;
    if (a.kind === "erase" && a.n === 0) continue;
    if (a.tool) tools.add(a.tool);
    if (a.kind === "stroke") got.add("first");
    if (a.kind === "shape") got.add("shapes");
    if (a.kind === "fill" && a.tool !== "gradient") got.add("fill");
    if (a.tool === "gradient") got.add("gradient");
    if (a.kind === "transform") got.add("select");
    if (a.kind === "text") got.add("text");
    if (a.tx && a.tx !== "solid") got.add("texture");
    if (a.sy) got.add("symmetry");
    if (a.br && a.br.startsWith("c:")) got.add("custom");
  }
  const score = scoreActions(actions);
  if (tools.size >= 4) got.add("variety");
  if (score >= 20) got.add("steady");
  return { tools: [...tools], achievements: ACHIEVEMENTS.filter(x => got.has(x.id)).map(x => x.id), score };
}
