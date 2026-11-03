"use client";
// app/measures/ReadingView.tsx — « LECTURE » (ancienne « Interprétation », refonte du 02/11/2026). Deux aides à la lecture, toutes deux calculées par règles fixes sur les mesures réelles (aucune IA) :
//  1. des constats en phrases, chacun relié à son instant : un toucher ouvre la courbe sur ce moment ;
//  2. la grille « jours × heures » : une ligne par jour, une colonne par heure, la couleur dit la valeur → on voit le rythme d'une journée et ses variations d'un jour à l'autre.
// Logique pure : lib/measureReading.ts (testée).
import { useMemo, useState } from "react";
import { MEASURE_KINDS, formatMeasure, vocLevel, type Measure, type MeasureKind } from "@/lib/measures";
import { artTempColor } from "@/lib/measureArt";
import { cellText, findings, heatmap } from "@/lib/measureReading";
import { KIND_COLOR } from "./palette";

const GRID_KINDS: MeasureKind[] = ["temp", "hum", "vocidx"];
const pill = (on: boolean, c?: string): React.CSSProperties => ({ padding: "0.25rem 0.7rem", borderRadius: 999, fontSize: "0.76rem", cursor: "pointer", minHeight: 32, border: `1px solid ${on ? (c ?? "var(--accent)") : "var(--border)"}`, background: on ? "rgba(124,107,255,0.14)" : "transparent", color: on ? (c ?? "var(--accent)") : "var(--text2)" });

/** Couleur d'une case : température = palette chaud/froid ; air = couleur du niveau ; humidité = bleu ardoise d'autant plus soutenu que l'air est humide. */
function cellColor(kind: MeasureKind, value: number, lo: number, hi: number): string {
  if (kind === "temp") return artTempColor(value, "night");
  if (kind === "vocidx") return vocLevel(value).color;
  const f = hi === lo ? 0.6 : 0.18 + 0.82 * ((value - lo) / (hi - lo));
  return `color-mix(in srgb, ${KIND_COLOR.hum} ${Math.round(f * 100)}%, transparent)`;
}

export function ReadingView({ measures, tz, days, onJump }: { measures: Measure[]; tz: number; days: number; onJump: (t: number, kind: MeasureKind | null) => void }) {
  const kinds = useMemo(() => GRID_KINDS.filter((k) => measures.some((m) => m.v[k] !== undefined)), [measures]);
  const [kind, setKind] = useState<MeasureKind | null>(null);
  const [cur, setCur] = useState<{ r: number; h: number } | null>(null);
  const k = kind && kinds.includes(kind) ? kind : kinds[0] ?? null;
  const list = useMemo(() => findings(measures, tz), [measures, tz]);
  const endSec = useMemo(() => measures.reduce((a, m) => Math.max(a, m.t), 0) + 1, [measures]);
  const grid = useMemo(() => (k ? heatmap(measures, k, endSec, days, tz) : null), [measures, k, endSec, days, tz]);

  if (measures.length < 3) return <p style={{ color: "var(--text3)", fontSize: "0.82rem", margin: 0 }}>Il faut au moins trois mesures sur la période pour proposer une lecture.</p>;
  const info = k ? MEASURE_KINDS[k] : null;
  const key = (e: React.KeyboardEvent) => {
    if (!grid) return;
    const c = cur ?? { r: grid.rows.length - 1, h: 12 };
    const n = { r: c.r, h: c.h };
    if (e.key === "ArrowRight") n.h = Math.min(23, c.h + 1); else if (e.key === "ArrowLeft") n.h = Math.max(0, c.h - 1);
    else if (e.key === "ArrowDown") n.r = Math.min(grid.rows.length - 1, c.r + 1); else if (e.key === "ArrowUp") n.r = Math.max(0, c.r - 1);
    else return;
    e.preventDefault(); setCur(n);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <section aria-label="Constats">
        <h4 style={{ margin: "0 0 6px", fontSize: "0.86rem" }}>Ce que disent les mesures</h4>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
          {list.map((f) => (
            <li key={f.id}>
              {f.t !== null ? (
                <button type="button" onClick={() => onJump(f.t as number, f.kind)} style={{ all: "unset", cursor: "pointer", fontSize: "0.84rem", lineHeight: 1.5, color: "var(--text)", padding: "4px 0", minHeight: 32, display: "block", boxSizing: "border-box" }}>
                  <span style={{ color: f.kind ? KIND_COLOR[f.kind] : "var(--text3)" }}>●</span> {f.text} <span style={{ color: "var(--accent)", fontSize: "0.74rem", whiteSpace: "nowrap" }}>voir sur la courbe →</span>
                </button>
              ) : <span style={{ fontSize: "0.84rem", lineHeight: 1.5, display: "block", padding: "4px 0" }}><span style={{ color: f.kind ? KIND_COLOR[f.kind] : "var(--text3)" }}>●</span> {f.text}</span>}
            </li>
          ))}
          {list.length === 0 && <li style={{ color: "var(--text3)", fontSize: "0.82rem" }}>Pas encore assez de variété dans les mesures pour en tirer un constat.</li>}
        </ul>
        <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "var(--text3)" }}>Phrases calculées par des règles fixes à partir des mesures reçues ; ce n’est pas une intelligence artificielle.</p>
      </section>

      {grid && k && info && (
        <section aria-label="Rythme d'une journée">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
            <h4 style={{ margin: 0, fontSize: "0.86rem" }}>Jours × heures</h4>
            {kinds.length > 1 && (
              <div role="group" aria-label="Grandeur de la grille" style={{ display: "flex", gap: 6 }}>
                {kinds.map((x) => <button key={x} type="button" style={pill(x === k, KIND_COLOR[x])} aria-pressed={x === k} onClick={() => setKind(x)}>{MEASURE_KINDS[x].icon} {MEASURE_KINDS[x].label}</button>)}
              </div>
            )}
          </div>
          <div tabIndex={0} role="grid" aria-label={`Grille jours par heures : ${info.label}`} onKeyDown={key} style={{ outline: "none" }}>
            <div style={{ display: "grid", gridTemplateColumns: "58px repeat(24, minmax(0, 1fr))", gap: 2, alignItems: "center" }}>
              <span />
              {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ fontSize: "0.62rem", color: "var(--text3)", textAlign: "center" }}>{h % 6 === 0 ? `${h} h` : ""}</span>)}
              {grid.rows.map((row, r) => (
                <div key={row.dayStart} role="row" style={{ display: "contents" }}>
                  <span style={{ fontSize: "0.66rem", color: "var(--text3)", whiteSpace: "nowrap" }}>{row.label}</span>
                  {row.cells.map((c, h) => (
                    <span key={h} role="gridcell" aria-label={cellText(k, row, h)} onPointerDown={() => setCur({ r, h })} onPointerEnter={(e) => { if (e.pointerType === "mouse") setCur({ r, h }); }}
                      style={{ height: days > 10 ? 12 : 20, borderRadius: 3, cursor: "pointer", background: c.value === null ? "transparent" : cellColor(k, c.value, grid.lo as number, grid.hi as number), border: c.value === null ? "1px dashed var(--border)" : "none", outline: cur && cur.r === r && cur.h === h ? "2px solid var(--text)" : "none", outlineOffset: 1 }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ minHeight: 22, margin: "6px 0 2px", fontSize: "0.82rem", color: "var(--text2)" }} aria-live="polite">{cur && grid.rows[cur.r] ? cellText(k, grid.rows[cur.r], cur.h) : "Touchez une case pour lire sa valeur."}</div>
          <p style={{ margin: 0, fontSize: "0.74rem", color: "var(--text3)", lineHeight: 1.5 }}>
            Une ligne par jour, une colonne par heure (heure locale) ; la couleur de la case est la moyenne des mesures de cette heure
            {k === "temp" ? ` (du froid, ardoise, au chaud, terre cuite : ${formatMeasure("temp", Math.round(grid.lo as number))} à ${formatMeasure("temp", Math.round(grid.hi as number))})` : k === "vocidx" ? " (couleur du niveau de l’air : vert = très faible, jaune = modéré, rouge = très élevé)" : ` (plus c’est soutenu, plus l’air est humide : ${formatMeasure("hum", Math.round(grid.lo as number))} à ${formatMeasure("hum", Math.round(grid.hi as number))})`}.
            Case vide en pointillé = aucune mesure à cette heure. Des colonnes de même couleur d’un jour à l’autre montrent un rythme régulier.
          </p>
        </section>
      )}
    </div>
  );
}
