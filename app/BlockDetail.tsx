"use client";

// app/BlockDetail.tsx
// Modal de détail d'un bloc — 3 onglets : Détails / Actions / Replay.
// Axe 5.

import { useState, useEffect, useRef, useCallback } from "react";
import type { BlockWithImage } from "@/lib/chain";
import { BlockFrameCanvas } from "./BlockFrameCanvas";
import type { ActionEvent, ReplayEvent } from "@/lib/types/actions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const SCREEN_LABELS: Record<string, string> = {
  eink29bwr: 'E-Ink 2.9" BWR',
  eink27bw:  'E-Ink 2.7" BW',
  oled096:   'OLED 0.96"',
};

// ─── Observer collapse ────────────────────────────────────────────────────────

function ObserverSection({ revalidated }: { revalidated: NonNullable<BlockWithImage["revalidated"]> }) {
  const [expanded, setExpanded] = useState(false);

  // Agréger les observers uniques : deviceId → liste de timestamps de confirmation
  const observerMap = new Map<string, number[]>();
  for (const r of revalidated) {
    for (const id of r.observerIds) {
      const existing = observerMap.get(id) ?? [];
      if (r.confirmedAt > 0) existing.push(r.confirmedAt);
      observerMap.set(id, existing);
    }
  }
  const observers = Array.from(observerMap.entries()); // [deviceId, confirmedAts[]]
  const confirmedEntries = revalidated.filter(r => r.confirmedAt > 0).length;

  if (observers.length === 0) return null;

  return (
    <div className="bd-section">
      <button
        className="bd-obs-header"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className="bd-section-title" style={{ margin: 0 }}>
          Observers ({observers.length})
        </span>
        <span className="bd-obs-badge">
          {confirmedEntries}/{revalidated.length} validations
        </span>
        <span className="bd-obs-chevron">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="bd-obs-list">
          {observers.map(([id, ats]) => (
            <div key={id} className="bd-obs-row">
              <code className="bd-id-chip">{id}</code>
              <span className="bd-obs-count">
                {ats.length > 0
                  ? `✓ ${ats.length} confirm.`
                  : "⏳ en attente"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab : Détails ────────────────────────────────────────────────────────────

function TabDetails({ block }: { block: BlockWithImage }) {
  const artistLabel = block.drawArtistName
    ? `${block.drawArtistName} sur ESP de ${block.deviceOwnerName ?? block.artistName}`
    : (block.artistName || "Artiste inconnu");

  return (
    <div className="bd-details">
      {block.imagePayload && (
        <div className="bd-preview">
          <BlockFrameCanvas
            payload={block.imagePayload}
            blockHash={block.blockHash}
            blockIndex={block.blockIndex}
            showDownload={true}
          />
        </div>
      )}

      <div className="bd-meta-grid">
        <MetaRow label="Bloc"       value={`#${block.blockIndex}`} accent />
        <MetaRow label="Titre"      value={block.workTitle ?? "Sans titre"} />
        <MetaRow label="Artiste"    value={artistLabel} />
        <MetaRow label="Écran"      value={SCREEN_LABELS[block.poolScreen] ?? block.poolScreen} />
        <MetaRow label="Miné le"    value={formatDate(block.minedAt)} />
        <MetaRow label="Score PoD"  value={String(block.drawScore)} green />
        <MetaRow label="Complexité" value={(block.score * 100).toFixed(1) + "%"} />
        <MetaRow label="Affichage"  value={`${block.displayTime}s`} />
        <MetaRow label="Validateurs" value={block.validatorIds.length.toString()} />
        {block.obsConfirmed && <MetaRow label="Observer"  value="Confirmé ✓" green />}
      </div>

      {/* Validateurs */}
      {block.validatorIds.length > 0 && (
        <div className="bd-section">
          <div className="bd-section-title">Validateurs ({block.validatorIds.length})</div>
          <div className="bd-id-list">
            {block.validatorIds.map((id) => (
              <code key={id} className="bd-id-chip">{id}</code>
            ))}
          </div>
        </div>
      )}

      {/* Observers — collapsible */}
      {block.revalidated && block.revalidated.length > 0 && (
        <ObserverSection revalidated={block.revalidated} />
      )}

      <div className="bd-hashes">
        <HashRow label="Block hash"   value={block.blockHash} />
        <HashRow label="Parent hash"  value={block.parentHash} />
        <HashRow label="Image hash"   value={block.imageHash} />
        {block.actionsHash && <HashRow label="Actions hash" value={block.actionsHash} />}
        {block.podHashEnriched && <HashRow label="PoD enriched" value={block.podHashEnriched} />}
      </div>
    </div>
  );
}

function MetaRow({ label, value, accent, green }: { label: string; value: string; accent?: boolean; green?: boolean }) {
  return (
    <div className="bd-meta-row">
      <span className="bd-meta-label">{label}</span>
      <span className={`bd-meta-value${accent ? " bd-accent" : green ? " bd-green" : ""}`}>{value}</span>
    </div>
  );
}

function HashRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="bd-hash-row" onClick={copy} title="Copier le hash complet">
      <span className="bd-hash-label">{label}</span>
      <code className="bd-hash-value">{value.slice(0, 24)}…{copied ? " ✓" : ""}</code>
    </div>
  );
}

// ─── Tab : Actions ────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  stroke: "#60a5fa",
  erase:  "#94a3b8",
  fill:   "#a78bfa",
  shape:  "#34d399",
  move:   "#fbbf24",
  clear:  "#f87171",
  undo:   "#fb923c",
  redo:   "#6b7280",
};

function TabActions({ blockHash }: { blockHash: string }) {
  const [actions, setActions] = useState<ActionEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/block-actions?hash=${blockHash}`)
      .then((r) => r.json())
      .then((d) => setActions(d.actions ?? []))
      .catch(() => setActions([]))
      .finally(() => setLoading(false));
  }, [blockHash]);

  if (loading) return <p className="bd-muted">Chargement…</p>;
  if (!actions?.length) return <p className="bd-muted">Aucune action enregistrée pour ce bloc.</p>;

  let runningScore = 0;

  return (
    <div className="bd-actions">
      <p className="bd-muted" style={{ marginBottom: 10 }}>
        {actions.length} action{actions.length > 1 ? "s" : ""} enregistrée{actions.length > 1 ? "s" : ""}
      </p>
      <div className="bd-action-list">
        {actions.map((a, i) => {
          if (a.kind === "undo") runningScore--;
          else if (a.kind !== "redo" && a.kind !== "clear") runningScore++;
          else if (a.kind === "clear") runningScore = 0;
          return (
            <div key={i} className="bd-action-row">
              <span className="bd-action-idx">{i + 1}</span>
              <span className="bd-action-kind" style={{ color: ACTION_COLORS[a.kind] ?? "#94a3b8" }}>
                {a.kind}
              </span>
              {a.tool && <span className="bd-action-tool">{a.tool}</span>}
              {a.color && (
                <span
                  className="bd-action-color"
                  style={{ background: a.color, border: "1px solid rgba(255,255,255,0.15)" }}
                  title={a.color}
                />
              )}
              <span className="bd-action-t">{(a.t / 1000).toFixed(1)}s</span>
              <span className="bd-action-score">{runningScore > 0 ? `+${runningScore}` : runningScore}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab : Replay ─────────────────────────────────────────────────────────────

function TabReplay({ block }: { block: BlockWithImage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [replay, setReplay] = useState<ReplayEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const animRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const W = block.imagePayload?.screen === "eink29bwr" ? 296
          : block.imagePayload?.screen === "eink27bw"  ? 264
          : 128;
  const H = block.imagePayload?.screen === "eink29bwr" ? 128
          : block.imagePayload?.screen === "eink27bw"  ? 176
          : 64;

  useEffect(() => {
    fetch(`/api/block-replay?hash=${block.blockHash}`)
      .then((r) => r.json())
      .then((d) => setReplay(d.replay ?? []))
      .catch(() => setReplay([]))
      .finally(() => setLoading(false));
  }, [block.blockHash]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }, [W, H]);

  const startReplay = useCallback(() => {
    if (!replay || replay.length === 0) return;
    if (animRef.current) clearTimeout(animRef.current);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    // Reset
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    setPlaying(true);
    setProgress(0);

    const total = replay.length;
    const t0 = replay[0].t;
    const tEnd = replay[total - 1].t;
    const duration = Math.max(tEnd - t0, 1);
    // Normalise la vitesse pour que le replay dure ~10s max
    const speedFactor = Math.max(1, duration / 10000);

    let i = 0;
    let prevEvent: ReplayEvent | null = null;

    function step() {
      if (i >= total) {
        setPlaying(false);
        setProgress(100);
        return;
      }

      const ev = replay![i];
      i++;
      setProgress(Math.round((i / total) * 100));

      const color = ev.color ?? "#000000";
      const size  = ev.size  ?? 2;

      ctx.lineWidth = size;
      ctx.lineCap   = "round";
      ctx.lineJoin  = "round";
      ctx.strokeStyle = color;
      ctx.fillStyle   = color;

      if (ev.kind === "down") {
        ctx.beginPath();
        ctx.arc(ev.x, ev.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (ev.kind === "move" && prevEvent && prevEvent.kind !== "up") {
        ctx.beginPath();
        ctx.moveTo(prevEvent.x, prevEvent.y);
        ctx.lineTo(ev.x, ev.y);
        ctx.stroke();
      }

      prevEvent = ev;

      // Délai jusqu'au prochain event (en temps réel / speedFactor)
      const nextDelay = i < total
        ? Math.max(0, (replay![i].t - ev.t) / speedFactor)
        : 0;

      animRef.current = setTimeout(step, nextDelay);
    }

    step();
  }, [replay, W, H]);

  useEffect(() => () => { if (animRef.current) clearTimeout(animRef.current); }, []);

  if (loading) return <p className="bd-muted">Chargement…</p>;

  const SCALE = W <= 128 ? 2 : 1;

  return (
    <div className="bd-replay">
      {!replay?.length ? (
        <p className="bd-muted">Replay non disponible pour ce bloc.<br />
          <small>Les dessins soumis après la mise à jour incluront le replay.</small>
        </p>
      ) : (
        <>
          <div className="bd-replay-canvas-wrap">
            <canvas
              ref={canvasRef}
              style={{
                width: W * SCALE,
                height: H * SCALE,
                imageRendering: "pixelated",
                background: "#fff",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
              }}
            />
          </div>
          <div className="bd-replay-controls">
            <button
              onClick={startReplay}
              disabled={playing}
              className="bd-replay-btn"
            >
              {playing ? "▶ Lecture…" : "▶ Lancer le replay"}
            </button>
            {(playing || progress > 0) && (
              <div className="bd-replay-progress-bar">
                <div className="bd-replay-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            )}
            <p className="bd-muted" style={{ marginTop: 6 }}>
              {replay.length} points · durée réelle {((replay[replay.length - 1].t - replay[0].t) / 1000).toFixed(1)}s
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── BlockDetail (Modal) ──────────────────────────────────────────────────────

type Tab = "details" | "actions" | "replay";

export function BlockDetail({ block, onClose }: { block: BlockWithImage; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("details");

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="bd-backdrop" onClick={handleBackdrop}>
      <div className="bd-modal" role="dialog" aria-modal="true" aria-label={`Bloc #${block.blockIndex}`}>
        {/* Header */}
        <div className="bd-header">
          <div className="bd-header-title">
            <span className="bd-header-index">BLOC #{block.blockIndex}</span>
            {block.workTitle && block.workTitle !== "Sans titre" && (
              <span className="bd-header-work">{block.workTitle}</span>
            )}
          </div>
          <button className="bd-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {/* Tabs */}
        <div className="bd-tabs">
          {(["details", "actions", "replay"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`bd-tab${tab === t ? " bd-tab--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "details" ? "Détails" : t === "actions" ? "Actions" : "Replay"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="bd-content">
          {tab === "details"  && <TabDetails block={block} />}
          {tab === "actions"  && <TabActions blockHash={block.blockHash} />}
          {tab === "replay"   && <TabReplay block={block} />}
        </div>
      </div>

      <style>{`
        .bd-backdrop {
          position: fixed; inset: 0; z-index: 2000;
          background: rgba(0,0,0,0.7);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .bd-modal {
          background: var(--bg1, #13192b);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 14px;
          width: 100%; max-width: 580px;
          max-height: 90dvh;
          overflow: hidden;
          display: flex; flex-direction: column;
          box-shadow: 0 24px 80px rgba(0,0,0,0.7);
        }
        .bd-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          flex-shrink: 0;
        }
        .bd-header-title { display: flex; flex-direction: column; gap: 2px; }
        .bd-header-index { font-size: 11px; font-weight: 700; color: var(--accent, #7c6bff); font-family: monospace; }
        .bd-header-work  { font-size: 14px; font-weight: 600; color: var(--text1, #f1f5f9); }
        .bd-close {
          background: none; border: none;
          color: rgba(255,255,255,0.4); cursor: pointer;
          font-size: 20px; line-height: 1; padding: 4px 8px;
          border-radius: 6px;
        }
        .bd-close:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); }
        .bd-tabs {
          display: flex; gap: 0;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          flex-shrink: 0;
        }
        .bd-tab {
          flex: 1; padding: 10px 0;
          background: none; border: none;
          color: var(--text3, #64748b);
          font-size: 12px; font-weight: 600;
          cursor: pointer; letter-spacing: 0.04em;
          border-bottom: 2px solid transparent;
          text-transform: uppercase;
          transition: color 0.12s, border-color 0.12s;
        }
        .bd-tab--active {
          color: var(--accent, #7c6bff);
          border-bottom-color: var(--accent, #7c6bff);
        }
        .bd-content { overflow-y: auto; padding: 16px 18px; flex: 1; }

        /* Détails */
        .bd-details { display: flex; flex-direction: column; gap: 16px; }
        .bd-preview { display: flex; justify-content: center; background: #fff; border-radius: 8px; padding: 12px; }
        .bd-meta-grid { display: flex; flex-direction: column; gap: 4px; }
        .bd-meta-row {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 12px; padding: 4px 0;
          border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .bd-meta-label { color: var(--text3, #64748b); }
        .bd-meta-value { color: var(--text2, #94a3b8); font-family: monospace; font-weight: 600; }
        .bd-accent { color: var(--accent, #7c6bff) !important; }
        .bd-green  { color: #4ade80 !important; }
        .bd-hashes { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
        .bd-hash-row {
          display: flex; gap: 8px; align-items: center;
          cursor: pointer; padding: 3px 0;
          border-radius: 4px;
        }
        .bd-hash-row:hover { background: rgba(255,255,255,0.04); }
        .bd-hash-label { font-size: 10px; color: var(--text3, #64748b); width: 80px; flex-shrink: 0; }
        .bd-hash-value { font-size: 10px; font-family: monospace; color: var(--text2, #94a3b8); }

        /* Sections (validateurs, ré-validations) */
        .bd-section {
          display: flex; flex-direction: column; gap: 6px;
          border-top: 1px solid rgba(255,255,255,0.05);
          padding-top: 12px;
        }
        .bd-section-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: var(--text3, #64748b);
        }
        .bd-id-list { display: flex; flex-wrap: wrap; gap: 4px; }
        .bd-id-list--sm { margin-top: 4px; }
        .bd-id-chip {
          font-size: 10px; font-family: monospace;
          color: var(--text2, #94a3b8);
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 4px; padding: 2px 6px;
        }
        .bd-id-chip--sm { font-size: 9px; padding: 1px 5px; }

        /* Observer collapse */
        .bd-obs-header {
          display: flex; align-items: center; gap: 8px;
          background: none; border: none; cursor: pointer; padding: 0;
          width: 100%; text-align: left;
        }
        .bd-obs-header:hover .bd-section-title { color: var(--text2, #94a3b8); }
        .bd-obs-badge {
          font-size: 10px; font-family: monospace;
          color: #4ade80;
          background: rgba(74,222,128,0.08);
          border: 1px solid rgba(74,222,128,0.2);
          border-radius: 4px; padding: 1px 6px;
        }
        .bd-obs-chevron { font-size: 11px; color: var(--text3, #64748b); margin-left: auto; }
        .bd-obs-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
        .bd-obs-row {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 6px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 6px;
        }
        .bd-obs-count { font-size: 10px; color: #4ade80; margin-left: auto; white-space: nowrap; }

        /* Actions */
        .bd-muted { font-size: 12px; color: var(--text3, #64748b); }
        .bd-actions { display: flex; flex-direction: column; }
        .bd-action-list { display: flex; flex-direction: column; gap: 1px; }
        .bd-action-row {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; padding: 4px 6px; border-radius: 4px;
        }
        .bd-action-row:hover { background: rgba(255,255,255,0.03); }
        .bd-action-idx  { color: var(--text3, #64748b); width: 28px; font-family: monospace; flex-shrink: 0; }
        .bd-action-kind { font-weight: 700; font-family: monospace; width: 56px; flex-shrink: 0; }
        .bd-action-tool { color: var(--text3, #64748b); font-family: monospace; flex-shrink: 0; }
        .bd-action-color {
          width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0;
        }
        .bd-action-t { color: var(--text3, #64748b); font-family: monospace; flex: 1; text-align: right; }
        .bd-action-score { color: var(--accent, #7c6bff); font-family: monospace; width: 32px; text-align: right; flex-shrink: 0; }

        /* Replay */
        .bd-replay { display: flex; flex-direction: column; gap: 12px; }
        .bd-replay-canvas-wrap { display: flex; justify-content: center; }
        .bd-replay-controls { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .bd-replay-btn {
          padding: 8px 20px; border-radius: 8px;
          border: 1px solid var(--accent, #7c6bff);
          background: rgba(124,107,255,0.1);
          color: var(--accent, #7c6bff);
          cursor: pointer; font-size: 13px; font-weight: 600;
        }
        .bd-replay-btn:disabled { opacity: 0.6; cursor: default; }
        .bd-replay-progress-bar {
          width: 100%; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;
        }
        .bd-replay-progress-fill {
          height: 100%; background: var(--accent, #7c6bff); border-radius: 2px;
          transition: width 0.1s linear;
        }
      `}</style>
    </div>
  );
}
