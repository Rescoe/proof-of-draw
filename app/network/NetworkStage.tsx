"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { NetworkSnapshot, NetworkDevice } from "@/lib/networkSnapshot";

type Props = {
  snapshot: NetworkSnapshot;
  onDeviceSelect: (device: NetworkDevice) => void;
  selectedDeviceId?: string;
};

// Couleur par type d'écran — même palette que SidePanel
const SCREEN_COLOR: Record<string, string> = {
  eink29bwr: "#f87171",
  eink27bw:  "#94a3b8",
  oled096:   "#60a5fa",
  tft18:     "#fbbf24",
};
function screenColor(s: string) { return SCREEN_COLOR[s] ?? "#a2a3bb"; }

const PARTICLE_COUNT = 3; // particules par lien

type ViewBox = { x: number; y: number; w: number; h: number };
const ZOOM_MIN  = 0.4;
const ZOOM_MAX  = 4.0;
const ZOOM_STEP = 0.25;

export function NetworkStage({ snapshot, onDeviceSelect, selectedDeviceId }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef   = useRef<SVGSVGElement | null>(null);
  const [dims, setDims] = useState({ width: 900, height: 600 });
  const [vb, setVb]     = useState<ViewBox>({ x: 0, y: 0, w: 900, h: 600 });
  const dragging   = useRef(false);
  const lastPos    = useRef({ x: 0, y: 0 });

  // Responsive + init viewBox
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      const h = Math.max(420, Math.min(680, w * 0.62));
      setDims({ width: w, height: h });
      setVb((prev) => ({ ...prev, w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const devices = snapshot.devices;
  const cx = dims.width / 2;
  const cy = dims.height / 2;

  const espLayout = useMemo((): { device: NetworkDevice; x: number; y: number }[] => {
    if (devices.length === 0) return [];
    const radius = Math.min(dims.width * 0.32, dims.height * 0.32);
    return devices.map((device, i) => {
      const angle = (Math.PI * 2 * i) / devices.length - Math.PI / 2;
      return { device, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
  }, [dims.width, dims.height, devices, cx, cy]);

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
          device: node.device,
          x: node.x + Math.cos(angle) * dist,
          y: node.y + Math.sin(angle) * dist,
          espX: node.x,
          espY: node.y,
          color: screenColor(screen.screen),
        };
      })
    );
  }, [espLayout, cx, cy]);

  // ── Zoom/pan ────────────────────────────────────────────────────────────────

  const zoom = dims.width / vb.w;

  const zoomAt = useCallback((factor: number, pivotSvgX: number, pivotSvgY: number) => {
    setVb((prev) => {
      const newW = prev.w / factor;
      const newH = prev.h / factor;
      const newZ = dims.width / newW;
      if (newZ < ZOOM_MIN || newZ > ZOOM_MAX) return prev;
      const rx = (pivotSvgX - prev.x) / prev.w;
      const ry = (pivotSvgY - prev.y) / prev.h;
      return { x: pivotSvgX - rx * newW, y: pivotSvgY - ry * newH, w: newW, h: newH };
    });
  }, [dims.width]);

  const resetZoom = useCallback(() => {
    setVb({ x: 0, y: 0, w: dims.width, h: dims.height });
  }, [dims]);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = vb.x + ((e.clientX - rect.left) / rect.width)  * vb.w;
    const my = vb.y + ((e.clientY - rect.top)  / rect.height) * vb.h;
    const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP);
    zoomAt(factor, mx, my);
  }, [vb, zoomAt]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - lastPos.current.x) / rect.width)  * vb.w;
    const dy = ((e.clientY - lastPos.current.y) / rect.height) * vb.h;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setVb((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
  }, [vb]);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  const handleSelect = useCallback((device: NetworkDevice) => {
    onDeviceSelect(device);
  }, [onDeviceSelect]);

  const viewBoxStr = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  const zoomPct    = Math.round(zoom * 100);

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
      <div className="nv2-stage" ref={stageRef} style={{ position: "relative" }}>
        <svg
          ref={svgRef}
          className="nv2-svg"
          viewBox={viewBoxStr}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          style={{ cursor: "grab", userSelect: "none" }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            <pattern id="nv2-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
            </pattern>
            {/* CSS animations — supprime le setInterval tick */}
            <style>{`
              @keyframes nv2-dash-fwd  { to { stroke-dashoffset: -48; } }
              @keyframes nv2-dash-back { to { stroke-dashoffset:  48; } }
              @keyframes nv2-pulse-ring { 0%,100%{opacity:.15} 50%{opacity:.4} }
              @keyframes nv2-sel-dash   { to { stroke-dashoffset: -24; } }
              .nv2-link-flow      { animation: nv2-dash-fwd  2s linear infinite; }
              .nv2-link-flow-back { animation: nv2-dash-back 2.5s linear infinite; }
              .nv2-screen-link    { animation: nv2-dash-fwd  3s linear infinite; }
              .nv2-core-pulse     { animation: nv2-pulse-ring 3s ease-in-out infinite; }
              .nv2-sel-ring       { animation: nv2-sel-dash  1.2s linear infinite; }
            `}</style>
          </defs>

          <rect width={dims.width} height={dims.height} fill="url(#nv2-grid)" />

          {/* Core */}
          <g transform={`translate(${cx},${cy})`}>
            <circle r="54" fill="none" stroke="rgba(59,130,246,0.15)" strokeWidth="1.5" className="nv2-core-pulse" />
            <circle r="42" fill="none" stroke="rgba(59,130,246,0.25)" strokeWidth="1" />
            <circle r="32" fill="rgba(59,130,246,0.12)" />
            <circle r="26" fill="rgba(10,10,15,0.95)" stroke="var(--accent)" strokeWidth="2.5" />
            <text x="0" y="-6" textAnchor="middle" fontSize="9" fill="var(--accent)"
                  fontFamily="monospace" fontWeight="bold" letterSpacing="0.5">REDIS</text>
            <text x="0" y="8" textAnchor="middle" fontSize="8" fill="var(--text2)"
                  fontFamily="monospace">Core</text>
          </g>

          {/* Orbite ESP */}
          <circle
            cx={cx} cy={cy}
            r={Math.min(dims.width * 0.32, dims.height * 0.32)}
            fill="none"
            stroke="rgba(59,130,246,0.1)"
            strokeWidth="1.5"
            strokeDasharray="5, 10"
          />

          {/* Liens ESP ↔ Core */}
          {espLayout.map((node, i) => {
            const isSelected = selectedDeviceId === node.device.deviceId;
            const active = node.device.isOnline;
            return (
              <g key={`esp-link-${node.device.deviceId}`}>
                {/* Base */}
                <line
                  x1={cx} y1={cy} x2={node.x} y2={node.y}
                  stroke={active ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.05)"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeLinecap="round"
                />
                {/* Flux animé avant (core→esp, frames) */}
                {active && (
                  <line
                    x1={cx} y1={cy} x2={node.x} y2={node.y}
                    stroke={isSelected ? "var(--accent)" : "rgba(59,130,246,0.45)"}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray="8, 16"
                    strokeLinecap="round"
                    className="nv2-link-flow"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                )}
                {/* Flux animé retour (esp→core, pings) */}
                {active && (
                  <line
                    x1={node.x} y1={node.y} x2={cx} y2={cy}
                    stroke="rgba(167,139,250,0.22)"
                    strokeWidth="1.5"
                    strokeDasharray="4, 20"
                    strokeLinecap="round"
                    className="nv2-link-flow-back"
                    style={{ animationDelay: `${i * 0.25}s` }}
                  />
                )}
                {/* Particules multiples staggerées (frames récentes) */}
                {active && node.device.recentFrame && Array.from({ length: PARTICLE_COUNT }).map((_, pi) => (
                  <circle key={pi} r={pi === 0 ? 3.5 : 2.5} fill="var(--accent)" opacity={pi === 0 ? 0.9 : 0.5}>
                    <animateMotion
                      dur={`${3.5 + i * 0.6 + pi * 0.9}s`}
                      begin={`${pi * (3.5 / PARTICLE_COUNT)}s`}
                      repeatCount="indefinite"
                      path={`M ${cx} ${cy} L ${node.x} ${node.y}`}
                    />
                  </circle>
                ))}
                {/* Particules retour (pings) */}
                {active && Array.from({ length: 2 }).map((_, pi) => (
                  <circle key={`ping-${pi}`} r="2" fill="#a78bfa" opacity="0.35">
                    <animateMotion
                      dur={`${5 + i * 0.7 + pi * 1.2}s`}
                      begin={`${pi * 2.5}s`}
                      repeatCount="indefinite"
                      path={`M ${node.x} ${node.y} L ${cx} ${cy}`}
                    />
                  </circle>
                ))}
              </g>
            );
          })}

          {/* Liens ESP ↔ Écrans (colorés par type) */}
          {screenNodes.map((sn, i) => {
            const active = sn.device.isOnline;
            return (
              <line
                key={`screen-link-${sn.deviceId}-${sn.screen.screen}`}
                x1={sn.espX} y1={sn.espY} x2={sn.x} y2={sn.y}
                stroke={active ? `${sn.color}55` : "rgba(148,163,184,0.1)"}
                strokeWidth="1.2"
                strokeDasharray="4, 8"
                strokeLinecap="round"
                className={active ? "nv2-screen-link" : undefined}
                style={active ? { animationDelay: `${i * 0.1}s` } : undefined}
              />
            );
          })}

          {/* Écrans satellites — colorés par type, cliquables */}
          {screenNodes.map((sn) => {
            const active = sn.device.isOnline;
            const isParentSelected = selectedDeviceId === sn.deviceId;
            const color = sn.color;
            return (
              <g
                key={`screen-node-${sn.deviceId}-${sn.screen.screen}`}
                transform={`translate(${sn.x},${sn.y})`}
                opacity={active ? 1 : 0.3}
                style={{ cursor: "pointer" }}
                onClick={() => handleSelect(sn.device)}
                role="button"
                tabIndex={0}
                aria-label={`Écran ${sn.screen.label} — ${sn.device.artistName || sn.deviceId}`}
                onKeyDown={(e) => e.key === "Enter" && handleSelect(sn.device)}
              >
                {isParentSelected && (
                  <circle r="26" fill="none" stroke={color} strokeWidth="1.5"
                          strokeOpacity="0.6" strokeDasharray="4,4"
                          className="nv2-sel-ring" />
                )}
                <circle r="20" fill={active ? `${color}12` : "rgba(255,255,255,0.04)"} />
                <rect
                  x="-14" y="-11" width="28" height="18" rx="3.5"
                  fill="rgba(10,10,15,0.98)"
                  stroke={isParentSelected ? color : active ? `${color}80` : "rgba(148,163,184,0.15)"}
                  strokeWidth={isParentSelected ? 2 : 1.8}
                />
                <rect
                  x="-11" y="-8" width="22" height="12" rx="1.5"
                  fill={active ? `${color}1a` : "rgba(255,255,255,0.03)"}
                />
                <rect x="-3" y="7" width="6" height="6" rx="1" fill="rgba(10,10,15,0.9)" />
                <line x1="0" y1="13" x2="0" y2="16" stroke="rgba(148,163,184,0.4)" strokeWidth="1.5" strokeLinecap="round" />
                <text
                  x="0" y="24"
                  textAnchor="middle"
                  fontSize="8.5"
                  fill={isParentSelected ? color : active ? color : "var(--text3)"}
                  fontFamily="monospace"
                  fontWeight="500"
                >
                  {sn.screen.label.length > 8 ? sn.screen.label.slice(0, 8) + "…" : sn.screen.label}
                </text>
              </g>
            );
          })}

          {/* ESP nodes */}
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
                {isSelected && (
                  <circle r="38" fill="none" stroke="var(--accent)"
                          strokeWidth="2" strokeOpacity="0.6"
                          strokeDasharray="6, 6"
                          className="nv2-sel-ring" />
                )}
                {online && <circle r="36" fill="rgba(59,130,246,0.07)" />}
                <circle
                  r="30"
                  fill={isSelected ? "rgba(59,130,246,0.15)" : "rgba(10,10,15,0.95)"}
                  stroke={online ? "var(--accent)" : "rgba(148,163,184,0.3)"}
                  strokeWidth={isSelected ? 3 : 2}
                />
                <text x="0" y="-8" textAnchor="middle" fontSize="8"
                      fill={online ? "var(--accent)" : "var(--text3)"}
                      fontFamily="monospace" fontWeight="700">ESP</text>
                <text x="0" y="3" textAnchor="middle" fontSize="10"
                      fill="var(--text)" fontFamily="monospace" fontWeight="700">
                  {(node.device.artistName || node.device.deviceId).slice(0, 10)}
                </text>
                <text x="0" y="16" textAnchor="middle" fontSize="8"
                      fill="var(--text2)" fontFamily="monospace">
                  {node.device.screens.length} écran{node.device.screens.length > 1 ? "s" : ""}
                </text>
                <circle cx="22" cy="-22" r="6"
                        fill={online ? "var(--success)" : "var(--text3)"}
                        stroke="rgba(10,10,15,0.9)" strokeWidth="1.5" />
              </g>
            );
          })}
        </svg>

        {/* Contrôles zoom */}
        <div className="nv2-zoom-controls">
          <button className="nv2-zoom-btn" aria-label="Zoom avant" title="Zoom avant"
            onClick={() => zoomAt(1 + ZOOM_STEP, vb.x + vb.w / 2, vb.y + vb.h / 2)}>+</button>
          <span className="nv2-zoom-pct">{zoomPct}%</span>
          <button className="nv2-zoom-btn" aria-label="Zoom arrière" title="Zoom arrière"
            onClick={() => zoomAt(1 / (1 + ZOOM_STEP), vb.x + vb.w / 2, vb.y + vb.h / 2)}>−</button>
          <button className="nv2-zoom-btn nv2-zoom-btn--reset" aria-label="Réinitialiser" title="Réinitialiser"
            onClick={resetZoom}>↺</button>
        </div>
      </div>
    </div>
  );
}
