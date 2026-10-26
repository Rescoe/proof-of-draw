// app/circles/page.tsx — Cercles privés d'artistes (MVP : invitations avec consentement, droits côté serveur, messages texte bornés ; aucun média). Docs : docs/LOT_UX_4_CERCLES_2026_10_26.md
import type { Metadata } from "next";
import { CirclesClient } from "./CirclesClient";

export const metadata: Metadata = {
  title: "Cercles privés | Proof-of-Draw",
  description: "Des cercles restreints entre artistes : on y entre sur invitation acceptée, rien n'y est public.",
};

export default function CirclesPage() {
  return <CirclesClient />;
}
