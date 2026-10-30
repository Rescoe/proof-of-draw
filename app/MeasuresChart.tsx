"use client";
// app/MeasuresChart.tsx — courbe + résumé d'une grandeur mesurée (partagé : profil du propriétaire, vue réseau publique). Aucune requête ici : les données viennent du parent.

import { useMemo, useState } from "react";
import { MEASURE_KINDS, VOC_EXPLAIN, formatMeasure, summarize, vocLevel, vocTrend, type Measure, type MeasureKind } from "@/lib/measures";
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
          <circle cx={px(sel.t)} cy={py(sel.x)} r={5} fill={kind === "vocidx" ? vocLevel(sel.x).color : "var(--accent)"} stroke="var(--bg)" strokeWidth={1.5} />
        </>)}
      </svg>
      <p style={{ color: sel ? "var(--text2)" : "var(--text3)", fontSize: "0.78rem", margin: "2px 0 0", minHeight: "1.2em" }} aria-live="polite">
        {sel ? <><b>{fmtMeasureDate(sel.t)}</b> · {kind === "vocidx" ? <span style={{ color: vocLevel(sel.x).color, fontWeight: 600 }}>{formatMeasure(kind, sel.x)}</span> : formatMeasure(kind, sel.x)}</> : "Touche (ou survole) la courbe pour lire une valeur."}
      </p>
    </div>
  );
}

/** Qualité de l'air : niveau actuel (couleur) avec l'indice chiffré, tendance et bouton « ⓘ » qui explique l'indice Sensirion en une phrase. */
function AirNote({ points }: { points: { t: number; x: number }[] }) {
  const [open, setOpen] = useState(false);
  const last = points.length ? points[points.length - 1].x : null;
  const trend = vocTrend(points.map((p) => p.x));
  const lv = last !== null ? vocLevel(last) : null;
  return (
    <div style={{ fontSize: "0.78rem", color: "var(--text2)", marginBottom: 4 }}>
      {lv && last !== null && <span>Actuellement : <b style={{ color: lv.color }}>{lv.label} ({Math.round(last)})</b></span>}
      {trend && <span> · tendance : {trend === "up" ? "↗ en hausse" : trend === "down" ? "↘ en baisse" : "→ stable"}</span>}
      <button type="button" aria-expanded={open} aria-label="Comment lire cet indice ?" onClick={() => setOpen((v) => !v)}
        style={{ marginLeft: 8, width: 22, height: 22, borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", fontSize: "0.75rem", lineHeight: 1 }}>ⓘ</button>
      {open && <p style={{ margin: "4px 0 0", color: "var(--text3)" }}>{VOC_EXPLAIN}</p>}
    </div>
  );
}

/** Lignes du tableau : une station envoie un relevé toutes les 5 min (jusqu'à 4 032 entrées) — on n'affiche que les plus récentes. */
const TABLE_MAX_ROWS = 288;

/** `measures` : du plus récent au plus ancien. `showTable` : tableau horaire (profil). */
export function MeasuresChart({ measures, kinds, showTable = false, tableOnly = false }: { measures: Measure[]; kinds: MeasureKind[]; showTable?: boolean; tableOnly?: boolean }) {
  const [kind, setKind] = useState<MeasureKind>(kinds[0] ?? "temp");
  const own = useMemo(() => measures.filter((m) => m.v[kind] !== undefined), [measures, kind]);
  const sum = useMemo(() => summarize(measures, kind), [measures, kind]);
  const points = useMemo(() => [...own].sort((a, b) => a.t - b.t).map((m) => ({ t: m.t, x: m.v[kind] as number })), [own, kind]);
  const info = MEASURE_KINDS[kind];
  if (tableOnly) return <MeasuresTable measures={measures} kinds={kinds} />;
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
      {kind === "vocidx" && <AirNote points={points} />}
      <Chart points={points} kind={kind} />
      {showTable && <MeasuresTable measures={measures} kinds={kinds} />}
    </div>
  );
}

/** Relevés bruts (les plus récents) : tableau à partir de 600 px ; UNE carte par relevé en dessous (jamais de tableau coupé sur téléphone). */
export function MeasuresTable({ measures, kinds }: { measures: Measure[]; kinds: MeasureKind[] }) {
  const rows = measures.filter((m) => kinds.some((k) => m.v[k] !== undefined)).slice(0, TABLE_MAX_ROWS);
  return (
    <div className="mtable">
      <table>
        <thead><tr><th>Heure</th>{kinds.map((k) => <th key={k}>{MEASURE_KINDS[k].label}</th>)}</tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.t}>
              <td data-label="Heure">{fmtMeasureDate(m.t)}</td>
              {kinds.map((k) => <td key={k} data-label={MEASURE_KINDS[k].label}>{m.v[k] !== undefined ? formatMeasure(k, m.v[k] as number) : "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`
        .mtable { overflow-x: auto; margin-top: 8px; }
        .mtable table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        .mtable th { text-align: left; color: var(--text3); font-weight: 600; }
        .mtable td { padding: 3px 0; border-top: 1px solid var(--border); }
        @media (max-width: 600px) {
          .mtable thead { display: none; }
          .mtable tbody, .mtable tr, .mtable td { display: block; }
          .mtable tr { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; }
          .mtable td { border-top: 0; padding: 2px 0; display: flex; justify-content: space-between; gap: 12px; }
          .mtable td::before { content: attr(data-label); color: var(--text3); }
        }
      `}</style>
    </div>
  );
}
