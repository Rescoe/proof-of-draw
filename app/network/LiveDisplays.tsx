"use client";

// app/network/LiveDisplays.tsx
// « Qui affiche quoi » en direct : ce que chaque ESP a CONFIRMÉ avoir affiché (ACK du firmware), avec l'aperçu de l'image,
// le titre, l'artiste et la nature de l'œuvre. Distinct du dernier bloc miné/validé : un bloc peut être validé sans être
// encore affiché (frame en attente), ou remplacé sur l'écran par une autre œuvre (ANA, personnelle…).
// Données : /api/network/displays (une requête, cache serveur invalidé par ACK) puis /api/network/display-image par frame
// (immuable, cache navigateur). Rafraîchissement : toutes les 60 s, seulement onglet visible.

import { useEffect, useRef, useState } from "react";
import type { NetworkDevice, NetworkSnapshot } from "@/lib/networkSnapshot";
import type { PublicShown } from "@/lib/displayState";
import { eink29bwrToCanvas, eink27bwToCanvas, oled096ToCanvas, tft18ToCanvas } from "@/lib/screenToCanvas";

export type DisplaysMap = Record<string, Record<string, PublicShown>>;
interface DisplaysResponse { generatedAt: number; displays: DisplaysMap }
interface ImagePayload { screen: string; black?: string; red?: string; buffer?: string }

const POLL_MS = 60_000;

// ─── Données ─────────────────────────────────────────────────────────────────

export function useLiveDisplays(): { data: DisplaysResponse | null; error: boolean } {
  const [data, setData] = useState<DisplaysResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = () => {
      fetch("/api/network/displays")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: DisplaysResponse) => { if (alive) { setData(d); setError(false); } })
        .catch(() => { if (alive) setError(true); });
    };
    const start = () => { if (!timer) timer = setInterval(load, POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { load(); start(); } else stop();
    };
    load();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { alive = false; stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  return { data, error };
}

// Une frame ne change jamais pour un frameId donné : une seule requête par image et par session.
const imageCache = new Map<string, Promise<ImagePayload | null>>();
function loadImage(frameId: string, screen: string): Promise<ImagePayload | null> {
  const key = `${frameId}:${screen}`;
  let p = imageCache.get(key);
  if (!p) {
    p = fetch(`/api/network/display-image?frameId=${encodeURIComponent(frameId)}&screen=${encodeURIComponent(screen)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.imagePayload as ImagePayload | undefined) ?? null)
      .catch(() => null);
    imageCache.set(key, p);
    p.then((v) => { if (!v) imageCache.delete(key); });
  }
  return p;
}

// ─── Aperçu ──────────────────────────────────────────────────────────────────

function payloadToImageData(p: ImagePayload): ImageData | null {
  try {
    if (p.screen === "eink29bwr" && p.black && p.red) return eink29bwrToCanvas(p.black, p.red);
    if (p.screen === "eink27bw" && p.buffer) return eink27bwToCanvas(p.buffer);
    if (p.screen === "oled096" && p.buffer) return oled096ToCanvas(p.buffer);
    if (p.screen === "tft18" && p.buffer) return tft18ToCanvas(p.buffer);
  } catch { /* buffer corrompu : pas d'aperçu */ }
  return null;
}

function ShownThumb({ frameId, screen, box }: { frameId: string; screen: string; box: { w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [native, setNative] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    loadImage(frameId, screen).then((p) => {
      if (!alive) return;
      const data = p ? payloadToImageData(p) : null;
      const c = ref.current, ctx = c?.getContext("2d");
      if (!data || !c || !ctx) { setState("missing"); return; }
      c.width = data.width; c.height = data.height;
      ctx.putImageData(data, 0, 0);
      setNative({ w: data.width, h: data.height });
      setState("ok");
    });
    return () => { alive = false; };
  }, [frameId, screen]);

  const scale = native ? Math.min(box.w / native.w, box.h / native.h) : 1;
  const w = native ? Math.round(native.w * scale) : box.w, h = native ? Math.round(native.h * scale) : box.h;
  return (
    <div className="ld-thumb" style={{ width: box.w, height: box.h }}>
      <canvas ref={ref} style={{ width: w, height: h, imageRendering: "pixelated", display: state === "ok" ? "block" : "none" }} />
      {state !== "ok" && <span className="ld-muted">{state === "loading" ? "…" : "aperçu expiré"}</span>}
    </div>
  );
}

// ─── Libellés ────────────────────────────────────────────────────────────────

const ANA_KIND_LABEL: Record<string, string> = {
  poem: "Poème d'agent IA",
  celebration: "Mémorial de burn",
  spontaneous: "Dessin d'agent IA",
  "generative-capture": "Œuvre générative",
};

export function kindLabel(s: PublicShown): string {
  if (s.kind === "personal") return "Affichage privé";
  if (s.kind === "ana") return (ANA_KIND_LABEL[s.anaKind ?? ""] ?? "Œuvre ANA") + (s.mode === "scene" ? " · scène animée" : "");
  return s.blockIndex != null ? `Dessin humain · bloc #${s.blockIndex}` : "Dessin humain";
}

function ago(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "à l'instant";
  if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
  return `il y a ${Math.floor(sec / 86400)} j`;
}

const SCREEN_COLOR: Record<string, string> = { eink29bwr: "#f87171", eink27bw: "#94a3b8", oled096: "#60a5fa", tft18: "#fbbf24" };

// ─── Une carte = un écran ────────────────────────────────────────────────────

export function ShownScreen({ screen, label, shown, box = { w: 150, h: 96 } }: {
  screen: string; label: string; shown: PublicShown | undefined; box?: { w: number; h: number };
}) {
  const color = SCREEN_COLOR[screen] ?? "#a2a3bb";
  return (
    <div className="ld-screen">
      <div className="ld-screen__label" style={{ color }}>{label}</div>
      {!shown ? (
        <div className="ld-thumb ld-thumb--empty" style={{ width: box.w, height: box.h }}>
          <span className="ld-muted">pas encore de confirmation d&apos;affichage</span>
        </div>
      ) : shown.kind === "personal" ? (
        <div className="ld-thumb ld-thumb--empty" style={{ width: box.w, height: box.h }}>
          <span className="ld-muted">🔒 dessin personnel</span>
        </div>
      ) : shown.frameId && shown.hasImage ? (
        <ShownThumb frameId={shown.frameId} screen={screen} box={box} />
      ) : (
        <div className="ld-thumb ld-thumb--empty" style={{ width: box.w, height: box.h }}><span className="ld-muted">pas d&apos;aperçu</span></div>
      )}
      {shown && (
        <div className="ld-screen__meta">
          {shown.kind !== "personal" && shown.workTitle && shown.workTitle !== "Sans titre" && <strong>{shown.workTitle}</strong>}
          {shown.kind !== "personal" && shown.artistName && <span>{shown.artistName}</span>}
          <span className="ld-muted">{kindLabel(shown)} · {ago(shown.shownAt)}</span>
        </div>
      )}
    </div>
  );
}

/** Bloc « Affiché maintenant » du panneau d'un appareil (un écran, ou tous ses écrans). */
export function DeviceShownNow({ device, displays, onlyScreen }: {
  device: NetworkDevice; displays: DisplaysMap | null; onlyScreen?: string;
}) {
  const screens = device.screens.filter((s) => !onlyScreen || s.screen === onlyScreen);
  return (
    <div className="nv2-panel__section">
      <div className="nv2-panel__section-label">Affiché maintenant sur l&apos;écran</div>
      {!displays ? <p className="ld-muted">Chargement…</p> : (
        <div className="ld-row">
          {screens.map((s) => (
            <ShownScreen key={s.screen} screen={s.screen} label={s.label} shown={displays[device.deviceId]?.[s.screen]} box={{ w: 200, h: 120 }} />
          ))}
        </div>
      )}
      <LiveStyle />
    </div>
  );
}

// ─── Section pleine largeur : tous les appareils ─────────────────────────────

export function LiveDisplaysSection({ snapshot, data, error, onSelect }: {
  snapshot: NetworkSnapshot; data: DisplaysResponse | null; error: boolean;
  onSelect: (device: NetworkDevice, screen?: string) => void;
}) {
  const displays = data?.displays ?? null;
  const lastShown = (d: NetworkDevice) => Math.max(0, ...d.screens.map((s) => displays?.[d.deviceId]?.[s.screen]?.shownAt ?? 0));
  const devices = [...snapshot.devices].sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || lastShown(b) - lastShown(a));

  return (
    <section className="ld-section" aria-label="Écrans en direct">
      <header className="ld-head">
        <h2>Écrans en direct</h2>
        <span className="ld-muted">
          Ce que chaque ESP a confirmé afficher — rafraîchi toutes les minutes
          {data && ` · mis à jour ${ago(data.generatedAt)}`}
          {error && " · connexion instable"}
        </span>
      </header>
      {!displays && !error && <p className="ld-muted">Chargement des affichages…</p>}
      {error && !displays && <p className="ld-muted">Affichages indisponibles pour le moment.</p>}
      {displays && (
        <div className="ld-grid">
          {devices.map((d) => (
            <article key={d.deviceId} className="ld-card">
              <button className="ld-card__head" onClick={() => onSelect(d)} title="Ouvrir cet appareil dans la carte">
                <span className="ld-dot" style={{ background: d.isOnline ? "#4ade80" : "#475569" }} />
                <strong>{d.artistName || d.deviceId.slice(0, 14)}</strong>
                <span className="ld-muted">{d.isOnline ? "en ligne" : "hors ligne"}</span>
              </button>
              <div className="ld-row">
                {d.screens.map((s) => (
                  <ShownScreen key={s.screen} screen={s.screen} label={s.label} shown={displays[d.deviceId]?.[s.screen]} />
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      <LiveStyle />
    </section>
  );
}

function LiveStyle() {
  return (
    <style>{`
      .ld-section { margin-top: 18px; background: #080c14; border-radius: 16px; padding: 18px; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .ld-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin-bottom: 14px; }
      .ld-head h2 { margin: 0; font-size: 16px; }
      .ld-muted { font-size: 11px; color: rgba(148,163,184,0.75); line-height: 1.5; }
      .ld-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 12px; }
      .ld-card { background: #0e1422; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 10px 12px 12px; min-width: 0; }
      .ld-card__head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; color: inherit; font-size: 13px; padding: 2px 0 8px; cursor: pointer; text-align: left; min-height: 32px; }
      .ld-card__head strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ld-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
      .ld-row { display: flex; flex-wrap: wrap; gap: 12px; }
      .ld-screen { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: 100%; }
      .ld-screen__label { font-size: 11px; font-weight: 700; }
      .ld-screen__meta { display: flex; flex-direction: column; gap: 1px; font-size: 12px; max-width: 220px; overflow-wrap: anywhere; }
      .ld-screen__meta strong { font-size: 12px; }
      .ld-thumb { display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; max-width: 100%; }
      .ld-thumb--empty { background: #0b101b; border-style: dashed; padding: 6px; text-align: center; }
    `}</style>
  );
}
