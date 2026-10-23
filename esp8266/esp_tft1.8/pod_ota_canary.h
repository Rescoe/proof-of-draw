// pod_ota_canary.h — CANARI OTA de laboratoire (ESP8266 TFT 1,8″, 17/10/2026). INCLUS SEULEMENT si POD_OTA = 1 ET POD_OTA_CANARY = 1 (défaut 0 : le firmware est alors, à l'octet près, celui d'avant).
// ⚠ NE JAMAIS COMMITER AVEC POD_OTA_CANARY = 1 ; JAMAIS DE DÉPLOIEMENT. Ce fichier ne contient AUCUN contrat OTA : il ne fait que (1) poser une annonce lue en HTTP sur le serveur de LABORATOIRE du PC (POD_OTA_BASE_URL),
// puis laisser le socle de production (podotaesp::setOffer / maybeRun, inchangés) décider et agir ; (2) imprimer des lignes « [CANARY] … » lisibles par l'orchestrateur (mesures de tas, identité, EEPROM, RSA).
// Il n'écrit JAMAIS dans l'EEPROM, n'imprime JAMAIS la clé privée (seulement un CRC-32) et ne lit aucune commande série.
#pragma once
#include <Arduino.h>
#include <EEPROM.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>
#include <bearssl/bearssl.h>
#include <user_interface.h>
#include <cont.h>

#ifndef POD_CANARY_POLL_MS
#define POD_CANARY_POLL_MS   20000UL    // intervalle entre deux lectures de /offer
#endif
#ifndef POD_CANARY_FIRST_MS
#define POD_CANARY_FIRST_MS  15000UL    // délai après la confirmation de santé avant la première lecture
#endif
#ifndef POD_CANARY_POLL_MAX
#define POD_CANARY_POLL_MAX  60         // lectures maximales par démarrage (borne le trafic de laboratoire)
#endif

namespace podcanary {

static bool g_healthy = false;
static uint32_t g_healthyAt = 0, g_nextPoll = 0, g_polls = 0;
static uint32_t g_minFree = 0xFFFFFFFFu, g_minBlock = 0xFFFFFFFFu, g_t0 = 0;
static int g_lastPct = 101;

static void sample() {
  const uint32_t f = ESP.getFreeHeap(), b = ESP.getMaxFreeBlockSize();
  if (f < g_minFree) g_minFree = f;
  if (b < g_minBlock) g_minBlock = b;
}
/** [CANARY] HEAP <étape> libre=… maxbloc=… pilecont=… t=… */
static void heap(const char* tag) {
  sample();
  Serial.printf_P(PSTR("[CANARY] HEAP %s libre=%u maxbloc=%u pilecont=%u t=%lu\n"), tag, (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxFreeBlockSize(), (unsigned)ESP.getFreeContStack(), (unsigned long)millis());
}
static uint32_t crcRange(int from, int to) {
  uint32_t c = 0xFFFFFFFFu;
  for (int i = from; i < to; i++) { c ^= (uint8_t)EEPROM.read(i); for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u))); }
  return ~c;
}
/** Identité et zones EEPROM, SANS rien divulguer de secret : CRC-32 de la clé privée, début du SHA-256 de la clé publique et de la MAC. */
static void identity(const char* tag) {
  uint8_t mac[6]; WiFi.macAddress(mac);
  br_sha256_context c; unsigned char h[32]; br_sha256_init(&c); br_sha256_update(&c, mac, 6); br_sha256_out(&c, h);
  uint8_t pub[32]; for (int i = 0; i < 32; i++) pub[i] = EEPROM.read(EEPROM_PUBKEY_OFF + i);
  br_sha256_init(&c); br_sha256_update(&c, pub, 32); unsigned char hp[32]; br_sha256_out(&c, hp);
  Serial.printf_P(PSTR("[CANARY] ID %s mac=%02x%02x%02x%02x%02x%02x pub=%02x%02x%02x%02x%02x%02x%02x%02x priv_crc=%08lX\n"), tag,
                  h[0], h[1], h[2], h[3], h[4], h[5], hp[0], hp[1], hp[2], hp[3], hp[4], hp[5], hp[6], hp[7], (unsigned long)crcRange(EEPROM_PRIVKEY_OFF, EEPROM_PRIVKEY_OFF + 32));
  Serial.printf_P(PSTR("[CANARY] EEPROM %s hash=%08lX drapeaux=%08lX blocs=%08lX ota=%08lX\n"), tag, (unsigned long)crcRange(EEPROM_BLOCKHASH_OFF, EEPROM_BLOCKHASH_OFF + 32),
                  (unsigned long)crcRange(EEPROM_FLAG_OFF, EEPROM_FLAG_OFF + 1) ^ (unsigned long)crcRange(EEPROM_PUBKEY_OFF, EEPROM_PUBKEY_OFF + 32),
                  (unsigned long)crcRange(EEPROM_OWNED_HEAD_OFF, EEPROM_OTA_OFF), (unsigned long)crcRange(EEPROM_OTA_OFF, EEPROM_OTA_OFF + EEPROM_OTA_LEN));
}
static void banner() {
  Serial.printf_P(PSTR("[CANARY] ===== OTA CANARI ESP8266 TFT 1,8 | build %s seq=%u | compilé %s %s | base=%s | NE PAS DÉPLOYER =====\n"), FIRMWARE_VERSION, (unsigned)POD_OTA_SEQ, __DATE__, __TIME__, POD_OTA_BASE_URL);
  Serial.printf_P(PSTR("[CANARY] RESET cause=%s | croquis=%u o | libre pour une image=%u o | cœur=%s\n"), ESP.getResetReason().c_str(), (unsigned)ESP.getSketchSize(), (unsigned)ESP.getFreeSketchSpace(), ESP.getCoreVersion().c_str());
  heap("boot");
}
/** Appelé quand le démarrage est SAIN (register ET premier pull réussis) : l'annonce ne sera lue qu'à partir de là. */
static void healthy() {
  g_healthy = true; g_healthyAt = millis(); g_nextPoll = g_healthyAt + POD_CANARY_FIRST_MS;
  heap("sain"); identity("sain");
  Serial.printf_P(PSTR("[CANARY] SAIN version=%s seq=%u t=%lu\n"), FIRMWARE_VERSION, (unsigned)POD_OTA_SEQ, (unsigned long)millis());
}
static void onProgress(int cur, int total) {
  sample();
  const int pct = total > 0 ? (int)((int64_t)cur * 100 / total) : 0;
  if (pct / 10 != g_lastPct / 10 || cur == total) {
    g_lastPct = pct;
    Serial.printf_P(PSTR("[CANARY] OTA progression %d/%d (%d %%) t=%lu libre=%u maxbloc=%u minlibre=%u minmaxbloc=%u\n"), cur, total, pct, (unsigned long)(millis() - g_t0), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxFreeBlockSize(),
                    (unsigned)g_minFree, (unsigned)g_minBlock);
  }
}
static bool field(const String& line, const char* key, String* out) {          // « cle=valeur » séparés par des espaces (même format que la sonde OTA-4B)
  const String k = String(key) + "=";
  int i = line.indexOf(k);
  while (i > 0 && line[i - 1] != ' ') i = line.indexOf(k, i + 1);
  if (i < 0) return false;
  const int s = i + k.length(); int e = line.indexOf(' ', s); if (e < 0) e = line.length();
  *out = line.substring(s, e); return out->length() > 0;
}
/** Lit /offer sur le serveur de laboratoire. Rend le code HTTP, ou -1 si la réponse n'est pas une annonce lisible (échec fermé : aucune troncature). */
static int fetchOffer(podota::Offer* o) {
  WiFiClient client; HTTPClient http; http.setTimeout(8000); http.useHTTP10(true);
  if (!http.begin(client, String(POD_OTA_BASE_URL) + "/offer")) return -2;
  const int code = http.GET();
  if (code != 200) { http.end(); return code; }
  String line = http.getString(); http.end(); line.trim();
  String f, v, sq, ms, sz, sl, u;
  if (!field(line, "family", &f) || !field(line, "version", &v) || !field(line, "seq", &sq) || !field(line, "minseq", &ms) || !field(line, "size", &sz) || !field(line, "slot", &sl) || !field(line, "url", &u)) return -1;
  if (f.length() > podota::FAMILY_MAX || v.length() > podota::VERSION_MAX || u.length() > podota::URL_MAX) return -1;
  memset(o, 0, sizeof(*o));
  memcpy(o->family, f.c_str(), f.length()); memcpy(o->version, v.c_str(), v.length()); memcpy(o->urlPath, u.c_str(), u.length());
  o->otaSeq = strtoul(sq.c_str(), nullptr, 10); o->minOtaSeq = strtoul(ms.c_str(), nullptr, 10); o->size = strtoul(sz.c_str(), nullptr, 10);
  const unsigned long slot = strtoul(sl.c_str(), nullptr, 10); o->keySlot = slot > 255 ? 255 : (uint8_t)slot;
  return 200;
}
/** Battement de vie toutes les 10 s : permet à l'orchestrateur de distinguer « silence normal » et « carte figée ». */
static void tick() {
  static uint32_t last = 0;
  const uint32_t now = millis();
  if (now - last < 10000UL) return;
  last = now; sample();
  Serial.printf_P(PSTR("[CANARY] VIVANT version=%s seq=%u libre=%u maxbloc=%u t=%lu\n"), FIRMWARE_VERSION, (unsigned)POD_OTA_SEQ, (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxFreeBlockSize(), (unsigned long)now);
}
/** Point d'appel SÛR (le même que maybeRun : aucun TLS ouvert, aucun candidat, aucune observation, banc inactif). Lit l'annonce, la pose, puis laisse le socle de production agir. */
static void service() {
  if (!g_healthy || g_polls >= POD_CANARY_POLL_MAX || WiFi.status() != WL_CONNECTED) return;
  const uint32_t now = millis();
  if ((int32_t)(now - g_nextPoll) < 0) return;
  g_nextPoll = now + POD_CANARY_POLL_MS; g_polls++;
  podota::Offer o; const int code = fetchOffer(&o);
  if (code != 200) { Serial.printf_P(PSTR("[CANARY] OFFRE aucune (code=%d) n=%u\n"), code, (unsigned)g_polls); return; }
  Serial.printf_P(PSTR("[CANARY] ANNONCE famille=%s version=%s seq=%u minseq=%u taille=%u creneau=%u url=%s | installee=%u\n"), o.family, o.version, (unsigned)o.otaSeq, (unsigned)o.minOtaSeq, (unsigned)o.size,
                  (unsigned)o.keySlot, o.urlPath, (unsigned)podotaesp::g_rec.installedSeq);
  const char* why = "";
  if (!podotaesp::setOffer(o, &why)) { Serial.printf_P(PSTR("[CANARY] ANNONCE REFUSEE : %s -> aucun telechargement, aucune ecriture EEPROM\n"), why); return; }
  Serial.println(F("[CANARY] ANNONCE ACCEPTEE -> le socle de production decide"));
  heap("avant OTA");
  g_minFree = g_minBlock = 0xFFFFFFFFu; g_lastPct = 101; g_t0 = millis();
  ESPhttpUpdate.onProgress(onProgress);
  const podotaesp::Outcome out = podotaesp::maybeRun();          // ne revient PAS après un succès (redémarrage)
  sample();
  Serial.printf_P(PSTR("[CANARY] OTA FIN resultat=%u t=%lu ms minlibre=%u minmaxbloc=%u\n"), (unsigned)out, (unsigned long)(millis() - g_t0), (unsigned)g_minFree, (unsigned)g_minBlock);
  heap("apres OTA");
}

}  // namespace podcanary

// Crochets de mesure PENDANT la vérification RSA (exécutés sur la pile à 2ᵉ étage) : déclarés par pod_ota_esp.h quand POD_OTA_LAB_HOOKS est défini.
namespace podotaesp {
static uint32_t labThunk = 0, labFree = 0, labBlock = 0, labT0 = 0;
void podLabVerifyBegin() { labThunk = stack_thunk_get_refcnt(); labFree = ESP.getFreeHeap(); labBlock = ESP.getMaxFreeBlockSize(); labT0 = millis(); }
void podLabVerifyEnd(bool ok) {
  Serial.printf_P(PSTR("[CANARY] RSA thunkRef=%u libre=%u maxbloc=%u duree=%lu ms signature=%s\n"), (unsigned)labThunk, (unsigned)labFree, (unsigned)labBlock, (unsigned long)(millis() - labT0), ok ? "VALIDE" : "REFUSEE");
}
}
