// app/gallery-anim/page.tsx — ancienne galerie « Animations » : les animations sont maintenant des BLOCS de la galerie principale
// (même consensus qu'un dessin). On garde l'adresse pour les anciens liens.

import { redirect } from "next/navigation";

export default function GalleryAnimPage() {
  redirect("/gallery?type=animation");
}
