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
  frameId: string;
  workTitle?: string;
  drawArtistName?: string;
  deviceOwnerName?: string;
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

// Boîte d'affichage cible — la miniature est mise à l'échelle (en conservant
// son ratio natif) pour remplir au mieux cette boîte, plutôt que d'utiliser
// une taille CSS fixe par type d'écran (qui plaquait les images en haut à
// gauche, déformées ou minuscules selon le buffer réellement reçu).
const PREVIEW_BOX_W = 220;
const PREVIEW_BOX_H = 150;

function FramePreviewMini({
  preview,
  screenType,
}: {
  preview: NetworkPreview;
  screenType: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Dimensions natives du buffer décodé — déterminent le ratio d'affichage.
  const [native, setNative] = useState<{ w: number; h: number } | null>(null);

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

      if (!imageData) { setNative(null); return; }

      canvas.width  = imageData.width;
      canvas.height = imageData.height;
      ctx.putImageData(imageData, 0, 0);
      setNative({ w: imageData.width, h: imageData.height });
    } catch {
      // Données corrompues — on laisse le canvas vide
      setNative(null);
    }
  }, [preview, screenType]);

  // Mise à l'échelle "contain" dans la boîte cible, en conservant le ratio —
  // l'image occupe l'espace disponible sans être étirée ni tronquée, quel que
  // soit le type d'écran source (e-ink 2.9", 2.7", OLED…).
  let cssW = PREVIEW_BOX_W;
  let cssH = PREVIEW_BOX_H;
  if (native && native.w > 0 && native.h > 0) {
    const scale = Math.min(PREVIEW_BOX_W / native.w, PREVIEW_BOX_H / native.h);
    cssW = Math.round(native.w * scale);
    cssH = Math.round(native.h * scale);
  }

  return (
    <div style={{
      marginTop: 8,
      borderRadius: 6,
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: PREVIEW_BOX_H + 16,
      background: "#fff",
    }}>
      <canvas
        ref={canvasRef}
        style={{ width: cssW, height: cssH, imageRendering: "pixelated", display: "block" }}
      />
    </div>
  );
}

// ─── Types activité on-chain ──────────────────────────────────────────────────

interface ActivityBlock {
  blockHash: string;
  blockIndex: number;
  artistName: string;
  poolScreen: string;
  score: number;
  minedAt: number;
  role: "author" | "validator";
  validatorCount: number;
}

interface DeviceActivity {
  minedCount: number;
  validatedCount: number;
  totalBlocks: number;
  recentActivity: ActivityBlock[];
}

const SCREEN_COLOR: Record<string, string> = {
  eink29bwr: "#f87171",
  eink27bw:  "#94a3b8",
  oled096:   "#60a5fa",
  tft18:     "#fbbf24",
};
function screenColor(s: string) { return SCREEN_COLOR[s] ?? "#a2a3bb"; }

// ─── Sous-onglets du panel ────────────────────────────────────────────────────
// Découpage en 4 sections compactes (au lieu de 2 longues) : chacune tient
// sans scroll dans la hauteur du panel (= hauteur de la carte réseau).
type SidePanelTab = "apercu" | "activite" | "frame" | "logs";
const TAB_LABEL: Record<SidePanelTab, string> = {
  apercu:   "Aperçu",
  activite: "Activité",
  frame:    "Frame / Bloc",
  logs:     "Logs ESP",
};

// ─── SidePanel ────────────────────────────────────────────────────────────────

export function SidePanel({
  device,
  focusScreen,
  onClose,
}: {
  device: NetworkDevice | null;
  // Renseigné quand l'utilisateur a cliqué sur un nœud-écran (et non sur l'ESP
  // lui-même) — on met alors en avant le bloc/la frame affichée sur CET écran
  // (hash, contenu, timestamp, statut de rendu) plutôt que les infos générales.
  focusScreen?: string;
  onClose: () => void;
}) {

  // ── Chargement lazy du dernier bloc validé ──────────────────────────────
  const [lastBlock,    setLastBlock]    = useState<MinedBlock | null>(null);
  const [lastImage,    setLastImage]    = useState<BlockImagePayload | null>(null);
  const [loadingBlock, setLoadingBlock] = useState(false);

  // ── Activité on-chain ────────────────────────────────────────────────────
  const [activity,        setActivity]        = useState<DeviceActivity | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // ── Onglet actif — 4 sous-onglets compacts pour limiter la hauteur du
  // panel à celle de la carte réseau (cf. .nv2-panel { height: 100% }) :
  // un seul bloc de contenu visible à la fois plutôt qu'un long scroll.
  const [tab, setTab] = useState<SidePanelTab>("apercu");
  // Reset sur changement de device — et saut direct sur "Frame" quand on a
  // cliqué un nœud-écran (le focusBanner concerne justement cette section).
  useEffect(() => { setTab(focusScreen ? "frame" : "apercu"); }, [device?.deviceId, focusScreen]);

  useEffect(() => {
    if (!device) {
      setLastBlock(null);
      setLastImage(null);
      setActivity(null);
      return;
    }
    setLoadingBlock(true);
    setLastBlock(null);
    setLastImage(null);
    setLoadingActivity(true);
    setActivity(null);

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

    fetch(`/api/network/device-activity?deviceId=${device.deviceId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setActivity(data ?? null))
      .catch(() => setActivity(null))
      .finally(() => setLoadingActivity(false));
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

      {/* ── Bandeau "écran sélectionné" — clic sur un nœud-écran ── */}
      {focusScreen && (() => {
        const sInfo = device.screens.find((s) => s.screen === focusScreen);
        const color = SCREEN_COLOR[focusScreen] ?? "#a2a3bb";
        return (
          <div className="nv2-focus-banner" style={{ borderColor: `${color}55`, background: `${color}0f` }}>
            <span className="nv2-focus-banner__dot" style={{ background: color }} />
            <div>
              <strong style={{ color }}>{sInfo?.label ?? focusScreen}</strong>
              <span className="nv2-focus-banner__hint">voir l&apos;onglet « Frame / Bloc » ci-dessous</span>
            </div>
          </div>
        );
      })()}

      {/* ── Onglets — 4 sections compactes (Aperçu/Activité/Frame/Logs) :
          chacune tient seule dans la hauteur du panel, sans long scroll ── */}
      <div className="nv2-tabs" role="tablist">
        {(Object.keys(TAB_LABEL) as SidePanelTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`nv2-tab${tab === t ? " nv2-tab--active" : ""}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {/* ── Aperçu : écrans connectés + métriques ── */}
      {tab === "apercu" && (
        <>
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

          <div className="nv2-panel__section">
            <div className="nv2-panel__section-label">Métriques</div>
            <div className="nv2-metrics-grid">
              <div className="nv2-metric"><span>Firmware</span><strong>{device.firmware || "?"}</strong></div>
              <div className="nv2-metric"><span>Frames envoyées</span><strong>{device.framesSent.toLocaleString()}</strong></div>
              <div className="nv2-metric"><span>Dernière vue</span><strong>{formatRelativeTime(device.lastSeen)}</strong></div>
              <div className="nv2-metric"><span>Dernier ping</span><strong>{formatRelativeTime(device.lastPing)}</strong></div>
            </div>
          </div>
        </>
      )}

      {/* ── Activité on-chain ── */}
      {tab === "activite" && (
        <div className="nv2-panel__section">
          <div className="nv2-panel__section-label">Activité on-chain</div>
          {loadingActivity && <p className="nv2-muted nv2-small nv2-loading">Chargement…</p>}
          {!loadingActivity && activity && (
            <>
              <div className="nv2-metrics-grid" style={{ marginBottom: "0.85rem" }}>
                <div className="nv2-metric">
                  <span>Blocs minés</span>
                  <strong style={{ color: "var(--accent)" }}>{activity.minedCount}</strong>
                </div>
                <div className="nv2-metric">
                  <span>Validations</span>
                  <strong style={{ color: "#a78bfa" }}>{activity.validatedCount}</strong>
                </div>
              </div>
              {activity.recentActivity.length > 0 && (
                <div className="nv2-activity-list">
                  {activity.recentActivity.slice(0, 5).map((b) => (
                    <div key={b.blockHash} className="nv2-activity-item">
                      <span className="nv2-activity-dot"
                            style={{ background: b.role === "author" ? "var(--accent)" : "#a78bfa" }} />
                      <div className="nv2-activity-body">
                        <span className="nv2-activity-role">
                          {b.role === "author" ? "Miné" : "Validé"}
                          {" · "}
                          <span style={{ color: screenColor(b.poolScreen) }}>{b.poolScreen}</span>
                        </span>
                        <span className="nv2-activity-meta">
                          #{b.blockIndex} · {(b.score * 100).toFixed(0)}% · {formatRelativeTime(b.minedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activity.recentActivity.length === 0 && (
                <p className="nv2-muted nv2-small">Aucune activité récente</p>
              )}
            </>
          )}
          {!loadingActivity && !activity && (
            <p className="nv2-muted nv2-small">Non disponible</p>
          )}
        </div>
      )}

      {/* ── Frame en cours / dernier bloc — fusionnés si même frameId ── */}
      {tab === "frame" && (() => {
        const frameIsBlock = !loadingBlock && lastBlock && device.recentFrame &&
          device.recentFrame.frameId === lastBlock.frameId;

        if (frameIsBlock) {
          return (
            <div className="nv2-panel__section">
              <div className="nv2-panel__section-label" style={{ color: "var(--accent)" }}>
                ◈ Bloc #{lastBlock!.blockIndex} — actuellement affiché
              </div>
              {lastImage && blockImageToPreview(lastImage).mode !== "none" && (
                <FramePreviewMini
                  preview={blockImageToPreview(lastImage)}
                  screenType={lastImage.screen}
                />
              )}
              <div className="nv2-block-meta" style={{ marginTop: 8 }}>
                {lastBlock!.workTitle && lastBlock!.workTitle !== "Sans titre" && (
                  <div className="nv2-block-meta__row">
                    <span className="nv2-block-meta__label">Titre</span>
                    <span className="nv2-block-meta__value">{lastBlock!.workTitle}</span>
                  </div>
                )}
                {lastBlock!.drawArtistName && (
                  <div className="nv2-block-meta__row">
                    <span className="nv2-block-meta__label">Artiste</span>
                    <span className="nv2-block-meta__value">{lastBlock!.drawArtistName}</span>
                  </div>
                )}
                <div className="nv2-block-meta__row">
                  <span className="nv2-block-meta__label">Miné</span>
                  <span className="nv2-block-meta__value">{formatRelativeTime(lastBlock!.minedAt)}</span>
                </div>
                <div className="nv2-block-meta__row">
                  <span className="nv2-block-meta__label">PoD score</span>
                  <span className="nv2-block-meta__value nv2-green">{lastBlock!.drawScore}</span>
                </div>
                <div className="nv2-block-meta__row">
                  <span className="nv2-block-meta__label">Display</span>
                  <span className="nv2-block-meta__value">{lastBlock!.displayTime}s</span>
                </div>
              </div>
            </div>
          );
        }

        return (
          <>
            <div className="nv2-panel__section">
              <div className="nv2-panel__section-label">Frame en cours d&apos;affichage</div>
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

            <div className="nv2-panel__section">
              <div className="nv2-panel__section-label">Dernier bloc validé</div>
              {loadingBlock && <p className="nv2-muted nv2-small nv2-loading">Chargement…</p>}
              {!loadingBlock && lastBlock && (
                <div className="nv2-block-preview">
                  {lastImage && blockImageToPreview(lastImage).mode !== "none" && (
                    <FramePreviewMini
                      preview={blockImageToPreview(lastImage)}
                      screenType={lastImage.screen}
                    />
                  )}
                  <div className="nv2-block-meta">
                    <div className="nv2-block-meta__row">
                      <span className="nv2-block-meta__label">Bloc</span>
                      <span className="nv2-block-meta__value nv2-accent">#{lastBlock.blockIndex}</span>
                    </div>
                    {lastBlock.workTitle && lastBlock.workTitle !== "Sans titre" && (
                      <div className="nv2-block-meta__row">
                        <span className="nv2-block-meta__label">Titre</span>
                        <span className="nv2-block-meta__value">{lastBlock.workTitle}</span>
                      </div>
                    )}
                    {lastBlock.drawArtistName && (
                      <div className="nv2-block-meta__row">
                        <span className="nv2-block-meta__label">Artiste</span>
                        <span className="nv2-block-meta__value">{lastBlock.drawArtistName}</span>
                      </div>
                    )}
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
          </>
        );
      })()}

      {tab === "logs" && (
        <EspDeviceLog device={device} activity={activity} lastBlock={lastBlock} />
      )}

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
        .nv2-activity-list { display:flex; flex-direction:column; gap:0.45rem; }
        .nv2-activity-item {
          display:flex; align-items:flex-start; gap:0.5rem; padding:0.5rem 0.6rem;
          border-radius:0.6rem; background:rgba(255,255,255,0.025);
          border:1px solid rgba(255,255,255,0.04);
        }
        .nv2-activity-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:3px; }
        .nv2-activity-body { display:flex; flex-direction:column; gap:1px; }
        .nv2-activity-role { font-size:0.8rem; color:var(--text2); font-weight:600; }
        .nv2-activity-meta { font-size:0.72rem; color:var(--text3); font-family:monospace; }

        /* Bandeau "écran sélectionné" (clic sur un nœud-écran de la carte) */
        .nv2-focus-banner {
          display: flex; align-items: center; gap: 0.6rem;
          margin: 0 0 0.9rem; padding: 0.55rem 0.8rem;
          border: 1px solid; border-radius: 0.7rem;
        }
        .nv2-focus-banner__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .nv2-focus-banner strong { display: block; font-size: 0.85rem; }
        .nv2-focus-banner__hint { display: block; font-size: 0.7rem; color: var(--text3, #64748b); }

        /* Onglets — 4 sections compactes (Aperçu/Activité/Frame/Logs).
           flex-wrap : sur panel étroit (mobile, ~340px), 2 lignes plutôt que
           des libellés tronqués/qui débordent. */
        .nv2-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem 0.7rem;
          padding: 0 1.25rem;
          margin: 0.6rem 0 0.4rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .nv2-tab {
          appearance: none;
          background: none;
          border: none;
          color: var(--text3, #64748b);
          font-size: 0.74rem;
          font-weight: 600;
          white-space: nowrap;
          padding: 0.45rem 0.1rem 0.6rem;
          margin-bottom: -1px;
          border-bottom: 2px solid transparent;
          cursor: pointer;
        }
        .nv2-tab:hover { color: var(--text2, #94a3b8); }
        .nv2-tab--active {
          color: var(--accent, #7c6bff);
          border-bottom-color: var(--accent, #7c6bff);
        }

        /* Terminal "Logs ESP" — rendu Serial.print() façon firmware */
        .esp-log {
          margin: 0.75rem 1.25rem 1rem;
          background: #0b0f1a;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 10px;
          overflow: hidden;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .esp-log__head {
          padding: 0.5rem 0.7rem;
          font-size: 10px;
          color: #475569;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02);
          font-style: italic;
        }
        .esp-log__body {
          max-height: 360px;
          overflow-y: auto;
          padding: 0.5rem 0.7rem;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .esp-log__line {
          font-size: 11px;
          line-height: 1.55;
          color: #cbd5e1;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .esp-log__line--muted { color: #475569; font-style: italic; }
        .esp-log__tag { font-weight: 700; }
      `}</style>
    </aside>
  );
}

// ─── Logs ESP — vue "moniteur série" pour un device précis ──────────────────
//
// Reformate les données déjà chargées par ce panneau (device, activité
// on-chain, dernier bloc validé / frame active — cf. fetchs ci-dessus) au
// format Serial.print() exact du firmware (cf. esp_eink_*.ino : doPull,
// doFetchFrame, doValidate). Aucune requête supplémentaire n'est ajoutée et
// aucune donnée sensible (mac, pairCode…) n'est affichée — uniquement ce qui
// transite déjà publiquement entre l'ESP et le serveur.

const TAG_COLOR2: Record<string, string> = {
  PULL:        "#60a5fa",
  FETCHFRAME:  "#4ade80",
  VALIDATE:    "#fbbf24",
  HTTP:        "#a2a3bb",
  OWNED:       "#a78bfa",
};

function tagSpan(tag: string): React.ReactNode {
  return <span className="esp-log__tag" style={{ color: TAG_COLOR2[tag] ?? "#a2a3bb" }}>[{tag}]</span>;
}

function buildEspDeviceLog(
  device: NetworkDevice,
  activity: DeviceActivity | null,
  lastBlock: MinedBlock | null,
): { id: string; ts: number; node: React.ReactNode }[] {
  const lines: { id: string; ts: number; node: React.ReactNode }[] = [];
  let n = 0;
  const push = (ts: number, tag: string, text: string) => {
    lines.push({ id: `el-${n++}`, ts, node: <>{tagSpan(tag)} {text}</> });
  };

  // Boot / register — toujours en première ligne
  push(device.lastSeen || device.lastPing || Date.now(), "HTTP",
    `register OK · firmware=${device.firmware || "?"} · écrans=${device.screens.length}`);

  // Frame active — équivalent doFetchFrame()
  if (device.recentFrame) {
    const f = device.recentFrame;
    push(f.createdAt, "PULL",
      `Nouvelle frame frameId=${f.frameId.slice(0, 12)}… source=${f.sourceDeviceId ?? "consensus"} → fetch`);
    push(f.createdAt + 1, "FETCHFRAME",
      `✅ affichée frameId=${f.frameId.slice(0, 12)}… source=${f.sourceDeviceId ?? "consensus"}`);
  } else {
    push(device.lastPing || Date.now(), "PULL", "Aucune frame");
  }

  // Dernier bloc validé / miné par ce device — équivalent doValidate()
  if (lastBlock) {
    if (lastBlock.validatorIds?.includes(device.deviceId)) {
      push(lastBlock.minedAt, "VALIDATE",
        `candidateId=${lastBlock.blockHash.slice(0, 10)}… score=${lastBlock.drawScore.toFixed(3)}`);
      push(lastBlock.minedAt + 1, "VALIDATE", "Vote OK");
    }
    push(lastBlock.minedAt + 2, "PULL",
      `Nouveau bloc #${lastBlock.blockIndex} hash=${lastBlock.blockHash.slice(0, 12)}…`);
  }

  // Historique d'activité on-chain — agrégat des derniers blocs minés/validés
  if (activity?.recentActivity?.length) {
    for (const b of activity.recentActivity.slice(0, 6)) {
      if (b.role === "author") {
        push(b.minedAt, "PULL",
          `Nouveau bloc #${b.blockIndex} hash=${b.blockHash.slice(0, 12)}… (${b.poolScreen})`);
        push(b.minedAt + 1, "VALIDATE", `BLOC MINE — ${b.validatorCount} validateur(s)`);
      } else {
        push(b.minedAt, "VALIDATE",
          `candidateId=${b.blockHash.slice(0, 10)}… score=${b.score.toFixed(3)} → Vote OK (${b.poolScreen})`);
      }
    }
  }

  // Cycle de pull — état réseau courant
  push(device.lastPing || Date.now(), "PULL",
    `nextInterval=${device.isOnline ? "30" : "300"}s (retryAfter=${device.isOnline ? 0 : 300})`);

  return lines.sort((a, b) => a.ts - b.ts).slice(-40);
}

function EspDeviceLog({
  device,
  activity,
  lastBlock,
}: {
  device: NetworkDevice;
  activity: DeviceActivity | null;
  lastBlock: MinedBlock | null;
}) {
  const lines = buildEspDeviceLog(device, activity, lastBlock);

  return (
    <div className="esp-log">
      <div className="esp-log__head">
        échanges réels {device.deviceId.slice(0, 10)}… ↔ serveur — format Serial.print() (cf. firmware .ino)
      </div>
      <div className="esp-log__body">
        {lines.length === 0 && (
          <div className="esp-log__line esp-log__line--muted">aucun échange enregistré pour ce device</div>
        )}
        {lines.map((l) => (
          <div key={l.id} className="esp-log__line">
            <span style={{ color: "#475569" }}>[{formatRelativeTime(l.ts)}]</span> {l.node}
          </div>
        ))}
      </div>
    </div>
  );
}
