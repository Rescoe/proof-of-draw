// lib/cartelZones.ts — ZONES DU CARTEL : lignes du canvas que le firmware EFFACE pour y graver le cartel (Lot 7.1, docs/SPEC_LOT_7_CARTELS_RENDU_2026_10_07.md). Pur, sans Redis ni DOM.
//
// Constat [C — lu dans les firmwares] : les e-ink 2,9″ / 2,7″ et le TFT 1,8″ grave le cartel (date + n° de bloc en haut, artiste + titre en bas) PAR-DESSUS l'œuvre, après réception de l'image :
// les lignes des bandes sont blanchies puis un séparateur est tracé. Tout ce que l'artiste y dessine est perdu à l'affichage (l'image du bloc, elle, reste complète : les votes et les hashes
// portent sur l'image AVANT gravure). Les ports ne sont pas strictement identiques (séparateur à la ligne BAND ou BAND-1) : la zone retenue ici est l'UNION, donc CONSERVATRICE — ce qui est
// annoncé « sûr » l'est sur tous les firmwares du dépôt. Aucune mesure sur écran : géométrie lue dans le code.
//
//   écran            canvas     firmware ESP8266                    firmware UNO R4                  zone retenue (union)        lignes sûres
//   eink29bwr        296×128    haut 0..13 · bas 114..127           haut 0..13 · bas 114..127       haut 0..13 · bas 114..127   14..113  (100)
//   eink27bw         264×176    haut 0..12 · bas 163..175           haut 0..13 · bas 162..175       haut 0..13 · bas 162..175   14..161  (148)
//   tft18            128×160    haut 0..14 · bas 146..159           haut 0..12 · bas 146..159       haut 0..14 · bas 146..159   15..145  (131)
//   oled096, tft28   —          aucun cartel gravé dans l'image (tft28 : cartel affiché/caché au toucher)
//
// Les valeurs par firmware (FIRMWARE_CARTEL) servent de DONNÉES DE TEST : tests/cartelZones.test.ts relit les sources .ino et vérifie que ces lignes y sont bien.

import type { ScreenId } from "@/lib/screenProfiles";
import { rgbaToScreenPayload } from "@/lib/canvasToScreen";
import type { ScreenPayload } from "@/lib/screenToCanvas";

/** Bande de lignes du canvas (bornes incluses). */
export interface CartelBand { y0: number; y1: number }
export interface CartelZones {
  screen: ScreenId;
  canvasW: number; canvasH: number;
  top: CartelBand; bottom: CartelBand;
  /** lignes que le cartel n'efface jamais */
  safe: CartelBand & { h: number };
  /** libellé court pour l'interface */
  label: string;
}

/** Ce que chaque firmware efface réellement (lu dans les sources) : sert de référence aux tests. */
export const FIRMWARE_CARTEL: Record<string, { screen: ScreenId; top: CartelBand; bottom: CartelBand }> = {
  "esp8266/esp_eink_2.9BWR": { screen: "eink29bwr", top: { y0: 0, y1: 13 }, bottom: { y0: 114, y1: 127 } },
  "arduino_uno_r4/pod_uno_r4_eink29": { screen: "eink29bwr", top: { y0: 0, y1: 13 }, bottom: { y0: 114, y1: 127 } },
  "esp8266/esp_eink_2.7BW": { screen: "eink27bw", top: { y0: 0, y1: 12 }, bottom: { y0: 163, y1: 175 } },
  "esp8266/esp_eink_2.7BW_OLED": { screen: "eink27bw", top: { y0: 0, y1: 12 }, bottom: { y0: 163, y1: 175 } },
  "arduino_uno_r4/pod_uno_r4_eink27": { screen: "eink27bw", top: { y0: 0, y1: 13 }, bottom: { y0: 162, y1: 175 } },
  "arduino_uno_r4/pod_uno_r4_eink27_oled": { screen: "eink27bw", top: { y0: 0, y1: 13 }, bottom: { y0: 162, y1: 175 } },
  "esp8266/esp_tft1.8": { screen: "tft18", top: { y0: 0, y1: 14 }, bottom: { y0: 146, y1: 159 } },
  "arduino_uno_r4/pod_uno_r4_tft18": { screen: "tft18", top: { y0: 0, y1: 12 }, bottom: { y0: 146, y1: 159 } },
};

const zones = (screen: ScreenId, canvasW: number, canvasH: number, top: CartelBand, bottom: CartelBand, label: string): CartelZones => ({
  screen, canvasW, canvasH, top, bottom, safe: { y0: top.y1 + 1, y1: bottom.y0 - 1, h: bottom.y0 - 1 - (top.y1 + 1) + 1 }, label,
});

const TABLE: Partial<Record<ScreenId, CartelZones>> = {
  eink29bwr: zones("eink29bwr", 296, 128, { y0: 0, y1: 13 }, { y0: 114, y1: 127 }, "Cartel de l'e-ink 2,9″"),
  eink27bw: zones("eink27bw", 264, 176, { y0: 0, y1: 13 }, { y0: 162, y1: 175 }, "Cartel de l'e-ink 2,7″"),
  tft18: zones("tft18", 128, 160, { y0: 0, y1: 14 }, { y0: 146, y1: 159 }, "Cartel du TFT 1,8″"),
};

/** Zones du cartel d'un écran, ou `null` si son image ne reçoit pas de cartel gravé (OLED, TFT 2,8″). */
export const cartelZonesFor = (screen: ScreenId): CartelZones | null => TABLE[screen] ?? null;

/** La ligne `y` du canvas est-elle sous une bande du cartel ? */
export function cartelBandAt(z: CartelZones, y: number): "top" | "bottom" | null {
  if (y >= z.top.y0 && y <= z.top.y1) return "top";
  if (y >= z.bottom.y0 && y <= z.bottom.y1) return "bottom";
  return null;
}

export interface CartelUsage {
  /** pixels dessinés (ceux qui deviennent NOIRS ou ROUGES sur e-ink, ≠ blanc RGB565 sur TFT) sous les bandes du cartel */
  underCartel: number;
  /** pixels dessinés au total */
  drawn: number;
  /** part des pixels dessinés qui sera effacée (0..1) ; 0 si rien n'est dessiné */
  share: number;
  top: number; bottom: number;
}

// ─── Comptage : QUANTIFICATION RÉELLE de chaque écran (aucun seuil de couleur propre à ce module) ─────────────────────────────────────────────────────────────────────────────────────────────
// Un pixel « dessiné » est un pixel qui, APRÈS l'encodage envoyé à l'écran (rgbaToScreenPayload, celui du vote et de la diffusion), n'est pas du blanc : e-ink = noir ou rouge (luminance < 128, ou
// rouge franc), TFT = mot RGB565 ≠ 0xFFFF. Un gris très clair devient blanc sur l'e-ink (non compté) ; sur le TFT, #F8F8F8 reste un pixel visible (compté). On encode l'image entière, puis l'image dont
// seules les lignes d'une bande sont conservées (le reste en blanc opaque) : la différence est le nombre de pixels perdus, sans connaître la disposition des octets de chaque pilote.
function bytesOf(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const zeroBits = (b: Uint8Array) => { let n = 0; for (const v of b) { let x = (~v) & 0xff; while (x) { n += x & 1; x >>= 1; } } return n; };

/** Nombre de pixels non blancs d'une charge utile encodée (e-ink : bits à 0 du plan noir et du plan rouge ; TFT : mots RGB565 ≠ 0xFFFF). */
function drawnIn(p: ScreenPayload): number {
  switch (p.screen) {
    case "eink27bw": return zeroBits(bytesOf(p.buffer));
    case "eink29bwr": return zeroBits(bytesOf(p.black)) + zeroBits(bytesOf(p.red));
    case "tft18": case "tft28": { const b = bytesOf(p.buffer); let n = 0; for (let i = 0; i + 1 < b.length; i += 2) if (b[i] !== 0xff || b[i + 1] !== 0xff) n++; return n; }
    default: return 0;
  }
}

/** Copie de l'image où seules les lignes retenues sont conservées (le reste : blanc opaque). */
function keepRows(rgba: ArrayLike<number>, width: number, height: number, keep: (y: number) => boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) if (keep(y)) for (let i = y * width * 4, e = i + width * 4; i < e; i++) out[i] = rgba[i];
  return out;
}

/**
 * Compte les pixels qui seront effacés par le cartel, avec la quantification RÉELLE de l'écran (voir ci-dessus). `rgba` = image du canvas (largeur × hauteur × 4). Retourne `null` si l'écran n'a pas de
 * cartel gravé, si les dimensions ne correspondent pas au profil ou si l'encodage échoue (jamais un faux zéro).
 */
export function countUnderCartel(screen: ScreenId, rgba: ArrayLike<number>, width: number, height: number): CartelUsage | null {
  const z = cartelZonesFor(screen);
  if (!z || width !== z.canvasW || height !== z.canvasH || rgba.length !== width * height * 4) return null;
  try {
    const drawn = drawnIn(rgbaToScreenPayload(rgba, screen));
    const top = drawnIn(rgbaToScreenPayload(keepRows(rgba, width, height, (y) => cartelBandAt(z, y) === "top"), screen));
    const bottom = drawnIn(rgbaToScreenPayload(keepRows(rgba, width, height, (y) => cartelBandAt(z, y) === "bottom"), screen));
    const under = top + bottom;
    return { underCartel: under, drawn, share: drawn === 0 ? 0 : under / drawn, top, bottom };
  } catch { return null; }
}
