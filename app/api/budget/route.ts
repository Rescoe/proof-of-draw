// app/api/budget/route.ts
// Retourne l'état du budget Redis mensuel.
// Utilisé pour le monitoring et pour afficher un bandeau d'alerte si nécessaire.

import { NextRequest, NextResponse } from "next/server";
import { getBudgetStatus } from "@/lib/redisBudget";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  const budget = await getBudgetStatus();
  return NextResponse.json(budget);
}
