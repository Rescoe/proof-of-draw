import Link from "next/link";
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
          Dessine une œuvre,
          <span> le réseau la valide, des écrans l’affichent</span>
        </h1>
        <p className="home-lead">Proof-of-Draw : des artistes dessinent dans leur navigateur, des microcontrôleurs connectés votent, et l’œuvre apparaît sur de vrais écrans.</p>
      </section>

      {/* TROIS INTENTIONS — l'orientation vient avant la carte, qui reste la preuve vivante juste en dessous */}
      <section className="home-actions" aria-label="Par où commencer ?">
        <Link href="/draw" className="home-action home-action--primary">
          <span className="home-action__icon" aria-hidden>✏️</span>
          <strong>Créer une œuvre</strong>
          <span>Dessine sur tes écrans ou sur un écran partagé, sans rien installer.</span>
        </Link>
        <Link href="/gallery" className="home-action">
          <span className="home-action__icon" aria-hidden>🖼️</span>
          <strong>Découvrir</strong>
          <span>Les œuvres validées, les artistes et les écrans du réseau.</span>
        </Link>
        <Link href="/learn?path=install#installer" className="home-action">
          <span className="home-action__icon" aria-hidden>🔌</span>
          <strong>Connecter mon écran</strong>
          <span>Installer un écran, puis l’associer à ton profil avec son code.</span>
        </Link>
      </section>

      {/* CARTE RÉSEAU (topologie + side panel) : la preuve vivante, après l'orientation */}
      <h2 className="home-live-title">Le réseau, en direct</h2>
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
