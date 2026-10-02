"use client";

// app/profile/OwnDisplaysDebug.tsx
// Détail de ce que MES écrans affichent (debug). La carte réseau publique ne montre que des images ; tout le reste —
// titre, artiste, nature de l'œuvre, date de confirmation, frameId, bloc, mode frame|scène, écrans sans confirmation —
// est ici, réservé au propriétaire (/api/my-devices/displays).

import { useCallback, useEffect, useState } from "react";
import type { OwnedDevice } from "@/lib/deviceStore";
import type { ShownRecord } from "@/lib/displayState";
import { ShownThumb } from "../network/LiveDisplays";

type OwnMap = Record<string, Record<string, ShownRecord>>;

const SCREEN_LABEL: Record<string, string> = {
  eink29bwr: 'E-Ink 2.9" BWR', eink27bw: 'E-Ink 2.7" BW', oled096: 'OLED 0.96"', tft18: 'TFT 1.8"', tft28: 'TFT 2.8" tactile',
};
const ANA_KIND: Record<string, string> = {
  poem: "Poème d'agent IA", celebration: "Mémorial de burn", spontaneous: "Dessin d'agent IA", "generative-capture": "Œuvre générative (ANA)",
};

function kindOf(r: ShownRecord): string {
  if (r.kind === "personal") return "Dessin personnel (privé)";
  if (r.kind === "ana") return ANA_KIND[r.anaKind ?? ""] ?? "Œuvre ANA";
  return "Dessin humain validé";
}

function ago(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "à l'instant";
  if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
  return `il y a ${Math.floor(sec / 86400)} j`;
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: "0.74rem", lineHeight: 1.6 }}>
      <span style={{ flex: "0 0 92px", color: "var(--text3)" }}>{k}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere", color: "var(--text2)" }}>{children}</span>
    </div>
  );
}

export function OwnDisplaysDebug({ devices }: { devices: OwnedDevice[] }) {
  const [map, setMap] = useState<OwnMap | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/my-devices/displays", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { setMap(d.displays ?? {}); setError(false); })
      .catch(() => setError(true));
  }, []);

  // Chargé à l'ouverture seulement : aucune requête tant que la section est repliée.
  useEffect(() => { if (open && !map) load(); }, [open, map, load]);

  if (devices.length === 0) return null;

  return (
    <details
      style={{ marginTop: "2rem", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg2)", padding: "0.9rem 1.25rem" }}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary style={{ cursor: "pointer", fontSize: "0.9rem", fontWeight: 800 }}>🖥️ Affichage en direct — détails (debug)</summary>
      <p style={{ fontSize: "0.75rem", color: "var(--text3)", margin: "0.6rem 0 1rem", lineHeight: 1.5 }}>
        Ce que chacun de vos écrans a confirmé afficher (ACK du firmware). Seul vous voyez ce détail ; la carte réseau publique
        ne montre que les images.
        <button
          onClick={load}
          style={{ marginLeft: 8, fontSize: "0.72rem", padding: "0.15rem 0.6rem", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", cursor: "pointer" }}
        >
          ↻ Actualiser
        </button>
      </p>
      {error && <p style={{ fontSize: "0.78rem", color: "#f87171" }}>Impossible de charger les affichages.</p>}
      {!map && !error && <p style={{ fontSize: "0.78rem", color: "var(--text3)" }}>Chargement…</p>}
      {map && devices.map((d) => (
        <div key={d.deviceId} style={{ marginTop: "1rem" }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>
            {d.deviceName || d.artistName || d.deviceId}{" "}
            <code style={{ fontSize: "0.68rem", color: "var(--text3)" }}>{d.deviceId}</code>
            <span style={{ marginLeft: 8, fontSize: "0.68rem", color: d.isOnline ? "#4ade80" : "var(--text3)" }}>{d.isOnline ? "en ligne" : "hors ligne"}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: 8 }}>
            {d.screens.map((screen) => {
              const r = map[d.deviceId]?.[screen];
              return (
                <div key={screen} style={{ flex: "1 1 260px", minWidth: 0, border: "1px solid var(--border)", borderRadius: 10, padding: "0.7rem", background: "var(--bg)" }}>
                  <div style={{ fontSize: "0.74rem", fontWeight: 700, marginBottom: 6 }}>{SCREEN_LABEL[screen] ?? screen}</div>
                  {!r ? (
                    <div style={{ fontSize: "0.74rem", color: "var(--text3)" }}>
                      Aucune confirmation d&apos;affichage enregistrée pour cet écran (elle arrive à son prochain ACK).
                    </div>
                  ) : (
                    <>
                      {r.kind !== "personal" && r.hasImage && (
                        <div style={{ marginBottom: 8 }}><ShownThumb frameId={r.frameId} screen={screen} box={{ w: 200, h: 120 }} /></div>
                      )}
                      {r.kind === "personal" && (
                        <div style={{ fontSize: "0.74rem", color: "var(--text3)", marginBottom: 6 }}>
                          🔒 Aucune copie de l&apos;image n&apos;est conservée pour un dessin personnel.
                        </div>
                      )}
                      <Line k="Œuvre">{r.workTitle && r.workTitle !== "Sans titre" ? r.workTitle : "—"}</Line>
                      <Line k="Artiste">{r.artistName ?? "—"}</Line>
                      <Line k="Nature">{kindOf(r)}{r.mode === "scene" ? " · scène animée jouée" : r.mode === "frame" ? " · image fixe" : ""}</Line>
                      <Line k="Confirmé">{new Date(r.shownAt).toLocaleString("fr-FR")} ({ago(r.shownAt)})</Line>
                      <Line k="frameId"><code>{r.frameId}</code></Line>
                      {r.blockIndex != null && <Line k="Bloc chaîne">#{r.blockIndex}</Line>}
                      {r.blockHash && <Line k="Bloc galerie ANA"><code>{r.blockHash.slice(0, 16)}…</code></Line>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </details>
  );
}
