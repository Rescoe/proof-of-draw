// pod_ota_tls.h — TLS AUTHENTIFIÉ pour le téléchargement OTA de l'ESP8266 (20/10/2026). N'EST INCLUS QUE SI POD_OTA_CLIENT = 1. ⚠ COMPILÉ ET TESTÉ SUR L'HÔTE (moteur X.509 de BearSSL réel contre la vraie chaîne,
// tests/otaTls.test.ts) ; JAMAIS ESSAYÉ SUR UNE CARTE. Décisions, menaces et maintenance : docs/ADR_TLS_AUTHENTIFIE_OTA_ESP8266_2026_10_20.md.
//
// Choix : validation de la CHAÎNE par des RACINES épinglées (pod_ota_tls_roots.h : GTS Root R1 = CA actuelle de *.vercel.app, ISRG Root X1 = repli) + vérification du NOM D'HÔTE + vérification de l'HEURE.
//   • pas d'empreinte de feuille : le certificat tourne tous les 90 jours (fin de la feuille actuelle : 27/11/2026) ;
//   • pas d'épinglage d'intermédiaire : Google fait tourner WR1…WR4 ;
//   • setInsecure() n'est PAS une validation : il n'existe plus dans le chemin OTA (testé).
// L'HEURE vient de SNTP (non authentifié) : plancher de compilation POD_OTA_TIME_FLOOR (une horloge ramenée avant le plancher est refusée) ; la validité des certificats est TOUJOURS contrôlée (BearSSL sans heure = erreur,
// jamais « on ignore »). Résidu accepté : un attaquant qui contrôle SNTP ET possède un ancien certificat valide du serveur ET sa clé peut se faire passer pour lui ; il ne peut toujours pas fournir une image acceptable
// (signature RSA de publication vérifiée par l'Updater, séquence monotone) — voir l'ADR.
//
// Mémoire : liste d'ancres ≈ 1,4 Ko de TAS pendant le TLS seulement (libérée à la sortie du bloc) ; PEM en PROGMEM (aucune RAM statique). BearSSL garde ses tampons de 16 Ko + 512 o (contigus) : le garde-fou de
// pod_ota_esp.h (POD_OTA_MIN_BLOCK 18 000, POD_OTA_MIN_HEAP 30 000) n'est PAS abaissé ; on y ajoute la marge des ancres.
#pragma once
#include <Arduino.h>
#include <time.h>
#include <WiFiClientSecure.h>
#include <BearSSLHelpers.h>
#include "pod_ota_tls_roots.h"

#ifndef POD_OTA_TIME_FLOOR
#define POD_OTA_TIME_FLOOR 1792454400UL    // 20/10/2026 00:00:00 UTC : jamais une heure antérieure à la date de ce firmware
#endif
#ifndef POD_OTA_NTP_TIMEOUT_MS
#define POD_OTA_NTP_TIMEOUT_MS 8000UL
#endif
#ifndef POD_OTA_TLS_EXTRA_HEAP
#define POD_OTA_TLS_EXTRA_HEAP 2048UL      // tas supplémentaire exigé pour les ancres + le validateur X.509 (en plus de POD_OTA_MIN_HEAP) — À MESURER sur la carte
#endif

namespace podotatls {

/** Heure SNTP valide (>= plancher) en `timeoutMs`, sinon 0. Aucune dépendance au réseau de vote ; au plus quelques paquets UDP. */
static inline time_t clockNow(uint32_t timeoutMs) {
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  const unsigned long t0 = millis();
  time_t now = time(nullptr);
  while (now < (time_t)POD_OTA_TIME_FLOOR && (millis() - t0) < timeoutMs) { delay(100); now = time(nullptr); }
  return now >= (time_t)POD_OTA_TIME_FLOOR ? now : 0;
}

/** Ancres de confiance épinglées. `ok()` faux ⇒ le TLS ne doit PAS être ouvert (échec fermé). */
class Anchors {
 public:
  Anchors() { list_.append(POD_OTA_ROOT_GTS_R1); list_.append(POD_OTA_ROOT_ISRG_X1); }
  bool ok() const { return list_.getCount() == POD_OTA_ROOT_COUNT; }
  const BearSSL::X509List* list() const { return &list_; }
 private:
  BearSSL::X509List list_;
};

/** Arme un client TLS : ancres + heure. Aucun setInsecure, aucun setFingerprint. L'appelant ouvre ensuite la connexion avec le NOM D'HÔTE (jamais une adresse IP) : BearSSL contrôle alors le nom du certificat. */
static inline void arm(BearSSL::WiFiClientSecure& c, const Anchors& a, time_t now) {
  c.setTrustAnchors(a.list());
  c.setX509Time(now);
}

}  // namespace podotatls
