"use client";

// app/artists/[artistId]/page.tsx — Fiche artiste publique

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { BlockFrameCanvas } from "@/app/BlockFrameCanvas";
import type { BlockImagePayload } from "@/lib/chain";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ArtistProfile {
  artistId:    string;
  slug?:       string;
  displayName: string;
  bio?:        string;
  profileImageBlockHash?: string;
  profileImageCrop?:      { cx: number; cy: number; zoom: number };
  createdAt:   number;
}

const DISPLAY_SIZES_PUB: Record<string, { w: number; h: number }> = {
  eink29bwr: { w: 222, h: 96  },
  eink27bw:  { w: 132, h: 88  },
  oled096:   { w: 128, h: 64  },
  tft18:     { w: 128, h: 160 },
};

function pubCoverTransform(screen: string, size: number, crop?: { cx: number; cy: number; zoom: number }) {
  const ds = DISPLAY_SIZES_PUB[screen] ?? { w: 128, h: 128 };
  const coverScale = Math.max(size / ds.w, size / ds.h);
  const zoom  = crop?.zoom ?? 1;
  const scale = coverScale * zoom;
  const cx = crop?.cx ?? 0.5;
  const cy = crop?.cy ?? 0.5;
  return {
    tx: size / 2 - cx * ds.w * scale,
    ty: size / 2 - cy * ds.h * scale,
    scale,
  };
}

interface ArtistDevice {
  deviceId:   string;
  deviceName?: string;
  screens:    string[];
  firmware:   string;
  isOnline:   boolean;
  framesSent: number;
  publicMode: boolean;
  lastSeen:   number;
}

interface ArtistBlock {
  blockHash:      string;
  blockIndex:     number;
  imageHash:      string;
  workTitle?:     string;
  artistName:     string;
  drawArtistName?: string;
  poolScreen:     string;
  score:          number;
  drawScore:      number;
  minedAt:        number;
  displayTime:    number;
  validatorIds:   string[];
  isArtist:       boolean;
  isMiner:        boolean;
  imagePayload:   BlockImagePayload | null;
}

interface ArtistPageData {
  profile: ArtistProfile;
  devices: ArtistDevice[];
  blocks:  ArtistBlock[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function formatAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60)    return `${sec}s`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}j`;
}

const SCREEN_LABELS: Record<string, string> = {
  eink29bwr: 'E-Ink 2.9" BWR',
  eink27bw:  'E-Ink 2.7" BW',
  oled096:   'OLED 0.96"',
  tft18:     'TFT 1.8" RGB',
};

function isKnownScreen(sid: string): sid is keyof typeof SCREEN_PROFILES {
  return sid in SCREEN_PROFILES;
}

// ── Composant Avatar ──────────────────────────────────────────────────────────

function ProfileAvatar({
  profile,
  blocks,
  size = 80,
}: {
  profile: ArtistProfile;
  blocks: ArtistBlock[];
  size?: number;
}) {
  const selectedBlock = profile.profileImageBlockHash
    ? blocks.find((b) => b.blockHash === profile.profileImageBlockHash) ?? null
    : null;

  if (selectedBlock?.imagePayload) {
    const { tx, ty, scale } = pubCoverTransform(
      selectedBlock.imagePayload.screen,
      size,
      profile.profileImageCrop,
    );
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        border: "3px solid var(--accent)", background: "var(--bg3)",
        overflow: "hidden", position: "relative",
      }}>
        <div style={{
          position: "absolute", transformOrigin: "top left",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          pointerEvents: "none",
        }}>
          <BlockFrameCanvas payload={selectedBlock.imagePayload} unconstrained />
        </div>
      </div>
    );
  }

  const initials = profile.displayName.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: `${size * 0.32}px`, fontWeight: 800, color: "#fff",
      border: "3px solid transparent",
    }}>
      {initials || "🎨"}
    </div>
  );
}

// ── Composant carte de bloc ────────────────────────────────────────────────────

function BlockCard({ block }: { block: ArtistBlock }) {
  const roleLabel = block.isArtist && block.isMiner
    ? "artiste + mineur"
    : block.isArtist ? "artiste" : "mineur";

  const title = block.workTitle && block.workTitle !== "Sans titre"
    ? block.workTitle : null;

  return (
    <Link href={`/gallery?hash=${block.blockHash}`} style={{ textDecoration: "none" }}>
      <div className="ab-card">
        {/* Image */}
        <div className="ab-card__preview">
          {block.imagePayload ? (
            <BlockFrameCanvas
              payload={block.imagePayload}
              blockHash={block.blockHash}
              blockIndex={block.blockIndex}
            />
          ) : (
            <div style={{
              width: 120, height: 80, background: "var(--bg3)",
              borderRadius: 6, display: "flex", alignItems: "center",
              justifyContent: "center", color: "var(--text3)", fontSize: "0.7rem",
            }}>
              Image manquante
            </div>
          )}
        </div>

        {/* Infos */}
        <div className="ab-card__body">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.72rem", color: "var(--text3)" }}>
              BLOC #{block.blockIndex}
            </span>
            <span style={{ fontSize: "0.68rem", color: "var(--text3)" }}>{formatAge(block.minedAt)}</span>
          </div>

          {title && (
            <div style={{ fontWeight: 600, fontSize: "0.82rem", marginTop: "0.2rem",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
            <span className="ab-chip">{SCREEN_LABELS[block.poolScreen] ?? block.poolScreen}</span>
            <span className={`ab-chip ab-chip--${roleLabel.includes("artiste") ? "artist" : "miner"}`}>
              {roleLabel}
            </span>
            {block.drawScore > 0 && (
              <span className="ab-chip ab-chip--pod">PoD {block.drawScore}</span>
            )}
          </div>

          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.65rem", color: "var(--text3)", marginTop: "0.35rem" }}>
            {block.blockHash.slice(0, 20)}…
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Composant carte device ─────────────────────────────────────────────────────

function DeviceCard({ device }: { device: ArtistDevice }) {
  return (
    <div style={{
      padding: "0.9rem 1.1rem", borderRadius: 10,
      border: "1px solid var(--border)", background: "var(--bg2)",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
      flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: device.isOnline ? "#4ade80" : "var(--text3)",
          boxShadow: device.isOnline ? "0 0 6px #4ade80" : "none",
        }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
            {device.deviceName ?? device.deviceId}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text3)", fontFamily: "monospace" }}>
            {device.firmware} · {device.framesSent} frames
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        {device.screens.map((sid) => {
          const profile = isKnownScreen(sid) ? SCREEN_PROFILES[sid] : null;
          return (
            <div key={sid} style={{
              display: "flex", alignItems: "center", gap: "0.35rem",
              padding: "0.25rem 0.6rem", borderRadius: 5,
              border: "1px solid var(--border)", background: "var(--bg)",
              fontSize: "0.73rem", color: "var(--text2)",
            }}>
              {profile?.name ?? sid}
              {profile && (
                <div style={{ display: "flex", gap: 2 }}>
                  {profile.colors.map((c: string) => (
                    <div key={c} style={{
                      width: 7, height: 7, borderRadius: 2,
                      background: c, border: "1px solid rgba(255,255,255,0.1)",
                    }} />
                  ))}
                </div>
              )}
              {device.publicMode && (
                <span style={{ fontSize: "0.6rem", color: "#4ade80", fontWeight: 700 }}>PUBLIC</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function ArtistDetailPage() {
  const params  = useParams();
  const artistId = typeof params.artistId === "string" ? params.artistId : "";

  const [data,    setData]    = useState<ArtistPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [tab,     setTab]     = useState<"blocks" | "devices">("blocks");

  useEffect(() => {
    if (!artistId) return;
    fetch(`/api/artists/${artistId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Artiste introuvable");
        return r.json();
      })
      .then((d) => {
        setData(d);
        // Réécrire l'URL avec le slug si on est arrivé par UUID
        const slug = (d as ArtistPageData).profile.slug;
        if (slug && artistId !== slug && typeof window !== "undefined") {
          window.history.replaceState(null, "", `/artists/${slug}`);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [artistId]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", color: "var(--text3)" }}>
        Chargement…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ maxWidth: 600, margin: "4rem auto", textAlign: "center", padding: "2rem" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔍</div>
        <h2 style={{ fontWeight: 700 }}>Artiste introuvable</h2>
        <p style={{ color: "var(--text3)" }}>{error ?? "Cet artiste n'existe pas."}</p>
        <Link href="/artists" style={{
          display: "inline-block", marginTop: "1rem",
          color: "var(--accent)", fontWeight: 600,
        }}>← Retour aux artistes</Link>
      </div>
    );
  }

  const { profile, devices, blocks } = data;
  const artistBlocks = blocks.filter((b) => b.isArtist);
  const minedBlocks  = blocks.filter((b) => b.isMiner && !b.isArtist);
  const onlineDevices = devices.filter((d) => d.isOnline).length;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Breadcrumb */}
      <div style={{ marginBottom: "1.5rem", fontSize: "0.82rem", color: "var(--text3)" }}>
        <Link href="/artists" style={{ color: "var(--accent)" }}>Artistes</Link>
        <span style={{ margin: "0 0.4rem" }}>›</span>
        {profile.displayName}
      </div>

      {/* ── Carte profil ── */}
      <div style={{
        padding: "1.75rem 2rem", borderRadius: 14,
        border: "1px solid var(--border)", background: "var(--bg2)",
        marginBottom: "2rem",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1.5rem", flexWrap: "wrap" }}>

          <ProfileAvatar
            profile={profile}
            blocks={blocks}
            size={80}
          />

          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 0.3rem" }}>
              {profile.displayName}
            </h1>
            {profile.bio && (
              <p style={{ color: "var(--text2)", fontSize: "0.88rem", lineHeight: 1.55, margin: "0 0 0.75rem" }}>
                {profile.bio}
              </p>
            )}
            <div style={{ fontSize: "0.75rem", color: "var(--text3)" }}>
              Membre depuis {formatDate(profile.createdAt)}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            {[
              { label: "ESP liés",   value: devices.length },
              { label: "En ligne",   value: onlineDevices },
              { label: "Dessins",    value: artistBlocks.length },
              { label: "Blocs minés", value: minedBlocks.length + artistBlocks.filter(b => b.isMiner).length },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{
                  fontSize: "1.3rem", fontWeight: 800,
                  fontFamily: "JetBrains Mono, monospace",
                }}>
                  {s.value}
                </div>
                <div style={{
                  fontSize: "0.65rem", color: "var(--text3)",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Onglets ── */}
      <div style={{
        display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: "1.5rem",
      }}>
        {([
          { key: "blocks",  label: `Blocs (${blocks.length})` },
          { key: "devices", label: `ESP (${devices.length})` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "0.6rem 1.2rem", background: "none", border: "none",
              borderBottom: `2px solid ${tab === key ? "var(--accent)" : "transparent"}`,
              color: tab === key ? "var(--accent)" : "var(--text3)",
              fontWeight: tab === key ? 700 : 500,
              fontSize: "0.875rem", cursor: "pointer",
              transition: "color 0.12s, border-color 0.12s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab Blocs ── */}
      {tab === "blocks" && (
        blocks.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "3rem 2rem",
            border: "1px dashed var(--border)", borderRadius: 12,
          }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎨</div>
            <p style={{ color: "var(--text3)" }}>Aucun bloc miné pour cet artiste pour l&apos;instant.</p>
          </div>
        ) : (
          <>
            {artistBlocks.length > 0 && (
              <section style={{ marginBottom: "2rem" }}>
                <h2 style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.07em", color: "var(--text3)", marginBottom: "1rem" }}>
                  Dessins soumis au réseau
                </h2>
                <div className="ab-grid">
                  {artistBlocks.map((b) => <BlockCard key={b.blockHash} block={b} />)}
                </div>
              </section>
            )}

            {minedBlocks.length > 0 && (
              <section>
                <h2 style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.07em", color: "var(--text3)", marginBottom: "1rem" }}>
                  Blocs validés en tant que mineur
                </h2>
                <div className="ab-grid">
                  {minedBlocks.map((b) => <BlockCard key={b.blockHash} block={b} />)}
                </div>
              </section>
            )}
          </>
        )
      )}

      {/* ── Tab ESP ── */}
      {tab === "devices" && (
        devices.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "3rem 2rem",
            border: "1px dashed var(--border)", borderRadius: 12,
          }}>
            <p style={{ color: "var(--text3)" }}>Aucun ESP associé à cet artiste.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {devices.map((d) => <DeviceCard key={d.deviceId} device={d} />)}
          </div>
        )
      )}

      <style>{`
        .ab-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 0.75rem;
        }
        .ab-card {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--bg2);
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }
        .ab-card:hover {
          border-color: var(--accent);
          background: var(--bg3);
        }
        .ab-card__preview {
          background: var(--bg3);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.75rem;
          min-height: 100px;
          border-bottom: 1px solid var(--border);
        }
        .ab-card__body {
          padding: 0.75rem;
        }
        .ab-chip {
          display: inline-block;
          padding: 0.15rem 0.5rem;
          border-radius: 4px;
          font-size: 0.65rem;
          font-weight: 600;
          background: var(--bg3);
          border: 1px solid var(--border);
          color: var(--text3);
        }
        .ab-chip--artist {
          background: rgba(124,107,255,0.12);
          border-color: rgba(124,107,255,0.3);
          color: var(--accent);
        }
        .ab-chip--miner {
          background: rgba(251,191,36,0.10);
          border-color: rgba(251,191,36,0.25);
          color: #fbbf24;
        }
        .ab-chip--artist.ab-chip--miner,
        .ab-chip--artist + .ab-chip--miner {
          background: rgba(74,222,128,0.10);
          border-color: rgba(74,222,128,0.25);
          color: #4ade80;
        }
        .ab-chip--pod {
          background: rgba(255,107,157,0.10);
          border-color: rgba(255,107,157,0.25);
          color: var(--accent2);
        }

        @media (max-width: 600px) {
          .ab-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  );
}
