// Aides communes aux tests du moteur de dessin.
import {
  DrawSession, StrokeSettings, ShapeSettings, FillSettings, GradientSettings, TextSettings,
  ColorMode, Replayer, rng, Bitmap,
} from "@/lib/drawEngine";

export const stroke = (o: Partial<StrokeSettings> = {}): StrokeSettings => ({
  erase: false, brush: "round", size: 3, color: "#000000", opacity: 100, texture: "solid",
  sym: null, pixelPerfect: false, ...o,
});
export const shape = (o: Partial<ShapeSettings> = {}): ShapeSettings => ({
  shape: "rect", brush: "round", size: 1, color: "#000000", opacity: 100, texture: "solid",
  fill: false, fromCenter: false, sym: null, ...o,
});
export const fillS = (o: Partial<FillSettings> = {}): FillSettings => ({ color: "#000000", opacity: 100, texture: "solid", global: false, ...o });
export const gradS = (o: Partial<GradientSettings> = {}): GradientSettings => ({ color: "#000000", color2: "#FFFFFF", global: false, ...o });
export const textS = (o: Partial<TextSettings> = {}): TextSettings => ({ color: "#000000", scale: 1, opacity: 100, texture: "solid", ...o });

export const PALETTES: Record<ColorMode, string[]> = {
  bw: ["#000000", "#FFFFFF"],
  bwr: ["#000000", "#FFFFFF", "#CC0000"],
  rgb565: ["#ff0000", "#00ff00", "#3366ff", "#ffff00", "#000000", "#ffffff", "#7a3fbf", "#ff8800"],
};

export const TEXTURE_POOL = ["solid", "solid", "solid", "b50", "b25", "hl", "dg", "chk", "brk", "wav", "c:aa55aa55aa55aa55"];
export const BRUSH_POOL = ["round", "round", "square", "pixel", "diamond", "hbar", "vbar", "slash", "bslash", "spray", "c:3x3:qA=="];

/** Trace un trait à main levée : down, quelques moves à ≥16 ms, up. Retourne le temps final. */
export function drawStroke(s: DrawSession, id: number, pts: [number, number][], t: number, set: StrokeSettings): number {
  s.beginStroke(id, { x: pts[0][0], y: pts[0][1] }, t, set);
  for (let i = 1; i < pts.length - 1; i++) { t += 17; s.moveStroke(id, { x: pts[i][0], y: pts[i][1] }, t); }
  t += 17;
  const last = pts[pts.length - 1];
  s.endStroke(id, { x: last[0], y: last[1] }, t);
  return t;
}

/**
 * Séquence aléatoire (déterministe pour une graine) de gestes variés, avec undo/redo/clear.
 * `check` est appelé après chaque geste.
 */
export function randomSequence(
  seed: number, mode: ColorMode, count: number, W: number, H: number,
  check: (s: DrawSession, step: number, what: string) => void,
): DrawSession {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const pt = (): [number, number] => [Math.floor(r() * W), Math.floor(r() * H)];
  const pal = PALETTES[mode];
  const color = () => pick(pal);
  const opacity = () => (mode === "rgb565" && r() < 0.4 ? 20 + Math.floor(r() * 70) : 100);
  const sym = () => {
    const x = r();
    if (x < 0.75) return null;
    const m = pick(["v", "h", "vh", "r3", "r4", "r6", "r8"]);
    return { m, cx: W / 2, cy: H / 2 };
  };
  const s = new DrawSession({ width: W, height: H, mode });
  let t = 1000;
  for (let i = 0; i < count; i++) {
    t += 50 + Math.floor(r() * 500);
    const x = r();
    let what = "";
    if (x < 0.34) {
      what = "stroke";
      const n = 2 + Math.floor(r() * 12);
      const pts: [number, number][] = [];
      for (let k = 0; k < n; k++) pts.push(pt());
      t = drawStroke(s, 1, pts, t, stroke({
        erase: r() < 0.15, brush: pick(BRUSH_POOL), size: 1 + Math.floor(r() * 9), color: color(), opacity: opacity(),
        texture: pick(TEXTURE_POOL), sym: sym(), pixelPerfect: r() < 0.3,
      }));
    } else if (x < 0.5) {
      what = "shape";
      const kind = pick(["line", "rect", "ellipse", "poly"] as const);
      const a = pt();
      const set = shape({ shape: kind, brush: pick(["round", "square"]), size: 1 + Math.floor(r() * 4), color: color(), opacity: opacity(), texture: pick(TEXTURE_POOL), fill: r() < 0.5, fromCenter: r() < 0.2, sym: sym() });
      const pts = kind === "poly" ? [...a, ...pt(), ...pt(), ...pt()] : undefined;
      for (let k = 0; k < 3; k++) s.previewShape(set, { x: a[0], y: a[1] }, { x: pt()[0], y: pt()[1] }, t, pts);
      const b = pt();
      s.previewShape(set, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, t, pts);
      s.commitShape(t + 10);
    } else if (x < 0.62) {
      what = "fill";
      const p = pt();
      s.fill({ x: p[0], y: p[1] }, t, fillS({ color: color(), opacity: opacity(), texture: pick(TEXTURE_POOL), global: r() < 0.25 }));
    } else if (x < 0.67) {
      what = "gradient";
      const a = pt(), b = pt();
      s.gradientFill({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, t, gradS({ color: color(), color2: color(), global: r() < 0.2 }));
    } else if (x < 0.71) {
      what = "text";
      const p = pt();
      s.text({ x: p[0], y: p[1] }, pick(["Salut", "Été é ç", "Hello\nWorld", "♥ PoD ★"]), t, textS({ color: color(), scale: 1 + Math.floor(r() * 2), texture: pick(TEXTURE_POOL) }));
    } else if (x < 0.83) {
      what = "select";
      const kind = r();
      const a = pt(), b = pt();
      if (kind < 0.4) s.selectRegion({ t: "rect", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 });
      else if (kind < 0.7) s.selectRegion({ t: "wand", x: a[0], y: a[1], g: r() < 0.3 ? 1 : 0 });
      else s.selectRegion({ t: "poly", pts: [...a, ...b, ...pt(), ...pt()] });
      const mode2 = r();
      if (mode2 < 0.2) s.deleteSelection(t);
      else {
        const m = pick([[1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [0, -1, 1, 0], [0, 1, -1, 0]] as [number, number, number, number][]);
        s.floatUpdate({ m, dx: Math.floor(r() * 21) - 10, dy: Math.floor(r() * 21) - 10, copy: r() < 0.3 });
        if (r() < 0.2) s.floatCancel(); else s.floatCommit(t + 5);
      }
    } else if (x < 0.93) {
      what = "undo";
      s.undo(t);
      if (r() < 0.5) { t += 30; s.redo(t); what = "undo+redo"; }
    } else if (x < 0.96) {
      what = "redo";
      s.redo(t);
    } else {
      what = "clear";
      s.clear(t);
    }
    check(s, i, what);
  }
  return s;
}

export function replayOf(s: DrawSession): Bitmap {
  return Replayer.reconstruct(JSON.parse(JSON.stringify(s.getReplay())), { width: s.cfg.width, height: s.cfg.height, mode: s.cfg.mode, background: s.cfg.background });
}
