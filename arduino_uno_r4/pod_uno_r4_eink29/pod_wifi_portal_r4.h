// pod_wifi_portal_r4.h — première connexion sans fil sur UNO R4 WiFi : branchement MATÉRIEL du portail (point d'accès temporaire + serveur HTTP local), 25/10/2026.
// La logique pure (décisions, secrets de session, validation, pages échappées) est dans pod_wifi_portal.h, la même que sur les ESP8266 (testée sur l'hôte) ; l'enregistrement Wi-Fi a le même format (pod_wifi_cfg.h, octets 512..616 de la flash de données).
// ⚠ COMPILÉ seulement tant que la procédure d'essai sur la carte n'a pas eu lieu.
//
// Différences voulues avec l'ESP8266 :
//   • WiFiS3 n'a ni DNS captif ni compteur de stations : la page s'ouvre par le QR n° 2 (http://192.168.4.1/) ou en tapant l'adresse ; toute autre adresse est redirigée vers la page.
//   • TOUT appel au coprocesseur Wi-Fi (accept, lecture, écriture, arrêt) s'exécute dans une transaction sur PILE DÉDIÉE (podNetRun) : la pile principale de la R4 ne fait que 1 024 o. Un tour de boucle = une transaction.
//   • Aucun gros tampon statique : contexte, page HTML et requête sont alloués au tas à l'ouverture du portail et libérés à sa fermeture (le portail ne tourne jamais avec du TLS).
//   • L'écran e-ink porte DEUX QR (rejoindre le Wi-Fi PoD-XXXX / ouvrir la page) dès l'ouverture : un seul rafraîchissement, pas de mise à jour dynamique (usure du panneau).
// Sécurité identique : mot de passe de point d'accès ALÉATOIRE affiché sur l'écran, session bornée (sauf première configuration), 5 enregistrements au plus, jeton de formulaire, aucun identifiant journalisé.
#ifndef POD_WIFI_PORTAL_R4_H
#define POD_WIFI_PORTAL_R4_H

#include <new>
#include "pod_wifi_portal.h"

namespace podportalr4 {

enum Exit : uint8_t { EXIT_SAVED = 1, EXIT_TIMEOUT = 2, EXIT_FAILED = 5 };

static const int PAGE_CAP = 384;        // tampon de la page : la page est envoyée EN FLUX par morceaux (Buf::stream) ; sert aussi de zone de travail au traitement du formulaire (304 o)
static const int REQ_CAP = 640;         // requête HTTP lue (en-têtes + corps du formulaire : 4 champs, mot de passe de 63 octets au plus)
static const int NETS_CAP = 6;          // réseaux proposés (les plus forts)

/** EEPROM vue par pod_wifi_cfg.h : lecture directe, écriture groupée (UNE réécriture du bloc de flash pour tout l'enregistrement), relecture réelle (la flash de données se lit en direct). */
struct Ee {
  uint8_t rec[podwifi::LEN];
  int read(int i) { return EEPROM.read(i); }
  void write(int i, uint8_t v) { const int k = i - podwifi::OFF; if (k >= 0 && k < podwifi::LEN) rec[k] = v; }
  bool commit() { EEPROM.put(podwifi::OFF, rec); return true; }
  void reload() {}
};

struct Ctx {
  podportal::Net nets[NETS_CAP];
  int nNets;
  char apName[9], apPass[9], tok[17];
  char page[PAGE_CAP];
  char req[REQ_CAP];
  podportal::Session sess;
  podportal::FormResult shown;
  bool saved; uint32_t savedAt; unsigned savedS, savedP;
  WiFiServer* server;
  Ee ee;
  // relevé de la dernière requête (journalisé HORS transaction par la boucle)
  uint16_t dbgN; int dbgRead; uint32_t dbgSent, dbgWrote; char dbgLine[32];
  uint8_t dbgForm;            // 0 = pas un formulaire ; 1 = traité
  uint8_t dbgCode;            // FormResult (0 = F_OK)
  uint8_t dbgStore;           // 0 = pas tenté, 1 = écrit et relu, 2 = ÉCHEC
  uint8_t dbgLen[4];          // longueurs reçues des champs t, s, m, p (255 = champ absent)
  uint32_t dbgHeap;           // tas libre juste avant l'écriture en flash
};
static uint32_t g_sentAsked = 0, g_sentAccepted = 0;

// ── aléa : réserve SHA-256 d'entropie analogique + gigue d'horloge, puis flux en mode compteur (même niveau que la génération des clés du firmware) ─────────────────────────────────────────────────────────
static uint8_t g_rndPool[32];
static uint32_t g_rndCtr = 0;
static void __attribute__((noinline)) rndSeed() {
  SHA256 h; h.reset();
  for (int i = 0; i < 384; i++) {
    const uint16_t v = (uint16_t)analogRead(A0 + (i % 6));
    const uint32_t m = micros();
    h.update(&v, sizeof(v)); h.update(&m, sizeof(m));
    delayMicroseconds(29 + (v & 15));
  }
  h.finalize(g_rndPool, 32);
}
static uint32_t __attribute__((noinline)) rndNext() {
  SHA256 h; h.reset(); uint8_t d[32];
  h.update(g_rndPool, 32); h.update(&g_rndCtr, sizeof(g_rndCtr)); g_rndCtr++;
  h.finalize(d, 32);
  return (uint32_t)d[0] | ((uint32_t)d[1] << 8) | ((uint32_t)d[2] << 16) | ((uint32_t)d[3] << 24);
}

// ── décodage d'un champ de formulaire application/x-www-form-urlencoded ─────────────────────────────────────────────────────────────────────────────────
static int hv(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
/** Copie la valeur décodée du champ `key` (clé suivie de « = ») dans out (cap octets). Retourne false si le champ est absent ou trop long (jamais tronqué : un mot de passe tronqué serait faux). */
static bool __attribute__((noinline)) formField(const char* body, const char* key, char* out, size_t cap) {
  out[0] = 0;
  const size_t kl = strlen(key);
  for (const char* p = body; *p;) {
    const bool start = (p == body) || (*(p - 1) == '&');
    if (start && strncmp(p, key, kl) == 0 && p[kl] == '=') {
      const char* v = p + kl + 1; size_t n = 0;
      while (*v && *v != '&') {
        char c = *v;
        if (c == '+') c = ' ';
        else if (c == '%') { const int a = hv(v[1]), b = a < 0 ? -1 : hv(v[2]); if (a < 0 || b < 0) { out[0] = 0; return false; } c = (char)((a << 4) | b); v += 2; }
        if (n + 1 >= cap) { memset(out, 0, cap); return false; }
        out[n++] = c; v++;
      }
      out[n] = 0;
      return true;
    }
    while (*p && *p != '&') p++;
    if (*p == '&') p++;
  }
  return false;
}

static void __attribute__((noinline)) sendAll(WiFiClient& cl, const char* p, size_t n) {
  while (n > 0) { const size_t k = n > 256 ? 256 : n; const size_t w = cl.write((const uint8_t*)p, k); g_sentAsked += (uint32_t)k; g_sentAccepted += (uint32_t)w; p += k; n -= k; }
}
struct Sink { WiFiClient* cl; };
static void flushCb(void* ctx, const char* d, size_t n) { sendAll(*static_cast<Sink*>(ctx)->cl, d, n); }
/** En-têtes SANS Content-Length : la page est envoyée en flux et la connexion fermée à la fin (HTTP/1.1 le permet). */
static void __attribute__((noinline)) sendHeader(WiFiClient& cl, int code) {
  char h[400];                                              // en-tête complet = 283 o avec le code 200 : à 260 o il était TRONQUÉ (CSP coupée, jamais de ligne vide) et le navigateur affichait une page blanche (essai du 25/10/2026)
  const int hn = snprintf(h, sizeof h, "HTTP/1.1 %d %s\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-" POD_PORTAL_JS_SHA256 "'; form-action 'self'\r\nConnection: close\r\n\r\n",
           code, code == 200 ? "OK" : "Error");
  if (hn <= 0 || hn >= (int)sizeof h) return;                 // jamais d en-tête tronqué : rien n est envoyé plutôt qu un en-tête sans fin
  sendAll(cl, h, (size_t)hn);
}
static void __attribute__((noinline)) sendText(WiFiClient& cl, Ctx* c, int code, const char* text) {
  sendHeader(cl, code);
  strncpy(c->page, text, PAGE_CAP - 1); c->page[PAGE_CAP - 1] = 0;
  sendAll(cl, c->page, strlen(c->page));
}
static void __attribute__((noinline)) sendRedirect(WiFiClient& cl) {
  static const char R[] = "HTTP/1.1 302 Found\r\nLocation: http://192.168.4.1/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
  sendAll(cl, R, sizeof(R) - 1);
}
static void __attribute__((noinline)) showForm(WiFiClient& cl, Ctx* c) {
  sendHeader(cl, 200);
  Sink sk = { &cl };
  podportal::Buf b(c->page, PAGE_CAP); b.stream(flushCb, &sk);
  podportal::renderForm(b, c->nets, c->nNets, c->tok, c->shown);
  b.finish();
  c->shown = podportal::F_OK;
}
static void __attribute__((noinline)) handleSave(WiFiClient& cl, Ctx* c, const char* body) {
  // 4 champs lus un par un dans des tampons du contexte (aucun tableau de plus de 100 o sur la pile dédiée)
  char* t = c->page;                       // la page n'est pas utilisée avant la réponse : on y range temporairement t | s | m | p
  char* s = t + 24; char* m = s + 40; char* p = m + 40;                  // t : 17 o, s : 33 o, m : 33 o, p : 64 o  (24 + 40 + 40 + 72 = 176 <= PAGE_CAP)
  const bool okT = formField(body, "t", t, 24);
  const bool okS = formField(body, "s", s, 40);       // peut être absent (aucun réseau visible) : le nom saisi à la main suffit alors
  const bool okM = formField(body, "m", m, 40);
  const bool okP = formField(body, "p", p, 72);
  const bool ok = okT;
  c->dbgForm = 1; c->dbgStore = 0; c->dbgLen[0] = okT ? (uint8_t)strlen(t) : 255; c->dbgLen[1] = okS ? (uint8_t)strlen(s) : 255; c->dbgLen[2] = okM ? (uint8_t)strlen(m) : 255; c->dbgLen[3] = okP ? (uint8_t)strlen(p) : 255;
  podportal::FormResult r;
  char* so = c->page + 200; char* po = so + 40;                          // résultats validés : ssid 33 o, mot de passe 64 o
  if (!ok) r = podportal::F_BAD_TOKEN;
  else if (c->saved) { sendText(cl, c, 409, "deja enregistre"); return; }
  else if (!podportal::saveAllowed(c->sess)) r = podportal::F_TOO_MANY;
  else {
    r = podportal::checkForm(t, c->tok, s, m, p, so, po);
    if (r == podportal::F_OK) {
      c->dbgHeap = (uint32_t)freeHeapBytes();
      const bool stored = podwifi::store(c->ee, so, po);     // écriture relue et revalidée par pod_wifi_cfg.h
      c->dbgStore = stored ? 1 : 2;
      if (!stored) r = podportal::F_SAVE_FAILED;
    }
  }
  c->dbgCode = (uint8_t)r;
  if (r == podportal::F_OK) {
    c->saved = true; c->savedAt = millis(); c->savedS = (unsigned)strlen(so); c->savedP = (unsigned)strlen(po);
    memset(c->page + 24, 0, 300);                                       // identifiants effacés de la mémoire avant de rendre la page de fin
    sendHeader(cl, 200);
    Sink sk = { &cl };
    podportal::Buf b(c->page, PAGE_CAP); b.stream(flushCb, &sk);
    podportal::renderDone(b, c->savedS, c->savedP);
    b.finish();
  } else {
    memset(c->page, 0, 300);
    c->shown = r;
    showForm(cl, c);
  }
}

/** Un tour de boucle : accepte au plus UN client, lit sa requête (2 s au plus), répond, ferme. true = une requête a été traitée. S'exécute dans une transaction PodNet (pile dédiée). */
static bool __attribute__((noinline)) serveOnce(Ctx* c) {
  WiFiClient cl = c->server->available();
  if (!cl) return false;
  int n = 0, bodyAt = -1, want = 0;
  const uint32_t t0 = millis();
  c->req[0] = 0;
  while (millis() - t0 < 2000UL && n < REQ_CAP - 1) {
    const int a = cl.available();
    if (a <= 0) { if (!cl.connected()) break; delay(5); continue; }
    const int k = cl.read((uint8_t*)c->req + n, (size_t)((a < REQ_CAP - 1 - n) ? a : REQ_CAP - 1 - n));
    if (k <= 0) { delay(5); continue; }
    n += k; c->req[n] = 0;
    if (bodyAt < 0) {
      const char* e = strstr(c->req, "\r\n\r\n");
      if (e) {
        bodyAt = (int)(e + 4 - c->req);
        const char* cl_ = strstr(c->req, "Content-Length:");
        if (!cl_) cl_ = strstr(c->req, "content-length:");
        if (cl_) want = atoi(cl_ + 15);
        if (want < 0 || want > 400) want = 0;                           // corps anormal : lu tel quel, refusé par la validation
      }
    }
    if (bodyAt >= 0 && n >= bodyAt + want) break;
  }
  c->dbgN++; c->dbgRead = n; g_sentAsked = 0; g_sentAccepted = 0;
  { int i = 0; for (; i < 31 && c->req[i] && c->req[i] != '\r' && c->req[i] != '\n'; i++) c->dbgLine[i] = (c->req[i] >= 0x20 && c->req[i] < 0x7F) ? c->req[i] : '?'; c->dbgLine[i] = 0; }
  if (strncmp(c->req, "POST /save ", 11) == 0 && bodyAt >= 0) handleSave(cl, c, c->req + bodyAt);
  else if (strncmp(c->req, "GET / ", 6) == 0) showForm(cl, c);
  else sendRedirect(cl);
  cl.flush();
  delay(30);
  cl.stop();
  c->dbgSent = g_sentAsked; c->dbgWrote = g_sentAccepted;
  return true;
}

typedef void (*ScreenFn)(const char* apName, const char* apPass);
typedef bool (*TickFn)();

/**
 * Ouvre le portail et BLOQUE jusqu'à : enregistrement réussi (EXIT_SAVED : l'appelant redémarre), fin de session (EXIT_TIMEOUT), ou impossibilité d'ouvrir (EXIT_FAILED).
 * `scan` : réseaux visibles, relevés par l'appelant AVANT l'appel (wifiScan, pile Wi-Fi dédiée). `apStart` : démarre le point d'accès (pile Wi-Fi dédiée) ; `apStop` l'arrête.
 */
typedef bool (*ApStartFn)(const char* name, const char* pass);
typedef void (*ApStopFn)();
typedef int (*ScanFn)(podportal::Net* nets, int cap);

static Exit __attribute__((noinline)) run(podportal::Reason reason, const uint8_t mac[6], ScanFn scan, ApStartFn apStart, ApStopFn apStop, ScreenFn screen, TickFn tick) {
  Ctx* c = (Ctx*)malloc(sizeof(Ctx));
  if (!c) { logf("[PORTAL] memoire insuffisante (%u o) : portail NON ouvert", (unsigned)sizeof(Ctx)); return EXIT_FAILED; }
  memset(c, 0, sizeof(Ctx));
  reportMem("portail: contexte alloue");
  rndSeed();
  podportal::apName(mac, c->apName); podportal::apPassword(rndNext, c->apPass); podportal::formToken(rndNext, c->tok);
  c->nNets = scan ? scan(c->nets, NETS_CAP) : 0;
  reportMem("portail: apres balayage");
  logf("[PORTAL] ouvert (raison : %s ; %d reseau(x) visible(s))", podportal::reasonName(reason), c->nNets);
  if (!apStart(c->apName, c->apPass)) { logf("[PORTAL] point d'acces impossible"); memset(c, 0, sizeof(Ctx)); free(c); return EXIT_FAILED; }
  reportMem("portail: point d acces demarre");
  WiFiServer* srv = (WiFiServer*)malloc(sizeof(WiFiServer));
  if (!srv) { apStop(); memset(c, 0, sizeof(Ctx)); free(c); logf("[PORTAL] memoire insuffisante pour le serveur"); return EXIT_FAILED; }
  c->server = new (srv) WiFiServer(80);
  {
    PodNetInfo ni; auto begin = [&]() { c->server->begin(); };
    if (!podNetRun(begin, &ni)) { logf("[PORTAL] serveur : %s", podNetWhy(ni)); apStop(); memset(c, 0, sizeof(Ctx)); free(c); return EXIT_FAILED; }
  }
  podportal::sessionInit(c->sess, millis(), reason);
  screen(c->apName, c->apPass);                                         // écran e-ink : deux QR (un seul rafraîchissement) — bloque ~15 s
  reportMem("portail ouvert");
  Exit result = EXIT_TIMEOUT; uint8_t fails = 0;
  for (;;) {
    PodNetInfo ni; bool did = false;
    auto turn = [&]() { did = serveOnce(c); };
    c->dbgForm = 0;
    if (!podNetRun(turn, &ni)) { logf("[PORTAL] transaction en echec : %s (erreur %u, marge %u o)", podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin); if (++fails >= 25) { logf("[PORTAL] transactions en echec (%s) : arret", podNetWhy(ni)); result = EXIT_FAILED; break; } delay(200); }
    else fails = 0;
    if (did) logf("[PORTAL] requete #%u \"%s\" : %d o lus, %lu o a envoyer, %lu o acceptes par le module", (unsigned)c->dbgN, c->dbgLine, c->dbgRead, (unsigned long)c->dbgSent, (unsigned long)c->dbgWrote);
    if (did && c->dbgForm) logf("[PORTAL] formulaire : champs t/s/m/p = %u/%u/%u/%u o (255 = absent), resultat %u (0 = OK), ecriture %u (1 = OK, 2 = ECHEC), tas avant ecriture %lu o", (unsigned)c->dbgLen[0], (unsigned)c->dbgLen[1], (unsigned)c->dbgLen[2], (unsigned)c->dbgLen[3], (unsigned)c->dbgCode, (unsigned)c->dbgStore, (unsigned long)c->dbgHeap);
    if (c->saved && millis() - c->savedAt > 2500UL) { result = EXIT_SAVED; break; }
    if (!c->saved && podportal::sessionExpired(c->sess, millis())) { logf("[PORTAL] fin de session"); result = EXIT_TIMEOUT; break; }
    if (tick && tick()) { result = EXIT_TIMEOUT; break; }
    if (!did) delay(20);
  }
  // WiFiServer n a pas de stop() : le destructeur libère l objet, la carte redémarre ensuite (sortie par NVIC_SystemReset)
  c->server->~WiFiServer(); free(srv);
  apStop();
  memset(c, 0, sizeof(Ctx)); free(c);                                    // jeton, mot de passe du point d'accès et identifiants effacés avant libération
  return result;
}

}  // namespace podportalr4

#endif  // POD_WIFI_PORTAL_R4_H
