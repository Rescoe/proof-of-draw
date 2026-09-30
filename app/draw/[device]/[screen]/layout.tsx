// app/draw/[device]/[screen]/layout.tsx
// Déclare le viewport de l'éditeur : `viewport-fit=cover` (zones sûres iPhone : la barre du
// bas ne colle plus à la barre d'accueil) et pas de zoom de page involontaire pendant le dessin.
// Portée limitée à cette route : le reste du site est inchangé.

import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
  themeColor: "#12121c",
};

export default function DrawLayout({ children }: { children: React.ReactNode }) {
  return children;
}
