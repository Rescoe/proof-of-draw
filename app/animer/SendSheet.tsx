"use client";
// app/animer/SendSheet.tsx — envoyer au réseau (même circuit qu'un dessin : empreintes, votes signés, bloc, galerie) ou exporter.

import { Download, FileUp, Send } from "lucide-react";
import { useRef } from "react";
import { CLIP } from "@/lib/bench/clip";
import { Sheet } from "../draw/_studio/ui";
import type { TimelineStats } from "./Timeline";

export interface DeviceLite { deviceId: string; deviceName?: string; artistName?: string; screens: string[]; isOnline: boolean }

export function SendSheet(props: {
  devices: DeviceLite[] | null; deviceId: string; onDevice: (id: string) => void; screenLabel: string; screenGeometry: string;
  title: string; onTitle: (t: string) => void; frames: number; stats: TimelineStats | null; handmade: boolean;
  busy: boolean; msg: { ok: boolean; text: string } | null;
  onSubmit: () => void; onGif: () => void; onExport: () => void; onImport: (f: File | undefined) => void; onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { stats } = props;
  const hasDevice = !!props.devices && props.devices.length > 0 && !!props.deviceId;
  const tooBig = !!stats && !stats.fits;
  const problem = !props.handmade ? "Ce modèle n'a pas été modifié : dessinez dessus avant de le soumettre." : tooBig ? "Trop lourde pour l'écran : retirez des images ou simplifiez les dessins." : props.frames < 2 ? "Une animation a besoin d'au moins 2 images." : !hasDevice ? "Aucun écran compatible dans votre profil." : null;
  const share = stats ? Math.min(1, stats.bytes / CLIP.MAX_CLIP_BYTES) : 0;
  return (
    <Sheet title="Envoyer l'animation" onClose={props.onClose}>
      <div className="st-field">
        <label htmlFor="an-title">Titre de l&apos;œuvre</label>
        <input id="an-title" className="st-input" value={props.title} maxLength={80} placeholder="Sans titre" onChange={(e) => props.onTitle(e.target.value)} />
      </div>
      {stats && (
        <div className="st-field">
          <label>Poids pour l&apos;écran</label>
          <div className="an-meter" role="img" aria-label={`${(stats.bytes / 1024).toFixed(1)} kilo-octets sur ${(CLIP.MAX_CLIP_BYTES / 1024).toFixed(0)}`}>
            <i style={{ width: `${share * 100}%`, background: tooBig ? "var(--st-err)" : share > 0.7 ? "var(--st-warn)" : "var(--st-ok)" }} />
          </div>
          <span className="st-note">{props.frames} images · {(stats.bytes / 1024).toFixed(1)} / {(CLIP.MAX_CLIP_BYTES / 1024).toFixed(0)} Ko · {(stats.durationMs / 1000).toFixed(1)} s par tour</span>
        </div>
      )}
      <div className="st-field">
        <label htmlFor="an-device">Écran cible</label>
        {props.devices === null ? <span className="st-note">Chargement…</span> : props.devices.length === 0 ? (
          <span className="st-note" style={{ color: "var(--st-warn)" }}>Aucun écran qui joue des animations dans votre profil (TFT 2,8″, TFT 1,8″ ou OLED). Vous pouvez quand même dessiner et exporter en GIF.</span>
        ) : (
          <>
            <select id="an-device" className="st-input" value={props.deviceId} onChange={(e) => props.onDevice(e.target.value)}>
              {props.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.deviceName || d.artistName || d.deviceId}</option>)}
            </select>
            <span className="st-note">{props.screenLabel} — animation {props.screenGeometry}. Une fois validée, elle est diffusée à tous les écrans capables.</span>
          </>
        )}
      </div>
      {problem && <p role="alert" className="st-note" style={{ color: "var(--st-warn)" }}>{problem}</p>}
      <button type="button" className="st-btn st-btn--accent st-btn--big st-btn--block" onClick={props.onSubmit} disabled={props.busy || !!problem}>
        <Send size={20} /> {props.busy ? "Soumission…" : "Soumettre au réseau"}
      </button>
      {props.msg && <p role="status" className="st-note" style={{ marginTop: 10, color: props.msg.ok ? "var(--st-ok)" : "var(--st-err)", fontWeight: 600 }}>{props.msg.text}</p>}
      <p className="st-note" style={{ marginTop: 10 }}>Soumise, l&apos;animation suit le même circuit qu&apos;un dessin : chaque image est empreinte et notée, les appareils la valident et la signent, puis elle devient un bloc de la <a href="/gallery?type=animation" style={{ color: "var(--st-accent-hi)" }}>galerie</a>.</p>
      <div className="st-h">Exporter</div>
      <div className="st-row">
        <button type="button" className="st-chip" onClick={props.onGif}><Download size={18} /> GIF</button>
        <button type="button" className="st-chip" onClick={props.onExport}><Download size={18} /> Projet (.json)</button>
        <button type="button" className="st-chip" onClick={() => fileRef.current?.click()}><FileUp size={18} /> Importer un projet</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { props.onImport(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </Sheet>
  );
}
