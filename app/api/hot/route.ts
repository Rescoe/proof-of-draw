// app/api/hot/route.ts — POST : « quelqu'un s'apprête à dessiner » (ouverture de l'atelier). Réveille le réseau : les écrans au repos passent de 15 à 5 min de pull
// pendant 30 min. 1 commande Redis par appel ; le client n'appelle qu'une fois par 10 min et par onglet (lib/wakeNetwork.ts).

import { NextResponse } from "next/server";
import { markHot } from "@/lib/hot";

export async function POST() {
  await markHot();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
