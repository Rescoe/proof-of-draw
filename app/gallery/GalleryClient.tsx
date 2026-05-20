"use client";

// app/gallery/GalleryClient.tsx
// Block explorer interactif : recherche + pagination + onglet Rejetés.

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type { BlockWithImage } from "@/lib/chain";
import { BlockFrameCanvas } from "../BlockFrameCanvas";
import { BlockDetail } from "../BlockDetail";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BlocksResponse {
  blocks: BlockWithImage[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface RejectedDraw {
  deviceId: string;
  screen: string;
  drawScore: number;
  score: number;
  reason: string;
  rejectedAt: number;
  workTitle?: string | null;
  drawArtistName?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60)    return `${sec}s`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}j`;
}

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
  tft18:     'TFT 1.8" RGB',
};

// ─── Block Card ───────────────────────────────────────────────────────────────

function BlockCard({ block, onClick }: { block: BlockWithImage; onClick: () => void }) {
  const artistLabel = block.drawArtistName
    ? `${block.drawArtistName} sur ESP de ${block.deviceOwnerName ?? block.artistName}`
    : (block.artistName || "Artiste inconnu");

  const title = block.workTitle && block.workTitle !== "Sans titre" ? block.workTitle : null;

  return (
    <div
      className="gc-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      aria-label={`Bloc #${block.blockIndex} — ${artistLabel}`}
    >
      <div className="gc-card__preview">
        {block.imagePayload ? (
          <BlockFrameCanvas
            payload={block.imagePayload}
            blockHash={block.blockHash}
            blockIndex={block.blockIndex}
            showDownload={false}
          />
        ) : (
          <span className="gc-card__no-image">Image indisponible</span>
        )}
      </div>

      <div className="gc-card__body">
        <div className="gc-card__top">
          <span className="gc-card__index">BLOC #{block.blockIndex}</span>
          <span className="gc-card__age">{formatAge(block.minedAt)}</span>
        </div>
        {title && <div className="gc-card__title">{title}</div>}
        <div className="gc-card__artist">{artistLabel}</div>
        <div className="gc-card__chips">
          <span className="gc-chip">{SCREEN_LABELS[block.poolScreen] ?? block.poolScreen}</span>
          <span className="gc-chip">{block.validatorIds.length} valid.</span>
          {block.drawScore > 0 && <span className="gc-chip gc-chip--score">PoD {block.drawScore}</span>}
          {block.obsConfirmed && <span className="gc-chip gc-chip--obs">obs ✓</span>}
          {block.podHashEnriched && <span className="gc-chip gc-chip--replay">replay ✓</span>}
        </div>
        <div className="gc-card__hash">{block.blockHash.slice(0, 28)}…</div>
      </div>
    </div>
  );
}

// ─── Rejected Row ─────────────────────────────────────────────────────────────

function RejectedRow({ item }: { item: RejectedDraw }) {
  return (
    <div className="gc-rejected-row">
      <div className="gc-rejected-meta">
        <span className="gc-rejected-ts">{formatDate(item.rejectedAt)}</span>
        <span className="gc-chip gc-chip--rejected">Rejeté</span>
        <span className="gc-chip">{SCREEN_LABELS[item.screen] ?? item.screen}</span>
      </div>
      <div className="gc-rejected-info">
        {item.drawArtistName && <span className="gc-rejected-artist">{item.drawArtistName}</span>}
        {item.workTitle && <span className="gc-rejected-title">« {item.workTitle} »</span>}
      </div>
      <div className="gc-rejected-scores">
        <span className="gc-muted">Score PoD : <b>{item.drawScore}</b></span>
        <span className="gc-muted">Complexité : <b>{(item.score * 100).toFixed(2)}%</b></span>
      </div>
      <div className="gc-rejected-reason">
        {item.reason === "low_quality_imported_image"
          ? "Image importée non retravaillée"
          : item.reason}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

type Tab = "blocks" | "rejected";

export function GalleryClient() {
  const [tab, setTab]     = useState<Tab>("blocks");
  const [query, setQuery] = useState("");
  const [screen, setScreen] = useState("");
  const [page, setPage]   = useState(1);
  const LIMIT = 20;

  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<BlocksResponse | null>(null);

  const [rejLoading, setRejLoading]   = useState(false);
  const [rejected, setRejected]       = useState<RejectedDraw[] | null>(null);

  const [selectedBlock, setSelectedBlock] = useState<BlockWithImage | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch blocks ──────────────────────────────────────────────────────────
  const fetchBlocks = useCallback(async (q: string, sc: string, pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: q.trim(),
        screen: sc,
        page: String(pg),
        limit: String(LIMIT),
      });
      const res = await fetch(`/api/blocks?${params}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch rejected ────────────────────────────────────────────────────────
  const fetchRejected = useCallback(async () => {
    setRejLoading(true);
    try {
      const res = await fetch("/api/rejected-draws");
      if (res.ok) {
        const json = await res.json();
        setRejected(json.rejected ?? []);
      }
    } catch {
      setRejected([]);
    } finally {
      setRejLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchBlocks("", "", 1); }, [fetchBlocks]);

  // Debounced query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchBlocks(query, screen, 1);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, screen, fetchBlocks]);

  useEffect(() => {
    if (tab === "rejected" && rejected === null) fetchRejected();
  }, [tab, rejected, fetchRejected]);

  const handlePageChange = (p: number) => {
    setPage(p);
    fetchBlocks(query, screen, p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleClose = useCallback(() => setSelectedBlock(null), []);

  return (
    <div className="gc-shell">
      {/* Header */}
      <div className="gc-topbar">
        <Link href="/" className="gc-back">← Accueil</Link>
        <h1 className="gc-title">
          <span className="gc-title-icon">◈</span>
          Block Explorer
        </h1>
      </div>

      {/* Tab bar */}
      <div className="gc-tabs">
        <button
          className={`gc-tab${tab === "blocks" ? " gc-tab--active" : ""}`}
          onClick={() => setTab("blocks")}
        >
          Blocs validés
        </button>
        <button
          className={`gc-tab${tab === "rejected" ? " gc-tab--active" : ""}`}
          onClick={() => setTab("rejected")}
        >
          Rejetés
        </button>
      </div>

      {/* ── Blocks tab ──────────────────────────────────────────────────────── */}
      {tab === "blocks" && (
        <>
          {/* Search bar */}
          <div className="gc-search-bar">
            <div className="gc-search-wrap">
              <span className="gc-search-icon">⌕</span>
              <input
                ref={inputRef}
                className="gc-search-input"
                type="text"
                placeholder="Hash, titre, artiste, deviceId, numéro de bloc…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              {query && (
                <button className="gc-search-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
                  ✕
                </button>
              )}
            </div>

            <select
              className="gc-screen-select"
              value={screen}
              onChange={(e) => setScreen(e.target.value)}
            >
              <option value="">Tous les écrans</option>
              <option value="eink29bwr">E-Ink 2.9" BWR</option>
              <option value="eink27bw">E-Ink 2.7" BW</option>
              <option value="oled096">OLED 0.96"</option>
            </select>
          </div>

          {/* Stats */}
          {data && !loading && (
            <div className="gc-stats">
              {data.total} bloc{data.total !== 1 ? "s" : ""}
              {query && ` correspondant à « ${query} »`}
              {screen && ` · ${SCREEN_LABELS[screen] ?? screen}`}
              {data.pages > 1 && ` · page ${data.page}/${data.pages}`}
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <div className="gc-loading">
              <span className="gc-spinner" />
              Chargement…
            </div>
          ) : data && data.blocks.length === 0 ? (
            <div className="gc-empty">Aucun bloc trouvé{query ? ` pour « ${query} »` : ""}.</div>
          ) : (
            <div className="gc-grid">
              {(data?.blocks ?? []).map((block) => (
                <BlockCard
                  key={block.blockHash}
                  block={block}
                  onClick={() => setSelectedBlock(block)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {data && data.pages > 1 && (
            <div className="gc-pagination">
              <button
                className="gc-page-btn"
                disabled={data.page <= 1}
                onClick={() => handlePageChange(data.page - 1)}
              >
                ← Précédent
              </button>
              <span className="gc-page-info">
                Page {data.page} / {data.pages}
              </span>
              <button
                className="gc-page-btn"
                disabled={data.page >= data.pages}
                onClick={() => handlePageChange(data.page + 1)}
              >
                Suivant →
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Rejected tab ───────────────────────────────────────────────────── */}
      {tab === "rejected" && (
        <div className="gc-rejected-list">
          {rejLoading ? (
            <div className="gc-loading"><span className="gc-spinner" />Chargement…</div>
          ) : !rejected || rejected.length === 0 ? (
            <div className="gc-empty">Aucun dessin rejeté pour le moment.</div>
          ) : (
            <>
              <div className="gc-stats">{rejected.length} dessin{rejected.length > 1 ? "s" : ""} rejeté{rejected.length > 1 ? "s" : ""} (50 derniers)</div>
              {rejected.map((item, i) => (
                <RejectedRow key={i} item={item} />
              ))}
            </>
          )}
        </div>
      )}

      {/* Modal detail */}
      {selectedBlock && (
        <BlockDetail block={selectedBlock} onClose={handleClose} />
      )}

      <style>{`
        .gc-shell {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px 20px 60px;
          min-height: 100dvh;
        }
        .gc-topbar {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 24px;
        }
        .gc-back {
          font-size: 13px;
          color: var(--text3, #64748b);
          text-decoration: none;
          padding: 5px 10px;
          border: 1px solid var(--border, rgba(255,255,255,0.07));
          border-radius: 8px;
          transition: color 0.12s, background 0.12s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .gc-back:hover { color: var(--text1, #f1f5f9); background: rgba(255,255,255,0.04); }
        .gc-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--text1, #f1f5f9);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .gc-title-icon { color: var(--accent, #7c6bff); }

        .gc-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          margin-bottom: 20px;
        }
        .gc-tab {
          padding: 10px 20px;
          background: none; border: none;
          color: var(--text3, #64748b);
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: color 0.12s, border-color 0.12s;
        }
        .gc-tab--active {
          color: var(--accent, #7c6bff);
          border-bottom-color: var(--accent, #7c6bff);
        }

        /* Search */
        .gc-search-bar {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .gc-search-wrap {
          flex: 1;
          min-width: 200px;
          position: relative;
          display: flex;
          align-items: center;
        }
        .gc-search-icon {
          position: absolute;
          left: 10px;
          font-size: 18px;
          color: var(--text3, #64748b);
          pointer-events: none;
        }
        .gc-search-input {
          width: 100%;
          background: var(--bg2, #1e2533);
          border: 1px solid var(--border, rgba(255,255,255,0.08));
          border-radius: 10px;
          padding: 9px 36px 9px 34px;
          font-size: 13px;
          color: var(--text1, #f1f5f9);
          outline: none;
          transition: border-color 0.15s;
        }
        .gc-search-input:focus { border-color: var(--accent, #7c6bff); }
        .gc-search-input::placeholder { color: var(--text3, #64748b); }
        .gc-search-clear {
          position: absolute;
          right: 10px;
          background: none; border: none;
          color: var(--text3, #64748b);
          cursor: pointer; font-size: 14px; padding: 0;
        }
        .gc-screen-select {
          background: var(--bg2, #1e2533);
          border: 1px solid var(--border, rgba(255,255,255,0.08));
          border-radius: 10px;
          padding: 9px 12px;
          font-size: 13px;
          color: var(--text1, #f1f5f9);
          outline: none;
          cursor: pointer;
        }

        .gc-stats {
          font-size: 12px;
          color: var(--text3, #64748b);
          margin-bottom: 16px;
        }

        /* Grid */
        .gc-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 14px;
        }

        /* Card */
        .gc-card {
          background: var(--bg2, #1e2533);
          border: 1px solid var(--border, rgba(255,255,255,0.06));
          border-radius: 12px;
          overflow: hidden;
          transition: border-color 0.15s, transform 0.1s;
          cursor: pointer;
        }
        .gc-card:hover { border-color: rgba(124,107,255,0.3); transform: translateY(-1px); }
        .gc-card:focus-visible { outline: 2px solid var(--accent, #7c6bff); outline-offset: 2px; }
        .gc-card__preview {
          background: #fff;
          display: flex; align-items: center; justify-content: center;
          min-height: 70px; padding: 10px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .gc-card__no-image { font-size: 11px; color: #94a3b8; }
        .gc-card__body { padding: 10px 12px; }
        .gc-card__top {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 3px;
        }
        .gc-card__index { font-size: 11px; font-weight: 700; color: var(--accent, #7c6bff); font-family: monospace; }
        .gc-card__age   { font-size: 11px; color: var(--text3, #64748b); }
        .gc-card__title {
          font-size: 12px; font-weight: 700;
          color: var(--text1, #f1f5f9);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-bottom: 1px;
        }
        .gc-card__artist {
          font-size: 11px; color: var(--text2, #94a3b8);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-bottom: 6px;
        }
        .gc-card__chips {
          display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px;
        }
        .gc-card__hash {
          font-size: 10px; font-family: monospace;
          color: var(--text3, #64748b);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* Chips */
        .gc-chip {
          font-size: 10px; padding: 2px 6px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.08);
          color: var(--text2, #94a3b8);
          background: var(--bg3, #151c2c);
        }
        .gc-chip--score   { color: #4ade80; border-color: rgba(74,222,128,0.2); }
        .gc-chip--obs     { color: #fbbf24; border-color: rgba(251,191,36,0.2); }
        .gc-chip--replay  { color: #60a5fa; border-color: rgba(96,165,250,0.2); }
        .gc-chip--rejected { color: #f87171; border-color: rgba(248,113,113,0.2); }

        /* Pagination */
        .gc-pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-top: 32px;
        }
        .gc-page-btn {
          background: var(--bg2, #1e2533);
          border: 1px solid var(--border, rgba(255,255,255,0.08));
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 13px; font-weight: 600;
          color: var(--text1, #f1f5f9);
          cursor: pointer;
          transition: background 0.12s;
        }
        .gc-page-btn:disabled { opacity: 0.35; cursor: default; }
        .gc-page-btn:not(:disabled):hover { background: rgba(255,255,255,0.07); }
        .gc-page-info { font-size: 12px; color: var(--text3, #64748b); }

        /* Loading / empty */
        .gc-loading {
          display: flex; align-items: center; gap: 10px;
          color: var(--text3, #64748b); font-size: 13px;
          padding: 40px 0; justify-content: center;
        }
        .gc-spinner {
          display: inline-block;
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.1);
          border-top-color: var(--accent, #7c6bff);
          border-radius: 50%;
          animation: gc-spin 0.7s linear infinite;
        }
        @keyframes gc-spin { to { transform: rotate(360deg); } }
        .gc-empty {
          text-align: center;
          padding: 60px 20px;
          color: var(--text3, #64748b);
          font-size: 14px;
        }

        /* Rejected tab */
        .gc-rejected-list { display: flex; flex-direction: column; gap: 8px; }
        .gc-rejected-row {
          background: var(--bg2, #1e2533);
          border: 1px solid rgba(248,113,113,0.12);
          border-radius: 10px;
          padding: 12px 16px;
          display: flex; flex-direction: column; gap: 4px;
        }
        .gc-rejected-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .gc-rejected-ts { font-size: 11px; color: var(--text3, #64748b); font-family: monospace; }
        .gc-rejected-info { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
        .gc-rejected-artist { font-size: 13px; font-weight: 600; color: var(--text1, #f1f5f9); }
        .gc-rejected-title  { font-size: 12px; color: var(--text2, #94a3b8); font-style: italic; }
        .gc-rejected-scores { display: flex; gap: 16px; font-size: 11px; }
        .gc-rejected-reason { font-size: 11px; color: #f87171; margin-top: 2px; }
        .gc-muted { font-size: 11px; color: var(--text3, #64748b); }
        .gc-muted b { color: var(--text2, #94a3b8); }
      `}</style>
    </div>
  );
}
