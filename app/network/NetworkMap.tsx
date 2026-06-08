"use client";

import { useState, useCallback } from "react";
import type { NetworkSnapshot, NetworkDevice } from "@/lib/networkSnapshot";
import { NetworkStage } from "./NetworkStage";
import { SidePanel } from "./SidePanel";
import { ServerInfoPanel } from "./ServerInfoPanel";
import { GlobalTerminalPanel } from "./GlobalTerminal";

type Props = { snapshot: NetworkSnapshot | null };

// Sélection unifiée : un device (+ éventuellement un de ses écrans), ou le
// nœud central "RESCOE" (infos serveur/réseau global).
type Selection =
  | { kind: "device"; device: NetworkDevice; focusScreen?: string }
  | { kind: "server" };

export function NetworkMap({ snapshot }: Props) {
  const [selected, setSelected] = useState<Selection | null>(null);

  const handleSelect = useCallback((device: NetworkDevice, screen?: string) => {
    setSelected((prev) => {
      const same = prev?.kind === "device" &&
        prev.device.deviceId === device.deviceId && prev.focusScreen === screen;
      return same ? null : { kind: "device", device, focusScreen: screen };
    });
  }, []);

  const handleSelectServer = useCallback(() => {
    setSelected((prev) => (prev?.kind === "server" ? null : { kind: "server" }));
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
    // Le panel est toujours présent — console par défaut, device info si sélectionné
    <div className="nv2-layout nv2-layout--panel">
      <NetworkStage
        snapshot={snapshot}
        onDeviceSelect={handleSelect}
        selectedDeviceId={selected?.kind === "device" ? selected.device.deviceId : undefined}
        onServerSelect={handleSelectServer}
        isServerSelected={selected?.kind === "server"}
      />

      <aside className={`nv2-panel-wrap${selected ? " nv2-panel-wrap--has-selection" : ""}`}>
        {selected?.kind === "device" ? (
          <SidePanel
            device={selected.device}
            focusScreen={selected.focusScreen}
            onClose={() => setSelected(null)}
          />
        ) : selected?.kind === "server" ? (
          <ServerInfoPanel snapshot={snapshot} onClose={() => setSelected(null)} />
        ) : (
          <div className="nv2-panel nv2-panel--terminal">
            <div className="nv2-panel__section-label" style={{ padding: "1rem 1.25rem 0", marginBottom: 0 }}>
              Journal réseau
            </div>
            <GlobalTerminalPanel />
          </div>
        )}
      </aside>

      <style>{`
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
  );
}
