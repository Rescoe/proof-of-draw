"use client";

// app/network/AnimLoop.tsx — la BOUCLE d'une animation de bloc dans la vue réseau : l'écran qui la joue (confirmé par l'ACK) la montre en mouvement, comme sur le matériel.
// Le clip PBC1 (≤ 9 Ko, immuable) vient de /api/block-clip : mis en cache un an par le CDN et une fois par session ici → 0 commande Redis par vignette.
// Fidélité : on rejoue le CLIP lui-même (images, délais, couleurs). Les OLED sont monochromes (blanc sur noir) ; un TFT utilise les couleurs du clip. La mise en page exacte de l'écran
// (affiche centrée, marges) n'est pas rejouée : la vignette montre l'animation, pas le cadre de l'écran.
import { useEffect, useRef, useState } from "react";
import { CLIP, clipPixel, decodeClip, type DecodedClip } from "@/lib/bench/clip";
import { rgb565ToHex } from "@/lib/anim/seedClip";

const clipCache = new Map<string, Promise<DecodedClip | null>>();
function loadClip(hash: string): Promise<DecodedClip | null> {
  let p = clipCache.get(hash);
  if (!p) {
    p = fetch(`/api/block-clip?hash=${encodeURIComponent(hash)}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? decodeClip(new Uint8Array(b)) : null))
      .catch(() => null);
    clipCache.set(hash, p);
    p.then((v) => { if (!v) clipCache.delete(hash); });
  }
  return p;
}

const MONO_SCREENS = new Set(["oled096", "oled096aux"]);
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export function AnimLoop({ hash, screen, box }: { hash: string; screen: string; box: { w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | null = null, visible = false, clip: DecodedClip | null = null, i = 0;
    const canvas = ref.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = CLIP.W; canvas.height = CLIP.H;
    const img = ctx.createImageData(CLIP.W, CLIP.H);
    const mono = MONO_SCREENS.has(screen);
    const draw = () => {
      if (!clip) return;
      const [fr, fg, fb] = mono ? [255, 255, 255] : rgb(rgb565ToHex(clip.fg)), [br, bg, bb] = mono ? [0, 0, 0] : rgb(rgb565ToHex(clip.bg));
      const f = clip.frames[i];
      for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) {
        const o = (y * CLIP.W + x) * 4, on = clipPixel(f, x, y) === 1;
        img.data[o] = on ? fr : br; img.data[o + 1] = on ? fg : bg; img.data[o + 2] = on ? fb : bb; img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    const tick = () => {
      timer = null;
      if (!alive || !clip) return;
      if (!visible || document.hidden) return;   // pas de calcul hors de l'écran ni onglet caché ; la reprise relance la boucle
      draw();
      const d = Math.max(40, clip.delaysMs[i] ?? 100);
      i = (i + 1) % clip.frames.length;
      timer = setTimeout(tick, d);
    };
    const resume = () => { if (!timer && alive && clip && visible && !document.hidden) tick(); };
    loadClip(hash).then((c) => { if (!alive) return; if (!c) { setState("missing"); return; } clip = c; setState("ok"); resume(); });
    const target = wrapRef.current;
    const obs = target && "IntersectionObserver" in window ? new IntersectionObserver((e) => { visible = e.some((x) => x.isIntersecting); resume(); }, { rootMargin: "80px" }) : null;
    if (obs && target) obs.observe(target); else visible = true;
    document.addEventListener("visibilitychange", resume);
    return () => { alive = false; if (timer) clearTimeout(timer); obs?.disconnect(); document.removeEventListener("visibilitychange", resume); };
  }, [hash, screen]);

  const scale = Math.min(box.w / CLIP.W, box.h / CLIP.H);
  return (
    <div ref={wrapRef} className="ld-thumb" style={{ width: box.w, height: box.h }} title="Animation en boucle">
      <canvas ref={ref} style={{ width: Math.round(CLIP.W * scale), height: Math.round(CLIP.H * scale), imageRendering: "pixelated", display: state === "ok" ? "block" : "none" }} />
      {state !== "ok" && <span className="ld-muted">{state === "loading" ? "…" : "animation indisponible"}</span>}
    </div>
  );
}
