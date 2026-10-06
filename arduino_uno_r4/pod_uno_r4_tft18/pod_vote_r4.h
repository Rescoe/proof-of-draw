// pod_vote_r4.h — UNO R4 WiFi : revérifier un candidat EN FLUX (validation réelle, vote v2). ⚠ NON TESTÉ sur la carte (écrit et compilé le 06/10/2026).
//
// Même protocole que l'ESP8266 (esp8266/_shared/pod_vote_esp.h) : GET /api/candidate-frame (octets bruts) lu par petits morceaux ; pour chacun on met à jour EN
// PARALLÈLE le SHA-256 du contenu (bibliothèque Crypto, rweather) et les métriques entières « pod-metrics-2 » (pod_metrics.h : compteurs + une ligne). Aucun
// tampon d'image n'est gardé : seul un tampon « scratch » de 4 736 o sert à l'e-ink 2,9″ (canal noir lu avant le rouge) — le sketch lui prête blackBuf, inutile
// pendant une validation (le plan noir est entièrement ré-écrit avant le prochain affichage).
//
// Le lecteur HTTP est celui de pod_http.h (`podhttp::Reader`, déjà testé sur PC) : la fonction est générique sur le lecteur, sans dépendance au Wi-Fi.
// Spécification : docs/CHANTIER_VALIDATION_REELLE.md § 5.1-5.4 ; miroir serveur : lib/podVote.ts. Essai à faire : docs/CANARI_R4_EINK29.md.
#pragma once
#include <Arduino.h>
#include <SHA256.h>
#include "pod_metrics.h"

#define POD_MAX_CONTENT      160000UL     // plus gros contenu accepté
#define POD_FETCH_TIMEOUT_MS 40000UL

struct PodCheck {
  bool          ok;        // lecture complète + métriques calculées
  int           http;      // code HTTP (0 si connexion impossible)
  size_t        bytes;     // octets lus
  char          hash[65];  // SHA-256 hex du contenu lu
  PodMetricsOut m;         // e, t, r, s en ppm
  uint32_t      ms;        // durée de lecture + calcul — à reporter au Serial pour les mesures
};

inline bool podKindFromName(const char* name, PodScreenKind* k) {
  if (!strcmp(name, "oled096"))   { *k = POD_OLED096;   return true; }
  if (!strcmp(name, "eink27bw"))  { *k = POD_EINK27BW;  return true; }
  if (!strcmp(name, "eink29bwr")) { *k = POD_EINK29BWR; return true; }
  if (!strcmp(name, "tft18"))     { *k = POD_TFT18;     return true; }
  if (!strcmp(name, "tft28"))     { *k = POD_TFT28;     return true; }
  return false;
}

/**
 * Lit le corps (déjà après les en-têtes, code 200) par morceaux de `chunkLen` octets, calcule hash + métriques. `chunk` et `scratch` sont fournis par
 * l'appelant (STATIQUES : la pile de la R4 est petite). Retourne true si exactement `expectBytes` octets ont été lus et les métriques calculées.
 */
template <class Reader>
inline bool podCheckStream(Reader& rd, PodScreenKind kind, size_t expectBytes, uint8_t* scratch, size_t scratchLen, uint8_t* chunk, size_t chunkLen, PodCheck* out) {
  const uint32_t t0 = millis();
  out->bytes = 0; out->ok = false;
  if (expectBytes == 0 || expectBytes > POD_MAX_CONTENT || chunkLen == 0) return false;

  static PodFeeder feeder;       // statiques : ni pile ni tas
  static SHA256    sha;
  if (!feeder.begin(kind, scratch, scratchLen) || feeder.rawBytes() != expectBytes) return false;
  sha.reset();

  size_t total = 0;
  while (total < expectBytes && millis() - t0 < POD_FETCH_TIMEOUT_MS) {
    size_t want = expectBytes - total;
    if (want > chunkLen) want = chunkLen;
    const size_t got = rd.readBody(chunk, want);     // boucle jusqu'au compte exact ou au timeout (readFull)
    if (got == 0) break;
#ifdef POD_TEST_FLIP_BYTE
    if (total == 0) chunk[0] ^= 0x01;   // ESSAI DE REFUS (G5) : un octet du flux est modifié → le hash recalculé diffère → verdict « reject » (hash). Jamais en production.
#endif
    sha.update(chunk, got);
    feeder.feed(chunk, got);
    total += got;
  }
  out->bytes = total;
  if (total != expectBytes) return false;

  uint8_t digest[32];
  sha.finalize(digest, sizeof(digest));
  static const char HEXCH[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) { out->hash[2 * i] = HEXCH[digest[i] >> 4]; out->hash[2 * i + 1] = HEXCH[digest[i] & 15]; }
  out->hash[64] = 0;
  if (!feeder.finish(&out->m)) return false;
  out->ms = millis() - t0;
  out->ok = true;
  return true;
}

/** Verdict objectif (N2) — mêmes critères que lib/podVote.ts : hash conforme, contenu non uniforme, pas de bruit pur. Retourne « accept » (chaîne vide) ou le motif du refus. */
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
