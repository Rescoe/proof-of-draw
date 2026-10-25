// pod_wifi_portal.h — première connexion sans fil : LOGIQUE PURE du portail de configuration Wi-Fi (22/10/2026). Aucun accès matériel, aucune dépendance Arduino : testée sur l'HÔTE
// (consensus-pod/host/wifi_portal_harness.cpp, tests/wifiPortal.test.ts). Le branchement matériel (point d'accès, DNS, serveur HTTP, écran) est dans pod_wifi_portal_esp.h.
//
// Parcours : après un premier flash par câble SANS Wi-Fi, la carte ouvre un point d'accès temporaire « PoD-XXXX » protégé par un mot de passe ALÉATOIRE affiché sur son écran ; le téléphone s'y connecte,
// ouvre http://192.168.4.1 (portail captif), choisit le réseau de la box et saisit son mot de passe ; la carte l'enregistre dans l'enregistrement EEPROM de pod_wifi_cfg.h (octets 512..616 SEULEMENT),
// redémarre et reprend PoD normalement. Réactivation : bouton FLASH maintenu 2 s au démarrage, échec de connexion au réseau enregistré, ou commande série WIFI-PORTAL.
// Garde-fous : session bornée dans le temps (sauf première configuration), 5 enregistrements au plus par session, jeton anti-rejeu dans le formulaire, tout est échappé, aucun identifiant n'est journalisé.
#ifndef POD_WIFI_PORTAL_H
#define POD_WIFI_PORTAL_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include "pod_wifi_cfg.h"

// Les gros littéraux (page HTML, messages) vivent en FLASH sur la carte (PROGMEM) : sur l'ESP8266 un littéral ordinaire occupe de la RAM statique (budget du dépôt : <= 40 000 o). Sur l'hôte : identité.
#if defined(ARDUINO)
  #if __has_include(<pgmspace.h>)
  #include <pgmspace.h>   // ESP8266 ; sur UNO R4 les macros PSTR/strlen_P/memcpy_P/pgm_read_byte/snprintf_P viennent déjà de Arduino.h
  #endif
  #define POD_P(s) PSTR(s)
  #define POD_STRLEN_P(p) strlen_P(p)
  #define POD_MEMCPY_P(d, p, n) memcpy_P(d, p, n)
  #define POD_READ_P(p) pgm_read_byte(p)
  #define POD_SNPRINTF(buf, size, fmt, ...) snprintf_P(buf, size, PSTR(fmt), __VA_ARGS__)
#else
  #define POD_P(s) (s)
  #define POD_STRLEN_P(p) strlen(p)
  #define POD_MEMCPY_P(d, p, n) memcpy(d, p, n)
  #define POD_READ_P(p) (*(const uint8_t*)(p))
  #define POD_SNPRINTF(buf, size, fmt, ...) snprintf(buf, size, fmt, __VA_ARGS__)
#endif

namespace podportal {

static const int MAX_NETS = 12;                          // réseaux proposés dans la liste (les plus forts)
static const uint32_t SESSION_MS = 300000UL;             // 5 minutes (échec de connexion, bouton, série)
static const uint8_t MAX_SAVES = 5;                      // enregistrements tentés par session
static const int PAGE_MAX = 4096;                        // taille du tampon de page (tas, alloué seulement pendant le portail)

enum Reason : uint8_t { R_NONE = 0, R_NO_RECORD = 1, R_CONNECT_FAILED = 2, R_BUTTON = 3, R_SERIAL = 4 };
inline const char* reasonName(Reason r) { return r == R_NO_RECORD ? "premiere configuration" : r == R_CONNECT_FAILED ? "echec de connexion" : r == R_BUTTON ? "bouton FLASH" : r == R_SERIAL ? "commande serie" : "aucune"; }

/** Quand ouvrir le portail. Priorité : demande explicite (série, bouton) > pas d'enregistrement > échec de connexion au réseau enregistré. */
inline Reason decide(bool hasRecord, bool connectFailed, bool buttonHeld, bool serialRequest) {
  if (serialRequest) return R_SERIAL;
  if (buttonHeld) return R_BUTTON;
  if (!hasRecord) return R_NO_RECORD;
  if (connectFailed) return R_CONNECT_FAILED;
  return R_NONE;
}

/** Durée maximale de la session en ms ; 0 = illimitée. SANS enregistrement (première configuration) la carte n'a rien d'autre à faire : pas de limite. Sinon 5 minutes, puis reprise normale. */
inline uint32_t sessionLimitMs(Reason r) { return r == R_NO_RECORD ? 0UL : SESSION_MS; }

struct Session { uint32_t start; uint32_t limit; uint8_t saves; };
inline void sessionInit(Session& s, uint32_t now, Reason r) { s.start = now; s.limit = sessionLimitMs(r); s.saves = 0; }
inline bool sessionExpired(const Session& s, uint32_t now) { return s.limit != 0 && (uint32_t)(now - s.start) >= s.limit; }
/** Un enregistrement de plus est-il permis ? (compte la tentative). */
inline bool saveAllowed(Session& s) { if (s.saves >= MAX_SAVES) return false; s.saves++; return true; }

// ── secrets de session ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
typedef uint32_t (*RandFn)();                            // source d'aléa (matériel : RANDOM_REG32 ; test : générateur déterministe)

/** Mot de passe du point d'accès : 8 caractères pris dans 31 symboles SANS ambiguïté visuelle (ni 0/O, ni 1/I/L), soit ≈ 39,6 bits ; tirage par REJET (aucun biais) ; out : 9 octets. */
inline void apPassword(RandFn r, char out[9]) {
  static const char ALPHA[] = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 23 lettres + 8 chiffres = 31
  for (int i = 0; i < 8; i++) {
    uint32_t v = r() & 31u;
    for (int tries = 0; v >= 31u && tries < 64; tries++) v = r() & 31u;   // 31/32 d'acceptation ; 64 essais : probabilité d'échec ≈ 2^-320
    out[i] = ALPHA[v < 31u ? v : 0];
  }
  out[8] = 0;
}
/** Nom du point d'accès : « PoD- » + deux derniers octets de l'adresse MAC en hexadécimal majuscule (distingue plusieurs cartes) ; out : 9 octets. */
inline void apName(const uint8_t mac[6], char out[9]) {
  static const char H[] = "0123456789ABCDEF";
  out[0] = 'P'; out[1] = 'o'; out[2] = 'D'; out[3] = '-';
  out[4] = H[mac[4] >> 4]; out[5] = H[mac[4] & 15]; out[6] = H[mac[5] >> 4]; out[7] = H[mac[5] & 15]; out[8] = 0;
}
/** Jeton de formulaire : 16 caractères hexadécimaux (64 bits) ; out : 17 octets. */
inline void formToken(RandFn r, char out[17]) {
  static const char H[] = "0123456789abcdef";
  for (int w = 0; w < 2; w++) { const uint32_t v = r(); for (int i = 0; i < 8; i++) out[w * 8 + i] = H[(v >> (28 - 4 * i)) & 15u]; }
  out[16] = 0;
}
/** Comparaison en temps constant (seule la longueur peut fuir). */
inline bool ctEqual(const char* a, const char* b) {
  const size_t la = strlen(a), lb = strlen(b);
  if (la != lb) return false;
  uint8_t d = 0; for (size_t i = 0; i < la; i++) d |= (uint8_t)(a[i] ^ b[i]);
  return d == 0;
}

// ── formulaire ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
enum FormResult : uint8_t { F_OK = 0, F_BAD_TOKEN = 1, F_BAD_SSID = 2, F_BAD_PASS = 3, F_TOO_MANY = 4, F_SAVE_FAILED = 5 };

/** Valide la soumission. ssid : saisie manuelle si non vide, sinon la liste ; outSsid : 33 octets, outPass : 64 octets (remplis seulement si F_OK, sinon mis à zéro). Aucun rognage : un mot de passe peut contenir des espaces. */
inline FormResult checkForm(const char* token, const char* expected, const char* selSsid, const char* manualSsid, const char* pass, char* outSsid, char* outPass) {
  outSsid[0] = 0; outPass[0] = 0;
  if (!token || !expected || !ctEqual(token, expected) || expected[0] == 0) return F_BAD_TOKEN;
  const char* ssid = (manualSsid && manualSsid[0]) ? manualSsid : (selSsid ? selSsid : "");
  if (!pass) pass = "";
  if (!podwifi::valid(ssid, "")) return F_BAD_SSID;
  if (!podwifi::valid(ssid, pass)) return F_BAD_PASS;
  memcpy(outSsid, ssid, strlen(ssid) + 1); memcpy(outPass, pass, strlen(pass) + 1);
  return F_OK;
}

// ── rendu HTML borné ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
struct Buf {
  char* p; size_t cap; size_t n; bool over;
  /** Mode FLUX (UNO R4 : quelques Ko de tas seulement) : quand le tampon est plein il est remis à `flush` puis vidé ; la page n'a alors plus de taille maximale. Sans `stream()` : comportement d'origine (page refusée si trop grande). */
  typedef void (*FlushFn)(void* ctx, const char* data, size_t len);
  FlushFn flush; void* fctx;
  Buf(char* b, size_t c) : p(b), cap(c), n(0), over(false), flush(nullptr), fctx(nullptr) { if (cap) p[0] = 0; }
  void stream(FlushFn f, void* ctx) { flush = f; fctx = ctx; }
  /** Remet ce qui reste dans le tampon (mode flux) ; sans effet sinon. */
  void finish() { if (flush && n > 0) { flush(fctx, p, n); n = 0; p[0] = 0; } }
  void put(const char* s, size_t l, bool fromFlash) {   // mode flux seulement
    while (l > 0) {
      size_t room = cap - 1 - n;
      if (room == 0) { flush(fctx, p, n); n = 0; p[0] = 0; room = cap - 1; }
      const size_t k = l < room ? l : room;
      if (fromFlash) POD_MEMCPY_P(p + n, s, k); else memcpy(p + n, s, k);
      n += k; p[n] = 0; s += k; l -= k;
    }
  }
  void raw(const char* s) { const size_t l = strlen(s); if (flush) { put(s, l, false); return; } if (n + l + 1 > cap) { over = true; return; } memcpy(p + n, s, l + 1); n += l; }
  /** Littéral en FLASH (POD_P). */
  void rawP(const char* s) { const size_t l = POD_STRLEN_P(s); if (flush) { put(s, l, true); return; } if (n + l + 1 > cap) { over = true; return; } POD_MEMCPY_P(p + n, s, l + 1); n += l; }
  /** Texte échappé pour un contenu ou un attribut HTML (& < > " ') — un SSID est contrôlé par un tiers. */
  void esc(const char* s) { for (; *s; s++) escChar(*s); }
  /** Idem pour un texte en FLASH (POD_P). */
  void escP(const char* s) { for (char c = (char)POD_READ_P(s); c; c = (char)POD_READ_P(++s)) escChar(c); }
  void escChar(char c) {
    switch (c) {
      case '&': rawP(POD_P("&amp;")); return; case '<': rawP(POD_P("&lt;")); return; case '>': rawP(POD_P("&gt;")); return; case '"': rawP(POD_P("&quot;")); return; case '\'': rawP(POD_P("&#39;")); return;
      default: break;
    }
    if (flush) { put(&c, 1, false); return; }
    if (n + 2 > cap) { over = true; return; } p[n++] = c; p[n] = 0;
  }
};
struct Net { char ssid[podwifi::SSID_MAX + 1]; int8_t rssi; bool secure; };

/** Texte EN FLASH (à lire avec escP / POD_READ_P). */
inline const char* formMessage(FormResult f) {
  switch (f) {
    case F_BAD_TOKEN: return POD_P("Session expiree : recharge la page et recommence.");
    case F_BAD_SSID: return POD_P("Nom de reseau invalide (1 a 32 caracteres).");
    case F_BAD_PASS: return POD_P("Mot de passe invalide (8 a 63 caracteres, ou vide pour un reseau ouvert).");
    case F_TOO_MANY: return POD_P("Trop d'essais pour cette session : redemarre la carte.");
    case F_SAVE_FAILED: return POD_P("Enregistrement impossible : rien n'a ete modifie. Reessaie.");
    default: return POD_P("");
  }
}

/** Empreinte (SHA-256, base64) du SEUL script de la page (affichage/masquage du mot de passe) : la politique de sécurité n'autorise que lui ; un test recalcule l'empreinte depuis le texte du script. */
#define POD_PORTAL_JS_SHA256 "Dv0J8Tav62eJ11ly1v0ic80T3ZmgUeET1DMGMh3jXKI="

/** Page du formulaire. Retourne false si le tampon est trop petit (la page n'est alors PAS servie). */
inline bool renderForm(Buf& b, const Net* nets, int n, const char* token, FormResult msg) {
  b.rawP(POD_P("<!doctype html><html lang=fr><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>PoD - Wi-Fi</title>"
        "<style>body{font:16px system-ui,sans-serif;margin:0;background:#0a1828;color:#fff}main{max-width:26em;margin:0 auto;padding:1.2em}h1{color:#ffd700;font-size:1.3em}"
        "label{display:block;margin:.9em 0 .2em}select,input{width:100%;box-sizing:border-box;padding:.6em;font-size:1em;border-radius:6px;border:0}"
        "button{margin-top:1.2em;width:100%;padding:.8em;font-size:1.05em;border:0;border-radius:6px;background:#ffd700;color:#111}.m{background:#7a1f1f;padding:.6em;border-radius:6px}small{color:#9aa}</style></head><body><main>"
        "<h1>Etape 1/2 : le Wi-Fi de ta box</h1><p>Choisis le Wi-Fi de ta box et saisis son mot de passe. Si ton telephone propose de rester connecte malgre l'absence d'Internet, accepte.</p>"));
  if (msg != F_OK) { b.rawP(POD_P("<p class=m>")); b.escP(formMessage(msg)); b.rawP(POD_P("</p>")); }
  b.rawP(POD_P("<form method=post action=/save autocomplete=off><input type=hidden name=t value='")); b.esc(token); b.rawP(POD_P("'>"
        "<label for=s>Reseau de ta box</label><select id=s name=s>"));
  for (int i = 0; i < n && i < MAX_NETS; i++) {
    b.rawP(POD_P("<option value='")); b.esc(nets[i].ssid); b.rawP(POD_P("'>")); b.esc(nets[i].ssid); if (nets[i].secure) b.rawP(POD_P(" (protege)")); else b.rawP(POD_P(" (ouvert)")); b.rawP(POD_P("</option>"));
  }
  b.rawP(POD_P("</select><label for=m>ou autre nom de reseau (masque)</label><input id=m name=m maxlength=32 autocomplete=off autocapitalize=off>"
        "<label for=p>Mot de passe Wi-Fi</label><input id=p name=p type=password maxlength=63 autocomplete=off autocapitalize=off>"
        "<label><input id=v type=checkbox style='width:auto'> Afficher le mot de passe</label><script>document.getElementById('v').onchange=function(){document.getElementById('p').type=this.checked?'text':'password'}</script>"
        "<button type=submit>Enregistrer et redemarrer</button></form>"
        "<p><small>Le mot de passe reste dans la carte (jamais affiche, jamais journalise). Ce point d'acces est temporaire.</small></p></main></body></html>"));
  return !b.over;
}
inline bool renderDone(Buf& b, unsigned ssidLen, unsigned passLen) {
  char t[96]; POD_SNPRINTF(t, sizeof t, "Reseau enregistre (nom %u car., mot de passe %u car.).", ssidLen, passLen);
  b.rawP(POD_P("<!doctype html><html lang=fr><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>PoD - Wi-Fi</title>"
        "<style>body{font:16px system-ui,sans-serif;background:#0a1828;color:#fff;padding:1.2em}h1{color:#ffd700}</style></head><body><h1>Etape 1/2 terminee</h1><p>"));
  b.esc(t);
  b.rawP(POD_P("</p><ol><li>La carte redemarre et essaie de se connecter a ta box (environ 30 secondes).</li><li>Remets ton telephone sur ton Wi-Fi habituel (ou tes donnees mobiles).</li>"
        "<li>Etape 2/2 : si la carte n'est pas encore associee a ton compte PoD, son ecran affiche « 2/2 Compte » avec un QR. Scanne-le avec l'appareil photo, saisis ton nom d'artiste et touche « Connecter et dessiner » (rien n'est associe tant que tu ne l'as pas fait).</li></ol>"
        "<p>Si la carte est deja associee a ton compte, elle affiche « Connecte » : il n'y a rien d'autre a faire. Si la connexion echoue, l'ecran affiche « Echec Wi-Fi » et le Wi-Fi PoD-XXXX reapparait : recommence.</p></body></html>"));
  return !b.over;
}

}  // namespace podportal

#endif  // POD_WIFI_PORTAL_H
