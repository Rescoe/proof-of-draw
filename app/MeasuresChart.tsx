"use client";
// app/MeasuresChart.tsx — courbe + résumé d'une grandeur mesurée (partagé : profil du propriétaire, vue réseau publique). Aucune requête ici : les données viennent du parent.

import { useMemo, useState } from "react";
import { MEASURE_KINDS, formatMeasure, summarize, type Measure, type MeasureKind } from "@/lib/measures";
import { nearestPointIndex, timeAxisTicks } from "@/lib/timeAxis";

export const fmtMeasureDate = (t: number) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Aucune sélection de texte ni menu contextuel sur le tracé : sur téléphone, un appui prolongé sur la courbe ouvrait le sélecteur de texte au lieu d'afficher la valeur. */
export const NO_SELECT: React.CSSProperties = { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" };

function Chart({ points, kind }: { points: { t: number; x: number }[]; kind: MeasureKind }) {
  const [hover, setHover] = useState<number | null>(null);
  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);
  if (points.length < 2) return <p style={{ color: "var(--text3)", fontSize: "0.8rem", margin: "0.4rem 0" }}>Au moins deux mesures sont nécessaires pour tracer la courbe.</p>;
  const W = 640, H = 170, P = 28;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const sc = MEASURE_KINDS[kind].scale, step = sc === 10 ? 10 : Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, Math.max(...points.map((p) => Math.abs(p.x))) / 4)))));
  const xs = points.map((p) => p.x), lo = Math.floor(Math.min(...xs) / step) * step - step, hi = Math.ceil(Math.max(...xs) / step) * step + step;
  const px = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const py = (x: number) => H - P - ((x - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${px(p.t).toFixed(1)},${py(p.x).toFixed(1)}`).join(" ");
  const ticks = timeAxisTicks(t0, t1, tz);
  const at = (e: React.PointerEvent<SVGSVGElement>) => {                                   // un simple appui (ou un glissement) place le curseur : rien à maintenir enfoncé
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    setHover(nearestPointIndex(points.map((p) => p.t), t0 + ((vx - P) / (W - 2 * P)) * (t1 - t0)));
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1)); e.preventDefault(); }
    if (e.key === "ArrowLeft") { setHover((h) => Math.max(0, (h ?? points.length) - 1)); e.preventDefault(); }
    if (e.key === "Escape") setHover(null);
  };
  const sel = hover !== null ? points[hover] : null;
  return (
    <div style={NO_SELECT}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label={`Courbe : ${MEASURE_KINDS[kind].label}`} style={{ width: "100%", height: "auto", maxHeight: 200, touchAction: "pan-y", outline: "none", ...NO_SELECT }}
        onPointerDown={at} onPointerMove={at} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }} onContextMenu={(e) => e.preventDefault()} onKeyDown={key}>
        {ticks.map((k) => { const x = px(k.t); return (
          <g key={k.t}>
            <line x1={x} y1={P} x2={x} y2={H - P} stroke="var(--border)" opacity={k.major ? 0.8 : 0.4} />
            <text x={x} y={H - P + 13} fontSize="10" textAnchor="middle" fill={k.major ? "var(--text2)" : "var(--text3)"} fontWeight={k.major ? 600 : 400}>{k.label}</text>
          </g>); })}
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--border)" />
        <line x1={P} y1={P} x2={P} y2={H - P} stroke="var(--border)" />
        <text x={4} y={P + 4} fontSize="10" fill="var(--text3)">{(hi / sc).toFixed(0)}</text>
        <text x={4} y={H - P} fontSize="10" fill="var(--text3)">{(lo / sc).toFixed(0)}</text>
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {sel && (<>
          <line x1={px(sel.t)} x2={px(sel.t)} y1={P} y2={H - P} stroke="var(--text3)" strokeDasharray="3 3" />
          <circle cx={px(sel.t)} cy={py(sel.x)} r={5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={1.5} />
        </>)}
      </svg>
      <p style={{ color: sel ? "var(--text2)" : "var(--text3)", fontSize: "0.78rem", margin: "2px 0 0", minHeight: "1.2em" }} aria-live="polite">
        {sel ? <><b>{fmtMeasureDate(sel.t)}</b> · {formatMeasure(kind, sel.x)}</> : "Touche (ou survole) la courbe pour lire une valeur."}
      </p>
    </div>
  );
}

/** Lignes du tableau : une station envoie un relevé toutes les 5 min (jusqu'à 4 032 entrées) — on n'affiche que les plus récentes. */
const TABLE_MAX_ROWS = 288;

/** `measures` : du plus récent au plus ancien. `showTable` : tableau horaire (profil). */
export function MeasuresChart({ measures, kinds, showTable = false }: { measures: Measure[]; kinds: MeasureKind[]; showTable?: boolean }) {
  const [kind, setKind] = useState<MeasureKind>(kinds[0] ?? "temp");
  const own = useMemo(() => measures.filter((m) => m.v[kind] !== undefined), [measures, kind]);
  const sum = useMemo(() => summarize(measures, kind), [measures, kind]);
  const points = useMemo(() => [...own].sort((a, b) => a.t - b.t).map((m) => ({ t: m.t, x: m.v[kind] as number })), [own, kind]);
  const info = MEASURE_KINDS[kind];
  return (
    <div>
      {kinds.length > 1 && (
        <div role="group" aria-label="Grandeur" style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              style={{ padding: "0.2rem 0.65rem", borderRadius: 999, fontSize: "0.74rem", cursor: "pointer", border: `1px solid ${kind === k ? "var(--accent)" : "var(--border)"}`, background: "var(--bg)", color: kind === k ? "var(--accent)" : "var(--text2)" }}>
              {MEASURE_KINDS[k].icon} {MEASURE_KINDS[k].label}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: "0.78rem", color: "var(--text2)", marginBottom: 4 }}>
        {info.label} : min {sum.min !== null ? formatMeasure(kind, sum.min) : "—"} · max {sum.max !== null ? formatMeasure(kind, sum.max) : "—"} · moyenne {sum.avg !== null ? formatMeasure(kind, sum.avg) : "—"} · {sum.count} mesure{sum.count > 1 ? "s" : ""}
      </div>
      <Chart points={points} kind={kind} />
      {showTable && (
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--text3)" }}><th>Heure</th>{kinds.map((k) => <th key={k}>{MEASURE_KINDS[k].label}</th>)}</tr></thead>
          <tbody>
            {measures.filter((m) => kinds.some((k) => m.v[k] !== undefined)).slice(0, TABLE_MAX_ROWS).map((m) => (
              <tr key={m.t} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "3px 0" }}>{fmtMeasureDate(m.t)}</td>
                {kinds.map((k) => <td key={k}>{m.v[k] !== undefined ? formatMeasure(k, m.v[k] as number) : "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
