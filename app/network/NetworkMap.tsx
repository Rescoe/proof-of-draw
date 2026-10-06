"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { NetworkSnapshot, NetworkDevice } from "@/lib/networkSnapshot";
import { NetworkStage } from "./NetworkStage";
import { Graph, type GraphSelection } from "./graph";
import { CORE_NODE_ID, artistNodeId, buildNetworkHierarchy, buildObservedFlows, deviceNodeId, flattenArtists, reconstructedLogEvents, screenNodeId } from "./model";
import { ArtistPanel } from "./ArtistPanel";
import { SidePanel } from "./SidePanel";
import { ServerInfoPanel } from "./ServerInfoPanel";
import { GlobalTerminalPanel, useNetworkEventStream } from "./GlobalTerminal";
import { LiveDisplaysSection, useLiveDisplays } from "./LiveDisplays";

type Props = { snapshot: NetworkSnapshot | null; fixture?: string };

// Sélection unifiée : un device (+ éventuellement un de ses écrans), ou le
// nœud central "RESCOE" (infos serveur/réseau global).
type ViewMode = "classic" | "diagram";

export function NetworkMap({ snapshot, fixture }: Props) {
  const [selected, setSelected] = useState<GraphSelection | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("classic");
  // Isolation d'un artiste dans la Constellation (clé stable) : le reste du réseau s'estompe
  const [isolatedKey, setIsolatedKey] = useState<string | null>(null);
  // Ce que chaque écran affiche réellement (ACK firmware) — une requête partagée par la section « en direct » et le panneau appareil
  const live = useLiveDisplays(fixture);
  // Une seule boucle d'événements pour le terminal ET la vue expérimentale :
  // activer LAB ne crée aucune requête supplémentaire vers Redis.
  const eventStream = useNetworkEventStream(fixture);
  // Lignes RECONSTITUÉES (présences, diffusions de blocs) ajoutées au journal : calculées côté navigateur à partir du snapshot et du flux déjà chargés (aucune requête).
  // Calculées après le montage (Date.now) pour ne jamais diverger du rendu serveur.
  const [reconEvents, setReconEvents] = useState<ReturnType<typeof reconstructedLogEvents>>([]);
  const liveDisplays = live.data?.displays ?? null;
  useEffect(() => {
    if (!snapshot) { setReconEvents([]); return; }
    const hierarchy = buildNetworkHierarchy(snapshot.devices);
    const flows = buildObservedFlows({ devices: snapshot.devices, artists: hierarchy.artists, displays: liveDisplays, events: eventStream.events, now: Date.now(), reconstruct: true });
    setReconEvents(reconstructedLogEvents(flows));
  }, [snapshot, liveDisplays, eventStream.events]);
  const terminalStream = useMemo(() => ({
    connected: eventStream.connected,
    events: [...eventStream.events, ...reconEvents.filter((e) => !eventStream.events.some((x) => x.id === e.id))].sort((a, b) => a.ts - b.ts).slice(-200),
  }), [eventStream, reconEvents]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("networkView");
    if (requested === "diagram") setViewMode("diagram");
  }, []);

  const switchView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode !== "diagram") setIsolatedKey(null);
    const url = new URL(window.location.href);
    if (mode === "diagram") url.searchParams.set("networkView", "diagram");
    else url.searchParams.delete("networkView");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleSelect = useCallback((device: NetworkDevice, screen?: string) => {
    const nodeId = screen ? screenNodeId(device.publicId, screen) : deviceNodeId(device.publicId);
    setSelected((prev) => {
      return prev?.nodeId === nodeId ? null : screen
        ? { kind: "screen", nodeId, device, screen }
        : { kind: "device", nodeId, device };
    });
  }, []);

  const handleSelectServer = useCallback(() => {
    setSelected((prev) => (prev?.kind === "core" ? null : { kind: "core", nodeId: CORE_NODE_ID }));
  }, []);

  const handleGraphSelect = useCallback((selection: GraphSelection) => {
    setSelected((prev) => prev?.nodeId === selection.nodeId ? null : selection);
  }, []);

  if (!snapshot || !snapshot.devices?.length) {
    return (
      <div className="nv2-layout nv2-empty">
        <div className="nv2-empty__content">
          <div className="nv2-empty__icon">🌐</div>
          <p>Aucun device détecté</p>
          <small>Le réseau est vide ou Redis indisponible</small>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="nv2-view-switch" aria-label="Mode de visualisation du réseau">
      <div>
        <span className="nv2-view-switch__label">Vue réseau</span>
        <div className="nv2-view-switch__buttons">
          <button type="button" className={viewMode === "classic" ? "is-active" : ""} onClick={() => switchView("classic")} aria-pressed={viewMode === "classic"}>
            Topologie
          </button>
          <button type="button" className={viewMode === "diagram" ? "is-active" : ""} onClick={() => switchView("diagram")} aria-pressed={viewMode === "diagram"}>
            Constellation <span>LAB</span>
          </button>
        </div>
      </div>
      <p>{viewMode === "classic" ? "Vue historique conservée" : "Carte spatiale · niveaux de détail · flux observés et reconstitués*"}</p>
    </div>
    {/* Le panel est toujours présent — console par défaut, device info si sélectionné */}
    <div className="nv2-layout nv2-layout--panel">
      {viewMode === "classic" ? (
        <NetworkStage
          snapshot={snapshot}
          onDeviceSelect={handleSelect}
          selectedDeviceId={selected?.kind === "device" ? selected.device.deviceId : undefined}
          onServerSelect={handleSelectServer}
          isServerSelected={selected?.kind === "core"}
        />
      ) : (
        <Graph
          key={`${fixture ?? "live"}:${snapshot.totals.devices}`}
          variant="full"
          snapshot={snapshot}
          displays={live.data?.displays ?? null}
          events={eventStream.events}
          selectedId={selected?.nodeId}
          onSelect={handleGraphSelect}
          isolatedArtistKey={isolatedKey}
          onClearIsolation={() => setIsolatedKey(null)}
        />
      )}

      <aside className={`nv2-panel-wrap${selected ? " nv2-panel-wrap--has-selection" : ""}`}>
        {selected?.kind === "device" || selected?.kind === "screen" ? (
          <SidePanel
            device={selected.device}
            focusScreen={selected.kind === "screen" ? selected.screen : undefined}
            displays={live.data?.displays ?? null}
            onClose={() => setSelected(null)}
          />
        ) : selected?.kind === "core" ? (
          <ServerInfoPanel snapshot={snapshot} onClose={() => setSelected(null)} />
        ) : selected?.kind === "artist" ? (
          <div className="nv2-panel nv2-panel--terminal">
            <ArtistPanel
              key={selected.artist.artistKey}
              artist={selected.artist}
              displays={live.data?.displays ?? null}
              isolated={isolatedKey === selected.artist.artistKey}
              onToggleIsolation={() => { const key = selected.artist.artistKey; setIsolatedKey((prev) => (prev === key ? null : key)); }}
              onSelectDevice={(device) => handleSelect(device)}
              onClose={() => setSelected(null)}
            />
          </div>
        ) : selected?.kind === "cluster" ? (
          <div className="nv2-panel nv2-panel--terminal" style={{ padding: "1.25rem" }}>
            <div className="nv2-panel__section-label">Zone de la carte</div>
            <h2>{selected.cluster.deviceCount} appareils</h2>
            <p>{selected.cluster.deviceCount} appareil(s) · {selected.cluster.onlineCount} en ligne</p>
            <p>{selected.cluster.artistCount} artiste(s) dans cette zone de détail.</p>
            <div className="nv2-panel__section-label" style={{ marginTop: 14 }}>Artistes de cette zone</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {flattenArtists(selected.cluster).map((artist) => (
                <button key={artist.artistKey} type="button" onClick={() => handleGraphSelect({ kind: "artist", nodeId: artistNodeId(artist.artistKey), artist })}
                  style={{ display: "flex", justifyContent: "space-between", gap: 10, minHeight: 44, padding: "8px 12px", border: "1px solid rgba(148,163,184,.16)", borderRadius: 10, background: "rgba(15,23,42,.55)", color: "#e2e8f0", cursor: "pointer", textAlign: "left", fontSize: 13 }}>
                  <b style={{ fontWeight: 600 }}>{artist.label}</b>
                  <span style={{ color: artist.onlineCount ? "#4ade80" : "#718198", fontSize: 11 }}>{artist.onlineCount}/{artist.devices.length} en ligne</span>
                </button>
              ))}
            </div>
            <p style={{ color: "#718198", fontSize: 12 }}>Cette zone sert uniquement à naviguer dans les détails ; elle ne représente pas un groupe d’artistes.</p>
          </div>
        ) : (
          <div className="nv2-panel nv2-panel--terminal">
            <div className="nv2-panel__section-label" style={{ padding: "1rem 1.25rem 0", marginBottom: 0 }}>
              Journal réseau
            </div>
            <GlobalTerminalPanel stream={terminalStream} />
            <p className="nv2-footnote">* ligne reconstituée à partir des blocs, présences et votes publiés — ce n&apos;est pas le Serial réel des cartes.</p>
          </div>
        )}
      </aside>

      <style>{`
        .nv2-view-switch {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          margin: 0 0 10px;
          padding: 9px 11px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          color: #cbd5e1;
          background: rgba(8,12,20,0.92);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .nv2-view-switch__label {
          display: block;
          margin: 0 0 6px 3px;
          color: #607087;
          font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .nv2-view-switch__buttons {
          display: flex;
          gap: 3px;
          padding: 3px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 9px;
          background: #060a11;
        }
        .nv2-view-switch__buttons button {
          border: 0;
          border-radius: 6px;
          padding: 7px 10px;
          color: #718198;
          background: transparent;
          font-size: 11px;
          cursor: pointer;
        }
        .nv2-view-switch__buttons button.is-active {
          color: #e2e8f0;
          background: rgba(59,130,246,0.14);
          box-shadow: inset 0 0 0 1px rgba(96,165,250,0.16);
        }
        .nv2-view-switch__buttons button:last-child.is-active {
          color: #99f6e4;
          background: rgba(45,212,191,0.1);
          box-shadow: inset 0 0 0 1px rgba(45,212,191,0.16);
        }
        .nv2-view-switch__buttons span {
          margin-left: 4px;
          padding: 2px 4px;
          border: 1px solid currentColor;
          border-radius: 4px;
          font: 700 7px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
          opacity: .8;
        }
        .nv2-view-switch p {
          margin: 0 3px 3px;
          color: #607087;
          font-size: 10px;
          text-align: right;
        }
        /* Layout : carte réseau + panel droit fixe */
        .nv2-layout {
          display: grid;
          grid-template-columns: 1fr;
          background: #080c14;
          border-radius: 16px;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f1f5f9;
        }
        .nv2-layout--panel {
          grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
          /* Les deux colonnes s'étirent à la même hauteur — celle de la stage
             réseau (qui a une hauteur intrinsèque stable, cf. NetworkStage).
             Le panel ne peut donc jamais "pousser" / décaler la carte : il
             défile en interne (.nv2-panel { overflow-y: auto }) à la place. */
          align-items: stretch;
        }
        .nv2-panel-wrap {
          border-left: 1px solid rgba(255,255,255,0.05);
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        /* Panel terminal (pas de padding agressif — terminal gère le sien) */
        .nv2-panel--terminal {
          padding: 0;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .nv2-panel--terminal .gterm--panel {
          flex: 1;
          border-radius: 0;
          border: none;
          min-height: 0;
        }
        .nv2-panel--terminal .gterm--panel .gterm__body {
          max-height: none;
          flex: 1;
          /* Sans min-height:0 un flex-item garde sa taille de contenu : le corps
             grandirait avec chaque ligne de log et ferait déborder le panel (et
             toute la rangée carte+panel) vers le bas — d'où le "scroll dans le
             vide". overflow-y:auto forcé : scroll interne, jamais "verrouillé". */
          min-height: 0;
          overflow-y: auto !important;
        }

        @media (max-width: 900px) {
          .nv2-view-switch { align-items: flex-start; }
          .nv2-view-switch p { display: none; }
          /* Sur tablette/mobile : panel passe en dessous, en pleine page —
             PAS de cadre à hauteur fixe avec scroll interne (sensation de
             "boîte" qui capture le geste). Il s'ouvre en entier et défile
             avec la page, comme n'importe quelle section du site. */
          .nv2-layout--panel {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto;
          }
          .nv2-panel-wrap {
            border-left: none;
            border-top: 1px solid rgba(255,255,255,0.05);
            height: auto;
          }
          .nv2-panel-wrap .nv2-panel,
          .nv2-panel-wrap .nv2-panel--terminal {
            height: auto;
            max-height: none;
            overflow: visible;
          }
          .nv2-panel-wrap .nv2-panel--terminal .gterm--panel .gterm__body {
            overflow-y: auto !important;
          }
          /* Mobile : ne pas occuper d'espace avec le panel (terminal pod-core
             compact inclus) tant qu'aucun ESP n'est sélectionné — l'utilisateur
             clique d'abord sur la carte, le panel device apparaît ensuite. */
          .nv2-panel-wrap:not(.nv2-panel-wrap--has-selection) {
            display: none;
          }
        }
        @media (max-width: 480px) {
          .nv2-view-switch { padding: 8px; }
          .nv2-view-switch__buttons button { padding: 7px 8px; }
        }

        .nv2-footnote { margin: 0; padding: 6px 14px 10px; color: #5b6b82; font: 500 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }

        /* Empty state */
        .nv2-empty {
          display: grid;
          place-items: center;
          padding: 60px 20px;
        }
        .nv2-empty__content {
          text-align: center;
          color: rgba(148,163,184,0.6);
        }
        .nv2-empty__icon {
          font-size: 64px;
          margin-bottom: 16px;
          opacity: 0.5;
        }
        .nv2-empty__content p { font-size: 16px; margin-bottom: 4px; }
        .nv2-empty small { font-size: 13px; opacity: 0.5; }
      `}</style>
    </div>

    <LiveDisplaysSection
      snapshot={snapshot}
      data={live.data}
      onSelect={(device, screen) => handleSelect(device, screen)}
    />
    </>
  );
}
