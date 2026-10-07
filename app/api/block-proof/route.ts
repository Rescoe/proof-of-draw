// app/api/block-proof/route.ts
// GET /api/block-proof?hash={blockHash} — le bloc (champs IMMUABLES seulement) et ses REÇUS signés, pour qu'un tiers le VÉRIFIE sans faire confiance au serveur (lib/podVerify.ts,
// scripts/verify-block.ts). Lot 3 du plan de travail.
//
// Réponse : { block: ProofBlock, receipts: ReceiptsDoc | null }  (receipts = null pour un bloc au format v1 : les votes signés n'y ont pas été conservés).
// Ne contient AUCUN champ modifiable (propriété du bloc, observation…) : la réponse est donc immuable par hash → cache CDN ; le coût Redis ne dépend pas du nombre de lecteurs.
// COÛT REDIS : 1 MGET (bloc + reçus) à la première requête de chaque bloc, ensuite le CDN. Aucun polling, aucun SCAN.

import { NextRequest, NextResponse } from "next/server";
import { getBlockProofData } from "@/lib/chain";
import { toProofBlock } from "@/lib/podVerify";

export const dynamic = "force-dynamic";
const HEX64 = /^[0-9a-f]{64}$/;

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash") ?? "";
  if (!HEX64.test(hash)) return NextResponse.json({ error: "hash invalide" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const { block, receipts } = await getBlockProofData(hash);
  if (!block) return NextResponse.json({ error: "bloc introuvable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ block: toProofBlock(block), receipts }, { headers: { "Cache-Control": "public, s-maxage=86400, max-age=3600, immutable" } });
}
