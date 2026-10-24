// pod_dht22.h — capteur DHT22 (AM2302) pour ESP8266 + envoi des mesures à /api/sensor (EXPÉRIMENTAL, 23/10/2026 ; NON ESSAYÉ sur la carte).
// Partie PURE (testée sur l'hôte, consensus-pod/host/dht22_harness.cpp) : décodage des 5 octets, plages, planification lecture / envoi, corps JSON du lot. Partie MATÉRIELLE (#ifdef ARDUINO) : lecture sur UNE broche.
// Cadence (comme la R4 r4dht22-1.3, docs/CAPTEUR_TEMPERATURE_R4_DHT22.md) : LECTURE toutes les 30 min, ENVOI toutes les heures (lot de 2 lectures datées par leur âge) — le serveur REFUSE (stored:false) un envoi
// plus rapproché que 50 min (MEASURE_MIN_INTERVAL_SEC = 3000) : un « push toutes les 30 min » serait donc perdu une fois sur deux.
// Mémoire : aucun tas (tout est statique, ≈ 60 o) ; l'envoi réutilise le POST TLS existant du firmware (même coût de tas que le pull).
#ifndef POD_DHT22_H
#define POD_DHT22_H

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

namespace poddht {

static const int MAXR = 4;                                  // lectures gardées en attente d'envoi (au plus 2 en régime normal ; 4 = pannes réseau d'une ou deux heures)
static const uint32_t READ_EVERY_MS  = 30UL * 60UL * 1000UL;
static const uint32_t SEND_EVERY_MS  = 60UL * 60UL * 1000UL;
static const uint32_t FIRST_READ_MS  = 20UL * 1000UL;       // première lecture 20 s après le démarrage (essai en direct)
static const uint32_t FIRST_SEND_MS  = 70UL * 1000UL;       // premier envoi 70 s après le démarrage
static const uint32_t RETRY_MS       = 5UL * 60UL * 1000UL; // capteur absent / envoi en échec : nouvel essai dans 5 min

/** Décode les 5 octets du DHT22 : humidité et température en DIXIÈMES (signe sur le bit 15 de la température). false : somme de contrôle fausse ou valeur hors plage physique du composant. */
inline bool parse(const uint8_t b[5], int& t10, int& h10) {
  if (((((uint32_t)b[0] + b[1] + b[2] + b[3]) & 0xFFu)) != b[4]) return false;
  const int h = ((int)b[0] << 8) | b[1];
  int t = (((int)b[2] & 0x7F) << 8) | b[3]; if (b[2] & 0x80) t = -t;
  if (h < 0 || h > 1000 || t < -400 || t > 800) return false;      // mêmes plages que MEASURE_KINDS (lib/measures.ts)
  t10 = t; h10 = h; return true;
}

struct Reading { uint32_t atMs; int16_t t10, h10; };
struct State {
  Reading r[MAXR]; uint8_t n; uint32_t nextReadMs, nextSendMs; uint32_t reads, readFails, sends, sendFails;
};
enum Action { A_NONE = 0, A_READ = 1, A_SEND = 2 };
inline bool reached(uint32_t now, uint32_t at) { return (int32_t)(now - at) >= 0; }     // comparaison robuste au débordement de millis() (49 jours)
inline void init(State& s, uint32_t now) { memset(&s, 0, sizeof s); s.nextReadMs = now + FIRST_READ_MS; s.nextSendMs = now + FIRST_SEND_MS; }
inline Action next(const State& s, uint32_t now) {
  if (reached(now, s.nextReadMs)) return A_READ;
  if (s.n > 0 && reached(now, s.nextSendMs)) return A_SEND;
  return A_NONE;
}
inline void onRead(State& s, uint32_t now, bool ok, int t10, int h10) {
  if (!ok) { s.readFails++; s.nextReadMs = now + RETRY_MS; return; }       // capteur absent, mal câblé ou illisible : on réessaie vite, sans rien inventer
  s.reads++; s.nextReadMs = now + READ_EVERY_MS;
  if (s.n == MAXR) { for (int i = 1; i < MAXR; i++) s.r[i - 1] = s.r[i]; s.n--; }     // tampon plein : la plus ANCIENNE lecture est perdue
  s.r[s.n].atMs = now; s.r[s.n].t10 = (int16_t)t10; s.r[s.n].h10 = (int16_t)h10; s.n++;
}
/** Résultat d'un envoi : OK (stocké), TOO_SOON (le serveur répond 200 mais stored:false, nextSec = attente indiquée), FAIL (réseau / HTTP). Le tampon n'est vidé QUE si OK. */
enum SendResult { S_OK = 0, S_TOO_SOON = 1, S_FAIL = 2 };
inline void onSend(State& s, uint32_t now, SendResult r, uint32_t nextSec) {
  if (r == S_OK) { s.sends++; s.n = 0; s.nextSendMs = now + SEND_EVERY_MS; return; }
  s.sendFails++;
  if (r == S_TOO_SOON) { uint32_t w = nextSec; if (w < 60) w = 60; if (w > 7200) w = 7200; s.nextSendMs = now + w * 1000UL; return; }
  s.nextSendMs = now + RETRY_MS;
}
/** Corps JSON d'un envoi : {"deviceId":"…","pairCode":"…","r":[{"a":âge_s,"temp":dixièmes,"hum":dixièmes},…],"m":{"rssi":dBm}} ; âge = secondes depuis la lecture (0..86400). Retourne la longueur ou 0 si le tampon est trop petit. */
inline size_t buildBody(const State& s, uint32_t now, const char* deviceId, const char* pairCode, int rssi, char* out, size_t cap) {
  size_t k = 0; int w = snprintf(out, cap, "{\"deviceId\":\"%s\",\"pairCode\":\"%s\",\"r\":[", deviceId, pairCode); if (w < 0 || (size_t)w >= cap) return 0; k = (size_t)w;
  for (int i = 0; i < s.n; i++) {
    uint32_t a = (now - s.r[i].atMs) / 1000UL; if (a > 86400UL) a = 86400UL;
    w = snprintf(out + k, cap - k, "%s{\"a\":%lu,\"temp\":%d,\"hum\":%d}", i ? "," : "", (unsigned long)a, (int)s.r[i].t10, (int)s.r[i].h10); if (w < 0 || (size_t)w >= cap - k) return 0; k += (size_t)w;
  }
  if (rssi >= -127 && rssi <= 0) w = snprintf(out + k, cap - k, "],\"m\":{\"rssi\":%d}}", rssi); else w = snprintf(out + k, cap - k, "]}");
  if (w < 0 || (size_t)w >= cap - k) return 0;
  return k + (size_t)w;
}
/** Extrait « nextSec » d'une réponse JSON de /api/sensor (0 si absent). */
inline uint32_t parseNextSec(const char* resp) {
  const char* p = strstr(resp, "\"nextSec\":"); if (!p) return 0; p += 10; uint32_t v = 0; while (*p >= '0' && *p <= '9') { v = v * 10 + (uint32_t)(*p - '0'); p++; if (v > 1000000UL) break; } return v;
}

}  // namespace poddht

#ifdef ARDUINO
#include <Arduino.h>
namespace poddht {
inline bool waitLevel(uint8_t pin, uint8_t level, uint32_t timeoutUs) { const uint32_t t0 = micros(); while (digitalRead(pin) != level) { if (micros() - t0 > timeoutUs) return false; } return true; }
/** Lecture sur UNE broche (ligne de données avec résistance de rappel vers 3,3 V ; module 3 broches : déjà montée). Bloque ≈ 6 ms, interruptions coupées ≈ 4 ms pendant les 40 bits. false : pas de réponse / somme fausse. */
inline bool read(uint8_t pin, int& t10, int& h10) {
  uint8_t b[5] = {0, 0, 0, 0, 0};
  pinMode(pin, OUTPUT); digitalWrite(pin, LOW); delay(3);                          // départ : ligne basse ≥ 1 ms
  noInterrupts();
  digitalWrite(pin, HIGH); delayMicroseconds(30); pinMode(pin, INPUT_PULLUP);
  bool ok = waitLevel(pin, LOW, 120) && waitLevel(pin, HIGH, 120) && waitLevel(pin, LOW, 120);         // réponse du capteur : bas 80 µs, haut 80 µs
  for (int i = 0; ok && i < 40; i++) {
    ok = waitLevel(pin, HIGH, 100);                                                  // fin du bas de 50 µs
    const uint32_t t = micros();
    ok = ok && waitLevel(pin, LOW, 140);                                             // le haut dure ≈ 27 µs (0) ou ≈ 70 µs (1)
    if (ok) b[i / 8] = (uint8_t)((b[i / 8] << 1) | ((micros() - t) > 45 ? 1 : 0));
  }
  interrupts();
  pinMode(pin, INPUT_PULLUP);
  return ok && parse(b, t10, h10);
}
}  // namespace poddht
#endif

#endif  // POD_DHT22_H
