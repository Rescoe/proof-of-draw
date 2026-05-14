"use client";

import type { NetworkDevice } from "@/lib/networkSnapshot";

function formatRelativeTime(ts: number): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}j`;
}

function frameSummary(device: NetworkDevice): string {
  const f = device.recentFrame;
  if (!f) return "Aucune frame récente";
  return `Frame ${f.frameId.slice(0, 8)}… · ${formatRelativeTime(f.createdAt)}`;
}

export function SidePanel({ device, onClose }: { device: NetworkDevice | null; onClose: () => void }) {
  if (!device) return (
    <aside className="nv2-panel nv2-panel--empty">
      <p>Sélectionnez un ESP<br />pour voir ses détails</p>
    </aside>
  );

  return (
    
    <aside className="nv2-panel">
      <button className="nv2-panel__close" onClick={onClose} aria-label="Fermer">✕</button>

      <div className="nv2-panel__header">
        <div className="nv2-panel__status-dot" style={{ background: device.isOnline ? "#4ade80" : "#475569" }} />
        <div>
          <h3 className="nv2-panel__name">{device.artistName || device.deviceId.slice(0, 14)}</h3>
          <code className="nv2-panel__id">{device.deviceId}</code>
        </div>
        <span className={`nv2-badge ${device.isOnline ? "nv2-badge--on" : "nv2-badge--off"}`}>
          {device.isOnline ? "ONLINE" : "OFFLINE"}
        </span>
      </div>

      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Écrans connectés</div>
        <div className="nv2-screen-grid">
          {device.screens.length === 0 && <p className="nv2-muted">Aucun écran</p>}
          {device.screens.map((s) => (
            <div key={`${device.deviceId}-${s.screen}`} className="nv2-screen-item">
              <div className="nv2-screen-icon">
                <svg viewBox="0 0 24 18" fill="none" width={28}>
                  <rect x="0.5" y="0.5" width="23" height="17" rx="2.5" stroke="currentColor" strokeOpacity={0.5} />
                  <rect x="3" y="3" width="18" height="12" rx="1" fill="currentColor" fillOpacity={0.1} />
                  <line x1="9" y1="17.5" x2="15" y2="17.5" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} />
                </svg>
              </div>
              <div>
                <strong>{s.label}</strong>
                <small>{s.description}</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Métriques</div>
        <div className="nv2-metrics-grid">
          <div className="nv2-metric"><span>Firmware</span><strong>{device.firmware || "?"}</strong></div>
          <div className="nv2-metric"><span>Frames envoyées</span><strong>{device.framesSent.toLocaleString()}</strong></div>
          <div className="nv2-metric"><span>Dernière vue</span><strong>{formatRelativeTime(device.lastSeen)}</strong></div>
          <div className="nv2-metric"><span>Dernier ping</span><strong>{formatRelativeTime(device.lastPing)}</strong></div>
        </div>
      </div>

      <div className="nv2-panel__section">
        <div className="nv2-panel__section-label">Activité frame</div>
        <p className="nv2-muted nv2-small">{frameSummary(device)}</p>
        {device.recentFrame?.sourceDeviceId && (
          <p className="nv2-muted nv2-small">Source : {device.recentFrame.sourceDeviceId}</p>
        )}
      </div>
    </aside>
  );
}