"use client";
// app/MeasuresExplorer.tsx — explorer les mesures PUBLIQUES (température / humidité) d'un capteur en trois lectures : Graphique · Œuvre · Interprétation.
// Partagé par le panneau latéral du réseau et le profil public d'un artiste. Les calculs vivent dans lib/measureViz.ts (pur, testé).
// Coût Redis : UNE lecture /api/sensor?public=1&hours=720 (1 LRANGE, réponse mise en cache par le CDN 2 min) à la première ouverture ; changer de période ou de mode ne refait aucune requête.
// Données brutes jamais modifiées ; seau vide = trou affiché, jamais interpolé ; pas d'IA (l'« interprétation » est générative locale, par règles fixes).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatMeasure, type Measure, type MeasureKind } from "@/lib/measures";
import { NO_SELECT } from "./MeasuresChart";
import {
  VIZ_RANGES, VIZ_RANGE_IDS, aggregate, bucketLabel, constellation, diskGrid, diskSpec, hasData, nearestBucket, niceScale, summarizePeriod,
  type Bucket, type VizRange,
} from "@/lib/measureViz";

type Mode = "chart" | "art" | "story";
type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "unavailable" } | { kind: "ready"; measures: Measure[] };

const TEMP_COLOR = "#f97316", HUM_COLOR = "#38bdf8";
const MODES: { id: Mode; label: string }[] = [{ id: "chart", label: "Graphique" }, { id: "art", label: "Œuvre" }, { id: "story", label: "Interprétation" }];

const pill = (on: boolean): React.CSSProperties => ({
  padding: "0.3rem 0.8rem", borderRadius: 999, fontSize: "0.78rem", cursor: "pointer", minHeight: 32,
  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "rgba(124,107,255,0.14)" : "transparent", color: on ? "var(--accent)" : "var(--text2)",
});
const muted: React.CSSProperties = { color: "var(--text3)", fontSize: "0.82rem", margin: 0 };

const tzOffset = () => -new Date().getTimezoneOffset();
const fmtDay = (sec: number, tz: number) => { const d = new Date((sec + tz * 60) * 1000); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };

function BucketDetails({ b, range, tz }: { b: Bucket | null; range: VizRange; tz: number }) {
  if (!b) return <p style={muted}>Survole (ou touche) un point pour voir le détail.</p>;
  if (b.n === 0) return <p style={muted}><b>{bucketLabel(b, range, tz)}</b> : aucune mesure reçue.</p>;
  return (
    <p style={{ ...muted, color: "var(--text2)" }} aria-live="polite">
      <b>{bucketLabel(b, range, tz)}</b>
      {b.temp && <> · {formatMeasure("temp", b.temp.avg)}{b.temp.n > 1 ? ` (de ${formatMeasure("temp", b.temp.min)} à ${formatMeasure("temp", b.temp.max)})` : ""}</>}
      {b.hum && <> · {formatMeasure("hum", b.hum.avg)}</>}
      <> · {b.n} mesure{b.n > 1 ? "s" : ""}</>
    </p>
  );
}

// ── Graphique ────────────────────────────────────────────────────────────────
function ChartView({ buckets, range, tz, big }: { buckets: Bucket[]; range: VizRange; tz: number; big: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = big ? 460 : 280, PL = 40, PR = 40, PT = 16, PB = 30;
  const n = buckets.length;
  const tScale = niceScale(buckets.flatMap((b) => (b.temp ? [b.temp.min, b.temp.max] : [])));
  const hScale = niceScale(buckets.flatMap((b) => (b.hum ? [b.hum.min, b.hum.max] : [])), 10);
  const x = (i: number) => PL + ((i + 0.5) / n) * (W - PL - PR);
  const yOf = (v: number, s: { lo: number; hi: number }) => H - PB - ((v / 10 - s.lo) / (s.hi - s.lo)) * (H - PT - PB);
  // une courbe est coupée à chaque trou : on ne relie jamais deux points séparés par des seaux sans mesure
  const path = (pick: (b: Bucket) => number | null, s: { lo: number; hi: number } | null) => {
    if (!s) return "";
    let d = "", pen = false;
    buckets.forEach((b, i) => { const v = pick(b); if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${yOf(v, s).toFixed(1)} `; pen = true; });
    return d;
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(nearestBucket((((e.clientX - r.left) / r.width) * W - PL) / (W - PL - PR), n));
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); e.preventDefault(); }
    if (e.key === "ArrowLeft") { setHover((h) => Math.max(0, (h ?? n) - 1)); e.preventDefault(); }
  };
  const labelEvery = range === "day" ? 4 : range === "week" ? 1 : 5;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label="Courbes de température et d'humidité" style={{ width: "100%", height: "auto", touchAction: "pan-y", outline: "none", ...NO_SELECT }}
        onPointerMove={move} onPointerDown={move} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }} onContextMenu={(e) => e.preventDefault()} onKeyDown={key}>
        <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="var(--border)" />
        {tScale && tScale.ticks.map((v) => <g key={`t${v}`}><line x1={PL} x2={W - PR} y1={yOf(v * 10, tScale)} y2={yOf(v * 10, tScale)} stroke="var(--border)" opacity={0.35} /><text x={PL - 5} y={yOf(v * 10, tScale) + 3} fontSize="10" textAnchor="end" fill={TEMP_COLOR}>{v}°</text></g>)}
        {hScale && hScale.ticks.map((v) => <text key={`h${v}`} x={W - PR + 5} y={yOf(v * 10, hScale) + 3} fontSize="10" fill={HUM_COLOR}>{v}%</text>)}
        {buckets.map((b, i) => (i % labelEvery === 0 ? <text key={i} x={x(i)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--text3)">{range === "day" ? bucketLabel(b, range, tz).slice(-4) : bucketLabel(b, range, tz)}</text> : null))}
        {tScale && range !== "day" && buckets.map((b, i) => (b.temp && b.temp.min !== b.temp.max ? <line key={`r${i}`} x1={x(i)} x2={x(i)} y1={yOf(b.temp.min, tScale)} y2={yOf(b.temp.max, tScale)} stroke={TEMP_COLOR} strokeWidth={6} opacity={0.22} strokeLinecap="round" /> : null))}
        <path d={path((b) => b.temp?.avg ?? null, tScale)} fill="none" stroke={TEMP_COLOR} strokeWidth={2.2} strokeLinejoin="round" />
        <path d={path((b) => b.hum?.avg ?? null, hScale)} fill="none" stroke={HUM_COLOR} strokeWidth={2.2} strokeDasharray="6 4" strokeLinejoin="round" />
        {tScale && buckets.map((b, i) => (b.temp ? <circle key={`pt${i}`} cx={x(i)} cy={yOf(b.temp.avg, tScale)} r={hover === i ? 5 : 2.6} fill={TEMP_COLOR} /> : null))}
        {hScale && buckets.map((b, i) => (b.hum ? <circle key={`ph${i}`} cx={x(i)} cy={yOf(b.hum.avg, hScale)} r={hover === i ? 5 : 2.6} fill={HUM_COLOR} /> : null))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="var(--text3)" strokeDasharray="3 3" />}
      </svg>
      <div style={{ display: "flex", gap: 14, fontSize: "0.74rem", color: "var(--text2)", margin: "2px 0 6px" }}>
        <span><span style={{ color: TEMP_COLOR }}>━</span> Température (échelle gauche){range !== "day" ? ", trait pâle = min–max du jour" : ""}</span>
        <span><span style={{ color: HUM_COLOR }}>╍</span> Humidité (échelle droite)</span>
      </div>
      <BucketDetails b={hover === null ? null : buckets[hover]} range={range} tz={tz} />
    </div>
  );
}

// ── Œuvre : un disque par heure / par jour ──────────────────────────────────
function ArtView({ buckets, range, tz }: { buckets: Bucket[]; range: VizRange; tz: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const { cols, rows } = diskGrid(range);
  const C = 100, R = 42;
  return (
    <div>
      <svg viewBox={`0 0 ${cols * C} ${rows * C}`} role="img" aria-label="Œuvre générée par les mesures : un disque par période" style={{ width: "100%", height: "auto", background: "#0b0b12", borderRadius: 12 }}>
        {buckets.map((b, i) => {
          const s = diskSpec(b), cx = (i % cols) * C + C / 2, cy = Math.floor(i / cols) * C + C / 2;
          const col = s.color ?? "#64748b";
          return (
            <g key={i} tabIndex={0} role="img" aria-label={`${bucketLabel(b, range, tz)} : ${b.n ? `${b.n} mesure(s)` : "aucune mesure"}`} style={{ cursor: "pointer", outline: "none" }}
              onPointerEnter={() => setSel(i)} onFocus={() => setSel(i)} onPointerDown={() => setSel(i)}>
              {s.empty ? <circle cx={cx} cy={cy} r={R * 0.8} fill="none" stroke="#475569" strokeDasharray="3 5" opacity={0.7} /> : (
                <>
                  {s.halo > 0 && <circle cx={cx} cy={cy} r={R} fill="none" stroke={col} strokeWidth={2 + s.halo * 8} opacity={0.3} />}
                  <circle cx={cx} cy={cy} r={R * (1 - s.ring / 2)} fill="none" stroke={col} strokeWidth={R * s.ring} opacity={0.3} />
                  <circle cx={cx} cy={cy} r={R * s.inner * 0.98} fill={col} />
                  {s.drops.map((d, k) => <circle key={k} cx={cx + Math.cos(d.angle) * R * d.dist} cy={cy + Math.sin(d.angle) * R * d.dist} r={d.r * R * 2} fill="#e0f2fe" opacity={0.75} />)}
                </>
              )}
              {sel === i && <circle cx={cx} cy={cy} r={R + 4} fill="none" stroke="#fff" strokeWidth={1.5} />}
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0", fontSize: "0.72rem", color: "var(--text3)", flexWrap: "wrap" }}>
        <span>froid</span><span aria-hidden style={{ width: 90, height: 8, borderRadius: 4, background: "linear-gradient(90deg,rgb(59,79,216),rgb(59,158,230),rgb(143,211,200),rgb(242,224,138),rgb(245,158,59),rgb(229,80,47),rgb(160,20,44))" }} /><span>chaud</span>
        <span>· anneau épais et gouttes = air humide · halo = écart de température dans la période · pointillé = aucune mesure</span>
      </div>
      <BucketDetails b={sel === null ? null : buckets[sel]} range={range} tz={tz} />
    </div>
  );
}

// ── Interprétation : constellation climatique ───────────────────────────────
function StoryView({ buckets, range, tz }: { buckets: Bucket[]; range: VizRange; tz: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const c = useMemo(() => constellation(buckets), [buckets]);
  const W = 640, H = 400;
  if (c.stars.length === 0) return <p style={muted}>Il faut des périodes qui portent à la fois la température et l’humidité pour dessiner une constellation.</p>;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Constellation climatique" style={{ width: "100%", height: "auto", background: "radial-gradient(circle at 50% 40%, #151527, #07070c)", borderRadius: 12 }}>
        {c.links.map(([a, b], k) => <line key={k} x1={c.stars[a].x * W} y1={c.stars[a].y * H} x2={c.stars[b].x * W} y2={c.stars[b].y * H} stroke="#94a3b8" strokeOpacity={0.35} strokeWidth={1} />)}
        {c.stars.map((s, k) => (
          <g key={k} tabIndex={0} style={{ cursor: "pointer", outline: "none" }} onPointerEnter={() => setSel(s.bucket)} onFocus={() => setSel(s.bucket)} onPointerDown={() => setSel(s.bucket)}>
            <circle cx={s.x * W} cy={s.y * H} r={s.r * W * 1.9} fill={s.color} opacity={0.18} />
            <circle cx={s.x * W} cy={s.y * H} r={s.r * W} fill={s.color} stroke={sel === s.bucket ? "#fff" : "none"} strokeWidth={1.5} />
            {(k === 0 || k === c.stars.length - 1) && <text x={s.x * W + 9} y={s.y * H - 9} fontSize="11" fill="#cbd5e1">{k === 0 ? "début" : "fin"}</text>}
          </g>
        ))}
        <text x={W - 10} y={H - 8} fontSize="11" textAnchor="end" fill="#64748b">plus chaud →</text>
        <text x={10} y={16} fontSize="11" fill="#64748b">↑ plus humide</text>
      </svg>
      <p style={{ ...muted, margin: "6px 0", color: "var(--text2)" }}>Sur la période : <b>{c.word || "—"}</b>. Chaque étoile est {VIZ_RANGES[range].unit === "heure" ? "une heure" : "un jour"} (température à l’horizontale, humidité à la verticale, taille = nombre de mesures), reliées dans l’ordre du temps.</p>
      <p style={muted}>Lecture générative locale, calculée par règles fixes : ce n’est pas une intelligence artificielle.</p>
      <BucketDetails b={sel === null ? null : buckets[sel]} range={range} tz={tz} />
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────
export interface MeasuresExplorerProps {
  deviceId: string;
  /** Nom du capteur / de l'appareil qui porte la sonde. */
  sensorLabel: string;
  /** Artiste propriétaire (attribution). */
  ownerName?: string;
  /** Grandeurs déclarées ; sans température ni humidité, rien à explorer ici. */
  kinds: MeasureKind[];
  /** UX jalon 4 : historique DÉJÀ chargé par le parent (useDeviceMeasures) — aucune lecture ici. Absent : le composant lit lui-même, comme avant (migration appelant par appelant). */
  measures?: Measure[];
  /** Instant de référence (secondes) du chargement, fourni avec `measures`. */
  nowSec?: number;
  /** Période pilotée par le parent (une seule période pour toutes les grandeurs) ; le sélecteur interne est alors masqué. */
  range?: VizRange;
  onRangeChange?: (r: VizRange) => void;
  /** PROPRIÉTAIRE : lit son historique privé (cookie de session, même route, même coût Redis : 1 LRANGE) au lieu de la vue publique ; mêmes graphique, œuvre et interprétation (29/10/2026). */
  owner?: boolean;
}

export function MeasuresExplorer({ deviceId, sensorLabel, ownerName, kinds, owner = false, measures: given, nowSec: givenNow, range: controlledRange, onRangeChange }: MeasuresExplorerProps) {
  const [mode, setMode] = useState<Mode>("chart");
  const [ownRange, setOwnRange] = useState<VizRange>("day");
  const controlled = controlledRange !== undefined;
  const range = controlledRange ?? ownRange;
  const setRange = (r: VizRange) => { if (onRangeChange) onRangeChange(r); if (!controlled) setOwnRange(r); };
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [nowSec, setNowSec] = useState(0);   // renseigné au chargement (jamais d'horloge pendant le rendu serveur)
  const [big, setBig] = useState(false);
  const tz = useMemo(() => tzOffset(), []);
  const relevant = kinds.includes("temp") || kinds.includes("hum");

  const fetchData = useCallback(() => {
    setLoad({ kind: "loading" });
    setNowSec(Math.floor(Date.now() / 1000));
    fetch(`/api/sensor?deviceId=${encodeURIComponent(deviceId)}${owner ? "" : "&public=1"}&hours=${VIZ_RANGES.month.hours}`, owner ? { credentials: "same-origin" } : undefined)
      .then(async (r) => {
        if (r.status === 404 && !owner) { setLoad({ kind: "unavailable" }); return; }
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        setLoad({ kind: "ready", measures: Array.isArray(j.measures) ? (j.measures as Measure[]) : [] });
      })
      .catch(() => setLoad({ kind: "error", message: "Impossible de charger les mesures (erreur réseau ou serveur)." }));
  }, [deviceId, owner]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- une seule lecture à l'ouverture (et à chaque changement d'appareil)
  useEffect(() => { if (relevant && given === undefined) fetchData(); }, [relevant, fetchData, given]);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [big]);

  const refNow = given !== undefined ? (givenNow ?? nowSec) : nowSec;
  const effLoad: Load = given !== undefined ? { kind: "ready", measures: given } : load;
  const measures = effLoad.kind === "ready" ? effLoad.measures : null;
  const buckets = useMemo(() => (measures ? aggregate(measures, range, refNow, tz) : []), [measures, range, refNow, tz]);
  const summary = useMemo(() => (measures ? summarizePeriod(measures, range, refNow, tz) : null), [measures, range, refNow, tz]);

  if (!relevant) return <p style={muted}>Ce capteur ne mesure ni la température ni l’humidité.</p>;

  const spec = VIZ_RANGES[range];
  const end = buckets.length ? buckets[buckets.length - 1].end - 1 : refNow;
  const periodText = buckets.length ? `du ${fmtDay(buckets[0].start, tz)} au ${fmtDay(end, tz)}` : "";

  const body = (() => {
    if (effLoad.kind === "loading") return <p style={muted} role="status">Chargement des mesures…</p>;
    if (effLoad.kind === "error") return <div role="alert"><p style={{ ...muted, marginBottom: 6 }}>{effLoad.message}</p><button type="button" style={pill(false)} onClick={fetchData}>Réessayer</button></div>;
    if (effLoad.kind === "unavailable") return <p style={muted}>Aucune mesure publique : le propriétaire garde ce capteur privé, ou aucune mesure n’a encore été reçue.</p>;
    if (!hasData(buckets)) return <p style={muted}>Aucune mesure sur cette période ({periodText}). {range !== "month" ? "Essaie une période plus longue." : ""}</p>;
    return (
      <>
        {mode === "chart" && <ChartView buckets={buckets} range={range} tz={tz} big={big} />}
        {mode === "art" && <ArtView buckets={buckets} range={range} tz={tz} />}
        {mode === "story" && <StoryView buckets={buckets} range={range} tz={tz} />}
        {(mode === "art" || mode === "story") && (
          <p style={{ ...muted, marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            {mode === "art" ? "Œuvre" : "Interprétation"} générée à partir des mesures du capteur <b>{sensorLabel}</b>{ownerName ? <> de l’artiste <b>{ownerName}</b></> : null}, période {periodText} ({spec.buckets} {spec.unit}s).
            Elle évolue avec les données ; les mesures brutes ne sont jamais modifiées.
          </p>
        )}
      </>
    );
  })();

  const stats = summary && summary.count > 0 && (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.78rem", color: "var(--text2)", margin: "0 0 8px" }}>
      {summary.temp && <span style={{ color: TEMP_COLOR }}>🌡 moy. {formatMeasure("temp", summary.temp.avg)} · min {formatMeasure("temp", summary.temp.min)} · max {formatMeasure("temp", summary.temp.max)}</span>}
      {summary.hum && <span style={{ color: HUM_COLOR }}>💧 moy. {formatMeasure("hum", summary.hum.avg)} · min {formatMeasure("hum", summary.hum.min)} · max {formatMeasure("hum", summary.hum.max)}</span>}
      <span>{summary.count} mesure{summary.count > 1 ? "s" : ""}</span>
    </div>
  );

  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div role="group" aria-label="Lecture" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MODES.map((m) => <button key={m.id} type="button" aria-pressed={mode === m.id} style={pill(mode === m.id)} onClick={() => setMode(m.id)}>{m.label}</button>)}
        </div>
        <button type="button" style={pill(false)} onClick={() => setBig((v) => !v)} aria-label={big ? "Réduire" : "Agrandir pour explorer"}>{big ? "✕ Fermer" : "⤢ Agrandir"}</button>
      </div>
      {!controlled && (
        <div role="group" aria-label="Période" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {VIZ_RANGE_IDS.map((r) => <button key={r} type="button" aria-pressed={range === r} style={pill(range === r)} onClick={() => setRange(r)}>{VIZ_RANGES[r].label}</button>)}
        </div>
      )}
      {periodText && <span style={muted}>{periodText}</span>}
      {stats}
      {body}
    </div>
  );

  if (!big) return content;
  return createPortal(
    <div role="dialog" aria-modal="true" data-nested-dialog="" aria-label={`Mesures de ${sensorLabel}`} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "var(--bg)", color: "var(--text)", overflow: "auto", padding: "1rem" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>{sensorLabel}{ownerName ? ` · ${ownerName}` : ""}</h2>
        {content}
      </div>
    </div>,
    document.body,
  );
}

