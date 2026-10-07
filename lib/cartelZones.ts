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
  /** pixels dessinés (≠ fond blanc) dans les bandes du cartel */
  underCartel: number;
  /** pixels dessinés au total */
  drawn: number;
  /** part des pixels dessinés qui sera effacée (0..1) ; 0 si rien n'est dessiné */
  share: number;
  top: number; bottom: number;
}

/**
 * Compte les pixels DESSINÉS (opaques et non blancs) sous les bandes du cartel. `rgba` = image du canvas (largeur × hauteur × 4). Fond = blanc : un pixel blanc ne compte pas
 * (le cartel blanchit de toute façon). Retourne `null` si l'écran n'a pas de cartel gravé ou si les dimensions ne correspondent pas au profil.
 */
export function countUnderCartel(screen: ScreenId, rgba: ArrayLike<number>, width: number, height: number): CartelUsage | null {
  const z = cartelZonesFor(screen);
  if (!z || width !== z.canvasW || height !== z.canvasH || rgba.length !== width * height * 4) return null;
  let drawn = 0, top = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    const band = cartelBandAt(z, y);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 128) continue;
      if (rgba[i] > 245 && rgba[i + 1] > 245 && rgba[i + 2] > 245) continue;
      drawn++;
      if (band === "top") top++; else if (band === "bottom") bottom++;
    }
  }
  const under = top + bottom;
  return { underCartel: under, drawn, share: drawn === 0 ? 0 : under / drawn, top, bottom };
}
