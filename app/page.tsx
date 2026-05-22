import { getNetworkSnapshot } from "@/lib/networkSnapshot";
import { NetworkMap } from "./network/NetworkMap";
import { GlobalTerminal } from "./network/GlobalTerminal";
import { BlockGallery } from "./BlockGallery";

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

      {/* NETWORK MAP */}
      <NetworkMap snapshot={snapshot} />

      {/* TERMINAL GLOBAL — échanges passant par le serveur central */}
      <GlobalTerminal />

      {/* GALERIE DES BLOCS MINÉS */}
      <BlockGallery />
    </div>
  );
}
