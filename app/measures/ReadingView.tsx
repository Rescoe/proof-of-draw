"use client";
// app/measures/ReadingView.tsx — « LECTURE » (ancienne « Interprétation », refonte du 02/11/2026). Deux aides à la lecture, toutes deux calculées par règles fixes sur les mesures réelles (aucune IA) :
//  1. des constats en phrases, chacun relié à son instant : un toucher ouvre la courbe sur ce moment ;
//  2. la grille « jours × heures » : une ligne par jour, une colonne par heure, la couleur dit la valeur → on voit le rythme d'une journée et ses variations d'un jour à l'autre.
// Logique pure : lib/measureReading.ts (testée).
import { useMemo, useState } from "react";
import { MEASURE_KINDS, formatMeasure, vocLevel, type Measure, type MeasureKind } from "@/lib/measures";
import { artTempColor } from "@/lib/measureArt";
import { cellText, findings, heatmap, hourProfile } from "@/lib/measureReading";
import { seriesOf } from "@/lib/chartView";
import { KIND_COLOR } from "./palette";

const GRID_KINDS: MeasureKind[] = ["temp", "hum", "vocidx"];

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
  const profile = useMemo(() => hourProfile(seriesOf(measures, "temp"), tz), [measures, tz]);

  if (measures.length < 3) return <p className="mv-muted">Il faut au moins trois mesures sur la période pour proposer une lecture.</p>;
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

  const GROUPS: { title: string; ids: string[] }[] = [
    { title: "À retenir", ids: ["temp-max", "temp-min", "hum-max", "air-max"] },
    { title: "Variations", ids: ["temp-jump", "rhythm"] },
    { title: "Données manquantes", ids: ["gap"] },
  ];
  const pMax = Math.max(...profile.map((v) => v ?? -Infinity)), pMin = Math.min(...profile.map((v) => v ?? Infinity));
  return (
    <div className="mv-stack">
      <section aria-label="Constats" className="mv-stack">
        {GROUPS.map((g) => {
          const items = list.filter((f) => g.ids.includes(f.id));
          return items.length === 0 ? null : (
            <div key={g.title}>
              <h4 className="mv-h">{g.title}</h4>
              <ul className="mv-findings">
                {items.map((f) => (
                  <li key={f.id} className="mv-finding" style={{ borderLeftColor: f.kind ? KIND_COLOR[f.kind] : "var(--border)" }}>
                    <span>{f.text}</span>
                    {f.t !== null && <button type="button" className="mv-btn" onClick={() => onJump(f.t as number, f.kind)}>Voir dans les données</button>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {list.length === 0 && <p className="mv-muted">Pas encore assez de variété dans les mesures pour en tirer un constat.</p>}
        <p className="mv-note">Phrases calculées par des règles fixes à partir des mesures reçues ; ce n’est pas une intelligence artificielle.</p>
      </section>

      {Number.isFinite(pMax) && days >= 7 && (
        <section aria-label="Jour type">
          <h4 className="mv-h">Jour type (température moyenne par heure)</h4>
          <svg viewBox="0 0 240 56" className="mv-svg" role="img" aria-label="Température moyenne par heure du jour">
            {profile.map((v, h) => v === null ? <rect key={h} x={h * 10 + 1} y={52} width={8} height={2} fill="var(--border)" /> : <rect key={h} x={h * 10 + 1} y={4 + 44 * (1 - (pMax === pMin ? 0.5 : (v - pMin) / (pMax - pMin)))} width={8} height={Math.max(2, 48 - (4 + 44 * (1 - (pMax === pMin ? 0.5 : (v - pMin) / (pMax - pMin)))))} rx={2} fill={artTempColor(v, "night")}><title>{`${h} h : ${formatMeasure("temp", Math.round(v))}`}</title></rect>)}
            {[0, 6, 12, 18].map((h) => <text key={h} x={h * 10 + 5} y={55} fontSize="7" textAnchor="middle" fill="var(--text3)">{h} h</text>)}
          </svg>
          <p className="mv-note">Moyenne de toutes les mesures de la période, heure par heure : le « jour habituel » du capteur.</p>
        </section>
      )}

      {grid && k && info && (
        <section aria-label="Rythme d'une journée" className="mv-stack">
          <div className="mv-row">
            <h4 className="mv-h" style={{ margin: 0 }}>Jours × heures</h4>
            {kinds.length > 1 && (
              <div className="mv-seg mv-seg--wrap" role="group" aria-label="Grandeur de la grille">
                {kinds.map((x) => <button key={x} type="button" className="mv-seg__btn" aria-pressed={x === k} onClick={() => setKind(x)}>{MEASURE_KINDS[x].icon} {MEASURE_KINDS[x].label}</button>)}
              </div>
            )}
          </div>
          <div className="mv-gridwrap" tabIndex={0} role="grid" aria-label={`Grille jours par heures : ${info.label}`} onKeyDown={key}>
            <div className="mv-grid">
              <span className="mv-grid__corner" />
              {Array.from({ length: 24 }, (_, h) => <span key={h} className="mv-grid__hour">{h % 3 === 0 ? `${h}` : ""}</span>)}
              {grid.rows.map((row, r) => (
                <div key={row.dayStart} role="row" style={{ display: "contents" }}>
                  <span className="mv-grid__day">{row.label}</span>
                  {row.cells.map((c, h) => (
                    <span key={h} role="gridcell" aria-label={cellText(k, row, h)} onPointerDown={() => setCur({ r, h })}
                      className="mv-grid__cell" data-empty={c.value === null ? "1" : undefined} data-cur={cur && cur.r === r && cur.h === h ? "1" : undefined}
                      style={{ background: c.value === null ? "transparent" : cellColor(k, c.value, grid.lo as number, grid.hi as number) }} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mv-readout" aria-live="polite">{cur && grid.rows[cur.r] ? cellText(k, grid.rows[cur.r], cur.h) : "Touchez une case pour lire sa valeur (heures en haut, jours à gauche)."}</div>
          <details className="mv-legend-box"><summary>Légende</summary><p className="mv-note">
            Une ligne par jour, une colonne par heure (heure locale) ; la couleur de la case est la moyenne des mesures de cette heure
            {k === "temp" ? ` (du froid, ardoise, au chaud, terre cuite : ${formatMeasure("temp", Math.round(grid.lo as number))} à ${formatMeasure("temp", Math.round(grid.hi as number))})` : k === "vocidx" ? " (couleur du niveau de l’air : vert = très faible, jaune = modéré, rouge = très élevé)" : ` (plus c’est soutenu, plus l’air est humide : ${formatMeasure("hum", Math.round(grid.lo as number))} à ${formatMeasure("hum", Math.round(grid.hi as number))})`}.
            Case vide en pointillé = aucune mesure à cette heure.</p></details>
        </section>
      )}
    </div>
  );
}
