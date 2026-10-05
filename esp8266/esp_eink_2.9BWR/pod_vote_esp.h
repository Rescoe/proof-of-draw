// pod_vote_esp.h — ESP8266 : revérifier un candidat EN FLUX (validation réelle, vote v2). ⚠ NON TESTÉ sur le matériel : à essayer sur une carte (voir docs/CHANTIER_VALIDATION_REELLE.md, P3).
//
// podFetchAndCheck() lit GET /api/candidate-frame (octets bruts) par petits morceaux et, pour chacun, met à jour EN PARALLÈLE :
//   • le SHA-256 du contenu (BearSSL, déjà dans le noyau ESP8266) ;
//   • les métriques entières « pod-metrics-2 » (pod_metrics.h : compteurs + une ligne, aucun tampon d'image).
// Aucun tampon pixel n'est gardé : seul un tampon « scratch » de 4 736 octets (statique ou alloué par l'appelant) sert à l'OLED (page-major) et à l'e-ink 2,9″
// (noir lu avant le rouge). Règles ESP8266 respectées : http.useHTTP10(true), lecture en boucle (jamais un readBytes() isolé), aucun JSON.
//
// L'appelant (le .ino) : appelle podFetchAndCheck(), décide du verdict (podVerdict), signe podVoteMessage() avec Ed25519 et POST /api/validation-result.
// Spécification : docs/CHANTIER_VALIDATION_REELLE.md § 5.1-5.4 ; miroir serveur : lib/podVote.ts.
#pragma once
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <bearssl/bearssl_hash.h>
#include "pod_metrics.h"

#define POD_SCRATCH_BYTES 4736          // e-ink 2,9″ : canal noir ; OLED : 1 024
#define POD_MAX_CONTENT   160000UL      // plus gros contenu accepté (TFT 2,8″ = 153 600 o)
#define POD_FETCH_TIMEOUT_MS 40000UL

struct PodCheck {
  bool          ok;        // lecture complète + métriques calculées
  int           http;      // code HTTP (0 si connexion impossible)
  size_t        bytes;     // octets lus
  char          hash[65];  // SHA-256 hex du contenu lu
  PodMetricsOut m;         // e, t, r, s en ppm
  uint32_t      ms;        // durée totale (réseau compris) — à reporter au Serial pour les mesures
};

inline bool podKindFromName(const String& name, PodScreenKind* k) {
  if (name == "oled096")   { *k = POD_OLED096;   return true; }
  if (name == "eink27bw")  { *k = POD_EINK27BW;  return true; }
  if (name == "eink29bwr") { *k = POD_EINK29BWR; return true; }
  if (name == "tft18")     { *k = POD_TFT18;     return true; }
  if (name == "tft28")     { *k = POD_TFT28;     return true; }
  return false;
}

inline bool podFetchAndCheck(const String& url, PodScreenKind kind, size_t expectBytes, uint8_t* scratch, size_t scratchLen, PodCheck* out) {
  memset(out, 0, sizeof(*out));
  uint32_t t0 = millis();
  if (expectBytes == 0 || expectBytes > POD_MAX_CONTENT) return false;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, url)) return false;
  http.setTimeout(20000);
  http.useHTTP10(true);          // Vercel : sinon encodage « chunked »
  int code = http.GET();
  out->http = code;
  if (code != 200) { http.end(); return false; }

  PodFeeder feeder;
  if (!feeder.begin(kind, scratch, scratchLen) || feeder.rawBytes() != expectBytes) { http.end(); return false; }
  br_sha256_context sha;
  br_sha256_init(&sha);

  WiFiClient* stream = http.getStreamPtr();
  uint8_t chunk[256];
  size_t total = 0;
  unsigned long start = millis();
  while (total < expectBytes && millis() - start < POD_FETCH_TIMEOUT_MS) {
    int avail = stream->available();
    if (avail > 0) {
      size_t want = (size_t)avail < sizeof(chunk) ? (size_t)avail : sizeof(chunk);
      if (want > expectBytes - total) want = expectBytes - total;
      size_t got = stream->readBytes(chunk, want);
      if (got > 0) {
        br_sha256_update(&sha, chunk, got);
        feeder.feed(chunk, got);
        total += got;
      }
      yield();
    } else {
      if (!stream->connected()) break;
      delay(5);
    }
  }
  http.end();
  out->bytes = total;
  if (total != expectBytes) return false;

  uint8_t digest[32];
  br_sha256_out(&sha, digest);
  static const char HEXCH[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) { out->hash[2 * i] = HEXCH[digest[i] >> 4]; out->hash[2 * i + 1] = HEXCH[digest[i] & 15]; }
  out->hash[64] = 0;
  if (!feeder.finish(&out->m)) return false;
  out->ms = millis() - t0;
  out->ok = true;
  return true;
}

/** Verdict objectif (N2) — mêmes critères que lib/podVote.ts : hash conforme, contenu non uniforme, pas de bruit pur. Retourne « accept » ou le motif du refus. */
inline const char* podVerdict(const PodCheck& c, const String& announcedHash, bool* accept) {
  *accept = false;
  if (announcedHash != String(c.hash)) return "hash";
  if (c.m.e == 0 && c.m.t == 0) return "blank";                     // image uniforme (vide ou pleine)
  if (c.m.e > 980000UL && c.m.t > 900000UL) return "noise";         // bruit pur
  *accept = true;
  return "";
}

/** Message signé (Ed25519) : lie appareil, candidat, contenu, version des métriques, e/t/r et verdict. Identique à voteMessageV2() côté serveur. */
inline String podVoteMessage(const String& deviceId, const String& candidateId, const char* hash, const PodMetricsOut& m, bool accept) {
  String s = "pod-vote-v2|";
  s += deviceId; s += '|'; s += candidateId; s += '|'; s += hash; s += '|';
  s += String(POD_METRICS_VERSION); s += '|';
  s += String((unsigned long)m.e); s += '|'; s += String((unsigned long)m.t); s += '|'; s += String((unsigned long)m.r); s += '|';
  s += accept ? "accept" : "reject";
  return s;
}
