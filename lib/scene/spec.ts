// lib/scene/spec.ts
// Types, constantes et table sinus normatifs de `ana-scene-v1` (contrat ANA → PoD, note 37).
// Module PUR : aucun import Node, utilisable côté serveur, navigateur (aperçu galerie) et tests.
// Toute valeur ici est figée par le contrat : la modifier casse l'interopérabilité ANA / PoD / firmwares.

export const SCENE_SCHEMA = "ana-scene-v1" as const;
export const SCENE_RENDERER_VERSION = 1 as const;
export const SCENE_MAX_BYTES = 4_096;
export const SCENE_MAX_ENTITIES = 24;
export const SCENE_MAX_POINTS = 16;
export const SCENE_MAX_TICKS = 50;
export const SCENE_MAX_OPS_PER_TICK = 256;

export type ScenePrimitive = "point" | "line" | "rect" | "circle" | "polyline";

export type SceneMotion =
  | { type: "static" }
  | { type: "linear"; dx: number; dy: number; edge: "wrap" }
  | { type: "oscillate-x" | "oscillate-y"; amplitude: number; period: number; phase: number }
  | { type: "orbit"; radiusX: number; radiusY: number; period: number; phase: number };

export type SceneGeometry =
  | { type: "point"; x: number; y: number; size: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; width: number }
  | { type: "rect"; x0: number; y0: number; x1: number; y1: number; fill: boolean }
  | { type: "circle"; cx: number; cy: number; r: number; fill: boolean }
  | { type: "polyline"; points: Array<{ x: number; y: number }>; closed: boolean; width: number };

export interface SceneEntity {
  id: number;
  primitive: ScenePrimitive;
  colorIndex: number;
  geometry: SceneGeometry;
  motion: SceneMotion;
}

export interface AnaScene {
  schema: typeof SCENE_SCHEMA;
  rendererVersion: typeof SCENE_RENDERER_VERSION;
  seed: number;             // uint32 non nul
  tickRate: number;         // 1..5
  durationTicks: number;    // 1..50
  loopCount: number;        // 1..3
  backgroundIndex: number;
  palette: number[];        // 1..8 couleurs RGB565
  clear: "solid";
  entities: SceneEntity[];  // 1..24, ordre = z-order
}

/** Déclaration de capacité d'un appareil (contrat §6). E-ink : toujours `sceneV1: false`. */
export interface SceneCapability {
  sceneV1: boolean;
  maxPackageBytes: 4096;
  maxEntities: 24;
  maxFps: 2 | 4 | 5;
  dirtyRectangles: boolean;
  firmwareVersion: string;
}

// Table sinus Q15 normative (256 valeurs signées) : round(32767 * sin(2π·i/256)), générée UNE fois
// et jamais recalculée à l'exécution. Les firmwares copient ces 256 entiers à l'identique.
// Hash des 512 octets int16 little-endian : voir SIN_Q15_HASH (vérifié par tests/sceneV1Spec.test.ts).
export const SIN_Q15_256: readonly number[] = [
  0, 804, 1608, 2410, 3212, 4011, 4808, 5602, 6393, 7179, 7962, 8739, 9512, 10278, 11039, 11793,
  12539, 13279, 14010, 14732, 15446, 16151, 16846, 17530, 18204, 18868, 19519, 20159, 20787, 21403, 22005, 22594,
  23170, 23731, 24279, 24811, 25329, 25832, 26319, 26790, 27245, 27683, 28105, 28510, 28898, 29268, 29621, 29956,
  30273, 30571, 30852, 31113, 31356, 31580, 31785, 31971, 32137, 32285, 32412, 32521, 32609, 32678, 32728, 32757,
  32767, 32757, 32728, 32678, 32609, 32521, 32412, 32285, 32137, 31971, 31785, 31580, 31356, 31113, 30852, 30571,
  30273, 29956, 29621, 29268, 28898, 28510, 28105, 27683, 27245, 26790, 26319, 25832, 25329, 24811, 24279, 23731,
  23170, 22594, 22005, 21403, 20787, 20159, 19519, 18868, 18204, 17530, 16846, 16151, 15446, 14732, 14010, 13279,
  12539, 11793, 11039, 10278, 9512, 8739, 7962, 7179, 6393, 5602, 4808, 4011, 3212, 2410, 1608, 804,
  0, -804, -1608, -2410, -3212, -4011, -4808, -5602, -6393, -7179, -7962, -8739, -9512, -10278, -11039, -11793,
  -12539, -13279, -14010, -14732, -15446, -16151, -16846, -17530, -18204, -18868, -19519, -20159, -20787, -21403, -22005, -22594,
  -23170, -23731, -24279, -24811, -25329, -25832, -26319, -26790, -27245, -27683, -28105, -28510, -28898, -29268, -29621, -29956,
  -30273, -30571, -30852, -31113, -31356, -31580, -31785, -31971, -32137, -32285, -32412, -32521, -32609, -32678, -32728, -32757,
  -32767, -32757, -32728, -32678, -32609, -32521, -32412, -32285, -32137, -31971, -31785, -31580, -31356, -31113, -30852, -30571,
  -30273, -29956, -29621, -29268, -28898, -28510, -28105, -27683, -27245, -26790, -26319, -25832, -25329, -24811, -24279, -23731,
  -23170, -22594, -22005, -21403, -20787, -20159, -19519, -18868, -18204, -17530, -16846, -16151, -15446, -14732, -14010, -13279,
  -12539, -11793, -11039, -10278, -9512, -8739, -7962, -7179, -6393, -5602, -4808, -4011, -3212, -2410, -1608, -804,
];

/** sha256 hex des 512 octets int16 little-endian de SIN_Q15_256 (contrat §5). */
export const SIN_Q15_HASH = "e6ba60bf7f71eb7ace29b911099673bd949b59f9b8d07b8d1c240f3bbfb72ba3";

/** xorshift32 : PRNG réservé (V1 n'a aucune primitive aléatoire). uint32 explicite après chaque opération. */
export function xorshift32(state: number): number {
  let x = state >>> 0;
  x ^= (x << 13) >>> 0; x >>>= 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0; x >>>= 0;
  return x >>> 0;
}

/** Sorties attendues de xorshift32 depuis la graine 1 (contrat §5). */
export const XORSHIFT32_SEED1_FIRST10 = [
  270369, 67634689, 2647435461, 307599695, 2398689233, 745495504, 632435482, 435756210, 2005365029, 2916098932,
] as const;
