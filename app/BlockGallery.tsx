// app/BlockGallery.tsx
// Galerie des blocs minés récemment — Server Component avec images persistantes.
// Les images sont stockées dans chain:image:{hash} sans TTL (permanentes).
// Axe 2 : affiche workTitle et "drawArtist sur ESP de owner" si applicable.
// Axe 5 : cartes cliquables ouvrant BlockDetail (client-side).

import { getRecentBlocksCached, BlockWithImage } from "@/lib/chain";
import { BlockGalleryClient } from "./BlockGalleryClient";

export async function BlockGallery() {
  let blocks: BlockWithImage[] = [];
  try {
    blocks = await getRecentBlocksCached();
  } catch {
    return null;
  }

  if (blocks.length === 0) return null;

  // On sérialise les blocs (Server → Client)
  return <BlockGalleryClient blocks={blocks} />;
}
