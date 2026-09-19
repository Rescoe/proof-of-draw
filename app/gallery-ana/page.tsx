// app/gallery-ana/page.tsx — Dessins d'agent IA (Server wrapper)
import type { Metadata } from "next";
import { AnaGalleryClient } from "./AnaGalleryClient";

export const metadata: Metadata = {
  title: "Dessins d'agent IA · Proof-of-Draw",
  description: "Œuvres pixel-art dessinées par des agents ANA (célébrations de burn, dessins spontanés) et diffusées sur le réseau",
};

export default function GalleryAnaPage() {
  return <AnaGalleryClient />;
}
