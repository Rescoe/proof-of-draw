// lib/drawEngine/podHints.ts
// Aperçu côté client des critères de Proof-of-Draw appliqués au replay
// (miroir de `analyzeReplay` dans lib/crypto.ts, sans ses dépendances serveur).
// Sert à guider l'artiste AVANT l'envoi. Les seuils réels sont ceux du serveur
// (configurables par variables d'environnement) : ces valeurs sont indicatives,
// et hormis l'automatisation, le serveur ne fait que signaler.

import type { ReplayEvent } from "@/lib/types/actions";

export const POD_MIN_SESSION_MS = 15000;
export const POD_MIN_STROKES = 3;
export const POD_MIN_COVERAGE = 0.05;
export const POD_MAX_AUTOMATION = 0.8;

export interface PodHints {
  sessionMs: number;
  strokes: number;
  coverage: number;
  automationRatio: number;
  colors: number;
  okSession: boolean;
  okStrokes: boolean;
  okCoverage: boolean;
  okAutomation: boolean;
}

export function podHints(replay: ReplayEvent[], W: number, H: number): PodHints {
  if (replay.length < 2) {
    return { sessionMs: 0, strokes: 0, coverage: 0, automationRatio: 0, colors: 0, okSession: false, okStrokes: false, okCoverage: false, okAutomation: true };
  }
  const GRID = 8;
  const touched = new Set<number>();
  const colors = new Set<string>();
  let strokes = 0, fast = 0, intervals = 0;
  for (let i = 0; i < replay.length; i++) {
    const ev = replay[i];
    if (ev.kind === "down") strokes++;
    const cx = Math.min(GRID - 1, Math.floor(ev.x / (W / GRID)));
    const cy = Math.min(GRID - 1, Math.floor(ev.y / (H / GRID)));
    touched.add(cy * GRID + cx);
    if (ev.color) colors.add(ev.color);
    if (i > 0) { intervals++; if (ev.t - replay[i - 1].t < 15) fast++; }
  }
  const sessionMs = replay.length >= 2 ? replay[replay.length - 1].t - replay[0].t : 0;
  const coverage = touched.size / (GRID * GRID);
  const automationRatio = intervals > 0 ? fast / intervals : 0;
  return {
    sessionMs, strokes, coverage, automationRatio, colors: colors.size,
    okSession: sessionMs >= POD_MIN_SESSION_MS,
    okStrokes: strokes >= POD_MIN_STROKES,
    okCoverage: coverage >= POD_MIN_COVERAGE,
    okAutomation: automationRatio <= POD_MAX_AUTOMATION,
  };
}
