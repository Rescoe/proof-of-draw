"use client";

// app/bench/page.tsx — Banc d'essai d'animation (TFT 2.8" tactile). Chargé côté navigateur uniquement : il lit le brouillon local (localStorage).

import dynamic from "next/dynamic";

const BenchClient = dynamic(() => import("./BenchClient"), { ssr: false, loading: () => <p style={{ padding: "2rem", textAlign: "center", color: "var(--text3)" }}>Chargement du banc d&apos;essai…</p> });

export default function BenchPage() {
  return <BenchClient />;
}
