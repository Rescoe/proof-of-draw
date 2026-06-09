"use client";

// app/learn/page.tsx — Guide complet Proof-of-Draw
// Partie 1 : démarrage débutant (Arduino IDE, ESP, firmware, onboarding)
// Partie 2 : fonctionnement détaillé (protocole, consensus, architecture)

import { useState, useEffect } from "react";
import Link from "next/link";

// ── TOC ───────────────────────────────────────────────────────────────────────

const TOC_ITEMS = [
  { part: 1, id: "intro",       label: "Introduction" },
  { part: 1, id: "material",    label: "Matériel compatible" },
  { part: 1, id: "arduino-ide", label: "Installer Arduino IDE" },
  { part: 1, id: "esp-boards",  label: "Ajouter les cartes ESP" },
  { part: 1, id: "libraries",   label: "Bibliothèques requises" },
  { part: 1, id: "firmware",    label: "Télécharger le firmware" },
  { part: 1, id: "configure",   label: "Configurer & flasher" },
  { part: 1, id: "onboard",     label: "Onboarder sur le site" },
  { part: 1, id: "draw",        label: "Dessiner" },
  { part: 1, id: "no-esp",      label: "Participer sans ESP" },
  { part: 2, id: "how",         label: "Comment ça marche" },
  { part: 2, id: "roles",       label: "Les rôles du réseau" },
  { part: 2, id: "consensus",   label: "Protocole de consensus" },
  { part: 2, id: "why",         label: "Solidité technique" },
  { part: 2, id: "licence",     label: "Licences & droits" },
];

function useTocActive() {
  const [active, setActive] = useState("");
  useEffect(() => {
    const ids = TOC_ITEMS.map((t) => t.id);
    const handler = () => {
      const scrollY = window.scrollY + 120;
      let cur = "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= scrollY) cur = id;
      }
      setActive(cur);
    };
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, []);
  return active;
}

// ── Helpers visuels ───────────────────────────────────────────────────────────

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 88, marginBottom: "4rem" }}>
      {children}
    </section>
  );
}

function PartBadge({ num, label }: { num: number; label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.75rem",
      margin: "3rem 0 2rem",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: num === 1 ? "var(--accent)" : "#6366f1",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: "0.78rem", color: "#fff", flexShrink: 0,
      }}>{num}</div>
      <div style={{
        fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: num === 1 ? "var(--accent)" : "#6366f1",
      }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.025em",
      margin: "0 0 0.9rem", color: "var(--text)",
    }}>
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: "1rem", fontWeight: 700,
      margin: "1.75rem 0 0.6rem", color: "var(--text)",
    }}>
      {children}
    </h3>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: "1rem", lineHeight: 1.7, color: "var(--text2)",
      margin: "0 0 1.25rem",
    }}>
      {children}
    </p>
  );
}

function MenuPath({ steps }: { steps: string[] }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", flexWrap: "wrap" }}>
      {steps.map((s, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
          <span style={{
            display: "inline-block", padding: "0.1rem 0.5rem",
            borderRadius: 4, background: "var(--bg3)",
            border: "1px solid var(--border)",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "0.78rem", fontWeight: 600, color: "var(--text)",
          }}>{s}</span>
          {i < steps.length - 1 && (
            <span style={{ color: "var(--text3)", fontSize: "0.7rem" }}>›</span>
          )}
        </span>
      ))}
    </span>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: "JetBrains Mono, monospace", fontSize: "0.82em",
      background: "var(--bg3)", border: "1px solid var(--border)",
      borderRadius: 4, padding: "0.1em 0.4em", color: "var(--accent)",
    }}>
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre style={{
      background: "var(--bg3)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "1rem 1.25rem",
      fontFamily: "JetBrains Mono, monospace", fontSize: "0.82rem",
      lineHeight: 1.65, overflowX: "auto", margin: "0.75rem 0",
      color: "var(--text2)", whiteSpace: "pre-wrap", wordBreak: "break-all",
    }}>
      {children}
    </pre>
  );
}

function Note({ type = "info", children }: { type?: "info" | "warn" | "tip"; children: React.ReactNode }) {
  const styles = {
    info: { bg: "rgba(99,102,241,0.07)", border: "rgba(99,102,241,0.3)", icon: "ℹ️", color: "#818cf8" },
    warn: { bg: "rgba(251,191,36,0.07)", border: "rgba(251,191,36,0.3)", icon: "⚠️", color: "#fbbf24" },
    tip:  { bg: "rgba(74,222,128,0.07)", border: "rgba(74,222,128,0.25)", icon: "💡", color: "#4ade80" },
  };
  const s = styles[type];
  return (
    <div style={{
      padding: "0.9rem 1.1rem", borderRadius: 8, margin: "0.75rem 0",
      background: s.bg, border: `1px solid ${s.border}`,
      display: "flex", gap: "0.75rem", alignItems: "flex-start",
      fontSize: "0.85rem", lineHeight: 1.6, color: "var(--text2)",
    }}>
      <span style={{ flexShrink: 0, fontSize: "1rem" }}>{s.icon}</span>
      <div>{children}</div>
    </div>
  );
}

function StepBlock({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", gap: "1.1rem", alignItems: "flex-start",
      margin: "1.25rem 0",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
        background: "var(--accent)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: "0.85rem",
        fontFamily: "JetBrains Mono, monospace",
        marginTop: 2,
      }}>
        {num}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.5rem" }}>{title}</div>
        <div style={{ fontSize: "0.87rem", color: "var(--text2)", lineHeight: 1.65 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Diagramme de consensus ────────────────────────────────────────────────────

function FlowDiagram() {
  const nodes = [
    {
      actor: "Artiste",
      icon: "🎨",
      color: "#7c6bff",
      bg: "rgba(124,107,255,0.08)",
      border: "rgba(124,107,255,0.3)",
      items: [
        "Dessine dans le navigateur web",
        "Soumet le dessin au réseau",
      ],
      api: "POST /api/draw",
    },
    {
      actor: "Serveur",
      icon: "🌐",
      color: "#818cf8",
      bg: "rgba(99,102,241,0.08)",
      border: "rgba(99,102,241,0.3)",
      items: [
        "Reçoit et encode le dessin (1bpp / RGB565)",
        "Calcule le score de complexité visuelle",
        "Publie le candidat dans Redis",
      ],
      api: "candidate:current → Redis TTL=600s",
    },
    {
      actor: "ESP×N — Validateurs",
      icon: "📡",
      color: "#4ade80",
      bg: "rgba(74,222,128,0.06)",
      border: "rgba(74,222,128,0.25)",
      items: [
        "Détectent le candidat via GET /api/pull",
        "Calculent métriques visuelles localement (entropie, RLE, transitions)",
        "Soumettent leur vote individuel",
      ],
      api: "POST /api/validation-result",
      decision: "Quorum ≥ 51 % du réseau actif atteint ?",
    },
    {
      actor: "Serveur — Finalisation",
      icon: "⛏️",
      color: "#fbbf24",
      bg: "rgba(251,191,36,0.06)",
      border: "rgba(251,191,36,0.25)",
      items: [
        "Valide le quorum et finalise le bloc SHA-256",
        "Stocke l'image + métadonnées (sans TTL) dans Redis",
        "Sélectionne le mineur par tirage équitable pondéré",
        "Broadcast frame:{deviceId} à tous les ESP",
      ],
      api: "chain:block:{hash} gravé définitivement",
    },
    {
      actor: "ESP×N — Affichage",
      icon: "🖥️",
      color: "#4ade80",
      bg: "rgba(74,222,128,0.06)",
      border: "rgba(74,222,128,0.25)",
      items: [
        "Détectent le nouveau frameId via GET /api/pull",
        "Téléchargent l'image binaire (readFull en boucle)",
        "Affichent le dessin sur l'écran physique",
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {nodes.map((node, i) => (
        <div key={i} style={{ width: "100%", maxWidth: 580, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{
            width: "100%",
            padding: "1rem 1.25rem",
            borderRadius: 10,
            border: `1px solid ${node.border}`,
            background: node.bg,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1rem" }}>{node.icon}</span>
              <span style={{ fontWeight: 800, fontSize: "0.88rem", color: node.color }}>{node.actor}</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
              {node.items.map((item, j) => (
                <li key={j} style={{ fontSize: "0.83rem", color: "var(--text2)", lineHeight: 1.55, marginBottom: "0.1rem" }}>
                  {item}
                </li>
              ))}
            </ul>
            {node.api && (
              <div style={{
                marginTop: "0.55rem",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "0.7rem", color: "var(--text3)",
                paddingLeft: "0.25rem",
              }}>
                ↳ {node.api}
              </div>
            )}
          </div>

          {i < nodes.length - 1 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0.4rem 0", gap: "0.3rem" }}>
              {node.decision && (
                <div style={{
                  padding: "0.4rem 1rem", borderRadius: 20, margin: "0.2rem 0",
                  background: "rgba(251,191,36,0.1)",
                  border: "1px solid rgba(251,191,36,0.35)",
                  fontSize: "0.74rem", fontWeight: 700, color: "#fbbf24",
                  textAlign: "center", maxWidth: 400,
                }}>
                  ◆ {node.decision}
                </div>
              )}
              <svg width="16" height="24" viewBox="0 0 16 24" fill="none">
                <line x1="8" y1="0" x2="8" y2="18" stroke="var(--text3)" strokeWidth="1.5"/>
                <polyline points="3,13 8,20 13,13" fill="none" stroke="var(--text3)" strokeWidth="1.5"/>
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Carte firmware ─────────────────────────────────────────────────────────────

function FirmwareCard({
  variant, label, screens, filename, desc, imageFile,
}: {
  variant: string; label: string; screens: string;
  filename: string; desc: string; imageFile?: string;
}) {
  const [imgOk, setImgOk] = useState(!!imageFile);

  return (
    <div style={{
      padding: "1.1rem 1.25rem", borderRadius: 10,
      border: "1px solid var(--border)", background: "var(--bg2)",
      display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
    }}>
      {/* Image de l'écran */}
      <div style={{
        width: 72, height: 72, borderRadius: 8, flexShrink: 0,
        background: "var(--bg3)", border: "1px solid var(--border)",
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {imageFile && imgOk ? (
          <img
            src={imageFile}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={() => setImgOk(false)}
          />
        ) : (
          <span style={{ fontSize: "1.6rem" }}>🖥️</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem" }}>{label}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--text3)", marginBottom: "0.15rem" }}>{screens}</div>
        <div style={{ fontSize: "0.72rem", color: "var(--text3)" }}>{desc}</div>
      </div>

      <a
        href={`/api/esp-firmware?variant=${variant}`}
        download={filename}
        style={{
          padding: "0.55rem 1.1rem", borderRadius: 8,
          background: "var(--accent)", color: "#fff",
          fontWeight: 600, fontSize: "0.82rem",
          textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
          display: "flex", alignItems: "center", gap: "0.4rem",
        }}
      >
        ↓ Télécharger
      </a>
    </div>
  );
}

// ── Carte rôle ─────────────────────────────────────────────────────────────────

function RoleCard({
  icon, label, title, desc, details,
}: {
  icon: string; label: string; title: string; desc: string; details: string[];
}) {
  return (
    <div style={{
      padding: "1.25rem", borderRadius: 12,
      border: "1px solid var(--border)", background: "var(--bg2)",
    }}>
      <div style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>{icon}</div>
      <div style={{
        fontSize: "0.63rem", fontWeight: 700, color: "var(--accent)",
        textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem",
      }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.4rem" }}>{title}</div>
      <div style={{ fontSize: "0.82rem", color: "var(--text3)", lineHeight: 1.5, marginBottom: "0.75rem" }}>
        {desc}
      </div>
      <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {details.map((d, i) => (
          <li key={i} style={{
            fontSize: "0.73rem", color: "var(--text3)",
            fontFamily: "JetBrains Mono, monospace", lineHeight: 1.55,
            marginBottom: "0.1rem",
          }}>
            {d}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Page principale ────────────────────────────────────────────────────────────

export default function LearnPage() {
  const active = useTocActive();
  const [tocOpen, setTocOpen] = useState(false);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: "2.5rem", padding: "1.5rem 0 1rem" }}>
        <div style={{
          display: "inline-block", padding: "0.3rem 0.9rem",
          borderRadius: 20, border: "1px solid var(--border)",
          fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.1em",
          color: "var(--accent)", textTransform: "uppercase", marginBottom: "1rem",
        }}>
          Guide complet · White paper
        </div>
        <h1 style={{
          fontSize: "2.2rem", fontWeight: 800, letterSpacing: "-0.04em",
          lineHeight: 1.15, margin: "0 0 0.9rem",
        }}>
          Proof-of-<em style={{ color: "var(--accent)", fontStyle: "normal" }}>Draw</em>
        </h1>
        <p style={{
          fontSize: "1.05rem", color: "var(--text2)", maxWidth: 520,
          margin: "0 auto 1.5rem", lineHeight: 1.65,
        }}>
          De zéro à votre premier dessin affiché sur un écran physique — et le
          détail complet du protocole pour les curieux.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/draw" style={{
            padding: "0.6rem 1.4rem", borderRadius: 8,
            background: "var(--accent)", color: "#fff",
            fontWeight: 700, fontSize: "0.88rem", textDecoration: "none",
          }}>
            Commencer à dessiner →
          </Link>
          <Link href="/onboard" style={{
            padding: "0.6rem 1.4rem", borderRadius: 8,
            border: "1px solid var(--border)", color: "var(--text2)",
            fontWeight: 600, fontSize: "0.88rem", textDecoration: "none",
          }}>
            Connecter un ESP
          </Link>
        </div>
      </div>

      {/* ── Table des matières centrée ── */}
      <div style={{ marginBottom: "2.5rem" }}>
        <button
          onClick={() => setTocOpen(!tocOpen)}
          style={{
            width: "100%", background: "var(--bg2)",
            border: "1px solid var(--border)", borderRadius: 8,
            padding: "0.7rem 1.1rem", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            color: "var(--text2)", fontWeight: 600, fontSize: "0.85rem",
          }}
        >
          Table des matières
          <span style={{ transform: tocOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", fontSize: "0.7rem" }}>▼</span>
        </button>
        {tocOpen && (
          <div style={{
            marginTop: "0.4rem", background: "var(--bg2)",
            border: "1px solid var(--border)", borderRadius: 8,
            padding: "1rem 1.25rem",
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 2rem",
          }}>
            {[1, 2].map((part) => (
              <div key={part}>
                <div style={{
                  fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.1em",
                  textTransform: "uppercase", color: part === 1 ? "var(--accent)" : "#6366f1",
                  marginBottom: "0.5rem",
                }}>
                  Partie {part} — {part === 1 ? "Démarrer" : "Fonctionnement"}
                </div>
                {TOC_ITEMS.filter((t) => t.part === part).map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={() => setTocOpen(false)}
                    style={{
                      display: "block", padding: "0.28rem 0.35rem",
                      borderRadius: 5, marginBottom: "0.1rem",
                      color: active === item.id ? "var(--accent)" : "var(--text3)",
                      background: active === item.id ? "rgba(124,107,255,0.08)" : "transparent",
                      fontWeight: active === item.id ? 700 : 400,
                      textDecoration: "none", fontSize: "0.82rem",
                      transition: "color 0.1s",
                    }}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Contenu principal ── */}
      <div>

          {/* ══════════════════════════════════════════════════════════
              PARTIE 1 — DÉMARRER
          ══════════════════════════════════════════════════════════ */}
          <PartBadge num={1} label="Pour démarrer — du débutant au premier affichage" />

          {/* ── Intro ── */}
          <Section id="intro">
            <H2>Qu&apos;est-ce que Proof-of-Draw ?</H2>
            <Lead>
              Proof-of-Draw est un réseau ouvert où des artistes dessinent à la main
              dans un navigateur web, et leurs créations sont <strong>validées collectivement</strong>{" "}
              par des micro-ordinateurs (ESP8266), puis affichées en temps réel sur des
              écrans physiques. Chaque dessin validé est gravé de façon permanente dans
              une <strong>chaîne de blocs légère</strong>.
            </Lead>

            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: "0.75rem", marginBottom: "1.5rem",
            }}>
              {[
                { icon: "🎨", title: "Dessiner", desc: "Créez depuis n'importe quel navigateur web, sans installation, gratuitement." },
                { icon: "📡", title: "Valider", desc: "Les ESP connectés au réseau votent ensemble pour accepter ou refuser votre dessin." },
                { icon: "⛏️", title: "Miner", desc: "Un bloc est gravé dans la chaîne avec votre dessin, votre nom et la date." },
                { icon: "🖥️", title: "Afficher", desc: "Votre dessin s'affiche sur les écrans physiques connectés au réseau." },
              ].map((c) => (
                <div key={c.title} style={{
                  padding: "1rem", borderRadius: 10,
                  border: "1px solid var(--border)", background: "var(--bg2)",
                }}>
                  <div style={{ fontSize: "1.4rem", marginBottom: "0.4rem" }}>{c.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.2rem" }}>{c.title}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text3)", lineHeight: 1.45 }}>{c.desc}</div>
                </div>
              ))}
            </div>

            <Note type="tip">
              <strong>Pas besoin d&apos;ESP pour dessiner !</strong> Vous pouvez utiliser les écrans
              partagés par d&apos;autres participants. Voir{" "}
              <a href="#no-esp" style={{ color: "var(--accent)" }}>Participer sans ESP</a>.
            </Note>
          </Section>

          {/* ── Matériel ── */}
          <Section id="material">
            <H2>Matériel compatible</H2>
            <Lead>
              Le réseau tourne sur des cartes <strong>NodeMCU v1 (ESP8266)</strong> associées
              à l&apos;un des écrans ci-dessous. C&apos;est le seul matériel nécessaire.
            </Lead>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
              {[
                {
                  img: "/eink29bwr.jpg",
                  title: 'E-Ink 2.9" Noir / Blanc / Rouge',
                  ref: "Waveshare 2.9inch e-Paper B V4",
                  dims: "296×128 px · 3 couleurs",
                  note: "Le plus testé sur ce réseau, 3 couleurs : noir, blanc, rouge.",
                },
                {
                  img: "/eink27bw.jpg",
                  title: 'E-Ink 2.7" Noir / Blanc',
                  ref: "Waveshare 2.7inch e-Paper V2",
                  dims: "264×176 px · 2 couleurs",
                  note: "Plus grand, résolution supérieure, noir et blanc uniquement.",
                },
                {
                  img: "/tft18.jpg",
                  title: 'TFT 1.8" Couleur',
                  ref: "ST7735S 1.8\" TFT",
                  dims: "128×160 px · RGB 65 536 couleurs",
                  note: "Rafraîchissement instantané, couleur complète, idéal pour les animations.",
                },
              ].map((s, i) => {
                const [ok, setOk] = useState(true);
                return (
                  <div key={i} style={{
                    display: "flex", gap: "1rem", alignItems: "flex-start",
                    padding: "1rem 1.25rem", borderRadius: 10,
                    border: "1px solid var(--border)", background: "var(--bg2)",
                    flexWrap: "wrap",
                  }}>
                    <div style={{
                      width: 80, height: 80, borderRadius: 8, flexShrink: 0,
                      background: "var(--bg3)", border: "1px solid var(--border)",
                      overflow: "hidden",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {ok ? (
                        <img src={s.img} alt={s.title}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={() => setOk(false)}
                        />
                      ) : (
                        <span style={{ fontSize: "1.8rem" }}>🖥️</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ marginBottom: "0.2rem" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{s.title}</span>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--accent)", fontFamily: "JetBrains Mono, monospace", marginBottom: "0.2rem" }}>{s.ref}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text3)", marginBottom: "0.25rem" }}>{s.dims}</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--text2)", lineHeight: 1.4 }}>{s.note}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Note type="info">
              La carte <strong>NodeMCU v1 (ESP-12E)</strong> est la même pour tous les écrans.
              Seul le câblage et le firmware changent. Vous trouverez ces composants facilement
              sur AliExpress, Amazon ou Mouser pour environ 5–15 € pièce.
            </Note>
          </Section>

          {/* ── Arduino IDE ── */}
          <Section id="arduino-ide">
            <H2>Installer Arduino IDE</H2>
            <Lead>
              Arduino IDE est le logiciel qui permet d&apos;écrire et d&apos;envoyer du code sur
              votre NodeMCU. Il est gratuit et fonctionne sur Windows, macOS et Linux.
            </Lead>

            <StepBlock num={1} title="Télécharger Arduino IDE 2.x">
              Rendez-vous sur{" "}
              <a href="https://www.arduino.cc/en/software" target="_blank" rel="noreferrer"
                style={{ color: "var(--accent)" }}>
                arduino.cc/en/software
              </a>{" "}
              et téléchargez la version <strong>2.x</strong> pour votre système d&apos;exploitation.
              Installez-le normalement (double-clic sur l&apos;installeur).
            </StepBlock>

            <StepBlock num={2} title="Installer le pilote USB (si nécessaire)">
              Le NodeMCU utilise une puce USB-Série (CH340 ou CP2102).
              Si votre ordinateur ne reconnaît pas la carte à la connexion USB,
              installez le pilote correspondant :
              <ul style={{ marginTop: "0.5rem", paddingLeft: "1.2rem" }}>
                <li style={{ marginBottom: "0.25rem" }}>
                  <strong>CH340</strong> (le plus courant) :{" "}
                  <a href="https://sparks.gogo.co.nz/ch340.html" target="_blank" rel="noreferrer"
                    style={{ color: "var(--accent)" }}>pilote CH340</a>
                </li>
                <li>
                  <strong>CP2102</strong> :{" "}
                  <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noreferrer"
                    style={{ color: "var(--accent)" }}>pilote Silicon Labs CP210x</a>
                </li>
              </ul>
              <Note type="tip">
                Pour savoir quelle puce utilise votre carte : regardez l&apos;inscription sur le plus petit chip
                noir situé près du connecteur USB.
              </Note>
            </StepBlock>
          </Section>

          {/* ── Cartes ESP ── */}
          <Section id="esp-boards">
            <H2>Ajouter les cartes ESP8266 dans Arduino IDE</H2>
            <Lead>
              Par défaut, Arduino IDE ne connaît pas la carte NodeMCU. Il faut lui indiquer
              où télécharger la définition de la carte ESP8266.
            </Lead>

            <StepBlock num={1} title="Ouvrir les préférences">
              Dans le menu en haut : <MenuPath steps={["Fichier", "Préférences"]} />
              <br />(ou <Code>Ctrl + ,</Code> sur Windows / <Code>⌘ ,</Code> sur macOS)
            </StepBlock>

            <StepBlock num={2} title="Ajouter l'URL du gestionnaire de cartes">
              Dans la fenêtre Préférences, trouvez le champ{" "}
              <strong>« URL de gestionnaire de cartes supplémentaires »</strong>.
              Cliquez sur l&apos;icône à droite du champ et ajoutez cette ligne :
              <CodeBlock>http://arduino.esp8266.com/stable/package_esp8266com_index.json</CodeBlock>
              Cliquez sur <strong>OK</strong> pour fermer les préférences.
              <Note type="warn">
                Si une URL est déjà présente dans ce champ, ajoutez la nouvelle sur une ligne séparée
                — ne supprimez pas l&apos;existante.
              </Note>
            </StepBlock>

            <StepBlock num={3} title="Ouvrir le Gestionnaire de cartes">
              Dans le menu : <MenuPath steps={["Outils", "Type de carte", "Gestionnaire de cartes…"]} />
              <br />Une fenêtre s&apos;ouvre avec la liste de tous les packages disponibles.
            </StepBlock>

            <StepBlock num={4} title="Installer le package ESP8266">
              Dans la barre de recherche du Gestionnaire de cartes, tapez{" "}
              <Code>esp8266</Code>.
              <br /><br />
              Le package <strong>« esp8266 by ESP8266 Community »</strong> apparaît.
              Sélectionnez la dernière version dans le menu déroulant, puis cliquez sur{" "}
              <strong>Installer</strong>.
              <br /><br />
              Le téléchargement prend quelques minutes selon votre connexion. Attendez que la barre de progression disparaisse.
            </StepBlock>

            <StepBlock num={5} title="Sélectionner la carte NodeMCU 1.0">
              Une fois le package installé, rendez-vous dans :{" "}
              <MenuPath steps={["Outils", "Type de carte", "ESP8266 Boards", "NodeMCU 1.0 (ESP-12E Module)"]} />
              <Note type="info">
                Si vous ne voyez pas <strong>ESP8266 Boards</strong> dans le menu, redémarrez Arduino IDE et réessayez.
              </Note>
            </StepBlock>

            <StepBlock num={6} title="Sélectionner le port COM">
              Connectez votre NodeMCU en USB à votre ordinateur, puis allez dans :{" "}
              <MenuPath steps={["Outils", "Port"]} /><br /><br />
              Un ou plusieurs ports apparaissent (ex. <Code>COM3</Code> sur Windows,{" "}
              <Code>/dev/ttyUSB0</Code> sur Linux). Sélectionnez le port correspondant
              à votre carte.<br /><br />
              Si aucun port n&apos;apparaît, le pilote USB n&apos;est pas installé correctement
              (voir étape précédente).
            </StepBlock>

            <StepBlock num={7} title="Vérifier avec l'exemple Blink">
              Pour tester que tout fonctionne avant de flasher le firmware réel :
              <br /><br />
              Ouvrez <MenuPath steps={["Fichier", "Exemples", "01.Basics", "Blink"]} /><br /><br />
              Cliquez sur la flèche <strong>→ Téléverser</strong> (ou <Code>Ctrl + U</Code>).
              Après le téléversement, la LED bleue de la carte doit clignoter toutes les secondes.
              Si c&apos;est le cas, votre environnement est prêt.
            </StepBlock>
          </Section>

          {/* ── Bibliothèques ── */}
          <Section id="libraries">
            <H2>Bibliothèques requises</H2>
            <Lead>
              En plus du core ESP8266, le firmware Proof-of-Draw a besoin de plusieurs
              bibliothèques. Installez-les via le Gestionnaire de bibliothèques d&apos;Arduino IDE.
            </Lead>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
              {[
                {
                  name: "ArduinoJson",
                  version: "≥ 7.x",
                  desc: "Parsing des réponses JSON du serveur (pull, validate-candidate…)",
                  all: true,
                },
                {
                  name: "ESP8266HTTPClient",
                  version: "incluse dans le core ESP8266",
                  desc: "Requêtes HTTP/HTTPS vers le serveur Vercel",
                  all: true,
                },
                {
                  name: "GxEPD2",
                  version: "dernière version",
                  desc: "Driver e-ink Waveshare (e-Paper 2.9\" et 2.7\")",
                  eink: true,
                },
                {
                  name: "Adafruit GFX Library",
                  version: "dernière version",
                  desc: "Base graphique requise par GxEPD2 et Adafruit ST7735",
                  all: true,
                },
                {
                  name: "Adafruit ST7735 and ST7789 Library",
                  version: "dernière version",
                  desc: "Driver TFT 1.8\" (uniquement pour la variante TFT)",
                  tft: true,
                },
              ].map((lib, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: "0.75rem",
                  padding: "0.85rem 1rem", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--bg2)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: "0.85rem", fontWeight: 700, color: "var(--accent)",
                      }}>
                        {lib.name}
                      </span>
                      <span style={{
                        fontSize: "0.68rem", color: "var(--text3)",
                        fontFamily: "JetBrains Mono, monospace",
                      }}>
                        {lib.version}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text3)", marginTop: "0.15rem" }}>
                      {lib.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text2)", lineHeight: 1.6 }}>
              Pour installer une bibliothèque : dans Arduino IDE, allez dans{" "}
              <MenuPath steps={["Outils", "Gérer les bibliothèques…"]} />,
              recherchez le nom exact et cliquez sur <strong>Installer</strong>.
            </p>

            <Note type="warn">
              Installez <strong>toutes</strong> les bibliothèques listées avant de tenter un téléversement,
              sinon la compilation échoue avec des erreurs <Code>#include</Code> non résolues.
            </Note>
          </Section>

          {/* ── Firmware ── */}
          <Section id="firmware">
            <H2>Télécharger le firmware</H2>
            <Lead>
              Chaque type d&apos;écran a son propre firmware. Téléchargez le ZIP correspondant
              à votre matériel.
            </Lead>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
              <FirmwareCard
                variant="eink29bwr"
                label='E-Ink 2.9" Noir / Blanc / Rouge'
                screens="Waveshare 2.9inch e-Paper B V4 · 296×128 px"
                filename="pod-firmware-eink29bwr.zip"
                desc="3 couleurs : noir, blanc, rouge. Refresh ~2s. Recommandé pour débuter."
                imageFile="/eink29bwr.jpg"
              />
              <FirmwareCard
                variant="eink27bwSolo"
                label='E-Ink 2.7" Noir / Blanc (écran seul)'
                screens="Waveshare 2.7inch e-Paper V2 · 264×176 px"
                filename="pod-firmware-eink27bw-solo.zip"
                desc="Mono-écran, uniquement l'e-ink 2.7 BW. Plus simple à câbler."
                imageFile="/eink27bw.jpg"
              />
              <FirmwareCard
                variant="eink27bw"
                label='E-Ink 2.7" BW + OLED 0.96" (double écran)'
                screens='Waveshare 2.7inch e-Paper V2 + OLED 0.96" · 264×176 px + 128×64 px'
                filename="pod-firmware-eink27bw-oled.zip"
                desc="Double écran : e-ink principal + OLED secondaire pour le statut réseau."
                imageFile="/eink27bw-oled.jpg"
              />
              <FirmwareCard
                variant="tft18"
                label='TFT 1.8" Couleur complète'
                screens="ST7735S · 128×160 px · RGB 65 536 couleurs"
                filename="pod-firmware-tft18.zip"
                desc="Couleur complète. Refresh instantané. Palette 48 couleurs dans l'éditeur."
                imageFile="/tft18.jpg"
              />
              <FirmwareCard
                variant="all"
                label="Tous les firmwares (archive complète)"
                screens="eink29bwr + eink27bw+oled + eink27bw solo + tft18"
                filename="pod-firmware-all.zip"
                desc="Les quatre dossiers. Idéal pour contribuer ou porter sur un nouvel écran."
              />
            </div>
          </Section>

          {/* ── Configurer & flasher ── */}
          <Section id="configure">
            <H2>Configurer et flasher le firmware</H2>
            <Lead>
              Avant de téléverser, vous devez indiquer au firmware l&apos;URL du serveur
              et vos identifiants WiFi.
            </Lead>

            <StepBlock num={1} title="Ouvrir le projet dans Arduino IDE">
              Décompressez le ZIP téléchargé. À l&apos;intérieur se trouve un dossier contenant un fichier
              {" "}<Code>.ino</Code>. Double-cliquez dessus — Arduino IDE s&apos;ouvre automatiquement
              avec le bon projet.
            </StepBlock>

            <StepBlock num={2} title="Modifier les variables de configuration">
              En haut du fichier <Code>.ino</Code>, trouvez et modifiez ces trois lignes :
              <CodeBlock>{`#define SERVER_URL    "https://votre-instance.vercel.app"
#define WIFI_SSID     "NomDeVotreWiFi"
#define WIFI_PASSWORD "MotDePasseWiFi"`}</CodeBlock>
              <Note type="tip">
                Si vous utilisez l&apos;instance publique de Proof-of-Draw, le <Code>SERVER_URL</Code>{" "}
                vous sera communiqué par l&apos;administrateur du réseau que vous rejoignez.
              </Note>
            </StepBlock>

            <StepBlock num={3} title="Vérifier les paramètres de la carte">
              Confirmez dans <MenuPath steps={["Outils"]} /> :
              <ul style={{ marginTop: "0.5rem", paddingLeft: "1.2rem" }}>
                <li><strong>Type de carte</strong> : NodeMCU 1.0 (ESP-12E Module)</li>
                <li><strong>Fréquence CPU</strong> : 80 MHz</li>
                <li><strong>Upload Speed</strong> : 115200</li>
                <li><strong>Port</strong> : le port COM de votre carte</li>
              </ul>
            </StepBlock>

            <StepBlock num={4} title="Téléverser le firmware">
              Cliquez sur la flèche <strong>→ Téléverser</strong> (ou <Code>Ctrl + U</Code>).
              <br /><br />
              Arduino IDE compile le code puis l&apos;envoie à la carte. La barre de progression
              en bas avance, puis le message{" "}
              <Code>Leaving... Hard resetting via RTS pin...</Code> apparaît : c&apos;est normal,
              le téléversement est réussi.
              <br /><br />
              La carte redémarre automatiquement et tente de se connecter au WiFi. Si vous
              avez un écran connecté, un code de jumelage à 6 chiffres s&apos;affiche dessus.
              <Note type="warn">
                Si la compilation échoue avec des erreurs <Code>undefined reference</Code> ou{" "}
                <Code>fatal error: xxx.h: No such file or directory</Code>, une bibliothèque
                manque. Retournez à la section{" "}
                <a href="#libraries" style={{ color: "var(--accent)" }}>Bibliothèques requises</a>.
              </Note>
            </StepBlock>

            <StepBlock num={5} title="Surveiller la connexion (optionnel)">
              Pour voir les logs de la carte en temps réel, ouvrez le Moniteur série :{" "}
              <MenuPath steps={["Outils", "Moniteur série"]} /> ou <Code>Ctrl + Shift + M</Code>.
              <br />
              Réglez la vitesse sur <Code>115200 bauds</Code>. Vous verrez la séquence :
              <CodeBlock>{`Connexion WiFi...
WiFi connecté — IP : 192.168.x.x
Enregistrement ESP... deviceId=abc123
Code de jumelage : 123456
Boucle principale — pull...`}</CodeBlock>
            </StepBlock>
          </Section>

          {/* ── Onboard ── */}
          <Section id="onboard">
            <H2>Onboarder sur le site</H2>
            <Lead>
              Le code de jumelage affiché sur l&apos;écran (ou dans le moniteur série)
              vous permet de lier l&apos;ESP à votre profil sur le site.
            </Lead>

            <StepBlock num={1} title="Aller sur la page d'onboarding">
              Sur le site Proof-of-Draw, cliquez sur{" "}
              <Link href="/onboard" style={{ color: "var(--accent)" }}>+ Onboard</Link>{" "}
              (ou directement <Code>/onboard</Code>).
            </StepBlock>

            <StepBlock num={2} title="Entrer le code de jumelage">
              Entrez le code à 6 chiffres affiché sur l&apos;écran de votre ESP (ex. <Code>483921</Code>).
              Le site vérifie le code et associe l&apos;ESP à votre session de navigateur.
            </StepBlock>

            <StepBlock num={3} title="Définir votre nom d'artiste">
              Entrez votre nom d&apos;artiste. Il apparaîtra sur tous les blocs que vous minez
              et dans l&apos;annuaire des{" "}
              <Link href="/artists" style={{ color: "var(--accent)" }}>artistes du réseau</Link>.
            </StepBlock>

            <StepBlock num={4} title="C'est prêt !">
              Votre ESP apparaît maintenant dans votre{" "}
              <Link href="/profile" style={{ color: "var(--accent)" }}>profil</Link>.
              Il est actif sur le réseau, participe aux votes, et affiche les dessins validés.
            </StepBlock>

            <Note type="info">
              Le code de jumelage est valable <strong>jusqu&apos;au redémarrage</strong> de l&apos;ESP.
              Si vous perdez le code, débranchez/rebranchez l&apos;ESP et reconnectez-vous
              au Moniteur série pour récupérer le nouveau code.
            </Note>
          </Section>

          {/* ── Dessiner ── */}
          <Section id="draw">
            <H2>Dessiner</H2>
            <Lead>
              Votre ESP est onboardé, vous pouvez maintenant soumettre des dessins au réseau.
            </Lead>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
              <div style={{
                padding: "1.1rem 1.25rem", borderRadius: 10,
                border: "1px solid rgba(124,107,255,0.3)", background: "rgba(124,107,255,0.06)",
              }}>
                <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>1. Ouvrir l&apos;éditeur</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text3)", lineHeight: 1.55 }}>
                  Allez sur{" "}
                  <Link href="/draw" style={{ color: "var(--accent)" }}>la page Dessiner</Link>.
                  Sélectionnez votre device et le type d&apos;écran dans le menu déroulant.
                  Le canvas se redimensionne automatiquement aux bonnes proportions.
                </div>
              </div>
              <div style={{
                padding: "1.1rem 1.25rem", borderRadius: 10,
                border: "1px solid var(--border)", background: "var(--bg2)",
              }}>
                <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>2. Dessiner et soumettre</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text3)", lineHeight: 1.55 }}>
                  Dessinez à la main sur le canvas. Quand vous êtes satisfait,
                  cliquez sur <strong>Soumettre</strong>. Le dessin est envoyé au serveur
                  et entre dans la file de validation.
                </div>
              </div>
              <div style={{
                padding: "1.1rem 1.25rem", borderRadius: 10,
                border: "1px solid var(--border)", background: "var(--bg2)",
              }}>
                <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>3. Attendre la validation</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text3)", lineHeight: 1.55 }}>
                  Les ESP du réseau votent automatiquement dans les ~30 secondes.
                  Dès que le quorum est atteint (≥ 51% des ESP actifs ont voté),
                  votre dessin est miné et s&apos;affiche sur tous les écrans physiques connectés.
                </div>
              </div>
            </div>

            <Note type="tip">
              Un dessin trop simple (quelques pixels) ou trop rapide (bot détecté) peut être refusé.
              Dessinez avec soin — le réseau favorise les créations avec du détail et de la complexité.
            </Note>
          </Section>

          {/* ── Sans ESP ── */}
          <Section id="no-esp">
            <H2>Participer sans ESP</H2>
            <Lead>
              Vous n&apos;avez pas de matériel ? Vous pouvez quand même participer pleinement.
            </Lead>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <div style={{
                padding: "1.2rem", borderRadius: 10,
                border: "1px solid rgba(124,107,255,0.3)", background: "rgba(124,107,255,0.06)",
              }}>
                <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>🎨 Dessiner sur un ESP public</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text3)", lineHeight: 1.5 }}>
                  D&apos;autres participants peuvent mettre leurs ESP en <em>mode prêt public</em>.
                  Vous dessinez sur leurs écrans comme si c&apos;était les vôtres — votre nom
                  d&apos;artiste est inscrit dans le bloc miné.
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
                  La galerie est publique. Explorez tous les blocs minés, les dessins,
                  les scores, les artistes, les ESP validateurs.
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <Link href="/gallery" style={{
                    padding: "0.4rem 1rem", borderRadius: 6,
                    border: "1px solid var(--border)", background: "var(--bg3)",
                    color: "var(--text2)", fontWeight: 600, fontSize: "0.78rem", textDecoration: "none",
                  }}>Block explorer →</Link>
                  <Link href="/artists" style={{
                    padding: "0.4rem 1rem", borderRadius: 6,
                    border: "1px solid var(--border)", background: "var(--bg3)",
                    color: "var(--text2)", fontWeight: 600, fontSize: "0.78rem", textDecoration: "none",
                  }}>Artistes du réseau →</Link>
                </div>
              </div>
            </div>
          </Section>

          {/* ══════════════════════════════════════════════════════════
              PARTIE 2 — FONCTIONNEMENT
          ══════════════════════════════════════════════════════════ */}
          <PartBadge num={2} label="Fonctionnement — Architecture & protocole" />

          {/* ── Comment ça marche ── */}
          <Section id="how">
            <H2>Comment ça marche ?</H2>
            <Lead>
              Le réseau repose sur une architecture <strong>pull-based</strong> : ce sont
              toujours les ESP qui interrogent le serveur, jamais l&apos;inverse.
              Cela permet de fonctionner derrière n&apos;importe quel routeur ou NAT
              sans exposer d&apos;IP locale.
            </Lead>

            <div style={{ marginBottom: "2rem" }}>
              <FlowDiagram />
            </div>

            <H3>Séparation pull léger / fetch binaire</H3>
            <p style={{ fontSize: "0.87rem", color: "var(--text2)", lineHeight: 1.65, marginBottom: "1rem" }}>
              Pour économiser la mémoire des ESP8266 (~47 KB de heap), les échanges sont
              divisés en deux niveaux :
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{
                padding: "1rem", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg2)",
              }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--accent)" }}>
                  GET /api/pull
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text3)", lineHeight: 1.5, marginBottom: "0.5rem" }}>
                  Métadonnées légères (~300 B). L&apos;ESP l&apos;appelle régulièrement
                  pour savoir quoi faire.
                </div>
                <CodeBlock>{`{
  "frameSource": "consensus",
  "frameId": "abc…",
  "chain": { "blockIndex": 7 },
  "pendingValidation": {
    "candidateId": "xyz…"
  }
}`}</CodeBlock>
              </div>
              <div style={{
                padding: "1rem", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg2)",
              }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.4rem", color: "var(--accent)" }}>
                  GET /api/pull-frame?fmt=bin
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text3)", lineHeight: 1.5, marginBottom: "0.5rem" }}>
                  Image binaire brute (9 472 B pour l&apos;e-ink 2.9&quot;). Appelé
                  uniquement quand un nouveau frameId est détecté.
                </div>
                <CodeBlock>{`// 9472 octets bruts :
// [0..4735]    blackBuf
// [4736..9471] redBuf
// Content-Type: application/octet-stream`}</CodeBlock>
              </div>
            </div>
          </Section>

          {/* ── Rôles ── */}
          <Section id="roles">
            <H2>Les rôles du réseau</H2>
            <Lead>
              Chaque participant joue un ou plusieurs rôles simultanément. Un même ESP
              peut être validateur, mineur, et afficheur.
            </Lead>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <RoleCard
                icon="🎨"
                label="Artiste"
                title="Créateur du dessin"
                desc="Dessine dans le navigateur et soumet son œuvre au réseau. Peut utiliser son propre ESP ou un ESP public partagé."
                details={[
                  "POST /api/draw",
                  "Rate-limit 1 dessin / fenêtre par device",
                  "Session cookie HMAC-SHA256",
                  "Détection bot : automationRatio > 80%",
                ]}
              />
              <RoleCard
                icon="📡"
                label="Validateur"
                title="Nœud de consensus"
                desc="ESP8266 connecté au WiFi. Il interroge périodiquement le serveur, calcule des métriques visuelles, et vote pour valider les dessins."
                details={[
                  "GET /api/pull (toutes les N s)",
                  "GET /api/validate-candidate",
                  "POST /api/validation-result",
                  "Max 4 requêtes / min par device",
                ]}
              />
              <RoleCard
                icon="⛏️"
                label="Mineur"
                title="Finalise un bloc"
                desc="Un ESP validateur est tiré au sort à chaque quorum. Il reçoit une notification et son compteur de blocs minés augmente."
                details={[
                  "Tirage pondéré inverse (favorise les nouveaux)",
                  "chain:notify:{deviceId}",
                  "poids = WEIGHT_BASE / (blocs + 1)",
                  "Pas de calcul hashcash : le vote = travail",
                ]}
              />
              <RoleCard
                icon="🖥️"
                label="Serveur"
                title="Orchestrateur"
                desc="Hébergé sur Vercel + Upstash Redis. Coordonne les soumissions, stocke la chaîne, broadcast les frames validées."
                details={[
                  "Next.js API Routes (serverless)",
                  "Upstash Redis (KV, sans TTL sur les blocs)",
                  "chain:recent (liste ordonnée)",
                  "candidate:current (TTL 600s)",
                ]}
              />
            </div>

            <Note type="info">
              <strong>Mode prêt public :</strong> un artiste peut activer <Code>publicMode = true</Code>{" "}
              sur ses ESP. D&apos;autres artistes peuvent alors y dessiner. Le propriétaire de l&apos;ESP
              reste l&apos;auteur du device ; le dessinateur est crédité via <Code>drawArtistName</Code>{" "}
              dans le bloc.
            </Note>
          </Section>

          {/* ── Consensus ── */}
          <Section id="consensus">
            <H2>Protocole de consensus</H2>
            <Lead>
              Le consensus de Proof-of-Draw est inspiré du Proof-of-Work mais sans
              calcul intensif de hash : les ESP mesurent la <em>complexité visuelle</em>{" "}
              du dessin et votent à la majorité.
            </Lead>

            <H3>1. Soumission du dessin</H3>
            <p style={{ fontSize: "0.87rem", color: "var(--text2)", lineHeight: 1.65 }}>
              <Code>POST /api/draw</Code> — le canvas est encodé en{" "}
              <strong>1 bit par pixel</strong> pour les e-ink et OLED (0 = coloré,
              1 = blanc), ou en <strong>RGB565 LE</strong> pour les TFT. Le serveur
              vérifie la session, applique le rate-limit par device, calcule le score
              de complexité, et publie le candidat dans Redis avec un TTL de 600 s.
            </p>

            <H3>2. Vote des ESP</H3>
            <p style={{ fontSize: "0.87rem", color: "var(--text2)", lineHeight: 1.65 }}>
              Chaque ESP actif voit le candidat via <Code>/api/pull</Code>, télécharge
              les métadonnées via <Code>/api/validate-candidate</Code> (sans image complète —
              pour économiser la RAM), calcule ses propres métriques et soumet son score
              via <Code>POST /api/validation-result</Code>.
            </p>
            <p style={{ fontSize: "0.87rem", color: "var(--text2)", lineHeight: 1.65, marginTop: "0.75rem" }}>
              Métriques calculées localement sur l&apos;ESP :
            </p>
            <ul style={{ fontSize: "0.83rem", color: "var(--text2)", paddingLeft: "1.4rem", lineHeight: 1.7 }}>
              <li><strong>Entropie binaire</strong> — diversité pixel à pixel</li>
              <li><strong>Compteur de transitions</strong> — changements de couleur horizontaux et verticaux</li>
              <li><strong>Score RLE</strong> — complexité par codage Run-Length Encoding</li>
              <li><strong>Taux de couverture</strong> — proportion de pixels non-blancs</li>
            </ul>

            <H3>3. Quorum et finalisation</H3>
            <p style={{ fontSize: "0.87rem", color: "var(--text2)", lineHeight: 1.65 }}>
              Le quorum est atteint quand{" "}
              <Code>⌈ poolSize × QUORUM_RATIO ⌉</Code> votes ont été reçus
              (QUORUM_RATIO = 0,51 par défaut, minimum 1 vote).
              Le serveur finalise le bloc, génère son hash SHA-256 enchaîné au
              bloc précédent (<Code>parentHash</Code>), stocke image + métadonnées
              sans TTL, et sélectionne le mineur par tirage pondéré.
            </p>
            <Note type="info">
              Le serveur compare le score qu&apos;il a calculé avec ceux reçus des ESP.
              Un écart &gt; 0,4 entre score serveur et score ESP déclenche une alerte,
              mais ne bloque pas le vote — c&apos;est la majorité qui prime.
            </Note>

            <H3>4. Sélection équitable du mineur</H3>
            <p style={{ fontSize: "0.87rem", color: "var(--text2)", lineHeight: 1.65 }}>
              Le mineur n&apos;est pas le plus rapide mais tiré au sort parmi tous les
              validateurs avec un poids{" "}
              <Code>WEIGHT_BASE / (blocksMinés + 1)</Code>. Les devices qui
              n&apos;ont jamais miné ont le poids maximum — le réseau favorise les
              nouveaux participants.
            </p>
          </Section>

          {/* ── Solidité ── */}
          <Section id="why">
            <H2>Solidité technique</H2>
            <Lead>
              Des choix d&apos;architecture pensés pour la résilience, la décentralisation
              et la traçabilité.
            </Lead>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              {[
                {
                  icon: "🔒",
                  title: "Aucune IP locale exposée",
                  desc: "Les ESP ne sont jamais contactés directement par le serveur. C'est toujours eux qui interrogent — pull-based. Fonctionne derrière n'importe quel routeur, NAT ou réseau mobile sans configuration.",
                  api: "frame:{deviceId} Redis key · GET /api/pull",
                },
                {
                  icon: "⛓️",
                  title: "Blockchain permanente et vérifiable",
                  desc: "Les blocs et leurs images sont stockés sans TTL dans Redis. Chaque bloc contient le hash SHA-256 du précédent (parentHash) — la chaîne est vérifiable, immuable et publique.",
                  api: "chain:block:{hash} · chain:image:{hash} · chain:recent",
                },
                {
                  icon: "🤖",
                  title: "Résistance aux bots",
                  desc: "Le serveur détecte les séquences d'actions trop rapides (intervalles < 15 ms, automationRatio > 80%). Mais c'est le réseau de ESP qui décide de la qualité — pas un algorithme central.",
                  api: "automationRatio · MAX_AUTOMATION_RATIO = 0.80",
                },
                {
                  icon: "⚖️",
                  title: "Minage équitable",
                  desc: "Le mineur n'est pas celui qui répond le plus vite, mais tiré au sort avec un poids inversement proportionnel aux blocs déjà minés. Les nouveaux participants sont activement favorisés.",
                  api: "selectEquitableMiner() · chain:device:{id}:blocks",
                },
                {
                  icon: "🔑",
                  title: "Authentification sans mot de passe",
                  desc: "Aucun compte, aucun email, aucune seed phrase. La session est un cookie signé HMAC-SHA256 qui prouve la possession du device. Tout est local au navigateur.",
                  api: "HMAC-SHA256 via WebCrypto · cookie httpOnly + SameSite",
                },
                {
                  icon: "📐",
                  title: "Seuils adaptatifs",
                  desc: "Les critères de qualité (complexité, couverture, durée du dessin) s'adaptent automatiquement à la moyenne historique du réseau par type d'écran — le réseau s'auto-calibre.",
                  api: "getEffectiveThresholds() · cache Redis 120s",
                },
              ].map((item) => (
                <div key={item.title} style={{
                  padding: "1.1rem 1.25rem", borderRadius: 10,
                  border: "1px solid var(--border)", background: "var(--bg2)",
                  display: "flex", gap: "1rem", alignItems: "flex-start",
                }}>
                  <span style={{ fontSize: "1.3rem", flexShrink: 0, marginTop: 2 }}>{item.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.3rem" }}>{item.title}</div>
                    <div style={{ fontSize: "0.83rem", color: "var(--text3)", lineHeight: 1.55, marginBottom: "0.4rem" }}>{item.desc}</div>
                    <div style={{
                      fontSize: "0.7rem", color: "var(--text3)",
                      fontFamily: "JetBrains Mono, monospace",
                      background: "var(--bg3)", borderRadius: 4, padding: "0.25rem 0.6rem",
                      display: "inline-block",
                    }}>
                      {item.api}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Licences ── */}
          <Section id="licence">
            <H2>Licences et droits</H2>
            <Lead>
              Proof-of-Draw adopte un cadre de licence clair, aligné sur les meilleures
              pratiques open source.
            </Lead>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
              <div style={{
                padding: "1.25rem", borderRadius: 12,
                border: "1px solid rgba(74,222,128,0.25)", background: "rgba(74,222,128,0.04)",
              }}>
                <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.4rem", color: "#4ade80" }}>
                  Code source — MIT
                </div>
                <div style={{ fontSize: "0.83rem", color: "var(--text3)", lineHeight: 1.65 }}>
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
                <div style={{ fontSize: "0.83rem", color: "var(--text3)", lineHeight: 1.65 }}>
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
              <strong style={{ color: "var(--text)" }}>Attribution blockchain :</strong> CC0
              ne signifie pas anonymat. Chaque dessin est lié à son auteur de façon immuable
              dans la chaîne de blocs — nom d&apos;artiste, hash du dessin, date de minage
              sont gravés pour toujours. L&apos;œuvre est libre d&apos;utilisation, mais son
              histoire reste traçable et publique.
              <br /><br />
              <strong style={{ color: "var(--text)" }}>Pas de contradiction :</strong> CC0 dit
              {" "}<em>« tout le monde peut utiliser ce dessin »</em>. La blockchain dit
              {" "}<em>« ce dessin a été créé par cet artiste, à cette date, et c&apos;est vérifiable »</em>.
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
            <h3 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.5rem", margin: "0 0 0.5rem" }}>
              Prêt à rejoindre le réseau ?
            </h3>
            <p style={{ color: "var(--text3)", fontSize: "0.85rem", margin: "0 0 1.5rem" }}>
              Aucune installation requise pour dessiner.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/draw" style={{
                padding: "0.65rem 1.5rem", borderRadius: 8,
                background: "var(--accent)", color: "#fff",
                fontWeight: 700, fontSize: "0.88rem", textDecoration: "none",
              }}>
                Dessiner maintenant →
              </Link>
              <a href="/api/esp-firmware?variant=all" download="pod-firmware-all.zip" style={{
                padding: "0.65rem 1.5rem", borderRadius: 8,
                border: "1px solid var(--border)", color: "var(--text2)",
                fontWeight: 600, fontSize: "0.88rem", textDecoration: "none",
              }}>
                ↓ Firmware complet (ZIP)
              </a>
            </div>
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
