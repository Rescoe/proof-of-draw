"use client";
// app/my-devices/page.tsx  (ou remplace /admin/page.tsx si tu préfères)
// Panel utilisateur : liste ses écrans connectés, accès rapide au canvas

import { useEffect, useState } from "react";
import { Device } from "@/lib/deviceStore";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";

function timeSince(ts?: number): string {
  if (!ts) return "jamais";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `il y a ${s}s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  return `il y a ${Math.floor(s / 3600)}h`;
}

// Petit badge de statut : vert si ping < 10min, orange < 1h, gris sinon
function statusColor(lastPing?: number): string {
  if (!lastPing) return "var(--text3)";
  const s = Math.floor((Date.now() - lastPing) / 1000);
  if (s < 600)  return "#4ade80";   // vert  < 10min
  if (s < 3600) return "#fb923c";   // orange < 1h
  return "var(--text3)";            // gris
}

export default function MyDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res  = await fetch("/api/devices");
      const data = await res.json();
      // /api/devices renvoie { devices: [...] }
      setDevices(data.devices ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between", marginBottom: "2rem",
      }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
            Mes écrans
          </h1>
          <p style={{ color: "var(--text2)", marginTop: "0.25rem", fontSize: "0.85rem" }}>
            {devices.length} écran{devices.length !== 1 ? "s" : ""} connecté{devices.length !== 1 ? "s" : ""}
          </p>
        </div>
        <a
          href="/onboard"
          style={{
            padding: "0.6rem 1.25rem", borderRadius: "8px",
            background: "var(--accent)", color: "#fff",
            textDecoration: "none", fontWeight: 600, fontSize: "0.875rem",
          }}
        >
          + Ajouter un écran
        </a>
      </div>

      {loading ? (
        <div style={{ color: "var(--text3)", textAlign: "center", padding: "3rem" }}>
          Chargement…
        </div>
      ) : devices.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "4rem 2rem",
          border: "1px dashed var(--border)", borderRadius: "12px",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📡</div>
          <p style={{ color: "var(--text2)", marginBottom: "1rem" }}>
            Aucun écran enregistré pour l'instant.
          </p>
          <a href="/onboard" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
            Connecter mon premier écran →
          </a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {devices.map((d) => {
            const primaryScreen = d.screens?.[0];
            const drawUrl = primaryScreen ? `/draw/${d.deviceId}/${primaryScreen}` : null;

            return (
              <div
                key={d.deviceId}
                style={{
                  padding: "1.25rem 1.5rem", borderRadius: "10px",
                  border: "1px solid var(--border)", background: "var(--bg2)",
                }}
              >
                {/* Header card */}
                <div style={{
                  display: "flex", alignItems: "flex-start",
                  justifyContent: "space-between", gap: "1rem",
                }}>
                  <div>
                    {/* Nom + statut */}
                    <div style={{
                      display: "flex", alignItems: "center",
                      gap: "0.5rem", marginBottom: "0.25rem",
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: statusColor(d.lastPing),
                        flexShrink: 0,
                      }} />
                      <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                        {d.artistName || "Sans nom"}
                      </span>
                    </div>
                    {/* MAC */}
                    <div style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: "0.75rem", color: "var(--text3)",
                    }}>
                      {d.mac}
                    </div>
                  </div>

                  {/* Bouton Dessiner */}
                  {drawUrl && (
                    <a
                      href={drawUrl}
                      style={{
                        padding: "0.5rem 1.1rem", borderRadius: "6px",
                        background: "var(--accent)", color: "#fff",
                        textDecoration: "none", fontWeight: 600,
                        fontSize: "0.875rem", whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      ✏️ Dessiner
                    </a>
                  )}
                </div>

                {/* Stats */}
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "0.75rem", marginTop: "1rem",
                }}>
                  {[
                    { label: "Frames envoyées", value: d.framesSent ?? 0 },
                    { label: "Dernier ping",    value: timeSince(d.lastPing) },
                    { label: "En ligne depuis", value: timeSince(d.createdAt) },
                  ].map((s) => (
                    <div key={s.label} style={{
                      padding: "0.75rem", borderRadius: "8px",
                      background: "var(--bg3)",
                    }}>
                      <div style={{
                        color: "var(--text3)", fontSize: "0.68rem",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                      }}>
                        {s.label}
                      </div>
                      <div style={{
                        fontWeight: 700, fontSize: "0.95rem", marginTop: "0.25rem",
                        fontFamily: typeof s.value === "number"
                          ? "JetBrains Mono, monospace" : undefined,
                      }}>
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Écrans compatibles */}
                <div style={{
                  marginTop: "1rem", display: "flex",
                  gap: "0.5rem", flexWrap: "wrap",
                }}>
                  {d.screens?.map((sid) => {
                    const p = SCREEN_PROFILES[sid];
                    if (!p) return null;
                    return (
                      <a
                        key={sid}
                        href={`/draw/${d.deviceId}/${sid}`}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.5rem",
                          padding: "0.3rem 0.75rem", borderRadius: "6px",
                          border: "1px solid var(--border)", background: "var(--bg)",
                          textDecoration: "none", color: "var(--text2)",
                          fontSize: "0.78rem",
                        }}
                      >
                        {p.name}
                        <div style={{ display: "flex", gap: 3 }}>
                          {p.colors.map((c) => (
                            <div
                              key={c}
                              style={{
                                width: 8, height: 8, borderRadius: 2,
                                background: c,
                                border: "1px solid rgba(255,255,255,0.1)",
                              }}
                            />
                          ))}
                        </div>
                      </a>
                    );
                  })}
                </div>

                {/* Device ID (debug) */}
                <div style={{
                  marginTop: "0.75rem",
                  color: "var(--text3)", fontSize: "0.68rem",
                  fontFamily: "JetBrains Mono, monospace",
                }}>
                  ID: {d.deviceId}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}