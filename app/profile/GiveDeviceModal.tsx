"use client";
// app/profile/GiveDeviceModal.tsx — donner / remettre à zéro un ESP
// Aperçu des œuvres liées à l'ESP ; chaque œuvre cochée est LÉGUÉE (suit l'ESP), les autres restent à mon profil.
// Par défaut tout est conservé (recommandé). Après le don, le nouveau code d'appairage est affiché.

import { useEffect, useState } from "react";
import { BlockFrameCanvas } from "@/app/BlockFrameCanvas";
import type { BlockImagePayload } from "@/lib/chain";

interface GiveBlock {
  blockHash: string; blockIndex: number; workTitle?: string; drawArtistName?: string; artistName: string;
  poolScreen: string; minedAt: number; imagePayload: BlockImagePayload | null;
  isArtist: boolean; isMiner: boolean; isOwner: boolean;
}

export function GiveDeviceModal({ deviceId, label, onClose, onDone }: {
  deviceId: string; label: string; onClose: () => void; onDone: () => void;
}) {
  const [blocks, setBlocks]   = useState<GiveBlock[] | null>(null);
  const [total, setTotal]     = useState(0);
  const [error, setError]     = useState<string | null>(null);
  const [bequeath, setBequeath] = useState<Set<string>>(new Set());   // cochées = léguées
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState<{ pairCode: string; kept: number; bequeathed: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/artist/give-device?deviceId=${deviceId}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!alive) return;
        if (!ok) { setError(d.error ?? "Erreur"); setBlocks([]); return; }
        setBlocks(d.blocks ?? []); setTotal(d.total ?? 0);
      })
      .catch(() => { if (alive) { setError("Erreur réseau"); setBlocks([]); } });
    return () => { alive = false; };
  }, [deviceId]);

  const toggle = (h: string) => setBequeath((s) => { const n = new Set(s); if (n.has(h)) n.delete(h); else n.add(h); return n; });
  const all = blocks ?? [];

  async function give() {
    if (!confirm(`Donner « ${label} » ? Il quittera ton profil et recevra un nouveau code d'appairage. `
      + `${bequeath.size} œuvre(s) seront léguées, ${Math.max(0, total - bequeath.size)} conservées.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/artist/give-device", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, bequeath: [...bequeath] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "Erreur"); return; }
      setResult({ pairCode: d.pairCode, kept: d.kept, bequeathed: d.bequeathed });
    } catch { setError("Erreur réseau"); }
    finally { setBusy(false); }
  }

  const btn = (primary = false): React.CSSProperties => ({
    padding: "0.5rem 1rem", borderRadius: 8, fontWeight: 700, fontSize: "0.82rem", cursor: "pointer",
    border: primary ? "none" : "1px solid var(--border)", background: primary ? "var(--accent)" : "var(--bg)",
    color: primary ? "#fff" : "var(--text2)",
  });

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy && !result) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
    >
      <div role="dialog" aria-label="Donner cet ESP" style={{
        width: "100%", maxWidth: 560, maxHeight: "90vh", display: "flex", flexDirection: "column",
        background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden",
      }}>
        {result ? (
          <div style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            <h3 style={{ margin: 0 }}>🎁 « {label} » est libéré</h3>
            <p style={{ margin: 0, color: "var(--text2)", fontSize: "0.85rem" }}>
              {result.bequeathed} œuvre(s) léguée(s), {result.kept} conservée(s) dans ton profil. Pour reprendre l&apos;ESP,
              le nouveau propriétaire va sur <strong>/onboard</strong> et saisit ce nouveau code (son profil sera créé
              automatiquement) :
            </p>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "1.6rem", fontWeight: 800, letterSpacing: "0.15em", textAlign: "center", padding: "0.8rem", background: "var(--bg3)", borderRadius: 10 }}>
              {result.pairCode}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button style={btn(true)} onClick={onDone}>Terminé</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: "1.1rem 1.25rem 0.6rem" }}>
              <h3 style={{ margin: 0 }}>🎁 Donner « {label} »</h3>
              <p style={{ margin: "0.4rem 0 0", color: "var(--text2)", fontSize: "0.8rem", lineHeight: 1.5 }}>
                L&apos;ESP quitte ton profil et reçoit un nouveau code d&apos;appairage. Coche les œuvres que tu veux
                <strong> léguer</strong> au nouveau propriétaire ; les autres restent dans ton historique.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.7rem", flexWrap: "wrap", alignItems: "center" }}>
                <button style={btn()} onClick={() => setBequeath(new Set())}>Tout garder (recommandé)</button>
                <button style={btn()} onClick={() => setBequeath(new Set(all.map((b) => b.blockHash)))}>Tout léguer</button>
                <span style={{ fontSize: "0.75rem", color: "var(--text3)" }}>{bequeath.size} léguée(s) / {total} liée(s)</span>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0.4rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem", minHeight: 120 }}>
              {blocks === null && <div style={{ color: "var(--text3)", padding: "1rem 0" }}>Chargement…</div>}
              {blocks && all.length === 0 && !error && <div style={{ color: "var(--text3)", padding: "1rem 0", fontSize: "0.85rem" }}>Aucune œuvre liée à cet ESP.</div>}
              {all.map((b) => {
                const on = bequeath.has(b.blockHash);
                return (
                  <label key={b.blockHash} style={{
                    display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.6rem", borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--bg3)" : "transparent",
                  }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(b.blockHash)} />
                    <div style={{ width: 96, flexShrink: 0, overflow: "hidden", borderRadius: 6, background: "var(--bg3)" }}>
                      {b.imagePayload ? <BlockFrameCanvas payload={b.imagePayload} /> : <div style={{ height: 48 }} />}
                    </div>
                    <div style={{ minWidth: 0, fontSize: "0.78rem" }}>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {b.workTitle || `Bloc #${b.blockIndex}`}
                      </div>
                      <div style={{ color: "var(--text3)" }}>
                        {b.drawArtistName ?? b.artistName} · {[b.isArtist && "dessiné", b.isMiner && "miné", b.isOwner && "possédé"].filter(Boolean).join(" · ")}
                      </div>
                      <div style={{ color: on ? "var(--accent)" : "var(--text3)", fontWeight: 600 }}>{on ? "Légué" : "Conservé"}</div>
                    </div>
                  </label>
                );
              })}
              {total > all.length && (
                <div style={{ fontSize: "0.72rem", color: "var(--text3)", padding: "0.3rem 0" }}>
                  {total - all.length} autre(s) œuvre(s) liée(s) ne sont pas affichées : elles sont conservées.
                </div>
              )}
            </div>

            {error && <div style={{ padding: "0.5rem 1.25rem", color: "#f87171", fontSize: "0.8rem" }}>{error}</div>}
            <div style={{ padding: "0.8rem 1.25rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)" }}>
              <button style={btn()} onClick={onClose} disabled={busy}>Annuler</button>
              <button style={btn(true)} onClick={give} disabled={busy || blocks === null}>{busy ? "…" : "🎁 Donner cet ESP"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
