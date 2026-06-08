"use client";

// ─── Panel "Serveur RESCOE" ───────────────────────────────────────────────────
// Affiché dans le side panel quand on clique sur le nœud central de la carte
// réseau. Synthèse de l'état global du réseau déjà disponible côté client
// (NetworkSnapshot.totals) — aucune requête supplémentaire.

import type { NetworkSnapshot } from "@/lib/networkSnapshot";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ServerInfoPanel({
  snapshot,
  onClose,
}: {
  snapshot: NetworkSnapshot;
  onClose: () => void;
}) {
  const { totals } = snapshot;

  return (
    <aside className="nv2-panel">
      <button className="nv2-panel__close" onClick={onClose} aria-label="Fermer">✕</button>

      <div className="nv2-panel__header">
        <div className="nv2-panel__status-dot" style={{ background: "var(--accent)" }} />
        <div>
          <h3 className="nv2-panel__name">RESCOE — Serveur</h3>
          <code className="nv2-panel__id">cœur du réseau · Redis + API</code>
        </div>
        <span className="nv2-badge nv2-badge--on">EN LIGNE</span>
      </div>

      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Réseau global</div>
        <div className="nv2-metrics-grid">
          <div className="nv2-metric">
            <span>Devices</span>
            <strong style={{ color: "var(--accent)" }}>{totals.devices}</strong>
          </div>
          <div className="nv2-metric">
            <span>En ligne</span>
            <strong style={{ color: "#4ade80" }}>{totals.online}</strong>
          </div>
          <div className="nv2-metric">
            <span>Hors ligne</span>
            <strong>{totals.offline}</strong>
          </div>
          <div className="nv2-metric">
            <span>Écrans connectés</span>
            <strong>{totals.screens}</strong>
          </div>
          <div className="nv2-metric">
            <span>Types d&apos;écran</span>
            <strong>{totals.screenTypes}</strong>
          </div>
          <div className="nv2-metric">
            <span>Frames en attente</span>
            <strong style={{ color: "#a78bfa" }}>{totals.framesWaiting}</strong>
          </div>
        </div>
      </div>

      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Rôle</div>
        <p className="nv2-muted nv2-small" style={{ lineHeight: 1.7 }}>
          Le serveur centralise le pipeline proof-of-draw : réception des
          dessins, mise en file, consensus/quorum entre devices, minage des
          blocs et diffusion des frames validées vers les écrans (Redis,
          aucun état en mémoire — cf. architecture serverless-safe).
        </p>
      </div>

      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Snapshot</div>
        <div className="nv2-block-meta">
          <div className="nv2-block-meta__row">
            <span className="nv2-block-meta__label">Généré le</span>
            <span className="nv2-block-meta__value">{formatDate(snapshot.generatedAtIso)}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
