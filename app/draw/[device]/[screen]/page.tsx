"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import { useCanvasDrawing, Tool } from "@/hooks/useCanvasDrawing";
import { OwnedDevice } from "@/lib/deviceStore";
import { canvasToScreenPayload } from "@/lib/canvasToScreen";


export default function DrawCanvasPage() {
  const params = useParams();
  const router = useRouter();

  const rawDevice = params.device;
  const rawScreen = params.screen;

  const deviceId = Array.isArray(rawDevice) ? rawDevice[0] : rawDevice;
  const screenId = (Array.isArray(rawScreen) ? rawScreen[0] : rawScreen) as ScreenId;

  const profile = SCREEN_PROFILES[screenId];
  const [device, setDevice] = useState<OwnedDevice | null>(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "error"; msg: string } | null>(null);

  const {
    canvasRef, tool, setTool, brushSize, setBrushSize,
    activeColor, setActiveColor, clearCanvas, getBase64, undo, canUndo
  } = useCanvasDrawing({
    width: profile?.width ?? 128,
    height: profile?.height ?? 64,
    colors: profile?.colors ?? ["#000000", "#FFFFFF"],
    pixelRatio: profile?.pixelRatio ?? 2,
  });

  useEffect(() => {
    if (!profile || !deviceId || !screenId) {
      router.push("/draw");
      return;
    }

    let cancelled = false;

    async function loadDevice(attempt = 0) {
      try {
        // ✅ ?mine=1 → vue privée avec deviceId, screens, etc.
        const res = await fetch("/api/devices?mine=1");
        const data = await res.json();
        if (cancelled) return;

        const d = (data.devices ?? []).find(
          (d: OwnedDevice) => String(d.deviceId).trim() === String(deviceId).trim()
        );

        if (!d || !d.screens?.includes(screenId)) {
          if (attempt < 5 && !cancelled) {
            setTimeout(() => loadDevice(attempt + 1), 1000);
          } else if (!cancelled) {
            router.push("/draw");
          }
          return;
        }

        setDevice(d);
      } catch (err) {
        console.error("[LOAD DEVICE]", err);
        if (!cancelled) router.push("/draw");
      }
    }

    loadDevice();
    return () => { cancelled = true; };
  }, [deviceId, screenId, profile, router]);


  const handleSend = useCallback(async () => {
    if (!device || sending || !canvasRef.current) return;

    setSending(true);
    setStatus(null);

    try {
      const payload = canvasToScreenPayload(canvasRef.current, screenId);

      const body =
        screenId === "eink29bwr"
          ? {
              screen: screenId,
              deviceId,
              black: (payload as any).black,
              red: (payload as any).red,
            }
          : {
              screen: screenId,
              deviceId,
              buffer: (payload as any).buffer,
            };

      const res = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      setStatus({ type: "ok", msg: `✓ envoyé à ${device.artistName || deviceId}` });
    } catch (err: any) {
      console.error("[SEND ERROR]", err);
      setStatus({ type: "error", msg: err.message || "Erreur réseau" });
    } finally {
      setSending(false);
      setTimeout(() => setStatus(null), 4000);
    }
  }, [device, sending, canvasRef, screenId, deviceId]);


  if (!profile) return null;

  const maxW = Math.min(
    profile.width * profile.pixelRatio,
    typeof window !== "undefined" ? window.innerWidth - 80 : 900
  );
  const scale = maxW / profile.width;
  const displayW = Math.floor(profile.width * scale);
  const displayH = Math.floor(profile.height * scale);

  const tools: { id: Tool; icon: string; label: string }[] = [
    { id: "brush", icon: "✏️", label: "Pinceau" },
    { id: "eraser", icon: "⬜", label: "Gomme" },
    { id: "fill", icon: "🪣", label: "Remplir" },
  ];

  const brushSizes = [1, 2, 4, 6, 10];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 57px)", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "1rem", padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--border)", background: "var(--bg2)", flexShrink: 0,
        flexWrap: "wrap"
      }}>
        <button onClick={() => router.push("/draw")} style={{
          background: "none", border: "none", color: "var(--text3)", cursor: "pointer",
          fontSize: "1.2rem", padding: 0, lineHeight: 1
        }}>←</button>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
            {device?.artistName || deviceId}
          </div>
          <div style={{ color: "var(--text3)", fontSize: "0.7rem", fontFamily: "JetBrains Mono, monospace" }}>
            {profile.name} · {profile.width}×{profile.height}
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {status && (
            <div style={{
              padding: "0.35rem 0.75rem", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 500,
              background: status.type === "ok" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
              color: status.type === "ok" ? "var(--success)" : "var(--error)",
              border: `1px solid ${status.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
              maxWidth: 300
            }}>
              {status.msg}
            </div>
          )}
          <button onClick={undo} disabled={!canUndo} style={{
            padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border)",
            background: "var(--bg3)", color: canUndo ? "var(--text)" : "var(--text3)",
            cursor: canUndo ? "pointer" : "not-allowed", fontSize: "0.8rem"
          }}>↩ Annuler</button>
          <button onClick={clearCanvas} style={{
            padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border)",
            background: "var(--bg3)", color: "var(--text2)", cursor: "pointer", fontSize: "0.8rem"
          }}>🗑 Effacer</button>
          <button onClick={handleSend} disabled={sending} style={{
            padding: "0.5rem 1.25rem", borderRadius: "6px", border: "none",
            background: sending ? "var(--bg3)" : "var(--accent)",
            color: sending ? "var(--text3)" : "#fff",
            cursor: sending ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.875rem"
          }}>
            {sending ? "Envoi..." : "📡 Envoyer"}
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left toolbar */}
        <div style={{
          width: 64, display: "flex", flexDirection: "column", alignItems: "center",
          padding: "1rem 0.5rem", gap: "0.5rem", borderRight: "1px solid var(--border)",
          background: "var(--bg2)", flexShrink: 0, overflowY: "auto"
        }}>
          {tools.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={t.label}
              style={{
                width: 44, height: 44, borderRadius: "8px", border: "none", cursor: "pointer",
                background: tool === t.id ? "var(--accent)" : "transparent",
                fontSize: "1.2rem", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s"
              }}>
              {t.icon}
            </button>
          ))}

          <div style={{ width: "80%", height: 1, background: "var(--border)", margin: "0.25rem 0" }} />

          {brushSizes.map(s => (
            <button key={s} onClick={() => setBrushSize(s)} title={`${s}px`}
              style={{
                width: 44, height: 44, borderRadius: "8px", border: "none", cursor: "pointer",
                background: brushSize === s ? "var(--bg3)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s"
              }}>
              <div style={{
                width: Math.max(4, Math.min(s * 2.5, 28)), height: Math.max(4, Math.min(s * 2.5, 28)),
                borderRadius: "50%", background: brushSize === s ? "var(--text)" : "var(--text3)"
              }} />
            </button>
          ))}
        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
            <div style={{
              border: "2px solid var(--border)", borderRadius: "4px",
              boxShadow: "0 0 0 1px rgba(124,107,255,0.3), 0 8px 32px rgba(0,0,0,0.5)"
            }}>
              <canvas
                ref={canvasRef}
                style={{
                  display: "block",
                  width: displayW, height: displayH,
                  imageRendering: "pixelated",
                  cursor: tool === "brush" ? "crosshair" : tool === "eraser" ? "cell" : "copy"
                }}
              />
            </div>
            <div style={{ color: "var(--text3)", fontSize: "0.7rem", fontFamily: "JetBrains Mono, monospace" }}>
              {profile.width}×{profile.height}px · affiché {displayW}×{displayH}px
            </div>
          </div>
        </div>

        {/* Right: color palette */}
        <div style={{
          width: 60, display: "flex", flexDirection: "column", alignItems: "center",
          padding: "1rem 0.5rem", gap: "0.5rem", borderLeft: "1px solid var(--border)",
          background: "var(--bg2)", flexShrink: 0
        }}>
          <div style={{ fontSize: "0.6rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>
            Coul.
          </div>
          {profile.colors.map((c, i) => (
            <button key={c} onClick={() => setActiveColor(c)} title={profile.colorLabels[i]}
              style={{
                width: 36, height: 36, borderRadius: "6px", border: "none", cursor: "pointer",
                background: c,
                boxShadow: activeColor === c
                  ? `0 0 0 2px var(--bg2), 0 0 0 4px var(--accent)`
                  : c === "#FFFFFF" ? "0 0 0 1px rgba(255,255,255,0.3)" : "none",
                transition: "box-shadow 0.15s"
              }}
            />
          ))}
          <div style={{ width: "80%", height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
          <div style={{
            width: 36, height: 36, borderRadius: "6px",
            background: activeColor, border: "2px solid var(--accent)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)"
          }} title="Couleur active" />
        </div>
      </div>
    </div>
  );
}