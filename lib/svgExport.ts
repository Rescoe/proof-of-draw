// lib/svgExport.ts
// Génération SVG pixel-art à partir des buffers ESP (Node.js / Edge).
// Miroir de screenToCanvas.ts mais sans ImageData — compatible serveur.
//
// Les couleurs de fond et de pixel sont dérivées de lib/screenProfiles.ts.
// La logique de décodage binaire reste par-écran (formats matériellement distincts).

import { SCREEN_PROFILES } from "@/lib/screenProfiles";

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

type Pixel = { x: number; y: number; color: string };
type Decoded = { pixels: Pixel[]; w: number; h: number; bg: string };

// ─── OLED 0.96" SSD1306 128×64 ────────────────────────────────────────────────
// Format page-major, bit=1 → pixel allumé
function decodeOled(bufferB64: string, fg: string): Decoded {
  const W = 128, H = 64;
  const buf = b64ToBytes(bufferB64);
  const pixels: Pixel[] = [];
  for (let y = 0; y < H; y++) {
    const page = Math.floor(y / 8);
    const bit  = y % 8;
    for (let x = 0; x < W; x++) {
      const byteIdx = page * 128 + x;
      if ((buf[byteIdx] >> bit) & 1) pixels.push({ x, y, color: fg });
    }
  }
  return { pixels, w: W, h: H, bg: SCREEN_PROFILES.oled096.svgBg };
}

// ─── E-Ink 2.7" BW Waveshare V2 ───────────────────────────────────────────────
// Buffer driver 176×264 avec rotation 90° CCW appliquée, bit=0 → noir
function decodeEink27(bufferB64: string, fg: string): Decoded {
  const W = 264, H = 176;
  const bytesPerRow = 22;
  const buf = b64ToBytes(bufferB64);
  const pixels: Pixel[] = [];
  for (let bufRow = 0; bufRow < 264; bufRow++) {
    for (let bufCol = 0; bufCol < 176; bufCol++) {
      const byteIdx = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit     = 7 - (bufCol % 8);
      if (!((buf[byteIdx] >> bit) & 1))
        pixels.push({ x: bufRow, y: 175 - bufCol, color: fg });
    }
  }
  return { pixels, w: W, h: H, bg: SCREEN_PROFILES.eink27bw.svgBg };
}

// ─── E-Ink 2.9" BWR Waveshare V4 ──────────────────────────────────────────────
// Deux buffers 128×296, rotation 90° CCW, bit=0 → pixel actif
function decodeEink29(blackB64: string, redB64: string, fg: string, fg2: string): Decoded {
  const W = 296, H = 128;
  const bytesPerRow = 16;
  const blackBuf = b64ToBytes(blackB64);
  const redBuf   = b64ToBytes(redB64);
  const pixels: Pixel[] = [];
  for (let bufRow = 0; bufRow < 296; bufRow++) {
    for (let bufCol = 0; bufCol < 128; bufCol++) {
      const byteIdx = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit     = 7 - (bufCol % 8);
      const isBlack = !((blackBuf[byteIdx] >> bit) & 1);
      const isRed   = !((redBuf[byteIdx]   >> bit) & 1);
      if (isBlack || isRed)
        pixels.push({ x: bufRow, y: 127 - bufCol, color: isRed ? fg2 : fg });
    }
  }
  return { pixels, w: W, h: H, bg: SCREEN_PROFILES.eink29bwr.svgBg };
}

// ─── TFT 1.8" ST7735 128×160 RGB565 ──────────────────────────────────────────
// Buffer RGB565 little-endian, 40960 bytes — couleurs réelles
// Les pixels blancs (#ffffff ± marge) sont skippés (fond = background)
function decodeTft18(bufferB64: string, _fg: string): Decoded {
  const W = 128, H = 160;
  const buf = b64ToBytes(bufferB64);
  const pixels: Pixel[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const off    = (y * W + x) * 2;
      const rgb565 = buf[off] | (buf[off + 1] << 8);
      const r      = ((rgb565 >> 11) & 0x1F) << 3;
      const g      = ((rgb565 >> 5)  & 0x3F) << 2;
      const b      = (rgb565 & 0x1F) << 3;
      // Skip pixels quasi-blancs (fond)
      if (r > 230 && g > 230 && b > 230) continue;
      const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      pixels.push({ x, y, color: hex });
    }
  }
  return { pixels, w: W, h: H, bg: SCREEN_PROFILES.tft18.svgBg };
}

// ─── Builder SVG ──────────────────────────────────────────────────────────────
function buildSVG({ pixels, w, h, bg }: Decoded, scale: number): string {
  const sw = w * scale;
  const sh = h * scale;
  const rects = pixels
    .map(({ x, y, color }) =>
      `<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="${color}"/>`
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}">` +
    `<rect width="${sw}" height="${sh}" fill="${bg}"/>` +
    rects +
    `</svg>`
  );
}

// ─── Point d'entrée public ────────────────────────────────────────────────────
export function generatePixelSVGFromBuffer(
  screen: string,
  black:  string | undefined,
  red:    string | undefined,
  buffer: string | undefined,
  scale  = 2,
): string | null {
  try {
    const profile = SCREEN_PROFILES[screen as keyof typeof SCREEN_PROFILES];
    const fg  = profile?.svgFg  ?? "#000000";
    const fg2 = profile?.svgFg2 ?? "#cc0000";

    let decoded: Decoded;

    if (screen === "oled096" && buffer)
      decoded = decodeOled(buffer, fg);
    else if (screen === "eink27bw" && buffer)
      decoded = decodeEink27(buffer, fg);
    else if (screen === "eink29bwr" && black && red)
      decoded = decodeEink29(black, red, fg, fg2);
    else if (screen === "tft18" && buffer)
      decoded = decodeTft18(buffer, fg);
    else
      return null;

    return buildSVG(decoded, scale);
  } catch {
    return null;
  }
}
