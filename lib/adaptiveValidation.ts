// lib/adaptiveValidation.ts
// Seuils de validation adaptatifs par écran — inspiré du difficulty adjustment de Bitcoin.
//
// Principe :
//   seuil_effectif = max(plancher_screen, moyenne_N_derniers_blocs × ADAPT_FACTOR)
//
//   • ADAPT_FACTOR = 0.45 → on exige 45% de la qualité moyenne historique.
//     Très permissif au départ (peu de blocs), se resserre naturellement.
//   • Les seuils ne descendent JAMAIS sous les planchers par-écran, même si
//     les blocs récents sont mauvais (plancher = garde-fou absolu).
//   • En dessous de MIN_BLOCKS_FOR_ADAPTATION blocs disponibles → plancher seul.
//
// Métriques utilisées (proviennent de ReplayAnalysis dans candidate.podGeometry) :
//   sessionDurationMs, strokeCount, gridCoverage, (complexityScore depuis Block.score)
//
// Capacité expressive par écran :
//   OLED 0.96"   → 128×64 = 8 192 px, 2 couleurs → plancher bas
//   E-ink 2.7"   → 264×176 = 46 464 px, 2 couleurs → plancher moyen
//   E-ink 2.9"   → 296×128 = 37 888 px, 3 couleurs → plancher moyen
//   TFT 1.8"     → 128×160 = 20 480 px, 65 536 couleurs → plancher plus haut

import { redis } from "@/lib/redis";
import type { ReplayAnalysis } from "@/lib/crypto";

// ─── Planchers absolus par écran ──────────────────────────────────────────────
// Ces valeurs ne peuvent jamais être abaissées, même si l'historique est mauvais.

export interface ScreenFloor {
  durationMs:  number;   // durée minimale de session
  strokes:     number;   // nb de strokes minimum
  coverage:    number;   // grid coverage minimum [0,1]
  complexity:  number;   // score de complexité visuelle minimum [0,1]
}

const SCREEN_FLOORS: Record<string, ScreenFloor> = {
  oled096: {
    durationMs: 8_000,  // 8s — petit canvas, moins de temps nécessaire
    strokes:    2,
    coverage:   0.03,   // 3% d'une grille 8×8 sur 128×64 = ~2 cellules
    complexity: 0.02,
  },
  eink27bw: {
    durationMs: 12_000,
    strokes:    2,
    coverage:   0.04,
    complexity: 0.02,
  },
  eink29bwr: {
    durationMs: 12_000,
    strokes:    2,
    coverage:   0.04,
    complexity: 0.02,
  },
  tft18: {
    durationMs: 15_000, // 15s — plein de possibilités couleur
    strokes:    3,
    coverage:   0.05,
    complexity: 0.03,
  },
  _default: {
    durationMs: 10_000,
    strokes:    2,
    coverage:   0.03,
    complexity: 0.02,
  },
};

// ─── Paramètres d'adaptation ──────────────────────────────────────────────────

/** Facteur appliqué à la moyenne historique : 0.45 = très permissif au départ */
const ADAPT_FACTOR           = parseFloat(process.env.ADAPT_FACTOR           ?? "0.45");

/** Nombre de blocs historiques à regarder pour calculer la moyenne */
const HISTORY_WINDOW         = parseInt(process.env.ADAPT_HISTORY_WINDOW     ?? "10");

/** Nombre minimal de blocs avec podGeometry pour activer l'adaptation */
const MIN_BLOCKS_FOR_ADAPT   = parseInt(process.env.ADAPT_MIN_BLOCKS         ?? "5");

/** TTL du cache des seuils adaptatifs (seconds) — on ne recalcule pas à chaque soumission */
const THRESHOLDS_CACHE_TTL   = parseInt(process.env.ADAPT_CACHE_TTL          ?? "120");

// ─── Seuils effectifs (résultat de l'adaptation) ──────────────────────────────

export interface EffectiveThresholds extends ScreenFloor {
  screenId:     string;
  adaptedFrom:  number;  // nb de blocs utilisés pour le calcul (0 = plancher seul)
  avgComplexity: number; // complexité moyenne historique (pour info)
  mode:         "floor_only" | "adaptive";
}

// ─── Lecture des blocs récents avec podGeometry ───────────────────────────────

interface BlockGeometrySample {
  durationMs:  number;
  strokes:     number;
  coverage:    number;
  complexity:  number;
}

async function fetchRecentGeometry(screenId: string): Promise<BlockGeometrySample[]> {
  // chain:recent contient les derniers hashes (tous écrans confondus)
  // On filtre ensuite sur poolScreen + podGeometry disponible
  let hashes: string[] = [];
  try {
    hashes = (await redis.lrange("chain:recent", 0, HISTORY_WINDOW * 3 - 1)) as string[];
  } catch {
    return [];
  }

  if (!hashes || hashes.length === 0) return [];

  const samples: BlockGeometrySample[] = [];

  for (const hash of hashes) {
    if (samples.length >= HISTORY_WINDOW) break;
    try {
      const raw = await redis.get(`chain:block:${hash}`);
      if (!raw) continue;
      const block = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (block.poolScreen !== screenId) continue;
      if (!block.podGeometry) continue;

      const g = block.podGeometry as ReplayAnalysis;
      samples.push({
        durationMs: g.sessionDurationMs,
        strokes:    g.strokeCount,
        coverage:   g.gridCoverage,
        complexity: block.score ?? 0,
      });
    } catch {
      // Bloc corrompu ou absent — on ignore
    }
  }

  return samples;
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────

/**
 * Retourne les seuils effectifs pour un écran donné.
 * Utilise un cache Redis court pour éviter N lectures par soumission.
 */
export async function getEffectiveThresholds(screenId: string): Promise<EffectiveThresholds> {
  const floor = SCREEN_FLOORS[screenId] ?? SCREEN_FLOORS._default;
  const cacheKey = `adapt:thresholds:${screenId}`;

  // ── Lecture cache ──────────────────────────────────────────────────────────
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return typeof cached === "string" ? JSON.parse(cached) : (cached as EffectiveThresholds);
    }
  } catch { /* cache miss silencieux */ }

  // ── Calcul ────────────────────────────────────────────────────────────────
  const samples = await fetchRecentGeometry(screenId);

  let thresholds: EffectiveThresholds;

  if (samples.length < MIN_BLOCKS_FOR_ADAPT) {
    // Pas assez d'historique → plancher seul
    thresholds = {
      ...floor,
      screenId,
      adaptedFrom:  samples.length,
      avgComplexity: samples.length > 0
        ? samples.reduce((s, b) => s + b.complexity, 0) / samples.length
        : 0,
      mode: "floor_only",
    };
  } else {
    // Adaptation : moyenne × ADAPT_FACTOR, jamais sous le plancher
    const n   = samples.length;
    const avg = {
      durationMs: samples.reduce((s, b) => s + b.durationMs, 0) / n,
      strokes:    samples.reduce((s, b) => s + b.strokes,    0) / n,
      coverage:   samples.reduce((s, b) => s + b.coverage,   0) / n,
      complexity: samples.reduce((s, b) => s + b.complexity, 0) / n,
    };

    thresholds = {
      screenId,
      durationMs:   Math.max(floor.durationMs,  avg.durationMs  * ADAPT_FACTOR),
      strokes:      Math.max(floor.strokes,      Math.ceil(avg.strokes   * ADAPT_FACTOR)),
      coverage:     Math.max(floor.coverage,     avg.coverage    * ADAPT_FACTOR),
      complexity:   Math.max(floor.complexity,   avg.complexity  * ADAPT_FACTOR),
      adaptedFrom:  n,
      avgComplexity: avg.complexity,
      mode:         "adaptive",
    };
  }

  // ── Mise en cache ──────────────────────────────────────────────────────────
  try {
    await redis.set(cacheKey, JSON.stringify(thresholds), { ex: THRESHOLDS_CACHE_TTL });
  } catch { /* écriture cache silencieuse */ }

  return thresholds;
}

/**
 * Invalide le cache des seuils adaptatifs pour un écran.
 * À appeler après chaque bloc miné pour cet écran.
 */
export async function invalidateThresholdsCache(screenId: string): Promise<void> {
  try {
    await redis.del(`adapt:thresholds:${screenId}`);
  } catch { /* silencieux */ }
}
