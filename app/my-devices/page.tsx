"use client";

import { useEffect, useState } from "react";
import { OwnedDevice } from "@/lib/deviceStore";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";

function isKnownScreen(sid: string): sid is keyof typeof SCREEN_PROFILES {
  return sid in SCREEN_PROFILES;
}

function timeSince(ts?: number): string {
  if (!ts) return "jamais";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `il y a ${s}s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  return `il y a ${Math.floor(s / 3600)}h`;
}

function statusColor(isOnline: boolean, lastPing?: number): string {
  if (isOnline) return "#4ade80";
  if (!lastPing) return "var(--text3)";
  return Math.floor((Date.now() - lastPing) / 1000) < 3600 ? "#fb923c" : "var(--text3)";
}

interface PublicDevice {
  deviceId: string;
  artistName: string;
  screens: string[];
  isOnline: boolean;
}

export default function MyDevicesPage() {
  const [tab, setTab]             = useState<"mine" | "shared">("mine");
  const [devices, setDevices]     = useState<OwnedDevice[]>([]);
  const [publicDevices, setPublicDevices] = useState<PublicDevice[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadingPub, setLoadingPub] = useState(false);
  const [rotating,  setRotating]  = useState<string | null>(null);
  const [newCode,   setNewCode]   = useState<Record<string, string>>({});
  const [copyMsg,   setCopyMsg]   = useState<Record<string, string>>({});
  const [toggling,  setToggling]  = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/devices?mine=1", { cache: "no-store" });
      if (!res.ok) throw new Error("Erreur chargement devices");
      const data = await res.json();
      setDevices(data.devices ?? []);
    } catch (err) {
      console.error("[my-devices] load failed", err);
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  const loadPublic = async () => {
    setLoadingPub(true);
    try {
      const res  = await fetch("/api/public-screens", { cache: "no-store" });
      const data = await res.json();
      setPublicDevices(data.devices ?? []);
    } catch {
      setPublicDevices([]);
    } finally {
      setLoadingPub(false);
    }
  };

  useEffect(() => {
    load();
    loadPublic();
  }, []);

  async function handleRotateCode(deviceId: string) {
    if (!confirm("Générer un nouveau code ? L'ancien ne fonctionnera plus.")) return;
    setRotating(deviceId);

    try {
      const res = await fetch("/api/devices/rotate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });

      const data = await res.json();
      if (data.ok && data.pairCode) {
        setNewCode((p) => ({ ...p, [deviceId]: data.pairCode }));
      } else {
        alert(data.error ?? "Erreur");
      }
    } catch (err) {
      console.error("[my-devices] rotate-code failed", err);
      alert("Erreur réseau");
    } finally {
      setRotating(null);
    }
  }

  async function handleTogglePublic(deviceId: string, current: boolean) {
    setToggling(deviceId);
    try {
      await fetch(`/api/my-devices/${deviceId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !current }),
      });
      await load();
    } catch {
      alert("Erreur réseau");
    } finally {
      setToggling(null);
    }
  }

  async function copyCode(deviceId: string, code: string) {
    await navigator.clipboard.writeText(code);
    setCopyMsg((p) => ({ ...p, [deviceId]: "Copié !" }));
    setTimeout(() => {
      setCopyMsg((p) => ({ ...p, [deviceId]: "" }));
    }, 2000);
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
            Mes écrans
          </h1>
          <p style={{ color: "var(--text2)", marginTop: "0.25rem", fontSize: "0.85rem" }}>
            {devices.length} écran{devices.length !== 1 ? "s" : ""} connecté
            {devices.length !== 1 ? "s" : ""}
            {" · "}
            <button
              onClick={load}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: "0.85rem",
                padding: 0,
              }}
            >
              Actualiser
            </button>
          </p>
        </div>

        <a
          href="/onboard"
          style={{
            padding: "0.6rem 1.25rem",
            borderRadius: "8px",
            background: "var(--accent)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.875rem",
          }}
        >
          + Ajouter un écran
        </a>
      </div>

      {/* ── Onglets ── */}
      <div style={{
        display: "flex", gap: 0, marginBottom: "1.5rem",
        borderBottom: "1px solid var(--border)",
      }}>
        {([
          { key: "mine",   label: "Mes ESP" },
          { key: "shared", label: `ESP disponibles${publicDevices.length ? ` (${publicDevices.length})` : ""}` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "0.6rem 1.2rem",
              background: "none", border: "none",
              borderBottom: `2px solid ${tab === key ? "var(--accent)" : "transparent"}`,
              color: tab === key ? "var(--accent)" : "var(--text3)",
              fontWeight: tab === key ? 700 : 500,
              fontSize: "0.875rem", cursor: "pointer",
              transition: "color 0.12s, border-color 0.12s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Onglet : ESP disponibles ── */}
      {tab === "shared" && (
        <div>
          {loadingPub ? (
            <div style={{ color: "var(--text3)", textAlign: "center", padding: "2rem" }}>
              Chargement…
            </div>
          ) : publicDevices.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "3rem 2rem",
              border: "1px dashed var(--border)", borderRadius: 12,
            }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📡</div>
              <p style={{ color: "var(--text2)", marginBottom: "0.5rem" }}>
                Aucun ESP partagé pour l'instant.
              </p>
              <p style={{ color: "var(--text3)", fontSize: "0.8rem" }}>
                Les artistes qui activent le prêt public sur leurs ESP apparaissent ici.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {publicDevices.map((pub) => (
                <div key={pub.deviceId} style={{
                  padding: "1rem 1.25rem",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg2)",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
                  flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: pub.isOnline ? "#4ade80" : "var(--text3)",
                    }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                        {pub.artistName}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text3)", fontFamily: "monospace" }}>
                        {pub.screens.join(", ")}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {pub.screens.map((sid) => (
                      <a
                        key={sid}
                        href={`/draw/${pub.deviceId}/${sid}`}
                        style={{
                          padding: "0.45rem 1rem",
                          borderRadius: 7,
                          background: pub.isOnline ? "var(--accent)" : "var(--bg3)",
                          color: pub.isOnline ? "#fff" : "var(--text3)",
                          textDecoration: "none",
                          fontWeight: 600, fontSize: "0.8rem",
                          whiteSpace: "nowrap",
                          border: `1px solid ${pub.isOnline ? "transparent" : "var(--border)"}`,
                          pointerEvents: pub.isOnline ? "auto" : "none",
                          opacity: pub.isOnline ? 1 : 0.5,
                        }}
                        title={pub.isOnline ? `Dessiner sur ${sid}` : "ESP hors ligne"}
                      >
                        {isKnownScreen(sid) ? SCREEN_PROFILES[sid].name : sid}
                        {pub.isOnline ? " ✏️" : " 🔴"}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Onglet : Mes ESP ── */}
      {tab === "mine" && (loading ? (
        <div style={{ color: "var(--text3)", textAlign: "center", padding: "3rem" }}>
          Chargement…
        </div>
      ) : devices.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "4rem 2rem",
            border: "1px dashed var(--border)",
            borderRadius: "12px",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📡</div>
          <p style={{ color: "var(--text2)", marginBottom: "1rem" }}>
            Aucun écran associé à cette session.
          </p>
          <a
            href="/onboard"
            style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
          >
            Connecter mon premier écran →
          </a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {devices.map((d) => {
            const primaryScreen = d.screens?.[0];
            const drawUrl = primaryScreen ? `/draw/${d.deviceId}/${primaryScreen}` : null;
            const displayCode = newCode[d.deviceId];

            return (
              <div
                key={d.deviceId}
                style={{
                  padding: "1.25rem 1.5rem",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "var(--bg2)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.25rem",
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: statusColor(d.isOnline, d.lastPing),
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                        {d.artistName || "Sans nom"}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: "0.7rem",
                        color: "var(--text3)",
                      }}
                    >
                      {d.firmware ?? "firmware inconnu"}
                    </div>
                  </div>

                  {drawUrl && (
                    <a
                      href={drawUrl}
                      style={{
                        padding: "0.5rem 1.1rem",
                        borderRadius: "6px",
                        background: "var(--accent)",
                        color: "#fff",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      ✏️ Dessiner
                    </a>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "0.75rem",
                    marginTop: "1rem",
                  }}
                >
                  {[
                    { label: "Frames envoyées", value: d.framesSent ?? 0 },
                    { label: "Dernier ping", value: timeSince(d.lastPing) },
                    { label: "En ligne depuis", value: timeSince(d.createdAt) },
                  ].map((s) => (
                    <div
                      key={s.label}
                      style={{
                        padding: "0.75rem",
                        borderRadius: "8px",
                        background: "var(--bg3)",
                      }}
                    >
                      <div
                        style={{
                          color: "var(--text3)",
                          fontSize: "0.68rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {s.label}
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "0.95rem",
                          marginTop: "0.25rem",
                          fontFamily:
                            typeof s.value === "number"
                              ? "JetBrains Mono, monospace"
                              : undefined,
                        }}
                      >
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {d.screens?.map((sid) => {
                    if (!isKnownScreen(sid)) return null;
                    const p = SCREEN_PROFILES[sid];

                    return (
                      <a
                        key={sid}
                        href={`/draw/${d.deviceId}/${sid}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.3rem 0.75rem",
                          borderRadius: "6px",
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          textDecoration: "none",
                          color: "var(--text2)",
                          fontSize: "0.78rem",
                        }}
                      >
                        {p.name}
                        <div style={{ display: "flex", gap: 3 }}>
                          {p.colors.map((c: string) => (
                            <div
                              key={c}
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 2,
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

                <div
                  style={{
                    marginTop: "1.25rem",
                    paddingTop: "1rem",
                    borderTop: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Sécurité
                  </div>

                  {displayCode && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.6rem 0.9rem",
                        borderRadius: "6px",
                        background: "var(--bg3)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "1rem",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          color: "#4ade80",
                        }}
                      >
                        {displayCode}
                      </span>
                      <button
                        onClick={() => copyCode(d.deviceId, displayCode)}
                        style={{
                          marginLeft: "auto",
                          fontSize: "0.75rem",
                          padding: "0.3rem 0.7rem",
                          borderRadius: "4px",
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: "var(--text2)",
                          cursor: "pointer",
                        }}
                      >
                        {copyMsg[d.deviceId] || "Copier"}
                      </button>
                      <span style={{ fontSize: "0.72rem", color: "var(--text3)" }}>
                        Nouveau code — à noter !
                      </span>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      onClick={() => handleRotateCode(d.deviceId)}
                      disabled={rotating === d.deviceId}
                      style={{
                        padding: "0.4rem 0.9rem",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text2)",
                        fontSize: "0.78rem",
                        cursor: "pointer",
                        opacity: rotating === d.deviceId ? 0.5 : 1,
                      }}
                    >
                      🔄 {rotating === d.deviceId ? "En cours…" : "Nouveau code de jumelage"}
                    </button>

                    <a
                      href="/onboard"
                      style={{
                        padding: "0.4rem 0.9rem",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text2)",
                        fontSize: "0.78rem",
                        textDecoration: "none",
                      }}
                    >
                      📲 Connecter un autre appareil
                    </a>
                  </div>

                  <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: "0.25rem" }}>
                    Pour reprendre le contrôle depuis un autre appareil, utilisez{" "}
                    <a href="/onboard" style={{ color: "var(--accent)" }}>
                      /onboard
                    </a>{" "}
                    avec le code affiché sur l&apos;écran.
                  </p>
                </div>

                {/* Axe 2 : Mode prêt public */}
                <div
                  style={{
                    marginTop: "1rem",
                    paddingTop: "1rem",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "1rem",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Prêt public
                      </div>
                      <p style={{ fontSize: "0.72rem", color: "var(--text3)", marginTop: "0.2rem", marginBottom: 0 }}>
                        {d.publicMode
                          ? "D'autres artistes peuvent dessiner sur cet ESP."
                          : "Seul vous pouvez dessiner sur cet ESP."}
                      </p>
                    </div>
                    <button
                      onClick={() => handleTogglePublic(d.deviceId, !!d.publicMode)}
                      disabled={toggling === d.deviceId}
                      style={{
                        padding: "0.4rem 1rem",
                        borderRadius: "6px",
                        border: `1px solid ${d.publicMode ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                        background: d.publicMode ? "rgba(74,222,128,0.1)" : "var(--bg)",
                        color: d.publicMode ? "#4ade80" : "var(--text2)",
                        fontSize: "0.78rem",
                        cursor: "pointer",
                        fontWeight: 600,
                        flexShrink: 0,
                        opacity: toggling === d.deviceId ? 0.5 : 1,
                      }}
                    >
                      {toggling === d.deviceId ? "…" : d.publicMode ? "✓ Public" : "Privé"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}