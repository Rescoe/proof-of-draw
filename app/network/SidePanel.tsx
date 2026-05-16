"use client";

import { useEffect, useRef, useState } from "react";
import type { NetworkDevice, NetworkPreview } from "@/lib/networkSnapshot";
import { eink29bwrToCanvas, eink27bwToCanvas, oled096ToCanvas } from "@/lib/screenToCanvas";

// ─── Types locaux (évite d'importer des modules serveur) ─────────────────────

interface MinedBlock {
  blockIndex: number;
  blockHash: string;
  artistName: string;
  poolScreen: string;
  minedAt: number;
  drawScore: number;
  validatorIds: string[];
  score: number;
  displayTime: number;
}

interface BlockImagePayload {
  screen: string;
  black?: string;
  red?: string;
  buffer?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}j`;
}

function blockImageToPreview(img: BlockImagePayload): NetworkPreview {
  if (img.screen === "eink29bwr" && img.black) {
    return { mode: "bwr", black: img.black, red: img.red };
  }
  if (img.buffer) {
    return { mode: "mono", buffer: img.buffer };
  }
  return { mode: "none" };
}

// ─── Canvas miniature (frame active ou bloc validé) ──────────────────────────

function FramePreviewMini({
  preview,
  screenType,
}: {
  preview: NetworkPreview;
  screenType: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      let imageData: ImageData | null = null;

      if (preview.mode === "bwr" && preview.black && preview.red) {
        imageData = eink29bwrToCanvas(preview.black, preview.red);
      } else if (preview.mode === "mono" && preview.buffer) {
        if (screenType === "eink27bw") {
          imageData = eink27bwToCanvas(preview.buffer);
        } else if (screenType === "oled096") {
          imageData = oled096ToCanvas(preview.buffer);
        }
      }

      if (!imageData) return;

      canvas.width  = imageData.width;
      canvas.height = imageData.height;
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // Données corrompues — on laisse le canvas vide
    }
  }, [preview, screenType]);

  const cssW = screenType === "oled096"  ? 128
             : screenType === "eink27bw" ? 132
             : 148;
  const cssH = screenType === "oled096"  ? 64
             : screenType === "eink27bw" ? 88
             : 64;

  return (
    <div style={{
      marginTop: 8,
      borderRadius: 6,
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
      display: "inline-block",
      lineHeight: 0,
      background: "#fff",
    }}>
      <canvas
        ref={canvasRef}
        style={{ width: cssW, height: cssH, imageRendering: "pixelated", display: "block" }}
      />
    </div>
  );
}

// ─── SidePanel ────────────────────────────────────────────────────────────────

export function SidePanel({ device, onClose }: { device: NetworkDevice | null; onClose: () => void }) {

  // ── Chargement lazy du dernier bloc validé ──────────────────────────────
  const [lastBlock,    setLastBlock]    = useState<MinedBlock | null>(null);
  const [lastImage,    setLastImage]    = useState<BlockImagePayload | null>(null);
  const [loadingBlock, setLoadingBlock] = useState(false);

  useEffect(() => {
    if (!device) {
      setLastBlock(null);
      setLastImage(null);
      return;
    }
    setLoadingBlock(true);
    setLastBlock(null);
    setLastImage(null);

    fetch(`/api/device-last-block?deviceId=${device.deviceId}`)
      .then((r) => r.json())
      .then((data) => {
        setLastBlock(data.block ?? null);
        setLastImage(data.imagePayload ?? null);
      })
      .catch(() => {
        setLastBlock(null);
        setLastImage(null);
      })
      .finally(() => setLoadingBlock(false));
  }, [device?.deviceId]);

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!device) return (
    <aside className="nv2-panel nv2-panel--empty">
      <p>Sélectionnez un ESP<br />pour voir ses détails</p>
    </aside>
  );

  const primaryScreenType = device.screens[0]?.screen ?? "";

  return (
    <aside className="nv2-panel">
      <button className="nv2-panel__close" onClick={onClose} aria-label="Fermer">✕</button>

      {/* ── Header device ── */}
      <div className="nv2-panel__header">
        <div className="nv2-panel__status-dot" style={{ background: device.isOnline ? "#4ade80" : "#475569" }} />
        <div>
          <h3 className="nv2-panel__name">{device.artistName || device.deviceId.slice(0, 14)}</h3>
          <code className="nv2-panel__id">{device.deviceId}</code>
        </div>
        <span className={`nv2-badge ${device.isOnline ? "nv2-badge--on" : "nv2-badge--off"}`}>
          {device.isOnline ? "ONLINE" : "OFFLINE"}
        </span>
      </div>

      {/* ── Écrans connectés ── */}
      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Écrans connectés</div>
        <div className="nv2-screen-grid">
          {device.screens.length === 0 && <p className="nv2-muted">Aucun écran</p>}
          {device.screens.map((s) => (
            <div key={`${device.deviceId}-${s.screen}`} className="nv2-screen-item">
              <div className="nv2-screen-icon">
                <svg viewBox="0 0 24 18" fill="none" width={28}>
                  <rect x="0.5" y="0.5" width="23" height="17" rx="2.5" stroke="currentColor" strokeOpacity={0.5} />
                  <rect x="3" y="3" width="18" height="12" rx="1" fill="currentColor" fillOpacity={0.1} />
                  <line x1="9" y1="17.5" x2="15" y2="17.5" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />
                </svg>
              </div>
              <div>
                <strong>{s.label}</strong>
                <small>{s.description}</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Métriques ── */}
      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Métriques</div>
        <div className="nv2-metrics-grid">
          <div className="nv2-metric"><span>Firmware</span><strong>{device.firmware || "?"}</strong></div>
          <div className="nv2-metric"><span>Frames envoyées</span><strong>{device.framesSent.toLocaleString()}</strong></div>
          <div className="nv2-metric"><span>Dernière vue</span><strong>{formatRelativeTime(device.lastSeen)}</strong></div>
          <div className="nv2-metric"><span>Dernier ping</span><strong>{formatRelativeTime(device.lastPing)}</strong></div>
        </div>
      </div>

      {/* ── Frame active (queue courante) ── */}
      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Frame en cours d'affichage</div>
        {device.recentFrame && device.recentFrame.preview.mode !== "none" ? (
          <>
            <FramePreviewMini
              preview={device.recentFrame.preview}
              screenType={primaryScreenType}
            />
            <p className="nv2-muted nv2-small" style={{ marginTop: 6 }}>
              {`Frame ${device.recentFrame.frameId.slice(0, 8)}… · ${formatRelativeTime(device.recentFrame.createdAt)}`}
            </p>
            {device.recentFrame.sourceDeviceId && (
              <p className="nv2-muted nv2-small">Source : {device.recentFrame.sourceDeviceId}</p>
            )}
          </>
        ) : (
          <p className="nv2-muted nv2-small">Aucune frame active</p>
        )}
      </div>

      {/* ── Dernier bloc validé (lazy depuis /api/device-last-block) ── */}
      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Dernier bloc validé</div>

        {loadingBlock && (
          <p className="nv2-muted nv2-small nv2-loading">Chargement…</p>
        )}

        {!loadingBlock && lastBlock && (
          <div className="nv2-block-preview">
            {/* Vignette du dessin */}
            {lastImage && blockImageToPreview(lastImage).mode !== "none" && (
              <FramePreviewMini
                preview={blockImageToPreview(lastImage)}
                screenType={lastImage.screen}
              />
            )}

            {/* Méta-données du bloc */}
            <div className="nv2-block-meta">
              <div className="nv2-block-meta__row">
                <span className="nv2-block-meta__label">Bloc</span>
                <span className="nv2-block-meta__value nv2-accent">#{lastBlock.blockIndex}</span>
              </div>
              <div className="nv2-block-meta__row">
                <span className="nv2-block-meta__label">Miné</span>
                <span className="nv2-block-meta__value">{formatRelativeTime(lastBlock.minedAt)}</span>
              </div>
              <div className="nv2-block-meta__row">
                <span className="nv2-block-meta__label">PoD score</span>
                <span className="nv2-block-meta__value nv2-green">{lastBlock.drawScore}</span>
              </div>
              <div className="nv2-block-meta__row">
                <span className="nv2-block-meta__label">Validateurs</span>
                <span className="nv2-block-meta__value">{lastBlock.validatorIds.length}</span>
              </div>
              <div className="nv2-block-meta__row">
                <span className="nv2-block-meta__label">Display</span>
                <span className="nv2-block-meta__value">{lastBlock.displayTime}s</span>
              </div>
              <div className="nv2-block-meta__row" style={{ marginTop: 4 }}>
                <span className="nv2-block-meta__label">Hash</span>
                <code className="nv2-block-meta__hash">{lastBlock.blockHash.slice(0, 16)}…</code>
              </div>
            </div>
          </div>
        )}

        {!loadingBlock && !lastBlock && (
          <p className="nv2-muted nv2-small">Aucun bloc miné par ce device</p>
        )}
      </div>

      {/* ── Styles ── */}
      <style>{`
        .nv2-loading {
          opacity: 0.5;
          font-style: italic;
        }
        .nv2-block-preview {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .nv2-block-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .nv2-block-meta__row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
        }
        .nv2-block-meta__label {
          color: var(--text3, #64748b);
        }
        .nv2-block-meta__value {
          color: var(--text2, #94a3b8);
          font-weight: 600;
          font-family: monospace;
        }
        .nv2-block-meta__hash {
          font-size: 10px;
          font-family: monospace;
          color: var(--text3, #64748b);
        }
        .nv2-accent { color: var(--accent, #7c6bff) !important; }
        .nv2-green  { color: #4ade80 !important; }
      `}</style>
    </aside>
  );
}
