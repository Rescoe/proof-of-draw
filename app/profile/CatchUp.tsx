"use client";
// app/profile/CatchUp.tsx
// Bouton « ↻ Rattraper » d'une carte d'appareil (04/11/2026). Une œuvre validée n'est livrée que pendant ~42 min : un écran hors ligne à ce moment-là
// ne la reçoit jamais, et ne se met pas à jour tout seul à son retour (voulu : pas de rafale). Ici l'utilisateur voit ce que CET écran a manqué
// (GET /api/my-devices/{id}/missed, 4 lectures métier + éventuellement 1 GET du lien propriétaire, uniquement au clic) et réaffiche l'œuvre de son choix (POST /api/send-to-screen : frame
// personnelle, remplacée au prochain bloc validé). Rien n'est automatique : aucune requête tant que la fenêtre n'est pas ouverte.

import { useEffect, useState } from "react";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";
import type { MissedWork } from "@/lib/missedWorks";

type PerScreen = Record<string, { lastShownIndex: number | null; missed: MissedWork[] }>;

const ghostBtn: React.CSSProperties = { padding: "0.4rem 0.85rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: "0.78rem", cursor: "pointer" };
const muted: React.CSSProperties = { fontSize: "0.74rem", color: "var(--text3)", lineHeight: 1.5, margin: 0 };

function screenLabel(sid: string): string { return (SCREEN_PROFILES as Record<string, { name: string }>)[sid]?.name ?? sid; }
function ago(ms: number | null): string {
  if (!ms) return "";
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.floor(m / 60)} h`;
  return `il y a ${Math.floor(m / 1440)} j`;
}

export function CatchUp({ deviceId }: { deviceId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PerScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/my-devices/${deviceId}/missed`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(res.status === 429 ? "Trop de vérifications, réessayez dans quelques minutes." : (typeof j.error === "string" ? j.error : "Erreur")); setData(null); }
      else setData(j.screens as PerScreen);
    } catch { setError("Erreur réseau"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function show(screen: string, w: MissedWork) {
    const k = `${screen}:${w.blockHash}`;
    setSending(k);
    try {
      const res = await fetch("/api/send-to-screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "human", blockHash: w.blockHash, deviceId, screen }) });
      const j = await res.json().catch(() => ({}));
      setDone((p) => ({ ...p, [k]: res.ok ? "✓ Envoyé : l'écran l'affichera à son prochain contact avec le réseau (quelques minutes)." : (typeof j.error === "string" ? j.error : "Échec de l'envoi") }));
    } catch { setDone((p) => ({ ...p, [k]: "Erreur réseau" })); }
    finally { setSending(null); }
  }

  const total = data ? Object.values(data).reduce((n, s) => n + s.missed.length, 0) : 0;
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); load(); }} style={ghostBtn} title="Voir et réafficher les œuvres que cet écran n'a pas reçues">↻ Rattraper</button>
      {open && (
        <div
          role="dialog" aria-modal="true" aria-labelledby={`cu-${deviceId}`}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
        >
          <div style={{ width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", padding: "1.4rem", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg2)" }}>
            <h2 id={`cu-${deviceId}`} style={{ margin: "0 0 0.4rem", fontSize: "1.05rem" }}>↻ Œuvres manquées</h2>
            <p style={{ ...muted, marginBottom: "0.9rem" }}>
              Une œuvre validée n&apos;est livrée aux écrans que pendant une quarantaine de minutes. Si l&apos;écran était hors ligne, il ne l&apos;a pas reçue — et il ne se met pas à jour seul à son retour.
              Choisissez ici ce qu&apos;il doit afficher : cet écran seulement, jusqu&apos;au prochain bloc validé.
            </p>
            {loading && <p style={muted}>Recherche des œuvres récentes…</p>}
            {error && <p role="alert" style={{ ...muted, color: "#f87171" }}>{error}</p>}
            {data && total === 0 && !loading && <p style={{ ...muted, color: "#4ade80" }}>✓ Cet appareil est à jour : aucune œuvre récente manquée.</p>}
            {data && Object.entries(data).map(([screen, s]) => (s.missed.length === 0 ? null : (
              <div key={screen} style={{ marginBottom: "0.9rem" }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>{screenLabel(screen)}
                  <span style={{ ...muted, marginLeft: 8, fontWeight: 400 }}>{s.lastShownIndex !== null ? `dernier affichage confirmé : bloc #${s.lastShownIndex}` : "aucun affichage confirmé"}</span>
                </div>
                {s.missed.map((w) => {
                  const k = `${screen}:${w.blockHash}`;
                  return (
                    <div key={w.blockHash} style={{ display: "flex", gap: "0.6rem", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderTop: "1px solid var(--border)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.84rem", fontWeight: 600, overflowWrap: "anywhere" }}>{w.kind === "animation" ? "🎞 " : ""}{w.title ?? "Sans titre"} <span style={{ ...muted, fontWeight: 400 }}>#{w.blockIndex}</span></div>
                        <div style={muted}>{w.artist ?? "artiste inconnu"} · {ago(w.minedAt)}</div>
                        {done[k] && <div role="status" style={{ ...muted, color: done[k].startsWith("✓") ? "#4ade80" : "#f87171", marginTop: 2 }}>{done[k]}</div>}
                      </div>
                      <button type="button" disabled={sending === k || (done[k]?.startsWith("✓") ?? false)} onClick={() => show(screen, w)} style={{ ...ghostBtn, whiteSpace: "nowrap", opacity: sending === k ? 0.5 : 1 }}>
                        {sending === k ? "…" : "Afficher"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )))}
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", marginTop: "0.6rem" }}>
              <button type="button" onClick={load} disabled={loading} style={ghostBtn}>Actualiser</button>
              <button type="button" onClick={() => setOpen(false)} style={ghostBtn}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
