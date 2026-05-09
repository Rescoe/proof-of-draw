"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SCREEN_PROFILES, SCREEN_IDS } from "@/lib/screenProfiles";

export default function OnboardPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ip, setIp] = useState(process.env.NEXT_PUBLIC_DEV_IP || "192.168.1.100");
  const [port, setPort] = useState("80");
  const [screens, setScreens] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const toggleScreen = (id: string) => {
    setScreens(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!name || !ip || !port || !screens.length) {
      setError("Tous les champs sont requis + au moins 1 écran.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ip, port: Number(port), screens }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`Device "${name}" enregistré ! ID: ${data.device.id}`);
      setTimeout(() => router.push("/draw"), 1500);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          + Nouveau device
        </h1>
        <p style={{ color: "var(--text2)", marginTop: "0.25rem" }}>
          Enregistrez votre ESP8266 pour commencer à envoyer des dessins.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Device Name */}
        <div style={{ marginBottom: "1.25rem" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text2)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Nom du device
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="ex: ESP-Bureau, ESP-Salon..."
            style={{
              width: "100%", padding: "0.7rem 1rem", borderRadius: "8px",
              border: "1px solid var(--border)", background: "var(--bg2)",
              color: "var(--text)", fontSize: "0.95rem", outline: "none",
            }}
          />
        </div>

        {/* IP */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text2)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Adresse IP
            </label>
            <input
              value={ip}
              onChange={e => setIp(e.target.value)}
              placeholder="192.168.1.100"
              style={{
                width: "100%", padding: "0.7rem 1rem", borderRadius: "8px",
                border: "1px solid var(--border)", background: "var(--bg2)",
                color: "var(--text)", fontSize: "0.95rem", outline: "none",
                fontFamily: "JetBrains Mono, monospace"
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text2)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Port
            </label>
            <input
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="80"
              style={{
                width: 90, padding: "0.7rem 1rem", borderRadius: "8px",
                border: "1px solid var(--border)", background: "var(--bg2)",
                color: "var(--text)", fontSize: "0.95rem", outline: "none",
                fontFamily: "JetBrains Mono, monospace"
              }}
            />
          </div>
        </div>

        {/* Screens */}
        <div style={{ marginBottom: "2rem" }}>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text2)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Écrans connectés
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {SCREEN_IDS.map(id => {
              const profile = SCREEN_PROFILES[id];
              const checked = screens.includes(id);
              return (
                <label key={id} style={{
                  display: "flex", alignItems: "center", gap: "1rem",
                  padding: "0.875rem 1rem", borderRadius: "8px", cursor: "pointer",
                  border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                  background: checked ? "rgba(124,107,255,0.08)" : "var(--bg2)",
                  transition: "all 0.15s"
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScreen(id)}
                    style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{profile.name}</div>
                    <div style={{ color: "var(--text3)", fontSize: "0.75rem", marginTop: "0.1rem" }}>
                      {profile.description} · {profile.colors.length} couleurs
                    </div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
                    {profile.colors.map(c => (
                      <div key={c} style={{
                        width: 14, height: 14, borderRadius: "3px",
                        background: c, border: "1px solid rgba(255,255,255,0.15)"
                      }} />
                    ))}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--error)", marginBottom: "1rem", fontSize: "0.875rem" }}>
            ⚠ {error}
          </div>
        )}
        {success && (
          <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--success)", marginBottom: "1rem", fontSize: "0.875rem" }}>
            ✓ {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%", padding: "0.875rem", borderRadius: "8px", fontWeight: 700,
            background: loading ? "var(--bg3)" : "var(--accent)", color: "#fff",
            border: "none", cursor: loading ? "not-allowed" : "pointer", fontSize: "0.95rem",
            transition: "opacity 0.15s", opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "Enregistrement..." : "Enregistrer le device →"}
        </button>
      </form>
    </div>
  );
}
