"use client";
// app/measures/SeriesChart.tsx — GRAPHIQUE de mesures (refonte du 03/11/2026) : une ou DEUX grandeurs sur le même graphique (axe gauche / axe droit, couleurs, traits et marqueurs distincts).
// Même fenêtre de temps, même curseur et même zoom pour tous les graphiques affichés (état dans MeasuresPanel). Aucune requête : les données viennent du parent (une seule lecture d'historique).
// Représentations : Mesures (points réels, aucun lissage), Tendance (moyenne par tranche, annoncée comme telle), Min–max (bande + moyenne), Mesures + min–max. Un trou coupe toujours la courbe.
// Interactions : molette / pincement = zoom, glisser = déplacement, toucher = sélection (fiche sous les graphiques), clavier ← → + − Début Fin. Rien ne dépend du survol.
import { useEffect, useMemo, useRef } from "react";
import { MEASURE_KINDS, formatMeasure, type Measure, type MeasureKind } from "@/lib/measures";
import { bucketBands, clampWin, medianStep, panBy, segments, seriesOf, valueAxis, visiblePoints, zoomAt, type Pt, type ValueAxis, type Win } from "@/lib/chartView";
import { KIND_STYLE, axisSides, bandBucketSec, bucketName, decimate, neighborTime, trendBucketSec, trendOf, type Repr } from "@/lib/chartCompose";
import { nearestPointIndex, timeAxisTicks } from "@/lib/timeAxis";
import { VOC_BANDS, KIND_COLOR } from "./palette";

const W = 720, H = 220, PT = 14, PB = 24, PL_ONE = 46, PR_ONE = 12, PL_TWO = 46, PR_TWO = 46;
const NO_SELECT: React.CSSProperties = { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" };

export interface ChartShared {
  repr: Repr; fullScale: boolean;
  win: Win; full: Win; setWin: (w: Win) => void;
  sel: number | null; setSel: (t: number | null) => void;
  /** instant mis en évidence (venant d'un constat de « Lecture ») */
  focus: number | null;
  hidden: ReadonlySet<MeasureKind>; toggle: (k: MeasureKind) => void;
  tz: number;
}

function Marker({ shape, x, y, r, color, stroke }: { shape: "circle" | "square" | "diamond" | "triangle"; x: number; y: number; r: number; color: string; stroke?: string }) {
  const p = { fill: color, stroke: stroke ?? "none", strokeWidth: stroke ? 2 : 0 };
  if (shape === "square") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...p} />;
  if (shape === "diamond") return <polygon points={`${x},${y - r * 1.3} ${x + r * 1.3},${y} ${x},${y + r * 1.3} ${x - r * 1.3},${y}`} {...p} />;
  if (shape === "triangle") return <polygon points={`${x},${y - r * 1.25} ${x + r * 1.2},${y + r} ${x - r * 1.2},${y + r}`} {...p} />;
  return <circle cx={x} cy={y} r={r} {...p} />;
}

export function SeriesChart({ kinds, measures, shared }: { kinds: MeasureKind[]; measures: Measure[]; shared: ChartShared }) {
  const { repr, fullScale, win, full, setWin, sel, setSel, focus, hidden, toggle, tz } = shared;
  const id = kinds.join("-");
  const sides = useMemo(() => axisSides(kinds), [kinds]);
  const two = kinds.some((k) => sides[k] === "right");
  const PL = PL_ONE === PL_TWO ? PL_ONE : PL_ONE, PR = two ? PR_TWO : PR_ONE;
  const plotW = W - PL - PR, span = win.t1 - win.t0;
  const data = useMemo(() => kinds.map((k) => {
    const pts = seriesOf(measures, k), step = medianStep(pts);
    return { kind: k, pts, step, segs: segments(pts, step), times: pts.map((p) => p.t) };
  }), [kinds, measures]);
  const bandSec = bandBucketSec(span), trendSec = trendBucketSec(span);
  const derived = useMemo(() => data.map((d) => ({ bands: bucketBands(d.pts, bandSec, tz), trend: trendOf(d.pts, trendSec, tz) })), [data, bandSec, trendSec, tz]);

  const svgRef = useRef<SVGSVGElement>(null);
  const live = useRef({ win, full, setWin, plotW, PL });
  useEffect(() => { live.current = { win, full, setWin, plotW, PL }; });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ startX: number; win: Win; moved: boolean; pinch: number | null } | null>(null);

  // un axe par grandeur visible, calculé sur ce qui est réellement dessiné dans la fenêtre
  const axes = useMemo(() => data.map((d, i) => {
    if (hidden.has(d.kind)) return null;
    const vis = visiblePoints(d.pts, win).map((p) => p.v);
    const extra = repr === "points" ? [] : (repr === "trend" ? derived[i].trend.map((p) => p.v) : derived[i].bands.filter((b) => b.end >= win.t0 && b.start <= win.t1).flatMap((b) => [b.min, b.max]));
    const vals = repr === "trend" ? (extra.length ? extra : vis) : vis.concat(extra);
    return valueAxis(d.kind, vals.length ? vals : d.pts.map((p) => p.v), { full: fullScale });
  }), [data, derived, hidden, win, repr, fullScale]);

  const x = (t: number) => PL + ((t - win.t0) / span) * plotW;
  const yOf = (i: number, v: number) => { const a = axes[i] as ValueAxis; return PT + (1 - (v / MEASURE_KINDS[data[i].kind].scale - a.lo) / (a.hi - a.lo)) * (H - PT - PB); };
  const fracOf = (clientX: number) => { const r = svgRef.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, ((clientX - r.left) / r.width * W - PL) / plotW)); };

  const allHidden = data.every((d) => hidden.has(d.kind));
  const hasSvg = !allHidden;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = live.current, r = el.getBoundingClientRect();
      l.setWin(zoomAt(l.win, l.full, Math.min(1, Math.max(0, ((e.clientX - r.left) / r.width * W - l.PL) / l.plotW)), e.deltaY > 0 ? 1.25 : 0.8));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasSvg]);

  const visibleIdx = data.map((d, i) => (hidden.has(d.kind) ? -1 : i)).filter((i) => i >= 0);
  const pick = (clientX: number) => {
    const t = win.t0 + fracOf(clientX) * span;
    let best: number | null = null;
    for (const i of visibleIdx) { const j = nearestPointIndex(data[i].times, t); if (j >= 0 && (best === null || Math.abs(data[i].times[j] - t) < Math.abs(best - t))) best = data[i].times[j]; }
    if (best !== null) setSel(best);
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const two2 = pointers.current.size === 2 ? [...pointers.current.values()] : null;
    drag.current = { startX: e.clientX, win, moved: false, pinch: two2 ? Math.abs(two2[0].x - two2[1].x) : null };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()], dist = Math.abs(a.x - b.x);
      if (d.pinch && dist > 8) { setWin(zoomAt(d.win, full, fracOf((a.x + b.x) / 2), d.pinch / dist)); d.moved = true; }
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
  const shown = visibleIdx.map((i) => data[i].kind);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const t = neighborTime(measures, shown, sel, e.key === "ArrowRight" ? 1 : -1); if (t !== null) setSel(t); e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") { setWin(zoomAt(win, full, 0.5, 0.7)); e.preventDefault(); }
    else if (e.key === "-") { setWin(zoomAt(win, full, 0.5, 1.4)); e.preventDefault(); }
    else if (e.key === "Home") { setWin(clampWin({ t0: full.t0, t1: full.t0 + span }, full)); e.preventDefault(); }
    else if (e.key === "End") { setWin(clampWin({ t0: full.t1 - span, t1: full.t1 }, full)); e.preventDefault(); }
  };

  const ticks = timeAxisTicks(win.t0, win.t1, tz, 6);
  const firstVisible = visibleIdx[0];
  const gridAxis = firstVisible !== undefined ? (axes[firstVisible] as ValueAxis) : null;
  const note = repr === "trend" ? `Tendance : moyenne ${bucketName(trendSec)} (ce n'est pas une mesure)` : repr === "band" || repr === "both" ? `Min–max ${bucketName(bandSec)}${repr === "band" ? ", trait = moyenne" : ""}` : "";
  const gap = (i: number) => data[i].segs.length > 1;

  return (
    <figure className="mv-chart" aria-label={kinds.map((k) => MEASURE_KINDS[k].label).join(" et ")}>
      <div className="mv-legend" role="group" aria-label="Séries affichées : toucher pour masquer ou montrer">
        {data.map((d) => {
          const off = hidden.has(d.kind), st = KIND_STYLE[d.kind], c = KIND_COLOR[d.kind];
          return (
            <button key={d.kind} type="button" className="mv-legend__item" aria-pressed={!off} onClick={() => toggle(d.kind)} style={{ opacity: off ? 0.45 : 1 }}>
              <svg width="34" height="14" aria-hidden><line x1="1" x2="33" y1="7" y2="7" stroke={c} strokeWidth="2.4" strokeDasharray={st.dash} /><Marker shape={st.marker} x={17} y={7} r={3.6} color={c} /></svg>
              <span>{MEASURE_KINDS[d.kind].label}{sides[d.kind] === "right" && two ? " (axe droit)" : two ? " (axe gauche)" : ""} <span className="mv-legend__unit">{MEASURE_KINDS[d.kind].unit}</span></span>
            </button>
          );
        })}
      </div>
      {allHidden ? <p className="mv-muted">Toutes les séries sont masquées : touchez une légende pour la montrer.</p> : (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="application" tabIndex={0} className="mv-svg"
          aria-label={`Graphique ${kinds.map((k) => MEASURE_KINDS[k].label).join(" et ")}. Flèches gauche et droite : mesure précédente ou suivante ; plus et moins : zoom.`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()} style={NO_SELECT}>
          <defs><clipPath id={`clip-${id}`}><rect x={PL} y={PT} width={plotW} height={H - PT - PB} /></clipPath></defs>
          {kinds.length === 1 && kinds[0] === "vocidx" && gridAxis && VOC_BANDS.map((b) => {
            const lo = Math.max(gridAxis.lo, b.from), hi = Math.min(gridAxis.hi, b.to);
            if (hi <= lo) return null;
            const y0 = PT + (1 - (hi - gridAxis.lo) / (gridAxis.hi - gridAxis.lo)) * (H - PT - PB), y1 = PT + (1 - (lo - gridAxis.lo) / (gridAxis.hi - gridAxis.lo)) * (H - PT - PB);
            return <rect key={b.label} x={PL} y={y0} width={plotW} height={y1 - y0} fill={b.color} opacity={0.1} />;
          })}
          {gridAxis && gridAxis.ticks.map((v) => { const yy = PT + (1 - (v - gridAxis.lo) / (gridAxis.hi - gridAxis.lo)) * (H - PT - PB); return <line key={v} x1={PL} x2={W - PR} y1={yy} y2={yy} stroke="var(--border)" opacity={0.45} />; })}
          {data.map((d, i) => {
            const a = axes[i];
            if (!a) return null;
            const right = sides[d.kind] === "right", c = KIND_COLOR[d.kind];
            return (
              <g key={d.kind} aria-hidden>
                {a.ticks.map((v) => <text key={v} x={right ? W - PR + 6 : PL - 6} y={PT + (1 - (v - a.lo) / (a.hi - a.lo)) * (H - PT - PB) + 3} fontSize="10" textAnchor={right ? "start" : "end"} fill={c}>{v}</text>)}
                <text x={right ? W - PR + 6 : PL - 6} y={PT - 3} fontSize="10" fontWeight="700" textAnchor={right ? "start" : "end"} fill={c}>{MEASURE_KINDS[d.kind].unit}</text>
              </g>
            );
          })}
          {ticks.map((t) => <g key={t.t} aria-hidden><line x1={x(t.t)} x2={x(t.t)} y1={PT} y2={H - PB} stroke="var(--border)" opacity={t.major ? 0.7 : 0.25} /><text x={x(t.t)} y={H - 7} fontSize="10" textAnchor="middle" fill={t.major ? "var(--text2)" : "var(--text3)"}>{t.label}</text></g>)}
          <g clipPath={`url(#clip-${id})`}>
            {focus !== null && <rect x={x(focus) - 9} y={PT} width={18} height={H - PT - PB} fill="#fbbf24" opacity={0.18} rx={4}><title>Instant signalé par la Lecture</title></rect>}
            {data.map((d, i) => {
              if (!axes[i]) return null;
              const c = KIND_COLOR[d.kind], st = KIND_STYLE[d.kind], nodes: React.ReactNode[] = [];
              if (repr === "band" || repr === "both") {
                for (const b of derived[i].bands) {
                  if (b.end < win.t0 || b.start > win.t1) continue;
                  nodes.push(<rect key={`b${b.start}`} x={x(b.start) + 1} width={Math.max(1, x(b.end) - x(b.start) - 2)} y={yOf(i, b.max)} height={Math.max(2, yOf(i, b.min) - yOf(i, b.max))} rx={3} fill={c} opacity={0.22}><title>{`${MEASURE_KINDS[d.kind].label}, min–max ${bucketName(bandSec)} : ${formatMeasure(d.kind, b.min)} à ${formatMeasure(d.kind, b.max)} (moyenne ${formatMeasure(d.kind, b.avg)}, ${b.n} mesure${b.n > 1 ? "s" : ""})`}</title></rect>);
                }
              }
              const line = (pts: Pt[], key: string, dash: string, w: number) => pts.length ? <path key={key} d={pts.map((p, k) => `${k ? "L" : "M"}${x(p.t).toFixed(1)},${yOf(i, p.v).toFixed(1)}`).join(" ")} fill="none" stroke={c} strokeWidth={w} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" /> : null;
              if (repr === "band") {
                const mids = derived[i].bands.filter((b) => b.end >= win.t0 && b.start <= win.t1).map((b) => ({ t: (b.start + b.end) / 2, v: b.avg }));
                nodes.push(line(mids, "avg", "", 2));
                mids.forEach((p) => nodes.push(<Marker key={`m${p.t}`} shape={st.marker} x={x(p.t)} y={yOf(i, p.v)} r={3} color={c} />));
              } else if (repr === "trend") {
                const tr = derived[i].trend.filter((p) => p.t >= win.t0 - trendSec && p.t <= win.t1 + trendSec);
                nodes.push(line(tr, "trend", st.dash || "9 5", 3));
              } else {
                d.segs.forEach((s, k) => nodes.push(line(decimate(visiblePoints(s, win), 700), `s${k}`, st.dash, 2)));
                const vis = visiblePoints(d.pts, win);
                if (vis.length <= 160 || vis.length === 1) vis.forEach((p) => nodes.push(<Marker key={`p${p.t}`} shape={st.marker} x={x(p.t)} y={yOf(i, p.v)} r={3} color={c} />));
              }
              return <g key={d.kind}>{nodes}</g>;
            })}
            {sel !== null && <line x1={x(sel)} x2={x(sel)} y1={PT} y2={H - PB} stroke="var(--text)" strokeDasharray="3 3" opacity={0.75} />}
            {sel !== null && data.map((d, i) => {
              if (!axes[i]) return null;
              const j = nearestPointIndex(d.times, sel);
              if (j < 0 || Math.abs(d.times[j] - sel) > Math.max(d.step * 1.5, 1800)) return null;
              return <Marker key={d.kind} shape={KIND_STYLE[d.kind].marker} x={x(d.times[j])} y={yOf(i, d.pts[j].v)} r={6} color={KIND_COLOR[d.kind]} stroke="var(--bg)" />;
            })}
          </g>
        </svg>
      )}
      {note && !allHidden && <figcaption className="mv-note">{note}.{data.some((_, i) => gap(i)) ? " Les trous restent des trous." : ""}</figcaption>}
    </figure>
  );
}
