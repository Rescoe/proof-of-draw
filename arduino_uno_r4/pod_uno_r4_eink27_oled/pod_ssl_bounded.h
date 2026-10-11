// pod_ssl_bounded.h — client TLS Renesas/WiFiS3 à réception BORNÉE. Origine : PULLFRAME-BOUNDED-SSL-FIX1 (11/10/2026), validé sur carte sur l'UNO R4 e-ink 2,9″.
// PROPAGATION EXPLICITE (LOT8B2B3-R4-EINK27-PROPAGATION-1, 12/10/2026) aux UNO R4 e-ink 2,7″ (solo et + OLED) : cette copie ne diffère de celle du 2,9″ que par ce commentaire (code identique, testé) ;
// elle n'est PAS validée sur carte pour le 2,7″ (canari matériel à faire). Hors périmètre : TFT 1,8″, TFT 2,8″ et ESP8266 (BearSSL : ce composant est propre au cœur Renesas, ne jamais l'y copier).
//
// PROBLÈME (démontré sur la carte par AUDIT5 : abort() DANS WiFiSSLClient::read(), tas libre 2 976 o, sommet contigu vierge 1 888 o)
//   WiFiSSLClient::_read() (cœurs Renesas 1.5.3 = 1.6.0, fichiers identiques : docs/PREUVE_WIFIS3_RX_BORNE_RENESAS_1_5_3_1_6_0_2026_10_11.md) envoie
//   « AT+SSLCLIENTRECEIVE=<sock>,<freePositions()-1> » : FIFO vide ⇒ 1 023 octets demandés ; le module répond min(demandé, disponible) octets
//   (UNOR4USBBridge/cmds_wifi_SSL.h) ; ModemClass::buf_read les accumule par « data_res += c » dans une std::string VIDE du tas : capacité 15 → 30 → 60 → … → 960 → 1 920,
//   chaque agrandissement exigeant un bloc contigu NEUF pendant que l'ancien vit encore (960 + 1 920 o) ; operator new qui échoue sans gestionnaire ⇒ abort() ⇒ boucle vide.
//
// CORRECTIF (dans le projet ; AUCUN fichier du cœur modifié ; aucun new_handler ; aucun operator new redéfini)
//   PodBoundedSSL dérive de WiFiSSLClient (rx_buffer et _sock sont PROTECTED dans WiFiClient) et remplace read()/read(buf,n)/connected() :
//     • la commande _SSLCLIENTRECEIVE envoyée au module demande AU PLUS kRxCap octets (240) : c'est la valeur de l'argument « size » de la VRAIE commande AT, donc la borne
//       de ce que le module renvoie et de ce que buf_read accumule (testé sur le VRAI Modem.cpp / WiFiSSLClient.cpp du cœur, avec capture des octets émis sur l'UART) ;
//     • la std::string de réponse est RÉSERVÉE UNE FOIS (kRxCap + 16 o) avant l'appel : buf_read n'a plus aucun agrandissement (clear()/assign("") conservent la capacité) ;
//       pic contigu 256 o au lieu de 1 920 + 960 ;
//     • les octets sont rangés dans le FIFO existant (rx_buffer, 1 024 o déjà alloués par WiFiClient) dans l'ORDRE, sans copie intermédiaire supplémentaire : aucun tampon statique.
//   ÉCHEC FERMÉ : une anomalie d'INTÉGRITÉ (le module renvoie plus d'octets que demandé, ou le FIFO refuse un octet) pose un défaut COLLANT : plus aucune lecture, connected() = 0
//   (le Reader de pod_http.h conclut « fermé » après un dernier essai), le corps est incomplet ⇒ doFetchFrame : ni affichage, ni ACK. Une erreur de TRANSPORT (ERROR, délai) se comporte comme
//   dans le cœur (0 octet, le Reader réessaie jusqu'à son délai) ; la complétude reste garantie par Content-Length exact (pod_http.h).
//
// À inclure APRÈS <WiFiS3.h>. Aucun état statique. Aucun effet de bord à la construction.
#ifndef POD_SSL_BOUNDED_H
#define POD_SSL_BOUNDED_H

#include <WiFiSSLClient.h>
#include <string>
#include <stdint.h>
#include <stddef.h>

class PodBoundedSSL : public WiFiSSLClient {
 public:
  /** Plafond de l'argument « size » de _SSLCLIENTRECEIVE. 240 : la réponse tient dans UNE capacité de 256 o, réservée d'avance. */
  static constexpr uint32_t kRxCap = 240;
  enum Fault : uint8_t { FAULT_NONE = 0, FAULT_OVERLONG = 1, FAULT_FIFO = 2 };

  /** Défaut d'intégrité COLLANT (0 = aucun). */
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

  int read() override {
    uint8_t b;
    return read(&b, 1) == 1 ? (int)b : -1;
  }

  /** Défaut collant ⇒ « fermé » : le Reader fait un dernier essai puis abandonne (corps incomplet). */
  uint8_t connected() override { return fault_ ? 0 : WiFiSSLClient::connected(); }

 private:
  /** UNE commande _SSLCLIENTRECEIVE bornée ; range la réponse dans rx_buffer. Retourne le nombre d'octets rangés (0 = rien / erreur de transport). */
  int fill_() {
    if (_sock < 0) return 0;
    const uint32_t room = (uint32_t)rx_buffer->freePositions();
    uint32_t size = room > 0 ? room - 1 : 0;       // même marge que le cœur
    if (size > kRxCap) size = kRxCap;
    if (size == 0) return 0;
    std::string res;
    res.reserve(kRxCap + 16);                      // UNE allocation ; buf_read n'a plus à agrandir la chaîne
    modem.begin();
    modem.avoid_trim_results();
    modem.read_using_size();
    if (!modem.write(std::string(PROMPT(_SSLCLIENTRECEIVE)), res, "%s%d,%d\r\n", CMD_WRITE(_SSLCLIENTRECEIVE), _sock, (int)size)) return 0;
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

#endif  // POD_SSL_BOUNDED_H
