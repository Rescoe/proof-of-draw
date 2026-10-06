// pod_bench_esp.h — banc d'essai d'animation côté ESP8266 : contrôle rapide, téléchargement du clip, lecture mesurée, envoi des mesures.
//
// ⚠⚠ NON TESTÉ SUR LE MATÉRIEL (écrit et compilé le 03/10/2026). Le lecteur de clips lui-même (pod_bench.h) est testé sur PC contre le décodeur
// TypeScript ; ce fichier-ci (réseau, mémoire ESP8266, présentation sur l'écran réel) ne l'a jamais été. À valider sur une carte avant d'y compter.
//
// Même protocole que le firmware R4 (r4tft28-2.x), voir docs/BENCH_ANIMATION.md :
//   GET  /api/pull               → { …, benchMode: true } quand le propriétaire a activé le mode banc d'essai (30 min)
//   GET  /api/bench/poll         → { mode, clip: { clipId, bytes, … } | null }   (toutes les 3 s tant que le mode est actif)
//   GET  /api/bench/clip         → clip PBC1 binaire (≤ 9 216 o) ; validé ENTIÈREMENT (CRC, structure) avant d'afficher quoi que ce soit
//   POST /api/bench/result       → mesures (cadence, travail par image, marge, mémoire)
//
// Ce fichier existe en plusieurs copies IDENTIQUES (un dossier de firmware est autonome) : `node scripts/sync-bench-header.js`.
//
// Le « Presenter » fournit l'écran : begin(clip) · play(clip, cur, hook) · end() — voir esp_tft1.8.ino (TFT 1.8") et esp_eink_2.7BW_OLED.ino (OLED).

#ifndef POD_BENCH_ESP_H
#define POD_BENCH_ESP_H

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "pod_bench.h"

namespace podbenchesp {

static const unsigned long POLL_MS        = 3000UL;                  // contrôle rapide tant que le mode est actif
static const unsigned long MODE_MAX_MS    = 31UL * 60UL * 1000UL;    // le serveur éteint le mode après 30 min ; on s'arrête de nous-mêmes à 31
static const unsigned long LOOP_CHECK_MS  = 20000UL;                 // clip en boucle : on demande au serveur toutes les 20 s s'il veut toujours CE clip
static const unsigned long LOOP_MAX_MS    = 60UL * 60UL * 1000UL;    // et on s'arrête de toute façon au bout d'une heure
static const size_t        MAX_CLIP       = 9216;                    // même plafond que le serveur (lib/bench/clip.ts)
static const uint32_t      MIN_FREE_BLOCK = 17000;                   // plus gros bloc libre nécessaire : clip 9 Ko + copie 1 Ko + TLS BearSSL
static const uint32_t      MIN_TLS_BLOCK  = 14000;                   // plus gros bloc libre pour ouvrir une connexion TLS PENDANT une lecture en boucle
static const unsigned long NO_CHECK_MAX_MS = 5UL * 60UL * 1000UL;    // sans contrôle serveur possible (mémoire), une boucle s'arrête d'elle-même après 5 min

struct State {
  bool          mode = false;
  unsigned long modeSince = 0, lastPoll = 0;
  String        lastClipId = "";
};

/** Un contrôle : mode actif ? quel clip ? Retourne true si la réponse a été lue (429 / erreur → false). */
inline bool pollOnce(const String& serverUrl, const String& deviceId, bool& mode, String& clipId, size_t& bytes) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, serverUrl + "/api/bench/poll?deviceId=" + deviceId)) return false;
  http.setTimeout(10000);
  http.useHTTP10(true);
  const int code = http.GET();
  if (code != 200) { http.end(); if (code != 429) Serial.printf_P(PSTR("[BENCH] poll en erreur (%d)\n"), code); return false; }
  DynamicJsonDocument doc(512);
  const DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();
  if (err) return false;
  mode = doc["mode"] | false;
  clipId = ""; bytes = 0;
  JsonObject c = doc["clip"];
  if (!c.isNull()) { clipId = c["clipId"] | ""; bytes = (size_t)(c["bytes"] | 0); }
  return true;
}

/** Télécharge le clip dans `buf` (announced octets exactement). TLS fermé au retour. */
inline bool download(const String& serverUrl, const String& deviceId, const String& clipId, size_t announced, uint8_t* buf, unsigned long& ms) {
  const unsigned long t0 = millis();
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  bool ok = false;
  if (http.begin(client, serverUrl + "/api/bench/clip?deviceId=" + deviceId + "&clipId=" + clipId)) {
    http.setTimeout(15000);
    http.useHTTP10(true);
    const int code = http.GET();
    if (code == 200) {
      const int declared = http.getSize();
      if (declared < 0 || (size_t)declared == announced) {
        WiFiClient* stream = http.getStreamPtr();
        size_t total = 0;
        while (total < announced && millis() - t0 < 15000UL) {
          if (stream->available()) total += stream->readBytes(buf + total, announced - total);
          else delay(5);
        }
        ok = (total == announced);
      }
    } else Serial.printf_P(PSTR("[BENCH] clip : HTTP %d\n"), code);
    http.end();
  }
  ms = millis() - t0;
  return ok;
}

inline void postResult(const String& serverUrl, const String& deviceId, const String& clipId, uint32_t frames, unsigned long expectedMs, unsigned long elapsedMs,
                       unsigned long workSumUs, unsigned long workMaxUs, uint32_t overruns, unsigned long maxLateMs, long minSlackMs,
                       unsigned long downloadMs, size_t bytes, bool stopped, const char* error) {
  String body = "{\"deviceId\":\"" + deviceId + "\",\"clipId\":\"" + clipId + "\",\"frames\":" + String(frames)
              + ",\"expectedMs\":" + String(expectedMs) + ",\"elapsedMs\":" + String(elapsedMs)
              + ",\"avgWorkUs\":" + String(frames ? workSumUs / frames : 0UL) + ",\"maxWorkUs\":" + String(workMaxUs)
              + ",\"overruns\":" + String(overruns) + ",\"maxLateMs\":" + String(maxLateMs) + ",\"minSlackMs\":" + String(minSlackMs)
              + ",\"downloadMs\":" + String(downloadMs) + ",\"bytes\":" + String((unsigned long)bytes)
              + ",\"heapFree\":" + String((unsigned long)ESP.getFreeHeap()) + ",\"stopped\":" + (stopped ? "true" : "false");
  if (error) body += String(",\"error\":\"") + error + "\"";
  body += "}";
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, serverUrl + "/api/bench/result")) return;
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);
  const int code = http.POST(body);
  http.end();
  Serial.printf_P(PSTR("[BENCH] mesures envoyées → %d\n"), code);
}

enum Stop : uint8_t { S_DONE = 0, S_CHECK, S_CAP };

/** Télécharge, valide, joue (mesuré), renvoie les mesures, restaure l'affichage. */
template <class Presenter>
inline void playClip(State& st, Presenter& P, const String& serverUrl, const String& deviceId, const String& clipId, size_t announced) {
  Serial.printf_P(PSTR("[BENCH] clip %s : %u octets annoncés\n"), clipId.c_str(), (unsigned)announced);
  st.lastClipId = clipId;                                      // jamais rejoué en boucle, même en cas d'échec
  if (announced < (size_t)(podbench::HEADER_BYTES + 5 + podbench::FRAME_BYTES) || announced > MAX_CLIP) {
    Serial.printf_P(PSTR("[BENCH] taille refusée (%u)\n"), (unsigned)announced);
    postResult(serverUrl, deviceId, clipId, 0, 0, 0, 0, 0, 0, 0, 0, 0, announced, false, "taille refusee");
    return;
  }
  if (ESP.getMaxFreeBlockSize() < MIN_FREE_BLOCK) {
    Serial.printf_P(PSTR("[BENCH] mémoire insuffisante (plus gros bloc libre %u)\n"), (unsigned)ESP.getMaxFreeBlockSize());
    postResult(serverUrl, deviceId, clipId, 0, 0, 0, 0, 0, 0, 0, 0, 0, announced, false, "memoire");
    return;
  }
  uint8_t* clip = (uint8_t*)malloc(announced);
  uint8_t* cur = (uint8_t*)malloc(podbench::FRAME_BYTES);
  if (!clip || !cur) {
    free(clip); free(cur);
    Serial.println(F("[BENCH] malloc impossible"));
    postResult(serverUrl, deviceId, clipId, 0, 0, 0, 0, 0, 0, 0, 0, 0, announced, false, "memoire");
    return;
  }

  unsigned long downloadMs = 0;
  const bool got = download(serverUrl, deviceId, clipId, announced, clip, downloadMs);
  podbench::Clip pc;
  podbench::Err perr = got ? podbench::parse(clip, announced, pc, cur) : podbench::ERR_SIZE;
  if (!got || perr != podbench::OK) {
    Serial.printf_P(PSTR("[BENCH] clip refusé (%s)\n"), got ? podbench::errName(perr) : "téléchargement incomplet");
    free(clip); free(cur);
    postResult(serverUrl, deviceId, clipId, 0, 0, 0, 0, 0, 0, 0, 0, downloadMs, announced, false, got ? "clip invalide" : "telechargement");
    return;
  }
  const bool infinite = (pc.loops == 0);
  Serial.printf_P(PSTR("[BENCH] reçu en %lu ms — %u images, %s, lecture\n"), downloadMs, (unsigned)pc.frames, infinite ? "EN BOUCLE" : "boucles finies");

  P.begin(pc);
  uint32_t frames = 0, overruns = 0;
  unsigned long workSum = 0, workMax = 0, maxLate = 0, expectedMs = 0, elapsedMs = 0;
  long minSlack = 0x7FFFFFFF;
  const unsigned long tStart = millis();
  unsigned long lastCheck = tStart;
  Stop why = S_DONE;
  for (;;) {
    const unsigned long segStart = millis();
    unsigned long target = segStart;                           // instant où l'image courante DOIT commencer à apparaître
    unsigned long startedMs = segStart;                        // instant où sa peinture a réellement commencé
    unsigned long workStartUs = micros();
    why = S_DONE;
    P.play(pc, cur, [&](uint32_t, uint16_t delayMs) -> bool {
      const unsigned long workUs = micros() - workStartUs;      // appliquer la différence + peindre
      const long late = (long)(startedMs - target);             // RETARD DE DÉMARRAGE : > 0 seulement si l'image précédente a débordé sur son délai
      if (late > 5) { overruns++; if ((unsigned long)late > maxLate) maxLate = (unsigned long)late; }
      workSum += workUs; if (workUs > workMax) workMax = workUs;
      frames++; expectedMs += delayMs;
      target += delayMs;                                        // horloge ABSOLUE : pas de dérive cumulée
      const long slack = (long)(target - millis());             // marge restante avant l'image suivante (négative = en retard)
      if (slack < minSlack) minSlack = slack;
      while ((long)(millis() - target) < 0) delay(1);           // delay() sert le Wi-Fi et le watchdog
      if (infinite && millis() - lastCheck >= LOOP_CHECK_MS) { why = S_CHECK; return false; }
      if (infinite && millis() - tStart > LOOP_MAX_MS) { why = S_CAP; return false; }
      startedMs = millis(); workStartUs = micros();
      return true;
    });
    elapsedMs += millis() - segStart;
    if (why != S_CHECK) break;
    // Clip en boucle : le serveur veut-il toujours CE clip ? (un nouvel envoi ou l'arrêt du mode interrompt la boucle)
    if (ESP.getMaxFreeBlockSize() < MIN_TLS_BLOCK) {             // pas assez de mémoire pour une connexion TLS tant que le clip est en RAM
      Serial.printf_P(PSTR("[BENCH] mémoire trop juste pour contrôler le serveur (bloc libre %u) — boucle limitée à 5 min\n"), (unsigned)ESP.getMaxFreeBlockSize());
      lastCheck = millis();
      if (millis() - tStart > NO_CHECK_MAX_MS) break;
      continue;
    }
    bool mode = true; String id; size_t b = 0;
    const bool ok = pollOnce(serverUrl, deviceId, mode, id, b);
    lastCheck = millis();
    if (ok && !mode) { st.mode = false; Serial.println(F("[BENCH] mode terminé côté serveur : fin de la boucle")); break; }
    if (ok && id.length() > 0 && id != clipId) { Serial.printf_P(PSTR("[BENCH] nouveau clip %s : fin de la boucle\n"), id.c_str()); break; }
  }
  P.end();
  const long slackOut = (minSlack == 0x7FFFFFFF) ? 0L : minSlack;
  Serial.printf_P(PSTR("[BENCH] lecture terminée : %lu images en %lu ms (prévu %lu) — travail moy %lu us, max %lu us, retards de démarrage %lu (max %lu ms), marge min %ld ms, tas %u\n"),
                (unsigned long)frames, elapsedMs, expectedMs, frames ? workSum / frames : 0UL, workMax, (unsigned long)overruns, maxLate, slackOut, (unsigned)ESP.getFreeHeap());
  free(clip); free(cur);                                       // libérés AVANT d'ouvrir une connexion TLS pour les mesures
  postResult(serverUrl, deviceId, clipId, frames, expectedMs, elapsedMs, workSum, workMax, overruns, maxLate, slackOut, downloadMs, announced, false, nullptr);
}

/** À appeler quand /api/pull annonce (ou n'annonce plus) `benchMode`. */
inline void onPull(State& st, bool newMode) {
  if (newMode && !st.mode) { st.modeSince = millis(); st.lastPoll = 0; Serial.printf_P(PSTR("[BENCH] mode banc d'essai ACTIVÉ par l'app (contrôle toutes les %lu s)\n"), POLL_MS / 1000UL); }
  if (!newMode && st.mode) Serial.println(F("[BENCH] mode banc d'essai désactivé"));
  st.mode = newMode;
}

/** À appeler à CHAQUE tour de loop() : ne fait rien tant que le mode n'est pas actif. */
template <class Presenter>
inline void service(State& st, Presenter& P, const String& serverUrl, const String& deviceId) {
  if (!st.mode) return;
  const unsigned long now = millis();
  if (now - st.modeSince > MODE_MAX_MS) { st.mode = false; Serial.println(F("[BENCH] mode expiré (31 min)")); return; }
  if (now - st.lastPoll < POLL_MS) return;
  st.lastPoll = now;
  bool mode = true; String id; size_t bytes = 0;
  if (!pollOnce(serverUrl, deviceId, mode, id, bytes)) return;
  if (!mode) { st.mode = false; Serial.println(F("[BENCH] mode terminé côté serveur")); return; }
  if (id.length() > 0 && id != st.lastClipId) playClip(st, P, serverUrl, deviceId, id, bytes);
  st.lastPoll = millis();
}

}  // namespace podbenchesp

#endif  // POD_BENCH_ESP_H
