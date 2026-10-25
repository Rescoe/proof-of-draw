// esp8266/_shared/pod_civil.h — date et heure civiles à partir de secondes depuis 1970 (25/10/2026). Pur, sans dépendance : testé sur l'hôte contre Date de JavaScript (tests/podCivil.test.ts).
// La carte reçoit du serveur l'heure UTC (`now`) et le décalage du fuseau choisi dans l'app (`tzo`, minutes) : elle date ses mesures sans aucune règle de fuseau ni d'heure d'été (le serveur recalcule `tzo` à chaque contact).
// Algorithme « civil_from_days » (Howard Hinnant, domaine public), valable pour tout instant entre 1970 et 2106 (secondes sur 32 bits non signés).
#pragma once
#include <stdint.h>

namespace podcivil {

/** `sec` = secondes depuis le 01/01/1970 00:00 de l'heure à représenter (UTC, ou « heure locale » déjà décalée) → jour (1..31), mois (1..12), heure, minute. */
inline void fromEpoch(uint32_t sec, int& day, int& month, int& hour, int& minute) {
  const uint32_t days = sec / 86400u, rem = sec % 86400u;
  hour = (int)(rem / 3600u);
  minute = (int)((rem % 3600u) / 60u);
  const int32_t z = (int32_t)days + 719468;
  const int32_t era = z / 146097;                                  // z >= 0 : division entière tronquée = plancher
  const uint32_t doe = (uint32_t)(z - era * 146097);
  const uint32_t yoe = (doe - doe / 1460u + doe / 36524u - doe / 146096u) / 365u;
  const uint32_t doy = doe - (365u * yoe + yoe / 4u - yoe / 100u);
  const uint32_t mp = (5u * doy + 2u) / 153u;
  day = (int)(doy - (153u * mp + 2u) / 5u + 1u);
  month = (int)(mp < 10u ? mp + 3u : mp - 9u);
}

/** Écrit « JJ/MM HH:MM » (11 caractères + NUL) dans `out` (au moins 12 octets) ; renvoie false si `sec` = 0 (horloge inconnue). */
inline bool formatShort(uint32_t sec, char* out) {
  if (sec == 0) { out[0] = 0; return false; }
  int d, mo, h, mi;
  fromEpoch(sec, d, mo, h, mi);
  out[0] = (char)('0' + d / 10); out[1] = (char)('0' + d % 10); out[2] = '/';
  out[3] = (char)('0' + mo / 10); out[4] = (char)('0' + mo % 10); out[5] = ' ';
  out[6] = (char)('0' + h / 10); out[7] = (char)('0' + h % 10); out[8] = ':';
  out[9] = (char)('0' + mi / 10); out[10] = (char)('0' + mi % 10); out[11] = 0;
  return true;
}

}  // namespace podcivil
