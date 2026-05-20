"use client";

// app/BlockGalleryClient.tsx
// Galerie interactive côté client — cartes cliquables + modal BlockDetail.
// Axe 2 : workTitle / drawArtistName / deviceOwnerName.
// Axe 5 : modal avec 3 onglets (Détails, Actions, Replay).

import { useState, useCallback } from "react";
import Link from "next/link";
import type { BlockWithImage } from "@/lib/chain";
import { BlockFrameCanvas } from "./BlockFrameCanvas";
import { BlockDetail } from "./BlockDetail";

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
  tft18:     'TFT 1.8" RGB',
};

function BlockCard({ block, onClick }: { block: BlockWithImage; onClick: () => void }) {
  // Axe 2 : affichage de l'artiste
  const artistLabel = block.drawArtistName
    ? `${block.drawArtistName} sur ESP de ${block.deviceOwnerName ?? block.artistName}`
    : (block.artistName || "Artiste inconnu");

  const title = block.workTitle && block.workTitle !== "Sans titre"
    ? block.workTitle
    : null;

  return (
    <div
      className="block-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      aria-label={`Bloc #${block.blockIndex} — ${artistLabel}`}
    >
      <div className="block-card__preview">
        {block.imagePayload ? (
          <BlockFrameCanvas
            payload={block.imagePayload}
            blockHash={block.blockHash}
            blockIndex={block.blockIndex}
            showDownload={false}
          />
        ) : (
          <span className="block-card__no-image">Image non disponible</span>
        )}
      </div>

      <div className="block-card__body">
        <div className="block-card__top">
          <span className="block-card__index">BLOC #{block.blockIndex}</span>
          <span className="block-card__age">{formatAge(block.minedAt)}</span>
        </div>

        {title && (
          <div className="block-card__title">{title}</div>
        )}

        <div className="block-card__artist">{artistLabel}</div>

        <div className="block-card__meta">
          <span className="block-card__chip">{SCREEN_LABELS[block.poolScreen] ?? block.poolScreen}</span>
          <span className="block-card__chip">{block.validatorIds.length} validateur{block.validatorIds.length > 1 ? "s" : ""}</span>
          {block.drawScore > 0 && (
            <span className="block-card__chip block-card__chip--score">PoD {block.drawScore}</span>
          )}
          {block.podHashEnriched && (
            <span className="block-card__chip block-card__chip--enriched">replay ✓</span>
          )}
        </div>

        <div className="block-card__hashes">
          <div className="block-card__hash-row">
            <span className="block-card__hash-label">hash</span>
            <span className="block-card__hash-value">{block.blockHash.slice(0, 20)}…</span>
          </div>
          <div className="block-card__hash-row">
            <span className="block-card__hash-label">image</span>
            <span className="block-card__hash-value">{block.imageHash.slice(0, 20)}…</span>
          </div>
          {block.actionsHash && (
            <div className="block-card__hash-row">
              <span className="block-card__hash-label">actions</span>
              <span className="block-card__hash-value">{block.actionsHash.slice(0, 20)}…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BlockGalleryClient({ blocks }: { blocks: BlockWithImage[] }) {
  const [selectedBlock, setSelectedBlock] = useState<BlockWithImage | null>(null);

  const handleClose = useCallback(() => setSelectedBlock(null), []);

  return (
    <section className="block-gallery">
      <div className="block-gallery__header">
        <h2 className="block-gallery__title">
          <span className="block-gallery__icon">◈</span>
          Blocs récents
        </h2>
        <span className="block-gallery__count">{blocks.length} bloc{blocks.length > 1 ? "s" : ""}</span>
        <Link href="/gallery" className="block-gallery__explorer-link">
          Voir tout →
        </Link>
      </div>

      <div className="block-gallery__grid">
        {blocks.map((block) => (
          <BlockCard
            key={block.blockHash}
            block={block}
            onClick={() => setSelectedBlock(block)}
          />
        ))}
      </div>

      {/* Modal BlockDetail */}
      {selectedBlock && (
        <BlockDetail block={selectedBlock} onClose={handleClose} />
      )}

      <style>{`
        .block-gallery {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 32px 24px 48px;
        }
        .block-gallery__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .block-gallery__title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text1, #f1f5f9);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .block-gallery__icon { color: var(--accent, #7c6bff); }
        .block-gallery__count {
          font-size: 12px;
          color: var(--text3, #64748b);
          background: var(--bg2, #1e2533);
          border: 1px solid var(--border, rgba(255,255,255,0.06));
          padding: 3px 10px;
          border-radius: 20px;
        }
        .block-gallery__explorer-link {
          font-size: 12px;
          color: var(--accent, #7c6bff);
          text-decoration: none;
          padding: 3px 10px;
          border: 1px solid rgba(124,107,255,0.2);
          border-radius: 20px;
          transition: background 0.12s;
        }
        .block-gallery__explorer-link:hover { background: rgba(124,107,255,0.08); }
        .block-gallery__grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        .block-card {
          background: var(--bg2, #1e2533);
          border: 1px solid var(--border, rgba(255,255,255,0.06));
          border-radius: 12px;
          overflow: hidden;
          transition: border-color 0.15s, transform 0.1s;
          cursor: pointer;
        }
        .block-card:hover {
          border-color: rgba(124, 107, 255, 0.3);
          transform: translateY(-1px);
        }
        .block-card:focus-visible {
          outline: 2px solid var(--accent, #7c6bff);
          outline-offset: 2px;
        }
        .block-card__preview {
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 80px;
          padding: 12px;
          border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
        }
        .block-card__no-image { font-size: 11px; color: #94a3b8; }
        .block-card__body { padding: 12px 14px; }
        .block-card__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .block-card__index {
          font-size: 11px; font-weight: 700;
          color: var(--accent, #7c6bff); font-family: monospace;
        }
        .block-card__age { font-size: 11px; color: var(--text3, #64748b); }
        .block-card__title {
          font-size: 13px; font-weight: 700;
          color: var(--text1, #f1f5f9);
          margin-bottom: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .block-card__artist {
          font-size: 12px; color: var(--text2, #94a3b8);
          margin-bottom: 8px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .block-card__meta {
          display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;
        }
        .block-card__chip {
          font-size: 10px; padding: 2px 7px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.08);
          color: var(--text2, #94a3b8);
          background: var(--bg3, #151c2c);
        }
        .block-card__chip--score { color: #4ade80; border-color: rgba(74,222,128,0.2); }
        .block-card__chip--enriched { color: #60a5fa; border-color: rgba(96,165,250,0.2); }
        .block-card__hashes {
          font-size: 10px; font-family: monospace;
          color: var(--text3, #64748b);
          display: flex; flex-direction: column; gap: 2px;
          border-top: 1px solid rgba(255,255,255,0.04);
          padding-top: 8px; margin-top: 4px;
        }
        .block-card__hash-row { display: flex; gap: 4px; align-items: center; }
        .block-card__hash-label {
          color: var(--text3, #64748b); flex-shrink: 0; width: 52px;
        }
        .block-card__hash-value {
          color: var(--text2, #94a3b8);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
      `}</style>
    </section>
  );
}
