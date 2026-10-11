"use client";
// app/MeasuresChart.tsx — courbe + résumé d'une grandeur mesurée (partagé : profil du propriétaire, vue réseau publique). Aucune requête ici : les données viennent du parent.

import { useMemo, useState } from "react";
import { MEASURE_KINDS, formatMeasure, summarize, type Measure, type MeasureKind } from "@/lib/measures";

export const fmtMeasureDate = (t: number) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Chart({ points, kind }: { points: { t: number; x: number }[]; kind: MeasureKind }) {
  if (points.length < 2) return <p style={{ color: "var(--text3)", fontSize: "0.8rem", margin: "0.4rem 0" }}>Au moins deux mesures sont nécessaires pour tracer la courbe.</p>;
  const W = 640, H = 170, P = 28;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const xs = points.map((p) => p.x), lo = Math.floor(Math.min(...xs) / 10) * 10 - 10, hi = Math.ceil(Math.max(...xs) / 10) * 10 + 10;
  const px = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const py = (x: number) => H - P - ((x - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${px(p.t).toFixed(1)},${py(p.x).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Courbe : ${MEASURE_KINDS[kind].label}`} style={{ width: "100%", height: "auto", maxHeight: 200 }}>
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--border)" />
      <line x1={P} y1={P} x2={P} y2={H - P} stroke="var(--border)" />
      <text x={4} y={P + 4} fontSize="10" fill="var(--text3)">{(hi / 10).toFixed(0)}</text>
      <text x={4} y={H - P} fontSize="10" fill="var(--text3)">{(lo / 10).toFixed(0)}</text>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

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
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--text3)" }}><th>Heure</th>{kinds.map((k) => <th key={k}>{MEASURE_KINDS[k].label}</th>)}</tr></thead>
          <tbody>
            {measures.map((m) => (
              <tr key={m.t} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "3px 0" }}>{fmtMeasureDate(m.t)}</td>
                {kinds.map((k) => <td key={k}>{m.v[k] !== undefined ? formatMeasure(k, m.v[k] as number) : "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
