import { ScreenId, SCREEN_PROFILES } from "@/lib/screenProfiles";

export type ScreenPayload =
  | { screen: "oled096" | "eink27bw" | "tft18"; buffer: string }
  | { screen: "eink29bwr"; black: string; red: string };

function uint8ArrayToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

function classifyPixel(r: number, g: number, b: number): "black" | "red" | "white" {
  if (r > 150 && g < 100 && b < 100) return "red";
  const lum = (r * 3 + g * 6 + b) / 10;
  return lum < 128 ? "black" : "white";
}

export function canvasToScreenPayload(
  canvas: HTMLCanvasElement,
  screenId: ScreenId
): ScreenPayload {
  const profile = SCREEN_PROFILES[screenId];
  if (!profile) throw new Error(`Unknown screen profile: ${screenId}`);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  const w = profile.width;
  const h = profile.height;
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;

  // ════════════════════════════════════════════════════════════════
  // OLED 0.96" — SSD1306, 128×64
  // Buffer page-major : 128 * 64 / 8 = 1024 bytes
  // bit=1 => pixel allumé
  // ════════════════════════════════════════════════════════════════
if (screenId === "oled096") {
  const OLED_W = 128;
  const OLED_H = 64;
  const BUF_SIZE = (OLED_W * OLED_H) / 8; // 1024

  if (w !== OLED_W || h !== OLED_H) {
    throw new Error(
      `oled096 canvas size mismatch: got ${w}x${h}, expected ${OLED_W}x${OLED_H}`
    );
  }

  const buffer = new Uint8Array(BUF_SIZE).fill(0x00);
  let litPixels = 0;

  for (let y = 0; y < OLED_H; y++) {
    for (let x = 0; x < OLED_W; x++) {
      const i = (y * OLED_W + x) * 4;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const a = px[i + 3];

      // 1. Transparent = fond vide = éteint
      if (a < 32) continue;

      // 2. Pixel sombre opaque = allumé
      const lum = (r * 3 + g * 6 + b) / 10;
      const isLit = lum < 128;
      if (!isLit) continue;

      const page = Math.floor(y / 8);
      const bit = y % 8;
      const byteIndex = page * OLED_W + x;

      buffer[byteIndex] |= (1 << bit);
      litPixels++;
    }
  }

  console.log(`[canvasToScreen oled096] ${litPixels} pixels allumés`);
  console.log(
    "[OLED BUFFER PREVIEW]",
    Array.from(buffer.slice(0, 16))
      .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
      .join(" ")
  );

  return {
    screen: "oled096",
    buffer: uint8ArrayToBase64(buffer),
  };
}
  // ════════════════════════════════════════════════════════════════
  // E-INK 2.7" BW — Waveshare epd2in7_V2, 264×176
  //
  // Buffer noir/blanc unique :
  // - largeur = 264
  // - hauteur = 176
  // - bytes par ligne = 264 / 8 = 33
  // - taille totale = 33 * 176 = 5808
  //
  // Convention Waveshare :
  // - 1 = blanc
  // - 0 = noir
  //
  // Mapping direct :
  // - canvas(x,y) => buffer(x,y)
  // - byteIndex = y * 33 + floor(x / 8)
  // - bit = 7 - (x % 8)
  // ════════════════════════════════════════════════════════════════
if (screenId === "eink27bw") {
  // Driver Waveshare 2.7" V2
  // Résolution logique driver : 176 (largeur buffer) × 264 (hauteur buffer)
  const EPD_W = 176;
  const EPD_H = 264;
  const bytesPerRow = EPD_W / 8; // 22
  const BUF_SIZE = bytesPerRow * EPD_H; // 5808

  const buffer = new Uint8Array(BUF_SIZE).fill(0xff);

  let blackPixels = 0;

  // Ton canvas profil est 264×176
  // On le mappe vers le buffer driver 176×264 avec rotation 90° CCW
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];

      const color = classifyPixel(r, g, b);
      if (color === "white") continue;

      // canvas(x, y) -> buffer(bufCol, bufRow)
      // Rotation 90° CCW
      const bufCol = 175 - y;         // 0..175
      const bufRow = x; // 0..263

      const byteIndex = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit = 7 - (bufCol % 8);

      if (byteIndex >= BUF_SIZE) continue;

      buffer[byteIndex] &= (~(1 << bit)) & 0xff;
      blackPixels++;
    }
  }

  console.log(`[canvasToScreen eink27bw] ${blackPixels} black pixels`);
  console.log(
    "[EINK27 BUFFER PREVIEW]",
    Array.from(buffer.slice(0, 16))
      .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
      .join(" ")
  );

  return {
    screen: "eink27bw",
    buffer: uint8ArrayToBase64(buffer),
  };
}

  // ════════════════════════════════════════════════════════════════
  // E-INK 2.9" BWR — Waveshare epd2in9b_V4, 296×128
  //
  // Driver portrait : 128 × 296
  // Buffers séparés black + red
  // Rotation 90° CCW :
  //   bufCol = y
  //   bufRow = w - 1 - x
  // ════════════════════════════════════════════════════════════════
  if (screenId === "eink29bwr") {
    const EPD_W = 128;
    const EPD_H = 296;
    const bytesPerRow = EPD_W / 8; // 16
    const BUF_SIZE = bytesPerRow * EPD_H; // 4736

    const blackBuf = new Uint8Array(BUF_SIZE).fill(0xff);
    const redBuf = new Uint8Array(BUF_SIZE).fill(0xff);

    let blackPixels = 0;
    let redPixels = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];

        const color = classifyPixel(r, g, b);
        if (color === "white") continue;

        const bufCol = 127-y;
        const bufRow = x;

        const byteIndex = bufRow * bytesPerRow + Math.floor(bufCol / 8);
        const bit = 7 - (bufCol % 8);
        if (byteIndex >= BUF_SIZE) continue;

        const mask = (~(1 << bit)) & 0xff;

        if (color === "black") {
          blackBuf[byteIndex] &= mask;
          blackPixels++;
        } else if (color === "red") {
          redBuf[byteIndex] &= mask;
          redPixels++;
        }
      }
    }

    console.log(
      `[canvasToScreen eink29bwr] ${blackPixels} black, ${redPixels} red`
    );
    console.log(
      "[EINK29 BLACK PREVIEW]",
      Array.from(blackBuf.slice(0, 16))
        .map((b) => `0x${b.toString(16).padStart(2, "0")}`)
        .join(" ")
    );

    return {
      screen: "eink29bwr",
      black: uint8ArrayToBase64(blackBuf),
      red: uint8ArrayToBase64(redBuf),
    };
  }

  // ════════════════════════════════════════════════════════════════
  // TFT 1.8" — ST7735, 128×160, RGB565 couleur complète
  //
  // Buffer RGB565 little-endian row-major :
  //   bytesPerPixel = 2
  //   taille totale = 128 × 160 × 2 = 40960 bytes
  //
  // Convention little-endian pour ESP8266 :
  //   byte[off]   = rgb565 & 0xFF        (low byte)
  //   byte[off+1] = (rgb565 >> 8) & 0xFF (high byte)
  //
  // Le firmware lit le buffer via writePixels((uint16_t*)rowBuf, 128) —
  // le hardware SPI envoie high byte en premier (MSB), conforme ST7735.
  // ════════════════════════════════════════════════════════════════
  if (screenId === "tft18") {
    const TFT_W = 128;
    const TFT_H = 160;
    const BUF_SIZE = TFT_W * TFT_H * 2; // 40960 bytes

    if (w !== TFT_W || h !== TFT_H) {
      throw new Error(
        `tft18 canvas size mismatch: got ${w}x${h}, expected ${TFT_W}x${TFT_H}`
      );
    }

    const buffer = new Uint8Array(BUF_SIZE);
    // Initialiser à blanc (0xFFFF little-endian = 0xFF, 0xFF)
    buffer.fill(0xFF);

    for (let y = 0; y < TFT_H; y++) {
      for (let x = 0; x < TFT_W; x++) {
        const pi = (y * TFT_W + x) * 4;
        const r = px[pi];
        const g = px[pi + 1];
        const b = px[pi + 2];
        const a = px[pi + 3];

        // Pixel transparent → blanc (fond)
        const rr = a < 32 ? 255 : r;
        const gg = a < 32 ? 255 : g;
        const bb = a < 32 ? 255 : b;

        // RGBA → RGB565 little-endian
        const r5    = (rr >> 3) & 0x1F;
        const g6    = (gg >> 2) & 0x3F;
        const b5    = (bb >> 3) & 0x1F;
        const rgb565 = (r5 << 11) | (g6 << 5) | b5;

        const off = (y * TFT_W + x) * 2;
        buffer[off]     = rgb565 & 0xFF;        // low byte
        buffer[off + 1] = (rgb565 >> 8) & 0xFF; // high byte
      }
    }

    console.log(`[canvasToScreen tft18] RGB565 ${BUF_SIZE} bytes`);
    return { screen: "tft18", buffer: uint8ArrayToBase64(buffer) };
  }

  throw new Error(`Unsupported screen: ${screenId}`);
}