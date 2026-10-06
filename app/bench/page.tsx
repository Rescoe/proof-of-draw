// app/bench/page.tsx — le banc d'essai d'animation a été retiré (06/10/2026) : l'atelier unique d'animation est /animer. Cette page ne sert que de redirection pour les anciens liens.
import { redirect } from "next/navigation";

export default function BenchPage() {
  redirect("/animer");
}
