// app/draw-lab/page.tsx — bac à sable de l'éditeur de dessin (DÉVELOPPEMENT UNIQUEMENT)
//
// Monte Pod Studio sans appareil ni serveur : l'envoi est simulé, rien n'est écrit dans Redis.
// Sert à vérifier l'interface (tailles d'écran, gestes, envoi) sans toucher aux données réelles.
//   /draw-lab?screen=oled096|eink27bw|eink29bwr|tft18
// En production la route répond 404.

import { notFound } from "next/navigation";
import LabClient from "./LabClient";

export const dynamic = "force-dynamic";

export default function DrawLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabClient />;
}
