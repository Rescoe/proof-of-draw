// pod_oled_stream.h — lecture EN FLUX d'un clip PBC1 sur l'OLED SSD1306 128×64 AUXILIAIRE d'un e-ink BWR 2,9″ (ESP8266) — 29/10/2026.
//
// POURQUOI. Le lecteur résident du multiscreen (pod_anim_esp.h) charge le clip ENTIER (jusqu'à 9 Ko) puis une image de 1 Ko en RAM : trop pour un BWR dont le tas est déjà entamé
// (OLED ≈ 2,7 Ko, TLS BearSSL, portail, OTA). Ici le clip reste en FLASH (LittleFS) : la RAM de lecture est UN tampon de 256 octets, QUELLE QUE SOIT la taille du clip. L'image courante n'a PAS
// de copie : le tampon de l'OLED (celui d'Adafruit_SSD1306, déjà alloué) EST l'image — chaque octet remplacé par une transition est écrit directement dans ses pages (un octet PBC1 = 8 pixels d'une ligne,
// un octet SSD1306 = 8 pixels d'une colonne : la conversion se fait pixel par pixel). Les transitions de PBC1 REMPLACENT des octets (elles ne les combinent pas) : aucune image précédente n'est nécessaire.
//
// FORMAT et validation : pod_bench.h / pod_bench_stream.h (INCHANGÉS, mêmes codes d'erreur que podbench::parse, différentiel sur l'hôte). Ce fichier ne fait QUE lire une source déjà validée.
// Lecture COOPÉRATIVE : Player::tick() fait AU PLUS une transition par appel et mémorise sa position ; l'appelant reprend la main entre deux transitions (réseau, vote, capteur d'abord).
//
// Aucune dépendance Arduino : la source `S` expose `bool read(uint8_t*, size_t)` (exactement n octets, séquentiel) et `bool seek(uint32_t)` ; `show()` pousse le tampon vers l'écran.
// Compilé et testé sur l'hôte (g++ + faux écran) ; jamais essayé sur un OLED réel avant le canari de banc.
#ifndef POD_OLED_STREAM_H
#define POD_OLED_STREAM_H

#include "pod_bench.h"
#include "pod_bench_stream.h"

#define PODOLED_BUF 256u                               // seul tampon de lecture : ≥ 255 (un run) et diviseur de 1 024 (l'image 0 se lit par quarts)

namespace podoled {

enum Tick : uint8_t { T_WAIT = 0, T_SHOWN = 1, T_DONE = 2, T_IO = 3 };

/** Écrit l'octet PBC1 `v` (8 pixels d'une ligne, MSB à gauche, bit 1 = allumé) à la position `off` (ligne = off / 16) dans le tampon page-major de l'OLED (octet = x + 128 · (y / 8), bit = y % 8). */
inline void putByte(uint8_t* ssd, int off, uint8_t v) {
  const int y = off >> 4, bx = (off & 15) << 3;
  uint8_t* col = ssd + ((y >> 3) << 7) + bx;
  const uint8_t m = (uint8_t)(1u << (y & 7));
  for (int i = 0; i < 8; i++) { if (v & (0x80u >> i)) col[i] |= m; else col[i] &= (uint8_t)~m; }
}

/** Image 0 → tampon de l'OLED (lue par quarts de 256 octets). */
template <class S>
inline bool paintFrame0(S& s, uint32_t offFrame0, uint8_t* ssd, uint8_t* buf) {
  if (!s.seek(offFrame0)) return false;
  for (int o = 0; o < podbench::FRAME_BYTES; o += (int)PODOLED_BUF) {
    if (!s.read(buf, PODOLED_BUF)) return false;
    for (int i = 0; i < (int)PODOLED_BUF; i++) putByte(ssd, o + i, buf[i]);
  }
  return true;
}

/** Applique UNE transition à la position courante de la source ; `*delay` = son délai (× 10 ms), `*used` = octets lus. false si la source échoue ou si un run sort de l'image (impossible sur un clip validé). */
template <class S>
inline bool applyTransition(S& s, uint8_t* ssd, uint8_t* buf, uint8_t* delay, uint32_t* used) {
  uint8_t h[3];
  if (!s.read(h, 3)) return false;
  *delay = h[0];
  const uint16_t runs = podbench::rd16(h + 1);
  uint32_t n = 3;
  for (uint16_t r = 0; r < runs; r++) {
    if (!s.read(h, 3)) return false;
    const int off = podbench::rd16(h), len = h[2];
    if (len < 1 || off + len > podbench::FRAME_BYTES || !s.read(buf, (size_t)len)) return false;
    for (int i = 0; i < len; i++) putByte(ssd, off + i, buf[i]);
    n += 3 + (uint32_t)len;
  }
  *used = n;
  return true;
}

/**
 * Lecteur incrémental. Séquence (identique à podbench::playStream) : image 0, puis pour chaque boucle : [si ce n'est pas la première : la transition de RETOUR (la dernière du fichier)] puis les
 * transitions 1 … F-1 ; boucles finies : arrêt sur la dernière image. `delay` suit CHAQUE image affichée (en ms).
 */
struct Player {
  podbench::StreamInfo c;
  uint32_t pos = 0;            // décalage de la prochaine transition dans le fichier
  uint16_t k = 0;              // transitions « avant » déjà appliquées dans la boucle courante (0 … F-1)
  uint16_t loopNo = 0;
  uint32_t dueMs = 0;          // heure (millis) de la prochaine transition
  bool started = false, done = false;

  void reset(const podbench::StreamInfo& info) { c = info; pos = c.offTrans; k = 0; loopNo = 0; started = false; done = false; }

  /** Affiche l'image 0 (premier appel, ou reprise après une panne d'affichage). */
  template <class S, class Show>
  Tick start(S& s, uint8_t* ssd, uint8_t* buf, Show&& show, uint32_t now) {
    if (!paintFrame0(s, c.offFrame0, ssd, buf)) return T_IO;
    show();
    pos = c.offTrans; k = 0; loopNo = 0; started = true;
    done = (c.frames == 1);                              // image fixe : rien à animer
    dueMs = now + (uint32_t)c.delay0 * 10u;
    return done ? T_DONE : T_SHOWN;
  }

  /** Une transition si l'heure est venue. T_WAIT : pas encore ; T_SHOWN : une image de plus affichée ; T_DONE : boucles finies ; T_IO : la source a échoué. */
  template <class S, class Show>
  Tick tick(S& s, uint8_t* ssd, uint8_t* buf, Show&& show, uint32_t now) {
    if (!started) return start(s, ssd, buf, show, now);
    if (done) return T_DONE;
    if ((int32_t)(now - dueMs) < 0) return T_WAIT;
    const bool isReturn = (k == c.frames - 1);          // après F-1 transitions « avant » : la suivante est le RETOUR à l'image 0
    if (!s.seek(pos)) return T_IO;
    uint8_t d = 0; uint32_t used = 0;
    if (!applyTransition(s, ssd, buf, &d, &used)) return T_IO;
    show();
    pos += used;
    if (isReturn) { pos = c.offTrans; k = 0; loopNo++; }
    else {
      k++;
      if (c.loops != 0 && loopNo == (uint16_t)(c.loops - 1) && k == c.frames - 1) done = true;     // dernière boucle : arrêt sur l'image F-1 (comme playStream)
    }
    const uint32_t step = (uint32_t)d * 10u;
    dueMs += step;
    if ((int32_t)(now - dueMs) > 500) dueMs = now + step;   // retard > 0,5 s (tâche réseau) : on reprend sans rattraper
    return done ? T_DONE : T_SHOWN;
  }
};

}  // namespace podoled

#endif  // POD_OLED_STREAM_H
