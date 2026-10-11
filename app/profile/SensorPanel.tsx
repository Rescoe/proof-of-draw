"use client";
// app/profile/SensorPanel.tsx — historique de température d'un capteur (UNO R4 WiFi + DHT22), heure par heure.
// Quota Redis : UNE lecture (LRANGE de 31 jours) à l'ouverture, aucune actualisation automatique, filtrage de la période côté navigateur.

import { useEffect, useMemo, useState } from "react";
import type { OwnedDevice } from "@/lib/deviceStore";
import { SENSOR_KEEP, formatHum, formatTemp, summarize, type SensorReading } from "@/lib/sensorData";

const PERIODS = [{ h: 24, label: "24 h" }, { h: 168, label: "7 jours" }, { h: SENSOR_KEEP, label: "31 jours" }];
const fmtDate = (t: number) => new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Chart({ readings }: { readings: SensorReading[] }) {
  const pts = [...readings].sort((a, b) => a.t - b.t);
  if (pts.length < 2) return <p style={{ color: "var(--text3)", fontSize: "0.8rem" }}>Au moins deux mesures sont nécessaires pour tracer la courbe.</p>;
  const W = 640, H = 180, P = 28;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const cs = pts.map((p) => p.c), lo = Math.floor(Math.min(...cs) / 10) * 10 - 10, hi = Math.ceil(Math.max(...cs) / 10) * 10 + 10;
  const x = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (c: number) => H - P - ((c - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Courbe de température" style={{ width: "100%", height: "auto", maxHeight: 220 }}>
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--border)" />
      <line x1={P} y1={P} x2={P} y2={H - P} stroke="var(--border)" />
      <text x={4} y={P + 4} fontSize="10" fill="var(--text3)">{(hi / 10).toFixed(0)}°</text>
      <text x={4} y={H - P} fontSize="10" fill="var(--text3)">{(lo / 10).toFixed(0)}°</text>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function SensorButton({ d }: { d: OwnedDevice }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ padding: "0.45rem 0.95rem", borderRadius: 7, background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: "0.82rem", whiteSpace: "nowrap", border: "none", cursor: "pointer" }}>
        🌡 Températures
      </button>
      {open && <SensorModal d={d} onClose={() => setOpen(false)} />}
    </>
  );
}

function SensorModal({ d, onClose }: { d: OwnedDevice; onClose: () => void }) {
  const [all, setAll] = useState<SensorReading[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hours, setHours] = useState(168);

  useEffect(() => {
    let alive = true;
    fetch(`/api/sensor?deviceId=${encodeURIComponent(d.deviceId)}&hours=${SENSOR_KEEP}`, { credentials: "same-origin" })
      .then(async (r) => { const j = await r.json(); if (!alive) return; if (!r.ok) setErr(typeof j.error === "string" ? j.error : "Erreur"); else setAll(j.readings as SensorReading[]); })
      .catch(() => alive && setErr("Erreur réseau"));
    return () => { alive = false; };
  }, [d.deviceId]);   // UNE seule lecture par ouverture : jamais relancée par un re-rendu du parent (quota Redis)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    if (!all || all.length === 0) return [];
    const newest = all[0].t;
    return all.filter((r) => r.t >= newest - hours * 3600);
  }, [all, hours]);
  const sum = useMemo(() => summarize(shown), [shown]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Historique des températures" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg2, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem", width: "min(680px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>🌡 {d.deviceName || d.deviceId}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", color: "var(--text2)", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
        </div>
        {err && <p role="alert" style={{ color: "#f87171" }}>{err}</p>}
        {!err && all === null && <p style={{ color: "var(--text3)" }}>Chargement…</p>}
        {all && all.length === 0 && <p style={{ color: "var(--text3)" }}>Aucune mesure pour l&apos;instant. La carte en envoie une par heure (la première peu après son démarrage, une fois appairée).</p>}
        {all && all.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", margin: "0.6rem 0" }}>
              <span style={{ fontSize: "2rem", fontWeight: 700 }}>{sum.last ? formatTemp(sum.last.c) : "—"}</span>
              {sum.last?.h !== undefined && <span style={{ color: "var(--text2)" }}>💧 {formatHum(sum.last.h)}</span>}
              <span style={{ color: "var(--text3)", fontSize: "0.78rem" }}>{sum.last ? fmtDate(sum.last.t) : ""}</span>
            </div>
            <div role="group" aria-label="Période" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {PERIODS.map((p) => (
                <button key={p.h} type="button" aria-pressed={hours === p.h} onClick={() => setHours(p.h)}
                  style={{ padding: "0.25rem 0.7rem", borderRadius: 999, fontSize: "0.76rem", cursor: "pointer", border: `1px solid ${hours === p.h ? "var(--accent)" : "var(--border)"}`, background: "var(--bg)", color: hours === p.h ? "var(--accent)" : "var(--text2)" }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text2)", marginBottom: 6 }}>
              min {sum.min !== null ? formatTemp(sum.min) : "—"} · max {sum.max !== null ? formatTemp(sum.max) : "—"} · moyenne {sum.avg !== null ? formatTemp(sum.avg) : "—"} · {sum.count} mesure{sum.count > 1 ? "s" : ""}
            </div>
            <Chart readings={shown} />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", marginTop: 8 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--text3)" }}><th>Heure</th><th>Température</th><th>Humidité</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.t} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "3px 0" }}>{fmtDate(r.t)}</td><td>{formatTemp(r.c)}</td><td>{r.h !== undefined ? formatHum(r.h) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
