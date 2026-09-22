// lib/screenEncode.ts
// Server-side (no DOM) image → per-screen buffer encoder, for content that
// arrives already as raw pixels (ANA bridge) rather than drawn on a browser
// <canvas> — lib/canvasToScreen.ts stays the client-side path and is untouched.
//
// Input: a single grayscale byte per pixel (0-255, canvasW×canvasH, row-major),
// no alpha/color channel — this is 1bpp line art (see CLAUDE.md), not a photo.
// Output: the exact same buffer conventions as canvasToScreen.ts for each
// screen (bit convention, rotation, byte layout) — verified against it line
// by line, not re-derived, so an ESP can't tell the two sources apart.

import { ScreenId, SCREEN_PROFILES } from "@/lib/screenProfiles";

export type EncodedFrame = { buffer: string } | { black: string; red: string };

const DARK_THRESHOLD = 128; // grayscale value below this = "ink" (black), same cut as canvasToScreen's classifyPixel

function toBase64(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64");
}

// Nearest-neighbor stretch to the target canvas size — does not preserve
// aspect ratio (an ANA drawing's own canvas may differ from a given screen's).
// Good enough for small 1bpp line art; a letterboxed/aspect-preserving resize
// is a documented follow-up (see the plan's open points), not a correctness
// requirement for this pipeline to work end-to-end.
function resizeNearestGrayscale(
  src: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return src;
  const dst = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      dst[y * dstW + x] = src[sy * srcW + sx];
    }
  }
  return dst;
}

/**
 * OLED 0.96" SSD1306 — page-major, no rotation. Mirrors canvasToScreen.ts's
 * oled096 branch: bit=1 => pixel lit (dark).
 */
function encodeOled096(pixels: Uint8Array, w: number, h: number): EncodedFrame {
  const buffer = new Uint8Array((w * h) / 8).fill(0x00);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x] >= DARK_THRESHOLD) continue; // light — leave off
      const page = Math.floor(y / 8);
      const bit  = y % 8;
      buffer[page * w + x] |= (1 << bit);
    }
  }
  return { buffer: toBase64(buffer) };
}

/**
 * E-Ink 2.7" BW (Waveshare epd2in7_V2) — canvas 264x176 rotated 90° CCW into
 * a 176x264 driver buffer. Mirrors canvasToScreen.ts's eink27bw branch:
 * buffer starts all-white (0xFF), a dark pixel clears its bit.
 */
function encodeEink27bw(pixels: Uint8Array, w: number, h: number): EncodedFrame {
  const bytesPerRow = 176 / 8; // 22
  const BUF_SIZE    = bytesPerRow * 264;
  const buffer      = new Uint8Array(BUF_SIZE).fill(0xff);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x] >= DARK_THRESHOLD) continue;
      const bufCol    = 175 - y;
      const bufRow    = x;
      const byteIndex = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit       = 7 - (bufCol % 8);
      if (byteIndex >= BUF_SIZE) continue;
      buffer[byteIndex] &= (~(1 << bit)) & 0xff;
    }
  }
  return { buffer: toBase64(buffer) };
}

/**
 * E-Ink 2.9" BWR (Waveshare epd2in9b_V4) — canvas 296x128 rotated 90° CCW
 * into a 128x296 driver buffer, black + red channels. Mirrors
 * canvasToScreen.ts's eink29bwr branch. ANA line art has no red channel, so
 * red stays all-white — see the plan's note on this screen.
 */
function encodeEink29bwr(pixels: Uint8Array, w: number, h: number): EncodedFrame {
  const bytesPerRow = 128 / 8; // 16
  const BUF_SIZE    = bytesPerRow * 296;
  const blackBuf    = new Uint8Array(BUF_SIZE).fill(0xff);
  const redBuf      = new Uint8Array(BUF_SIZE).fill(0xff);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x] >= DARK_THRESHOLD) continue;
      const bufCol    = 127 - y;
      const bufRow    = x;
      const byteIndex = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit       = 7 - (bufCol % 8);
      if (byteIndex >= BUF_SIZE) continue;
      blackBuf[byteIndex] &= (~(1 << bit)) & 0xff;
    }
  }
  return { black: toBase64(blackBuf), red: toBase64(redBuf) };
}

/**
 * TFT 1.8" ST7735 (RGB565, full color) — ANA line art carries no color
 * channel, so this renders the same pure black-ink-on-white every other
 * screen here produces, just packed as RGB565 instead of 1bpp. Row-major,
 * little-endian (0xFFFF white, 0x0000 black), matches canvasToScreen.ts's
 * tft18 branch's byte layout exactly — only the source is grayscale bytes
 * instead of an RGBA canvas.
 */
function encodeTft18(pixels: Uint8Array, w: number, h: number): EncodedFrame {
  const buffer = new Uint8Array(w * h * 2).fill(0xff); // white (0xFFFF) by default
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x] >= DARK_THRESHOLD) continue; // light — leave white
      const off = (y * w + x) * 2;
      buffer[off] = 0x00; buffer[off + 1] = 0x00; // RGB565 black = 0x0000
    }
  }
  return { buffer: toBase64(buffer) };
}

/**
 * Encodes a raw grayscale bitmap (canvasW×canvasH, one byte per pixel, 0-255)
 * into the buffer format `screenId` expects, resizing first if needed.
 */
export function encodeForScreen(
  pixels: Uint8Array, canvasW: number, canvasH: number, screenId: ScreenId,
): EncodedFrame {
  const profile = SCREEN_PROFILES[screenId];
  if (!profile) throw new Error(`Unknown screen profile: ${screenId}`);

  const resized = resizeNearestGrayscale(pixels, canvasW, canvasH, profile.width, profile.height);

  switch (screenId) {
    case "oled096":   return encodeOled096(resized, profile.width, profile.height);
    case "eink27bw":  return encodeEink27bw(resized, profile.width, profile.height);
    case "eink29bwr": return encodeEink29bwr(resized, profile.width, profile.height);
    case "tft18":     return encodeTft18(resized, profile.width, profile.height);
    default:
      throw new Error(`encodeForScreen: unsupported screen ${screenId}`);
  }
}
