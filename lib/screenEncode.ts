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

// Nearest-neighbor, aspect-ratio-preserving ("letterboxed") resize: scales
// the source to the largest size that fits inside dstW x dstH without
// distortion, centers it, and pads the rest white. An ANA drawing's own
// canvas (currently 3:2, see memorialArt.ts's MEMORIAL_CANVAS_W/H) rarely
// matches a given screen's own ratio — eink27bw happens to share it (a plain
// stretch there is already undistorted), but eink29bwr, oled096, and
// especially the portrait tft18 don't, and a plain stretch would visibly
// squash/stretch the piece differently per screen. Letterboxing keeps every
// screen showing the same proportions, just with a different amount of
// white margin.
function resizeLetterboxGrayscale(
  src: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return src;

  const dst = new Uint8Array(dstW * dstH).fill(255); // white padding
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const fitW  = Math.max(1, Math.round(srcW * scale));
  const fitH  = Math.max(1, Math.round(srcH * scale));
  const offX  = Math.floor((dstW - fitW) / 2);
  const offY  = Math.floor((dstH - fitH) / 2);

  for (let y = 0; y < fitH; y++) {
    const dy = offY + y;
    if (dy < 0 || dy >= dstH) continue;
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / fitH));
    for (let x = 0; x < fitW; x++) {
      const dx = offX + x;
      if (dx < 0 || dx >= dstW) continue;
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / fitW));
      dst[dy * dstW + dx] = src[sy * srcW + sx];
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

  const resized = resizeLetterboxGrayscale(pixels, canvasW, canvasH, profile.width, profile.height);

  switch (screenId) {
    case "oled096":   return encodeOled096(resized, profile.width, profile.height);
    case "eink27bw":  return encodeEink27bw(resized, profile.width, profile.height);
    case "eink29bwr": return encodeEink29bwr(resized, profile.width, profile.height);
    case "tft18":     return encodeTft18(resized, profile.width, profile.height);
    default:
      throw new Error(`encodeForScreen: unsupported screen ${screenId}`);
  }
}
