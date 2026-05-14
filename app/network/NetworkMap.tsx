"use client";

import { useState, useCallback } from "react";
import type { NetworkSnapshot, NetworkDevice } from "@/lib/networkSnapshot";
import { NetworkStage } from "./NetworkStage";
import { SidePanel } from "./SidePanel";

type Props = { snapshot: NetworkSnapshot | null };

export function NetworkMap({ snapshot }: Props) {
  const [selected, setSelected] = useState<NetworkDevice | null>(null);

  const handleSelect = useCallback((device: NetworkDevice) => {
    setSelected((prev) => (prev?.deviceId === device.deviceId ? null : device));
  }, []);

  // Garde si snapshot vide
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
    <div className="nv2-layout">
      <NetworkStage
        snapshot={snapshot}
        onDeviceSelect={handleSelect}
        selectedDeviceId={selected?.deviceId}
      />
      <SidePanel device={selected} onClose={() => setSelected(null)} />
      
      {/* CSS */}
      <style>{`
        .nv2-layout {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 0;
          background: #080c14;
          border-radius: 16px;
          overflow: hidden;
          min-height: 560px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f1f5f9;
        }
        @media (max-width: 768px) {
          .nv2-layout {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto;
          }
        }
        
        /* Empty state */
        .nv2-empty {
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
        .nv2-empty__content p {
          font-size: 16px;
          margin-bottom: 4px;
        }
        .nv2-empty small {
          font-size: 13px;
          opacity: 0.5;
        }
        
        /* SidePanel CSS (inchangé) */
        .nv2-panel { /* ... tout le CSS précédent ... */ }
        /* ... reste identique ... */
      `}</style>
    </div>
  );
}