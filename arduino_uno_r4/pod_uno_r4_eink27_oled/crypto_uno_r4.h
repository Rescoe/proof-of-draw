// adapters/crypto_uno_r4.h — SHA-256 pour UNO R4 WiFi : bibliothèque « Crypto » (rweather, déjà utilisée par arduino_uno_r4/*/pod_vote_r4.h). ⚠ compilé seulement, jamais testé sur carte.
// Mémoire R4 : pile principale de 1 Ko → n'instancier qu'UN Sha à la fois et le déclarer `static` dans le sketch si besoin (SHA256 ≈ 100 octets).
#pragma once
#include <Arduino.h>
#include <SHA256.h>

class PodSha256Rw {
 public:
  void begin() { sha_.reset(); }
  void update(const void* d, size_t n) { sha_.update(d, n); }
  void finish(uint8_t out[32]) { sha_.finalize(out, 32); }
 private:
  SHA256 sha_;
};
