// app/draw/page.tsx — « Créer » : page de choix de l'écran. Le studio (app/draw/[device]/[screen]) n'est pas modifié.
import type { Metadata } from "next";
import { DrawChoice } from "./DrawChoice";

export const metadata: Metadata = {
  title: "Créer | Proof-of-Draw",
  description: "Choisis l'écran sur lequel dessiner : un de tes écrans, ou un écran partagé par un autre artiste.",
};

export default function DrawIndexPage() {
  return <DrawChoice />;
}
