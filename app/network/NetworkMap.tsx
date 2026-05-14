"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { NetworkSnapshot, NetworkDevice } from "@/lib/networkSnapshot";

type Props = {
  snapshot: NetworkSnapshot;
};

type DeviceNodeLayout = {
  device: NetworkDevice;
  x: number;
  y: number;
};

function formatRelativeTime(ts: number): string {
  if (!ts) return "inconnu";
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  return `${Math.floor(sec / 86400)} j`;
}

function frameSummary(device: NetworkDevice): string {
  const frame = device.recentFrame;
  if (!frame) return "Aucune frame récente";
  return `Frame ${frame.frameId.slice(0, 8)} · ${formatRelativeTime(frame.createdAt)}`;
}

function MiniPreview({ device }: { device: NetworkDevice }) {
  const frame = device.recentFrame;
  if (!frame) {
    return <div className="net-preview net-preview--empty">aucun dessin</div>;
  }

  if (frame.preview.mode === "bwr") {
    return (
      <div className="net-preview net-preview--bwr">
        <span className="net-preview__layer net-preview__layer--black" />
        <span className="net-preview__layer net-preview__layer--red" />
      </div>
    );
  }

  if (frame.preview.mode === "mono") {
    return (
      <div className="net-preview net-preview--mono">
        <span className="net-preview__layer net-preview__layer--mono" />
      </div>
    );
  }

  return <div className="net-preview net-preview--empty">buffer brut</div>;
}

export function NetworkMap({ snapshot }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 1200, height: 760 });
  const [selected, setSelected] = useState<NetworkDevice | null>(snapshot.devices[0] ?? null);

  // Responsive
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setBounds({
        width,
        height: Math.max(640, Math.min(900, width * 0.7)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout hybride amélioré
  const layout = useMemo((): DeviceNodeLayout[] => {
    const cx = bounds.width / 2;
    const cy = bounds.height / 2;
    const devices = snapshot.devices;

    switch (devices.length) {
      case 1:
        return [{ device: devices[0], x: cx, y: cy - 220 }];
      case 2:
        return [
          { device: devices[0], x: cx - 260, y: cy },
          { device: devices[1], x: cx + 260, y: cy },
        ];
      case 3:
        return [
          { device: devices[0], x: cx, y: cy - 240 },
          { device: devices[1], x: cx - 260, y: cy + 140 },
          { device: devices[2], x: cx + 260, y: cy + 140 },
        ];
      default:
        const radius = Math.min(bounds.width * 0.34, bounds.height * 0.34);
        return devices.map((device, index) => {
          const angle = (Math.PI * 2 * index) / devices.length - Math.PI / 2;
          return {
            device,
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
          };
        });
    }
  }, [bounds, snapshot.devices]);

  const handleDeviceSelect = useCallback((device: NetworkDevice) => {
    setSelected(device);
  }, []);

  return (
    <div className="network-layout">
      {/* NETWORK STAGE — REWORKED */}
      <section className="network-stage-card">
        <div className="network-stage-header">
          <div>
            <div className="network-eyebrow">Vue réseau</div>
            <h3>Infrastructure distribuée</h3>
          </div>
          <div className="network-stage-stats">
            <div>
              <strong>{snapshot.totals.devices}</strong>
              <span>devices</span>
            </div>
            <div>
              <strong>{snapshot.totals.screens}</strong>
              <span>écrans</span>
            </div>
            <div>
              <strong>{snapshot.totals.online}</strong>
              <span>online</span>
            </div>
          </div>
        </div>

        <div className="network-stage" ref={hostRef}>
          {/* BACKGROUND GRID */}
          <div className="network-stage__grid" />

          {/* SVG CONNECTIONS — AMÉLIORÉES */}
          <svg
            className="network-svg"
            viewBox={`0 0 ${bounds.width} ${bounds.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              {/* GRADIENT PRINCIPAL */}
              <linearGradient id="netBeam" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(124,107,255,0.08)" />
                <stop offset="50%" stopColor="rgba(124,107,255,0.4)" />
                <stop offset="100%" stopColor="rgba(255,107,157,0.2)" />
              </linearGradient>
              {/* GLOW */}
              <filter id="packetGlow">
                <feGaussianBlur stdDeviation="4" result="glow" />
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode />
                </feMerge>
              </filter>
              {/* CORE */}
              <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(124,107,255,0.9)" />
                <stop offset="60%" stopColor="rgba(124,107,255,0.3)" />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
            </defs>

            {/* LIENS VERS CORE */}
            {layout.map((node, index) => {
              const cx = bounds.width / 2;
              const cy = bounds.height / 2;
              const mx = (cx + node.x) / 2;
              const my = (cy + node.y) / 2;
              const path = `M ${cx} ${cy} Q ${mx} ${my} ${node.x} ${node.y}`;

              return (
                <g key={`link-${node.device.deviceId}`}>
                  {/* LIEN PRINCIPAL */}
                  <path
                    d={path}
                    stroke="url(#netBeam)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                    className="network-line"
                  />
                  {/* GLOW SECONDAIRE */}
                  <path
                    d={path}
                    stroke="rgba(124,107,255,0.1)"
                    strokeWidth="8"
                    fill="none"
                    filter="url(#packetGlow)"
                    opacity="0.6"
                  />
                  {/* PACKET ANIMATION */}
                  {node.device.recentFrame && (
                    <circle
                      r="3.5"
                      fill="rgba(255,107,157,0.9)"
                      filter="url(#packetGlow)"
                      style={{ animationDelay: `${index * 0.9}s` }}
                    >
                      <animateMotion dur="6.5s" repeatCount="indefinite" path={path} />
                    </circle>
                  )}
                </g>
              );
            })}

            {/* CORE RINGS */}
            <circle
              cx={bounds.width / 2}
              cy={bounds.height / 2}
              r="100"
              fill="none"
              stroke="rgba(124,107,255,0.15)"
              strokeWidth="2"
              filter="url(#packetGlow)"
            />
            <circle
              cx={bounds.width / 2}
              cy={bounds.height / 2}
              r="170"
              fill="none"
              stroke="rgba(124,107,255,0.08)"
              strokeWidth="1.5"
            />
          </svg>

          {/* CORE CENTRAL — AMÉLIORÉ */}
          <div className="network-core" style={{ left: "50%", top: "50%" }}>
            <div className="network-core__pulse" />
            <div className="network-core__orb">
              <div className="network-core__inner" />
            </div>
            <div className="network-core__content">
              <div className="network-core__eyebrow">DISTRIBUTED REDIS</div>
              <div className="network-core__title">Proof-of-Draw Core</div>
              <div className="network-core__subtitle">snapshot mutualisé</div>
            </div>
          </div>

          {/* DEVICES — AMÉLIORÉS */}
          {layout.map((node) => (
            <button
              key={node.device.deviceId} // ✅ UNIQUES
              type="button"
              className={[
                "network-node",
                selected?.deviceId === node.device.deviceId ? "is-selected" : "",
                node.device.isOnline ? "is-online" : "is-offline",
              ].join(" ")}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onClick={() => handleDeviceSelect(node.device)}
              title={`Voir ${node.device.artistName || node.device.deviceId}`}
            >
              {/* STATUS RING */}
              <div className="network-node__status-ring" />
              
              {/* HEADER */}
              <div className="network-node__header">
                <span className="network-node__dot" />
                <div>
                  <strong className="network-node__title">
                    {node.device.artistName || node.device.deviceId.slice(0, 12)}
                  </strong>
                  <span className="network-node__id">
                    {node.device.deviceId.slice(-8)}
                  </span>
                </div>
              </div>

              {/* SCREENS TAGS */}
              <div className="network-node__screens">
                {node.device.screens.slice(0, 3).map((screen) => (
                  <span key={`${node.device.deviceId}-${screen.screen}`} className="network-screen-tag">
                    {screen.label}
                  </span>
                ))}
                {node.device.screens.length > 3 && (
                  <span className="network-screen-tag network-screen-tag--more">
                    +{node.device.screens.length - 3}
                  </span>
                )}
              </div>

              {/* FOOTER META */}
              <div className="network-node__footer">
                <span>{formatRelativeTime(node.device.lastSeen)}</span>
                <span>{node.device.framesSent} frames</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* SIDE PANEL — AMÉLIORÉ */}
      <aside className="network-panel">
        <div className="network-panel__top">
          <div>
            <div className="network-eyebrow">Device sélectionné</div>
            <h3>{selected?.artistName || selected?.deviceId || "Aucun device"}</h3>
          </div>
          {selected && (
            <span className={`net-badge ${selected.isOnline ? "is-online" : "is-offline"}`}>
              {selected.isOnline ? "online" : "offline"}
            </span>
          )}
        </div>

        {selected ? (
          <>
            <MiniPreview device={selected} />

            <div className="network-info-grid">
              <div className="network-info-card"><span>Device ID</span><strong>{selected.deviceId}</strong></div>
              <div className="network-info-card"><span>Firmware</span><strong>{selected.firmware || "?"}</strong></div>
              <div className="network-info-card"><span>Écrans</span><strong>{selected.screens.length}</strong></div>
              <div className="network-info-card"><span>Frames envoyées</span><strong>{selected.framesSent.toLocaleString()}</strong></div>
              <div className="network-info-card"><span>Dernière vue</span><strong>{formatRelativeTime(selected.lastSeen)}</strong></div>
              <div className="network-info-card"><span>Dernier ping</span><strong>{formatRelativeTime(selected.lastPing)}</strong></div>
            </div>

            <div className="network-section-card">
              <div className="network-eyebrow">Écrans connectés</div>
              <div className="network-screen-list">
                {selected.screens.map((screen) => (
                  <div key={`${selected.deviceId}-${screen.screen}`} className="network-screen-card">
                    <strong>{screen.label}</strong>
                    <small>{screen.description}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="network-section-card">
              <div className="network-eyebrow">Activité frame</div>
              <p>{frameSummary(selected)}</p>
              {selected.recentFrame?.sourceDeviceId && (
                <small>Source: {selected.recentFrame.sourceDeviceId}</small>
              )}
            </div>
          </>
        ) : (
          <div className="network-empty-state">
            <p>Aucun device sélectionné.<br/>Cliquez sur un nœud pour voir les détails.</p>
          </div>
        )}
      </aside>
    </div>
  );
}