"use client";

// app/gallery-anim/AnimGalleryClient.tsx — galerie des animations faites à la main (banc d'essai du TFT 2.8" tactile).
// Chaque carte décode son clip PBC1 (même décodeur de référence que les tests) et le rejoue en boucle avec ses délais.

import { useEffect, useRef, useState } from "react";
import { CLIP, clipPixel, decodeClip, type DecodedClip } from "@/lib/bench/clip";
import { encodeGif } from "@/lib/bench/gif";
import type { AnimItem } from "@/lib/anim/store";

const PAGE = 24;
const DRAFT_KEY = "pod-bench-draft-v1";   // même brouillon que /bench

const rgb565ToHex = (v: number) => {
  const r = Math.round((((v >> 11) & 31) * 255) / 31), g = Math.round((((v >> 5) & 63) * 255) / 63), b = Math.round(((v & 31) * 255) / 31);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};
const hexToRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };

function safeDecode(item: AnimItem): DecodedClip | null {
  try { return decodeClip(new Uint8Array(Uint8Array.from(atob(item.clip), (c) => c.charCodeAt(0)))); } catch { return null; }
}

function Player({ clip }: { clip: DecodedClip }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [i, setI] = useState(0);
  const fg = rgb565ToHex(clip.fg), bg = rgb565ToHex(clip.bg);
  useEffect(() => {
    const cv = ref.current; const ctx = cv?.getContext("2d"); if (!cv || !ctx) return;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = fg;
    const f = clip.frames[i % clip.frames.length];
    for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) if (clipPixel(f, x, y)) ctx.fillRect(x, y, 1, 1);
  }, [clip, i, fg, bg]);
  useEffect(() => {
    if (clip.frames.length < 2) return;
    const t = setTimeout(() => setI((k) => (k + 1) % clip.frames.length), Math.max(20, clip.delaysMs[i % clip.frames.length]));
    return () => clearTimeout(t);
  }, [clip, i]);
  return <canvas ref={ref} width={CLIP.W} height={CLIP.H} aria-label="Animation" style={{ width: "100%", aspectRatio: "2 / 1", imageRendering: "pixelated", borderRadius: 8, display: "block", border: "1px solid var(--border)" }} />;
}

const btn: React.CSSProperties = { padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: "0.76rem", cursor: "pointer" };

function Card({ item }: { item: AnimItem }) {
  const clip = safeDecode(item);
  if (!clip) return null;
  const fg = rgb565ToHex(item.fg), bg = rgb565ToHex(item.bg);
  const name = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "animation";
  const gif = () => {
    const url = URL.createObjectURL(new Blob([encodeGif({ frames: clip.frames, delaysMs: clip.delaysMs, fg: hexToRgb(fg), bg: hexToRgb(bg), scale: 4 }) as BlobPart], { type: "image/gif" }));
    const a = document.createElement("a"); a.href = url; a.download = `${name}.gif`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const openInBench = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ frames: clip.frames.map(toB64), delays: clip.delaysMs, loops: item.loops, fg, bg, handmade: true, title: item.title }));
    } catch { /* stockage indisponible */ }
    window.location.href = "/bench";
  };
  return (
    <div style={{ padding: "0.8rem", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg2)" }}>
      <Player clip={clip} />
      <div style={{ fontWeight: 700, fontSize: "0.92rem", marginTop: 8, overflowWrap: "anywhere" }}>{item.title}</div>
      <div style={{ fontSize: "0.74rem", color: "var(--text3)", marginTop: 2 }}>
        {item.author} · {item.frames} images · {item.bytes} o · {new Date(item.createdAt).toLocaleDateString()}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" style={btn} onClick={gif}>⬇ GIF</button>
        <button type="button" style={btn} onClick={openInBench}>🧪 Ouvrir dans le banc d&apos;essai</button>
      </div>
    </div>
  );
}

export default function AnimGalleryClient() {
  const [items, setItems] = useState<AnimItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/anim/list?limit=${PAGE}&offset=0`)
      .then((r) => r.json())
      .then((d: { items?: AnimItem[]; total?: number }) => { if (alive) { setItems(d.items ?? []); setTotal(d.total ?? 0); } })
      .catch(() => { if (alive) { setItems([]); setError(true); } });
    return () => { alive = false; };
  }, []);

  const more = async () => {
    if (!items) return;
    setLoading(true);
    try {
      const d = await fetch(`/api/anim/list?limit=${PAGE}&offset=${items.length}`).then((r) => r.json());
      setItems([...items, ...(d.items ?? [])]); setTotal(d.total ?? total);
    } catch { setError(true); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "1.5rem 1rem 3rem" }}>
      <h1 style={{ fontSize: "1.3rem", fontWeight: 800, margin: "0 0 0.3rem" }}>🎞 Animations</h1>
      <p style={{ fontSize: "0.82rem", color: "var(--text3)", margin: "0 0 1.2rem", lineHeight: 1.5 }}>
        Les animations dessinées à la main dans le <a href="/bench" style={{ color: "var(--accent)" }}>banc d&apos;essai</a> (TFT 2.8&quot; tactile). Les modèles de test (balle, vague, bruit…) n&apos;y sont jamais enregistrés.
      </p>
      {items === null ? <p style={{ color: "var(--text3)" }}>Chargement…</p> : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text3)" }}>
          {error ? "Impossible de charger la galerie." : "Aucune animation pour l'instant. Dessinez-en une dans le banc d'essai."}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
            {items.map((it) => <Card key={it.id} item={it} />)}
          </div>
          {items.length < total && (
            <div style={{ textAlign: "center", marginTop: "1.2rem" }}>
              <button type="button" style={btn} onClick={more} disabled={loading}>{loading ? "Chargement…" : `Voir plus (${total - items.length})`}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
