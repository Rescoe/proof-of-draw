// pod_anim_esp.h — animation RÉSIDENTE sur ESP8266 : le clip d'un bloc d'animation est joué EN BOUCLE, sans aucune requête entre deux tâches réseau.
//
// ⚠⚠ NON TESTÉ SUR LE MATÉRIEL (écrit et compilé le 04/10/2026). Le lecteur de clips (pod_bench.h) est testé sur PC contre le décodeur TypeScript ;
// ce fichier-ci (réseau, flash, mémoire ESP8266, affichage réel) ne l'est pas. Même idée que le firmware R4 (r4tft28-2.4, carte microSD).
//
//   GET /api/pull           → { …, anim: { hash, bytes, frames } }   seulement si le firmware déclaré à l'enregistrement le lit (multiscreen-2.2+, tft18-2.2+)
//   GET /api/block-clip     → clip PBC1 binaire (≤ 9 216 o), public et immuable (CDN) ; validé ENTIÈREMENT (CRC, structure) avant tout usage
//
// Rangement : /anim.bin + /anim.txt en flash (LittleFS) → l'animation survit à un redémarrage. Si la carte n'a pas de partition LittleFS
// (IDE : Outils → Flash Size → « 4MB (FS:2MB …) »), le clip est simplement retéléchargé depuis le CDN avant chaque lecture (aucun coût Redis).
// Mémoire : le clip (≤ 9 Ko) n'est en RAM que PENDANT la lecture ; il est libéré avant toute connexion TLS (pull, vote).
//
// Ce fichier existe en plusieurs copies IDENTIQUES (un dossier de firmware est autonome) : `node scripts/sync-bench-header.js`.
// Le « Presenter » est celui du banc d'essai : begin(clip) · play(clip, cur, hook) · end().

#ifndef POD_ANIM_ESP_H
#define POD_ANIM_ESP_H

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <LittleFS.h>
#include "pod_bench.h"

namespace podanimesp {

static const size_t   MAX_CLIP       = 9216;     // même plafond que le serveur (lib/bench/clip.ts)
static const uint32_t MIN_TLS_BLOCK  = 17000;    // plus gros bloc libre pour télécharger : clip 9 Ko + copie 1 Ko + TLS BearSSL
static const char*    FILE_CLIP      = "/anim.bin";
static const char*    FILE_META      = "/anim.txt";   // 2 lignes : hash du bloc, taille

struct State {
  bool   fsOk = false;        // partition LittleFS utilisable
  bool   on = false;          // une animation est active (sur la flash, ou à retélécharger)
  String hash = "";           // bloc de l'animation active
  size_t bytes = 0;
  String pendingHash = "";    // pointeur reçu par le dernier pull (vide = aucun)
  size_t pendingBytes = 0;
};

/** Au démarrage : monte la flash et retrouve une animation éventuelle (elle reprend). */
inline void begin(State& st) {
  st.fsOk = LittleFS.begin();
  Serial.printf("[ANIM] flash LittleFS : %s\n", st.fsOk ? "disponible (le clip survit au redémarrage)" : "ABSENTE — le clip sera retéléchargé avant chaque lecture (IDE : Flash Size avec FS)");
  if (!st.fsOk || !LittleFS.exists(FILE_META) || !LittleFS.exists(FILE_CLIP)) return;
  File m = LittleFS.open(FILE_META, "r");
  if (!m) return;
  String h = m.readStringUntil('\n'); h.trim();
  String b = m.readStringUntil('\n'); b.trim();
  m.close();
  File f = LittleFS.open(FILE_CLIP, "r");
  const size_t n = f ? f.size() : 0;
  if (f) f.close();
  if (h.length() != 64 || (size_t)b.toInt() != n || n < (size_t)(podbench::HEADER_BYTES + 5 + podbench::FRAME_BYTES) || n > MAX_CLIP) {
    Serial.println("[ANIM] clip de la flash incohérent : ignoré");
    return;
  }
  st.on = true; st.hash = h; st.bytes = n;
  Serial.printf("[ANIM] clip trouvé en flash (bloc %s…, %u o) : lecture en boucle\n", h.substring(0, 12).c_str(), (unsigned)n);
}

/** L'œuvre affichée n'est plus une animation : on oublie le clip. */
inline void forget(State& st) {
  if (st.on) Serial.println("[ANIM] arrêt : nouvelle image fixe");
  st.on = false; st.hash = ""; st.bytes = 0;
  if (!st.fsOk) return;
  if (LittleFS.exists(FILE_META)) LittleFS.remove(FILE_META);
  if (LittleFS.exists(FILE_CLIP)) LittleFS.remove(FILE_CLIP);
}

/** À appeler à CHAQUE pull : mémorise (ou efface) le pointeur annoncé. */
inline void onPull(State& st, const char* hash, size_t bytes) {
  st.pendingHash = (hash && strlen(hash) == 64) ? String(hash) : String("");
  st.pendingBytes = st.pendingHash.length() ? bytes : 0;
  if (st.pendingHash.length()) Serial.printf("[ANIM] pointeur reçu : bloc %s…, %u o (animation active : %s)\n", st.pendingHash.substring(0, 12).c_str(), (unsigned)bytes, st.on ? "oui" : "non");
}

/** Télécharge le clip dans `buf` (announced octets exactement) depuis /api/block-clip. TLS fermé au retour. */
inline bool download(const String& serverUrl, const String& hash, size_t announced, uint8_t* buf, unsigned long& ms) {
  const unsigned long t0 = millis();
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  bool ok = false;
  if (http.begin(client, serverUrl + "/api/block-clip?hash=" + hash)) {
    http.setTimeout(15000);
    http.useHTTP10(true);
    const int code = http.GET();
    if (code == 200) {
      const int declared = http.getSize();
      if (declared < 0 || (size_t)declared == announced) {
        WiFiClient* stream = http.getStreamPtr();
        size_t total = 0;
        while (total < announced && millis() - t0 < 15000UL) {      // readFull : un flux TLS rend souvent MOINS que demandé
          if (stream->available()) total += stream->readBytes(buf + total, announced - total);
          else delay(5);
        }
        ok = (total == announced);
      }
    } else Serial.printf("[ANIM] clip : HTTP %d\n", code);
    http.end();
  }
  ms = millis() - t0;
  return ok;
}

/** Le pointeur du pull est-il nouveau ? Alors télécharge, valide, range en flash et active. À appeler APRÈS l'affichage de l'affiche. true = animation active. */
inline bool acquire(State& st, const String& serverUrl) {
  if (st.pendingHash.length() != 64) return st.on;
  if (st.on && st.hash == st.pendingHash) return true;                 // déjà en flash
  const size_t n = st.pendingBytes;
  if (n < (size_t)(podbench::HEADER_BYTES + 5 + podbench::FRAME_BYTES) || n > MAX_CLIP) { Serial.printf("[ANIM] taille refusée (%u)\n", (unsigned)n); return false; }
  // Le clip (n) + sa copie de travail (1 Ko) restent alloués pendant que la connexion TLS (BearSSL, ≈ 16 Ko d'un seul bloc) s'ouvre : il faut les deux.
  const uint32_t needDl = (uint32_t)n + podbench::FRAME_BYTES + MIN_TLS_BLOCK;
  Serial.printf("[ANIM] acquisition du clip : %u o, plus gros bloc libre %u (besoin %u), flash %s\n", (unsigned)n, (unsigned)ESP.getMaxFreeBlockSize(), (unsigned)needDl, st.fsOk ? "LittleFS" : "absente");
  if (ESP.getMaxFreeBlockSize() < needDl) { Serial.println("[ANIM] mémoire insuffisante pour télécharger le clip maintenant : réessai au prochain pull"); return false; }
  uint8_t* clip = (uint8_t*)malloc(n);
  uint8_t* cur = (uint8_t*)malloc(podbench::FRAME_BYTES);
  if (!clip || !cur) { free(clip); free(cur); Serial.println("[ANIM] malloc impossible"); return false; }
  unsigned long ms = 0;
  const bool got = download(serverUrl, st.pendingHash, n, clip, ms);
  podbench::Clip pc;
  const podbench::Err perr = got ? podbench::parse(clip, n, pc, cur) : podbench::ERR_SIZE;
  free(cur);
  if (!got || perr != podbench::OK) {
    Serial.printf("[ANIM] clip refusé (%s)\n", got ? podbench::errName(perr) : "téléchargement incomplet");
    free(clip);
    return false;
  }
  bool stored = false;
  if (st.fsOk) {                                                       // clip COMPLET d'abord, marqueur ensuite
    if (LittleFS.exists(FILE_META)) LittleFS.remove(FILE_META);
    File f = LittleFS.open(FILE_CLIP, "w");
    if (f) { stored = (f.write(clip, n) == n); f.close(); }
    if (stored) {
      File m = LittleFS.open(FILE_META, "w");
      if (m) { m.println(st.pendingHash); m.println((unsigned)n); m.close(); }
    } else { Serial.println("[ANIM] écriture en flash impossible : clip retéléchargé à chaque lecture"); if (LittleFS.exists(FILE_CLIP)) LittleFS.remove(FILE_CLIP); }
  }
  free(clip);
  st.on = true; st.hash = st.pendingHash; st.bytes = n;
  Serial.printf("[ANIM] clip reçu en %lu ms, %u images, %s : lecture en boucle\n", ms, (unsigned)pc.frames, stored ? "rangé en flash" : "gardé par son hash (retéléchargé à chaque lecture)");
  return true;
}

/** Temps avant la prochaine tâche réseau → budget de lecture. */
inline unsigned long budgetFromDue(long msUntilDue) { return msUntilDue < 0 ? 0UL : (unsigned long)msUntilDue; }

/**
 * Joue le clip EN BOUCLE pendant au plus `budgetMs`, puis rend la main (pull, vote… passent avant). Retourne false si la lecture est impossible
 * (l'animation est alors abandonnée : l'affiche reste à l'écran).
 */
template <class Presenter>
inline bool run(State& st, Presenter& P, const String& serverUrl, unsigned long budgetMs) {
  const size_t n = st.bytes;
  if (n < (size_t)(podbench::HEADER_BYTES + 5 + podbench::FRAME_BYTES) || n > MAX_CLIP) { Serial.println("[ANIM] taille de clip invalide"); st.on = false; return false; }
  const uint32_t need = (uint32_t)n + podbench::FRAME_BYTES + 2048;
  if (ESP.getMaxFreeBlockSize() < need || (!st.fsOk && ESP.getMaxFreeBlockSize() < need + MIN_TLS_BLOCK)) {
    Serial.printf("[ANIM] mémoire trop juste pour la lecture (bloc libre %u, besoin %u)\n", (unsigned)ESP.getMaxFreeBlockSize(), (unsigned)(st.fsOk ? need : need + MIN_TLS_BLOCK));
    delay(500);                                                        // pas d'abandon définitif : la mémoire se libère entre deux tâches
    return true;
  }
  uint8_t* clip = (uint8_t*)malloc(n);
  uint8_t* cur = (uint8_t*)malloc(podbench::FRAME_BYTES);
  if (!clip || !cur) { free(clip); free(cur); Serial.println("[ANIM] malloc impossible"); delay(500); return true; }
  bool loaded = false;
  if (st.fsOk && LittleFS.exists(FILE_CLIP)) {
    File f = LittleFS.open(FILE_CLIP, "r");
    if (f) { loaded = (f.size() == n && f.read(clip, n) == n); f.close(); }
  } else {
    unsigned long ms = 0;
    loaded = download(serverUrl, st.hash, n, clip, ms);
  }
  podbench::Clip pc;
  const podbench::Err perr = loaded ? podbench::parse(clip, n, pc, cur) : podbench::ERR_SIZE;
  if (!loaded || perr != podbench::OK) {
    Serial.printf("[ANIM] clip illisible (%s) : animation abandonnée\n", loaded ? podbench::errName(perr) : "lecture");
    free(clip); free(cur);
    st.on = false;
    return false;
  }
  Serial.printf("[ANIM] lecture : %u images, %lu ms avant la prochaine tâche réseau, %s\n", (unsigned)pc.frames, budgetMs, pc.loops == 0 ? "en boucle" : "boucles finies");
  P.begin(pc);
  const unsigned long tEnd = millis() + budgetMs;
  unsigned long target = millis();
  P.play(pc, cur, [&](uint32_t, uint16_t delayMs) -> bool {
    target += delayMs;                                                 // horloge ABSOLUE : pas de dérive cumulée
    while ((long)(millis() - target) < 0) {
      if ((long)(millis() - tEnd) >= 0) return false;
      delay(1);                                                        // delay() sert le Wi-Fi et le watchdog
    }
    return (long)(millis() - tEnd) < 0;
  });
  P.end();
  free(clip); free(cur);                                               // libérés AVANT d'ouvrir une connexion TLS
  return true;
}

}  // namespace podanimesp

#endif  // POD_ANIM_ESP_H
