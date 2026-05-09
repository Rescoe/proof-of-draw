"use client";

import { useEffect, useState } from "react";
import { Device } from "@/lib/deviceStore";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";

function timeSince(ts?: number): string {
  if (!ts) return "jamais";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `il y a ${s}s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  return `il y a ${Math.floor(s / 3600)}h`;
}

export default function AdminPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState<string | null>(null);

  const load = () => {
    fetch("/api/devices")
      .then(r => r.json())
      .then(data => { setDevices(data); setLoading(false); });
  };

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const ping = async (d: Device) => {
    setPinging(d.id);
    await fetch("/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: d.id }),
    });
    load();
    setPinging(null);
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Admin</h1>
          <p style={{ color: "var(--text2)", marginTop: "0.25rem" }}>{devices.length} device(s) · Rafraîchissement auto 10s</p>
        </div>
        <a href="/onboard" style={{
          padding: "0.6rem 1.25rem", borderRadius: "8px", background: "var(--accent)",
          color: "#fff", textDecoration: "none", fontWeight: 600, fontSize: "0.875rem"
        }}>
          + Nouveau
        </a>
      </div>

      {loading ? (
        <div style={{ color: "var(--text3)", textAlign: "center", padding: "3rem" }}>Chargement...</div>
      ) : !devices.length ? (
        <div style={{ textAlign: "center", padding: "4rem 2rem", border: "1px dashed var(--border)", borderRadius: "12px" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📡</div>
          <p style={{ color: "var(--text2)" }}>Aucun device enregistré</p>
          <a href="/onboard" style={{ color: "var(--accent)", textDecoration: "none" }}>Ajouter votre premier device →</a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {devices.map(d => (
            <div key={d.id} style={{
              padding: "1.25rem 1.5rem", borderRadius: "10px",
              border: "1px solid var(--border)", background: "var(--bg2)"
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.lastPing ? "var(--success)" : "var(--text3)" }} />
                    <span style={{ fontWeight: 700, fontSize: "1rem" }}>{d.name}</span>
                  </div>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.8rem", color: "var(--text3)" }}>
                    {d.ip}:{d.port}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    onClick={() => ping(d)}
                    disabled={pinging === d.id}
                    style={{
                      padding: "0.4rem 0.875rem", borderRadius: "6px", border: "1px solid var(--border)",
                      background: "var(--bg3)", color: "var(--text2)", cursor: "pointer", fontSize: "0.8rem"
                    }}>
                    {pinging === d.id ? "Ping..." : "📡 Ping"}
                  </button>
                  <a href={`/draw/${d.id}/${d.screens[0]}`} style={{
                    padding: "0.4rem 0.875rem", borderRadius: "6px", border: "none",
                    background: "var(--accent)", color: "#fff", textDecoration: "none",
                    fontSize: "0.8rem", fontWeight: 600
                  }}>
                    ✏️ Dessiner
                  </a>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem", marginTop: "1rem" }}>
                {[
                  { label: "Frames envoyées", value: d.framesSent || 0 },
                  { label: "Dernier ping", value: timeSince(d.lastPing) },
                  { label: "Dernier dessin", value: timeSince(d.lastDraw) },
                ].map(s => (
                  <div key={s.label} style={{ padding: "0.75rem", borderRadius: "8px", background: "var(--bg3)" }}>
                    <div style={{ color: "var(--text3)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                    <div style={{ fontWeight: 700, fontSize: "1rem", marginTop: "0.25rem", fontFamily: typeof s.value === "number" ? "JetBrains Mono, monospace" : undefined }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {d.screens.map(sid => {
                  const p = SCREEN_PROFILES[sid];
                  return (
                    <a key={sid} href={`/draw/${d.id}/${sid}`} style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.3rem 0.75rem", borderRadius: "6px",
                      border: "1px solid var(--border)", background: "var(--bg)",
                      textDecoration: "none", color: "var(--text2)", fontSize: "0.78rem"
                    }}>
                      {p.name}
                      <div style={{ display: "flex", gap: 3 }}>
                        {p.colors.map(c => (
                          <div key={c} style={{ width: 8, height: 8, borderRadius: 2, background: c, border: "1px solid rgba(255,255,255,0.1)" }} />
                        ))}
                      </div>
                    </a>
                  );
                })}
              </div>

              <div style={{ marginTop: "0.75rem", color: "var(--text3)", fontSize: "0.7rem", fontFamily: "JetBrains Mono, monospace" }}>
                ID: {d.id}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Security status */}
      <div style={{ marginTop: "3rem", padding: "1.25rem", borderRadius: "10px", border: "1px dashed var(--border)", background: "var(--bg2)" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.75rem", fontSize: "0.875rem", color: "var(--warning)" }}>
          ⚠ Sécurité MVP (mockée)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {[
            { fn: "checkAuth()", status: "mock", desc: "Retourne toujours true" },
            { fn: "rateLimit(15min)", status: "mock", desc: "Retourne toujours true" },
            { fn: "quotaDaily(1)", status: "mock", desc: "Retourne toujours true" },
          ].map(s => (
            <div key={s.fn} style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", alignItems: "center" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text2)", minWidth: 160 }}>{s.fn}</span>
              <span style={{ padding: "0.1rem 0.5rem", borderRadius: "4px", background: "rgba(251,191,36,0.15)", color: "var(--warning)", fontSize: "0.7rem" }}>MOCK</span>
              <span style={{ color: "var(--text3)" }}>{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
