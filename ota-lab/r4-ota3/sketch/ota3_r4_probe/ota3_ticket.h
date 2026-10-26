// ota3_ticket.h — « ticket de flash » de la sonde OTA-3 (OTA3-FIX5, audit GPT du 16/10/2026) : fonction PURE (aucune dépendance Arduino), testée sur l'hôte avec des mutants (tests/ticket.test.mjs).
// Le YES de la sonde ne prouvait rien sur le FICHIER flashé. Le ticket relie l'autorisation de reprogrammer à ce que l'application a elle-même relu chez le module :
// valeurs attendues (taille + SHA-256, saisies par « e »), verify() du module = 0, module non « sale », taille bornée par la flash applicative, vecteurs Cortex-M plausibles.
#pragma once
#include <stdint.h>
#include <string.h>

#define OTA3_APP_BASE 0x4000u          // le bootloader Arduino écrit l'adresse BOSSA 0 à SKETCH_FLASH_OFFSET = 0x4000 (UNO R4 WiFi) — lu dans le bootloader officiel, non vérifié sur CETTE carte
#define OTA3_APP_MAX  0x3C000u         // flash applicative : 0x40000 - 0x4000
#define OTA3_SRAM_LO  0x20000000u
#define OTA3_SRAM_HI  0x20008000u      // 32 Ko de SRAM du RA4M1

enum Ota3Why : uint8_t { OTA3_OK = 0, OTA3_NOEXPECT, OTA3_DIRTY, OTA3_NOVERIFY, OTA3_TOOBIG, OTA3_SIZE, OTA3_SHA, OTA3_SHORT, OTA3_SP, OTA3_RESET };

struct Ota3Expect { bool set; uint32_t size; uint8_t sha[32]; };

static inline uint32_t ota3Le32(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

/** OTA3_OK seulement si TOUTES les conditions tiennent (ordre = ordre des diagnostics). `head` = les 8 premiers octets relus. */
static inline Ota3Why ota3Ticket(const Ota3Expect& e, uint32_t size, const uint8_t sha[32], const uint8_t head[8], bool verifyOk, bool moduleDirty) {
  if (!e.set) return OTA3_NOEXPECT;
  if (moduleDirty) return OTA3_DIRTY;
  if (!verifyOk) return OTA3_NOVERIFY;
  if (size == 0 || size > OTA3_APP_MAX) return OTA3_TOOBIG;
  if (size != e.size) return OTA3_SIZE;
  if (memcmp(sha, e.sha, 32) != 0) return OTA3_SHA;
  if (size < 8) return OTA3_SHORT;
  const uint32_t sp = ota3Le32(head), rst = ota3Le32(head + 4);
  if (sp < OTA3_SRAM_LO || sp > OTA3_SRAM_HI) return OTA3_SP;
  if (!(rst & 1u) || rst < OTA3_APP_BASE || rst >= OTA3_APP_BASE + size) return OTA3_RESET;   // bit Thumb, dans l'image chargée à 0x4000
  return OTA3_OK;
}

/** Consomme le ticket : valeurs attendues effacées ET dernier verify() invalidé. À appeler AVANT l'appel du module (OTA3-AUTO1) : un retour, un échec ou un délai n'autorise aucun retry. */
static inline void ota3Consume(Ota3Expect& e, bool& verifyOk) { e.set = false; e.size = 0; memset(e.sha, 0, 32); verifyOk = false; }

static inline const char* ota3WhyText(Ota3Why w) {
  switch (w) {
    case OTA3_OK: return "TICKET VALIDE";
    case OTA3_NOEXPECT: return "REFUS : aucune valeur attendue — taper « e <SHA-256 hex 64> <taille> » (ligne imprimée par prepare-ota3.sh)";
    case OTA3_DIRTY: return "REFUS : module « sale » après un verify() négatif — débrancher l'USB 10 s";
    case OTA3_NOVERIFY: return "REFUS : le dernier verify() du module n'a pas rendu 0 (ou aucun d n'a eu lieu)";
    case OTA3_TOOBIG: return "REFUS : taille nulle ou plus grande que la flash applicative (245 760 o)";
    case OTA3_SIZE: return "REFUS : la taille relue n'est pas la taille attendue";
    case OTA3_SHA: return "REFUS : le SHA-256 relu n'est pas celui attendu";
    case OTA3_SHORT: return "REFUS : fichier trop court pour contenir une table de vecteurs";
    case OTA3_SP: return "REFUS : pointeur de pile initial hors de la SRAM du RA4M1";
    case OTA3_RESET: return "REFUS : vecteur de reset invalide (bit Thumb absent ou adresse hors de l'image chargée à 0x4000)";
  }
  return "REFUS";
}
