"use client";
// Historique PUBLIC des capteurs d'un artiste : un sélecteur par appareil, puis le panneau partagé (UX jalon 4) : UNE lecture (cache de session, CDN 2 min), UNE période pour toutes les grandeurs.
import { useState } from "react";
import { MeasuresPanel } from "../../measures/MeasuresPanel";
import type { MeasureKind } from "@/lib/measures";

export interface SensorDevice { deviceId: string; deviceName?: string; sensors?: MeasureKind[] }

export default function ArtistSensors({ devices, ownerName }: { devices: SensorDevice[]; ownerName?: string }) {
  const list = devices.filter((d) => (d.sensors?.length ?? 0) > 0);
  const [sel, setSel] = useState(list[0]?.deviceId ?? "");
  if (list.length === 0) return <p style={{ color: "var(--text3)", textAlign: "center", padding: "2rem" }}>Aucun capteur public.</p>;
  const dev = list.find((d) => d.deviceId === sel) ?? list[0];
  const kinds = dev.sensors ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {list.length > 1 && (
        <div className="pod-pills" role="group" aria-label="Capteur">
          {list.map((d) => (
            <button key={d.deviceId} type="button" className="pod-pill" aria-pressed={d.deviceId === dev.deviceId} onClick={() => setSel(d.deviceId)}>
              {d.deviceName || d.deviceId}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: "0.8rem", color: "var(--text3)", overflowWrap: "anywhere" }}>{dev.deviceName || dev.deviceId} · <code>{dev.deviceId}</code></div>
      <MeasuresPanel key={dev.deviceId} deviceId={dev.deviceId} sensorLabel={dev.deviceName || dev.deviceId} ownerName={ownerName} kinds={kinds} />
    </div>
  );
}
