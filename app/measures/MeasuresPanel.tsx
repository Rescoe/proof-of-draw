"use client";
// app/measures/MeasuresPanel.tsx — UN panneau de mesures pour Mon espace, le profil public, le panneau réseau et le panneau artiste (UX jalon 4, 29/10/2026).
//  • UNE lecture de l'historique (useDeviceMeasures : cache de session, Promise partagée, aucun polling) ;
//  • UNE période (24 h / 7 jours / 30 jours) qui s'applique à TOUTES les grandeurs : température et humidité, qualité de l'air, connexion de la carte, relevés bruts ;
//  • les tracés actuels sont conservés (MeasuresExplorer pour température / humidité, MeasuresChart pour le reste) : l'extraction d'un cœur de tracé commun viendra APRÈS (audit Codex).
// Qualité de l'air : toujours le niveau (jamais le nombre) ; le brut du SGP40 n'est jamais affiché.
import { useMemo, useState } from "react";
import { MEASURE_KINDS, kindsOfGroup, type Measure, type MeasureKind } from "@/lib/measures";
import { VIZ_RANGES, VIZ_RANGE_IDS, type VizRange } from "@/lib/measureViz";
import { MeasuresChart } from "../MeasuresChart";
import { MeasuresExplorer } from "../MeasuresExplorer";
import { useDeviceMeasures } from "./useDeviceMeasures";

const PERIOD_LABEL: Record<VizRange, string> = { day: "24 h", week: "7 jours", month: "30 jours" };
const muted: React.CSSProperties = { color: "var(--text3)", fontSize: "0.82rem", margin: 0 };
const section: React.CSSProperties = { borderTop: "1px solid var(--border)", paddingTop: "0.8rem", display: "flex", flexDirection: "column", gap: 8 };

export interface MeasuresPanelProps {
  deviceId: string;
  /** Nom de l'appareil / du capteur (attribution et titres). */
  sensorLabel: string;
  ownerName?: string;
  /** Grandeurs déclarées par l'appareil. */
  kinds: MeasureKind[];
  /** PROPRIÉTAIRE : historique privé ; sinon public. */
  owner?: boolean;
  /** Relevés bruts (tableau / cartes) dans un volet repliable. */
  showTable?: boolean;
  /** Mesures publiques ? (propriétaire seulement) : affiche si l'historique est visible par tous ou par soi seul. */
  measuresPublic?: boolean;
}

export function MeasuresPanel({ deviceId, sensorLabel, ownerName, kinds, owner = false, showTable = false, measuresPublic }: MeasuresPanelProps) {
  const [range, setRange] = useState<VizRange>("day");
  const data = useDeviceMeasures(deviceId, { owner });
  const hasTH = kinds.includes("temp") || kinds.includes("hum");
  const air = kinds.includes("vocidx");
  const link = kindsOfGroup(kinds, "link");

  const inRange = useMemo(() => {
    if (data.state !== "ready") return [] as Measure[];
    const since = data.nowSec - VIZ_RANGES[range].hours * 3600;
    return data.measures.filter((m) => m.t >= since);
  }, [data, range]);

  const rawKinds = useMemo(() => [...kindsOfGroup(kinds, "env"), ...link], [kinds, link]);

  if (data.state === "loading") return <p style={muted} role="status">Chargement des mesures…</p>;
  if (data.state === "error") return <div role="alert"><p style={{ ...muted, marginBottom: 6 }}>{data.message}</p><button type="button" className="pod-btn pod-btn--sm" onClick={data.reload}>Réessayer</button></div>;
  if (data.state === "unavailable") return <p style={muted}>Aucune mesure publique : le propriétaire garde ce capteur privé, ou aucune mesure n’a encore été reçue.</p>;
  if (data.measures.length === 0) return <p style={muted}>Aucune mesure pour l’instant. La carte envoie ses lectures régulièrement (la première peu après son démarrage, une fois appairée).</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {owner && measuresPublic !== undefined && (
        <p style={muted}>{measuresPublic ? "🌐 Mesures publiques : visibles par tout le monde." : "🔒 Mesures privées : visibles par vous seul."}</p>
      )}
      <div className="pod-pills" role="group" aria-label="Période">
        {VIZ_RANGE_IDS.map((r) => (
          <button key={r} type="button" className="pod-pill" aria-pressed={range === r} onClick={() => setRange(r)}>{PERIOD_LABEL[r]}</button>
        ))}
      </div>

      {hasTH && (
        <section aria-label="Température et humidité" style={section}>
          <h3 style={{ margin: 0, fontSize: "0.92rem" }}>🌡 Température et humidité</h3>
          <MeasuresExplorer deviceId={deviceId} sensorLabel={sensorLabel} ownerName={ownerName} kinds={kinds} owner={owner} measures={data.measures} nowSec={data.nowSec} range={range} onRangeChange={setRange} />
        </section>
      )}
      {air && (
        <section aria-label="Qualité de l'air" style={section}>
          <h3 style={{ margin: 0, fontSize: "0.92rem" }}>{MEASURE_KINDS.vocidx.icon} Qualité de l’air</h3>
          {inRange.some((m) => m.v.vocidx !== undefined) ? <MeasuresChart measures={inRange} kinds={["vocidx"]} /> : <p style={muted}>Aucune mesure d’air sur cette période.</p>}
        </section>
      )}
      {link.length > 0 && (
        <section aria-label="Connexion de la carte" style={section}>
          <h3 style={{ margin: 0, fontSize: "0.92rem" }}>📶 Connexion de la carte</h3>
          {inRange.some((m) => link.some((k) => m.v[k] !== undefined)) ? <MeasuresChart measures={inRange} kinds={link} /> : <p style={muted}>Aucune mesure de connexion sur cette période.</p>}
        </section>
      )}
      {showTable && rawKinds.length > 0 && (
        <details style={section}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text2)", minHeight: 44, display: "flex", alignItems: "center" }}>Relevés bruts ({PERIOD_LABEL[range]}, les plus récents)</summary>
          <MeasuresChart measures={inRange} kinds={rawKinds} tableOnly />
        </details>
      )}
    </div>
  );
}
