// lib/screenProfiles.ts
// ═══════════════════════════════════════════════════════════════════════════════
// SOURCE UNIQUE DE VÉRITÉ pour tous les types d'écrans du projet.
//
// Pour ajouter un nouvel écran :
//   1. Ajouter son id dans le type ScreenId
//   2. Ajouter son profil dans SCREEN_PROFILES
//   3. Ajouter sa logique de conversion dans lib/canvasToScreen.ts (encode)
//      et lib/screenToCanvas.ts (decode)
//   4. Tout le reste (network map, validation, draw, SVG) s'adapte automatiquement.
// ═══════════════════════════════════════════════════════════════════════════════

export type ScreenId = "eink29bwr" | "oled096" | "eink27bw" | "tft18";

export interface ScreenProfile {
  id: ScreenId;

  // ── Affichage ──────────────────────────────────────────────────────────────
  name: string;           // nom court lisible
  description: string;    // résolution et couleurs
  pixelRatio: number;     // échelle d'affichage canvas (display scale)

  // ── Canvas (côté web app) ─────────────────────────────────────────────────
  width: number;          // largeur canvas en pixels
  height: number;         // hauteur canvas en pixels
  colors: string[];       // palette CSS autorisée pour le dessin
  colorLabels: string[];  // labels FR de la palette
  dithering: boolean;     // dithering activé dans l'éditeur
  grayscale: boolean;     // rendu niveaux de gris

  // ── Payload binaire (côté ESP) ────────────────────────────────────────────
  payloadType: "mono" | "dual";
  // "mono" : un seul buffer base64 (champ "buffer")
  // "dual" : deux buffers séparés (champs "black" + "red") — eink29bwr uniquement

  bufferSize: number;
  // taille en bytes du payload binaire transmis à l'ESP
  // pour "dual", c'est la taille d'UN des deux buffers (black ou red)

  // ── Preview / SVG (côté serveur) ──────────────────────────────────────────
  svgBg: string;    // couleur de fond pour les previews SVG
  svgFg: string;    // couleur de pixel principal
  svgFg2?: string;  // couleur secondaire (dual uniquement — canal rouge)
}

export const SCREEN_PROFILES: Record<ScreenId, ScreenProfile> = {

  // ── E-Ink 2.9" Noir / Blanc / Rouge ──────────────────────────────────────
  eink29bwr: {
    id: "eink29bwr",
    name: 'E-Ink 2.9" BWR',
    description: "296×128px — Noir / Blanc / Rouge",
    pixelRatio: 2,

    width: 296,
    height: 128,
    colors: ["#000000", "#FFFFFF", "#CC0000"],
    colorLabels: ["Noir", "Blanc", "Rouge"],
    dithering: true,
    grayscale: false,

    payloadType: "dual",
    bufferSize: 4736,    // 128×296 / 8 = 4736 bytes × 2 canaux (black + red)

    svgBg:  "#ffffff",
    svgFg:  "#000000",
    svgFg2: "#cc0000",
  },

  // ── OLED 0.96" Mono ───────────────────────────────────────────────────────
  oled096: {
    id: "oled096",
    name: 'OLED 0.96"',
    description: "128×64px — Noir / Blanc",
    pixelRatio: 4,

    width: 128,
    height: 64,
    colors: ["#000000", "#FFFFFF"],
    colorLabels: ["Noir", "Blanc"],
    dithering: false,
    grayscale: false,

    payloadType: "mono",
    bufferSize: 1024,    // 128×64 / 8 = 1024 bytes

    svgBg: "#000000",
    svgFg: "#00ff88",
  },

  // ── E-Ink 2.7" Noir / Blanc ───────────────────────────────────────────────
  eink27bw: {
    id: "eink27bw",
    name: 'E-Ink 2.7" BW',
    description: "264×176px — NOIR / Blanc",
    pixelRatio: 2,

    width: 264,
    height: 176,
    colors: ["#000000", "#FFFFFF"],
    colorLabels: ["Noir", "Blanc"],
    dithering: false,
    grayscale: true,

    payloadType: "mono",
    bufferSize: 5808,    // (176/8) × 264 = 22 × 264 = 5808 bytes (driver 176×264)

    svgBg: "#ffffff",
    svgFg: "#000000",
  },

  // ── TFT 1.8" ST7735 Couleur (rendu 1bpp) ─────────────────────────────────
  tft18: {
    id: "tft18",
    name: 'TFT 1.8"',
    description: "128×160px — TFT couleur (rendu 1bpp)",
    pixelRatio: 3,

    width: 128,
    height: 160,
    colors: ["#000000", "#FFFFFF"],
    colorLabels: ["Noir", "Blanc"],
    dithering: false,
    grayscale: false,

    payloadType: "mono",
    bufferSize: 2560,    // (128/8) × 160 = 16 × 160 = 2560 bytes

    svgBg: "#ffffff",
    svgFg: "#000000",
  },
};

// ── Exports utilitaires ───────────────────────────────────────────────────────

/** Liste ordonnée de tous les identifiants d'écrans enregistrés. */
export const SCREEN_IDS = Object.keys(SCREEN_PROFILES) as ScreenId[];

/** Vérifie qu'un string est un ScreenId valide. */
export function isValidScreenId(s: string): s is ScreenId {
  return s in SCREEN_PROFILES;
}

/** Retourne le profil d'un écran, ou undefined si inconnu. */
export function getScreenProfile(id: string): ScreenProfile | undefined {
  return SCREEN_PROFILES[id as ScreenId];
}

/**
 * Retourne true si ce type d'écran utilise un double buffer (black + red).
 * Tous les autres types utilisent un buffer unique.
 */
export function isDualBuffer(screenId: string): boolean {
  return SCREEN_PROFILES[screenId as ScreenId]?.payloadType === "dual";
}
