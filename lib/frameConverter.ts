// lib/frameConverter.ts
// Conversion de frames entre types d'écrans — pur TypeScript, zéro dépendance.
// Compatible Vercel Edge Runtime et serverless Node.js.
//
// Logique de conversion :
//   1. Décoder les buffers base64 → Uint8Array de bits
//   2. Merger les canaux (ex: R+noir → noir pour les écrans mono)
//   3. Nearest-neighbor resize vers la résolution cible
//   4. Ré-encoder en base64
//
// Formats de buffers e-ink :
//   - Chaque byte représente 8 pixels (MSB first)
//   - 1 bit = pixel noir/allumé, 0 bit = pixel blanc/éteint
//   - eink29bwr : deux buffers séparés (black, red), 296×128 = 4736 bytes chacun
//   - eink27bw  : un seul buffer (black),             176×264 = 5808 bytes
//   - oled096   : un seul buffer (black),             128×64  = 1024 bytes
//
// Format OLED SSD1306 :
//   Le SSD1306 128×64 utilise un format "page-based" :
//   8 pages de 128 bytes, chaque byte représente une colonne de 8 pixels verticaux.
//   Page 0 = rangée Y 0-7, page 1 = Y 8-15, etc.
//   Bit 0 (LSB) = pixel du haut de la colonne.
//   → La conversion depuis e-ink (horizontal bit packing) nécessite une transposition.

// ─── Profils d'écrans ─────────────────────────────────────────────────────────
// Note : ce registre local utilise les dimensions DRIVER (espace de bits du firmware),
// qui peuvent différer des dimensions CANVAS (espace de dessin web).
// Ex: eink27bw — canvas 264×176 mais driver 176×264 (rotation 90°CCW appliquée côté firmware).

export interface ScreenProfile {
  width:    number;
  height:   number;
  type:     "eink_bwr" | "eink_bw" | "oled" | "tft";
  buffers:  ("black" | "red" | "buffer")[];
  byteSize: number; // taille en bytes d'un buffer (après décodage base64)
}

export const SCREEN_PROFILES_SERVER: Record<string, ScreenProfile> = {
  eink29bwr: {
    width: 296, height: 128,
    type: "eink_bwr",
    buffers: ["black", "red"],
    byteSize: Math.ceil(296 * 128 / 8), // 4736
  },
  eink27bw: {
    // Dimensions driver après rotation 90°CCW (canvas = 264×176, driver = 176×264)
    width: 176, height: 264,
    type: "eink_bw",
    buffers: ["buffer"],
    byteSize: Math.ceil(176 * 264 / 8), // 5808
  },
  oled096: {
    width: 128, height: 64,
    type: "oled",
    buffers: ["buffer"],
    byteSize: Math.ceil(128 * 64 / 8), // 1024
  },
  tft18: {
    // Mapping direct canvas=driver (128×160, pas de rotation)
    width: 128, height: 160,
    type: "tft",
    buffers: ["buffer"],
    byteSize: Math.ceil(128 * 160 / 8), // 2560
  },
};

// ─── Types de frames ──────────────────────────────────────────────────────────

export type FramePayloadBWR  = { screen: "eink29bwr"; black: string; red: string };
export type FramePayloadBW   = { screen: "eink27bw";  buffer: string };
export type FramePayloadOLED = { screen: "oled096";   buffer: string };
export type FramePayloadTFT  = { screen: "tft18";     buffer: string };
export type AnyFramePayload  = FramePayloadBWR | FramePayloadBW | FramePayloadOLED | FramePayloadTFT;

// ─── Utilitaires bas niveau ───────────────────────────────────────────────────

/** Décode un buffer base64 → tableau de pixels (0=blanc, 1=noir), row-major, MSB first */
function decodeEinkBuffer(b64: string, width: number, height: number): Uint8Array {
  const bytes  = Buffer.from(b64, "base64");
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx  = 7 - (i % 8); // MSB first
    pixels[i] = (bytes[byteIdx] >> bitIdx) & 1;
  }
  return pixels;
}

/** Encode un tableau de pixels → base64 (e-ink horizontal, MSB first) */
function encodeEinkBuffer(pixels: Uint8Array, width: number, height: number): string {
  const byteCount = Math.ceil(width * height / 8);
  const bytes     = new Uint8Array(byteCount);
  for (let i = 0; i < width * height; i++) {
    if (pixels[i]) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx  = 7 - (i % 8);
      bytes[byteIdx] |= (1 << bitIdx);
    }
  }
  return Buffer.from(bytes).toString("base64");
}

/**
 * Encode un tableau de pixels → base64 format SSD1306 (OLED page-based).
 * Page-based : 8 pages de 128 bytes.
 * byte[page * 128 + col] = colonne de 8 pixels, LSB = pixel du haut.
 */
function encodeOledBuffer(pixels: Uint8Array, width: number, height: number): string {
  const pages     = Math.ceil(height / 8);
  const byteCount = pages * width;
  const bytes     = new Uint8Array(byteCount);

  for (let y = 0; y < height; y++) {
    const page   = Math.floor(y / 8);
    const bitPos = y % 8; // LSB = haut
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x]) {
        bytes[page * width + x] |= (1 << bitPos);
      }
    }
  }
  return Buffer.from(bytes).toString("base64");
}

/**
 * Nearest-neighbor resize.
 * Gère aussi la rotation 90° dans le sens des aiguilles si rotate=true
 * (nécessaire pour eink27bw qui est portrait alors que eink29bwr est paysage).
 */
function resizePixels(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  rotate90cw = false,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);

  if (!rotate90cw) {
    // Resize direct
    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const srcX = Math.round((x / dstW) * srcW);
        const srcY = Math.round((y / dstH) * srcH);
        dst[y * dstW + x] = src[Math.min(srcY, srcH - 1) * srcW + Math.min(srcX, srcW - 1)];
      }
    }
  } else {
    // Rotation 90° CW + resize
    // Dans la destination : x correspond à srcY, y correspond à srcW-1-srcX
    // Après rotation : dstW = srcH, dstH = srcW (les dimensions s'inversent)
    // Ici on resize PUIS rotate pour que dstW/dstH soient les dims finales.
    const tmpW = dstH; // espace intermédiaire avant rotation
    const tmpH = dstW;
    const tmp  = new Uint8Array(tmpW * tmpH);

    // Resize vers l'espace intermédiaire
    for (let y = 0; y < tmpH; y++) {
      for (let x = 0; x < tmpW; x++) {
        const srcX = Math.round((x / tmpW) * srcW);
        const srcY = Math.round((y / tmpH) * srcH);
        tmp[y * tmpW + x] = src[Math.min(srcY, srcH - 1) * srcW + Math.min(srcX, srcW - 1)];
      }
    }

    // Rotation 90° CW : (x, y) → (tmpH - 1 - y, x)
    for (let y = 0; y < tmpH; y++) {
      for (let x = 0; x < tmpW; x++) {
        const dstX = tmpH - 1 - y;
        const dstY = x;
        dst[dstY * dstW + dstX] = tmp[y * tmpW + x];
      }
    }
  }

  return dst;
}

// ─── Conversion principale ────────────────────────────────────────────────────

/**
 * Convertit une frame source vers le format d'un écran cible.
 *
 * Règles de conversion :
 * - eink29bwr → eink27bw  : merger R+noir → noir, rotation 90°CW, resize 296×128 → 176×264
 * - eink29bwr → oled096   : merger R+noir → noir, resize 296×128 → 128×64, encode OLED
 * - eink27bw  → eink29bwr : resize 176×264 → 296×128, rotation 90°CCW, split en 2 buffers (rouge vide)
 * - eink27bw  → oled096   : resize 176×264 → 128×64, encode OLED
 * - oled096   → eink*     : resize + decode OLED page-based (pas encore implémenté, retourne null)
 *
 * Retourne null si la conversion n'est pas supportée.
 */
export function convertFrame(
  payload: AnyFramePayload,
  targetScreenId: string,
): AnyFramePayload | null {
  const targetProfile = SCREEN_PROFILES_SERVER[targetScreenId];
  if (!targetProfile) return null;

  const sourceScreenId = payload.screen;
  if (sourceScreenId === targetScreenId) return payload; // pas de conversion nécessaire

  const sourceProfile = SCREEN_PROFILES_SERVER[sourceScreenId];
  if (!sourceProfile) return null;

  // ── Extraire les pixels source ─────────────────────────────────────────────

  let srcPixels: Uint8Array;

  if (sourceScreenId === "eink29bwr") {
    const p       = payload as FramePayloadBWR;
    const black   = decodeEinkBuffer(p.black, sourceProfile.width, sourceProfile.height);
    const red     = decodeEinkBuffer(p.red,   sourceProfile.width, sourceProfile.height);
    // Merger : un pixel est "allumé" (noir affiché) si noir OU rouge
    srcPixels     = new Uint8Array(sourceProfile.width * sourceProfile.height);
    for (let i = 0; i < srcPixels.length; i++) {
      srcPixels[i] = black[i] | red[i];
    }
  } else if (sourceScreenId === "eink27bw") {
    const p       = payload as FramePayloadBW;
    srcPixels     = decodeEinkBuffer(p.buffer, sourceProfile.width, sourceProfile.height);
  } else if (sourceScreenId === "oled096") {
    // Décoder le format page-based OLED → pixels row-major
    const p       = payload as FramePayloadOLED;
    const bytes   = Buffer.from(p.buffer, "base64");
    const w       = sourceProfile.width;
    const h       = sourceProfile.height;
    srcPixels     = new Uint8Array(w * h);
    const pages   = Math.ceil(h / 8);
    for (let page = 0; page < pages; page++) {
      for (let col = 0; col < w; col++) {
        const byte = bytes[page * w + col];
        for (let bit = 0; bit < 8; bit++) {
          const y = page * 8 + bit;
          if (y < h) {
            srcPixels[y * w + col] = (byte >> bit) & 1;
          }
        }
      }
    }
  } else if (sourceScreenId === "tft18") {
    // Format 1bpp row-major, même convention que eink : bit=1→blanc, bit=0→noir
    // On inverse pour avoir 0=blanc, 1=noir (convention interne du convertisseur)
    const p       = payload as FramePayloadTFT;
    srcPixels     = decodeEinkBuffer(p.buffer, sourceProfile.width, sourceProfile.height);
    // decodeEinkBuffer lit bit=1 comme "allumé" (noir ici convention inverse)
    // Pour tft18 : bit=1=blanc, donc on inverse la convention
    for (let i = 0; i < srcPixels.length; i++) srcPixels[i] ^= 1;
  } else {
    return null; // screen source inconnu
  }

  // ── Resize + rotation vers la cible ───────────────────────────────────────

  const srcW = sourceProfile.width;
  const srcH = sourceProfile.height;
  const dstW = targetProfile.width;
  const dstH = targetProfile.height;

  // Détecter si on doit faire une rotation :
  // eink29bwr est paysage (296 > 128), eink27bw est portrait (176 < 264)
  // Passer de l'un à l'autre nécessite une rotation pour que le contenu reste orienté correctement.
  const srcLandscape = srcW > srcH;
  const dstLandscape = dstW > dstH;
  const needsRotation = srcLandscape !== dstLandscape;

  const dstPixels = resizePixels(srcPixels, srcW, srcH, dstW, dstH, needsRotation);

  // ── Encoder vers le format cible ──────────────────────────────────────────

  if (targetScreenId === "eink29bwr") {
    // Le rouge est vide (on n'invente pas de rouge depuis un écran mono)
    const emptyRed = Buffer.alloc(targetProfile.byteSize, 0).toString("base64");
    return {
      screen: "eink29bwr",
      black:  encodeEinkBuffer(dstPixels, dstW, dstH),
      red:    emptyRed,
    };
  }

  if (targetScreenId === "eink27bw") {
    return {
      screen: "eink27bw",
      buffer: encodeEinkBuffer(dstPixels, dstW, dstH),
    };
  }

  if (targetScreenId === "oled096") {
    return {
      screen: "oled096",
      buffer: encodeOledBuffer(dstPixels, dstW, dstH),
    };
  }

  if (targetScreenId === "tft18") {
    // tft18 : 1bpp row-major, même encodeur que eink, convention bit=1=blanc inversée
    // On inverse 0/1 avant d'encoder (pixel actif "noir" → bit=0 dans le buffer tft)
    const inverted = new Uint8Array(dstPixels.length);
    for (let i = 0; i < dstPixels.length; i++) inverted[i] = dstPixels[i] ^ 1;
    return {
      screen: "tft18",
      buffer: encodeEinkBuffer(inverted, dstW, dstH),
    };
  }

  return null;
}