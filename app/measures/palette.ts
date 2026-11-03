// app/measures/palette.ts — couleurs communes des vues de mesures (02/11/2026). Pigments de la palette de l'artiste (vault « Art Génératif / Palettes »), éclaircis pour tenir sur le fond sombre de l'application.
import { vocLevel, type MeasureKind } from "@/lib/measures";

export const KIND_COLOR: Record<MeasureKind, string> = {
  temp: "#e8845a",     // terre cuite
  hum: "#6fb3d9",      // ardoise claire
  vocidx: "#a98bff",   // violet sourd : la couleur vive est réservée à l'air
  voc: "#a98bff",
  rssi: "#7fc4a0",     // vert d'eau
  lat: "#e0c070",      // ocre
  dl: "#9fb0c8",
};

/** Bandes de niveaux de l'indice d'air (mêmes seuils que lib/measures.vocLevel), pour le fond des courbes. */
export const VOC_BANDS: { from: number; to: number; label: string; color: string }[] = [[0, 50], [50, 100], [100, 150], [150, 200], [200, 300], [300, 500]].map(([from, to]) => {
  const l = vocLevel(from + 1);
  return { from, to, label: l.label, color: l.color };
});
