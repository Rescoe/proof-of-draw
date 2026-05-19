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

  pixelFormat: "1bpp" | "rgb565";
  // "1bpp"   : 1 bit par pixel, convention bit=1→blanc ou allumé (e-ink/OLED)
  // "rgb565" : 2 bytes par pixel, little-endian, couleur complète (TFT)

  bufferSize: number;
  // taille en bytes du payload binaire transmis à l'ESP
  // pour "dual", c'est la taille d'UN des deux buffers (black ou red)
  // pour "rgb565", c'est width × height × 2

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
    pixelFormat: "1bpp",
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
    pixelFormat: "1bpp",
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
    pixelFormat: "1bpp",
    bufferSize: 5808,    // (176/8) × 264 = 22 × 264 = 5808 bytes (driver 176×264)

    svgBg: "#ffffff",
    svgFg: "#000000",
  },

  // ── TFT 1.8" ST7735 RGB565 Couleur complète ───────────────────────────────
  // Format : RGB565 little-endian, 2 bytes/pixel, 128×160×2 = 40960 bytes
  // Convention : native ESP8266 uint16_t, envoyé via writePixels sans swap
  tft18: {
    id: "tft18",
    name: 'TFT 1.8"',
    description: "128×160px — TFT RGB565 couleur complète",
    pixelRatio: 3,

    width: 128,
    height: 160,

    // Palette 48 couleurs couvrant le spectre complet + tons neutres
    colors: [
      // Rouges
      "#FF0000", "#CC0000", "#FF4444", "#FF6666",
      // Oranges
      "#FF8800", "#FF6600", "#FFAA44", "#CC6600",
      // Jaunes
      "#FFFF00", "#FFD700", "#FFEE88", "#CCAA00",
      // Verts
      "#00FF00", "#00CC00", "#44FF88", "#006600",
      // Cyans
      "#00FFFF", "#00CCDD", "#44FFDD", "#00AAAA",
      // Bleus
      "#0000FF", "#0055FF", "#4488FF", "#0000AA",
      // Mauves/Indigo
      "#6600FF", "#4400CC", "#9966FF", "#330099",
      // Roses/Magentas
      "#FF00FF", "#FF0088", "#FF66CC", "#CC0088",
      // Blancs/Gris clairs
      "#FFFFFF", "#EEEEEE", "#DDDDDD", "#CCCCCC",
      // Gris moyens
      "#AAAAAA", "#888888", "#666666", "#444444",
      // Sombres + Noir
      "#222222", "#111111", "#000000",
      // Accents supplémentaires
      "#FF9900", "#00FF88", "#FF3366", "#33CCFF",
      "#FF66FF", "#99FF00", "#FF4400", "#0088CC",
      "#FFCC00", "#00FFCC",
    ],
    colorLabels: [], // géré dynamiquement côté UI (affiche le hex)
    dithering: false,
    grayscale: false,

    payloadType: "mono",
    pixelFormat: "rgb565",
    bufferSize: 40960,   // 128 × 160 × 2 bytes = 40960 bytes

    svgBg: "#ffffff",
    svgFg: "#000000",    // inutilisé pour RGB565 (couleurs réelles dans le buffer)
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
