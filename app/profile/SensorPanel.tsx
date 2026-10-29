"use client";
// app/profile/SensorPanel.tsx — mesures d'un appareil (propriétaire) : résumé sur la carte + historique (jusqu'à 31 jours).
// Deux parties SÉPARÉES : « Température et humidité » (environnement) et « Connexion de la carte » (signal, latence, débit).
// Quota Redis : le résumé vient de GET /api/devices (1 LINDEX par capteur) ; l'historique = UNE lecture (LRANGE) à l'ouverture, aucune actualisation automatique.

import { useEffect, useMemo, useState } from "react";
import type { OwnedDevice } from "@/lib/deviceStore";
import { MEASURE_GROUPS, MEASURE_KINDS, formatMeasure, kindsOfGroup, measureKindsOf, type MeasureKind } from "@/lib/measures";
import { fmtMeasureDate } from "../MeasuresChart";
import { MeasuresPanel } from "../measures/MeasuresPanel";
import { useDeviceMeasures } from "../measures/useDeviceMeasures";
import { useDialog } from "../ui/useDialog";

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
  const kinds = useMemo(() => measureKindsOf(d), [d]);
  // UNE lecture par ouverture (cache de session partagé avec MeasuresPanel : aucune seconde requête) ; jamais relancée par un re-rendu du parent (quota Redis)
  const data = useDeviceMeasures(d.deviceId, { owner: true });
  const all = data.state === "ready" ? data.measures : null;

  const dialogRef = useDialog(true, onClose);   // Échap, focus piégé et rendu, défilement verrouillé (app/ui/useDialog.ts)

  const last = all?.[0];
  // dernière valeur connue de chaque grandeur (le débit n'est pas dans toutes les lectures)
  const lastOf = (k: MeasureKind) => all?.find((m) => m.v[k] !== undefined);

  return (
    <div className="pod-dialog-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="pod-dialog" role="dialog" aria-modal="true" aria-label="Historique des mesures" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="pod-dialog__head">
          <h2 className="pod-dialog__title">📈 {d.deviceName || d.deviceId}</h2>
          <button type="button" className="pod-dialog__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {last && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "0.4rem 0 0.9rem" }}>
            {MEASURE_GROUPS.map((g) => {
              const gk = kindsOfGroup(kinds, g.id).filter((k) => lastOf(k));
              if (gk.length === 0) return null;
              return (
                <div key={g.id} style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
                  {gk.map((k, i) => (
                    <span key={k} style={{ fontSize: g.id === "env" && i === 0 ? "1.6rem" : "0.95rem", fontWeight: g.id === "env" && i === 0 ? 700 : 500, color: g.id === "env" && i === 0 ? "inherit" : "var(--text2)" }}>
                      {(g.id === "link" || i > 0) && MEASURE_KINDS[k].icon + " "}{formatMeasure(k, lastOf(k)!.v[k] as number)}
                    </span>
                  ))}
                  <span style={{ color: "var(--text3)", fontSize: "0.76rem" }}>{fmtMeasureDate(lastOf(gk[0])!.t)}</span>
                </div>
              );
            })}
          </div>
        )}
        <MeasuresPanel deviceId={d.deviceId} sensorLabel={d.deviceName || d.deviceId} ownerName={d.artistName} kinds={kinds} owner showTable measuresPublic={d.measuresPublic !== false} />
      </div>
    </div>
  );
}
