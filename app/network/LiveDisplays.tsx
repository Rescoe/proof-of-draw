"use client";

// app/network/LiveDisplays.tsx
// « Qui affiche quoi » en direct : les IMAGES que chaque ESP a CONFIRMÉ afficher (ACK du firmware). Vue publique volontairement
// sobre : images seulement. Le détail (titre, nature, frameId, bloc, mode…) vit dans « Mon profil » (OwnDisplaysDebug).
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

export function ShownThumb({ frameId, screen, box }: { frameId: string; screen: string; box: { w: number; h: number } }) {
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

// ─── Vue publique : images seulement ─────────────────────────────────────────

const SCREEN_COLOR: Record<string, string> = { eink29bwr: "#f87171", eink27bw: "#94a3b8", oled096: "#60a5fa", tft18: "#fbbf24" };

/** Une image affichée (miniature + légende minimale : le nom de l'écran en couleur). */
function ShownImage({ screen, label, shown, box }: { screen: string; label: string; shown: PublicShown; box: { w: number; h: number } }) {
  if (!shown.frameId) return null;
  return (
    <figure className="ld-img" title={[shown.workTitle, shown.artistName].filter(Boolean).join(" — ") || undefined}>
      <ShownThumb frameId={shown.frameId} screen={screen} box={box} />
      <figcaption style={{ color: SCREEN_COLOR[screen] ?? "#a2a3bb" }}>{label}</figcaption>
    </figure>
  );
}

/** Bloc « Affiché maintenant » du panneau d'un appareil : ses images, rien d'autre (rien du tout s'il n'y en a pas). */
export function DeviceShownNow({ device, displays, onlyScreen }: {
  device: NetworkDevice; displays: DisplaysMap | null; onlyScreen?: string;
}) {
  const shown = device.screens
    .filter((s) => !onlyScreen || s.screen === onlyScreen)
    .map((s) => ({ s, shown: displays?.[device.deviceId]?.[s.screen] }))
    .filter((x): x is { s: typeof x.s; shown: PublicShown } => !!x.shown);
  if (shown.length === 0) return null;
  return (
    <div className="nv2-panel__section">
      <div className="nv2-panel__section-label">Affiché maintenant</div>
      <div className="ld-row">
        {shown.map(({ s, shown: sh }) => <ShownImage key={s.screen} screen={s.screen} label={s.label} shown={sh} box={{ w: 200, h: 120 }} />)}
      </div>
      <LiveStyle />
    </div>
  );
}

/** Section sous la carte : les images en cours d'affichage, par appareil. Masquée tant qu'aucun écran n'a confirmé d'affichage. */
export function LiveDisplaysSection({ snapshot, data, onSelect }: {
  snapshot: NetworkSnapshot; data: DisplaysResponse | null;
  onSelect: (device: NetworkDevice, screen?: string) => void;
}) {
  const displays = data?.displays;
  if (!displays) return null;
  const cards = snapshot.devices
    .map((d) => ({ d, items: d.screens.map((s) => ({ s, shown: displays[d.deviceId]?.[s.screen] })).filter((x): x is { s: typeof x.s; shown: PublicShown } => !!x.shown) }))
    .filter((c) => c.items.length > 0)
    .sort((a, b) => Math.max(...b.items.map((i) => i.shown.shownAt)) - Math.max(...a.items.map((i) => i.shown.shownAt)));
  if (cards.length === 0) return null;

  return (
    <section className="ld-section" aria-label="Actuellement affiché">
      <h2 className="ld-title">Actuellement affiché</h2>
      <div className="ld-grid">
        {cards.map(({ d, items }) => (
          <article key={d.deviceId} className="ld-card">
            <button className="ld-card__head" onClick={() => onSelect(d)} title="Ouvrir cet appareil dans la carte">
              <span className="ld-dot" style={{ background: d.isOnline ? "#4ade80" : "#475569" }} />
              <strong>{d.artistName || d.deviceId.slice(0, 14)}</strong>
            </button>
            <div className="ld-row">
              {items.map(({ s, shown }) => <ShownImage key={s.screen} screen={s.screen} label={s.label} shown={shown} box={{ w: 150, h: 96 }} />)}
            </div>
          </article>
        ))}
      </div>
      <LiveStyle />
    </section>
  );
}

export function LiveStyle() {
  return (
    <style>{`
      .ld-section { margin-top: 18px; background: #080c14; border-radius: 16px; padding: 18px; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .ld-title { margin: 0 0 12px; font-size: 14px; font-weight: 700; }
      .ld-muted { font-size: 11px; color: rgba(148,163,184,0.75); line-height: 1.5; }
      .ld-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 12px; }
      .ld-card { background: #0e1422; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 10px 12px 12px; min-width: 0; }
      .ld-card__head { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; color: inherit; font-size: 13px; padding: 2px 0 8px; cursor: pointer; text-align: left; min-height: 32px; }
      .ld-card__head strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ld-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
      .ld-row { display: flex; flex-wrap: wrap; gap: 12px; }
      .ld-img { margin: 0; display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 100%; }
      .ld-img figcaption { font-size: 11px; font-weight: 700; }
      .ld-thumb { display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; max-width: 100%; }
    `}</style>
  );
}
