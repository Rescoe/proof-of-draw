// adapters/crypto_esp8266.h — SHA-256 pour ESP8266 : BearSSL (déjà dans le noyau Arduino ESP8266 ; même fonction que esp8266/_shared/pod_vote_esp.h). ⚠ compilé seulement, jamais testé sur carte.
// Mémoire : un contexte br_sha256_context (~100 octets) PAR instance ; le noyau n'en crée qu'une à la fois, sur la pile, hors de toute connexion TLS ouverte.
#pragma once
#include <Arduino.h>
#include <bearssl/bearssl_hash.h>

class PodSha256Br {
 public:
  void begin() { br_sha256_init(&ctx_); }
  void update(const void* d, size_t n) { br_sha256_update(&ctx_, d, n); }
  void finish(uint8_t out[32]) { br_sha256_out(&ctx_, out); }
 private:
  br_sha256_context ctx_;
};
