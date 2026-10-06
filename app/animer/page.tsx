"use client";

// app/animer/page.tsx — Atelier d'animation (refonte du 06/10/2026) : éditeur plein écran en 3 modes (Essentiel · Studio · Pro), 128×64.
// On y arrive par le bouton « 🎞 Animer » de Mon profil (/animer?device=…&screen=…). « Soumettre au réseau » = POST /api/draw { anim } : même consensus qu'un dessin.
// Chargé côté navigateur uniquement : il lit le brouillon local (localStorage). Voir docs/ATELIER_ANIMATION.md.

import dynamic from "next/dynamic";

const AnimStudio = dynamic(() => import("./AnimStudio"), { ssr: false, loading: () => <p style={{ padding: "2rem", textAlign: "center", color: "var(--text3)" }}>Chargement de l&apos;atelier…</p> });

export default function AnimerPage() {
  return <AnimStudio />;
}
