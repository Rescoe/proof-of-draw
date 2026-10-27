// oled_flash_harness.cpp — vérifie pod_oled_flash.h (deux emplacements de flash brute pour le clip de l'OLED auxiliaire du BWR) avec une FAUSSE flash qui applique la physique de la NOR :
// effacement par secteur de 4 096 o (→ 0xFF), écriture alignée sur 4 octets qui ne peut que mettre des bits à 0 (une écriture sur un octet déjà programmé est une ERREUR de test), lecture alignée.
//   oled_flash_harness <clipA.hex> <clipB.hex> <seed>
// Écrit « OK <nom> » ou « FAIL <nom> » par scénario ; « PLAY i crc » pour l'image i du clip actif relu depuis la flash (comparé par le test TypeScript à l'image attendue).
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <fstream>
#include <iterator>
#include "pod_oled_stream.h"
#include "pod_oled_flash.h"

struct FakeFlash {
  std::vector<uint8_t> m;                       // 4 Mo
  uint32_t failEraseAfter = 0xFFFFFFFFu, failWriteAfter = 0xFFFFFFFFu, erases = 0, writes = 0;
  bool violation = false;                       // écriture sur un octet déjà programmé, adresse ou taille non alignée
  FakeFlash() : m(4u * 1024 * 1024, 0xFF) {}
  bool erase(uint32_t sector) {
    if (erases++ >= failEraseAfter) return false;
    if ((sector + 1) * 4096u > m.size()) { violation = true; return false; }
    memset(&m[sector * 4096u], 0xFF, 4096); return true;
  }
  bool write(uint32_t addr, const uint8_t* p, size_t n) {
    if (writes++ >= failWriteAfter) return false;
    if ((addr & 3) || (n & 3) || ((uintptr_t)p & 3) || addr + n > m.size()) { violation = true; return false; }
    for (size_t i = 0; i < n; i++) { if (m[addr + i] != 0xFF && m[addr + i] != p[i] && (m[addr + i] & p[i]) != p[i]) violation = true; m[addr + i] &= p[i]; }
    return true;
  }
  bool read(uint32_t addr, uint8_t* p, size_t n) {
    if ((addr & 3) || (n & 3) || ((uintptr_t)p & 3) || addr + n > m.size()) { violation = true; return false; }
    memcpy(p, &m[addr], n); return true;
  }
};

static std::vector<uint8_t> loadHex(const char* path) {
  std::ifstream f(path); std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  std::vector<uint8_t> out;
  for (size_t i = 0; i + 1 < s.size(); i += 2) out.push_back((uint8_t)strtoul(s.substr(i, 2).c_str(), nullptr, 16));
  return out;
}
static uint32_t crc(const uint8_t* p, size_t n) { return podbench::crcEnd(podbench::crcUpdate(podbench::crcBegin(), p, n)); }
static uint32_t rs = 1;
static uint32_t rnd() { rs = rs * 1664525u + 1013904223u; return rs >> 8; }
static int bad = 0;
static void check(bool ok, const char* name) { std::printf("%s %s\n", ok ? "OK" : "FAIL", name); if (!ok) bad++; }

static const char* HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static const char* HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Écrit `clip` dans `slot` par morceaux de taille irrégulière ; commit seulement si `doCommit`. */
static bool store(FakeFlash& fl, int slot, const std::vector<uint8_t>& clip, const char* hash, uint32_t seq, bool doCommit) {
  podoled::SlotWriter<FakeFlash> w(&fl, slot);
  if (!w.begin()) return false;
  size_t i = 0;
  while (i < clip.size()) { size_t n = 1 + rnd() % 200; if (i + n > clip.size()) n = clip.size() - i; if (!w.put(&clip[i], n)) return false; i += n; }
  if (!w.finishData()) return false;
  podbench::StreamInfo info; uint8_t cur[podbench::FRAME_BYTES], vb[PODBENCH_STREAM_BUF];
  podoled::FlashSrc<FakeFlash> src(&fl, slot, (uint32_t)clip.size());
  if (podbench::validateStream(src, clip.size(), info, cur, vb) != podbench::OK) return false;
  return doCommit ? w.commit(hash, seq) : true;
}

int main(int argc, char** argv) {
  if (argc < 5) return 2;
  const std::vector<uint8_t> A = loadHex(argv[1]), B = loadHex(argv[2]), BIG = loadHex(argv[4]);
  rs = (uint32_t)atoi(argv[3]);
  check(OA_FLASH_BASE >= 0x200000UL && OA_FLASH_BASE + 2 * OA_SLOT_BYTES <= 0x3EFFFFUL + 1, "régions : dans la partition de fichiers, au-dessous de la frame sauvegardée (0x3F0000)");
  check(OA_FLASH_BASE + 2 * OA_SLOT_BYTES <= 0x3F0000UL, "disjoint de ENV_FLASH_BASE");
  check(OA_DATA_MAX >= 9216 && OA_HDR + OA_DATA_MAX <= OA_SLOT_BYTES && (OA_DATA_MAX % OA_WRITE_BLOCK) == 0, "capacité : le plafond du serveur (9 216 o) tient, blocs entiers");
  check(A.size() <= OA_DATA_MAX && B.size() <= OA_DATA_MAX, "les clips d'essai tiennent");

  FakeFlash fl; podoled::SlotHdr h;
  check(podoled::activeSlot(fl, &h) == -1, "flash vierge : aucun emplacement actif");

  // 1. A dans l'emplacement 0, actif seulement après le commit
  check(store(fl, 0, A, HASH_A, 1, false), "A écrit et validé SANS en-tête");
  check(podoled::activeSlot(fl, &h) == -1, "sans en-tête : toujours aucun actif (le clip n'est pas encore activé)");
  { podoled::SlotWriter<FakeFlash> w(&fl, 0); (void)w; }
  podoled::SlotHdr hh; memset(&hh, 0xFF, sizeof hh);
  { podoled::SlotWriter<FakeFlash> w(&fl, 0); w.total = (uint32_t)A.size(); check(w.commit(HASH_A, 1), "en-tête de A écrit en dernier"); }
  check(podoled::activeSlot(fl, &h) == 0 && h.seq == 1 && h.bytes == A.size() && memcmp(h.hash, HASH_A, 64) == 0, "A actif : emplacement 0, séquence 1, taille et hash conservés");
  check(!fl.violation, "aucune violation de la physique de la flash (A)");

  // 2. relecture octet par octet par la source en flux, positions et tailles de lecture quelconques
  {
    podoled::FlashSrc<FakeFlash> src(&fl, 0, (uint32_t)A.size());
    bool ok = true; uint8_t buf[300];
    for (int k = 0; k < 400 && ok; k++) {
      const uint32_t off = rnd() % A.size(); const size_t n = 1 + rnd() % 299;
      if (off + n > A.size()) continue;
      ok = src.seek(off) && src.read(buf, n) && memcmp(buf, &A[off], n) == 0;
    }
    check(ok, "FlashSrc : lectures aléatoires == clip d'origine");
    check(!src.seek((uint32_t)A.size() + 1) && src.seek((uint32_t)A.size()) && !src.read(buf, 1), "FlashSrc : refuse de lire au-delà du clip");
  }

  // 3. B dans l'emplacement INACTIF : l'actif n'est pas touché pendant l'écriture, et une coupure AVANT l'en-tête laisse A actif
  std::vector<uint8_t> before(fl.m.begin() + podoled::slotBase(0), fl.m.begin() + podoled::slotBase(0) + OA_SLOT_BYTES);
  check(store(fl, 1, B, HASH_B, 2, false), "B écrit et validé dans l'emplacement 1 (sans en-tête : coupure simulée)");
  check(std::equal(before.begin(), before.end(), fl.m.begin() + podoled::slotBase(0)), "l'emplacement actif (0) est INTACT pendant l'écriture de B");
  check(podoled::activeSlot(fl, &h) == 0 && memcmp(h.hash, HASH_A, 64) == 0, "coupure avant l'en-tête : A reste actif");
  // 3b. en-tête déchiré : seulement la moitié écrite → ignoré
  {
    podoled::SlotHdr t; memset(&t, 0xFF, sizeof t); memcpy(t.magic, "OAN1", 4); t.seq = 2; t.bytes = (uint32_t)B.size(); memcpy(t.hash, HASH_B, 64);   // commit NON écrit
    fl.write(podoled::slotBase(1), (const uint8_t*)&t, OA_HDR);
    check(podoled::activeSlot(fl, &h) == 0, "en-tête sans marqueur de validation : ignoré");
  }
  // 3c. commit complet : B plus récent → actif
  fl.erase(podoled::slotBase(1) / OA_SECTOR);                       // l'en-tête déchiré est effacé (premier secteur)… et les données de B avec lui : on réécrit B
  check(store(fl, 1, B, HASH_B, 2, true), "B réécrit avec en-tête");
  check(podoled::activeSlot(fl, &h) == 1 && h.seq == 2 && memcmp(h.hash, HASH_B, 64) == 0, "B actif : séquence plus grande");
  check(!fl.violation, "aucune violation de la physique de la flash (B)");

  // 4. séquence qui boucle (comparaison signée) : 0xFFFFFFFF puis 0
  {
    FakeFlash f2; check(store(f2, 0, A, HASH_A, 0xFFFFFFFFu, true) && store(f2, 1, B, HASH_B, 0u, true), "séquences 0xFFFFFFFF et 0 écrites");
    check(podoled::activeSlot(f2, &h) == 1, "après le tour de compteur, 0 est plus récent que 0xFFFFFFFF");
  }
  // 5. pannes : effacement impossible, écriture impossible en cours de route → échec propre, jamais d'en-tête
  {
    FakeFlash f3; f3.failEraseAfter = 1; podoled::SlotWriter<FakeFlash> w(&f3, 0);
    check(!w.begin(), "effacement refusé : begin() échoue");
    check(podoled::activeSlot(f3, &h) == -1, "après un effacement refusé : rien d'actif");
    FakeFlash f4; f4.failWriteAfter = 5; check(!store(f4, 0, A, HASH_A, 1, true), "écriture refusée au 6e bloc : store() échoue");
    check(podoled::activeSlot(f4, &h) == -1, "après une écriture refusée : rien d'actif");
  }
  // 6. un clip trop gros est refusé AVANT tout dépassement de l'emplacement
  {
    FakeFlash f5; podoled::SlotWriter<FakeFlash> w(&f5, 0); std::vector<uint8_t> big(OA_DATA_MAX + 1, 0x55);
    check(w.begin() && !w.put(big.data(), big.size()), "clip > OA_DATA_MAX : refusé");
    FakeFlash f6; podoled::SlotWriter<FakeFlash> w2(&f6, 1); std::vector<uint8_t> max(OA_DATA_MAX, 0x55);
    check(w2.begin() && w2.put(max.data(), max.size()) && w2.finishData(), "clip de OA_DATA_MAX octets : accepté");
    bool intact = true; for (uint32_t i = podoled::slotBase(1) + OA_SLOT_BYTES; i < podoled::slotBase(1) + OA_SLOT_BYTES + 8192; i++) intact = intact && f6.m[i] == 0xFF;
    check(intact && !f6.violation, "rien n'est écrit au-delà de l'emplacement");
  }
  // 6b. gros clip (> 2 secteurs) sur un emplacement POLLUÉ (octets à 0x00 d'un ancien contenu) : les 3 secteurs doivent être effacés, sinon la physique de la NOR est violée
  {
    FakeFlash f8; for (uint32_t i = 0; i < OA_SLOT_BYTES; i++) f8.m[podoled::slotBase(1) + i] = 0x00;
    check(BIG.size() > 2 * OA_SECTOR && BIG.size() <= 9216, "le gros clip d'essai occupe le 3e secteur");
    const bool st = store(f8, 1, BIG, HASH_B, 1, true);
    check(st && !f8.violation && podoled::activeSlot(f8, &h) == 1 && h.bytes == BIG.size(), "gros clip sur emplacement pollué : écrit, validé et actif");
  }
  // 7. drop : l'emplacement n'est plus retrouvé
  { const bool dropped = podoled::dropSlot(fl, 1); const int act = podoled::activeSlot(fl, &h); check(dropped && act == 0 && h.seq == 1, "dropSlot efface l'en-tête : l'autre emplacement (A, seq 1) redevient actif"); }

  // 8. lecture complète du clip actif depuis la flash avec le lecteur en flux : une suite d'images « PLAY i crc »
  {
    FakeFlash f7; store(f7, 0, A, HASH_A, 1, true);
    podbench::StreamInfo info; uint8_t cur[podbench::FRAME_BYTES], vb[PODBENCH_STREAM_BUF];
    podoled::FlashSrc<FakeFlash> vs(&f7, 0, (uint32_t)A.size());
    check(podbench::validateStream(vs, A.size(), info, cur, vb) == podbench::OK, "clip actif valide depuis la flash");
    uint8_t ssd[1024]; memset(ssd, 0xA5, sizeof ssd); uint8_t buf[PODOLED_BUF];
    podoled::Player pl; pl.reset(info); uint32_t now = 1000; int shown = 0;
    for (int g = 0; g < 100000 && shown < 14; g++) {
      podoled::FlashSrc<FakeFlash> s(&f7, 0, (uint32_t)A.size());       // source rouverte à chaque tranche
      const podoled::Tick t = pl.tick(s, ssd, buf, [&]() { std::printf("PLAY %d %08x\n", shown, crc(ssd, sizeof ssd)); shown++; }, now);
      if (t == podoled::T_IO) { check(false, "lecture depuis la flash"); break; }
      now += 10;
    }
    check(shown == 14 && !f7.violation, "14 images lues depuis la flash, source rouverte à chaque tranche");
  }
  std::printf(bad ? "RT ECHEC %d\n" : "RT ok\n", bad);
  return bad ? 1 : 0;
}
