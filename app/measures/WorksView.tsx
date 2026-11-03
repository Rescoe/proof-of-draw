"use client";
// app/measures/WorksView.tsx — « ŒUVRES » (03/11/2026) : trois lectures artistiques des MÊMES mesures, composition stable pour 24 h / 7 jours / 30 jours.
//   Chronique : un glyphe par heure (24 h) ou par jour (7 j, 30 j) — couleur = température, anneau = humidité, halo = amplitude de température (issue de l'ancienne œuvre) ;
//   Trajectoire : température (horizontal) × humidité (vertical), reliées dans l'ordre du temps ;
//   Empreinte : rosace — une couronne par jour, vingt-quatre secteurs (les heures), couleur = température.
// La vue en bulles de la refonte du 02/11 reste disponible dans le volet « Laboratoire ». Rien n'est tiré au sort : formes pures (lib/measureViz.ts, lib/measureWorks.ts, lib/measureReading.ts).
import { useMemo, useState } from "react";
import { formatMeasure, type Measure } from "@/lib/measures";
import { VIZ_RANGES, aggregate, bucketLabel, diskGrid, diskSpec, type Bucket, type VizRange } from "@/lib/measureViz";
import { ART_SURFACE, artTempColor, type ArtScheme } from "@/lib/measureArt";
import { arcPath, trajectoryOf } from "@/lib/measureWorks";
import { cellText, exactLabel, heatmap } from "@/lib/measureReading";
import { ArtworkView } from "./ArtworkView";

type Work = "chronicle" | "trajectory" | "print";
const WORKS: { id: Work; label: string; how: string }[] = [
  { id: "chronicle", label: "Chronique", how: "Un disque par période : sa couleur dit la température, son anneau l'humidité." },
  { id: "trajectory", label: "Trajectoire", how: "Chaque point est une mesure : à droite plus chaud, en haut plus humide. Le trait suit le temps." },
  { id: "print", label: "Empreinte", how: "Chaque couronne est un jour (le plus récent à l'extérieur), chaque secteur une heure, de minuit en haut." },
];
const SCHEME_KEY = "pod.measuresArtScheme";

function Legend({ children }: { children: React.ReactNode }) {
  return <details className="mv-legend-box"><summary>Légende</summary><div className="mv-note">{children}</div></details>;
}

function Chronicle({ buckets, range, tz, scheme }: { buckets: Bucket[]; range: VizRange; tz: number; scheme: ArtScheme }) {
  const [sel, setSel] = useState<number | null>(null);
  const S = ART_SURFACE[scheme], { cols, rows } = diskGrid(range), C = 100, R = 42;
  const b = sel === null ? null : buckets[sel];
  return (
    <div>
      <svg viewBox={`0 0 ${cols * C} ${rows * C}`} role="img" aria-label="Chronique : un disque par période" className="mv-art" style={{ background: S.bg }}>
        {buckets.map((bk, i) => {
          const s = diskSpec(bk), cx = (i % cols) * C + C / 2, cy = Math.floor(i / cols) * C + C / 2, col = artTempColor(bk.temp?.avg ?? null, scheme);
          return (
            <g key={i} onPointerDown={() => setSel(i)} style={{ cursor: "pointer" }}>
              {s.empty ? <circle cx={cx} cy={cy} r={R * 0.8} fill="none" stroke={S.empty} strokeDasharray="3 5" /> : (
                <>
                  {s.halo > 0 && <circle cx={cx} cy={cy} r={R} fill="none" stroke={col} strokeWidth={2 + s.halo * 8} opacity={0.3} />}
                  <circle cx={cx} cy={cy} r={R * (1 - s.ring / 2)} fill="none" stroke={col} strokeWidth={R * s.ring} opacity={0.3} />
                  <circle cx={cx} cy={cy} r={R * s.inner * 0.98} fill={col} />
                  {s.drops.map((d, k) => <circle key={k} cx={cx + Math.cos(d.angle) * R * d.dist} cy={cy + Math.sin(d.angle) * R * d.dist} r={d.r * R * 2} fill={S.bg} opacity={0.7} />)}
                </>
              )}
              {sel === i && <circle cx={cx} cy={cy} r={R + 4} fill="none" stroke={S.ink} strokeWidth={1.5} />}
              <circle cx={cx} cy={cy} r={R + 4} fill="transparent" />
            </g>
          );
        })}
      </svg>
      <p className="mv-readout" aria-live="polite">
        {b ? (b.n === 0 ? <><b>{bucketLabel(b, range, tz)}</b> : aucune mesure.</> : <><b>{bucketLabel(b, range, tz)}</b>{b.temp && <> · {formatMeasure("temp", b.temp.avg)}{b.temp.n > 1 ? ` (de ${formatMeasure("temp", b.temp.min)} à ${formatMeasure("temp", b.temp.max)})` : ""}</>}{b.hum && <> · {formatMeasure("hum", b.hum.avg)}</>} · {b.n} mesure{b.n > 1 ? "s" : ""}</>) : "Touchez un disque pour lire la période."}
      </p>
      <Legend>
        Un disque par {VIZ_RANGES[range].unit} ({buckets.length}). Couleur = température moyenne (0 à 34 °C, du froid au chaud). Anneau épais et nombre de gouttes = humidité moyenne. Halo = écart entre le minimum et le maximum de température sur la période. Pointillé = aucune mesure.
      </Legend>
    </div>
  );
}

function Trajectory({ measures, tz, scheme }: { measures: Measure[]; tz: number; scheme: ArtScheme }) {
  const tr = useMemo(() => trajectoryOf(measures), [measures]);
  const [sel, setSel] = useState<number | null>(null);
  const S = ART_SURFACE[scheme];
  if (!tr.tempAxis || !tr.humAxis) return <p className="mv-muted">Il faut des mesures qui portent à la fois la température et l’humidité (et publiques toutes les deux).</p>;
  const W = 640, H = 400, L = 46, Rr = 14, T = 16, B = 34, ta = tr.tempAxis, ha = tr.humAxis;
  const x = (t: number) => L + ((t / 10 - ta.lo) / (ta.hi - ta.lo)) * (W - L - Rr), y = (h: number) => T + (1 - (h / 10 - ha.lo) / (ha.hi - ha.lo)) * (H - T - B);
  const pts = tr.points, segs: typeof pts[] = [];
  let cur: typeof pts = [];
  pts.forEach((p, i) => { if (tr.breaks.includes(i) && cur.length) { segs.push(cur); cur = []; } cur.push(p); });
  if (cur.length) segs.push(cur);
  const p = sel === null ? null : pts[sel];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trajectoire température et humidité" className="mv-art" style={{ background: S.bg }}>
        {ta.ticks.map((v) => <g key={`t${v}`}><line x1={x(v * 10)} x2={x(v * 10)} y1={T} y2={H - B} stroke={S.empty} opacity={0.5} /><text x={x(v * 10)} y={H - B + 14} fontSize="10" textAnchor="middle" fill={S.muted}>{v}</text></g>)}
        {ha.ticks.map((v) => <g key={`h${v}`}><line x1={L} x2={W - Rr} y1={y(v * 10)} y2={y(v * 10)} stroke={S.empty} opacity={0.5} /><text x={L - 6} y={y(v * 10) + 3} fontSize="10" textAnchor="end" fill={S.muted}>{v}</text></g>)}
        <text x={W - Rr} y={H - 6} fontSize="11" textAnchor="end" fill={S.muted}>Température (°C) — plus chaud →</text>
        <text x={L + 4} y={12} fontSize="11" fill={S.muted}>↑ Humidité (%)</text>
        {segs.map((s, i) => <path key={i} d={s.map((q, k) => `${k ? "L" : "M"}${x(q.temp).toFixed(1)},${y(q.hum).toFixed(1)}`).join(" ")} fill="none" stroke={S.muted} strokeOpacity={0.45} strokeWidth={1.2} />)}
        {pts.map((q, i) => <g key={q.t} onPointerDown={() => setSel(i)} style={{ cursor: "pointer" }}><circle cx={x(q.temp)} cy={y(q.hum)} r={sel === i ? 7 : 4 + q.age * 2} fill={artTempColor(q.temp, scheme)} fillOpacity={0.35 + 0.65 * q.age} stroke={sel === i ? S.ink : "none"} strokeWidth={1.5} /><circle cx={x(q.temp)} cy={y(q.hum)} r={13} fill="transparent" /></g>)}
        <text x={x(pts[0].temp) + 8} y={y(pts[0].hum) - 8} fontSize="11" fill={S.ink}>début</text>
        <text x={x(pts[pts.length - 1].temp) + 8} y={y(pts[pts.length - 1].hum) - 8} fontSize="11" fill={S.ink}>fin</text>
      </svg>
      <p className="mv-readout" aria-live="polite">{p ? <><b>{exactLabel(p.t, tz)}</b> · {formatMeasure("temp", p.temp)} · {formatMeasure("hum", p.hum)}</> : "Touchez un point pour lire la mesure."}</p>
      <Legend>Un point par mesure qui porte température et humidité ; plus il est opaque et grand, plus il est récent. Le trait relie les mesures dans l’ordre du temps et se coupe là où il manque des mesures. Ni lissage ni interpolation.</Legend>
    </div>
  );
}

function Print({ measures, days, tz, scheme }: { measures: Measure[]; days: number; tz: number; scheme: ArtScheme }) {
  const endSec = useMemo(() => measures.reduce((a, m) => Math.max(a, m.t), 0) + 1, [measures]);
  const grid = useMemo(() => heatmap(measures, "temp", endSec, days, tz), [measures, endSec, days, tz]);
  const [cur, setCur] = useState<{ r: number; h: number } | null>(null);
  const S = ART_SURFACE[scheme];
  if (grid.lo === null) return <p className="mv-muted">Aucune température sur cette période : l’empreinte reste vide.</p>;
  const size = 360, c = size / 2, inner = 34, outer = c - 8, ring = (outer - inner) / grid.rows.length;
  return (
    <div>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Empreinte : une couronne par jour, un secteur par heure" className="mv-art mv-art--square" style={{ background: S.bg }}>
        {grid.rows.map((row, r) => row.cells.map((cell, h) => {
          const r0 = inner + r * ring, a0 = (h / 24) * Math.PI * 2, a1 = ((h + 1) / 24) * Math.PI * 2 - 0.012;
          return <path key={`${r}-${h}`} d={arcPath(c, c, r0, r0 + ring - 0.8, a0, a1)} fill={cell.value === null ? "none" : artTempColor(cell.value, scheme)} stroke={cell.value === null ? S.empty : cur && cur.r === r && cur.h === h ? S.ink : "none"} strokeWidth={cell.value === null ? 0.5 : 1.6} strokeDasharray={cell.value === null ? "2 3" : ""} onPointerDown={() => setCur({ r, h })} style={{ cursor: "pointer" }} />;
        }))}
        {[0, 6, 12, 18].map((h) => { const a = (h / 24) * Math.PI * 2; return <text key={h} x={c + (outer + 4) * Math.sin(a)} y={c - (outer + 4) * Math.cos(a) + 3} fontSize="10" textAnchor="middle" fill={S.muted}>{h} h</text>; })}
      </svg>
      <p className="mv-readout" aria-live="polite">{cur ? cellText("temp", grid.rows[cur.r], cur.h) : "Touchez un secteur pour lire l’heure."}</p>
      <Legend>{grid.rows.length} couronne{grid.rows.length > 1 ? "s" : ""} (un jour chacune, le plus récent à l’extérieur), 24 secteurs (l’heure locale, minuit en haut, sens horaire). Couleur = température moyenne de l’heure, de {formatMeasure("temp", Math.round(grid.lo))} à {formatMeasure("temp", Math.round(grid.hi as number))} ; pas de couleur en pointillé = aucune mesure.</Legend>
    </div>
  );
}

export function WorksView({ measures, range, tz }: { measures: Measure[]; range: VizRange; tz: number }) {
  const [work, setWork] = useState<Work>("chronicle");
  const [scheme, setScheme] = useState<ArtScheme>(() => { try { const s = localStorage.getItem(SCHEME_KEY); if (s === "paper" || s === "night") return s; } catch { /* stockage indisponible */ } return "night"; });
  const pick = (s: ArtScheme) => { setScheme(s); try { localStorage.setItem(SCHEME_KEY, s); } catch { /* idem */ } };
  const endSec = useMemo(() => measures.reduce((a, m) => Math.max(a, m.t), 0) + 1, [measures]);
  const buckets = useMemo(() => aggregate(measures, range, endSec, tz), [measures, range, endSec, tz]);
  const days = range === "day" ? 2 : range === "week" ? 7 : 30;
  const info = WORKS.find((w) => w.id === work)!;
  if (measures.length === 0) return <p className="mv-muted">Aucune mesure sur cette période : il n’y a rien à représenter.</p>;
  return (
    <div className="mv-stack">
      <div className="mv-row">
        <div className="mv-seg" role="group" aria-label="Œuvre">
          {WORKS.map((w) => <button key={w.id} type="button" className="mv-seg__btn" aria-pressed={work === w.id} onClick={() => setWork(w.id)}>{w.label}</button>)}
        </div>
        <div className="mv-seg" role="group" aria-label="Surface">
          <button type="button" className="mv-seg__btn" aria-pressed={scheme === "paper"} onClick={() => pick("paper")}>☀ Papier</button>
          <button type="button" className="mv-seg__btn" aria-pressed={scheme === "night"} onClick={() => pick("night")}>☾ Nuit</button>
        </div>
      </div>
      <p className="mv-how">{info.how}</p>
      {work === "chronicle" && <Chronicle buckets={buckets} range={range} tz={tz} scheme={scheme} />}
      {work === "trajectory" && <Trajectory measures={measures} tz={tz} scheme={scheme} />}
      {work === "print" && <Print measures={measures} days={days} tz={tz} scheme={scheme} />}
      <details className="mv-legend-box">
        <summary>Laboratoire (expérimental)</summary>
        <div style={{ paddingTop: 8 }}><ArtworkView measures={measures} tz={tz} /></div>
      </details>
    </div>
  );
}
