// pod_scale.h — agrandissement ×1,5 « plus proche voisin » d'une image 128×160 vers la fenêtre 192×240 de l'écran 240×320.
//
// Le pixel source n occupe les colonnes [⌊3n/2⌋, ⌊3(n+1)/2⌋) : 1 pixel (n pair) ou 2 pixels (n impair), sans trou ni chevauchement.
// Conséquence : un RECTANGLE source (x, y, w, h) correspond exactement à la fenêtre [⌊3x/2⌋, ⌊3(x+w)/2⌋) × [⌊3y/2⌋, ⌊3(y+h)/2⌋),
// donc un rectangle sale agrandi redessine EXACTEMENT les pixels de l'image complète agrandie (somme télescopique).
// Aucune dépendance Arduino : compilé avec g++ et vérifié contre le moteur de référence (tests/podHttpR4.test.ts).

#ifndef POD_SCALE_H
#define POD_SCALE_H

#include <stdint.h>

namespace podscale {

static inline int up(int n) { return (3 * n) / 2; }

/** Ligne source (octets BIG-endian, n pixels à partir de la colonne x0) -> ligne agrandie. Retourne le nombre de pixels écrits. */
inline int scaleRowBE(const uint8_t* src, int x0, int n, uint16_t* dst) {
  uint8_t* d = (uint8_t*)dst;
  int o = 0;
  for (int i = 0; i < n; i++) {
    const int x = x0 + i, cnt = up(x + 1) - up(x);
    for (int k = 0; k < cnt; k++) { d[o++] = src[2 * i]; d[o++] = src[2 * i + 1]; }
  }
  return o / 2;
}

/** Ouvre sur l'écran la fenêtre qui correspond au rectangle source (rx, ry, rw, rh). */
template <class Tft>
inline void openWindow(Tft& tft, int artX, int artY, int rx, int ry, int rw, int rh) {
  tft.startWrite();
  tft.setAddrWindow(artX + up(rx), artY + up(ry), up(rx + rw) - up(rx), up(ry + rh) - up(ry));
}

/** Pousse la ligne source y (n pixels depuis x0) dans la fenêtre ouverte : agrandie, répétée 1 ou 2 fois. dstRow : au moins 2n pixels. */
template <class Tft>
inline void pushRow(Tft& tft, const uint8_t* srcBE, int x0, int n, int y, uint16_t* dstRow) {
  const int cols = scaleRowBE(srcBE, x0, n, dstRow);
  const int rows = up(y + 1) - up(y);
  for (int k = 0; k < rows; k++) tft.writePixels(dstRow, cols, true, true);
}

}  // namespace podscale

#endif  // POD_SCALE_H
