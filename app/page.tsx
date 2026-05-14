import Link from "next/link";
import { getNetworkSnapshot, NETWORK_CACHE_TTL_SECONDS } from "@/lib/networkSnapshot";
import { NetworkMap } from "./network/NetworkMap";

function formatLocalDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default async function HomePage() {
  const snapshot = await getNetworkSnapshot();

  return (
    <div className="home-shell">
      
      {/* HERO */}
      <section className="hero">
        <div className="hero-icon">◈</div>

        <div className="hero-kicker">
          Proof-of-Draw · réseau distribué
        </div>

        <h1>
          Dessins distribués entre
          <span> ESP8266, e-ink et OLED</span>
        </h1>

        <p className="hero-lead">
          Une infrastructure expérimentale reliant des écrans physiques
          à un backend partagé temps quasi réel via Redis.
        </p>

        <div className="hero-actions">
          <Link href="/onboard" className="btn btn-primary">
            + Ajouter un device
          </Link>

          <Link href="/draw" className="btn btn-secondary">
            Dessiner →
          </Link>

          <Link href="/my-devices" className="btn btn-ghost">
            Mes ESP
          </Link>
        </div>
      </section>

      {/* STATS */}
      <section className="stats-strip">
        <div className="stat-card">
          <span>Devices</span>
          <strong>{snapshot.totals.devices}</strong>
        </div>

        <div className="stat-card">
          <span>Online</span>
          <strong>{snapshot.totals.online}</strong>
        </div>

        <div className="stat-card">
          <span>Frames</span>
          <strong>{snapshot.totals.framesWaiting}</strong>
        </div>

        <div className="stat-card">
          <span>Snapshot</span>
          <strong>{formatLocalDate(snapshot.generatedAtIso)}</strong>
        </div>
      </section>

      {/* NETWORK */}
      <section className="network-section">
        <div className="section-head">
          <div className="section-kicker">
            Vue réseau
          </div>

          <h2>
            Topologie des devices connectés
          </h2>

          <p>
            Les connexions affichent les pools d’écrans et les frames
            actuellement présentes dans Redis.
          </p>
        </div>

        <div className="network-map-shell">
          <NetworkMap snapshot={snapshot} />
        </div>
      </section>

      {/* POOLS */}
      <section className="screen-pools">
        <div className="section-head compact">
          <div className="section-kicker">
            Pools Redis
          </div>

          <h2>
            Répartition des écrans
          </h2>
        </div>

        <div className="pool-grid">
          {snapshot.screens.map((pool) => (
            <article key={pool.screen} className="pool-card">

              <div className="pool-card__top">
                <div>
                  <h3>{pool.label}</h3>
                  <p>{pool.description}</p>
                </div>

                <span className="pool-count">
                  {pool.count}
                </span>
              </div>

              <div className="pool-meta">
                <span>{pool.online} online</span>
                <span>{pool.count - pool.online} offline</span>
              </div>

              <div className="pool-devices">
                {pool.devices.length === 0 ? (
                  <div className="pool-device empty">
                    Aucun device.
                  </div>
                ) : (
                  pool.devices.slice(0, 6).map((device) => (
                    <div
                      key={device.deviceId}
                      className="pool-device"
                    >
                      <div>
                        <strong>
                          {device.artistName || device.deviceId}
                        </strong>

                        <small>
                          {device.deviceId}
                        </small>
                      </div>

                      <span
                        className={
                          device.isOnline
                            ? "status online"
                            : "status offline"
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* FOOT TECH */}
      <section className="tech-strip">
        <div className="tech-card">
          <div className="tech-card__head">
            <span>Cache snapshot</span>
            <span>TTL {NETWORK_CACHE_TTL_SECONDS}s</span>
          </div>

          <p>
            Snapshot mutualisé serveur pour limiter les lectures Redis
            et stabiliser le rendu de la home.
          </p>
        </div>
      </section>
    </div>
  );
}