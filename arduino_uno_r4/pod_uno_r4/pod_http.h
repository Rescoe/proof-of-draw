// pod_http.h — lecteur de réponses HTTP/1.x pour clients TLS « non bloquants » (WiFiSSLClient de l'UNO R4 WiFi).
//
// Pourquoi ce fichier : le cœur R4 n'a pas de HTTPClient. Ce lecteur gère ce dont PoD a besoin, et rien de plus :
//   • ligne de statut + en-têtes (Content-Length, Transfer-Encoding: chunked) ;
//   • corps à longueur connue, corps « chunked », corps jusqu'à fermeture de la connexion ;
//   • lecture « readFull » : le flux rend souvent MOINS que demandé, on boucle jusqu'au compte exact ou au timeout.
// Aucune dépendance Arduino hormis millis()/delay() : le MÊME fichier est compilé avec g++ et testé sur PC
// (tests/podHttpR4.test.ts, banc d'essai host/http_harness.cpp) contre des flux fragmentés à l'octet.
//
// Contrat du client C : int read(uint8_t*, size_t) NON bloquant (0 si rien) · uint8_t connected().

#ifndef POD_HTTP_H
#define POD_HTTP_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace podhttp {

template <class C>
class Reader {
 public:
  Reader(C& client, uint32_t timeoutMs) : c_(client), timeout_(timeoutMs) {}

  /** Lit la ligne de statut et les en-têtes. Retourne le code HTTP, ou -1 (timeout / réponse illisible). */
  int readHeaders() {
    char line[160];
    if (!readLine(line, sizeof(line))) return -1;
    // « HTTP/1.1 200 OK »
    const char* sp = strchr(line, ' ');
    if (strncmp(line, "HTTP/", 5) != 0 || !sp) return -1;
    status_ = atoi3(sp + 1);
    if (status_ < 100 || status_ > 599) return -1;
    for (int guard = 0; guard < 64; guard++) {
      if (!readLine(line, sizeof(line))) return -1;
      if (line[0] == '\0') { headersDone_ = true; return status_; }   // ligne vide : fin des en-têtes
      if (startsWithNoCase(line, "content-length:")) len_ = parseLong(line + 15);
      else if (startsWithNoCase(line, "transfer-encoding:") && containsNoCase(line + 18, "chunked")) chunked_ = true;
    }
    return -1;   // trop d'en-têtes : on refuse plutôt que de boucler
  }

  int  status() const { return status_; }
  long contentLength() const { return chunked_ ? -1 : len_; }
  bool chunked() const { return chunked_; }
  /** Vrai si la fin du corps a été atteinte proprement (longueur exacte / chunk final). */
  bool complete() const { return done_ && !error_; }

  /** Lit jusqu'à n octets du corps ; bloque jusqu'à n, fin du corps ou timeout. Retourne le nombre d'octets lus. */
  size_t readBody(uint8_t* buf, size_t n) {
    size_t got = 0;
    while (got < n && !done_) {
      if (chunked_) {
        if (chunkLeft_ == 0) {
          if (!nextChunk()) { done_ = true; break; }
          if (chunkLeft_ == 0) { done_ = true; break; }   // chunk de taille 0 = fin
        }
        const size_t want = (n - got) < chunkLeft_ ? (n - got) : chunkLeft_;
        const size_t r = pull(buf + got, want);
        if (r == 0) { done_ = true; error_ = true; break; }
        got += r; chunkLeft_ -= r;
        if (chunkLeft_ == 0 && !skipCrlf()) { done_ = true; error_ = true; break; }
      } else if (len_ >= 0) {
        const size_t remain = (size_t)len_ - consumed_;
        if (remain == 0) { done_ = true; break; }
        const size_t want = (n - got) < remain ? (n - got) : remain;
        const size_t r = pull(buf + got, want);
        if (r == 0) { done_ = true; error_ = true; break; }
        got += r; consumed_ += r;
        if (consumed_ == (size_t)len_) done_ = true;
      } else {   // longueur inconnue : jusqu'à la fermeture
        const size_t r = pull(buf + got, n - got);
        if (r == 0) { done_ = true; break; }
        got += r;
      }
    }
    return got;
  }

  /** Corps entier dans out[0..cap-1] + NUL. Retourne false si tronqué (corps plus grand que cap-1) ou incomplet. */
  bool readBodyString(char* out, size_t cap, size_t* lenOut = nullptr) {
    size_t total = 0;
    while (total + 1 < cap && !done_) {
      const size_t r = readBody((uint8_t*)out + total, cap - 1 - total);
      if (r == 0) break;
      total += r;
    }
    out[total] = '\0';
    if (lenOut) *lenOut = total;
    if (!done_) {   // buffer plein : y a-t-il encore des octets ? (alors : tronqué)
      uint8_t extra;
      if (readBody(&extra, 1) == 1) return false;
    }
    return complete() || (len_ < 0 && !chunked_ && !error_);
  }

 private:
  C& c_;
  uint32_t timeout_;
  int  status_ = -1;
  long len_ = -1;
  bool chunked_ = false, headersDone_ = false, done_ = false, error_ = false;
  size_t consumed_ = 0, chunkLeft_ = 0;
  uint8_t ib_[128];
  size_t ibPos_ = 0, ibLen_ = 0;

  static int atoi3(const char* s) { int v = 0; for (int i = 0; i < 3 && s[i] >= '0' && s[i] <= '9'; i++) v = v * 10 + (s[i] - '0'); return v; }
  static long parseLong(const char* s) {
    while (*s == ' ' || *s == '\t') s++;
    long v = 0; bool any = false;
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); any = true; if (v > 100000000L) return -1; s++; }
    return any ? v : -1;
  }
  static char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }
  static bool startsWithNoCase(const char* s, const char* prefix) {
    for (; *prefix; s++, prefix++) if (lower(*s) != *prefix) return false;
    return true;
  }
  static bool containsNoCase(const char* s, const char* needle) {
    const size_t n = strlen(needle);
    for (; *s; s++) { size_t i = 0; while (i < n && s[i] && lower(s[i]) == needle[i]) i++; if (i == n) return true; }
    return false;
  }

  /** Remplit le petit tampon interne ; attend jusqu'au timeout. false = rien reçu (timeout ou connexion fermée). */
  bool fill() {
    const uint32_t t0 = millis();
    bool closed = false;
    while (millis() - t0 < timeout_) {
      const int n = c_.read(ib_, sizeof(ib_));
      if (n > 0) { ibPos_ = 0; ibLen_ = (size_t)n; return true; }
      if (closed) return false;
      if (!c_.connected()) { closed = true; continue; }   // un dernier essai : des octets ont pu arriver avec la fermeture
      delay(2);
    }
    return false;
  }
  int nextByte() {
    if (ibPos_ >= ibLen_ && !fill()) return -1;
    return ib_[ibPos_++];
  }
  /** Ligne terminée par LF (CR retiré), tronquée à cap-1 mais entièrement consommée. */
  bool readLine(char* out, size_t cap) {
    size_t n = 0;
    for (;;) {
      const int b = nextByte();
      if (b < 0) return false;
      if (b == '\n') break;
      if (b == '\r') continue;
      if (n + 1 < cap) out[n++] = (char)b;
    }
    out[n] = '\0';
    return true;
  }
  /** Copie jusqu'à n octets (au moins 1 sauf timeout/fermeture). */
  size_t pull(uint8_t* buf, size_t n) {
    if (ibPos_ < ibLen_) {
      const size_t k = (ibLen_ - ibPos_) < n ? (ibLen_ - ibPos_) : n;
      memcpy(buf, ib_ + ibPos_, k); ibPos_ += k;
      return k;
    }
    const uint32_t t0 = millis();
    bool closed = false;
    while (millis() - t0 < timeout_) {
      const int r = c_.read(buf, n);
      if (r > 0) return (size_t)r;
      if (closed) return 0;
      if (!c_.connected()) { closed = true; continue; }
      delay(2);
    }
    return 0;
  }
  bool skipCrlf() {
    int b = nextByte();
    if (b == '\r') b = nextByte();
    return b == '\n';
  }
  /** Lit « taille-hex[;extensions]\r\n ». */
  bool nextChunk() {
    char line[40];
    if (!readLine(line, sizeof(line))) return false;
    size_t v = 0; int digits = 0;
    for (const char* p = line; *p; p++) {
      char ch = *p; int d;
      if (ch >= '0' && ch <= '9') d = ch - '0';
      else if (ch >= 'a' && ch <= 'f') d = ch - 'a' + 10;
      else if (ch >= 'A' && ch <= 'F') d = ch - 'A' + 10;
      else break;   // « ; » (extension) ou autre : fin de la taille
      v = v * 16 + (size_t)d; digits++;
      if (v > 0x7FFFFFF) { error_ = true; return false; }
    }
    if (digits == 0) { error_ = true; return false; }
    chunkLeft_ = v;
    return true;
  }
};

}  // namespace podhttp

#endif  // POD_HTTP_H
