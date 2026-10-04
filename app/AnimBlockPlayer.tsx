"use client";

// app/AnimBlockPlayer.tsx — lecteur d'un bloc d'ANIMATION (galerie, détail d'un bloc).
// Récupère le clip stocké avec le bloc (/api/block-anim), le rejoue en boucle avec ses délais et ses couleurs, et permet de VÉRIFIER image
// par image : le navigateur recalcule l'empreinte SHA-256 de chaque image du clip et la compare à celle enregistrée dans le bloc.
// (La racine de ces empreintes est ce que les validateurs ont signé : lib/anim/block.ts.)

import { useEffect, useRef, useState } from "react";
import { CLIP, clipPixel, decodeClip, type DecodedClip } from "@/lib/bench/clip";
import type { AnimBlockDoc } from "@/lib/anim/block";

const rgb565ToHex = (v: number) => {
  const r = Math.round((((v >> 11) & 31) * 255) / 31), g = Math.round((((v >> 5) & 63) * 255) / 63), b = Math.round(((v & 31) * 255) / 31);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

const btn: React.CSSProperties = { padding: "0.3rem 0.65rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: "0.74rem", cursor: "pointer" };

export function AnimBlockPlayer({ blockHash }: { blockHash: string }) {
  const [doc, setDoc] = useState<AnimBlockDoc | null>(null);
  const [clip, setClip] = useState<DecodedClip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [checked, setChecked] = useState<boolean[] | null>(null);
  const [showFrames, setShowFrames] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    setDoc(null); setClip(null); setError(null); setChecked(null); setI(0);
    fetch(`/api/block-anim?hash=${blockHash}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("animation introuvable"))))
      .then((d: { anim: AnimBlockDoc }) => {
        if (!alive) return;
        setDoc(d.anim);
        setClip(decodeClip(Uint8Array.from(atob(d.anim.clip), (c) => c.charCodeAt(0))));
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "animation illisible"); });
    return () => { alive = false; };
  }, [blockHash]);

  useEffect(() => {
    const cv = ref.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx || !clip) return;
    ctx.fillStyle = rgb565ToHex(clip.bg); ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = rgb565ToHex(clip.fg);
    const f = clip.frames[i % clip.frames.length];
    for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) if (clipPixel(f, x, y)) ctx.fillRect(x, y, 1, 1);
  }, [clip, i]);

  // Lecture en boucle, au rythme du clip ; l'image ne change pas tant que l'onglet est caché (aucun travail inutile).
  useEffect(() => {
    if (!clip || clip.frames.length < 2) return;
    const t = setTimeout(() => { if (!document.hidden) setI((k) => (k + 1) % clip.frames.length); else setI((k) => k + clip.frames.length); }, Math.max(20, clip.delaysMs[i % clip.frames.length]));
    return () => clearTimeout(t);
  }, [clip, i]);

  async function verify() {
    if (!clip || !doc) return;
    const sums = await Promise.all(clip.frames.map(async (f) => hex(await crypto.subtle.digest("SHA-256", f as BufferSource))));
    setChecked(sums.map((h, k) => h === doc.frameHashes[k]));
    setShowFrames(true);
  }

  if (error) return <p style={{ fontSize: "0.78rem", color: "var(--text3)" }}>Animation indisponible ({error}).</p>;
  if (!clip || !doc) return <p style={{ fontSize: "0.78rem", color: "var(--text3)" }}>Chargement de l&apos;animation…</p>;

  const n = clip.frames.length;
  const allOk = checked?.every(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%" }}>
      <canvas ref={ref} width={CLIP.W} height={CLIP.H} aria-label="Animation du bloc"
        style={{ width: "100%", maxWidth: 384, aspectRatio: "2 / 1", imageRendering: "pixelated", borderRadius: 8, border: "1px solid var(--border)" }} />
      <div style={{ fontSize: "0.72rem", color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>
        🎞 {n} images · image {(i % n) + 1} · {clip.loops === 0 ? "en boucle" : `${clip.loops} boucle(s)`}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" style={btn} onClick={verify} title="Recalcule l'empreinte SHA-256 de chaque image et la compare à celle du bloc">🔎 Vérifier image par image</button>
        <button type="button" style={btn} onClick={() => setShowFrames((v) => !v)}>{showFrames ? "Masquer" : "Voir"} les empreintes</button>
      </div>
      {checked && <div role="status" style={{ fontSize: "0.76rem", color: allOk ? "#4ade80" : "#f87171" }}>{allOk ? `✓ ${checked.length} images conformes aux empreintes du bloc` : "✗ une image ne correspond pas à son empreinte"}</div>}
      {showFrames && (
        <div style={{ width: "100%", maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: "0.4rem 0.6rem", fontFamily: "JetBrains Mono, monospace", fontSize: "0.68rem", lineHeight: 1.6 }}>
          {doc.frameHashes.map((h, k) => (
            <div key={k} style={{ display: "flex", gap: 10, color: k === i % n ? "var(--accent)" : "var(--text2)" }}>
              <span style={{ width: 22, textAlign: "right" }}>{k + 1}</span>
              <span>{h.slice(0, 16)}…</span>
              <span style={{ marginLeft: "auto" }}>score {doc.frameScores[k].toFixed(3)}</span>
              {checked && <span style={{ color: checked[k] ? "#4ade80" : "#f87171" }}>{checked[k] ? "✓" : "✗"}</span>}
            </div>
          ))}
          <div style={{ marginTop: 6, color: "var(--text3)", overflowWrap: "anywhere" }}>racine {doc.root}</div>
        </div>
      )}
    </div>
  );
}
