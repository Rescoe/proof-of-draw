"use client";
// app/measures/MeasuresPanel.tsx — UN panneau de mesures pour Mon espace, le profil public, le panneau réseau et le panneau artiste (refonte du 03/11/2026 ; versions précédentes : archive/2026-11-02_vue-capteurs-v1 et historique git).
//  • UNE lecture de l'historique (useDeviceMeasures : cache de session, Promise partagée, aucun polling) ; le serveur ne renvoie au public QUE les grandeurs publiques (lib/measurePrivacy.ts) ;
//  • TROIS espaces : Données (Vue d'ensemble / Analyse détaillée), Œuvres, Lecture ; UNE période (24 h / 7 jours / 30 jours) commune ;
//  • tout est calculé sur le tableau déjà chargé : changer d'onglet, de grandeur, de représentation ou d'échelle ne fait AUCUNE requête.
import { useMemo, useState } from "react";
import type { Measure, MeasureKind } from "@/lib/measures";
import { VIZ_RANGES, VIZ_RANGE_IDS, type VizRange } from "@/lib/measureViz";
import { clampWin, fullWindow, lastHours, sameWin, zoomAt, type Win } from "@/lib/chartView";
import { defaultSelection, planCharts, selectableKinds, type Repr } from "@/lib/chartCompose";
import { MeasuresChart } from "../MeasuresChart";
import { useDeviceMeasures } from "./useDeviceMeasures";
import { SeriesChart, type ChartShared } from "./SeriesChart";
import { AirStrip, DisplaySheet, OverviewSummary, SelectionCard } from "./DataParts";
import { WorksView } from "./WorksView";
import { ReadingView } from "./ReadingView";
import "./measures.css";

type Tab = "data" | "works" | "reading";
type DataView = "overview" | "detail";
const TABS: { id: Tab; label: string }[] = [{ id: "data", label: "Données" }, { id: "works", label: "Œuvres" }, { id: "reading", label: "Lecture" }];
const PERIOD_LABEL: Record<VizRange, string> = { day: "24 h", week: "7 jours", month: "30 jours" };

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
  const [tab, setTab] = useState<Tab>("data");
  const [dataView, setDataView] = useState<DataView>("overview");
  const [range, setRange] = useState<VizRange>("week");
  const [custom, setCustom] = useState<Win | null>(null);        // fenêtre choisie par zoom / déplacement ; null = fenêtre de la période
  const [sel, setSel] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);      // instant signalé par la Lecture
  const [picked, setPicked] = useState<MeasureKind[] | null>(null);   // choix de l'utilisateur (Analyse détaillée) ; null = composition par défaut
  const [airOn, setAirOn] = useState(false);                     // Vue d'ensemble : ajouter l'air volontairement
  const [repr, setRepr] = useState<Repr>("points");
  const [fullScale, setFullScale] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<MeasureKind>>(new Set());
  const [sheet, setSheet] = useState(false);
  const data = useDeviceMeasures(deviceId, { owner });
  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);

  const all: Measure[] = useMemo(() => (data.state === "ready" ? data.measures : []), [data]);
  const available = useMemo(() => selectableKinds(kinds, all), [kinds, all]);
  const full = useMemo(() => fullWindow(all), [all]);
  const preset = useMemo(() => (full ? lastHours(full, VIZ_RANGES[range].hours) : null), [full, range]);
  const win = custom ?? preset;
  const inRange = useMemo(() => (preset ? all.filter((m) => m.t >= preset.t0) : []), [all, preset]);

  const pickRange = (r: VizRange) => { setRange(r); setCustom(null); setFocus(null); };
  const reset = () => { setCustom(null); setSel(null); setFocus(null); setPicked(null); setAirOn(false); setRepr("points"); setFullScale(false); setHidden(new Set()); };

  if (data.state === "loading") return <p className="mv-muted" role="status">Chargement des mesures…</p>;
  if (data.state === "error") return <div role="alert"><p className="mv-muted">{data.message}</p><button type="button" className="mv-btn" onClick={data.reload}>Réessayer</button></div>;
  if (data.state === "unavailable") return <p className="mv-muted">Aucune mesure publique : le propriétaire garde ce capteur privé, ou aucune mesure n’a encore été reçue.</p>;
  if (all.length === 0 || !full || !win || !preset) return <p className="mv-muted">Aucune mesure pour l’instant. La carte envoie ses lectures régulièrement (la première peu après son démarrage, une fois appairée).</p>;

  // composition affichée : Vue d'ensemble = température + humidité (+ air si demandé) ; Analyse détaillée = choix de l'utilisateur
  const baseSel = defaultSelection(available);
  const overviewSel = airOn && available.includes("vocidx") && !baseSel.includes("vocidx") ? [...baseSel, "vocidx" as MeasureKind] : baseSel;
  const selected = (dataView === "detail" ? picked ?? baseSel : overviewSel).filter((k) => available.includes(k));
  const plan = planCharts(selected);
  const shownKinds = selected.filter((k) => !hidden.has(k));
  const reprNow: Repr = dataView === "overview" ? "points" : repr;
  const shared: ChartShared = {
    repr: reprNow, fullScale: dataView === "overview" ? false : fullScale, win, full, sel, focus, tz, hidden,
    setWin: (w) => setCustom(sameWin(w, preset) ? null : w), setSel,
    toggle: (k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
  };
  const jump = (t: number, k: MeasureKind | null) => {
    setSel(t); setFocus(t); setCustom(clampWin({ t0: t - 12 * 3600, t1: t + 12 * 3600 }, full));
    if (k && available.includes(k)) {
      const withK = baseSel.includes(k) ? baseSel : [k];
      setPicked(withK);
      setHidden((h) => { const n = new Set(h); n.delete(k); return n; });
    } else setPicked(null);
    setDataView("detail"); setTab("data");
  };
  const showAirStrip = dataView === "overview" && available.includes("vocidx") && !selected.includes("vocidx");

  return (
    <div className="mv-root">
      {owner && measuresPublic !== undefined && (
        <p className="mv-muted">{measuresPublic ? "🌐 Les grandeurs réglées « publiques » sont visibles par tous ; les autres restent à vous seul (Gérer › Réglages)." : "🔒 Mesures privées : visibles par vous seul."}</p>
      )}
      <div className="mv-row mv-row--top">
        <div className="mv-seg" role="group" aria-label="Espace">
          {TABS.map((t) => <button key={t.id} type="button" className="mv-seg__btn" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        <div className="mv-seg" role="group" aria-label="Période">
          {VIZ_RANGE_IDS.map((r) => <button key={r} type="button" className="mv-seg__btn" aria-pressed={range === r} onClick={() => pickRange(r)}>{PERIOD_LABEL[r]}</button>)}
        </div>
      </div>

      {tab === "data" && (
        <div className="mv-stack">
          <div className="mv-row">
            <div className="mv-seg" role="group" aria-label="Niveau de lecture">
              <button type="button" className="mv-seg__btn" aria-pressed={dataView === "overview"} onClick={() => setDataView("overview")}>Vue d’ensemble</button>
              <button type="button" className="mv-seg__btn" aria-pressed={dataView === "detail"} onClick={() => setDataView("detail")}>Analyse détaillée</button>
            </div>
            {dataView === "detail" && <button type="button" className="mv-btn" aria-expanded={sheet} onClick={() => setSheet((v) => !v)}>⚙ Affichage</button>}
          </div>

          {dataView === "overview" && <OverviewSummary all={all} inRange={inRange} kinds={available.filter((k) => ["temp", "hum", "vocidx"].includes(k))} tz={tz} />}

          {dataView === "detail" && (
            <div className="mv-row">
              <button type="button" className="mv-btn" onClick={() => setSheet(true)}>Choisir les données affichées</button>
              <button type="button" className="mv-btn" onClick={reset}>Réinitialiser la vue</button>
            </div>
          )}
          {dataView === "detail" && sheet && (
            <DisplaySheet available={available} selected={selected} onSelected={(k) => { setPicked(k); setHidden(new Set()); }} repr={repr} onRepr={setRepr} fullScale={fullScale} onFullScale={setFullScale} rangeIsDay={range === "day"} onReset={reset} onClose={() => setSheet(false)} />
          )}

          <div className="mv-data">
            <div className="mv-charts">
              <div className="mv-row mv-row--tools">
                <button type="button" className="mv-btn" aria-label="Zoom avant" onClick={() => shared.setWin(zoomAt(win, full, 0.5, 0.6))}>＋</button>
                <button type="button" className="mv-btn" aria-label="Zoom arrière" onClick={() => shared.setWin(zoomAt(win, full, 0.5, 1.6))}>−</button>
                <button type="button" className="mv-btn" onClick={() => setCustom(full)}>Tout l’historique</button>
                <button type="button" className="mv-btn" onClick={() => { setCustom(null); setFocus(null); }}>↺ Période</button>
              </div>
              <p className="mv-note">Molette ou pincement : zoom · glisser : déplacer · toucher : valeurs exactes</p>
              {plan.layout === "none" && <p className="mv-muted">Aucune donnée choisie : ouvrez « Affichage » pour en sélectionner.</p>}
              {plan.charts.map((ks) => <SeriesChart key={ks.join("-")} kinds={ks} measures={all} shared={shared} />)}
              {showAirStrip && <AirStrip measures={all} win={win} tz={tz} />}
              {dataView === "overview" && available.includes("vocidx") && (
                <button type="button" className="mv-btn" aria-pressed={airOn} onClick={() => setAirOn((v) => !v)}>{airOn ? "Retirer la qualité de l’air du graphique" : "Ajouter la qualité de l’air au graphique"}</button>
              )}
              {dataView === "overview" && <button type="button" className="mv-link" onClick={() => setDataView("detail")}>Personnaliser dans l’analyse détaillée →</button>}
            </div>
            <SelectionCard measures={all} kinds={shownKinds} sel={sel} tz={tz} repr={reprNow} win={win} onSel={setSel} />
          </div>
        </div>
      )}
      {tab === "works" && <WorksView measures={inRange} range={range} tz={tz} />}
      {tab === "reading" && <ReadingView measures={inRange} tz={tz} days={range === "day" ? 2 : range === "week" ? 7 : 30} onJump={jump} />}

      {showTable && available.length > 0 && (
        <details className="mv-legend-box">
          <summary>Relevés bruts ({PERIOD_LABEL[range]}, les plus récents)</summary>
          <MeasuresChart measures={inRange} kinds={available} tableOnly />
        </details>
      )}
      <p className="mv-note">Mesures de <b>{sensorLabel}</b>{ownerName ? <> · {ownerName}</> : null}. Les courbes relient les mesures reçues, sans lissage ; un trou reste un trou ; une tendance ou une bande min–max est toujours signalée comme telle.</p>
    </div>
  );
}
