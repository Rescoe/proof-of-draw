"use client";

// app/gallery-ana/AnaGalleryClient.tsx
// Galerie "Dessins d'agent IA" — même structure que app/gallery/GalleryClient.tsx
// (recherche + pagination), mais sur /api/blocks-ana (index chain:ana:recent,
// entièrement séparé des blocs humains) et sans onglet "Rejetés" (n'existe
// pas pour ce flux : le contenu est déjà modéré côté ANA avant d'arriver ici).

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type { BlockWithImage } from "@/lib/chain";
import { BlockFrameCanvas } from "../BlockFrameCanvas";
import { BlockDetail } from "../BlockDetail";

interface BlocksResponse {
  blocks: BlockWithImage[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

function formatAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60)    return `${sec}s`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}j`;
}

const SCREEN_LABELS: Record<string, string> = {
  eink29bwr: 'E-Ink 2.9" BWR',
  eink27bw:  'E-Ink 2.7" BW',
  oled096:   'OLED 0.96"',
};

function AnaCard({ block, onClick }: { block: BlockWithImage; onClick: () => void }) {
  const agentLabel = block.drawArtistName || block.artistName || "Agent inconnu";
  const title = block.workTitle && block.workTitle !== "Sans titre" ? block.workTitle : null;

  return (
    <div
      className="ag-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      aria-label={`Dessin d'agent — ${agentLabel}`}
    >
      <div className="ag-card__preview">
        {block.imagePayload ? (
          <BlockFrameCanvas
            payload={block.imagePayload}
            blockHash={block.blockHash}
            blockIndex={block.blockIndex}
            showDownload={false}
          />
        ) : (
          <span className="ag-card__no-image">Image indisponible</span>
        )}
      </div>
      <div className="ag-card__body">
        <div className="ag-card__top">
          <span className="ag-card__badge">AGENT IA</span>
          <span className="ag-card__age">{formatAge(block.minedAt)}</span>
        </div>
        {title && <div className="ag-card__title">{title}</div>}
        <div className="ag-card__artist">{agentLabel}</div>
        <span className="ag-chip">{SCREEN_LABELS[block.poolScreen] ?? block.poolScreen}</span>
      </div>
    </div>
  );
}

export function AnaGalleryClient() {
  const [query, setQuery]   = useState("");
  const [screen, setScreen] = useState("");
  const [page, setPage]     = useState(1);
  const LIMIT = 20;

  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<BlocksResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const [selectedBlock, setSelectedBlock] = useState<BlockWithImage | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBlocks = useCallback(async (q: string, sc: string, pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim(), screen: sc, page: String(pg), limit: String(LIMIT) });
      const res = await fetch(`/api/blocks-ana?${params}`);
      if (res.ok) setData(await res.json());
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBlocks("", "", 1); }, [fetchBlocks]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchBlocks(query, screen, 1);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, screen, fetchBlocks]);

  const handlePageChange = (p: number) => {
    setPage(p);
    fetchBlocks(query, screen, p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCheckNow = useCallback(async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/ana-art/check", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      setCheckResult(
        res.ok
          ? `${json.ingested ?? 0} nouvelle${(json.ingested ?? 0) > 1 ? "s" : ""} œuvre${(json.ingested ?? 0) > 1 ? "s" : ""} (${json.checked ?? 0} vue${(json.checked ?? 0) > 1 ? "s" : ""} côté ANA)`
          : "Vérification indisponible",
      );
      fetchBlocks(query, screen, page);
    } catch {
      setCheckResult("Vérification indisponible");
    } finally {
      setChecking(false);
    }
  }, [fetchBlocks, query, screen, page]);

  const handleClose = useCallback(() => setSelectedBlock(null), []);

  return (
    <div className="ag-shell">
      <div className="ag-topbar">
        <Link href="/" className="ag-back">← Accueil</Link>
        <h1 className="ag-title"><span className="ag-title-icon">◈</span>Dessins d'agent IA</h1>
        <button className="ag-check-btn" onClick={handleCheckNow} disabled={checking}>
          {checking ? "Vérification…" : "Vérifier maintenant"}
        </button>
      </div>
      {checkResult && <div className="ag-check-result">{checkResult}</div>}

      <p className="ag-intro">
        Œuvres dessinées à la main par des agents normies de l'ANA (célébrations de burn, dessins spontanés),
        modérées côté ANA puis diffusées sur les écrans ayant activé la réception d'œuvres IA. Séparées de la{" "}
        <Link href="/gallery">galerie principale</Link>, qui reste réservée aux dessins humains.
      </p>

      <div className="ag-search-bar">
        <div className="ag-search-wrap">
          <span className="ag-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="ag-search-input"
            type="text"
            placeholder="Titre, agent, hash…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button className="ag-search-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>✕</button>
          )}
        </div>
        <select className="ag-screen-select" value={screen} onChange={(e) => setScreen(e.target.value)}>
          <option value="">Tous les écrans</option>
          <option value="eink29bwr">E-Ink 2.9" BWR</option>
          <option value="eink27bw">E-Ink 2.7" BW</option>
          <option value="oled096">OLED 0.96"</option>
        </select>
      </div>

      {data && !loading && (
        <div className="ag-stats">
          {data.total} dessin{data.total !== 1 ? "s" : ""}
          {query && ` correspondant à « ${query} »`}
          {screen && ` · ${SCREEN_LABELS[screen] ?? screen}`}
          {data.pages > 1 && ` · page ${data.page}/${data.pages}`}
        </div>
      )}

      {loading ? (
        <div className="ag-loading"><span className="ag-spinner" />Chargement…</div>
      ) : data && data.blocks.length === 0 ? (
        <div className="ag-empty">Aucun dessin d'agent IA pour l'instant.</div>
      ) : (
        <div className="ag-grid">
          {(data?.blocks ?? []).map((block) => (
            <AnaCard key={block.blockHash} block={block} onClick={() => setSelectedBlock(block)} />
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="ag-pagination">
          <button className="ag-page-btn" disabled={data.page <= 1} onClick={() => handlePageChange(data.page - 1)}>← Précédent</button>
          <span className="ag-page-info">Page {data.page} / {data.pages}</span>
          <button className="ag-page-btn" disabled={data.page >= data.pages} onClick={() => handlePageChange(data.page + 1)}>Suivant →</button>
        </div>
      )}

      {selectedBlock && <BlockDetail block={selectedBlock} onClose={handleClose} />}

      <style>{`
        .ag-shell { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; min-height: 100dvh; }
        .ag-topbar { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
        .ag-back {
          font-size: 13px; color: var(--text3, #64748b); text-decoration: none;
          padding: 5px 10px; border: 1px solid var(--border, rgba(255,255,255,0.07));
          border-radius: 8px; transition: color 0.12s, background 0.12s; white-space: nowrap; flex-shrink: 0;
        }
        .ag-back:hover { color: var(--text1, #f1f5f9); background: rgba(255,255,255,0.04); }
        .ag-title {
          font-size: 22px; font-weight: 700; color: var(--text1, #f1f5f9); margin: 0;
          display: flex; align-items: center; gap: 8px; flex: 1;
        }
        .ag-title-icon { color: var(--accent, #7c6bff); }
        .ag-check-btn {
          background: var(--bg2, #1e2533); border: 1px solid var(--border, rgba(255,255,255,0.08));
          border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600;
          color: var(--text1, #f1f5f9); cursor: pointer; transition: background 0.12s;
        }
        .ag-check-btn:not(:disabled):hover { background: rgba(124,107,255,0.12); }
        .ag-check-btn:disabled { opacity: 0.5; cursor: default; }
        .ag-check-result { font-size: 12px; color: var(--text2, #94a3b8); margin-bottom: 8px; }
        .ag-intro { font-size: 12px; color: var(--text3, #64748b); margin: 4px 0 20px; line-height: 1.6; max-width: 720px; }
        .ag-intro a { color: var(--accent, #7c6bff); }

        .ag-search-bar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .ag-search-wrap { flex: 1; min-width: 200px; position: relative; display: flex; align-items: center; }
        .ag-search-icon { position: absolute; left: 10px; font-size: 18px; color: var(--text3, #64748b); pointer-events: none; }
        .ag-search-input {
          width: 100%; background: var(--bg2, #1e2533); border: 1px solid var(--border, rgba(255,255,255,0.08));
          border-radius: 10px; padding: 9px 36px 9px 34px; font-size: 13px; color: var(--text1, #f1f5f9);
          outline: none; transition: border-color 0.15s;
        }
        .ag-search-input:focus { border-color: var(--accent, #7c6bff); }
        .ag-search-clear { position: absolute; right: 10px; background: none; border: none; color: var(--text3, #64748b); cursor: pointer; font-size: 14px; padding: 0; }
        .ag-screen-select {
          background: var(--bg2, #1e2533); border: 1px solid var(--border, rgba(255,255,255,0.08));
          border-radius: 10px; padding: 9px 12px; font-size: 13px; color: var(--text1, #f1f5f9); outline: none; cursor: pointer;
        }
        .ag-stats { font-size: 12px; color: var(--text3, #64748b); margin-bottom: 16px; }
        .ag-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
        .ag-card {
          background: var(--bg2, #1e2533); border: 1px solid rgba(124,107,255,0.15);
          border-radius: 12px; overflow: hidden; transition: border-color 0.15s, transform 0.1s; cursor: pointer;
        }
        .ag-card:hover { border-color: rgba(124,107,255,0.4); transform: translateY(-1px); }
        .ag-card:focus-visible { outline: 2px solid var(--accent, #7c6bff); outline-offset: 2px; }
        .ag-card__preview {
          background: var(--bg2, #1e2533); display: flex; align-items: center; justify-content: center;
          min-height: 70px; padding: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .ag-card__no-image { font-size: 11px; color: #94a3b8; }
        .ag-card__body { padding: 10px 12px; }
        .ag-card__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .ag-card__badge {
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: #7c6bff;
          background: rgba(124,107,255,0.12); border-radius: 20px; padding: 2px 8px;
        }
        .ag-card__age { font-size: 11px; color: var(--text3, #64748b); }
        .ag-card__title {
          font-size: 12px; font-weight: 700; color: var(--text1, #f1f5f9);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 1px;
        }
        .ag-card__artist {
          font-size: 11px; color: var(--text2, #94a3b8);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px;
        }
        .ag-chip { font-size: 10px; padding: 2px 6px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); color: var(--text2, #94a3b8); background: var(--bg3, #151c2c); }
        .ag-pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 32px; }
        .ag-page-btn {
          background: var(--bg2, #1e2533); border: 1px solid var(--border, rgba(255,255,255,0.08));
          border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; color: var(--text1, #f1f5f9);
          cursor: pointer; transition: background 0.12s;
        }
        .ag-page-btn:disabled { opacity: 0.35; cursor: default; }
        .ag-page-btn:not(:disabled):hover { background: rgba(255,255,255,0.07); }
        .ag-page-info { font-size: 12px; color: var(--text3, #64748b); }
        .ag-loading { display: flex; align-items: center; gap: 10px; color: var(--text3, #64748b); font-size: 13px; padding: 40px 0; justify-content: center; }
        .ag-spinner {
          display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.1);
          border-top-color: var(--accent, #7c6bff); border-radius: 50%; animation: ag-spin 0.7s linear infinite;
        }
        @keyframes ag-spin { to { transform: rotate(360deg); } }
        .ag-empty { text-align: center; padding: 60px 20px; color: var(--text3, #64748b); font-size: 14px; }
      `}</style>
    </div>
  );
}
