"use client";

// app/artists/page.tsx — Annuaire des artistes du réseau Proof-of-Draw

import { useEffect, useState } from "react";
import Link from "next/link";
import { BlockFrameCanvas } from "@/app/BlockFrameCanvas";
import type { BlockImagePayload } from "@/lib/chain";

interface ArtistSummary {
  artistId:    string;
  displayName: string;
  bio?:        string;
  profileImageBlockHash?: string;
  profileImageCrop?: { cx: number; cy: number; zoom: number };
  createdAt:   number;
  deviceCount: number;
}

// Dimensions CSS d'affichage par type d'écran — identiques à BlockFrameCanvas.tsx
// et à la page profil/fiche artiste : la cohérence ici est ce qui garantit que
// le recadrage choisi par l'artiste corresponde à ce qui est affiché ensuite.
const DISPLAY_SIZES: Record<string, { w: number; h: number }> = {
  eink29bwr: { w: 222, h: 96  },
  eink27bw:  { w: 132, h: 88  },
  oled096:   { w: 128, h: 64  },
  tft18:     { w: 128, h: 160 },
};

const AVATAR_SIZE = 56;

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

function timeSince(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 86400) return "aujourd'hui";
  const d = Math.floor(s / 86400);
  if (d < 30)   return `il y a ${d}j`;
  if (d < 365)  return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${Math.floor(d / 365)} an${Math.floor(d / 365) > 1 ? "s" : ""}`;
}

function ArtistAvatar({ artist }: { artist: ArtistSummary }) {
  const [imagePayload, setImagePayload] = useState<BlockImagePayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!artist.profileImageBlockHash) { setLoaded(true); return; }
    fetch(`/api/block-image?hash=${artist.profileImageBlockHash}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setImagePayload(d?.imagePayload ?? null); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [artist.profileImageBlockHash]);

  if (!loaded) {
    return (
      <div style={{
        width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
        background: "var(--bg3)", border: "2px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text3)" }}>…</span>
      </div>
    );
  }

  if (imagePayload) {
    // Même transformation "cover + recadrage" que sur la page profil et la
    // fiche artiste — sans cela le cadrage choisi par l'artiste ne correspond
    // pas à la vignette affichée ici (l'image apparaissait toujours brute,
    // juste réduite à l'échelle, sans tenir compte de cx/cy/zoom).
    const { tx, ty, scale } = coverTransform(imagePayload.screen, artist.profileImageCrop);
    return (
      <div style={{
        width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
        border: "2px solid var(--accent)", background: "var(--bg3)",
        overflow: "hidden", position: "relative",
      }}>
        <div style={{
          position: "absolute", transformOrigin: "top left",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          pointerEvents: "none",
        }}>
          <BlockFrameCanvas payload={imagePayload} />
        </div>
      </div>
    );
  }

  // Initiale fallback
  const initials = artist.displayName
    .split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  return (
    <div style={{
      width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "1.1rem", fontWeight: 800, color: "#fff",
      border: "2px solid transparent",
    }}>
      {initials || "🎨"}
    </div>
  );
}

function ArtistCard({ artist }: { artist: ArtistSummary }) {
  return (
    <Link href={`/artists/${artist.artistId}`} style={{ textDecoration: "none" }}>
      <div
        style={{
          padding: "1.1rem 1.25rem",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--bg2)",
          display: "flex", alignItems: "center", gap: "1rem",
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
        }}
        className="artist-card"
      >
        <ArtistAvatar artist={artist} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.15rem",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {artist.displayName}
          </div>
          {artist.bio && (
            <div style={{
              fontSize: "0.78rem", color: "var(--text3)", lineHeight: 1.4,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>
              {artist.bio}
            </div>
          )}
          <div style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: "0.3rem" }}>
            {artist.deviceCount} ESP · membre {timeSince(artist.createdAt)}
          </div>
        </div>

        <div style={{
          fontSize: "0.8rem", color: "var(--text3)", flexShrink: 0,
          fontFamily: "JetBrains Mono, monospace",
        }}>
          →
        </div>
      </div>
    </Link>
  );
}

export default function ArtistsPage() {
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");

  useEffect(() => {
    fetch("/api/artists")
      .then((r) => r.json())
      .then((d) => setArtists(d.artists ?? []))
      .catch(() => setArtists([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = artists.filter((a) =>
    a.displayName.toLowerCase().includes(search.toLowerCase()) ||
    (a.bio ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* En-tête */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
          Artistes du réseau
        </h1>
        <p style={{ color: "var(--text3)", marginTop: "0.5rem", marginBottom: 0, fontSize: "0.9rem" }}>
          {artists.length} artiste{artists.length !== 1 ? "s" : ""} enregistré{artists.length !== 1 ? "s" : ""} sur Proof-of-Draw.
        </p>
      </div>

      {/* Recherche */}
      {artists.length > 4 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <input
            type="text"
            placeholder="Rechercher un artiste…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "0.6rem 1rem", borderRadius: 8,
              border: "1px solid var(--border)", background: "var(--bg2)",
              color: "var(--text)", fontSize: "0.9rem", outline: "none",
            }}
          />
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--text3)" }}>
          Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "4rem 2rem",
          border: "1px dashed var(--border)", borderRadius: 12,
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🎨</div>
          {search ? (
            <p style={{ color: "var(--text3)" }}>Aucun artiste ne correspond à &ldquo;{search}&rdquo;.</p>
          ) : (
            <>
              <p style={{ color: "var(--text2)", marginBottom: "0.5rem" }}>
                Aucun artiste enregistré pour l&apos;instant.
              </p>
              <p style={{ color: "var(--text3)", fontSize: "0.8rem" }}>
                Connectez un ESP et créez votre profil pour apparaître ici.
              </p>
              <Link href="/onboard" style={{
                display: "inline-block", marginTop: "1rem",
                padding: "0.5rem 1.2rem", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                fontWeight: 600, fontSize: "0.85rem",
              }}>
                Connecter un ESP
              </Link>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filtered.map((a) => (
            <ArtistCard key={a.artistId} artist={a} />
          ))}
        </div>
      )}

      <style>{`
        .artist-card:hover {
          border-color: var(--accent) !important;
          background: var(--bg3) !important;
        }
      `}</style>
    </div>
  );
}
