// pod_wifi_cfg.h — identifiants Wi-Fi HORS du binaire : un enregistrement de 105 octets dans l'EEPROM émulée, à l'écart de tous les octets existants (clés, bloc, blocs possédés, état OTA).
// ADR : docs/ADR_WIFI_HORS_BINAIRE_2026_10_18.md. Module PUR (aucun accès matériel hors du gabarit E) : testé sur l'hôte contre l'EEPROM simulée.
//
//   offsets [512 .. 616] dans l'EEPROM ; la zone réservée va jusqu'à 639 (EEPROM_SIZE = 640 avec POD_WIFI_FROM_RECORD)
//   [0..3]   magie "PWC1"
//   [4]      longueur du SSID (1..32)
//   [5]      longueur du mot de passe (0 = réseau ouvert, sinon 8..63)
//   [6..37]  SSID, complété par des zéros          [38..100] mot de passe, complété par des zéros
//   [101..104] CRC-32 (IEEE, little-endian) des octets [0..100]
//
// Règles : un enregistrement invalide (magie, longueurs, remplissage non nul, CRC) est traité comme ABSENT ; l'écriture est relue et revalidée avant d'être déclarée réussie ;
// aucun journal n'imprime le SSID ni le mot de passe (longueurs et CRC seulement). Les octets [0..511] ne sont jamais touchés par ce module.
#ifndef POD_WIFI_CFG_H
#define POD_WIFI_CFG_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace podwifi {

#ifndef POD_WIFI_REC_OFF
#define POD_WIFI_REC_OFF 512                 // défaut : TFT 1,8″ et BWR 2,9″ ; le multiscreen (image OLED sauvegardée en 99..1122) place l'enregistrement après ses 1540 octets
#endif
static const int OFF = POD_WIFI_REC_OFF;     // premier octet de l'enregistrement dans l'EEPROM
static const int LEN = 105;                  // longueur de l'enregistrement
static const int ZONE_END = OFF + 128;        // fin de la zone réservée (512 + 128 = 640 par défaut : EEPROM_SIZE avec l'enregistrement)
static const int SSID_MAX = 32, PASS_MAX = 63, PASS_MIN = 8;
static const int O_LEN_SSID = 4, O_LEN_PASS = 5, O_SSID = 6, O_PASS = 38, O_CRC = 101;

inline uint32_t crc32(const uint8_t* d, size_t n) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) { c ^= d[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (uint32_t)(-(int32_t)(c & 1u))); }
  return ~c;
}

/** SSID : 1..32 octets, sans NUL ni caractère de contrôle. Mot de passe : vide (réseau ouvert) ou 8..63 octets sans NUL ni contrôle. */
inline bool valid(const char* ssid, const char* pass) {
  if (!ssid || !pass) return false;
  const size_t ls = strlen(ssid), lp = strlen(pass);
  if (ls < 1 || ls > (size_t)SSID_MAX) return false;
  if (lp != 0 && (lp < (size_t)PASS_MIN || lp > (size_t)PASS_MAX)) return false;
  for (size_t i = 0; i < ls; i++) if ((uint8_t)ssid[i] < 0x20 || (uint8_t)ssid[i] == 0x7F) return false;
  for (size_t i = 0; i < lp; i++) if ((uint8_t)pass[i] < 0x20 || (uint8_t)pass[i] == 0x7F) return false;
  return true;
}

inline bool encode(const char* ssid, const char* pass, uint8_t out[LEN]) {
  if (!valid(ssid, pass)) return false;
  memset(out, 0, LEN);
  out[0] = 'P'; out[1] = 'W'; out[2] = 'C'; out[3] = '1';
  out[O_LEN_SSID] = (uint8_t)strlen(ssid); out[O_LEN_PASS] = (uint8_t)strlen(pass);
  memcpy(out + O_SSID, ssid, strlen(ssid)); memcpy(out + O_PASS, pass, strlen(pass));
  const uint32_t c = crc32(out, O_CRC);
  out[O_CRC] = (uint8_t)c; out[O_CRC + 1] = (uint8_t)(c >> 8); out[O_CRC + 2] = (uint8_t)(c >> 16); out[O_CRC + 3] = (uint8_t)(c >> 24);
  return true;
}

/** ssid : tampon de 33 octets ; pass : tampon de 64 octets. En cas d'échec, les deux sont mis à zéro. */
inline bool decode(const uint8_t in[LEN], char* ssid, char* pass) {
  ssid[0] = 0; pass[0] = 0;
  if (!(in[0] == 'P' && in[1] == 'W' && in[2] == 'C' && in[3] == '1')) return false;
  const int ls = in[O_LEN_SSID], lp = in[O_LEN_PASS];
  if (ls < 1 || ls > SSID_MAX || (lp != 0 && (lp < PASS_MIN || lp > PASS_MAX))) return false;
  for (int i = ls; i < SSID_MAX; i++) if (in[O_SSID + i] != 0) return false;        // remplissage strict
  for (int i = lp; i < PASS_MAX; i++) if (in[O_PASS + i] != 0) return false;
  const uint32_t want = (uint32_t)in[O_CRC] | ((uint32_t)in[O_CRC + 1] << 8) | ((uint32_t)in[O_CRC + 2] << 16) | ((uint32_t)in[O_CRC + 3] << 24);
  if (crc32(in, O_CRC) != want) return false;
  char s[SSID_MAX + 1], p[PASS_MAX + 1];
  memcpy(s, in + O_SSID, ls); s[ls] = 0; memcpy(p, in + O_PASS, lp); p[lp] = 0;
  if (!valid(s, p)) { memset(s, 0, sizeof s); memset(p, 0, sizeof p); return false; }
  memcpy(ssid, s, ls + 1); memcpy(pass, p, lp + 1);
  memset(s, 0, sizeof s); memset(p, 0, sizeof p);
  return true;
}

/** E : une EEPROM (read(int) -> octet, write(int, octet), commit() -> bool, reload() : relit la FLASH dans le tampon — l’EEPROM de l’ESP8266 lit sa copie en RAM, seule une relecture prouve l’écriture). */
template <class E> inline bool load(E& e, char* ssid, char* pass) {
  uint8_t r[LEN];
  for (int i = 0; i < LEN; i++) r[i] = (uint8_t)e.read(OFF + i);
  const bool ok = decode(r, ssid, pass);
  memset(r, 0, sizeof r);
  return ok;
}

/** Écrit, valide l'écriture (commit puis relecture et décodage identiques) ; false = rien de fiable n'a été enregistré. Ne touche que [OFF, OFF + LEN). */
template <class E> inline bool store(E& e, const char* ssid, const char* pass) {
  uint8_t w[LEN];
  if (!encode(ssid, pass, w)) return false;
  for (int i = 0; i < LEN; i++) e.write(OFF + i, w[i]);
  const bool committed = e.commit();
  if (committed) e.reload();
  char s[SSID_MAX + 1], p[PASS_MAX + 1];
  const bool back = committed && load(e, s, p) && strcmp(s, ssid) == 0 && strcmp(p, pass) == 0;
  memset(s, 0, sizeof s); memset(p, 0, sizeof p); memset(w, 0, sizeof w);
  return back;
}

/** Efface l'enregistrement (octets 0xFF = état d'une flash vierge). */
template <class E> inline bool clear(E& e) {
  for (int i = 0; i < LEN; i++) e.write(OFF + i, 0xFF);
  if (!e.commit()) return false;
  e.reload();
  char s[SSID_MAX + 1], p[PASS_MAX + 1];
  const bool gone = !load(e, s, p);
  memset(s, 0, sizeof s); memset(p, 0, sizeof p);
  return gone;
}

// ── commande série ─────────────────────────────────────────────────────────────────────────────────────
// "WIFI-SETHEX <ssid en hexadécimal>:<mot de passe en hexadécimal>"   (le mot de passe peut être vide : "…:")   ·   "WIFI-CLEAR"
// L'hexadécimal évite toute ambiguïté (espaces, « | », « : » dans un SSID) ; l'outil ota-lab/esp8266-canary/tools/wifi-provision.mjs fabrique la ligne.
inline int hexv(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
inline bool hexDecode(const char* h, size_t n, char* out, size_t cap) {      // n caractères hexadécimaux -> n/2 octets + NUL ; out de `cap` octets
  if (n % 2 != 0 || n / 2 + 1 > cap) return false;
  for (size_t i = 0; i < n / 2; i++) { const int a = hexv(h[2 * i]), b = hexv(h[2 * i + 1]); if (a < 0 || b < 0) return false; out[i] = (char)((a << 4) | b); }
  out[n / 2] = 0;
  return true;
}
enum Cmd { CMD_NONE = 0, CMD_SET = 1, CMD_CLEAR = 2, CMD_BAD = 3 };
/** ligne : texte sans fin de ligne. Retourne CMD_SET (ssid/pass remplis et valides), CMD_CLEAR, CMD_BAD (commande reconnue mais invalide) ou CMD_NONE (autre texte). */
inline Cmd parseCommand(const char* line, char* ssid, char* pass) {
  ssid[0] = 0; pass[0] = 0;
  if (strcmp(line, "WIFI-CLEAR") == 0) return CMD_CLEAR;
  if (strcmp(line, "WIFI-SETHEX") == 0) return CMD_BAD;                      // commande reconnue mais sans argument
  static const char P[] = "WIFI-SETHEX ";
  if (strncmp(line, P, sizeof P - 1) != 0) return CMD_NONE;
  const char* a = line + sizeof P - 1;
  const char* colon = strchr(a, ':');
  if (!colon) return CMD_BAD;
  if (!hexDecode(a, (size_t)(colon - a), ssid, SSID_MAX + 1)) return CMD_BAD;
  const char* b = colon + 1;
  if (!hexDecode(b, strlen(b), pass, PASS_MAX + 1)) { ssid[0] = 0; return CMD_BAD; }
  if (!valid(ssid, pass)) { memset(ssid, 0, SSID_MAX + 1); memset(pass, 0, PASS_MAX + 1); return CMD_BAD; }
  return CMD_SET;
}

}  // namespace podwifi

#endif  // POD_WIFI_CFG_H
