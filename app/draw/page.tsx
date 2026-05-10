"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";
import { Device } from "@/lib/deviceStore";

function isKnownScreen(
  sid: string
): sid is keyof typeof SCREEN_PROFILES {
  return sid in SCREEN_PROFILES;
}

export default function DrawIndexPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [selectedScreen, setSelectedScreen] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((data) => {
        setDevices(data.devices ?? data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleGo = () => {
    if (!selectedDevice || !selectedScreen) return;
    router.push(`/draw/${selectedDevice.deviceId}/${selectedScreen}`);
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          color: "var(--text3)",
        }}
      >
        Chargement des devices...
      </div>
    );
  }

  if (!devices.length) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          gap: "1rem",
        }}
      >
        <div style={{ fontSize: "3rem" }}>📡</div>
        <p style={{ color: "var(--text2)" }}>Aucun device enregistré</p>
        <a
          href="/onboard"
          style={{
            padding: "0.7rem 1.5rem",
            borderRadius: "8px",
            background: "var(--accent)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          + Ajouter un device
        </a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1
        style={{
          fontSize: "1.75rem",
          fontWeight: 800,
          letterSpacing: "-0.02em",
          marginBottom: "0.25rem",
        }}
      >
        Dessiner
      </h1>
      <p style={{ color: "var(--text2)", marginBottom: "2rem" }}>
        Choisissez votre device et l&apos;écran cible.
      </p>

      <div style={{ marginBottom: "1.5rem" }}>
        <label
          style={{
            display: "block",
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--text2)",
            marginBottom: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          1 — Sélectionner un device
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {devices.map((d) => (
            <button
              key={d.deviceId}
              onClick={() => {
                setSelectedDevice(d);
                setSelectedScreen("");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: "0.875rem 1rem",
                borderRadius: "8px",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                border: `1px solid ${
                  selectedDevice?.deviceId === d.deviceId
                    ? "var(--accent)"
                    : "var(--border)"
                }`,
                background:
                  selectedDevice?.deviceId === d.deviceId
                    ? "rgba(124,107,255,0.08)"
                    : "var(--bg2)",
                color: "var(--text)",
                transition: "all 0.15s",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: d.lastPing ? "var(--success)" : "var(--text3)",
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ fontWeight: 600 }}>
                  {d.artistName || "Sans nom"}
                </div>
                <div
                  style={{
                    color: "var(--text3)",
                    fontSize: "0.75rem",
                    fontFamily: "JetBrains Mono, monospace",
                    marginTop: "0.1rem",
                  }}
                >
                  {d.mac} · {d.screens.length} écran(s)
                </div>
              </div>
              <div
                style={{
                  marginLeft: "auto",
                  fontSize: "0.75rem",
                  color: "var(--text3)",
                }}
              >
                {d.framesSent || 0} envois
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedDevice && (
        <div style={{ marginBottom: "2rem" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--text2)",
              marginBottom: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            2 — Sélectionner un écran
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {selectedDevice.screens.map((sid) => {
              if (!isKnownScreen(sid)) return null;
              const p = SCREEN_PROFILES[sid];

              return (
                <button
                  key={sid}
                  onClick={() => setSelectedScreen(sid)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                    padding: "0.875rem 1rem",
                    borderRadius: "8px",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    border: `1px solid ${
                      selectedScreen === sid
                        ? "var(--accent2)"
                        : "var(--border)"
                    }`,
                    background:
                      selectedScreen === sid
                        ? "rgba(255,107,157,0.08)"
                        : "var(--bg2)",
                    color: "var(--text)",
                    transition: "all 0.15s",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div
                      style={{
                        color: "var(--text3)",
                        fontSize: "0.75rem",
                        marginTop: "0.1rem",
                      }}
                    >
                      {p.description}
                    </div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    {p.colors.map((c) => (
                      <div
                        key={c}
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          background: c,
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={handleGo}
        disabled={!selectedDevice || !selectedScreen}
        style={{
          width: "100%",
          padding: "0.875rem",
          borderRadius: "8px",
          fontWeight: 700,
          background:
            !selectedDevice || !selectedScreen
              ? "var(--bg3)"
              : "var(--accent)",
          color:
            !selectedDevice || !selectedScreen
              ? "var(--text3)"
              : "#fff",
          border: "1px solid var(--border)",
          cursor:
            !selectedDevice || !selectedScreen
              ? "not-allowed"
              : "pointer",
          fontSize: "0.95rem",
          transition: "all 0.15s",
        }}
      >
        Ouvrir le canvas →
      </button>
    </div>
  );
}