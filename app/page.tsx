import { getNetworkSnapshot } from "@/lib/networkSnapshot";
import { NetworkMap } from "./network/NetworkMap";
import { EspActivityFeed } from "./network/EspActivityFeed";
import { BlockGallery } from "./BlockGallery";
import { RecentArtists } from "./RecentArtists";

export default async function HomePage() {
  const snapshot = await getNetworkSnapshot();

  return (
    <div className="home-shell">
      <section className="hero">
        <div className="hero-icon">
          <img src="/logo.png" alt="Logo" className="hero-logo" />
        </div>
        <div className="hero-kicker">Proof-of-Draw · réseau distribué</div>
        <h1>
          Dessins distribués entre
          <span> ESP8266, e-ink et OLED</span>
        </h1>
      </section>

      {/* CARTE RÉSEAU (topologie + side panel) */}
      <div className="home-network-stack">
        <NetworkMap snapshot={snapshot} />

        {/* JOURNAL RÉSEAU — pleine largeur sous la carte : une colonne étroite
            (ancienne disposition en rangée) tronquait chaque ligne et rendait
            le journal illisible sur PC. Pleine largeur = lignes lisibles. */}
        <div className="home-network-stack__feed">
          <EspActivityFeed />
        </div>
      </div>

      {/* GALERIE DES BLOCS MINÉS */}
      <BlockGallery />

      {/* DERNIERS ARTISTES INSCRITS — visibilité + accès à l'annuaire complet */}
      <RecentArtists />

      <style>{`
        .home-network-stack {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .home-network-stack__feed {
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
