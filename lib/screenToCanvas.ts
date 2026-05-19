// lib/screenToCanvas.ts
// Conversion INVERSE : buffer ESP (base64) → ImageData RGBA pour canvas web
// Miroir de canvasToScreen.ts — respecte les mêmes conventions de bits/rotation.
//
// La logique de décodage est spécifique à chaque format matériel.
// Le type ScreenPayload est dérivé de lib/screenProfiles.ts.

import type { ScreenId } from "@/lib/screenProfiles";

export type ScreenPayload =
  | { screen: "oled096";   buffer: string }
  | { screen: "eink27bw";  buffer: string }
  | { screen: "tft18";     buffer: string }
  | { screen: "eink29bwr"; black: string; red: string };

/**
 * Décode un base64 en Uint8Array (compatible browser + Node)
 */
function b64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    // Node.js
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  // Browser
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── OLED 0.96" SSD1306 128×64 ───────────────────────────────────────────────
// Format : page-major, 1024 bytes, bit=1 → pixel allumé (blanc), bit=0 → éteint (noir)
export function oled096ToCanvas(bufferB64: string): ImageData {
  const W = 128, H = 64;
  const buf = b64ToBytes(bufferB64);
  const rgba = new Uint8ClampedArray(W * H * 4);

  for (let y = 0; y < H; y++) {
    const page = Math.floor(y / 8);
    const bit = y % 8;
    for (let x = 0; x < W; x++) {
      const byteIdx = page * 128 + x;
      const isLit = (buf[byteIdx] >> bit) & 1;
      const idx = (y * W + x) * 4;
      const v = isLit ? 255 : 0;
      rgba[idx] = v;
      rgba[idx + 1] = v;
      rgba[idx + 2] = v;
      rgba[idx + 3] = 255;
    }
  }
  return new ImageData(rgba, W, H);
}

// ─── E-INK 2.7" BW Waveshare V2 (canvas 264×176) ────────────────────────────
// Buffer driver : 5808 bytes, 176 colonnes × 264 lignes, rotation 90° CCW appliquée
// 0x00 bit = noir, 0x01 bit = blanc (MSB-first)
export function eink27bwToCanvas(bufferB64: string): ImageData {
  const CANVAS_W = 264, CANVAS_H = 176;
  const buf = b64ToBytes(bufferB64);
  const rgba = new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4);

  // Remplir fond blanc
  rgba.fill(255);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  // Inverser la rotation 90° CCW : (bufCol, bufRow) → (x, y)
  const bytesPerRow = 22; // 176/8
  for (let bufRow = 0; bufRow < 264; bufRow++) {
    for (let bufCol = 0; bufCol < 176; bufCol++) {
      const byteIdx = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit = 7 - (bufCol % 8);
      const isBlack = !((buf[byteIdx] >> bit) & 1); // 0 = noir

      if (!isBlack) continue;

      const x = bufRow;
      const y = 175 - bufCol;
      if (x < 0 || x >= CANVAS_W || y < 0 || y >= CANVAS_H) continue;

      const idx = (y * CANVAS_W + x) * 4;
      rgba[idx] = 0;
      rgba[idx + 1] = 0;
      rgba[idx + 2] = 0;
      rgba[idx + 3] = 255;
    }
  }
  return new ImageData(rgba, CANVAS_W, CANVAS_H);
}

// ─── E-INK 2.9" BWR Waveshare V4 (canvas 296×128) ───────────────────────────
// Deux buffers : black (4736 bytes) + red (4736 bytes), rotation 90° CCW
export function eink29bwrToCanvas(blackB64: string, redB64: string): ImageData {
  const CANVAS_W = 296, CANVAS_H = 128;
  const blackBuf = b64ToBytes(blackB64);
  const redBuf = b64ToBytes(redB64);
  const rgba = new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4);

  // Fond blanc
  rgba.fill(255);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const bytesPerRow = 16; // 128/8
  for (let bufRow = 0; bufRow < 296; bufRow++) {
    for (let bufCol = 0; bufCol < 128; bufCol++) {
      const byteIdx = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit = 7 - (bufCol % 8);
      const isBlack = !((blackBuf[byteIdx] >> bit) & 1);
      const isRed = !((redBuf[byteIdx] >> bit) & 1);

      if (!isBlack && !isRed) continue;

      const x = bufRow;
      const y = 127 - bufCol;
      if (x < 0 || x >= CANVAS_W || y < 0 || y >= CANVAS_H) continue;

      const idx = (y * CANVAS_W + x) * 4;
      if (isRed) {
        rgba[idx] = 255;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
      } else {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
      }
      rgba[idx + 3] = 255;
    }
  }
  return new ImageData(rgba, CANVAS_W, CANVAS_H);
}

// ─── TFT 1.8" ST7735 128×160 ─────────────────────────────────────────────────
// Buffer 1bpp row-major, 2560 bytes, MSB-first
// Convention : bit=1 → blanc (fond), bit=0 → noir (pixel actif)
// Mapping direct : canvas(x,y) → byteIndex = y*16 + floor(x/8), bit = 7-(x%8)
export function tft18ToCanvas(bufferB64: string): ImageData {
  const W = 128, H = 160;
  const buf = b64ToBytes(bufferB64);
  const rgba = new Uint8ClampedArray(W * H * 4);

  // Fond blanc
  rgba.fill(255);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const bytesPerRow = 16; // 128/8
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const byteIdx = y * bytesPerRow + Math.floor(x / 8);
      const bit = 7 - (x % 8);
      const isBlack = !((buf[byteIdx] >> bit) & 1); // 0 = noir

      if (!isBlack) continue;

      const idx = (y * W + x) * 4;
      rgba[idx] = 0;
      rgba[idx + 1] = 0;
      rgba[idx + 2] = 0;
      rgba[idx + 3] = 255;
    }
  }
  return new ImageData(rgba, W, H);
}

// ─── DISPATCHER GÉNÉRIQUE ────────────────────────────────────────────────────
// Ajouter un écran ici après l'avoir ajouté dans lib/screenProfiles.ts
export function screenPayloadToCanvas(payload: ScreenPayload): ImageData {
  switch (payload.screen) {
    case "oled096":
      return oled096ToCanvas(payload.buffer);
    case "eink27bw":
      return eink27bwToCanvas(payload.buffer);
    case "tft18":
      return tft18ToCanvas(payload.buffer);
    case "eink29bwr":
      return eink29bwrToCanvas(payload.black, payload.red);
    default: {
      const _exhaustive: never = payload;
      throw new Error(`screenToCanvas: screen inconnu — ${(_exhaustive as { screen: string }).screen}`);
    }
  }
}
