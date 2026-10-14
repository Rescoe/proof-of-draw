// pod_ssl_bounded.h (SIMULATION hôte) : PodBoundedSSL = WiFiSSLClient scripté + défaut collant. Le VRAI pod_ssl_bounded.h est testé contre le VRAI Modem.cpp par tests/boundedSsl.test.ts ; ici seul compte le CONTRAT
// vu par le firmware : fault() != 0 => lectures refusées, connected() faux.
#pragma once
#include "tft28_mock.h"
class PodBoundedSSL : public WiFiSSLClient {
 public:
  uint8_t fault() const { return fault_; }
  int read(uint8_t* buf, size_t n) override {
    if (fault_) return -1;
    if (sc_.faultAfter != (size_t)-1 && consumed_ >= sc_.faultAfter) { fault_ = 1; return -1; }
    size_t m = n; if (sc_.faultAfter != (size_t)-1) m = std::min(n, sc_.faultAfter - consumed_);
    const int got = WiFiSSLClient::read(buf, m);
    if (sc_.faultAfter != (size_t)-1 && consumed_ >= sc_.faultAfter) fault_ = 1;   // le défaut se pose dès que le Nième octet a été remis (même si c'est le dernier)
    return got;
  }
  uint8_t connected() override { return fault_ ? 0 : WiFiSSLClient::connected(); }
 private:
  uint8_t fault_ = 0;
};
