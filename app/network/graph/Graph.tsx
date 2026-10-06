"use client";

import { useEffect, useMemo, useState } from "react";
import type { NetworkDevice, NetworkSnapshot } from "@/lib/networkSnapshot";
import type { DisplaysMap } from "../LiveDisplays";
import {
  CORE_NODE_ID,
  buildNetworkHierarchy,
  buildObservedFlows,
  deviceNodeId,
  flattenClusters,
  layoutNetwork,
  screenNodeId,
  type ArtistGroup,
  type ClusterGroup,
  type LayoutNode,
  type NetworkEventLike,
} from "../model";
import { ArtistNode } from "./nodes/ArtistNode";
import { ClusterNode } from "./nodes/ClusterNode";
import { CoreNode } from "./nodes/CoreNode";
import { DeviceNode } from "./nodes/DeviceNode";
import { ScreenNode } from "./nodes/ScreenNode";
import { useViewport } from "./useViewport";

export type GraphSelection =
  | { kind: "core"; nodeId: string }
  | { kind: "cluster"; nodeId: string; cluster: ClusterGroup }
  | { kind: "artist"; nodeId: string; artist: ArtistGroup }
  | { kind: "device"; nodeId: string; device: NetworkDevice }
  | { kind: "screen"; nodeId: string; device: NetworkDevice; screen: string };

type Props = {
  variant: "home" | "full";
  snapshot: NetworkSnapshot;
  displays?: DisplaysMap | null;
  events?: readonly NetworkEventLike[];
  selectedId?: string;
  onSelect?: (selection: GraphSelection) => void;
  /** Isolation : seul cet artiste (clé stable) reste à plein contraste ; le reste est estompé et sans flux. */
  isolatedArtistKey?: string | null;
  onClearIsolation?: () => void;
};

function nodeInViewport(node: LayoutNode, view: { x: number; y: number; scale: number; width: number; height: number }) {
  const margin = 180 / Math.max(0.08, view.scale);
  const left = -view.x / view.scale - margin;
  const top = -view.y / view.scale - margin;
  const right = (view.width - view.x) / view.scale + margin;
  const bottom = (view.height - view.y) / view.scale + margin;
  return node.x + node.radius >= left && node.x - node.radius <= right && node.y + node.radius >= top && node.y - node.radius <= bottom;
}

function pathFor(ids: string[], index: Map<string, LayoutNode>): string | null {
  const points = ids.map((id) => index.get(id)).filter((node): node is LayoutNode => !!node);
  if (points.length < 2) return null;
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
}

function boundsFor(nodes: LayoutNode[], fallback: { x: number; y: number; width: number; height: number }, scale = 1) {
  if (!nodes.length) return fallback;
  const padding = 150;
  const minX = Math.min(...nodes.map((node) => node.x - node.radius * scale)) - padding;
  const maxX = Math.max(...nodes.map((node) => node.x + node.radius * scale)) + padding;
  const minY = Math.min(...nodes.map((node) => node.y - node.radius * scale)) - padding;
  const maxY = Math.max(...nodes.map((node) => node.y + node.radius * scale)) + padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function Graph({ variant, snapshot, displays = null, events = [], selectedId, onSelect, isolatedArtistKey = null, onClearIsolation }: Props) {
  const hierarchy = useMemo(() => buildNetworkHierarchy(snapshot.devices), [snapshot.devices]);
  const layout = useMemo(() => layoutNetwork(hierarchy), [hierarchy]);
  // « Ajuster » cadre le niveau global réellement visible, pas les centaines
  // de nœuds détaillés encore masqués. La carte occupe ainsi tout l'espace
  // disponible sans compromettre le pan vers les détails au zoom.
  // Petit réseau (nodeScale > 1) : on cadre TOUT (appareils et écrans compris) puisque tout tient dans la vue.
  const overviewWorld = useMemo(() => boundsFor(
    layout.nodeScale > 1 ? layout.nodes : layout.nodes.filter((node) => node.id === CORE_NODE_ID || node.parentId === CORE_NODE_ID),
    layout.world,
    layout.nodeScale,
  ), [layout]);
  const [locked, setLocked] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [now, setNow] = useState(snapshot.generatedAt);
  const viewport = useViewport(overviewWorld, locked);

  useEffect(() => {
    setNow(Date.now());
    if (window.matchMedia("(min-width: 701px)").matches) setMinimapOpen(true);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const artists = useMemo(() => new Map(hierarchy.artists.map((artist) => [artist.artistKey, artist])), [hierarchy.artists]);
  const clusters = useMemo(() => new Map(flattenClusters(hierarchy).map((cluster) => [cluster.id, cluster])), [hierarchy]);
  const devices = useMemo(() => new Map(snapshot.devices.map((device) => [device.publicId, device])), [snapshot.devices]);
  const flows = useMemo(() => buildObservedFlows({ devices: snapshot.devices, artists: hierarchy.artists, displays, events, now, reconstruct: true }), [displays, events, hierarchy.artists, now, snapshot.devices]);
  const activeIds = useMemo(() => new Set(flows.flatMap((flow) => flow.path)), [flows]);

  const detailScale = viewport.view.scale / Math.max(0.001, viewport.view.fitScale);
  const hasClusters = hierarchy.children.some((child) => child.kind === "cluster");
  // Petit réseau : appareils, écrans et libellés sont visibles dès le cadrage initial (≤ 12 appareils), puis progressivement.
  const densityFactor = layout.nodeScale > 1 ? (snapshot.totals.devices <= 12 ? 3.2 : 1.9) : snapshot.totals.devices >= 300 ? 0.46 : snapshot.totals.devices >= 100 ? 0.62 : hasClusters ? 0.76 : 1;
  const semanticScale = detailScale * densityFactor;
  const showArtists = !hasClusters || semanticScale >= 0.82;
  // Les regroupements imbriqués restent un détail d'implémentation. L'UI
  // passe directement d'une zone globale aux artistes réels qui la composent.
  const clusterDepthLimit = 1;
  const showArtistDetails = showArtists && semanticScale >= 1.35;
  const showDevices = !hasClusters || semanticScale >= 2.15;
  const showDeviceDetails = showDevices && semanticScale >= 2.45;
  const showScreens = showDevices && semanticScale >= 2.95;
  const showThumbnails = showScreens && semanticScale >= 4.15;
  const lod = showThumbnails ? "thumbs" : showScreens ? "screens" : showDevices ? "devices" : showArtists ? "artists" : "clusters";
  const coreMarkerScale = Math.min(layout.nodeScale > 1 ? 1.8 : 8, Math.max(1, 0.72 / Math.max(viewport.view.scale, 0.08)));
  const clusterMarkerScale = Math.min(8, Math.max(1, 0.72 / Math.max(viewport.view.scale, 0.08)));
  const hitRadius = Math.max(22 / Math.max(viewport.view.scale, 0.08), 18);
  const nodeScale = layout.nodeScale;
  const isolated = isolatedArtistKey;
  const isDimmed = (node: LayoutNode) => isolated !== null && node.kind !== "core" && node.artistKey !== isolated;
  const shownFlows = isolated === null ? flows : flows.filter((flow) => flow.artistKey === isolated);
  const visibleNodes = useMemo(() => layout.nodes.filter((node) => node.id === CORE_NODE_ID || nodeInViewport(node, viewport.view)), [layout.nodes, viewport.view]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const showMinimap = variant === "full" && (hierarchy.artistCount > 12 || detailScale < 0.92 || detailScale > 1.35);

  const select = (node: LayoutNode) => {
    if (!onSelect) return;
    if (node.kind === "core") return onSelect({ kind: "core", nodeId: node.id });
    if (node.kind === "cluster") {
      const cluster = clusters.get(node.id);
      if (cluster) onSelect({ kind: "cluster", nodeId: node.id, cluster });
      return;
    }
    if (node.kind === "artist") {
      const artist = node.artistKey ? artists.get(node.artistKey) : undefined;
      if (artist) onSelect({ kind: "artist", nodeId: node.id, artist });
      return;
    }
    const device = node.publicId ? devices.get(node.publicId) : undefined;
    if (!device) return;
    if (node.kind === "screen" && node.screen) onSelect({ kind: "screen", nodeId: node.id, device, screen: node.screen });
    else onSelect({ kind: "device", nodeId: node.id, device });
  };

  const focusScaleFor = (node: LayoutNode) => {
    const fit = viewport.view.fitScale;
    if (node.kind === "core") return fit;
    if (node.kind === "cluster") return fit * 4;
    if (node.kind === "artist") return fit * 6.2;
    if (node.kind === "device") return fit * 9.2;
    return fit * 10;
  };

  const visibleFlowPath = (path: string[]) => {
    const out: string[] = [];
    for (const id of path) {
      let node = layout.nodeIndex.get(id);
      while (node && ((node.kind === "cluster" && node.depth > clusterDepthLimit) || (node.kind === "artist" && !showArtists) || (node.kind === "device" && !showDevices) || (node.kind === "screen" && !showScreens))) {
        node = node.parentId ? layout.nodeIndex.get(node.parentId) : undefined;
      }
      if (node && out.at(-1) !== node.id) out.push(node.id);
    }
    return out;
  };

  return (
    <section className={`ng-shell ng-shell--${variant} ng-lod--${lod}${nodeScale > 1 ? " ng-spacious" : ""}`} aria-label="Carte interactive du réseau">
      <div className="ng-toolbar" aria-label="Contrôles du diagramme">
        <button type="button" onClick={() => viewport.zoomBy(1.4)} aria-label="Zoomer">+</button>
        <button type="button" onClick={() => viewport.zoomBy(1 / 1.4)} aria-label="Dézoomer">−</button>
        <button type="button" onClick={() => viewport.fit()} aria-label="Ajuster tout le réseau">◎</button>
        <button type="button" className={locked ? "is-active" : ""} onClick={() => setLocked((value) => !value)} aria-pressed={locked} aria-label={locked ? "Déverrouiller le diagramme" : "Verrouiller le diagramme"}>{locked ? "Déverrouiller" : "Verrouiller"}</button>
      </div>
      {isolated !== null && (
        <div className="ng-isolation" role="status">
          <span>Isolé : <b>{artists.get(isolated)?.label ?? "artiste"}</b></span>
          <button type="button" onClick={onClearIsolation} aria-label="Quitter l'isolation">✕ tout afficher</button>
        </div>
      )}
      <div className="ng-level" aria-live="polite">
        <span>{showThumbnails ? "Œuvres" : showScreens ? "Écrans" : showDevices ? "Appareils" : showArtists ? "Artistes" : "Vue globale"}</span>
        <b>{snapshot.totals.devices} appareils · {snapshot.totals.online} en ligne</b>
      </div>
      <div ref={viewport.viewportRef} className={`ng-viewport${locked ? " is-locked" : ""}`} tabIndex={0} {...viewport.handlers}
        onDoubleClick={(event) => {
          if (locked || (event.target as Element).closest(".ng-node")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const current = viewport.view;
          const x = (event.clientX - rect.left - current.x) / current.scale;
          const y = (event.clientY - rect.top - current.y) / current.scale;
          viewport.focusPoint(x, y, current.scale * 1.45);
        }}>
        <svg className="ng-canvas" width="100%" height="100%" role="img" aria-label={`Réseau de ${snapshot.totals.devices} appareils et ${snapshot.totals.screens} écrans`}>
          <defs>
            <pattern id={`ng-grid-${variant}`} width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="rgba(148,163,184,.055)" strokeWidth="1" /></pattern>
            <filter id={`ng-glow-${variant}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <rect width="100%" height="100%" fill={`url(#ng-grid-${variant})`} />
          <g ref={viewport.contentRef}>
            <g className="ng-links">
              {layout.links.map((link) => {
                const source = layout.nodeIndex.get(link.sourceId), target = layout.nodeIndex.get(link.targetId);
                if (!source || !target || !visibleIds.has(target.id)) return null;
                if (target.kind === "cluster" && target.depth > 1) return null;
                if (target.kind === "artist" && !showArtists) return null;
                if (target.kind === "device" && !showDevices) return null;
                if (target.kind === "screen" && !showScreens) return null;
                let visibleSource = source;
                if (target.kind === "artist") {
                  while (visibleSource.kind === "cluster" && visibleSource.depth > 1 && visibleSource.parentId) {
                    visibleSource = layout.nodeIndex.get(visibleSource.parentId) ?? visibleSource;
                  }
                }
                return <line key={link.id} className={`ng-link ng-link--${link.kind} ng-link--depth-${target.depth}${isDimmed(target) ? " ng-dim" : ""}`} x1={visibleSource.x} y1={visibleSource.y} x2={target.x} y2={target.y} />;
              })}
            </g>
            <g className="ng-flows" filter={`url(#ng-glow-${variant})`}>
              {shownFlows.map((flow) => {
                const d = pathFor(visibleFlowPath(flow.path), layout.nodeIndex);
                if (!d) return null;
                // Un échange = une piste pointillée discrète sur tout le trajet + un COURANT continu de points qui la parcourt tant que l'échange est actif
                // (plus d'impulsion isolée toutes les quelques secondes) ; il s'éteint en fondu à la fin de la fenêtre d'observation.
                return (
                  <g key={flow.id} className={`ng-flow-group ng-flow-group--${flow.kind} ng-flow-group--${flow.origin}`} style={{ color: flow.color, opacity: flow.opacity }}>
                    <path className="ng-flow-trail" d={d} />
                    <path className="ng-flow" d={d}><title>{flow.label}{flow.detail ? ` · ${flow.detail}` : ""}</title></path>
                  </g>
                );
              })}
            </g>
            <g className="ng-nodes">
              {visibleNodes.map((node) => {
                const dimmed = isDimmed(node);
                const element = (() => {
                const common = { selected: selectedId === node.id, hitRadius, onSelect: () => select(node), onFocus: () => viewport.focusPoint(node.x, node.y, focusScaleFor(node)) };
                if (node.kind === "core") return <CoreNode key={node.id} node={node} markerScale={coreMarkerScale} {...common} />;
                if (node.kind === "cluster") {
                  if (node.depth > 1) return null;
                  const cluster = clusters.get(node.id);
                  return cluster ? <ClusterNode key={node.id} node={node} cluster={cluster} markerScale={clusterMarkerScale} marker={!showArtists} {...common} /> : null;
                }
                if (node.kind === "artist") {
                  if (!showArtists) return null;
                  const artist = node.artistKey ? artists.get(node.artistKey) : undefined;
                  return artist ? <ArtistNode key={node.id} node={node} artist={artist} detailed={showArtistDetails} active={activeIds.has(node.id)} scale={nodeScale} {...common} /> : null;
                }
                const device = node.publicId ? devices.get(node.publicId) : undefined;
                if (!device) return null;
                if (node.kind === "device") {
                  if (!showDevices) return null;
                  return <DeviceNode key={node.id} node={node} device={device} detailed={showDeviceDetails} active={activeIds.has(node.id)} scale={nodeScale} {...common} />;
                }
                if (!showScreens || !node.screen) return null;
                const info = device.screens.find((screen) => screen.screen === node.screen);
                return <ScreenNode key={node.id} node={node} label={info?.label ?? node.screen} shown={displays?.[device.deviceId]?.[node.screen]} detailed={showThumbnails} thumbnail={common.selected || showThumbnails} scale={nodeScale} {...common} />;
                })();
                return element && dimmed ? <g key={node.id} className="ng-dim">{element}</g> : element;
              })}
            </g>
          </g>
        </svg>
      </div>
      <div className="ng-legend" aria-label="Légende de la constellation">
        <span><i className="is-zone" />zone de navigation</span>
        <span><i className="is-artist" />artiste</span>
        <span><i className="is-device" />appareil</span>
        <span><i className="is-screen" />écran</span>
        <span><i className="is-flow" />flux observé</span>
        <span><i className="is-flow is-recon" />flux reconstitué*</span>
        <small className="ng-footnote">* reconstitué à partir des blocs, des présences et des votes publiés (ce que le trajet devrait avoir été) — non mesuré directement.</small>
      </div>
      {showMinimap && <div className={`ng-minimap${minimapOpen ? " is-open" : ""}`}>
        <button type="button" onClick={() => setMinimapOpen((value) => !value)}>{minimapOpen ? "Réduire" : "Carte"}</button>
        {minimapOpen && <svg viewBox={`${layout.world.x} ${layout.world.y} ${layout.world.width} ${layout.world.height}`} aria-label="Mini-carte du réseau">
          {layout.links.filter((link) => link.kind !== "screen").map((link) => {
            const source = layout.nodeIndex.get(link.sourceId), target = layout.nodeIndex.get(link.targetId);
            return source && target ? <line key={link.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null;
          })}
          {layout.nodes.filter((node) => node.kind !== "screen").map((node) => <circle key={node.id} cx={node.x} cy={node.y} r={Math.max(8, node.radius * .35)} className={`is-${node.kind}`} />)}
          <rect className="ng-minimap__window" x={-viewport.view.x / viewport.view.scale} y={-viewport.view.y / viewport.view.scale}
            width={viewport.view.width / viewport.view.scale} height={viewport.view.height / viewport.view.scale} />
        </svg>}
      </div>}
      <style>{GRAPH_STYLES}</style>
    </section>
  );
}

const GRAPH_STYLES = `
  .ng-shell{position:relative;isolation:isolate;overflow:hidden;border:1px solid rgba(148,163,184,.12);border-radius:22px;background:radial-gradient(circle at 50% 44%,rgba(29,78,216,.055),transparent 44%),#060a11;color:#e8eef8;font-family:Inter,ui-sans-serif,system-ui,sans-serif;box-shadow:0 28px 80px rgba(0,0,0,.22)}
  .ng-shell--full{height:min(76vh,780px);min-height:560px}.ng-shell--home{height:min(68vh,680px);min-height:480px}
  .ng-viewport{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab;outline:none}.ng-viewport:active{cursor:grabbing}.ng-viewport.is-locked{touch-action:pan-y;cursor:default}
  .ng-viewport:focus-visible{box-shadow:inset 0 0 0 2px #60a5fa}.ng-canvas{display:block;user-select:none}
  .ng-toolbar{position:absolute;z-index:5;top:14px;left:14px;display:flex;gap:6px;padding:5px;border:1px solid rgba(148,163,184,.13);border-radius:13px;background:rgba(5,8,16,.82);backdrop-filter:blur(14px)}
  .ng-toolbar button{min-width:44px;height:44px;padding:0 12px;border:0;border-radius:9px;background:rgba(148,163,184,.08);color:#cbd5e1;font:700 15px/1 inherit;cursor:pointer}.ng-toolbar button:hover,.ng-toolbar button:focus-visible,.ng-toolbar button.is-active{outline:none;background:rgba(59,130,246,.22);color:#fff}
  .ng-level{position:absolute;z-index:4;top:17px;right:17px;display:flex;flex-direction:column;align-items:flex-end;gap:3px;pointer-events:none}.ng-level span{color:#67e8f9;font:800 9px/1 ui-monospace,monospace;letter-spacing:.15em;text-transform:uppercase}.ng-level b{color:#73839a;font:600 10px/1.2 ui-monospace,monospace}
  /* Liens de structure : pointillés ronds (jamais de trait plein : le plein est réservé aux contours des nœuds) */
  .ng-link{stroke:rgba(125,151,184,.5);stroke-width:2.4;stroke-linecap:round;stroke-dasharray:.1 8;vector-effect:non-scaling-stroke}
  .ng-link--hierarchy{stroke:rgba(150,175,210,.5);stroke-dasharray:.1 10}.ng-link--depth-1{stroke:rgba(113,139,170,.38);stroke-width:1.8}
  .ng-link--device{stroke:rgba(96,165,250,.7);stroke-width:2.6;stroke-dasharray:.1 7}.ng-link--screen{stroke:rgba(148,163,184,.62);stroke-width:2.2;stroke-dasharray:.1 6}
  .ng-dim{opacity:.1;pointer-events:none;transition:opacity .25s}
  .ng-lod--clusters .ng-cluster{opacity:1}
  /* Échange en cours : piste pointillée + courant continu de points (le motif défile sans interruption tant que le flux est actif) */
  .ng-flow-trail{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-dasharray:.1 9;opacity:.38;vector-effect:non-scaling-stroke}
  .ng-flow{fill:none;stroke:currentColor;stroke-width:4.2;stroke-linecap:round;stroke-dasharray:.1 17;vector-effect:non-scaling-stroke;animation:ng-stream 1.15s linear infinite}
  .ng-flow-group--validation .ng-flow,.ng-flow-group--vote .ng-flow{animation-duration:.8s}.ng-flow-group--block .ng-flow{stroke-width:5}
  .ng-flow-group--reconstructed .ng-flow{stroke-width:3;stroke-dasharray:.1 24;animation-duration:1.7s}.ng-flow-group--reconstructed .ng-flow-trail{opacity:.22;stroke-dasharray:.1 13}
  .ng-legend .is-recon{border-style:dotted}.ng-footnote{flex-basis:100%;color:#5b6b82;font:500 8px/1.35 ui-monospace,monospace;white-space:normal}
  .ng-isolation{position:absolute;z-index:5;top:70px;left:14px;display:flex;align-items:center;gap:10px;padding:6px 6px 6px 12px;border:1px solid rgba(192,132,252,.35);border-radius:11px;background:rgba(14,9,26,.88);color:#d8c9f5;font:600 11px/1 system-ui,sans-serif;backdrop-filter:blur(10px)}
  .ng-isolation b{color:#fff}.ng-isolation button{height:32px;padding:0 10px;border:0;border-radius:8px;background:rgba(192,132,252,.16);color:#e9d5ff;font:700 11px/1 system-ui,sans-serif;cursor:pointer}.ng-isolation button:hover{background:rgba(192,132,252,.3)}
  .ng-spacious .ng-artist__name{font-size:12px}.ng-spacious .ng-artist__meta{font-size:9px}.ng-spacious .ng-device__label{font-size:8px}
  .ng-hit{fill:transparent;stroke:none;pointer-events:all}.ng-node{cursor:pointer;outline:none}.ng-node:focus .ng-hit,.ng-node:hover .ng-hit{stroke:rgba(255,255,255,.3);stroke-width:2;vector-effect:non-scaling-stroke}
  .ng-core__aura{fill:none;stroke:rgba(45,212,191,.24);stroke-width:2;stroke-dasharray:7 9;vector-effect:non-scaling-stroke}.ng-core__body{fill:#071523;stroke:#2dd4bf;stroke-width:2;vector-effect:non-scaling-stroke}.ng-core__mark{fill:#f0fdfa;font:900 23px/1 ui-monospace,monospace;letter-spacing:-.08em}.ng-core__status{fill:#5eead4;font:800 8px/1 ui-monospace,monospace;letter-spacing:.16em}.ng-core.is-selected .ng-core__body{stroke:#fff;stroke-width:4}
  .ng-cluster__orbit{fill:rgba(59,130,246,.018);stroke:rgba(96,165,250,.22);stroke-width:1.15;stroke-dasharray:10 13;vector-effect:non-scaling-stroke}.ng-cluster__orbit--inner{fill:none;stroke:rgba(96,165,250,.08);stroke-dasharray:2 12}.ng-cluster__body{fill:rgba(9,20,37,.94);stroke:#5d8fc3;stroke-width:1.4;vector-effect:non-scaling-stroke}.ng-cluster__value{fill:#eff6ff;font:800 22px/1 ui-monospace,monospace}.ng-cluster__label{fill:#77a1ca;font:800 7px/1 ui-monospace,monospace;letter-spacing:.13em}.ng-cluster__count{fill:#7188a3;font:700 8px/1 ui-monospace,monospace}.ng-cluster.is-selected .ng-cluster__body{stroke:#fff;stroke-width:3}
  .ng-artist__territory{fill:rgba(167,139,250,.018);stroke:rgba(167,139,250,.16);stroke-width:1;stroke-dasharray:7 11;vector-effect:non-scaling-stroke}.ng-artist__body{fill:#10182a;stroke:#9d86d7;stroke-width:1.5;vector-effect:non-scaling-stroke}.ng-artist__initials{fill:#ede9fe;font:900 15px/1 ui-monospace,monospace}.ng-artist__name{fill:#e2e8f0;font:700 10px/1 system-ui,sans-serif}.ng-artist__meta{fill:#6f7f96;font:700 8px/1 ui-monospace,monospace}.ng-artist__activity{fill:none;stroke:#c084fc;stroke-width:3;opacity:.65;vector-effect:non-scaling-stroke}.ng-artist.is-selected .ng-artist__body{stroke:#fff;stroke-width:3}
  .ng-device__body{fill:#09111e;stroke-width:2;vector-effect:non-scaling-stroke}.ng-device__icon{fill:#b8c7db;font:800 8px/1 ui-monospace,monospace}.ng-device__label{fill:#8291a7;font:700 7px/1 ui-monospace,monospace}.ng-device__status{fill:#475569;stroke:#071019;stroke-width:2;vector-effect:non-scaling-stroke}.ng-device.is-online .ng-device__status{fill:#4ade80}.ng-device.is-offline{opacity:.56}.ng-device__activity{fill:none;stroke:#60a5fa;stroke-width:3;opacity:.72;vector-effect:non-scaling-stroke}.ng-device.is-selected .ng-device__body{stroke:#fff!important;stroke-width:4}
  .ng-screen__body{fill:#07101b;stroke-width:2;vector-effect:non-scaling-stroke}.ng-screen.is-confirmed .ng-screen__body{fill:#102037}.ng-screen__label{font:800 7px/1 ui-monospace,monospace}.ng-screen.is-selected .ng-screen__body{stroke:#fff!important;stroke-width:4}
  .ng-thumb{display:grid;place-items:center;width:100%;height:100%;overflow:hidden;border:1px solid rgba(255,255,255,.25);border-radius:5px;background:#fff}.ng-thumb .ld-thumb{border:0;border-radius:0}.ng-thumb .ld-muted{color:#475569;font-size:7px}
  .ng-legend{position:absolute;z-index:4;left:64px;bottom:15px;display:flex;flex-wrap:wrap;gap:8px 14px;max-width:calc(100% - 291px);padding:7px 10px;border:1px solid rgba(148,163,184,.1);border-radius:10px;background:rgba(5,8,16,.72);color:#718198;font:600 8px/1 ui-monospace,monospace;pointer-events:none;backdrop-filter:blur(8px)}.ng-legend span{display:flex;align-items:center;gap:5px;white-space:nowrap}.ng-legend i{display:inline-block;width:10px;height:10px;border:1px solid #64748b;border-radius:50%}.ng-legend .is-zone{border-style:dashed;border-color:#5d8fc3}.ng-legend .is-artist{border-color:#a78bfa;background:rgba(167,139,250,.18)}.ng-legend .is-device{border-color:#60a5fa;background:rgba(96,165,250,.15)}.ng-legend .is-screen{width:11px;height:7px;border-radius:2px;border-color:#94a3b8}.ng-legend .is-flow{width:16px;height:0;border:0;border-top:2px solid #2dd4bf;border-radius:0}
  .ng-minimap{position:absolute;z-index:5;right:14px;bottom:14px;padding:5px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(5,8,16,.85);backdrop-filter:blur(12px)}.ng-minimap>button{display:block;margin-left:auto;min-width:44px;height:32px;border:0;background:transparent;color:#8fa1ba;font:700 9px/1 ui-monospace,monospace;cursor:pointer}.ng-minimap svg{display:block;width:190px;height:120px;border-radius:7px;background:#060b14}.ng-minimap line{stroke:rgba(148,163,184,.25);stroke-width:5}.ng-minimap circle{fill:#64748b}.ng-minimap circle.is-core{fill:#2dd4bf}.ng-minimap circle.is-artist{fill:#a78bfa}.ng-minimap circle.is-device{fill:#60a5fa}.ng-minimap__window{fill:rgba(96,165,250,.08);stroke:#93c5fd;stroke-width:6;vector-effect:non-scaling-stroke}
  @keyframes ng-stream{to{stroke-dashoffset:-17.1}}
  @media(max-width:700px){.ng-shell--full,.ng-shell--home{height:72svh;min-height:520px;border-radius:16px}.ng-toolbar{top:auto;bottom:12px;left:12px}.ng-toolbar button{padding:0 9px}.ng-toolbar button:last-child{font-size:10px}.ng-level{top:13px;right:13px}.ng-legend{display:none}.ng-minimap{right:12px;bottom:72px}.ng-minimap:not(.is-open){padding:0}.ng-minimap svg{width:150px;height:94px}}
  @media(prefers-reduced-motion:reduce){.ng-flow{animation:none;stroke-dasharray:.1 17}.ng-core__aura,.ng-device__activity,.ng-artist__activity{animation:none}}
`;
