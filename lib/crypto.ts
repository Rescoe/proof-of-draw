// lib/crypto.ts
// Métriques de complexité visuelle pour la validation Proof-of-Draw
// Tout en pur TypeScript, zéro dépendance native — compatible Vercel Edge.

import type { ReplayEvent, PodEnrichment } from "@/lib/types/actions";
//
// Ces trois métriques sont calculées côté serveur pour :
//   1. Vérification croisée des résultats ESP (anti-triche)
//   2. Calcul du score final en cas de divergence
//
// Les ESP calculent les mêmes métriques sur les buffers bruts (uint8),
// le serveur les recalcule depuis le base64 pour comparaison.

// ─── Décodage buffer e-ink ────────────────────────────────────────────────────

/**
 * Décode un buffer base64 e-ink en tableau de pixels (0=blanc, 1=noir).
 * Format e-ink : MSB first, 1 bit par pixel, row-major.
 */
export function decodeEinkBuffer(b64: string, width: number, height: number): Uint8Array {
  const bytes  = Buffer.from(b64, "base64");
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx  = 7 - (i % 8);
    pixels[i]     = byteIdx < bytes.length ? (bytes[byteIdx] >> bitIdx) & 1 : 0;
  }
  return pixels;
}

/**
 * Merge les canaux noir + rouge d'un eink29bwr en un seul canal (OR logique).
 * Un pixel "actif" = noir OU rouge.
 */
export function mergeChannels(black: Uint8Array, red: Uint8Array): Uint8Array {
  const merged = new Uint8Array(black.length);
  for (let i = 0; i < merged.length; i++) {
    merged[i] = black[i] | red[i];
  }
  return merged;
}

// ─── Métrique 1 : Entropie de Shannon ────────────────────────────────────────
//
// Mesure la quantité d'information dans l'image.
// Pour un bitmap 1-bit : entropie max = 1.0 (50/50 noir/blanc)
// Canvas blanc = 0.0, bruit aléatoire ≈ 1.0, dessin typique 0.3–0.8
//
// Formule : H = -Σ p(x) × log2(p(x))

export function shannonEntropy(pixels: Uint8Array): number {
  let ones = 0;
  for (let i = 0; i < pixels.length; i++) ones += pixels[i];
  const zeros = pixels.length - ones;
  if (ones === 0 || zeros === 0) return 0;

  const p1 = ones  / pixels.length;
  const p0 = zeros / pixels.length;
  return -(p1 * Math.log2(p1) + p0 * Math.log2(p0));
}

// ─── Métrique 2 : Densité de transitions (bords/contours) ────────────────────
//
// Compte les changements de valeur entre pixels adjacents (horizontal + vertical).
// Normalisé par le nombre total d'adjacences possibles.
// Canvas uniforme → 0.0, pixelart détaillé → 0.3–0.6

export function transitionDensity(pixels: Uint8Array, width: number, height: number): number {
  let transitions = 0;
  const total = (width - 1) * height + width * (height - 1);

  // Horizontal
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      if (pixels[y * width + x] !== pixels[y * width + x + 1]) transitions++;
    }
  }
  // Vertical
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] !== pixels[(y + 1) * width + x]) transitions++;
    }
  }

  return total > 0 ? transitions / total : 0;
}

// ─── Métrique 3 : Ratio de compressibilité RLE ───────────────────────────────
//
// RLE (Run-Length Encoding) 1D sur les pixels.
// Un dessin complexe a beaucoup de runs courts → mauvaise compression → ratio élevé.
// Canvas blanc → ratio ≈ 0.003 (1 run pour tout le buffer)
// Dessin dense → ratio proche de 1.0
//
// Formule : ratio = nombre_de_runs / nombre_total_de_pixels
// Normalisé en [0,1], puis sqrt pour linéariser la distribution.

export function rleComplexity(pixels: Uint8Array): number {
  if (pixels.length === 0) return 0;
  let runs = 1;
  for (let i = 1; i < pixels.length; i++) {
    if (pixels[i] !== pixels[i - 1]) runs++;
  }
  // sqrt pour linéariser : un dessin avec 10% de transitions
  // ne doit pas avoir 1/10 du score d'un dessin à 100%
  return Math.sqrt(runs / pixels.length);
}

// ─── Score de complexité composite ───────────────────────────────────────────
//
// Combinaison pondérée des trois métriques.
// Poids empiriques ajustés pour :
//   - Favoriser les dessins avec du contenu (entropie)
//   - Valoriser le détail (transitions)
//   - Pénaliser les patterns répétitifs (RLE)
//
// Score final ∈ [0, 1]
// < 0.05 : spam probable (canvas quasi-vide)
// 0.05–0.3 : dessin simple/enfantin → valide
// 0.3–0.7 : dessin intermédiaire
// > 0.7 : pixelart dense/complexe

export interface ComplexityMetrics {
  entropy:     number;  // [0, 1]
  transitions: number;  // [0, 1]
  rle:         number;  // [0, 1]
  score:       number;  // [0, 1] score composite
}

export function computeComplexity(pixels: Uint8Array, width: number, height: number): ComplexityMetrics {
  const entropy     = shannonEntropy(pixels);
  const transitions = transitionDensity(pixels, width, height);
  const rle         = rleComplexity(pixels);

  // Poids : entropie 40%, transitions 40%, RLE 20%
  const score = Math.min(1, entropy * 0.4 + transitions * 0.4 + rle * 0.2);

  return { entropy, transitions, rle, score };
}

// ─── Seuil de validation minimal ─────────────────────────────────────────────
//
// Un dessin est rejeté immédiatement (avant distribution aux ESP)
// si son score est inférieur à ce seuil.
// Seuil bas volontairement pour laisser passer les dessins "enfantins".

export const MIN_COMPLEXITY_SCORE = parseFloat(
  process.env.MIN_COMPLEXITY_SCORE ?? "0.03"
);

export function isComplexityValid(metrics: ComplexityMetrics): boolean {
  return metrics.score >= MIN_COMPLEXITY_SCORE;
}

// ─── Hash de bloc ─────────────────────────────────────────────────────────────
//
// Hash SHA-256 d'un bloc pour la chaîne légère.
// Input : JSON canonique du bloc (champs triés alphabétiquement).
// Output : hex string 64 chars.

export async function sha256Hex(data: string): Promise<string> {
  const buf    = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash canonique d'un dessin (payload base64).
 * Utilisé pour détecter les doublons et comme input du hash de bloc.
 */
export async function hashDrawing(
  screen: string,
  black?: string,
  red?: string,
  buffer?: string,
): Promise<string> {
  const canonical = JSON.stringify({ screen, black: black ?? "", red: red ?? "", buffer: buffer ?? "" });
  return sha256Hex(canonical);
}

// ─── Calcul du display_time ───────────────────────────────────────────────────
//
// Le temps d'affichage d'un dessin validé dépend de :
//   - Son score de complexité (plus complexe = affiché plus longtemps)
//   - Le hash du bloc précédent (déterminisme du réseau)
//
// Formule : display_time = BASE + (score × RANGE) + (hash_factor × JITTER)
// hash_factor : les 4 derniers hex du hash précédent → uint16 normalisé [0,1]
//
// Résultat en secondes.
// MIN : 900s (15min) — cohérent avec le PULL_INTERVAL existant
// MAX : 7200s (2h) — pour les dessins très complexes

// ─── Hash de séquence d'actions ──────────────────────────────────────────────
//
// Hash SHA-256 canonique de la séquence d'actions Proof-of-Draw.
// Permet de vérifier l'intégrité du processus de création, indépendamment du résultat pixel.

export async function hashActions(actions: { kind: string; t: number; tool?: string; color?: string }[]): Promise<string> {
  const canonical = JSON.stringify(actions);
  return sha256Hex(canonical);
}

// ─── Hash enrichi PoD ─────────────────────────────────────────────────────────
//
// podHashEnriched = SHA256(actionsHash + JSON(enrichment))
// Permet de vérifier que les métriques de replay sont cohérentes avec les actions.

export async function hashPodEnriched(actionsHash: string, enrichment: PodEnrichment): Promise<string> {
  const canonical = actionsHash + JSON.stringify(enrichment);
  return sha256Hex(canonical);
}

/**
 * Calcule les métriques PodEnrichment depuis la séquence de replay.
 */
export function computeEnrichment(replay: ReplayEvent[], actions: { kind: string; t: number }[]): PodEnrichment {
  let totalStrokes = 0;
  let totalPoints = 0;
  let currentStrokeLen = 0;
  let lastStrokeDown: ReplayEvent | null = null;
  const strokeLengths: number[] = [];
  const colors = new Set<string>();

  for (const ev of replay) {
    totalPoints++;
    if (ev.kind === "down") {
      totalStrokes++;
      lastStrokeDown = ev;
      currentStrokeLen = 0;
      if (ev.color) colors.add(ev.color);
    } else if (ev.kind === "move") {
      if (lastStrokeDown) {
        const dx = ev.x - lastStrokeDown.x;
        const dy = ev.y - lastStrokeDown.y;
        currentStrokeLen += Math.sqrt(dx * dx + dy * dy);
        lastStrokeDown = ev;
      }
      if (ev.color) colors.add(ev.color);
    } else if (ev.kind === "up") {
      strokeLengths.push(currentStrokeLen);
      lastStrokeDown = null;
      currentStrokeLen = 0;
    }
  }

  const avgStrokeLength = strokeLengths.length > 0
    ? strokeLengths.reduce((s, l) => s + l, 0) / strokeLengths.length
    : 0;

  const sessionDurationMs = replay.length > 0
    ? replay[replay.length - 1].t - replay[0].t
    : 0;

  const undoCount  = actions.filter(a => a.kind === "undo").length;
  const clearCount = actions.filter(a => a.kind === "clear").length;

  return {
    totalStrokes,
    totalPoints,
    avgStrokeLength: Math.round(avgStrokeLength * 10) / 10,
    sessionDurationMs,
    uniqueColorsUsed: colors.size,
    undoCount,
    clearCount,
  };
}

export function computeDisplayTime(
  score: number,
  prevBlockHash: string,
): number {
  const BASE  = 900;   // 15 min minimum
  const RANGE = 5400;  // +90 min max selon score
  const JITTER = 900;  // ±15 min selon hash du bloc précédent

  // Extrait les 4 derniers chars hex du hash précédent
  const hashTail  = prevBlockHash.slice(-4);
  const hashFactor = parseInt(hashTail, 16) / 0xFFFF; // [0, 1]

  const raw = BASE + score * RANGE + hashFactor * JITTER;
  return Math.round(raw);
}