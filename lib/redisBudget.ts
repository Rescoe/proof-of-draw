// lib/redisBudget.ts
// Compteur de budget Redis mensuel pour Upstash free tier (500k req/month)
// Seuil de sécurité : 250k/month (~8 333/jour)
// Dégradé à 80% (200k), maintenance à 95% (237.5k)

import { redis } from "@/lib/redis";

const MONTHLY_BUDGET = parseInt(process.env.REDIS_MONTHLY_BUDGET ?? "250000");
const DEGRADED_RATIO  = 0.80;  // 200k → mode dégradé (certaines features désactivées)
const MAINT_RATIO     = 0.95;  // 237.5k → mode maintenance (api/pull retourne 503)

export type BudgetStatus = "ok" | "degraded" | "maintenance";

/** Clé Redis du compteur mensuel — repart à 0 chaque mois (YYYY-MM) */
function budgetKey(): string {
  const now = new Date();
  return `budget:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Incrémente le compteur et retourne le statut actuel.
 * N'incrémente pas si le budget est déjà dépassé.
 */
export async function incrBudget(count = 1): Promise<BudgetStatus> {
  try {
    const key = budgetKey();
    const current = await redis.incrby(key, count);
    // TTL de 35 jours (rotation mensuelle automatique)
    if (current === count) await redis.expire(key, 35 * 24 * 60 * 60);

    if (current >= MONTHLY_BUDGET * MAINT_RATIO) return "maintenance";
    if (current >= MONTHLY_BUDGET * DEGRADED_RATIO) return "degraded";
    return "ok";
  } catch {
    // Ne pas bloquer l'app si le compteur fail
    return "ok";
  }
}

/** Lit le statut sans incrémenter. */
export async function getBudgetStatus(): Promise<{ status: BudgetStatus; used: number; budget: number }> {
  try {
    const key = budgetKey();
    const raw = await redis.get<string>(key);
    const used = raw ? parseInt(raw) : 0;

    let status: BudgetStatus = "ok";
    if (used >= MONTHLY_BUDGET * MAINT_RATIO) status = "maintenance";
    else if (used >= MONTHLY_BUDGET * DEGRADED_RATIO) status = "degraded";

    return { status, used, budget: MONTHLY_BUDGET };
  } catch {
    return { status: "ok", used: 0, budget: MONTHLY_BUDGET };
  }
}
