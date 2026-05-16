"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { NetworkSnapshot, NetworkDevice } from "@/lib/networkSnapshot";

type Props = {
  snapshot: NetworkSnapshot;
  onDeviceSelect: (device: NetworkDevice) => void;
  selectedDeviceId?: string;
};

export function NetworkStage({ snapshot, onDeviceSelect, selectedDeviceId }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 900, height: 600 });
  const [tick, setTick] = useState(0);

  // Responsive
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      setBounds({ width: w, height: Math.max(420, Math.min(680, w * 0.62)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Animation flux
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, []);

  const devices = snapshot.devices;
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;

  // Layout ESP (cercle autour du core)
  const espLayout = useMemo((): { device: NetworkDevice; x: number; y: number }[] => {
    if (devices.length === 0) return [];
    const radius = Math.min(bounds.width * 0.32, bounds.height * 0.32);
    return devices.map((device, i) => {
      const angle = (Math.PI * 2 * i) / devices.length - Math.PI / 2;
      return {
        device,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      };
    });
  }, [bounds.width, bounds.height, devices]);

  // Layout écrans satellites
  const screenNodes = useMemo(() => {
    return espLayout.flatMap((node) =>
      node.device.screens.slice(0, 4).map((screen, si) => {
        const total = Math.min(node.device.screens.length, 4);
        const spreadAngle = total > 1 ? (Math.PI * 0.7) / (total - 1) : 0;
        const baseAngle = Math.atan2(node.y - cy, node.x - cx);
        const angle = baseAngle + (si - (total - 1) / 2) * spreadAngle;
        const dist = 80;
        return {
          screen,
          deviceId: node.device.deviceId,
          device: node.device,   // référence complète pour handleSelect
          x: node.x + Math.cos(angle) * dist,
          y: node.y + Math.sin(angle) * dist,
          espX: node.x,
          espY: node.y,
        };
      })
    );
  }, [espLayout]);

  const handleSelect = useCallback((device: NetworkDevice) => {
    onDeviceSelect(device);
  }, [onDeviceSelect]);

  const dashOffset = -(tick * 2);

  return (
    <div className="nv2-stage-wrap">
      {/* Header */}
      <div className="nv2-stage-header">
        <div className="nv2-stage-title">
          <span className="nv2-eyebrow">Proof-of-Draw</span>
          <h2>Network Topology</h2>
        </div>
        <div className="nv2-stage-chips">
          <div className="nv2-chip">
            <span className="nv2-chip__dot nv2-chip__dot--on" />
            <strong>{snapshot.totals.online}</strong>
            <span>online</span>
          </div>
          <div className="nv2-chip">
            <strong>{snapshot.totals.devices}</strong>
            <span>ESP</span>
          </div>
          <div className="nv2-chip">
            <strong>{snapshot.totals.screens}</strong>
            <span>écrans</span>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="nv2-stage" ref={stageRef}>
        <svg
          className="nv2-svg"
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {/* Grille de fond */}
          <defs>
            <pattern id="nv2-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={bounds.width} height={bounds.height} fill="url(#nv2-grid)" />

          {/* Core central (Redis) */}
          <g transform={`translate(${cx},${cy})`}>
            <circle r="54" fill="none" stroke="rgba(59,130,246,0.15)" strokeWidth="1.5" className="nv2-core-ring nv2-core-ring--1" />
            <circle r="42" fill="none" stroke="rgba(59,130,246,0.25)" strokeWidth="1" className="nv2-core-ring nv2-core-ring--2" />
            <circle r="32" fill="rgba(59,130,246,0.12)" />
            <circle r="26" fill="rgba(10,10,15,0.95)" stroke="var(--accent)" strokeWidth="2.5" />
            <text x="0" y="-6" textAnchor="middle" fontSize="9" fill="var(--accent)"
                  fontFamily="monospace" fontWeight="bold" letterSpacing="0.5">REDIS</text>
            <text x="0" y="8" textAnchor="middle" fontSize="8" fill="var(--text2)"
                  fontFamily="monospace">Core</text>
          </g>

          {/* Orbite ESP */}
          <circle 
            cx={cx} 
            cy={cy} 
            r={Math.min(bounds.width * 0.32, bounds.height * 0.32)}
            fill="none" 
            stroke="rgba(59,130,246,0.12)" 
            strokeWidth="1.5" 
            strokeDasharray="5, 10"
          />

          {/* Liens ESP ↔ Core */}
          {espLayout.map((node, i) => {
            const isSelected = selectedDeviceId === node.device.deviceId;
            const active = node.device.isOnline;
            return (
              <g key={`esp-link-${node.device.deviceId}`}>
                {/* Lien de base */}
                <line
                  x1={cx} y1={cy} x2={node.x} y2={node.y}
                  stroke={active ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeLinecap="round"
                />
                {/* Flux animé (online seulement) */}
                {active && (
                  <line
                    x1={cx} y1={cy} x2={node.x} y2={node.y}
                    stroke={isSelected ? "var(--accent)" : "rgba(59,130,246,0.5)"}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray="8, 16"
                    strokeDashoffset={dashOffset + i * 10}
                    strokeLinecap="round"
                  />
                )}
                {/* Particule animée (frame récente) */}
                {active && node.device.recentFrame && (
                  <circle r="3.5" fill="var(--accent)" opacity="0.9">
                    <animateMotion 
                      dur={`${3.5 + i * 0.8}s`} 
                      repeatCount="indefinite"
                      path={`M ${cx} ${cy} L ${node.x} ${node.y}`} 
                    />
                  </circle>
                )}
              </g>
            );
          })}

          {/* Liens ESP ↔ Écrans */}
          {screenNodes.map((sn, i) => {
            const active = snapshot.devices.find((d) => d.deviceId === sn.deviceId)?.isOnline;
            return (
              <line
                key={`screen-link-${sn.deviceId}-${sn.screen.screen}`}
                x1={sn.espX} y1={sn.espY} x2={sn.x} y2={sn.y}
                stroke={active ? "rgba(16,185,129,0.3)" : "rgba(148,163,184,0.15)"}
                strokeWidth="1.2"
                strokeDasharray="4, 8"
                strokeDashoffset={-(tick * 1.5) + i * 6}
                strokeLinecap="round"
              />
            );
          })}

          {/* Écrans satellites — cliquables, ouvrent le SidePanel du parent ESP */}
          {screenNodes.map((sn) => {
            const active    = sn.device.isOnline;
            const isParentSelected = selectedDeviceId === sn.deviceId;
            return (
              <g
                key={`screen-node-${sn.deviceId}-${sn.screen.screen}`}
                transform={`translate(${sn.x},${sn.y})`}
                opacity={active ? 1 : 0.35}
                style={{ cursor: "pointer" }}
                onClick={() => handleSelect(sn.device)}
                role="button"
                tabIndex={0}
                aria-label={`Écran ${sn.screen.label} — ${sn.device.artistName || sn.deviceId}`}
                onKeyDown={(e) => e.key === "Enter" && handleSelect(sn.device)}
              >
                {/* Anneau de sélection (parent ESP sélectionné) */}
                {isParentSelected && (
                  <circle r="26" fill="none" stroke="var(--accent)" strokeWidth="1.5"
                          strokeOpacity="0.5" strokeDasharray="4,4"
                          strokeDashoffset={tick * 2} />
                )}
                {/* Halo */}
                <circle r="20" fill={isParentSelected ? "rgba(124,107,255,0.1)" : "rgba(16,185,129,0.08)"} />
                {/* Boîtier écran */}
                <rect
                  x="-14" y="-11"
                  width="28" height="18"
                  rx="3.5"
                  fill="rgba(10,10,15,0.98)"
                  stroke={isParentSelected ? "var(--accent)" : active ? "rgba(16,185,129,0.5)" : "rgba(148,163,184,0.2)"}
                  strokeWidth={isParentSelected ? 2 : 1.8}
                />
                {/* Écran actif */}
                <rect
                  x="-11" y="-8"
                  width="22" height="12"
                  rx="1.5"
                  fill={active ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)"}
                />
                {/* Stand */}
                <rect x="-3" y="7" width="6" height="6" rx="1" fill="rgba(10,10,15,0.9)" />
                <line x1="0" y1="13" x2="0" y2="16" stroke="rgba(148,163,184,0.4)" strokeWidth="1.5" strokeLinecap="round" />
                {/* Label écran */}
                <text
                  x="0" y="24"
                  textAnchor="middle"
                  fontSize="8.5"
                  fill={isParentSelected ? "var(--accent)" : active ? "var(--text2)" : "var(--text3)"}
                  fontFamily="monospace"
                  fontWeight="500"
                >
                  {sn.screen.label.length > 8 ? sn.screen.label.slice(0, 8) + "…" : sn.screen.label}
                </text>
              </g>
            );
          })}

          {/* ESP nodes (hexagones → cercles pro) */}
          {espLayout.map((node) => {
            const isSelected = selectedDeviceId === node.device.deviceId;
            const online = node.device.isOnline;
            
            return (
              <g
                key={`esp-${node.device.deviceId}`}
                transform={`translate(${node.x},${node.y})`}
                style={{ cursor: "pointer" }}
                onClick={() => handleSelect(node.device)}
                role="button"
                tabIndex={0}
                aria-label={`ESP ${node.device.artistName || node.device.deviceId}`}
                onKeyDown={(e) => e.key === "Enter" && handleSelect(node.device)}
              >
                {/* Anneau sélection */}
                {isSelected && (
                  <circle
                    r="38"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeOpacity="0.6"
                    strokeDasharray="6, 6"
                    strokeDashoffset={tick * 3}
                  />
                )}
                {/* Halo online */}
                {online && <circle r="36" fill="rgba(59,130,246,0.08)" />}
                {/* ESP principal */}
                <circle
                  r="30"
                  fill={isSelected ? "rgba(59,130,246,0.15)" : "rgba(10,10,15,0.95)"}
                  stroke={online ? "var(--accent)" : "rgba(148,163,184,0.3)"}
                  strokeWidth={isSelected ? 3 : 2}
                />
                {/* Label ESP */}
                <text 
                  x="0" y="-8" 
                  textAnchor="middle" 
                  fontSize="8" 
                  fill={online ? "var(--accent)" : "var(--text3)"}
                  fontFamily="monospace" 
                  fontWeight="700"
                >
                  ESP
                </text>
                {/* Nom/ID */}
                <text 
                  x="0" y="3" 
                  textAnchor="middle" 
                  fontSize="10" 
                  fill="var(--text)"
                  fontFamily="monospace" 
                  fontWeight="700"
                >
                  {(node.device.artistName || node.device.deviceId).slice(0, 10)}
                </text>
                {/* Nb écrans */}
                <text 
                  x="0" y="16" 
                  textAnchor="middle" 
                  fontSize="8" 
                  fill="var(--text2)"
                  fontFamily="monospace"
                >
                  {node.device.screens.length} écran{node.device.screens.length > 1 ? "s" : ""}
                </text>
                {/* Status dot */}
                <circle 
                  cx="22" cy="-22" 
                  r="6"
                  fill={online ? "var(--success)" : "var(--text3)"}
                  stroke="rgba(10,10,15,0.9)" 
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}