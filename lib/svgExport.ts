// lib/svgExport.ts
// Génère un SVG pixel-art depuis un ImageData.
// Chaque pixel sombre → un <rect> dans le SVG.
// Pixels blancs/transparents → fond transparent (pas de rect).
// Aucun lissage, aucune simplification — un rect par pixel.

export interface SvgExportOptions {
  scale?: number;          // taille d'un pixel en unités SVG (défaut: 1)
  blackThreshold?: number; // seuil de luminosité pour considérer un pixel "noir" (0–255, défaut: 128)
  redThreshold?: number;   // seuil pour le canal rouge (pour BWR)
}

/**
 * Génère un SVG depuis un ImageData RGBA.
 * Convient pour les buffers produits par screenToCanvas.ts.
 *
 * Logique de couleur :
 *   - pixel rouge dominant (r > 200 && g < 100) → <rect fill="#c00000">
 *   - pixel sombre (luminosité < threshold) → <rect fill="#000000">
 *   - sinon → ignoré (fond blanc transparent)
 */
export function generatePixelSVG(
  imageData: ImageData,
  options: SvgExportOptions = {},
): string {
  const { scale = 1, blackThreshold = 128 } = options;
  const { width, height, data } = imageData;

  const svgWidth  = width  * scale;
  const svgHeight = height * scale;

  const rects: string[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) continue; // transparent

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Pixel rouge (e-ink BWR) : canal rouge dominant
      const isRed = r > 160 && g < 100 && b < 100;
      // Pixel noir : luminosité sous le seuil
      const isBlack = !isRed && lum < blackThreshold;

      if (!isRed && !isBlack) continue; // blanc → fond transparent

      const fill = isRed ? "#cc0000" : "#000000";
      const px = x * scale;
      const py = y * scale;

      // Optimisation : si scale=1, attributs minimaux
      if (scale === 1) {
        rects.push(`<rect x="${px}" y="${py}" width="1" height="1" fill="${fill}"/>`);
      } else {
        rects.push(`<rect x="${px}" y="${py}" width="${scale}" height="${scale}" fill="${fill}"/>`);
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" shape-rendering="crispEdges">
${rects.join("\n")}
</svg>`;
}

/**
 * Génère un SVG depuis les buffers e-ink bruts (base64).
 * Wrapper pour les BlockImagePayload.
 */
export function generatePixelSVGFromBuffer(
  screenType: string,
  blackB64?: string,
  redB64?: string,
  bufferB64?: string,
  scale = 2,
): string | null {
  try {
    // Import dynamique selon le type d'écran
    // Note : ces fonctions retournent un ImageData
    const { eink29bwrToCanvas, eink27bwToCanvas, oled096ToCanvas } = require("./screenToCanvas");

    let imageData: ImageData | null = null;

    if (screenType === "eink29bwr" && blackB64 && redB64) {
      imageData = eink29bwrToCanvas(blackB64, redB64);
    } else if (screenType === "eink27bw" && bufferB64) {
      imageData = eink27bwToCanvas(bufferB64);
    } else if (screenType === "oled096" && bufferB64) {
      imageData = oled096ToCanvas(bufferB64);
    }

    if (!imageData) return null;
    return generatePixelSVG(imageData, { scale });
  } catch {
    return null;
  }
}
