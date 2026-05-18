import Link from "next/link";
import { getNetworkSnapshot } from "@/lib/networkSnapshot";
import { NetworkMap } from "./network/NetworkMap";
import { BlockGallery } from "./BlockGallery";

export default async function HomePage() {
  const snapshot = await getNetworkSnapshot();

  return (
    <div className="home-shell">
      
      {/* HERO - BOUTONS UNIQUEMENT */}
      <section className="hero">
<div className="hero-icon">
  <img src="/logo.png" alt="Logo" className="hero-logo" />
</div>
        <div className="hero-kicker">
          Proof-of-Draw · réseau distribué
        </div>

        <h1>
          Dessins distribués entre
          <span> ESP8266, e-ink et OLED</span>
        </h1>

        <div className="hero-actions">
          <Link href="/onboard" className="btn btn-ghost">
            + Ajouter un device
          </Link>

          <Link href="/draw" className="btn btn-ghost">
            Dessiner →
          </Link>

          <Link href="/my-devices" className="btn btn-ghost">
            Mes ESP
          </Link>

          <Link href="/gallery" className="btn btn-ghost">
            Block Explorer →
          </Link>
        </div>
      </section>

      {/* NETWORK MAP - PLEIN ÉCRAN */}
      <NetworkMap snapshot={snapshot} />

      {/* GALERIE DES BLOCS MINÉS */}
      <BlockGallery />

    </div>
  );
}