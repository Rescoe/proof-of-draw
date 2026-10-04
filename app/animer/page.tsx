"use client";

// app/animer/page.tsx — Atelier d'animation : l'éditeur du banc d'essai (128×64 noir et blanc, qualité OLED), sans les outils de mesure.
// On y arrive par le bouton « 🎞 Animer » de Mon profil (/animer?device=…&screen=…), seulement sur les écrans qui jouent un clip.
// « Soumettre au réseau » = POST /api/draw { anim } : même consensus qu'un dessin ; l'animation devient un bloc de la galerie.
// Chargé côté navigateur uniquement : il lit le brouillon local (localStorage, clé distincte de celle du banc d'essai).

import dynamic from "next/dynamic";

const BenchClient = dynamic(() => import("../bench/BenchClient"), { ssr: false, loading: () => <p style={{ padding: "2rem", textAlign: "center", color: "var(--text3)" }}>Chargement de l&apos;atelier…</p> });

export default function AnimerPage() {
  return <BenchClient variant="studio" />;
}
