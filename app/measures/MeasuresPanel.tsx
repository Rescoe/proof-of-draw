"use client";
// app/measures/MeasuresPanel.tsx — UN panneau de mesures pour Mon espace, le profil public, le panneau réseau et le panneau artiste (refonte du 02/11/2026 ; version précédente : archive/2026-11-02_vue-capteurs-v1).
//  • UNE lecture de l'historique (useDeviceMeasures : cache de session, Promise partagée, aucun polling) ; le serveur ne renvoie au public QUE les grandeurs publiques (lib/measurePrivacy.ts) ;
//  • TROIS lectures des mêmes mesures : Courbes (toutes les grandeurs, zoom / déplacement / valeur exacte), Œuvre (une bulle par mesure), Lecture (constats + grille jours × heures) ;
//  • UNE période (24 h / 7 jours / 30 jours) : fenêtre initiale des courbes, et mesures retenues pour l'œuvre et la lecture.
import { useMemo, useState } from "react";
import { MEASURE_KINDS, type Measure, type MeasureKind } from "@/lib/measures";
import { VIZ_RANGES, VIZ_RANGE_IDS, type VizRange } from "@/lib/measureViz";
import { clampWin, fullWindow, lastHours, sameWin, zoomAt, type Win } from "@/lib/chartView";
import { MeasuresChart } from "../MeasuresChart";
import { useDeviceMeasures } from "./useDeviceMeasures";
import { KindChart, type CurveView } from "./SeriesChart";
import { ArtworkView } from "./ArtworkView";
import { ReadingView } from "./ReadingView";

type Mode = "curves" | "art" | "reading";
const MODES: { id: Mode; label: string }[] = [{ id: "curves", label: "Courbes" }, { id: "art", label: "Œuvre" }, { id: "reading", label: "Lecture" }];
const PERIOD_LABEL: Record<VizRange, string> = { day: "24 h", week: "7 jours", month: "30 jours" };
const VIEWS: { id: CurveView; label: string; hint: string }[] = [
  { id: "points", label: "Points réels", hint: "Une mesure = un point, reliés sans lissage" },
  { id: "band", label: "Amplitude du jour", hint: "Bande min–max de chaque jour (transparence) et moyenne du jour" },
  { id: "both", label: "Les deux", hint: "Bande du jour et points réels" },
];
const GROUPS: { id: string; label: string; kinds: MeasureKind[] }[] = [
  { id: "env", label: "Environnement", kinds: ["temp", "hum", "vocidx"] },
  { id: "link", label: "Connexion de la carte", kinds: ["rssi", "lat", "dl"] },
];
const muted: React.CSSProperties = { color: "var(--text3)", fontSize: "0.82rem", margin: 0 };
const tool: React.CSSProperties = { minWidth: 36, minHeight: 32, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", fontSize: "0.95rem" };

export interface MeasuresPanelProps {
  deviceId: string;
  /** Nom de l'appareil / du capteur (attribution et titres). */
  sensorLabel: string;
  ownerName?: string;
  /** Grandeurs déclarées par l'appareil (pour le public : déjà réduites aux grandeurs publiques). */
  kinds: MeasureKind[];
  /** PROPRIÉTAIRE : historique privé ; sinon public. */
  owner?: boolean;
  /** Relevés bruts (tableau) dans un volet repliable. */
  showTable?: boolean;
  /** Mesures publiques ? (propriétaire seulement) : affiche si l'historique est visible par tous ou par soi seul. */
  measuresPublic?: boolean;
}

export function MeasuresPanel({ deviceId, sensorLabel, ownerName, kinds, owner = false, showTable = false, measuresPublic }: MeasuresPanelProps) {
  const [mode, setMode] = useState<Mode>("curves");
  const [range, setRange] = useState<VizRange>("week");
  const [custom, setCustom] = useState<Win | null>(null);   // fenêtre choisie par zoom / déplacement ; null = fenêtre de la période
  const [sel, setSel] = useState<number | null>(null);
  const [view, setView] = useState<CurveView>("points");
  const data = useDeviceMeasures(deviceId, { owner });
  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);
  const pickRange = (r: VizRange) => { setRange(r); setCustom(null); };   // changer de période remet la fenêtre de cette période

  const all: Measure[] = useMemo(() => (data.state === "ready" ? data.measures : []), [data]);
  // le brut du SGP40 (`voc`) n'est jamais affiché ; seules les grandeurs qui ont des mesures sont tracées
  const present = useMemo(() => kinds.filter((k) => k !== "voc" && all.some((m) => m.v[k] !== undefined)), [kinds, all]);
  const full = useMemo(() => fullWindow(all), [all]);
  const preset = useMemo(() => (full ? lastHours(full, VIZ_RANGES[range].hours) : null), [full, range]);
  const win = custom ?? preset;
  const inRange = useMemo(() => (data.state === "ready" ? all.filter((m) => preset && m.t >= preset.t0) : []), [data, all, preset]);

  if (data.state === "loading") return <p style={muted} role="status">Chargement des mesures…</p>;
  if (data.state === "error") return <div role="alert"><p style={{ ...muted, marginBottom: 6 }}>{data.message}</p><button type="button" className="pod-btn pod-btn--sm" onClick={data.reload}>Réessayer</button></div>;
  if (data.state === "unavailable") return <p style={muted}>Aucune mesure publique : le propriétaire garde ce capteur privé, ou aucune mesure n’a encore été reçue.</p>;
  if (all.length === 0 || !full || !win || !preset) return <p style={muted}>Aucune mesure pour l’instant. La carte envoie ses lectures régulièrement (la première peu après son démarrage, une fois appairée).</p>;

  const shared = { view, win, full, setWin: (w: Win) => setCustom(sameWin(w, preset) ? null : w), sel, setSel, tz };
  const jump = (t: number, k: MeasureKind | null) => { setSel(t); setCustom(clampWin({ t0: t - 12 * 3600, t1: t + 12 * 3600 }, full)); setMode("curves"); void k; };
  const rawKinds = present;
  const days = range === "day" ? 2 : range === "week" ? 7 : 30;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      {owner && measuresPublic !== undefined && (
        <p style={muted}>{measuresPublic ? "🌐 Les grandeurs réglées « publiques » sont visibles par tous ; les autres restent à vous seul (Gérer › Réglages)." : "🔒 Mesures privées : visibles par vous seul."}</p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div className="pod-pills" role="group" aria-label="Lecture">
          {MODES.map((m) => <button key={m.id} type="button" className="pod-pill" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>)}
        </div>
        <div className="pod-pills" role="group" aria-label="Période">
          {VIZ_RANGE_IDS.map((r) => <button key={r} type="button" className="pod-pill" aria-pressed={range === r} onClick={() => pickRange(r)}>{PERIOD_LABEL[r]}</button>)}
        </div>
      </div>

      {mode === "curves" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button type="button" style={tool} aria-label="Zoom avant" onClick={() => shared.setWin(zoomAt(win, full, 0.5, 0.6))}>＋</button>
            <button type="button" style={tool} aria-label="Zoom arrière" onClick={() => shared.setWin(zoomAt(win, full, 0.5, 1.6))}>−</button>
            <button type="button" style={{ ...tool, padding: "0 10px", fontSize: "0.76rem" }} onClick={() => setCustom(full)}>Tout l’historique</button>
            <button type="button" style={{ ...tool, padding: "0 10px", fontSize: "0.76rem" }} onClick={() => setCustom(null)}>↺ Période</button>
            <span style={{ ...muted, fontSize: "0.72rem" }}>Molette ou pincement : zoom · glisser : déplacer · toucher : valeur exacte</span>
          </div>
          <div className="pod-pills" role="group" aria-label="Vision des courbes">
            {VIEWS.map((v) => <button key={v.id} type="button" className="pod-pill" aria-pressed={view === v.id} title={v.hint} onClick={() => setView(v.id)}>{v.label}</button>)}
          </div>
          {GROUPS.map((g) => {
            const ks = g.kinds.filter((k) => present.includes(k));
            if (ks.length === 0) return null;
            return (
              <section key={g.id} aria-label={g.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: "0.8rem", color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{g.label}</h3>
                {ks.map((k) => <KindChart key={k} kind={k} measures={all} shared={shared} />)}
              </section>
            );
          })}
          {present.length === 0 && <p style={muted}>Aucune grandeur à tracer.</p>}
        </div>
      )}
      {mode === "art" && <ArtworkView measures={inRange} tz={tz} />}
      {mode === "reading" && <ReadingView measures={inRange} tz={tz} days={days} onJump={jump} />}

      {showTable && rawKinds.length > 0 && (
        <details style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text2)", minHeight: 44, display: "flex", alignItems: "center" }}>Relevés bruts ({PERIOD_LABEL[range]}, les plus récents)</summary>
          <MeasuresChart measures={inRange} kinds={rawKinds} tableOnly />
        </details>
      )}
      <p style={{ ...muted, fontSize: "0.72rem" }}>
        {MEASURE_KINDS.temp.label}, {MEASURE_KINDS.hum.label.toLowerCase()}{present.includes("vocidx") ? ", qualité de l’air" : ""} : mesures de <b>{sensorLabel}</b>{ownerName ? <> · {ownerName}</> : null}. Les courbes relient les mesures reçues, sans lissage ; un trou reste un trou.
      </p>
    </div>
  );
}
