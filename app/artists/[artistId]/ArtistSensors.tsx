"use client";
// Historique PUBLIC des capteurs d'un artiste : un sélecteur par appareil (nom du device qui porte le capteur), 24 h / 7 j / 30 j.
// Coût Redis : 1 GET /api/sensor?public=1 par (appareil, durée) — réponse mise en cache par le CDN (2 min), rien tant que l'onglet n'est pas ouvert.
import { useEffect, useState } from "react";
import { MeasuresChart } from "../../MeasuresChart";
import { MEASURE_GROUPS, type Measure, type MeasureKind } from "@/lib/measures";

export interface SensorDevice { deviceId: string; deviceName?: string; sensors?: MeasureKind[] }

const RANGES = [{ h: 24, label: "24 h" }, { h: 168, label: "7 jours" }, { h: 720, label: "30 jours" }] as const;
const pill = (on: boolean): React.CSSProperties => ({
  padding: "0.25rem 0.75rem", borderRadius: 999, fontSize: "0.78rem", cursor: "pointer",
  border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-dim, transparent)" : "transparent",
  color: on ? "var(--accent)" : "var(--text2)",
});

export default function ArtistSensors({ devices }: { devices: SensorDevice[] }) {
  const list = devices.filter((d) => (d.sensors?.length ?? 0) > 0);
  const [sel, setSel] = useState(list[0]?.deviceId ?? "");
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<Measure[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setData(null); setErr("");
    fetch(`/api/sensor?deviceId=${encodeURIComponent(sel)}&public=1&hours=${hours}`)
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? "Mesures non publiques" : `Erreur ${r.status}`); return r.json(); })
      .then((j) => { if (live) setData(Array.isArray(j.measures) ? j.measures : []); })
      .catch((e) => { if (live) setErr(String(e.message ?? e)); });
    return () => { live = false; };
  }, [sel, hours]);
  if (list.length === 0) return <p style={{ color: "var(--text3)", textAlign: "center", padding: "2rem" }}>Aucun capteur public.</p>;
  const dev = list.find((d) => d.deviceId === sel) ?? list[0];
  const kinds = dev.sensors ?? [];
  // grandeurs groupées (environnement / liaison) ; une grandeur future non groupée (gaz…) forme son propre bloc
  const grouped = new Set(MEASURE_GROUPS.flatMap((g) => g.kinds));
  const groups = [
    ...MEASURE_GROUPS.map((g) => ({ id: g.id as string, label: g.label, ks: kinds.filter((k) => g.kinds.includes(k)) })),
    { id: "other", label: "Autres mesures", ks: kinds.filter((k) => !grouped.has(k)) },
  ].filter((x) => x.ks.length > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {list.length > 1 && (
        <div role="group" aria-label="Capteur" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {list.map((d) => (
            <button key={d.deviceId} type="button" aria-pressed={d.deviceId === dev.deviceId} onClick={() => setSel(d.deviceId)} style={pill(d.deviceId === dev.deviceId)}>
              {d.deviceName || d.deviceId}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: "0.8rem", color: "var(--text3)" }}>{dev.deviceName || dev.deviceId} · <code>{dev.deviceId}</code></div>
      <div role="group" aria-label="Durée" style={{ display: "flex", gap: 6 }}>
        {RANGES.map((r) => <button key={r.h} type="button" aria-pressed={hours === r.h} onClick={() => setHours(r.h)} style={pill(hours === r.h)}>{r.label}</button>)}
      </div>
      {err && <p style={{ color: "var(--text3)" }}>{err}</p>}
      {!err && data === null && <p style={{ color: "var(--text3)" }}>Chargement…</p>}
      {!err && data !== null && data.length === 0 && <p style={{ color: "var(--text3)" }}>Aucune mesure sur cette période.</p>}
      {!err && data !== null && data.length > 0 && groups.map(({ id, label, ks }) => (
        <section key={`${dev.deviceId}-${hours}-${id}`} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "0.8rem" }}>
          <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.9rem" }}>{label}</h3>
          <MeasuresChart measures={data} kinds={ks} />
        </section>
      ))}
    </div>
  );
}
