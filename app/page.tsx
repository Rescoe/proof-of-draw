import Link from "next/link";
import { getNetworkSnapshot } from "@/lib/networkSnapshot";
import { NetworkMap } from "./network/NetworkMap";
import { EspActivityFeed } from "./network/EspActivityFeed";
import { BlockGallery } from "./BlockGallery";
import { NetworkArtists } from "./NetworkArtists";

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
        <Link href="/draw" className="home-action">
          <strong>Dessiner</strong>
          <span>Dessine sur tes écrans ou sur un écran partagé, sans rien installer.</span>
        </Link>
        <Link href="/gallery" className="home-action">
          <strong>Galerie</strong>
          <span>Les œuvres validées par le réseau, puis les artistes et les appareils qui les affichent.</span>
        </Link>
        <Link href="/learn?path=install#installer" className="home-action">
          <strong>Installer un appareil</strong>
          <span>Installer un appareil, puis l’associer à ton profil avec son code.</span>
        </Link>
      </section>

      {/* CARTE RÉSEAU : la preuve vivante, après l'orientation. surface="home" : constellation pleine largeur, ni terminal ni « Actuellement affiché » (UX jalon 2) */}
      <h2 className="home-live-title">Le réseau, en direct</h2>
      <div className="home-network-stack">
        <NetworkMap snapshot={snapshot} surface="home" />

        {/* JOURNAL RÉSEAU — UN SEUL sur l'accueil (le terminal technique reste sur /network) ; pleine largeur : lignes lisibles. */}
        <div className="home-network-stack__feed">
          <EspActivityFeed />
        </div>
      </div>

      {/* ARTISTES DU RÉSEAU — actifs maintenant + nouveaux, UNE section bornée (aucune lecture de plus : snapshot déjà chargé) */}
      <NetworkArtists snapshot={snapshot} />

      {/* ŒUVRES RÉCENTES */}
      <BlockGallery />

      {/* COMPRENDRE OU REJOINDRE */}
      <section className="home-learn" aria-label="Comprendre ou rejoindre">
        <Link href="/learn" className="home-learn__link">Comprendre Proof-of-Draw <span aria-hidden>→</span></Link>
        <Link href="/learn?path=install#installer" className="home-learn__link">Installer un appareil <span aria-hidden>→</span></Link>
        <Link href="/onboard" className="home-learn__link">Associer un appareil <span aria-hidden>→</span></Link>
      </section>

      <style>{`
        .home-network-stack {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .home-network-stack__feed {
          min-width: 0;
        }
        .home-learn { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 2rem 0 1rem; }
        .home-learn__link { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 44px; padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 10px; background: var(--bg2); color: var(--text); font-size: 0.9rem; font-weight: 500; text-decoration: none; }
        .home-learn__link:hover { border-color: rgba(124,107,255,0.5); }
      `}</style>
    </div>
  );
}
