"use client";
// app/profile/SensorPanel.tsx — historique des mesures d'un appareil (propriétaire), jusqu'à 31 jours.
// Quota Redis : UNE lecture (LRANGE) à l'ouverture, aucune actualisation automatique, filtrage de la période côté navigateur.

import { useEffect, useMemo, useState } from "react";
import type { OwnedDevice } from "@/lib/deviceStore";
import { MEASURE_MAX_HOURS, MEASURE_KINDS, formatMeasure, measureKindsOf, type Measure } from "@/lib/measures";
import { MeasuresChart, fmtMeasureDate } from "../MeasuresChart";

const PERIODS = [{ h: 24, label: "24 h" }, { h: 168, label: "7 jours" }, { h: MEASURE_MAX_HOURS, label: "31 jours" }];

export function SensorButton({ d }: { d: OwnedDevice }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ padding: "0.45rem 0.95rem", borderRadius: 7, background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: "0.82rem", whiteSpace: "nowrap", border: "none", cursor: "pointer" }}>
        🌡 Mesures
      </button>
      {open && <SensorModal d={d} onClose={() => setOpen(false)} />}
    </>
  );
}

function SensorModal({ d, onClose }: { d: OwnedDevice; onClose: () => void }) {
  const [all, setAll] = useState<Measure[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hours, setHours] = useState(168);
  const kinds = useMemo(() => measureKindsOf(d), [d]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/sensor?deviceId=${encodeURIComponent(d.deviceId)}&hours=${MEASURE_MAX_HOURS}`, { credentials: "same-origin" })
      .then(async (r) => { const j = await r.json(); if (!alive) return; if (!r.ok) setErr(typeof j.error === "string" ? j.error : "Erreur"); else setAll(j.measures as Measure[]); })
      .catch(() => alive && setErr("Erreur réseau"));
    return () => { alive = false; };
  }, [d.deviceId]);   // UNE seule lecture par ouverture : jamais relancée par un re-rendu du parent (quota Redis)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => (all && all.length > 0 ? all.filter((m) => m.t >= all[0].t - hours * 3600) : []), [all, hours]);
  const last = all?.[0];

  return (
    <div role="dialog" aria-modal="true" aria-label="Historique des mesures" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg2, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem", width: "min(680px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>🌡 {d.deviceName || d.deviceId}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", color: "var(--text2)", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
        </div>
        {err && <p role="alert" style={{ color: "#f87171" }}>{err}</p>}
        {!err && all === null && <p style={{ color: "var(--text3)" }}>Chargement…</p>}
        {all && all.length === 0 && <p style={{ color: "var(--text3)" }}>Aucune mesure pour l&apos;instant. La carte en envoie régulièrement (la première peu après son démarrage, une fois appairée).</p>}
        {all && last && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", margin: "0.6rem 0" }}>
              {kinds.filter((k) => last.v[k] !== undefined).map((k, i) => (
                <span key={k} style={{ fontSize: i === 0 ? "2rem" : "1.1rem", fontWeight: i === 0 ? 700 : 500, color: i === 0 ? "inherit" : "var(--text2)" }}>
                  {i > 0 && MEASURE_KINDS[k].icon + " "}{formatMeasure(k, last.v[k] as number)}
                </span>
              ))}
              <span style={{ color: "var(--text3)", fontSize: "0.78rem" }}>{fmtMeasureDate(last.t)}</span>
            </div>
            <div role="group" aria-label="Période" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {PERIODS.map((p) => (
                <button key={p.h} type="button" aria-pressed={hours === p.h} onClick={() => setHours(p.h)}
                  style={{ padding: "0.25rem 0.7rem", borderRadius: 999, fontSize: "0.76rem", cursor: "pointer", border: `1px solid ${hours === p.h ? "var(--accent)" : "var(--border)"}`, background: "var(--bg)", color: hours === p.h ? "var(--accent)" : "var(--text2)" }}>
                  {p.label}
                </button>
              ))}
            </div>
            <MeasuresChart measures={shown} kinds={kinds} showTable />
          </>
        )}
      </div>
    </div>
  );
}
