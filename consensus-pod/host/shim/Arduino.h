// consensus-pod/host/shim/Arduino.h — SIMULATION minimale de la classe String d'Arduino pour les harnais hôte (DOPULL-JSON-STACK-FIX1). Rien de plus que ce qu'utilisent ArduinoJson (lecteur, écrivain, convertisseur)
// et le code RÉEL extrait du sketch (concat, +=, length, c_str, comparaisons). INJECTION DE PANNE : g_strFailArmed + g_strFailAt font échouer la N-ième allocation comptée (concat, +=, copie) en LAISSANT la chaîne
// inchangée (concat) ou vide (copie), comme Arduino quand le tas est épuisé.
#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <string>

static bool g_strFailArmed = false;
static int g_strFailAt = 0, g_strAllocN = 0;
static inline bool strAllocOk() { if (!g_strFailArmed) return true; return ++g_strAllocN != g_strFailAt; }

class String {
 public:
  String() {}
  String(const char* c) : s_(c ? c : "") {}
  String(const String& o) : s_(o.s_) {}
  String& operator=(const String& o) { if (this == &o) return *this; if (!strAllocOk()) { s_.clear(); return *this; } s_ = o.s_; return *this; }
  String& operator=(const char* c) { s_ = c ? c : ""; return *this; }
  unsigned char concat(const char* c) { if (!c) return 0; if (!strAllocOk()) return 0; s_ += c; return 1; }
  unsigned char concat(const char* c, unsigned int n) { if (!c) return 0; if (!strAllocOk()) return 0; s_.append(c, n); return 1; }
  String& operator+=(const char* c) { concat(c); return *this; }
  String& operator+=(const String& o) { concat(o.c_str()); return *this; }
  unsigned int length() const { return (unsigned int)s_.size(); }
  const char* c_str() const { return s_.c_str(); }
  bool operator==(const char* c) const { return s_ == c; }
  bool operator==(const String& o) const { return s_ == o.s_; }
  bool operator!=(const char* c) const { return s_ != c; }
  bool operator!=(const String& o) const { return s_ != o.s_; }
 private:
  std::string s_;
};
