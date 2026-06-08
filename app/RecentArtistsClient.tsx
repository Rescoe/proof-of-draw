"use client";

// app/RecentArtistsClient.tsx — rendu client du bandeau "derniers artistes inscrits"
// Avatar recadré avec la même transformation "cover + crop" que la page profil
// et la fiche artiste (cf. coverTransform dans app/artists/page.tsx) — sinon le
// recadrage choisi par l'artiste ne correspondrait pas à la vignette affichée ici.

import Link from "next/link";
import { BlockFrameCanvas } from "./BlockFrameCanvas";
import type { RecentArtistSummary } from "./RecentArtists";

const DISPLAY_SIZES: Record<string, { w: number; h: number }> = {
  eink29bwr: { w: 222, h: 96  },
  eink27bw:  { w: 132, h: 88  },
  oled096:   { w: 128, h: 64  },
  tft18:     { w: 128, h: 160 },
};

const AVATAR_SIZE = 52;

function coverTransform(screen: string, crop?: { cx: number; cy: number; zoom: number }) {
  const ds = DISPLAY_SIZES[screen] ?? { w: 128, h: 128 };
  const coverScale = Math.max(AVATAR_SIZE / ds.w, AVATAR_SIZE / ds.h);
  const zoom  = crop?.zoom ?? 1;
  const scale = coverScale * zoom;
  const cx = crop?.cx ?? 0.5;
  const cy = crop?.cy ?? 0.5;
  return {
    tx: AVATAR_SIZE / 2 - cx * ds.w * scale,
    ty: AVATAR_SIZE / 2 - cy * ds.h * scale,
    scale,
  };
}

function ArtistMiniAvatar({ artist }: { artist: RecentArtistSummary }) {
  if (artist.imagePayload) {
    const { tx, ty, scale } = coverTransform(artist.imagePayload.screen, artist.profileImageCrop);
    return (
      <div style={{
        width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: "50%", flexShrink: 0,
        border: "2px solid var(--accent)", background: "var(--bg3)",
        overflow: "hidden", position: "relative",
      }}>
        <div style={{
          position: "absolute", transformOrigin: "top left",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          pointerEvents: "none",
        }}>
          <BlockFrameCanvas payload={artist.imagePayload} />
        </div>
      </div>
    );
  }

  const initials = artist.displayName
    .split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  return (
    <div style={{
      width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "0.95rem", fontWeight: 800, color: "#fff",
    }}>
      {initials || "🎨"}
    </div>
  );
}

export function RecentArtistsClient({ artists }: { artists: RecentArtistSummary[] }) {
  return (
    <section className="recent-artists">
      <div className="recent-artists__head">
        <h2 className="recent-artists__title">Derniers artistes inscrits</h2>
        <Link href="/artists" className="recent-artists__more">
          Voir tous les artistes →
        </Link>
      </div>

      <div className="recent-artists__row">
        {artists.map((a) => (
          <Link key={a.artistId} href={`/artists/${a.artistId}`} className="recent-artists__card">
            <ArtistMiniAvatar artist={a} />
            <span className="recent-artists__name">{a.displayName}</span>
          </Link>
        ))}
      </div>

      <style>{`
        .recent-artists { margin-top: 1.5rem; }
        .recent-artists__head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 0.9rem;
        }
        .recent-artists__title {
          font-size: 1rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0;
          color: var(--text1, #f1f5f9);
        }
        .recent-artists__more {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--accent);
          text-decoration: none;
          white-space: nowrap;
        }
        .recent-artists__more:hover { text-decoration: underline; }
        .recent-artists__row {
          display: flex;
          gap: 0.9rem;
          overflow-x: auto;
          padding-bottom: 0.4rem;
          scrollbar-width: thin;
        }
        .recent-artists__card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          text-decoration: none;
          flex-shrink: 0;
          width: 84px;
        }
        .recent-artists__name {
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--text2, #cbd5e1);
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 84px;
        }
      `}</style>
    </section>
  );
}
