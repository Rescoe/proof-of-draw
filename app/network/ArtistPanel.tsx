"use client";

import { useMemo } from "react";
import { HARDWARE_LABEL } from "@/lib/network/hardware";
import type { NetworkDevice } from "@/lib/networkSnapshot";
import type { DisplaysMap } from "./LiveDisplays";
import { HARDWARE_COLOR, SCREEN_COLOR, relativeTime, summarizeArtist, type ArtistGroup } from "./model";

type Props = {
  artist: ArtistGroup;
  displays: DisplaysMap | null;
  isolated: boolean;
  onToggleIsolation: () => void;
  onSelectDevice: (device: NetworkDevice) => void;
  onClose: () => void;
};

/**
 * Fiche d'un artiste (clic sur sa bulle dans la Constellation) : appareils et leur état, écrans avec ce qu'ils affichent RÉELLEMENT (confirmé par ACK),
 * œuvres affichées récemment, et l'isolation (le reste du réseau s'estompe pour ne voir que cet artiste). Aucune requête : tout vient du snapshot déjà chargé.
 */
export function ArtistPanel({ artist, displays, isolated, onToggleIsolation, onSelectDevice, onClose }: Props) {
  const summary = useMemo(() => summarizeArtist(artist, displays), [artist, displays]);
  const hardware = (Object.entries(artist.hardwareCounts) as [keyof typeof HARDWARE_LABEL, number][]).filter(([, count]) => count > 0);

  return (
    <div className="ap">
      <button type="button" className="ap__close" onClick={onClose} aria-label="Fermer la fiche">✕</button>
      <div className="ap__kicker">Artiste</div>
      <h2 className="ap__name">{artist.label}</h2>
      <p className="ap__sub">
        {artist.devices.length} appareil{artist.devices.length > 1 ? "s" : ""} · {artist.screenCount} écran{artist.screenCount > 1 ? "s" : ""} · <b className={artist.onlineCount ? "is-on" : ""}>{artist.onlineCount} en ligne</b>
      </p>
      <div className="ap__pills">
        {hardware.map(([hw, count]) => <span key={hw} style={{ borderColor: HARDWARE_COLOR[hw], color: HARDWARE_COLOR[hw] }}>{count} × {HARDWARE_LABEL[hw]}</span>)}
        <span>{summary.framesSent} frame{summary.framesSent > 1 ? "s" : ""} reçue{summary.framesSent > 1 ? "s" : ""}</span>
        <span>activité {relativeTime(summary.lastActivity)}</span>
      </div>

      <button type="button" className={`ap__isolate${isolated ? " is-on" : ""}`} onClick={onToggleIsolation} aria-pressed={isolated}>
        {isolated ? "✕ Quitter l’isolation" : "◎ Isoler cet artiste sur la carte"}
      </button>

      <div className="ap__label">Appareils</div>
      <ul className="ap__devices">
        {summary.devices.map(({ device, lastActivity, screens }) => (
          <li key={device.publicId}>
            <button type="button" onClick={() => onSelectDevice(device)} aria-label={`Ouvrir l’appareil ${device.publicId}`}>
              <span className={`ap__dot${device.isOnline ? " is-on" : ""}`} aria-hidden="true" />
              <span className="ap__dev">
                <b>{device.publicId.slice(0, 12)}</b>
                <small>{HARDWARE_LABEL[device.hardware]} · {device.firmware || "firmware inconnu"} · {device.isOnline ? "en ligne" : `vu ${relativeTime(lastActivity)}`}</small>
                <span className="ap__screens">
                  {screens.map((s) => (
                    <span key={s.screen} className={s.shown ? "is-shown" : ""} style={{ borderColor: SCREEN_COLOR[s.screen] ?? "#64748b", color: SCREEN_COLOR[s.screen] ?? "#94a3b8" }}
                      title={s.shown ? `Affiche : ${s.shown.workTitle || "Sans titre"} (confirmé)` : "Aucun affichage confirmé"}>
                      {s.label}{s.shown ? " ✓" : ""}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="ap__label">Affiché maintenant <small>(confirmé par les écrans)</small></div>
      {summary.recentWorks.length === 0 ? (
        <p className="ap__empty">Aucun écran de cet artiste n’a confirmé d’affichage pour l’instant.</p>
      ) : (
        <ul className="ap__works">
          {summary.recentWorks.map((work) => (
            <li key={work.key}>
              <span className="ap__work-dot" style={{ background: SCREEN_COLOR[work.screen] ?? "#64748b" }} aria-hidden="true" />
              <span><b>{work.title}</b>{work.isAnimation ? " · animation" : ""}{work.blockIndex !== undefined ? ` · bloc #${work.blockIndex}` : ""}<small>{work.screenLabel} · {relativeTime(work.shownAt)}</small></span>
            </li>
          ))}
        </ul>
      )}
      <style>{ARTIST_PANEL_STYLES}</style>
    </div>
  );
}

const ARTIST_PANEL_STYLES = `
  .ap{position:relative;flex:1;min-height:0;overflow-y:auto;padding:1.15rem 1.15rem 1.4rem;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .ap__close{position:absolute;top:10px;right:10px;width:34px;height:34px;border:0;border-radius:9px;background:rgba(148,163,184,.1);color:#94a3b8;cursor:pointer}.ap__close:hover{background:rgba(148,163,184,.22);color:#fff}
  .ap__kicker,.ap__label{color:#607087;font:700 9px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}.ap__label{margin:1.2rem 0 .55rem}.ap__label small{letter-spacing:0;text-transform:none;font-weight:500;color:#52627a}
  .ap__name{margin:.4rem 2rem .25rem 0;font-size:1.35rem;line-height:1.15;color:#fff;overflow-wrap:anywhere}
  .ap__sub{margin:0;color:#8a9ab0;font-size:.82rem}.ap__sub b{font-weight:600;color:#8a9ab0}.ap__sub b.is-on{color:#4ade80}
  .ap__pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:.75rem}.ap__pills span{padding:4px 8px;border:1px solid rgba(148,163,184,.28);border-radius:999px;color:#9fb0c6;font:600 10px/1.1 ui-monospace,monospace}
  .ap__isolate{width:100%;margin-top:1rem;min-height:44px;border:1px solid rgba(192,132,252,.4);border-radius:11px;background:rgba(192,132,252,.09);color:#e9d5ff;font:700 12px/1 system-ui,sans-serif;cursor:pointer}.ap__isolate:hover{background:rgba(192,132,252,.2)}.ap__isolate.is-on{background:rgba(192,132,252,.28);border-color:#c084fc}
  .ap__devices,.ap__works{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
  .ap__devices button{width:100%;display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid rgba(148,163,184,.14);border-radius:11px;background:rgba(15,23,42,.55);color:inherit;text-align:left;cursor:pointer;min-height:44px}.ap__devices button:hover,.ap__devices button:focus-visible{outline:none;border-color:rgba(96,165,250,.55);background:rgba(30,41,59,.7)}
  .ap__dot{flex:none;width:9px;height:9px;margin-top:5px;border-radius:50%;background:#475569}.ap__dot.is-on{background:#4ade80;box-shadow:0 0 8px #4ade80aa}
  .ap__dev{display:flex;flex-direction:column;gap:3px;min-width:0}.ap__dev b{font:700 12px/1.2 ui-monospace,monospace;color:#f1f5f9}.ap__dev small,.ap__works small{display:block;color:#718198;font-size:10px;line-height:1.3}
  .ap__screens{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}.ap__screens span{padding:2px 6px;border:1px solid;border-radius:6px;font:700 9px/1.3 ui-monospace,monospace;opacity:.72}.ap__screens span.is-shown{opacity:1;background:rgba(255,255,255,.05)}
  .ap__works li{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border-radius:9px;background:rgba(15,23,42,.45);font-size:12px}.ap__works b{font-weight:600;color:#f1f5f9}.ap__work-dot{flex:none;width:8px;height:8px;margin-top:5px;border-radius:2px}
  .ap__empty{margin:0;color:#718198;font-size:12px}
`;
