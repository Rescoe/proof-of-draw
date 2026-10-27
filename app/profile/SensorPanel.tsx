"use client";
// app/profile/SensorPanel.tsx — mesures d'un appareil (propriétaire) : résumé sur la carte + historique (jusqu'à 31 jours).
// Deux parties SÉPARÉES : « Température et humidité » (environnement) et « Connexion de la carte » (signal, latence, débit).
// Quota Redis : le résumé vient de GET /api/devices (1 LINDEX par capteur) ; l'historique = UNE lecture (LRANGE) à l'ouverture, aucune actualisation automatique.

import { useEffect, useMemo, useState } from "react";
import type { OwnedDevice } from "@/lib/deviceStore";
import { MEASURE_GROUPS, MEASURE_KINDS, MEASURE_MAX_HOURS, formatMeasure, kindsOfGroup, measureKindsOf, type Measure, type MeasureKind } from "@/lib/measures";
import { MeasuresChart, fmtMeasureDate } from "../MeasuresChart";
import { MeasuresExplorer } from "../MeasuresExplorer";

const PERIODS = [{ h: 24, label: "24 h" }, { h: 168, label: "7 jours" }, { h: MEASURE_MAX_HOURS, label: "31 jours" }];

/** Valeurs de la dernière mesure, sur la carte de l'appareil (carte sans écran). */
export function SensorSummary({ d }: { d: OwnedDevice }) {
  const kinds = measureKindsOf(d);
  const last = d.latest;
  const env = kindsOfGroup(kinds, "env").filter((k) => last?.v[k] !== undefined);
  const link = kindsOfGroup(kinds, "link").filter((k) => last?.v[k] !== undefined);
  if (!last) return <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "var(--text3)" }}>Aucune mesure reçue pour l&apos;instant (la carte envoie ses lectures toutes les heures).</p>;
  return (
    <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.9rem", flexWrap: "wrap" }}>
        {env.map((k, i) => (
          <span key={k} style={{ fontSize: i === 0 ? "1.6rem" : "1rem", fontWeight: i === 0 ? 700 : 500, color: i === 0 ? "inherit" : "var(--text2)" }}>
            {i > 0 && MEASURE_KINDS[k].icon + " "}{formatMeasure(k, last.v[k] as number)}
          </span>
        ))}
      </div>
      {link.length > 0 && (
        <div style={{ fontSize: "0.76rem", color: "var(--text2)" }}>
          Connexion : {link.map((k) => `${MEASURE_KINDS[k].icon} ${formatMeasure(k, last.v[k] as number)}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

export function SensorButton({ d }: { d: OwnedDevice }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ padding: "0.45rem 0.95rem", borderRadius: 7, background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: "0.82rem", whiteSpace: "nowrap", border: "none", cursor: "pointer" }}>
        📈 Historique
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
  // dernière valeur connue de chaque grandeur (le débit n'est pas dans toutes les lectures)
  const lastOf = (k: MeasureKind) => all?.find((m) => m.v[k] !== undefined);

  return (
    <div role="dialog" aria-modal="true" aria-label="Historique des mesures" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg2, var(--bg))", border: "1px solid var(--border)", borderRadius: 12, padding: "1.1rem", width: "min(860px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>📈 {d.deviceName || d.deviceId}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", color: "var(--text2)", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
        </div>
        {err && <p role="alert" style={{ color: "#f87171" }}>{err}</p>}
        {!err && all === null && <p style={{ color: "var(--text3)" }}>Chargement…</p>}
        {all && all.length === 0 && <p style={{ color: "var(--text3)" }}>Aucune mesure pour l&apos;instant. La carte envoie ses lectures toutes les heures (la première peu après son démarrage, une fois appairée).</p>}
        {all && last && (
          <>
            <div role="group" aria-label="Période" style={{ display: "flex", gap: 6, margin: "0.6rem 0 0.2rem" }}>
              {PERIODS.map((p) => (
                <button key={p.h} type="button" aria-pressed={hours === p.h} onClick={() => setHours(p.h)}
                  style={{ padding: "0.25rem 0.7rem", borderRadius: 999, fontSize: "0.76rem", cursor: "pointer", border: `1px solid ${hours === p.h ? "var(--accent)" : "var(--border)"}`, background: "var(--bg)", color: hours === p.h ? "var(--accent)" : "var(--text2)" }}>
                  {p.label}
                </button>
              ))}
            </div>
            {MEASURE_GROUPS.map((g) => {
              const gk = kindsOfGroup(kinds, g.id);
              if (gk.length === 0) return null;
              return (
                <section key={g.id} style={{ marginTop: "1rem", paddingTop: "0.8rem", borderTop: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.92rem" }}>{g.id === "env" ? "🌡" : "📶"} {g.label}</h3>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
                    {gk.map((k, i) => { const m = lastOf(k); return m ? (
                      <span key={k} style={{ fontSize: g.id === "env" && i === 0 ? "1.8rem" : "1rem", fontWeight: g.id === "env" && i === 0 ? 700 : 500, color: g.id === "env" && i === 0 ? "inherit" : "var(--text2)" }}>
                        {(g.id === "link" || i > 0) && MEASURE_KINDS[k].icon + " "}{formatMeasure(k, m.v[k] as number)}
                      </span>
                    ) : null; })}
                    <span style={{ color: "var(--text3)", fontSize: "0.76rem" }}>{fmtMeasureDate((lastOf(gk[0]) ?? last).t)}</span>
                  </div>
                  {g.id === "env" && (gk.includes("temp") || gk.includes("hum")) ? (
                    // 29/10/2026 : MÊME explorateur que le profil public (Graphique · Œuvre · Interprétation), sur l'historique PRIVÉ du propriétaire ; le tableau reste disponible en dessous
                    <>
                      <MeasuresExplorer deviceId={d.deviceId} sensorLabel={d.deviceName || d.deviceId} ownerName={d.artistName} kinds={kinds} owner />
                      {gk.some((k) => k !== "temp" && k !== "hum") && <MeasuresChart measures={shown} kinds={gk.filter((k) => k !== "temp" && k !== "hum")} />}
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--text2)" }}>Tableau des relevés ({hours >= 720 ? "31 jours" : hours >= 168 ? "7 jours" : "24 h"}, les plus récents d&apos;abord)</summary>
                        <MeasuresChart measures={shown} kinds={gk} showTable />
                      </details>
                    </>
                  ) : (
                    <MeasuresChart measures={shown} kinds={gk} showTable />
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
