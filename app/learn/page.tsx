"use client";

// app/learn/page.tsx — Prise en main + White paper Proof-of-Draw
// Double niveau de lecture : accessible (public large) + technique (détail protocolaire)

import { useState } from "react";
import Link from "next/link";

// ── Helpers ──────────────────────────────────────────────────────────────────

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: "80px", marginBottom: "3.5rem" }}>
      {children}
    </section>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.025em",
      marginBottom: "1rem", color: "var(--text)",
      borderBottom: "1px solid var(--border)", paddingBottom: "0.6rem",
    }}>
      {children}
    </h2>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: "1.05rem", lineHeight: 1.7, color: "var(--text2)",
      marginBottom: "1rem", maxWidth: 680,
    }}>
      {children}
    </p>
  );
}

function TechBlock({ title, children }: { title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      borderLeft: "3px solid var(--accent)", borderRadius: "0 8px 8px 0",
      background: "var(--bg3)", marginTop: "1rem", marginBottom: "0.5rem",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem",
          color: "var(--accent)", fontWeight: 700, fontSize: "0.82rem",
          textAlign: "left", textTransform: "uppercase", letterSpacing: "0.06em",
        }}
      >
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 18, borderRadius: "50%",
          border: "1.5px solid var(--accent)", fontSize: "0.7rem",
          transition: "transform 0.2s",
          transform: open ? "rotate(45deg)" : "none",
        }}>
          +
        </span>
        {title ?? "Détail technique"}
      </button>
      {open && (
        <div style={{ padding: "0 1rem 1rem", fontSize: "0.85rem", lineHeight: 1.65, color: "var(--text2)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function StepCard({
  num, title, desc, detail,
}: { num: number; title: string; desc: string; detail?: string }) {
  return (
    <div style={{
      display: "flex", gap: "1.25rem", alignItems: "flex-start",
      padding: "1.2rem", borderRadius: 10,
      border: "1px solid var(--border)", background: "var(--bg2)",
      marginBottom: "0.75rem",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: "var(--accent)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: "0.9rem", fontFamily: "JetBrains Mono, monospace",
      }}>
        {num}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.2rem" }}>{title}</div>
        <div style={{ fontSize: "0.85rem", color: "var(--text3)", lineHeight: 1.5 }}>{desc}</div>
        {detail && (
          <div style={{
            marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--text3)",
            fontFamily: "JetBrains Mono, monospace",
            background: "var(--bg3)", borderRadius: 5, padding: "0.4rem 0.7rem",
          }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

function RoleCard({
  icon, label, title, desc, tech,
}: { icon: string; label: string; title: string; desc: string; tech: string }) {
  return (
    <div style={{
      padding: "1.25rem", borderRadius: 12,
      border: "1px solid var(--border)", background: "var(--bg2)",
    }}>
      <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{icon}</div>
      <div style={{
        fontSize: "0.65rem", fontWeight: 700, color: "var(--accent)",
        textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem",
      }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.4rem" }}>{title}</div>
      <div style={{ fontSize: "0.82rem", color: "var(--text3)", lineHeight: 1.5, marginBottom: "0.75rem" }}>{desc}</div>
      <div style={{
        fontSize: "0.73rem", color: "var(--text3)", fontFamily: "JetBrains Mono, monospace",
        background: "var(--bg3)", borderRadius: 5, padding: "0.4rem 0.7rem", lineHeight: 1.5,
      }}>
        {tech}
      </div>
    </div>
  );
}

function FirmwareCard({
  variant, label, screens, filename, desc,
}: { variant: string; label: string; screens: string; filename: string; desc: string }) {
  return (
    <div style={{
      padding: "1.1rem 1.25rem", borderRadius: 10,
      border: "1px solid var(--border)", background: "var(--bg2)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "1rem", flexWrap: "wrap",
    }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem" }}>{label}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--text3)" }}>{screens}</div>
        <div style={{ fontSize: "0.72rem", color: "var(--text3)", marginTop: "0.2rem" }}>{desc}</div>
      </div>
      <a
        href={`/api/esp-firmware?variant=${variant}`}
        download={filename}
        style={{
          padding: "0.55rem 1.2rem", borderRadius: 8,
          background: "var(--accent)", color: "#fff",
          fontWeight: 600, fontSize: "0.82rem", textDecoration: "none",
          whiteSpace: "nowrap", flexShrink: 0,
          display: "flex", alignItems: "center", gap: "0.4rem",
        }}
      >
        ↓ Télécharger
      </a>
    </div>
  );
}

// ── Table des matières ────────────────────────────────────────────────────────

const TOC = [
  { id: "intro",     label: "Qu'est-ce que Proof-of-Draw ?" },
  { id: "how",       label: "Comment ça fonctionne ?" },
  { id: "roles",     label: "Les rôles du réseau" },
  { id: "steps",     label: "Participer pas à pas" },
  { id: "noESP",     label: "Participer sans ESP" },
  { id: "firmware",  label: "Télécharger le firmware" },
  { id: "why",       label: "Pourquoi c'est solide ?" },
  { id: "licence",   label: "Licences et droits" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LearnPage() {
  const [tocOpen, setTocOpen] = useState(false);

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: "3rem", padding: "2rem 0 1.5rem" }}>
        <div style={{
          display: "inline-block", padding: "0.35rem 1rem",
          borderRadius: 20, border: "1px solid var(--border)",
          fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em",
          color: "var(--accent)", textTransform: "uppercase", marginBottom: "1rem",
        }}>
          Prise en main · White paper
        </div>
        <h1 style={{
          fontSize: "2.2rem", fontWeight: 800, letterSpacing: "-0.04em",
          lineHeight: 1.15, margin: "0 0 1rem",
        }}>
          Proof-of-<em style={{ color: "var(--accent)", fontStyle: "normal" }}>Draw</em>
        </h1>
        <p style={{
          fontSize: "1.1rem", color: "var(--text2)", maxWidth: 560,
          margin: "0 auto 1.5rem", lineHeight: 1.6,
        }}>
          Un réseau décentralisé où des artistes humains créent des dessins
          qui sont validés, minés et affichés sur des écrans physiques connectés.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/draw" style={{
            padding: "0.6rem 1.4rem", borderRadius: 8,
            background: "var(--accent)", color: "#fff",
            fontWeight: 700, fontSize: "0.88rem",
          }}>
            Commencer à dessiner →
          </Link>
          <Link href="/onboard" style={{
            padding: "0.6rem 1.4rem", borderRadius: 8,
            border: "1px solid var(--border)", color: "var(--text2)",
            fontWeight: 600, fontSize: "0.88rem",
          }}>
            Connecter un ESP
          </Link>
        </div>
      </div>

      {/* TOC mobile */}
      <div style={{
        marginBottom: "2rem", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden",
      }}>
        <button
          onClick={() => setTocOpen(!tocOpen)}
          style={{
            width: "100%", background: "var(--bg2)", border: "none",
            padding: "0.8rem 1.1rem", cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            color: "var(--text2)", fontWeight: 600, fontSize: "0.85rem",
          }}
        >
          Table des matières
          <span style={{ fontSize: "0.7rem", transition: "transform 0.2s", transform: tocOpen ? "rotate(180deg)" : "none" }}>▼</span>
        </button>
        {tocOpen && (
          <div style={{ padding: "0.5rem 1rem 1rem", background: "var(--bg2)" }}>
            {TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => setTocOpen(false)}
                style={{
                  display: "block", padding: "0.35rem 0",
                  fontSize: "0.83rem", color: "var(--accent)", borderBottom: "none",
                }}
              >
                {item.label}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="intro">
        <H2>Qu'est-ce que Proof-of-Draw ?</H2>

        <Lead>
          Proof-of-Draw est un réseau ouvert où des artistes dessinent à la main sur
          une interface web, et leurs créations sont affichées en temps réel sur des
          écrans physiques (e-ink, OLED, TFT) connectés au réseau. Chaque dessin
          validé est gravé de façon permanente dans une <strong>chaîne de blocs légère</strong>.
        </Lead>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "0.75rem", marginBottom: "1.5rem",
        }}>
          {[
            { icon: "🎨", title: "Dessiner", desc: "Créez depuis n'importe quel navigateur, sans installation." },
            { icon: "📡", title: "Diffuser", desc: "Votre dessin est envoyé au réseau d'ESP connectés." },
            { icon: "✅", title: "Valider", desc: "Les ESP votent ensemble pour valider la création." },
            { icon: "⛓️", title: "Miner", desc: "Un bloc est gravé, le dessin est affiché sur les écrans." },
          ].map((c) => (
            <div key={c.title} style={{
              padding: "1rem", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--bg2)",
            }}>
              <div style={{ fontSize: "1.4rem", marginBottom: "0.4rem" }}>{c.icon}</div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.2rem" }}>{c.title}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--text3)", lineHeight: 1.4 }}>{c.desc}</div>
            </div>
          ))}
        </div>

        <TechBlock title="White paper — Architecture générale">
          <p>
            Le système repose sur une architecture <strong>pull-based</strong> : les ESP8266
            contactent périodiquement le serveur central (hébergé sur Vercel + Upstash Redis)
            pour récupérer de nouveaux candidats à valider et les frames à afficher.
            Le serveur ne pousse jamais de données vers les ESP — il n&apos;a pas besoin de connaître
            leur IP locale.
          </p>
          <p style={{ marginTop: "0.75rem" }}>
            Le consensus est inspiré de Proof-of-Work mais sans hash computationnel : chaque
            ESP calcule des métriques visuelles sur le dessin candidat (entropie, transitions,
            complexité RLE) et soumet son score. Le quorum est atteint quand ≥ 51% du réseau actif
            a voté. Le bloc est finalisé côté serveur, le mineur est sélectionné par tirage équitable
            pondéré (inversement proportionnel au nombre de blocs déjà minés).
          </p>
          <p style={{ marginTop: "0.75rem" }}>
            Clés Redis utilisées : <code>chain:block:&#123;hash&#125;</code>, <code>chain:image:&#123;hash&#125;</code>,
            <code>chain:recent</code> (list), <code>candidate:current</code>, <code>candidate:votes</code>.
            Tous les blocs sont permanents (sans TTL). Les images sont stockées en base64
            sous <code>chain:image:&#123;blockHash&#125;</code>.
          </p>
        </TechBlock>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="how">
        <H2>Comment ça fonctionne ?</H2>

        <Lead>
          Imaginez un tableau blanc partagé : vous dessinez, votre œuvre traverse le réseau,
          des micro-ordinateurs la valident à la majorité, et elle s'affiche sur des écrans
          physiques — tout en restant gravée pour toujours dans la blockchain.
        </Lead>

        {/* Schéma textuel du flux */}
        <div style={{
          background: "var(--bg3)", borderRadius: 10, padding: "1.5rem",
          fontFamily: "JetBrains Mono, monospace", fontSize: "0.8rem",
          lineHeight: 2, overflowX: "auto", marginBottom: "1.5rem",
        }}>
          <div style={{ color: "var(--accent)", fontWeight: 700, marginBottom: "0.5rem" }}>Flux complet d'un dessin</div>
          <div>
            <span style={{ color: "var(--text3)" }}>Artiste</span>
            <span style={{ color: "var(--text2)" }}> → dessine dans le navigateur</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>          ↓</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>Serveur </span>
            <span style={{ color: "var(--text2)" }}> → reçoit le dessin, calcule le score de complexité</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>          ↓  publie candidat:current</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>ESP×N   </span>
            <span style={{ color: "var(--text2)" }}> → pull → voient le candidat → calculent leurs métriques → votent</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>          ↓  quorum ≥ 51%</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>Serveur </span>
            <span style={{ color: "var(--text2)" }}> → finalise le bloc → stocke image + métadonnées</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>          ↓  broadcast frame</span>
          </div>
          <div>
            <span style={{ color: "var(--text3)" }}>ESP×N   </span>
            <span style={{ color: "var(--text2)" }}> → pull → reçoivent la frame → affichent le dessin</span>
          </div>
        </div>

        <TechBlock title="Protocole de validation détaillé">
          <p><strong>Soumission :</strong> <code>POST /api/draw</code> — le dessin est encodé selon le type d&apos;écran
          (1bpp pour e-ink/OLED, RGB565 LE pour TFT). Le serveur vérifie l&apos;authentification session,
          applique un rate-limit par device (<code>draw:lock:&#123;deviceId&#125;</code>, TTL = DRAW_WINDOW_SEC),
          détecte les bots (automationRatio &gt; 80%) et crée un candidat.</p>

          <p style={{ marginTop: "0.7rem" }}><strong>Vote :</strong> <code>GET /api/validate-candidate</code> → <code>POST /api/validation-result</code>.
          L&apos;ESP calcule localement entropie, transitions et score RLE, les soumet avec une signature
          simplifiée (<code>deviceId:candidateId:score</code>). Le serveur vérifie la dérive entre
          score serveur et score ESP (alerte si &gt; 0.4). Les votes sont stockés dans <code>candidate:votes</code>.</p>

          <p style={{ marginTop: "0.7rem" }}><strong>Quorum :</strong> <code>Math.ceil(poolSize × QUORUM_RATIO)</code> votes nécessaires,
          avec un minimum de 1. QUORUM_RATIO = 0.51 par défaut (variable d&apos;environnement).</p>

          <p style={{ marginTop: "0.7rem" }}><strong>Minage équitable :</strong> le mineur n&apos;est pas le premier à voter mais
          tiré au sort parmi tous les validateurs, pondéré par <code>WEIGHT_BASE / (blocksMinés + 1)</code>.
          Les devices qui n&apos;ont jamais miné ont un poids maximal.</p>
        </TechBlock>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="roles">
        <H2>Les rôles du réseau</H2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <RoleCard
            icon="🎨"
            label="Artiste"
            title="Créateur du dessin"
            desc="Dessine dans le navigateur et soumet son œuvre au réseau. Peut utiliser son propre ESP ou un ESP public partagé par un autre participant."
            tech="POST /api/draw · rate-limit 1/DRAW_WINDOW_SEC par device · session cookie HMAC-SHA256"
          />
          <RoleCard
            icon="📡"
            label="ESP Validateur"
            title="Nœud de consensus"
            desc="Microcontrôleur ESP8266 connecté au WiFi. Il interroge périodiquement le serveur, calcule ses métriques, vote pour valider les dessins."
            tech="GET /api/pull → GET /api/validate-candidate → POST /api/validation-result · 4 req/min max"
          />
          <RoleCard
            icon="⛏️"
            label="Mineur"
            title="Finalise un bloc"
            desc="Un ESP validateur est tiré au sort à chaque quorum. Il reçoit une notification et voit son compteur de blocs minés augmenter."
            tech="chain:notify:{deviceId} · chaîne de blocs SHA-256 · sélection pondérée inverse"
          />
          <RoleCard
            icon="🖥️"
            label="Serveur"
            title="Orchestrateur central"
            desc="Hébergé sur Vercel. Coordonne les soumissions, stocke la chaîne de blocs dans Redis, broadcast les frames validées."
            tech="Next.js 16 · Upstash Redis · chain:recent list · candidate:current TTL=600s"
          />
        </div>

        <TechBlock title="ESP en mode prêt public">
          <p>Un artiste peut activer <strong>publicMode</strong> sur ses ESP (<code>device.publicMode = true</code>).
          D&apos;autres artistes peuvent alors utiliser ses écrans pour dessiner, sans avoir besoin
          de posséder leur propre matériel. Le propriétaire de l&apos;ESP reste l&apos;auteur du device ;
          le dessinateur est crédité séparément via <code>drawArtistName</code> dans le bloc.</p>
        </TechBlock>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="steps">
        <H2>Participer avec un ESP — pas à pas</H2>

        <Lead>
          Vous avez un ESP8266 et un écran compatible ? Voici les étapes pour rejoindre le réseau.
        </Lead>

        <StepCard num={1} title="Télécharger le firmware" desc="Choisissez le firmware correspondant à votre écran dans la section ci-dessous et téléchargez le ZIP." detail="Arduino IDE 2.x requis · Board : NodeMCU 1.0 (ESP-12E Module) · Vitesse : 80 MHz" />
        <StepCard num={2} title="Configurer le firmware" desc="Ouvrez le .ino dans Arduino IDE. Modifiez SERVER_URL (votre instance), WIFI_SSID et WIFI_PASSWORD." detail={`#define SERVER_URL "https://votre-instance.vercel.app"\n#define WIFI_SSID "MonWifi"\n#define WIFI_PASSWORD "motdepasse"`} />
        <StepCard num={3} title="Flasher l'ESP8266" desc="Connectez l'ESP en USB, sélectionnez le bon port COM, et uploadez le sketch. L'ESP se connecte, s'enregistre et affiche son code de jumelage." detail="Bibliothèques requises : ESP8266HTTPClient, ArduinoJson ≥ 7.x, driver écran correspondant" />
        <StepCard num={4} title="Jumeler sur le site" desc={`Sur proof-of-draw, allez dans "+ Onboard", entrez le code affiché sur l'écran et votre nom d'artiste. Le device est maintenant associé à votre session.`} detail="GET /api/pull → deviceId + pairCode · POST /api/onboard · cookie de session HMAC" />
        <StepCard num={5} title="Dessiner !" desc="Allez sur Dessiner, sélectionnez votre device et votre écran. Chaque dessin soumis entre dans la file de validation." detail="Le réseau vote en ~30s. Après quorum, votre dessin s'affiche sur les écrans et est gravé dans la blockchain." />

        <TechBlock title="Cycle de vie du firmware (boot → affichage)">
          <ol style={{ paddingLeft: "1.2rem", margin: 0 }}>
            <li>Boot → connexion WiFi → <code>POST /api/register</code> avec MAC + firmware + écrans</li>
            <li>Reçoit <code>deviceId</code> + <code>pairCode</code> (idempotent sur la MAC)</li>
            <li>Boucle principale (toutes les N secondes) :
              <ul style={{ paddingLeft: "1rem", marginTop: "0.3rem" }}>
                <li><code>POST /api/ping</code> → met à jour lastPing/lastSeen</li>
                <li><code>GET /api/pull?deviceId=…</code> → frame à afficher, ou candidat à valider, ou tâche d&apos;observation</li>
                <li>Si frame : afficher sur l&apos;écran</li>
                <li>Si pendingValidation : calculer métriques → <code>GET /api/validate-candidate</code> → <code>POST /api/validation-result</code></li>
              </ul>
            </li>
          </ol>
        </TechBlock>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="noESP">
        <H2>Participer sans ESP</H2>

        <Lead>
          Pas de matériel ? Vous pouvez quand même participer pleinement en tant qu&apos;artiste.
        </Lead>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <div style={{
            padding: "1.2rem", borderRadius: 10,
            border: "1px solid rgba(124,107,255,0.3)", background: "rgba(124,107,255,0.06)",
          }}>
            <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>🎨 Dessiner sur un ESP public</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text3)", lineHeight: 1.5 }}>
              D&apos;autres participants peuvent mettre leurs ESP en <em>mode prêt public</em>.
              Vous pouvez dessiner sur leurs écrans comme si c&apos;était les vôtres.
              Votre nom d&apos;artiste apparaît dans le bloc miné.
            </div>
            <Link href="/profile" style={{
              display: "inline-block", marginTop: "0.75rem",
              padding: "0.4rem 1rem", borderRadius: 6,
              background: "var(--accent)", color: "#fff",
              fontWeight: 600, fontSize: "0.78rem", textDecoration: "none",
            }}>
              Voir les ESP disponibles →
            </Link>
          </div>

          <div style={{
            padding: "1.2rem", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--bg2)",
          }}>
            <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>📊 Explorer la blockchain</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text3)", lineHeight: 1.5 }}>
              La galerie est publique. Vous pouvez explorer tous les blocs minés,
              voir les dessins, les scores de validation, les artistes, et les ESP validateurs.
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <Link href="/gallery" style={{
                padding: "0.4rem 1rem", borderRadius: 6,
                border: "1px solid var(--border)", background: "var(--bg3)",
                color: "var(--text2)", fontWeight: 600, fontSize: "0.78rem",
              }}>Block explorer →</Link>
              <Link href="/artists" style={{
                padding: "0.4rem 1rem", borderRadius: 6,
                border: "1px solid var(--border)", background: "var(--bg3)",
                color: "var(--text2)", fontWeight: 600, fontSize: "0.78rem",
              }}>Artistes du réseau →</Link>
            </div>
          </div>
        </div>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="firmware">
        <H2>Télécharger le firmware ESP</H2>

        <Lead>
          Chaque type d&apos;écran a son propre firmware. Téléchargez le ZIP correspondant
          à votre matériel et ouvrez-le dans Arduino IDE.
        </Lead>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <FirmwareCard
            variant="eink29bwr"
            label='E-Ink 2.9" Noir / Blanc / Rouge'
            screens="Waveshare 2.9inch e-Paper B V4 · 296×128px"
            filename="pod-firmware-eink29bwr.zip"
            desc="3 couleurs : noir, blanc, rouge. Refresh ~2s. Recommandé pour commencer."
          />
          <FirmwareCard
            variant="eink27bw"
            label='E-Ink 2.7" Noir / Blanc + OLED 0.96"'
            screens={`Waveshare 2.7inch e-Paper V2 + OLED 0.96" · 264×176px`}
            filename="pod-firmware-eink27bw-oled.zip"
            desc="Double écran : e-ink 2.7 BW + OLED secondaire pour le statut."
          />
          <FirmwareCard
            variant="eink27bwSolo"
            label='E-Ink 2.7" Noir / Blanc (écran seul)'
            screens="Waveshare 2.7inch e-Paper V2 · 264×176px"
            filename="pod-firmware-eink27bw-solo.zip"
            desc="Version mono-écran : seulement l'e-ink 2.7 BW, sans OLED. Plus simple à câbler."
          />
          <FirmwareCard
            variant="tft18"
            label='TFT 1.8" Couleur complète'
            screens="ST7735S 128×160px RGB565"
            filename="pod-firmware-tft18.zip"
            desc="Couleur complète (65536 couleurs). Refresh instantané. Palette 48 couleurs dans l'éditeur."
          />
          <FirmwareCard
            variant="all"
            label="Tous les firmwares"
            screens="Archive complète : eink29bwr + eink27bw+oled + eink27bw (solo) + tft18"
            filename="pod-firmware-all.zip"
            desc="Contient les quatre dossiers. Idéal pour contribuer au code ou porter sur un nouvel écran."
          />
        </div>

        <div style={{
          padding: "1rem 1.2rem", borderRadius: 8,
          border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.06)",
          fontSize: "0.82rem", color: "var(--text3)", lineHeight: 1.6,
        }}>
          <strong style={{ color: "#fbbf24" }}>Avant de flasher :</strong> modifiez
          {" "}<code style={{ fontFamily: "JetBrains Mono" }}>SERVER_URL</code>,{" "}
          <code style={{ fontFamily: "JetBrains Mono" }}>WIFI_SSID</code> et{" "}
          <code style={{ fontFamily: "JetBrains Mono" }}>WIFI_PASSWORD</code> dans le fichier <code>.ino</code>.
          Installez les bibliothèques requises via le gestionnaire de bibliothèques Arduino IDE.
        </div>

        <TechBlock title="Bibliothèques Arduino requises">
          <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
            <li><strong>ESP8266WiFi</strong> — incluse dans le core ESP8266 (gestionnaire de cartes)</li>
            <li><strong>ESP8266HTTPClient</strong> — idem</li>
            <li><strong>ArduinoJson ≥ 7.x</strong> — parsing des réponses JSON serveur</li>
            <li><strong>Adafruit GFX Library</strong> — rendu graphique abstrait</li>
            <li><strong>Waveshare EPD</strong> (e-ink) ou <strong>Adafruit ST7735</strong> (TFT) selon l&apos;écran</li>
          </ul>
          <p style={{ marginTop: "0.7rem" }}>
            Gestionnaire de cartes ESP8266 : ajouter{" "}
            <code>https://arduino.esp8266.com/stable/package_esp8266com_index.json</code>
            {" "}dans Préférences → URL de gestionnaire.
          </p>
        </TechBlock>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="why">
        <H2>Pourquoi c&apos;est techniquement solide ?</H2>

        <Lead>
          Le réseau n&apos;est pas un gadget — il repose sur des choix d&apos;architecture
          pensés pour la résilience, la décentralisation et la traçabilité.
        </Lead>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {[
            {
              title: "Aucune IP locale exposée",
              desc: "Les ESP ne sont jamais contactés directement par le serveur. C'est eux qui interrogent le serveur. Fonctionne derrière n'importe quel routeur, NAT, ou réseau mobile.",
              tech: "Architecture pull-based · frame:${deviceId} Redis key · GET /api/pull",
            },
            {
              title: "Blockchain permanente",
              desc: "Les blocs et leurs images sont stockés sans TTL dans Redis. Une fois miné, un dessin ne disparaît jamais de la chaîne.",
              tech: "chain:block:{hash} · chain:image:{hash} · chaîne SHA-256 liée par parentHash",
            },
            {
              title: "Consensus résistant aux bots",
              desc: "Le serveur ne bloque que les séquences d'actions d'un rythme de machine (automationRatio > 80%). Tout le reste est soumis au vote des ESP — c'est le réseau qui décide de la qualité, pas un algorithme central.",
              tech: "automationRatio via intervalles < 15ms · MAX_AUTOMATION_RATIO = 0.80 · qualité = warnings, non bloquants",
            },
            {
              title: "Minage équitable",
              desc: "Le mineur n'est pas celui qui répond le plus vite, mais tiré au sort parmi tous les validateurs avec un poids inversement proportionnel au nombre de blocs déjà minés. Les nouveaux participants sont favorisés.",
              tech: "selectEquitableMiner() · poids = WEIGHT_BASE / (blocksMinés + 1) · chain:device:{id}:blocks",
            },
            {
              title: "Authentification sans mot de passe",
              desc: "Aucun compte, aucun email. La session est un cookie signé HMAC-SHA256 qui prouve que vous possédez ce device. Perdre le code de jumelage = seul risque.",
              tech: "HMAC-SHA256 via WebCrypto · cookie httpOnly + SameSite · pairCode rotatif",
            },
            {
              title: "Seuils adaptatifs",
              desc: "Les critères de qualité des dessins (complexité, couverture, durée) s'adaptent automatiquement à la moyenne historique du réseau par type d'écran.",
              tech: "getEffectiveThresholds() · max(floor, avgComplexity × 0.45) · cache Redis 120s",
            },
          ].map((item) => (
            <div key={item.title} style={{
              padding: "1.1rem 1.25rem", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--bg2)",
            }}>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.3rem" }}>{item.title}</div>
              <div style={{ fontSize: "0.83rem", color: "var(--text3)", lineHeight: 1.5, marginBottom: "0.5rem" }}>{item.desc}</div>
              <div style={{
                fontSize: "0.72rem", color: "var(--text3)",
                fontFamily: "JetBrains Mono, monospace",
                background: "var(--bg3)", borderRadius: 5, padding: "0.35rem 0.7rem",
              }}>
                {item.tech}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══════════════════════════════════════════════════════ */}
      <Section id="licence">
        <H2>Licences et droits</H2>

        <Lead>
          Proof-of-Draw adopte un cadre de licence clair, aligné sur les meilleures pratiques open source.
        </Lead>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <div style={{
            padding: "1.25rem", borderRadius: 12,
            border: "1px solid rgba(74,222,128,0.25)", background: "rgba(74,222,128,0.04)",
          }}>
            <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.4rem", color: "#4ade80" }}>
              Code source — MIT
            </div>
            <div style={{ fontSize: "0.83rem", color: "var(--text3)", lineHeight: 1.6 }}>
              Tout le code (serveur, firmware ESP, bibliothèques) est sous licence MIT.
              Vous pouvez librement l&apos;utiliser, le modifier, le redistribuer et le fork,
              y compris à des fins commerciales, sous réserve de conserver la notice de licence.
            </div>
          </div>

          <div style={{
            padding: "1.25rem", borderRadius: 12,
            border: "1px solid rgba(124,107,255,0.25)", background: "rgba(124,107,255,0.04)",
          }}>
            <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.4rem", color: "var(--accent)" }}>
              Dessins — CC0
            </div>
            <div style={{ fontSize: "0.83rem", color: "var(--text3)", lineHeight: 1.6 }}>
              En soumettant un dessin au réseau, vous le placez sous licence CC0
              (domaine public universel). Il est librement partageable, réutilisable
              et modifiable par tous, sans condition.
            </div>
          </div>
        </div>

        <div style={{
          padding: "1.2rem 1.4rem", borderRadius: 10,
          border: "1px solid var(--border)", background: "var(--bg2)",
          fontSize: "0.85rem", lineHeight: 1.7, color: "var(--text3)",
        }}>
          <strong style={{ color: "var(--text)" }}>Attribution blockchain :</strong> CC0 ne signifie pas anonymat.
          Chaque dessin est lié à son auteur de façon immuable dans la chaîne de blocs :
          le nom d&apos;artiste, le hash du dessin, et la date de minage sont gravés pour toujours
          dans le bloc correspondant. L&apos;œuvre est libre d&apos;utilisation, mais son histoire
          reste traçable et publique.<br /><br />
          <strong style={{ color: "var(--text)" }}>Pas de contradiction :</strong> CC0 et traçabilité blockchain
          ne s&apos;opposent pas. CC0 dit <em>«&nbsp;tout le monde peut utiliser ce dessin&nbsp;»</em>.
          La blockchain dit <em>«&nbsp;ce dessin a été créé par cet artiste, à cette date, et c&apos;est vérifiable&nbsp;»</em>.
          Ces deux affirmations coexistent sans ambiguïté.
        </div>
      </Section>

      {/* CTA final */}
      <div style={{
        textAlign: "center", padding: "2.5rem 1rem",
        borderRadius: 14, border: "1px solid var(--border)",
        background: "linear-gradient(135deg, rgba(124,107,255,0.06) 0%, rgba(255,107,157,0.04) 100%)",
      }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>🎨</div>
        <h3 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.5rem" }}>
          Prêt à rejoindre le réseau ?
        </h3>
        <p style={{ color: "var(--text3)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          Dessinez dès maintenant — aucune installation requise.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/draw" style={{
            padding: "0.65rem 1.5rem", borderRadius: 8,
            background: "var(--accent)", color: "#fff",
            fontWeight: 700, fontSize: "0.88rem",
          }}>
            Dessiner maintenant
          </Link>
          <a href="/api/esp-firmware?variant=all" download="pod-firmware-all.zip" style={{
            padding: "0.65rem 1.5rem", borderRadius: 8,
            border: "1px solid var(--border)", color: "var(--text2)",
            fontWeight: 600, fontSize: "0.88rem",
          }}>
            ↓ Firmware complet (ZIP)
          </a>
        </div>
      </div>

      <style>{`
        @media (max-width: 600px) {
          h1 { font-size: 1.7rem !important; }
        }
      `}</style>
    </div>
  );
}
