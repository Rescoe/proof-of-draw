// app/api/blocks-ana/route.ts
// Galerie des dessins d'agent IA : UNE entrée par œuvre (les blocs de la même
// œuvre — un par type d'écran — sont regroupés, voir lib/anaChain.ts), avec
// recherche texte + pagination. Seul l'écran d'aperçu de chaque œuvre de la page
// est chargé avec son image ; le détail complet (tous les écrans) est servi par
// /api/blocks-ana/work.

import { NextRequest, NextResponse } from "next/server";
import { getRecentAnaWorks, attachAnaPreviews, type AnaWork } from "@/lib/anaChain";
import type { BlockImagePayload } from "@/lib/chain";

function matchesQuery(work: AnaWork, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    (work.title ?? "").toLowerCase().includes(ql) ||
    work.agentName.toLowerCase().includes(ql) ||
    (work.meta?.cartelText ?? "").toLowerCase().includes(ql) ||
    String(work.agentTokenId) === q.trim().replace(/^#/, "") ||
    work.screens.some((s) => s.blockHash.toLowerCase().startsWith(ql) || String(s.blockIndex) === q.trim())
  );
}

export type AnaGalleryWork = Omit<AnaWork, "screens"> & {
  screens: { screen: string; blockHash: string; blockIndex: number }[];
  previewPayload: BlockImagePayload | null;
};

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const q      = url.searchParams.get("q")?.trim() ?? "";
  const screen = url.searchParams.get("screen")?.trim() ?? "";
  const page   = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));

  let works = await getRecentAnaWorks(); // déjà triées, plus récentes d'abord
  if (q)      works = works.filter((w) => matchesQuery(w, q));
  if (screen) works = works.filter((w) => w.screens.some((s) => s.screen === screen));

  const total    = works.length;
  const pages    = Math.ceil(total / limit) || 1;
  const safePage = Math.min(page, pages);
  const paged    = await attachAnaPreviews(works.slice((safePage - 1) * limit, safePage * limit));

  const out: AnaGalleryWork[] = paged.map((w) => {
    const preview = w.screens.find((s) => s.screen === w.previewScreen);
    return {
      ...w,
      // Le manifeste scene-v1 (≤ 4 Ko) n'est servi que par /api/blocks-ana/work : jamais ×N dans la liste.
      meta: w.meta?.scene ? { ...w.meta, scene: { ...w.meta.scene, manifest: undefined } } : w.meta,
      screens: w.screens.map(({ screen: sc, blockHash, blockIndex }) => ({ screen: sc, blockHash, blockIndex })),
      previewPayload: preview?.imagePayload ?? null,
    };
  });

  return NextResponse.json(
    { works: out, total, page: safePage, limit, pages },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60" } },
  );
}
