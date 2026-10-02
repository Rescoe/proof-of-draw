"use client";

// app/gallery-ana/ScenePreview.tsx
// Aperçu scene-v1 par profil d'écran dans la galerie ANA. Utilise le MÊME moteur de référence que le serveur
// (lib/scene/engine.ts) : ce que le Curateur compare à l'œuvre web est exactement ce que le PoD compile pour les appareils.
// Toute erreur ou tout repli est AFFICHÉ (contrat note 37 §8) : scène invalide + motifs, capture ou poster pour les
// appareils sans scene-v1. Aucune requête : le manifeste (≤ 4 Ko) est déjà dans les métadonnées de l'œuvre.

import { useEffect, useRef, useState } from "react";
import type { AnaWorkSceneMeta } from "@/lib/anaChain";
import type { AnaScene } from "@/lib/scene/spec";
import {
  renderSceneIndices, indicesToRgba, indicesToPosterGray, posterTick,
} from "@/lib/scene/engine";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";

type PreviewId = "oled096" | "tft18" | "eink27bw" | "eink29bwr";

interface PreviewDef { id: PreviewId; label: string; animated: boolean; maxFps?: number; note: string }

const PREVIEWS: PreviewDef[] = [
  { id: "oled096",   label: 'OLED 0.96"',      animated: true,  maxFps: 5, note: "animation locale scene-v1, 5 FPS max" },
  { id: "tft18",     label: 'TFT 1.8"',        animated: true,  maxFps: 2, note: "animation locale scene-v1, 2 FPS max" },
  { id: "eink27bw",  label: 'E-Ink 2.7" BW',   animated: false, note: "poster frame fixe (jamais d'animation)" },
  { id: "eink29bwr", label: 'E-Ink 2.9" BWR',  animated: false, note: "poster frame fixe (jamais d'animation)" },
];

const FALLBACK_LABEL: Record<AnaWorkSceneMeta["fallback"], string> = {
  capture: "capture fixe de l'œuvre web",
  poster:  "poster frame calculée par le moteur (aucune capture disponible)",
  none:    "rien : aucune capture ni scène exploitable — l'œuvre n'est diffusée sur aucun appareil",
};

function drawFrame(canvas: HTMLCanvasElement, scene: AnaScene, preview: PreviewDef, tick: number): void {
  const p = SCREEN_PROFILES[preview.id];
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const idx = renderSceneIndices(scene, p.width, p.height, tick);
  let rgba: Uint8ClampedArray;
  if (preview.id === "tft18") {
    rgba = indicesToRgba(idx, scene.palette);
  } else {
    // OLED / e-ink : monochrome — tout ce qui diffère du fond est allumé / encré (même règle que les buffers envoyés).
    const mask = indicesToPosterGray(idx, scene.palette, scene.backgroundIndex);
    const fg = preview.id === "oled096" ? [0x00, 0xff, 0x88] : [0, 0, 0];
    const bg = preview.id === "oled096" ? [0, 0, 0] : [255, 255, 255];
    rgba = new Uint8ClampedArray(mask.length * 4);
    for (let i = 0; i < mask.length; i++) {
      const c = mask[i] === 0 ? fg : bg;
      rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
    }
  }
  canvas.width = p.width; canvas.height = p.height;
  ctx.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
}

function SceneCanvas({ scene, preview }: { scene: AnaScene; preview: PreviewDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(preview.animated ? 0 : posterTick(scene));
  const fps = preview.animated ? Math.min(scene.tickRate, preview.maxFps ?? scene.tickRate) : 0;

  useEffect(() => {
    setTick(preview.animated ? 0 : posterTick(scene));
    setPlaying(preview.animated && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [scene, preview]);

  useEffect(() => {
    if (!playing || !preview.animated) return;
    let raf = 0, last = performance.now(), acc = 0;
    const step = (now: number) => {
      const frameMs = 1000 / fps;
      // Plafonné : un onglet masqué suspend requestAnimationFrame ; sans plafond, le retour déclencherait une rafale de ticks.
      acc = Math.min(acc + (now - last), frameMs * 2); last = now;
      while (acc >= frameMs) { acc -= frameMs; setTick((t) => (t + 1) % scene.durationTicks); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, preview, fps, scene.durationTicks]);

  useEffect(() => { if (ref.current) drawFrame(ref.current, scene, preview, tick); }, [scene, preview, tick]);

  const p = SCREEN_PROFILES[preview.id];
  return (
    <div className="sp-stage">
      <canvas
        ref={ref} width={p.width} height={p.height}
        aria-label={`Aperçu ${preview.label} — tick ${tick + 1} sur ${scene.durationTicks}`}
        className="sp-canvas"
        style={{ aspectRatio: `${p.width} / ${p.height}`, background: preview.id === "tft18" || preview.id === "oled096" ? "#000" : "#fff" }}
      />
      <div className="sp-controls">
        {preview.animated ? (
          <>
            <button className="sp-btn" onClick={() => setPlaying((v) => !v)}>{playing ? "⏸ Pause" : "▶ Lecture"}</button>
            <span className="sp-muted">tick {tick + 1}/{scene.durationTicks} · {fps} FPS sur cet écran · {scene.loopCount} boucle{scene.loopCount > 1 ? "s" : ""}</span>
          </>
        ) : (
          <span className="sp-muted">poster = tick {posterTick(scene) + 1}/{scene.durationTicks}</span>
        )}
      </div>
    </div>
  );
}

export function ScenePreview({ scene }: { scene: AnaWorkSceneMeta }) {
  const [active, setActive] = useState<PreviewId>("oled096");
  const preview = PREVIEWS.find((p) => p.id === active)!;
  const ok = scene.status === "ok" && !!scene.manifest;

  return (
    <div className="sp">
      {ok ? (
        <div className="sp-banner sp-banner--ok" role="status">
          ✓ Scène <code>ana-scene-v1</code> valide — {scene.manifest!.entities.length} entité{scene.manifest!.entities.length > 1 ? "s" : ""},
          {" "}{scene.manifest!.tickRate} ticks/s, {scene.manifest!.durationTicks} ticks × {scene.manifest!.loopCount} boucle{scene.manifest!.loopCount > 1 ? "s" : ""}
          {scene.sceneHash && <> · <code>{scene.sceneHash.replace("sha256:", "").slice(0, 12)}…</code></>}
        </div>
      ) : (
        <div className="sp-banner sp-banner--err" role="alert">
          ✗ Scène scene-v1 refusée par la revalidation PoD — aucune animation sur les appareils.
          <ul className="sp-errors">{(scene.errors ?? ["motif inconnu"]).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <p className="sp-muted" style={{ margin: "8px 0 12px" }}>
        Appareils sans scene-v1 (et e-ink si pas de poster) : <strong>{FALLBACK_LABEL[scene.fallback]}</strong>.
        {" "}Le Curateur compare l&apos;œuvre web et cet aperçu : la validation technique PoD ne remplace pas la décision artistique.
      </p>

      {ok && (
        <>
          <div className="sp-tabs" role="tablist">
            {PREVIEWS.map((p) => (
              <button key={p.id} role="tab" aria-selected={active === p.id}
                className={`sp-tab${active === p.id ? " sp-tab--on" : ""}`} onClick={() => setActive(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="sp-muted" style={{ margin: "6px 0 10px" }}>{preview.note}</p>
          <SceneCanvas key={preview.id} scene={scene.manifest!} preview={preview} />
        </>
      )}

      <style>{`
        .sp-banner { font-size: 12px; line-height: 1.6; padding: 9px 12px; border-radius: 8px; border: 1px solid; }
        .sp-banner--ok { color: #86efac; background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.3); }
        .sp-banner--err { color: #fca5a5; background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.35); }
        .sp-errors { margin: 6px 0 0; padding-left: 18px; font-size: 11px; color: #fecaca; overflow-wrap: anywhere; }
        .sp-muted { font-size: 12px; color: var(--text3, #64748b); line-height: 1.6; }
        .sp-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
        .sp-tab { background: var(--bg3, #151c2c); border: 1px solid rgba(255,255,255,0.08); color: var(--text2, #94a3b8); font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
        .sp-tab--on { color: var(--text1, #f1f5f9); border-color: var(--accent, #7c6bff); }
        .sp-stage { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
        .sp-canvas { width: 100%; max-width: 384px; image-rendering: pixelated; border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; }
        .sp-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .sp-btn { background: var(--bg3, #151c2c); border: 1px solid rgba(255,255,255,0.12); color: var(--text1, #f1f5f9); font-size: 12px; padding: 6px 12px; border-radius: 8px; cursor: pointer; min-height: 32px; }
      `}</style>
    </div>
  );
}
