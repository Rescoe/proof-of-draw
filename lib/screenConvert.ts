// lib/screenConvert.ts
// Conversion d'un dessin déjà encodé pour un type d'écran vers le buffer d'un
// AUTRE type d'écran (ex. BWR → BW 2.7", TFT → BWR, OLED → TFT…).
//
// Chemin : buffer source → bitmap "espace canvas" (gris 0-255 + masque rouge
// optionnel) → encodeForScreen() cible. Les conventions de bits/rotation sont
// celles de lib/screenToCanvas.ts (décodage) et lib/screenEncode.ts (encodage),
// les mêmes que celles validées en prod — on NE passe PAS par
// lib/frameConverter.ts, qui traite les buffers e-ink comme du row-major sans
// tenir compte de la rotation driver.
//
// Sémantique : "encre" = noir OU rouge pour les cibles monochromes ; le rouge
// n'est conservé (canal rouge BWR / pixel rouge TFT) que si la cible sait le
// porter. Une source mono n'invente jamais de rouge.

import { encodeForScreen, type EncodedFrame } from "@/lib/screenEncode";
import { isValidScreenId, SCREEN_PROFILES, type ScreenId } from "@/lib/screenProfiles";

export interface ScreenBitmap {
  w: number;
  h: number;
  gray: Uint8Array;  // 0 = encre, 255 = blanc (espace canvas, row-major)
  red?: Uint8Array;  // 1 = pixel rouge (sous-ensemble des pixels d'encre)
}

type Payload = Record<string, unknown>;

const b64 = (s: unknown): Uint8Array => new Uint8Array(Buffer.from(String(s ?? ""), "base64"));

function decodeOled(p: Payload): ScreenBitmap {
  const W = 128, H = 64, buf = b64(p.buffer);
  const gray = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H; y++) {
    const page = Math.floor(y / 8), bit = y % 8;
    for (let x = 0; x < W; x++) if ((buf[page * W + x] >> bit) & 1) gray[y * W + x] = 0; // allumé = encre
  }
  return { w: W, h: H, gray };
}

function decodeEink27(p: Payload): ScreenBitmap {
  const W = 264, H = 176, bpr = 22, buf = b64(p.buffer);
  const gray = new Uint8Array(W * H).fill(255);
  for (let bufRow = 0; bufRow < 264; bufRow++) {
    for (let bufCol = 0; bufCol < 176; bufCol++) {
      if ((buf[bufRow * bpr + (bufCol >> 3)] >> (7 - (bufCol % 8))) & 1) continue; // 1 = blanc
      gray[(175 - bufCol) * W + bufRow] = 0;
    }
  }
  return { w: W, h: H, gray };
}

function decodeEink29(p: Payload): ScreenBitmap {
  const W = 296, H = 128, bpr = 16, blackBuf = b64(p.black), redBuf = b64(p.red);
  const gray = new Uint8Array(W * H).fill(255);
  const red  = new Uint8Array(W * H);
  for (let bufRow = 0; bufRow < 296; bufRow++) {
    for (let bufCol = 0; bufCol < 128; bufCol++) {
      const idx = bufRow * bpr + (bufCol >> 3), bit = 7 - (bufCol % 8);
      const isBlack = !((blackBuf[idx] >> bit) & 1);
      const isRed   = !((redBuf[idx] >> bit) & 1);
      if (!isBlack && !isRed) continue;
      const o = (127 - bufCol) * W + bufRow;
      gray[o] = 0;
      if (isRed) red[o] = 1;
    }
  }
  return { w: W, h: H, gray, red };
}

// TFT couleur : seuil de "blanc" volontairement large (lum < 200 = encre) pour
// ne pas perdre les aplats clairs (jaune, cyan…) d'un dessin en couleur.
function decodeTft(p: Payload): ScreenBitmap {
  const [W, H] = p.screen === "tft28" ? [240, 320] : [128, 160];
  const buf = b64(p.buffer);
  const gray = new Uint8Array(W * H).fill(255);
  const red  = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = buf[i * 2] | (buf[i * 2 + 1] << 8);
    const r = ((v >> 11) & 0x1f) << 3, g = ((v >> 5) & 0x3f) << 2, b = (v & 0x1f) << 3;
    const lum = (r * 77 + g * 150 + b * 29) >> 8;
    if (lum >= 200) continue;
    gray[i] = 0;
    if (r > 150 && g < 100 && b < 100) red[i] = 1;
  }
  return { w: W, h: H, gray, red };
}

/** Décode un payload (ANY screen) en bitmap espace-canvas, ou null si invalide/inconnu. */
export function decodePayloadToBitmap(payload: Payload): ScreenBitmap | null {
  try {
    switch (payload.screen) {
      case "oled096":   return decodeOled(payload);
      case "eink27bw":  return decodeEink27(payload);
      case "eink29bwr": return decodeEink29(payload);
      case "tft18":
      case "tft28":     return decodeTft(payload);
      default:          return null;
    }
  } catch { return null; }
}

// ── TFT → TFT : les COULEURS sont conservées ───────────────────────────────────
// Le chemin général passe par un bitmap « encre noire / rouge » (utile vers les écrans mono) : un dessin en couleur converti d'un
// TFT à l'autre (ex. 1.8" → 2.8" tactile) deviendrait noir, blanc et rouge, comme sur un e-ink. Entre deux écrans RGB565 on redimensionne
// donc les pixels EUX-MÊMES : même géométrie « letterbox » que le reste (fond blanc, centré, sans déformation) ; à l'agrandissement un
// pixel source est répété (le pixel-art reste net), à la réduction le pixel le plus sombre du bloc est gardé (un trait fin ne disparaît pas).
const RGB565_SCREENS = new Set<string>(["tft18", "tft28"]);

function rgb565Luma(v: number): number {
  const r = ((v >> 11) & 0x1f) << 3, g = ((v >> 5) & 0x3f) << 2, b = (v & 0x1f) << 3;
  return (r * 77 + g * 150 + b * 29) >> 8;
}

function convertRgb565(payload: Payload, source: ScreenId, target: ScreenId): (EncodedFrame & { screen: ScreenId }) | null {
  const sp = SCREEN_PROFILES[source], tp = SCREEN_PROFILES[target];
  const src = b64(payload.buffer);
  if (src.length !== sp.width * sp.height * 2) return null;
  const sw = sp.width, sh = sp.height, dw = tp.width, dh = tp.height;
  const out = new Uint8Array(dw * dh * 2).fill(0xff);                       // 0xFFFF = blanc
  const scale = Math.min(dw / sw, dh / sh);
  const fitW = Math.max(1, Math.round(sw * scale)), fitH = Math.max(1, Math.round(sh * scale));
  const offX = Math.floor((dw - fitW) / 2), offY = Math.floor((dh - fitH) / 2);
  for (let y = 0; y < fitH; y++) {
    const sy0 = Math.floor((y * sh) / fitH), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / fitH));
    for (let x = 0; x < fitW; x++) {
      const sx0 = Math.floor((x * sw) / fitW), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / fitW));
      let best = 0xffff, bestLuma = 256;
      for (let yy = sy0; yy < Math.min(sy1, sh); yy++) {
        for (let xx = sx0; xx < Math.min(sx1, sw); xx++) {
          const o = (yy * sw + xx) * 2, v = src[o] | (src[o + 1] << 8), l = rgb565Luma(v);
          if (l < bestLuma) { bestLuma = l; best = v; }
        }
      }
      const d = ((offY + y) * dw + offX + x) * 2;
      out[d] = best & 0xff; out[d + 1] = best >> 8;
    }
  }
  return { buffer: Buffer.from(out).toString("base64"), screen: target };
}

/** Convertit un payload vers `target`. null si source/cible inconnue. */
export function convertPayload(payload: Payload, target: string): (EncodedFrame & { screen: ScreenId }) | null {
  if (!isValidScreenId(target)) return null;
  const from = String(payload.screen ?? "");
  if (RGB565_SCREENS.has(from) && RGB565_SCREENS.has(target) && from !== target) {
    return convertRgb565(payload, from as ScreenId, target);   // couleurs conservées entre TFT
  }
  const bmp = decodePayloadToBitmap(payload);
  if (!bmp) return null;
  const enc = encodeForScreen(bmp.gray, bmp.w, bmp.h, target, bmp.red ? { red: bmp.red } : undefined);
  return { ...enc, screen: target };
}
