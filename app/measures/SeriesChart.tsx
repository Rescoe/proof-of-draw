"use client";
// app/measures/SeriesChart.tsx — COURBES INTERACTIVES de toutes les grandeurs (02/11/2026, refonte). Remplace la courbe simple de app/MeasuresChart.tsx (archivée : archive/2026-11-02_vue-capteurs-v1).
// • points RÉELS reliés par des segments droits (aucun lissage, aucune interpolation sur un trou : un trou coupe la courbe) ;
// • une fenêtre de temps PARTAGÉE par toutes les courbes : molette / pincement / boutons = zoom, glisser = déplacement, toucher (ou clic) = valeur et heure exactes du point le plus proche ;
// • clavier : ← → point précédent / suivant, + − zoom, Début / Fin ; aucune requête : les données viennent du parent (UNE lecture, voir useDeviceMeasures).
import { useEffect, useMemo, useRef } from "react";
import { MEASURE_KINDS, formatMeasure, type Measure, type MeasureKind } from "@/lib/measures";
import { clampWin, dailyBands, medianStep, panBy, segments, seriesOf, valueAxis, visiblePoints, zoomAt, type Pt, type Win } from "@/lib/chartView";
import { nearestPointIndex, timeAxisTicks } from "@/lib/timeAxis";
import { VOC_BANDS, KIND_COLOR } from "./palette";
import { exactLabel } from "@/lib/measureReading";

const W = 720, H = 156, PL = 46, PR = 12, PT = 12, PB = 22;
const NO_SELECT: React.CSSProperties = { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" };

export type CurveView = "points" | "band" | "both";
export interface ChartShared { view: CurveView; win: Win; full: Win; setWin: (w: Win) => void; sel: number | null; setSel: (t: number | null) => void; tz: number }

export function KindChart({ kind, measures, shared }: { kind: MeasureKind; measures: Measure[]; shared: ChartShared }) {
  const { view, win, full, setWin, sel, setSel, tz } = shared;
  const info = MEASURE_KINDS[kind], color = KIND_COLOR[kind];
  const pts = useMemo(() => seriesOf(measures, kind), [measures, kind]);
  const step = useMemo(() => medianStep(pts), [pts]);
  const segs = useMemo(() => segments(pts, step), [pts, step]);
  const bands = useMemo(() => dailyBands(pts, tz), [pts, tz]);
  const times = useMemo(() => pts.map((p) => p.t), [pts]);
  const vis = useMemo(() => visiblePoints(pts, win), [pts, win]);
  const axis = useMemo(() => valueAxis(kind, view === "points" ? (vis.length ? vis : pts).map((p) => p.v) : bands.filter((b) => b.end >= win.t0 && b.start <= win.t1).flatMap((b) => [b.min, b.max]).concat((vis.length ? vis : pts).map((p) => p.v))), [kind, view, vis, pts, bands, win]);
  const svgRef = useRef<SVGSVGElement>(null);
  const live = useRef({ win, full, setWin });
  useEffect(() => { live.current = { win, full, setWin }; });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ startX: number; win: Win; moved: boolean; pinch: number | null } | null>(null);

  const span = win.t1 - win.t0, plotW = W - PL - PR;
  const x = (t: number) => PL + ((t - win.t0) / span) * plotW;
  const y = (v: number) => { const a = axis!; return PT + (1 - (v / info.scale - a.lo) / (a.hi - a.lo)) * (H - PT - PB); };
  const fracOf = (clientX: number) => { const r = svgRef.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, ((clientX - r.left) / r.width * W - PL) / plotW)); };

  const hasAxis = axis !== null;
  // la molette doit pouvoir bloquer le défilement de la page : écouteur non passif
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width * W - PL) / plotW));
      const { win: w, full: fu, setWin: sw } = live.current;
      sw(zoomAt(w, fu, f, e.deltaY > 0 ? 1.25 : 0.8));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plotW, hasAxis]);

  const pick = (clientX: number) => {
    const t = win.t0 + fracOf(clientX) * span;
    const i = nearestPointIndex(times, t);
    if (i >= 0) setSel(times[i]);
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const two = pointers.current.size === 2 ? [...pointers.current.values()] : null;
    drag.current = { startX: e.clientX, win, moved: false, pinch: two ? Math.abs(two[0].x - two[1].x) : null };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {                                   // pincement : zoom autour du milieu des deux doigts
      const [a, b] = [...pointers.current.values()], dist = Math.abs(a.x - b.x);
      if (d.pinch && dist > 8) { const f = fracOf((a.x + b.x) / 2); setWin(zoomAt(d.win, full, f, d.pinch / dist)); d.moved = true; }
      return;
    }
    const r = svgRef.current!.getBoundingClientRect(), dx = e.clientX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    if (d.moved) setWin(panBy(d.win, full, -(dx / r.width) * (W / plotW) * (d.win.t1 - d.win.t0)));
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (d && !d.moved && pointers.current.size === 0) pick(e.clientX);
    if (pointers.current.size === 0) drag.current = null; else if (d) { d.moved = true; d.pinch = null; }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const i = sel === null ? -1 : nearestPointIndex(times, sel);
    if (e.key === "ArrowRight" && times.length) { setSel(times[Math.min(times.length - 1, i + 1)]); e.preventDefault(); }
    else if (e.key === "ArrowLeft" && times.length) { setSel(times[Math.max(0, i < 0 ? times.length - 1 : i - 1)]); e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") { setWin(zoomAt(win, full, 0.5, 0.7)); e.preventDefault(); }
    else if (e.key === "-") { setWin(zoomAt(win, full, 0.5, 1.4)); e.preventDefault(); }
    else if (e.key === "Home") { setWin(clampWin({ t0: full.t0, t1: full.t0 + span }, full)); e.preventDefault(); }
    else if (e.key === "End") { setWin(clampWin({ t0: full.t1 - span, t1: full.t1 }, full)); e.preventDefault(); }
  };

  if (pts.length === 0) return null;
  const selIdx = sel === null ? -1 : nearestPointIndex(times, sel);
  const selPt: Pt | null = selIdx >= 0 && Math.abs(times[selIdx] - (sel as number)) <= Math.max(step * 1.5, 1800) ? pts[selIdx] : null;
  const last = pts[pts.length - 1];
  const shown = selPt ?? last;
  const ticks = timeAxisTicks(win.t0, win.t1, tz, 6);
  const dots = vis.length <= 160;

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.88rem", color }}>{info.icon} {info.label}</strong>
        <span style={{ fontSize: "0.82rem", color: "var(--text2)" }} aria-live="polite">
          {selPt ? "" : "dernière mesure · "}<b style={{ color: "var(--text)" }}>{formatMeasure(kind, shown.v)}</b> <span style={{ color: "var(--text3)" }}>{exactLabel(shown.t, tz)}</span>
        </span>
      </div>
      {axis && (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="application" tabIndex={0} aria-label={`Courbe ${info.label} : ${pts.length} mesures. Flèches gauche et droite pour parcourir les points, plus et moins pour zoomer.`}
          style={{ width: "100%", height: "auto", touchAction: "pan-y", cursor: "crosshair", outline: "none", ...NO_SELECT }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
          <defs><clipPath id={`clip-${kind}`}><rect x={PL} y={PT} width={plotW} height={H - PT - PB} /></clipPath></defs>
          {kind === "vocidx" && VOC_BANDS.map((b) => {
            const lo = Math.max(axis.lo, b.from), hi = Math.min(axis.hi, b.to);
            if (hi <= lo) return null;
            const y0 = PT + (1 - (hi - axis.lo) / (axis.hi - axis.lo)) * (H - PT - PB), y1 = PT + (1 - (lo - axis.lo) / (axis.hi - axis.lo)) * (H - PT - PB);
            return <rect key={b.label} x={PL} y={y0} width={plotW} height={y1 - y0} fill={b.color} opacity={0.1} />;
          })}
          {axis.ticks.map((v) => { const yy = PT + (1 - (v - axis.lo) / (axis.hi - axis.lo)) * (H - PT - PB); return <g key={v}><line x1={PL} x2={W - PR} y1={yy} y2={yy} stroke="var(--border)" opacity={0.5} /><text x={PL - 6} y={yy + 3} fontSize="10" textAnchor="end" fill="var(--text3)">{v}</text></g>; })}
          {ticks.map((t) => <g key={t.t}><line x1={x(t.t)} x2={x(t.t)} y1={PT} y2={H - PB} stroke="var(--border)" opacity={t.major ? 0.7 : 0.25} /><text x={x(t.t)} y={H - 6} fontSize="10" textAnchor="middle" fill={t.major ? "var(--text2)" : "var(--text3)"}>{t.label}</text></g>)}
          <text x={4} y={PT + 4} fontSize="10" fill="var(--text3)">{info.unit}</text>
          <g clipPath={`url(#clip-${kind})`}>
            {view !== "points" && bands.map((b) => (b.end < win.t0 || b.start > win.t1) ? null : <rect key={b.start} x={x(b.start) + 1} width={Math.max(1, x(b.end) - x(b.start) - 2)} y={y(b.max)} height={Math.max(2, y(b.min) - y(b.max))} rx={3} fill={color} opacity={0.22}><title>{`Amplitude du jour : ${formatMeasure(kind, b.min)} à ${formatMeasure(kind, b.max)} (moyenne ${formatMeasure(kind, b.avg)}, ${b.n} mesures)`}</title></rect>)}
            {view === "band" && bands.length > 0 && <path d={bands.filter((b) => b.end >= win.t0 && b.start <= win.t1).map((b, k) => `${k ? "L" : "M"}${x((b.start + b.end) / 2).toFixed(1)},${y(b.avg).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
            {view !== "band" && segs.map((s, i) => {
              const v = visiblePoints(s, win);
              if (v.length === 0) return null;
              return <path key={i} d={v.map((p, k) => `${k ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
            })}
            {view !== "band" && (dots || vis.length === 1) && vis.map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={3} fill={color} />)}
            {selPt && <>
              <line x1={x(selPt.t)} x2={x(selPt.t)} y1={PT} y2={H - PB} stroke="var(--text)" strokeDasharray="3 3" opacity={0.7} />
              <circle cx={x(selPt.t)} cy={y(selPt.v)} r={6} fill={color} stroke="var(--bg)" strokeWidth={2} />
            </>}
          </g>
        </svg>
      )}
    </div>
  );
}
