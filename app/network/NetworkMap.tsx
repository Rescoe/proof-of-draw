"use client";

import { useState, useCallback } from "react";
import type { NetworkSnapshot, NetworkDevice } from "@/lib/networkSnapshot";
import { NetworkStage } from "./NetworkStage";
import { SidePanel } from "./SidePanel";
import { GlobalTerminalPanel } from "./GlobalTerminal";

type Props = { snapshot: NetworkSnapshot | null };

export function NetworkMap({ snapshot }: Props) {
  const [selected, setSelected] = useState<NetworkDevice | null>(null);

  const handleSelect = useCallback((device: NetworkDevice) => {
    setSelected((prev) => (prev?.deviceId === device.deviceId ? null : device));
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
        selectedDeviceId={selected?.deviceId}
      />

      <aside className="nv2-panel-wrap">
        {selected ? (
          <SidePanel device={selected} onClose={() => setSelected(null)} />
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
          min-height: 560px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f1f5f9;
        }
        .nv2-layout--panel {
          grid-template-columns: 1fr 300px;
        }
        .nv2-panel-wrap {
          border-left: 1px solid rgba(255,255,255,0.05);
          overflow-y: auto;
          min-height: 0;
        }
        /* Panel terminal (pas de padding agressif — terminal gère le sien) */
        .nv2-panel--terminal {
          padding: 0;
          min-height: 560px;
          display: flex;
          flex-direction: column;
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
        }

        @media (max-width: 900px) {
          /* Sur tablette/mobile : panel passe en dessous */
          .nv2-layout--panel {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto;
          }
          .nv2-panel-wrap {
            border-left: none;
            border-top: 1px solid rgba(255,255,255,0.05);
            max-height: 320px;
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
