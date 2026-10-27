// pod_oled_flash.h — stockage du clip d'animation de l'OLED auxiliaire en FLASH BRUTE, deux emplacements (29/10/2026).
//
// POURQUOI PAS UN SYSTÈME DE FICHIERS : la partition « fichiers » (0x200000 – 0x3FA000) du BWR porte DÉJÀ la frame sauvegardée de la surimpression capteur (3 secteurs à ENV_FLASH_BASE = 0x3F0000, flash brute).
// Monter un système de fichiers au même endroit le formaterait (perte de la frame) ou serait corrompu par elle ; il coûterait aussi ≈ 1,5 Ko de tas et ≈ 30 Ko de flash. Ici : deux emplacements de 3 secteurs
// (12 288 o) à OA_FLASH_BASE = 0x3E0000 (0x3E0000 – 0x3E5FFF), disjoints de la frame sauvegardée (testé), AUCUNE RAM de fichier.
//
// Emplacement : [0 .. 127] en-tête (écrit EN DERNIER, après les données), [128 .. 12 287] clip (≤ 9 216 o, plafond du serveur). Le clip précédent reste valide tant que le nouveau n'est pas entièrement écrit ET
// entièrement validé (validateStream, CRC PBC1) ; l'emplacement actif est celui dont l'en-tête est valide avec le plus grand numéro de séquence. Un en-tête déchiré (coupure pendant l'écriture) est ignoré.
//
// Aucune dépendance Arduino : la flash `F` expose `bool erase(uint32_t sector)`, `bool write(uint32_t addr, const uint8_t* p, size_t n)` (adresse et taille multiples de 4) et `bool read(uint32_t addr, uint8_t* p, size_t n)`.
#ifndef POD_OLED_FLASH_H
#define POD_OLED_FLASH_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define OA_FLASH_BASE  0x3E0000UL                       // slot 0 ; slot 1 = base + OA_SLOT_BYTES (0x3E3000)
#define OA_SECTOR      4096UL
#define OA_SLOT_BYTES  (3UL * OA_SECTOR)                // 12 288
#define OA_HDR         128UL
#define OA_DATA_MAX    12032UL                          // 47 blocs de 256 o (< 12 160 = place restante) ≥ 9 216
#define OA_WRITE_BLOCK 256u                             // écriture par blocs alignés de 256 o

namespace podoled {

struct SlotHdr {                                        // 128 octets
  char     magic[4];                                    // "OAN1"
  uint32_t seq;                                         // numéro de séquence (plus grand = plus récent)
  uint32_t bytes;                                       // taille du clip
  char     hash[64];                                    // bloc de l'animation (64 hex, sans NUL)
  uint8_t  pad[48];                                     // réservé (0xFF)
  uint32_t commit;                                      // 0x0A0A0A0A : écrit avec l'en-tête, en dernier
};
static_assert(sizeof(SlotHdr) == OA_HDR, "en-tete d'emplacement : 128 octets");
static const uint32_t OA_COMMIT = 0x0A0A0A0AUL;

inline uint32_t slotBase(int slot) { return OA_FLASH_BASE + (uint32_t)slot * OA_SLOT_BYTES; }

inline bool isHex64(const char* h) {
  for (int i = 0; i < 64; i++) { const char c = h[i]; if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false; }
  return true;
}

/** Lit l'en-tête d'un emplacement ; true si COMPLET et plausible (la validation du clip lui-même reste à faire). */
template <class F>
inline bool readHeader(F& fl, int slot, SlotHdr* h) {
  uint8_t raw[OA_HDR] __attribute__((aligned(4)));
  if (!fl.read(slotBase(slot), raw, OA_HDR)) return false;
  memcpy(h, raw, OA_HDR);
  return memcmp(h->magic, "OAN1", 4) == 0 && h->commit == OA_COMMIT && h->bytes >= 1 && h->bytes <= OA_DATA_MAX && isHex64(h->hash);
}

/** Emplacement actif (en-tête valide, séquence la plus grande) ; -1 s'il n'y en a aucun. */
template <class F>
inline int activeSlot(F& fl, SlotHdr* out) {
  SlotHdr h0, h1; const bool v0 = readHeader(fl, 0, &h0), v1 = readHeader(fl, 1, &h1);
  if (!v0 && !v1) return -1;
  const int s = (v0 && v1) ? ((int32_t)(h1.seq - h0.seq) > 0 ? 1 : 0) : (v0 ? 0 : 1);
  if (out) *out = s == 0 ? h0 : h1;
  return s;
}

/** Source de lecture (read / seek) sur le clip d'un emplacement : fenêtre alignée de 64 octets, aucune autre RAM. */
template <class F>
struct FlashSrc {
  F* fl; uint32_t base; uint32_t size; uint32_t pos;
  uint8_t win[64] __attribute__((aligned(4))); int32_t winAt;     // décalage (dans le clip) de la fenêtre chargée, -1 = aucune
  FlashSrc(F* f, int slot, uint32_t bytes) : fl(f), base(slotBase(slot) + OA_HDR), size(bytes), pos(0), winAt(-1) {}
  bool seek(uint32_t o) { if (o > size) return false; pos = o; return true; }
  bool read(uint8_t* p, size_t n) {
    if (pos + n > size) return false;
    while (n > 0) {
      const uint32_t at = pos & ~63u;
      if (winAt != (int32_t)at) { if (!fl->read(base + at, win, 64)) return false; winAt = (int32_t)at; }
      const uint32_t off = pos - at, take = (64u - off) < n ? (64u - off) : (uint32_t)n;
      memcpy(p, win + off, take); p += take; pos += take; n -= take;
    }
    return true;
  }
};

/** Écrit un clip dans l'emplacement INACTIF : efface les 3 secteurs, reçoit les octets (n'importe quel découpage), écrit l'en-tête EN DERNIER. Aucun octet de l'emplacement actif n'est touché. */
template <class F>
struct SlotWriter {
  F* fl; int slot; uint32_t total; uint32_t flushed; uint32_t fill;
  uint8_t blk[OA_WRITE_BLOCK] __attribute__((aligned(4)));
  SlotWriter(F* f, int s) : fl(f), slot(s), total(0), flushed(0), fill(0) {}
  bool begin() {
    for (uint32_t i = 0; i < 3; i++) if (!fl->erase(slotBase(slot) / OA_SECTOR + i)) return false;
    return true;
  }
  bool flushBlock() {
    if (fill == 0) return true;
    if (fill < OA_WRITE_BLOCK) memset(blk + fill, 0xFF, OA_WRITE_BLOCK - fill);
    if (flushed + OA_WRITE_BLOCK > OA_DATA_MAX) return false;
    if (!fl->write(slotBase(slot) + OA_HDR + flushed, blk, OA_WRITE_BLOCK)) return false;
    flushed += OA_WRITE_BLOCK; fill = 0;
    return true;
  }
  bool put(const uint8_t* p, size_t n) {
    if (total + n > OA_DATA_MAX) return false;
    while (n > 0) {
      const uint32_t take = (OA_WRITE_BLOCK - fill) < n ? (OA_WRITE_BLOCK - fill) : (uint32_t)n;
      memcpy(blk + fill, p, take); fill += take; p += take; n -= take; total += take;
      if (fill == OA_WRITE_BLOCK && !flushBlock()) return false;
    }
    return true;
  }
  /** Vide le dernier bloc partiel (complété par 0xFF). */
  bool finishData() { return flushBlock(); }
  /** Écrit l'en-tête (après validation du clip) : l'emplacement devient actif. */
  bool commit(const char* hash64, uint32_t seq) {
    SlotHdr h; memset(&h, 0xFF, sizeof h);
    memcpy(h.magic, "OAN1", 4); h.seq = seq; h.bytes = total; memcpy(h.hash, hash64, 64); h.commit = OA_COMMIT;
    return fl->write(slotBase(slot), (const uint8_t*)&h, OA_HDR);
  }
};

/** Efface l'en-tête de l'emplacement (premier secteur) : le clip n'est plus retrouvé au démarrage. */
template <class F>
inline bool dropSlot(F& fl, int slot) { return fl.erase(slotBase(slot) / OA_SECTOR); }

}  // namespace podoled

#endif  // POD_OLED_FLASH_H
