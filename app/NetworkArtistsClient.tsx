"use client";

// app/NetworkArtistsClient.tsx — rendu de la section « Artistes du réseau » : deux vues d'une même liste bornée (Actifs maintenant · Nouveaux artistes), jamais deux listes côte à côte.
import { useState } from "react";
import Link from "next/link";
import type { NetworkArtistsSummary } from "@/lib/networkArtists";
import type { RecentArtistSummary } from "./RecentArtists";
import { ArtistMiniAvatar } from "./RecentArtistsClient";

type View = "active" | "recent";

const initialsOf = (name: string) => name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const dayLabel = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" }) : "");

export function NetworkArtistsClient({ summary, recent }: { summary: NetworkArtistsSummary | null; recent: RecentArtistSummary[] }) {
  const hasActive = !!summary && summary.active.length > 0;
  const [view, setView] = useState<View>(hasActive ? "active" : "recent");
  const recentById = new Map(recent.map((r) => [r.artistId, r]));
  return (
    <section className="net-artists" aria-labelledby="net-artists-h">
      <div className="net-artists__head">
        <h2 id="net-artists-h" className="net-artists__title">Artistes du réseau</h2>
        <Link href="/artists" className="net-artists__more">Tous les artistes →</Link>
      </div>
      {summary && (
        <p className="net-artists__count">
          {summary.artists} artiste{summary.artists > 1 ? "s" : ""} · {summary.devicesOnline} appareil{summary.devicesOnline > 1 ? "s" : ""} en ligne sur {summary.devices}
        </p>
      )}
      {hasActive && recent.length > 0 && (
        <div className="pod-pills" role="group" aria-label="Choisir la liste">
          <button type="button" className="pod-pill" aria-pressed={view === "active"} onClick={() => setView("active")}>Actifs maintenant</button>
          <button type="button" className="pod-pill" aria-pressed={view === "recent"} onClick={() => setView("recent")}>Nouveaux artistes</button>
        </div>
      )}

      {view === "active" && hasActive ? (
        <ul className="net-artists__list" aria-label="Artistes actifs maintenant">
          {summary.active.map((a) => {
            const profile = a.artistId ? recentById.get(a.artistId) : undefined;
            const inner = (
              <>
                {profile ? <ArtistMiniAvatar artist={profile} /> : <span className="net-artists__avatar" aria-hidden>{initialsOf(a.label)}</span>}
                <span className="net-artists__name">{a.label}</span>
                <span className={`net-artists__state${a.online > 0 ? " is-online" : ""}`}>
                  {a.online > 0 ? `● ${a.online} en ligne` : a.lastActiveMs ? `vu le ${dayLabel(a.lastActiveMs)}` : "hors ligne"}
                </span>
              </>
            );
            return (
              <li key={a.artistKey}>
                {a.artistId ? <Link href={`/artists/${a.artistId}`} className="net-artists__card">{inner}</Link> : <div className="net-artists__card">{inner}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="net-artists__list" aria-label="Nouveaux artistes">
          {recent.map((r) => (
            <li key={r.artistId}>
              <Link href={`/artists/${r.slug ?? r.artistId}`} className="net-artists__card">
                <ArtistMiniAvatar artist={r} />
                <span className="net-artists__name">{r.displayName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .net-artists { margin-top: 1.5rem; }
        .net-artists__head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.35rem; flex-wrap: wrap; }
        .net-artists__title { font-size: 1rem; font-weight: 800; letter-spacing: -0.02em; margin: 0; color: var(--text); }
        .net-artists__more { font-size: 0.82rem; font-weight: 600; color: var(--accent); text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; min-height: 44px; }
        .net-artists__more:hover { text-decoration: underline; }
        .net-artists__count { margin: 0 0 0.6rem; font-size: 0.8rem; color: var(--text3); }
        .net-artists .pod-pills { margin: 0 0 0.8rem; }
        .net-artists__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.75rem; }
        .net-artists__card { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; padding: 0.7rem 0.4rem; border: 1px solid var(--border-soft); border-radius: 12px; background: var(--bg2); text-decoration: none; color: inherit; min-height: 44px; overflow-wrap: anywhere; }
        a.net-artists__card:hover { border-color: rgba(124,107,255,0.45); }
        .net-artists__avatar { width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, var(--accent) 0%, #6366f1 100%); display: flex; align-items: center; justify-content: center; font-size: 0.95rem; font-weight: 800; color: #fff; }
        .net-artists__name { font-size: 0.78rem; font-weight: 600; color: var(--text2); text-align: center; max-width: 100%; }
        .net-artists__state { font-size: 0.7rem; color: var(--text3); }
        .net-artists__state.is-online { color: var(--success); }
      `}</style>
    </section>
  );
}
