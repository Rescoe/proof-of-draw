// app/BlockGallery.tsx
// Galerie des blocs minés récemment — Server Component avec images persistantes.
// Les images sont stockées dans chain:image:{hash} sans TTL (permanentes).

import { getRecentBlocksCached, BlockWithImage, BlockImagePayload } from "@/lib/chain";
import { BlockFrameCanvas } from "./BlockFrameCanvas";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
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

export async function BlockGallery() {
  let blocks: BlockWithImage[] = [];
  try {
    blocks = await getRecentBlocksCached();
  } catch {
    return null;
  }

  if (blocks.length === 0) return null;

  return (
    <section className="block-gallery">
      <div className="block-gallery__header">
        <h2 className="block-gallery__title">
          <span className="block-gallery__icon">◈</span>
          Blocs récents
        </h2>
        <span className="block-gallery__count">{blocks.length} bloc{blocks.length > 1 ? "s" : ""}</span>
      </div>

      <div className="block-gallery__grid">
        {blocks.map((block) => (
          <BlockCard key={block.blockHash} block={block} />
        ))}
      </div>

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
        .block-gallery__icon {
          color: var(--accent, #7c6bff);
        }
        .block-gallery__count {
          font-size: 12px;
          color: var(--text3, #64748b);
          background: var(--bg2, #1e2533);
          border: 1px solid var(--border, rgba(255,255,255,0.06));
          padding: 3px 10px;
          border-radius: 20px;
        }
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
          transition: border-color 0.15s;
        }
        .block-card:hover {
          border-color: rgba(124, 107, 255, 0.3);
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
        .block-card__no-image {
          font-size: 11px;
          color: #94a3b8;
        }
        .block-card__body {
          padding: 12px 14px;
        }
        .block-card__top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 6px;
        }
        .block-card__index {
          font-size: 11px;
          font-weight: 700;
          color: var(--accent, #7c6bff);
          font-family: monospace;
        }
        .block-card__age {
          font-size: 11px;
          color: var(--text3, #64748b);
        }
        .block-card__artist {
          font-size: 14px;
          font-weight: 600;
          color: var(--text1, #f1f5f9);
          margin-bottom: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .block-card__meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .block-card__chip {
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.08);
          color: var(--text2, #94a3b8);
          background: var(--bg3, #151c2c);
        }
        .block-card__chip--score {
          color: #4ade80;
          border-color: rgba(74, 222, 128, 0.2);
        }
        .block-card__hashes {
          font-size: 10px;
          font-family: monospace;
          color: var(--text3, #64748b);
          display: flex;
          flex-direction: column;
          gap: 2px;
          border-top: 1px solid rgba(255,255,255,0.04);
          padding-top: 8px;
          margin-top: 4px;
        }
        .block-card__hash-row {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .block-card__hash-label {
          color: var(--text3, #64748b);
          flex-shrink: 0;
          width: 52px;
        }
        .block-card__hash-value {
          color: var(--text2, #94a3b8);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </section>
  );
}

function BlockCard({ block }: { block: BlockWithImage }) {
  return (
    <div className="block-card">
      <div className="block-card__preview">
        {block.imagePayload ? (
          <BlockFrameCanvas payload={block.imagePayload} />
        ) : (
          <span className="block-card__no-image">Image non disponible</span>
        )}
      </div>

      <div className="block-card__body">
        <div className="block-card__top">
          <span className="block-card__index">BLOC #{block.blockIndex}</span>
          <span className="block-card__age">{formatAge(block.minedAt)}</span>
        </div>

        <div className="block-card__artist">{block.artistName || "Artiste inconnu"}</div>

        <div className="block-card__meta">
          <span className="block-card__chip">{SCREEN_LABELS[block.poolScreen] ?? block.poolScreen}</span>
          <span className="block-card__chip">{block.validatorIds.length} validateur{block.validatorIds.length > 1 ? "s" : ""}</span>
          {block.drawScore > 0 && (
            <span className="block-card__chip block-card__chip--score">score PoD {block.drawScore}</span>
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
