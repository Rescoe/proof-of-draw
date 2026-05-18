// lib/svgExport.ts
// Génération SVG pixel-art à partir des buffers ESP (Node.js / Edge).
// Miroir de screenToCanvas.ts mais sans ImageData — compatible serveur.

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

type Pixel = { x: number; y: number; color: string };
type Decoded = { pixels: Pixel[]; w: number; h: number; bg: string };

function decodeOled(bufferB64: string): Decoded {
  const W = 128, H = 64;
  const buf = b64ToBytes(bufferB64);
  const pixels: Pixel[] = [];
  for (let y = 0; y < H; y++) {
    const page = Math.floor(y / 8);
    const bit  = y % 8;
    for (let x = 0; x < W; x++) {
      const byteIdx = page * 128 + x;
      if ((buf[byteIdx] >> bit) & 1) pixels.push({ x, y, color: "#00ff88" });
    }
  }
  return { pixels, w: W, h: H, bg: "#000000" };
}

function decodeEink27(bufferB64: string): Decoded {
  const W = 264, H = 176;
  const bytesPerRow = 22;
  const buf = b64ToBytes(bufferB64);
  const pixels: Pixel[] = [];
  for (let bufRow = 0; bufRow < 264; bufRow++) {
    for (let bufCol = 0; bufCol < 176; bufCol++) {
      const byteIdx = bufRow * bytesPerRow + Math.floor(bufCol / 8);
      const bit     = 7 - (bufCol % 8);
      if (!((buf[byteIdx] >> bit) & 1)) pixels.push({ x: bufRow, y: 175 - bufCol, color: "#000000" });
    }
  }
  return { pixels, w: W, h: H, bg: "#ffffff" };
}

function decodeEink29(blackB64: string, redB64: string): Decoded {
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
      if (isBlack || isRed) pixels.push({ x: bufRow, y: 127 - bufCol, color: isRed ? "#cc0000" : "#000000" });
    }
  }
  return { pixels, w: W, h: H, bg: "#ffffff" };
}

function buildSVG({ pixels, w, h, bg }: Decoded, scale: number): string {
  const sw = w * scale;
  const sh = h * scale;
  const rects = pixels.map(({ x, y, color }) =>
    `<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="${color}"/>`
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}">` +
    `<rect width="${sw}" height="${sh}" fill="${bg}"/>` +
    rects +
    `</svg>`
  );
}

export function generatePixelSVGFromBuffer(
  screen: string,
  black:  string | undefined,
  red:    string | undefined,
  buffer: string | undefined,
  scale  = 2,
): string | null {
  try {
    let decoded: Decoded;
    if (screen === "oled096" && buffer)             decoded = decodeOled(buffer);
    else if (screen === "eink27bw" && buffer)       decoded = decodeEink27(buffer);
    else if (screen === "eink29bwr" && black && red) decoded = decodeEink29(black, red);
    else return null;
    return buildSVG(decoded, scale);
  } catch {
    return null;
  }
}
