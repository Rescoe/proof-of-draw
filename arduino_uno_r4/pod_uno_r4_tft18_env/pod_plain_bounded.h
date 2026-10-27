// pod_plain_bounded.h — client EN CLAIR à réception modem BORNÉE (240 o), pour les essais de BANC de l'OTA R4 (HTTP vers un serveur local). Jamais utilisé en production (TLS : PodBoundedSSL).
//
// Même défaut que celui de WiFiSSLClient (voir pod_ssl_bounded.h) : WiFiClient::_read() envoie « AT+CLIENTRECEIVE=<sock>,<freePositions()-1> » (1 023 o) et ModemClass::buf_read accumule la réponse
// dans une std::string vide du tas (capacité 15 → … → 960 → 1 920) : sur un tas fragmenté (par exemple après une lecture de capteur), operator new échoue sans gestionnaire ⇒ abort() ⇒ boucle vide, SILENCE
// (constaté le 27/10/2026 sur le produit complet : la carte se figeait au premier read() d'un téléchargement HTTP en clair). Ce client borne la VRAIE commande à 240 o et réserve la chaîne une fois.
// À inclure APRÈS <WiFiS3.h>. Aucun état statique.
#ifndef POD_PLAIN_BOUNDED_H
#define POD_PLAIN_BOUNDED_H

#include <WiFiClient.h>
#include <string>
#include <stdint.h>
#include <stddef.h>

class PodBoundedPlain : public WiFiClient {
 public:
  static constexpr uint32_t kRxCap = 240;
  enum Fault : uint8_t { FAULT_NONE = 0, FAULT_OVERLONG = 1, FAULT_FIFO = 2 };
  uint8_t fault() const { return fault_; }

  int read(uint8_t* buf, size_t size) override {
    if (fault_ || size == 0) return fault_ ? -1 : 0;
    if (rx_buffer == nullptr) return 0;
    if ((size_t)rx_buffer->available() < size) fill_();
    if (fault_) return -1;
    int got = 0;
    for (size_t i = 0; i < size; i++) {
      bool ok = false;
      const uint8_t b = rx_buffer->read(&ok);
      if (!ok) break;
      buf[i] = b;
      got++;
    }
    return got;
  }
  int read() override { uint8_t b; return read(&b, 1) == 1 ? (int)b : -1; }
  uint8_t connected() override { return fault_ ? 0 : WiFiClient::connected(); }

 private:
  int fill_() {
    if (_sock < 0) return 0;
    const uint32_t room = (uint32_t)rx_buffer->freePositions();
    uint32_t size = room > 0 ? room - 1 : 0;
    if (size > kRxCap) size = kRxCap;
    if (size == 0) return 0;
    std::string res;
    res.reserve(kRxCap + 16);
    modem.begin();
    modem.avoid_trim_results();
    modem.read_using_size();
    if (!modem.write(std::string(PROMPT(_CLIENTRECEIVE)), res, "%s%d,%d\r\n", CMD_WRITE(_CLIENTRECEIVE), _sock, (int)size)) return 0;
    if (res.size() > size) { fault_ = FAULT_OVERLONG; return 0; }
    int stored = 0;
    for (size_t i = 0; i < res.size(); i++) {
      if (!rx_buffer->store((uint8_t)res[i])) { fault_ = FAULT_FIFO; return stored; }
      stored++;
    }
    return stored;
  }
  uint8_t fault_ = FAULT_NONE;
};

#endif  // POD_PLAIN_BOUNDED_H
