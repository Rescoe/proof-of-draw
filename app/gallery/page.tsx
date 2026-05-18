// app/gallery/page.tsx — Block explorer (Server wrapper)
import type { Metadata } from "next";
import { GalleryClient } from "./GalleryClient";

export const metadata: Metadata = {
  title: "Galerie · Proof-of-Draw",
  description: "Explorer tous les blocs minés sur le réseau Proof-of-Draw",
};

export default function GalleryPage() {
  return <GalleryClient />;
}
