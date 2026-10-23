// pod_wifi_portal_esp.h — première connexion sans fil : branchement MATÉRIEL du portail (point d'accès temporaire + DNS captif + serveur HTTP local), 22/10/2026.
// La logique pure (décisions, secrets de session, validation, pages échappées) est dans pod_wifi_portal.h et testée sur l'hôte ; ce fichier-ci n'a été que COMPILÉ : il n'a jamais tourné sur une carte avant la
// procédure d'essai guidée (docs/PORTAIL_WIFI_PREMIERE_CONNEXION_2026_10_22.md).
//
// Mémoire : AUCUN objet statique volumineux — le serveur, le DNS et le tampon de page (4 Ko) sont alloués au tas à l'ouverture du portail et libérés à la fermeture. Le portail ne tourne JAMAIS en même temps que du TLS
// (il est appelé avant toute connexion réseau, ou à la place d'un redémarrage) : le budget mémoire du vote et de l'OTA n'est pas touché.
// Sécurité : le point d'accès est protégé par un mot de passe ALÉATOIRE de session affiché sur l'écran (il prouve la présence physique) ; session bornée (5 min, sauf première configuration), 5 enregistrements au plus,
// jeton de formulaire, CSP sans script, aucun SSID ni mot de passe journalisé (longueurs seulement), seul l'enregistrement Wi-Fi (octets 512..616) est écrit : identité, clés et état PoD ne sont jamais touchés.
#ifndef POD_WIFI_PORTAL_ESP_H
#define POD_WIFI_PORTAL_ESP_H

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <DNSServer.h>
#include "pod_wifi_portal.h"

namespace podportalesp {

enum Exit : uint8_t { EXIT_SAVED = 1, EXIT_TIMEOUT = 2, EXIT_RECONNECTED = 3, EXIT_TICK = 4, EXIT_FAILED = 5 };
/** Dessine l'écran d'instructions : en-tête (12 caractères au plus), quatre lignes de texte court (21 caractères au plus) ET le QR de connexion au point d'accès (« WIFI:T:WPA;S:<nom>;P:<mot de passe>;; » : le téléphone rejoint
 *  le Wi-Fi en le scannant ; chaîne vide = pas de QR). Le QR ne contient PAS l'adresse de la page : il fait seulement rejoindre le Wi-Fi ; la page s'ouvre souvent d'elle-même (portail captif), sans garantie : l'adresse de secours est affichée. */
typedef void (*ScreenFn)(const char* l1, const char* l2, const char* l3, const char* l4, const char* l5, const char* qr);
/** Appelé à chaque tour de boucle ; true = sortir (ex. une commande série vient de modifier l'enregistrement : redémarrer). */
typedef bool (*TickFn)();

static uint32_t hwRandom() { return RANDOM_REG32; }       // générateur matériel de l'ESP8266 (entropie réelle quand le Wi-Fi est actif)

/**
 * Ouvre le portail et BLOQUE jusqu'à : enregistrement réussi (EXIT_SAVED : l'appelant redémarre), fin de session (EXIT_TIMEOUT) ou demande de l'appelant (EXIT_TICK).
 * E : l'EEPROM vue par pod_wifi_cfg.h (read/write/commit/reload). Point d'accès SEUL (jamais AP+STA : le canal du point d'accès suivrait celui de la box) : aucune reconnexion en arrière-plan, le redémarrage
 * qui suit une fin de session refait la tentative. storedSsid / storedPass : conservés pour la compatibilité de signature, non utilisés.
 */
template <class E> Exit run(podportal::Reason reason, E& eeprom, ScreenFn screen, TickFn tick, const char* storedSsid, const char* storedPass) {
  char apPw[9], apNm[9], tok[17]; uint8_t mac[6];
  WiFi.macAddress(mac); podportal::apName(mac, apNm); podportal::apPassword(hwRandom, apPw); podportal::formToken(hwRandom, tok);
  char* page = (char*)malloc(podportal::PAGE_MAX);
  podportal::Net* nets = (podportal::Net*)malloc(sizeof(podportal::Net) * podportal::MAX_NETS);
  if (!page || !nets) { free(page); free(nets); Serial.println(F("[PORTAL] memoire insuffisante : portail NON ouvert")); return EXIT_FAILED; }
  int nNets = 0;

  // Le SDK garde en flash l'ANCIEN réseau (WiFi.begin d'avant) et s'y reconnecte tout seul dès qu'une interface STA existe : en mode AP+STA le point d'accès change alors de canal pour suivre la box (constaté : le
  // téléphone rejoint le Wi-Fi de la carte mais la page ne répond plus). On neutralise donc la reconnexion, on balaie en STA seule, puis on passe en point d'accès SEUL.
  WiFi.persistent(false); WiFi.setAutoConnect(false); WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA); WiFi.disconnect(false); delay(100);
  (void)storedSsid; (void)storedPass;
  // 1. réseaux visibles (avant que le téléphone ne se connecte : le balayage perturbe le point d'accès) ; dédoublonnés, les plus forts d'abord, aucun nom journalisé
  const int found = WiFi.scanNetworks(false, false);
  for (int i = 0; i < found; i++) {
    const String s = WiFi.SSID(i); if (s.length() < 1 || s.length() > (unsigned)podwifi::SSID_MAX) continue;
    bool dup = false; for (int k = 0; k < nNets; k++) if (strcmp(nets[k].ssid, s.c_str()) == 0) { dup = true; if (WiFi.RSSI(i) > nets[k].rssi) nets[k].rssi = (int8_t)WiFi.RSSI(i); }
    if (dup) continue;
    if (nNets < podportal::MAX_NETS) { memset(&nets[nNets], 0, sizeof nets[nNets]); strncpy(nets[nNets].ssid, s.c_str(), podwifi::SSID_MAX); nets[nNets].rssi = (int8_t)WiFi.RSSI(i); nets[nNets].secure = WiFi.encryptionType(i) != ENC_TYPE_NONE; nNets++; }
    else { int w = 0; for (int k = 1; k < nNets; k++) if (nets[k].rssi < nets[w].rssi) w = k; if (WiFi.RSSI(i) > nets[w].rssi) { memset(&nets[w], 0, sizeof nets[w]); strncpy(nets[w].ssid, s.c_str(), podwifi::SSID_MAX); nets[w].rssi = (int8_t)WiFi.RSSI(i); nets[w].secure = WiFi.encryptionType(i) != ENC_TYPE_NONE; } }
  }
  WiFi.scanDelete();
  for (int a = 0; a < nNets; a++) for (int b = a + 1; b < nNets; b++) if (nets[b].rssi > nets[a].rssi) { podportal::Net t = nets[a]; nets[a] = nets[b]; nets[b] = t; }
  Serial.printf_P(PSTR("[PORTAL] ouvert (raison : %s ; %d reseau(x) visible(s))\n"), podportal::reasonName(reason), nNets);

  // 2. point d'accès protégé (WPA2, mot de passe de session), canal 6, 2 clients au plus
  WiFi.mode(WIFI_AP); delay(100);                                   // point d'accès SEUL : aucun canal à suivre
  const IPAddress ip(192, 168, 4, 1);
  WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0));
  if (!WiFi.softAP(apNm, apPw, 6, 0, 2)) { Serial.println(F("[PORTAL] point d'acces impossible")); free(page); free(nets); WiFi.mode(WIFI_STA); return EXIT_FAILED; }

  DNSServer* dns = new DNSServer(); ESP8266WebServer* server = new ESP8266WebServer(80);
  if (!dns || !server) { delete dns; delete server; free(page); free(nets); WiFi.softAPdisconnect(true); WiFi.mode(WIFI_STA); return EXIT_FAILED; }
  dns->setErrorReplyCode(DNSReplyCode::NoError); dns->start(53, "*", ip);        // portail captif : tout nom résout vers la carte

  podportal::Session sess; podportal::sessionInit(sess, millis(), reason);
  bool saved = false; uint32_t savedAt = 0; unsigned savedS = 0, savedP = 0; podportal::FormResult shown = podportal::F_OK;
  auto sendHeaders = [&]() { server->sendHeader(F("Cache-Control"), F("no-store")); server->sendHeader(F("X-Frame-Options"), F("DENY")); server->sendHeader(F("Content-Security-Policy"), F("default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-" POD_PORTAL_JS_SHA256 "'; form-action 'self'")); };
  auto redirect = [&]() { Serial.println(F("[PORTAL] requete : redirection captive")); server->sendHeader(F("Location"), F("http://192.168.4.1/"), true); server->send(302, F("text/plain"), F("")); };
  auto form = [&]() {
    Serial.println(F("[PORTAL] requete : page du formulaire"));
    podportal::Buf b(page, podportal::PAGE_MAX);
    if (!podportal::renderForm(b, nets, nNets, tok, shown)) { server->send(500, F("text/plain"), F("page trop grande")); return; }
    sendHeaders(); server->send(200, F("text/html; charset=utf-8"), page); shown = podportal::F_OK;
  };
  server->on("/", HTTP_GET, form);
  // détection de portail captif (Android, iOS, Windows, Firefox) : tout est redirigé vers la page (chemins en flash : aucune RAM statique)
  auto captive = [&](const __FlashStringHelper* path) { server->on(String(path), HTTP_ANY, redirect); };
  captive(F("/generate_204")); captive(F("/gen_204")); captive(F("/hotspot-detect.html")); captive(F("/library/test/success.html")); captive(F("/ncsi.txt"));
  captive(F("/connecttest.txt")); captive(F("/fwlink")); captive(F("/redirect")); captive(F("/canonical.html")); captive(F("/success.txt"));
  server->onNotFound(redirect);
  server->on("/save", HTTP_POST, [&]() {
    char s[podwifi::SSID_MAX + 1], pw[podwifi::PASS_MAX + 1]; podportal::FormResult r;
    if (saved) { server->send(409, F("text/plain"), F("deja enregistre")); return; }
    if (server->args() > 8 || server->arg("p").length() > 100 || server->arg("m").length() > 100 || server->arg("s").length() > 100) r = podportal::F_BAD_SSID;     // corps anormal : refusé sans analyse
    else if (!podportal::saveAllowed(sess)) r = podportal::F_TOO_MANY;
    else {
      r = podportal::checkForm(server->arg("t").c_str(), tok, server->arg("s").c_str(), server->arg("m").c_str(), server->arg("p").c_str(), s, pw);
      if (r == podportal::F_OK && !podwifi::store(eeprom, s, pw)) r = podportal::F_SAVE_FAILED;     // écriture relue et revalidée par pod_wifi_cfg.h
    }
    if (r == podportal::F_OK) {
      saved = true; savedAt = millis(); savedS = (unsigned)strlen(s); savedP = (unsigned)strlen(pw);
      Serial.printf_P(PSTR("[PORTAL] enregistrement ecrit et verifie (ssid %u o, mdp %u o) : redemarrage\n"), savedS, savedP);
      podportal::Buf b(page, podportal::PAGE_MAX); podportal::renderDone(b, savedS, savedP); sendHeaders(); server->send(200, F("text/html; charset=utf-8"), page);
    } else { shown = r; Serial.printf_P(PSTR("[PORTAL] enregistrement refuse (code %u)\n"), (unsigned)r); form(); }
    memset(s, 0, sizeof s); memset(pw, 0, sizeof pw);
  });
  server->begin();

  char l3[24]; snprintf_P(l3, sizeof l3, PSTR("%s mdp:%s"), apNm, apPw);               // secours manuel : nom ET mot de passe sur une ligne (21 caractères)
  char qr[48]; snprintf(qr, sizeof qr, "WIFI:T:WPA;S:%s;P:%s;;", apNm, apPw);            // noms et mot de passe sans caractère spécial : aucun échappement nécessaire
  static const char PAGE_URL[] PROGMEM = "http://192.168.4.1/";                           // QR n° 2 de l'étape 1/2 : ouvre la page locale quand l'ouverture automatique ne se fait pas
  const char* hdr = reason == podportal::R_CONNECT_FAILED ? "Echec Wi-Fi" : "1/2 Wi-Fi";
  char l2[24], l4[24], l5[24];
  auto showWait = [&](bool joined) {
    strncpy_P(l2, joined ? PSTR("1 OK: Wi-Fi rejoint") : PSTR("1 Scanne, rejoins PoD"), sizeof l2 - 1); l2[sizeof l2 - 1] = 0;
    strncpy_P(l4, joined ? PSTR("2 Scanne ce QR: page") : PSTR("2 Ouvre la page Wi-Fi"), sizeof l4 - 1); l4[sizeof l4 - 1] = 0;
    strncpy_P(l5, PSTR("(auto ou 192.168.4.1)"), sizeof l5 - 1); l5[sizeof l5 - 1] = 0;
    char url[24]; strncpy_P(url, PAGE_URL, sizeof url - 1); url[sizeof url - 1] = 0;
    screen(hdr, l2, l3, l4, l5, joined ? url : qr);                                              // appareil connecté : le QR devient celui de la page locale
  };
  showWait(false);
  bool savedShown = false;
  int lastStations = -1; Exit result = EXIT_TIMEOUT;
  for (;;) {
    dns->processNextRequest(); server->handleClient();
    if (saved && millis() - savedAt > 2500UL) { result = EXIT_SAVED; break; }                      // laisse partir la réponse HTTP avant de redémarrer
    if (!saved && podportal::sessionExpired(sess, millis())) { Serial.println(F("[PORTAL] fin de session")); result = EXIT_TIMEOUT; break; }
    if (tick && tick()) { result = EXIT_TICK; break; }
    const int st = WiFi.softAPgetStationNum();
    if (saved && !savedShown) {
      savedShown = true;                                                                           // une fois : ecran « enregistre » (sans QR) pendant la reponse HTTP puis le redemarrage
      strncpy_P(l2, PSTR("Remets ton telephone"), sizeof l2 - 1); l2[sizeof l2 - 1] = 0;
      strncpy_P(l3, PSTR("sur ton Wi-Fi de box"), sizeof l3 - 1); l3[sizeof l3 - 1] = 0;
      strncpy_P(l4, PSTR("Puis regarde la carte"), sizeof l4 - 1); l4[sizeof l4 - 1] = 0;
      strncpy_P(l5, PSTR("(etape 2/2 : compte)"), sizeof l5 - 1); l5[sizeof l5 - 1] = 0;
      screen("1/2 Fait", l2, l3, l4, l5, "");
    }
    if (!saved && st != lastStations) { lastStations = st; Serial.printf_P(PSTR("[PORTAL] appareils connectes au point d'acces : %d\n"), st); showWait(st > 0); }
    delay(2);                                                                                      // nourrit le chien de garde
  }
  server->stop(); dns->stop(); delete server; delete dns;
  memset(apPw, 0, sizeof apPw); memset(tok, 0, sizeof tok); memset(l3, 0, sizeof l3); memset(qr, 0, sizeof qr);
  free(page); free(nets);
  WiFi.softAPdisconnect(true); WiFi.mode(WIFI_STA);
  return result;
}

}  // namespace podportalesp

#endif  // POD_WIFI_PORTAL_ESP_H
