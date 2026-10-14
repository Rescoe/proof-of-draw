// pod_bench_stream.h — LOT8B2E (ANIM-STREAM-FIX1) : validation et lecture EN FLUX d'un clip PBC1 stocké sur la carte SD (UNO R4 WiFi + TFT 2.8").
//
// POURQUOI. Le canari TFT 2,8″ (FIX2) a montré `[ANIM] mémoire insuffisante pour la lecture` : le tas libre fait ≈ 8 Ko mais le plus grand bloc contigu ≈ 4,9 Ko, alors que
// l'ancien lecteur allouait le clip ENTIER (jusqu'à 9 216 o) puis 1 024 o de plus. Ce lecteur ne garde en RAM que l'image courante (1 024 o) et UN tampon de travail
// (PODBENCH_STREAM_BUF = 1 024 o) : 2 048 o au total, quelle que soit la taille du clip.
//
// CONTRAT. Le format PBC1 (pod_bench.h, lib/bench/clip.ts) et ses règles de validation sont INCHANGÉS : validateStream() rend EXACTEMENT le même code d'erreur que podbench::parse()
// sur le même octet-à-octet (différentiel exécuté sur l'hôte par tests/animStream.test.ts, y compris sur des clips corrompus). Ordre : en-tête, CRC (1re passe), structure (2e passe),
// retour à l'image 0 (comparaison octet par octet relue depuis la source). Une lecture qui échoue donne ERR_IO (jamais un clip « à moitié valide »).
// playStream() reproduit playWith() : mêmes appels au TFT, mêmes délais, mêmes boucles (différentiel contre podbench::play sur l'hôte).
//
// LE BUS SPI EST PARTAGÉ (carte SD + TFT) : aucune lecture de la source n'a lieu entre tft.startWrite() et tft.endWrite(). Une transition est donc lue PAR LOTS de runs entiers
// dans le tampon de travail, puis peinte dans UNE transaction par lot (une seule pour les transitions usuelles).
//
// Aucune dépendance Arduino : la source `S` expose `bool read(uint8_t*, size_t)` (exactement n octets, séquentiel) et `bool seek(uint32_t)`.
// Fichier propre au dossier pod_uno_r4 (non copié dans les autres firmwares). Compilé et testé sur l'hôte seulement : JAMAIS essayé sur la carte.
#ifndef POD_BENCH_STREAM_H
#define POD_BENCH_STREAM_H

#include "pod_bench.h"

#define PODBENCH_STREAM_BUF 1024u                       // tampon de travail : ≥ 3 + 255 + 3 (un run) ; 1 024 o = 3 runs maximaux par lot

namespace podbench {

static const Err ERR_IO = (Err)9;                       // lecture de la source impossible (hors enum : pod_bench.h reste inchangé)
inline const char* errNameStream(Err e) { return e == ERR_IO ? "IO" : errName(e); }

inline uint32_t crcBegin() { return 0xFFFFFFFFu; }
inline uint32_t crcUpdate(uint32_t c, const uint8_t* p, size_t n) {
  for (size_t i = 0; i < n; i++) { c ^= p[i]; for (int k = 0; k < 8; k++) c = (c & 1) ? (c >> 1) ^ 0xEDB88320u : (c >> 1); }
  return c;
}
inline uint32_t crcEnd(uint32_t c) { return ~c; }

/** Ce que le lecteur retient d'un clip validé (aucun pointeur dans le clip : il vit sur la carte). */
struct StreamInfo {
  uint16_t frames, transitions;
  uint8_t  loops, delay0;
  uint16_t fg, bg;
  uint32_t offFrame0;                                   // décalage des 1 024 octets de l'image 0
  uint32_t offTrans;                                    // décalage de la 1re transition
  uint32_t bodyEnd;                                     // fin du corps (début du CRC)
};

/**
 * Valide ENTIÈREMENT le clip de `n` octets (mêmes règles et mêmes codes que podbench::parse()). `cur` : 1 024 o de travail (reçoit l'image 0 puis l'état après chaque
 * transition) ; `buf` : PODBENCH_STREAM_BUF o. Le clip n'est lu que séquentiellement, deux fois, plus une relecture de l'image 0.
 */
template <class S>
inline Err validateStream(S& s, size_t n, StreamInfo& c, uint8_t* cur, uint8_t* buf) {
  if (n < (size_t)HEADER_BYTES + 4) return ERR_SHORT;
  if (!s.seek(0) || !s.read(buf, HEADER_BYTES)) return ERR_IO;
  const uint8_t* p = buf;
  if (memcmp(p, "PBC1", 4) != 0) return ERR_MAGIC;
  if (p[4] != 1) return ERR_VERSION;
  if (p[5] != W || p[6] != H || p[7] != 0 || p[11] != 0) return ERR_GEOM;
  const uint16_t frames = rd16(p + 8), trans = rd16(p + 16), body = rd16(p + 18);
  const uint8_t loops = p[10];
  if (frames < 1 || frames > MAX_FRAMES || loops > MAX_LOOPS) return ERR_COUNTS;
  if (trans != (frames > 1 ? frames : 0)) return ERR_COUNTS;
  if ((size_t)HEADER_BYTES + body + 4 != n) return ERR_SIZE;
  c.frames = frames; c.transitions = trans; c.loops = loops;
  c.fg = rd16(p + 12); c.bg = rd16(p + 14);
  const uint32_t bodyEnd = (uint32_t)HEADER_BYTES + body;

  // 1re passe : CRC de l'en-tête et du corps (le CRC est vérifié AVANT la structure, comme parse())
  uint32_t crc = crcBegin();
  uint32_t pos = 0;
  if (!s.seek(0)) return ERR_IO;
  while (pos < bodyEnd) {
    const size_t k = (bodyEnd - pos) < PODBENCH_STREAM_BUF ? (size_t)(bodyEnd - pos) : (size_t)PODBENCH_STREAM_BUF;
    if (!s.read(buf, k)) return ERR_IO;
    crc = crcUpdate(crc, buf, k); pos += (uint32_t)k;
  }
  if (!s.read(buf, 4)) return ERR_IO;
  if (rd32(buf) != crcEnd(crc)) return ERR_CRC;

  // 2e passe : structure
  if (body < 1 + FRAME_BYTES) return ERR_BODY;
  if (!s.seek(HEADER_BYTES) || !s.read(buf, 1)) return ERR_IO;
  const uint8_t d0 = buf[0];
  if (d0 < 2) return ERR_BODY;
  c.delay0 = d0;
  c.offFrame0 = (uint32_t)HEADER_BYTES + 1;
  c.offTrans = c.offFrame0 + FRAME_BYTES;
  c.bodyEnd = bodyEnd;
  if (!s.read(cur, FRAME_BYTES)) return ERR_IO;
  pos = c.offTrans;
  for (uint16_t i = 1; i <= trans; i++) {
    if (bodyEnd - pos < 3) return ERR_BODY;
    if (!s.read(buf, 3)) return ERR_IO;
    pos += 3;
    const uint8_t d = buf[0];
    if (d < 2) return ERR_BODY;
    const uint16_t runs = rd16(buf + 1);
    for (uint16_t r = 0; r < runs; r++) {
      if (bodyEnd - pos < 3) return ERR_BODY;
      if (!s.read(buf, 3)) return ERR_IO;
      pos += 3;
      const uint16_t off = rd16(buf); const uint8_t len = buf[2];
      if (len < 1 || (int)off + len > FRAME_BYTES || bodyEnd - pos < len) return ERR_BODY;
      if (!s.read(buf, len)) return ERR_IO;
      pos += len;
      memcpy(cur + off, buf, len);
    }
    if (i == trans) {                                   // la dernière transition ramène à l'image 0 (même délai, mêmes octets)
      if (d != d0) return ERR_BODY;
      if (!s.seek(c.offFrame0)) return ERR_IO;
      for (uint32_t o = 0; o < FRAME_BYTES; o += PODBENCH_STREAM_BUF) {
        const size_t k = (FRAME_BYTES - o) < PODBENCH_STREAM_BUF ? (size_t)(FRAME_BYTES - o) : (size_t)PODBENCH_STREAM_BUF;
        if (!s.read(buf, k)) return ERR_IO;
        if (memcmp(cur + o, buf, k) != 0) return ERR_BODY;
      }
    }
  }
  if (pos != bodyEnd) return ERR_BODY;
  return OK;
}

enum PlayEnd : uint8_t { PLAY_DONE = 0, PLAY_STOPPED = 1, PLAY_IO = 2 };

/**
 * Lit UNE transition à la position courante de la source, applique ses runs à `cur` et repeint les seuls octets modifiés (lots de runs entiers, une transaction TFT par lot).
 * Retourne false si la source échoue (ou si un run sort de l'image : impossible sur un clip validé).
 */
template <class Geo, class Tft, class S>
inline bool stepStream(S& s, Tft& tft, uint8_t* cur, uint8_t* buf, uint16_t fg, uint16_t bg, uint16_t* rowBuf, uint8_t* delay) {
  uint8_t h[3];
  if (!s.read(h, 3)) return false;
  *delay = h[0];
  const uint16_t runs = rd16(h + 1);
  uint16_t done = 0;
  while (done < runs) {
    size_t used = 0; uint16_t nb = 0;
    while (done + nb < runs && used + 3u + 255u <= PODBENCH_STREAM_BUF) {            // remplir le lot SANS toucher au TFT
      if (!s.read(buf + used, 3)) return false;
      const size_t len = buf[used + 2];
      if (len < 1 || !s.read(buf + used + 3, len)) return false;
      used += 3 + len; nb++;
    }
    if (nb == 0) return false;
    tft.startWrite();                                                                // une transaction par lot
    size_t q = 0;
    for (uint16_t r = 0; r < nb; r++) {
      int off = rd16(buf + q), len = buf[q + 2];
      q += 3;
      if (off + len > FRAME_BYTES) { tft.endWrite(); return false; }
      memcpy(cur + off, buf + q, len);
      q += len;
      while (len > 0) {                                                              // un run peut franchir une fin de ligne : coupé par ligne source
        const int y = off / ROW_BYTES, b0 = off % ROW_BYTES;
        const int seg = (ROW_BYTES - b0) < len ? (ROW_BYTES - b0) : len;
        paintSegment<Geo>(tft, cur, y, b0, seg, fg, bg, rowBuf);
        off += seg; len -= seg;
      }
    }
    tft.endWrite();
    done += nb;
  }
  return true;
}

/**
 * Joue le clip (déjà validé par validateStream) : image 0 entière, puis les transitions ; à chaque boucle suivante : retour à l'image 0 puis les transitions. Même séquence
 * d'appels au TFT et au hook que podbench::playWith(). hook(indexImageAffichée, délai ms) retourne false pour interrompre (PLAY_STOPPED).
 * PLAY_IO : la source a échoué en cours de lecture (carte retirée / erreur) ; l'écran peut être partiellement repeint.
 */
template <class Geo = GeoR4, class Tft, class S, class Hook>
inline PlayEnd playStream(S& s, const StreamInfo& c, uint8_t* cur, uint8_t* buf, Tft& tft, uint16_t* rowBuf, Hook&& hook) {
  if (!s.seek(c.offFrame0) || !s.read(cur, FRAME_BYTES)) return PLAY_IO;
  paintFull<Geo>(tft, cur, c.fg, c.bg, rowBuf);
  uint32_t shown = 0;
  if (!hook(shown++, (uint16_t)c.delay0 * 10)) return PLAY_STOPPED;
  if (c.frames == 1) {
    for (int l = 1; c.loops == 0 || l < c.loops; l++) if (!hook(shown++, (uint16_t)c.delay0 * 10)) return PLAY_STOPPED;
    return PLAY_DONE;
  }
  for (int l = 0; c.loops == 0 || l < c.loops; l++) {
    uint8_t d = 0;
    if (l > 0) {                                                                     // la source est à la transition de retour (fin de la boucle précédente)
      if (!stepStream<Geo>(s, tft, cur, buf, c.fg, c.bg, rowBuf, &d)) return PLAY_IO;
      if (!hook(shown++, (uint16_t)d * 10)) return PLAY_STOPPED;
      if (!s.seek(c.offTrans)) return PLAY_IO;
    }
    for (int i = 1; i < c.frames; i++) {
      if (!stepStream<Geo>(s, tft, cur, buf, c.fg, c.bg, rowBuf, &d)) return PLAY_IO;
      if (!hook(shown++, (uint16_t)d * 10)) return PLAY_STOPPED;
    }
  }
  return PLAY_DONE;
}

}  // namespace podbench

#endif  // POD_BENCH_STREAM_H
