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
static const char*    FILE_TMP       = "/anim.tmp";   // téléchargement en cours (renommé en /anim.bin une fois validé)

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
  if (st.fsOk && LittleFS.exists(FILE_TMP)) LittleFS.remove(FILE_TMP);   // téléchargement interrompu par une coupure
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

/**
 * Télécharge le clip DIRECTEMENT dans un fichier, par morceaux de 256 octets : aucun gros tampon en RAM pendant que la connexion TLS (BearSSL, ≈ 16 Ko
 * d'un seul bloc) est ouverte. C'est ce qui rend l'acquisition possible sur un ESP8266 dont le tas est déjà bien entamé (clip 9 Ko + TLS ne tiennent pas ensemble).
 */
inline bool downloadToFile(const String& serverUrl, const String& hash, size_t announced, const char* path, unsigned long& ms) {
  const unsigned long t0 = millis();
  bool ok = false;
  File f = LittleFS.open(path, "w");
  if (f) {
    {
      WiFiClientSecure client;
      client.setInsecure();
      HTTPClient http;
      if (http.begin(client, serverUrl + "/api/block-clip?hash=" + hash)) {
        http.setTimeout(15000);
        http.useHTTP10(true);
        const int code = http.GET();
        if (code == 200) {
          const int declared = http.getSize();
          if (declared < 0 || (size_t)declared == announced) {
            WiFiClient* stream = http.getStreamPtr();
            uint8_t chunk[256];
            size_t total = 0;
            while (total < announced && millis() - t0 < 20000UL) {
              if (stream->available()) {
                const size_t want = (announced - total) < sizeof(chunk) ? (announced - total) : sizeof(chunk);
                const size_t got = stream->readBytes(chunk, want);
                if (got > 0) { if (f.write(chunk, got) != got) { Serial.println("[ANIM] écriture en flash impossible"); break; } total += got; }
              } else delay(5);
            }
            ok = (total == announced);
          } else Serial.printf("[ANIM] clip : taille annoncée %d != %u\n", declared, (unsigned)announced);
        } else Serial.printf("[ANIM] clip : HTTP %d (mémoire ? plus gros bloc libre %u)\n", code, (unsigned)ESP.getMaxFreeBlockSize());
        http.end();
      } else Serial.println("[ANIM] clip : http.begin() impossible");
    }                                                                  // TLS fermé ici, AVANT de relire le fichier
    f.close();
  }
  ms = millis() - t0;
  if (!ok && LittleFS.exists(path)) LittleFS.remove(path);
  return ok;
}

/** Valide un clip rangé en fichier (CRC, structure) : lecture en RAM, TLS déjà fermé. */
inline bool validateFile(const char* path, size_t n) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  const bool sizeOk = (f.size() == n);
  uint8_t* clip = sizeOk ? (uint8_t*)malloc(n) : nullptr;
  uint8_t* cur = sizeOk ? (uint8_t*)malloc(podbench::FRAME_BYTES) : nullptr;
  bool ok = false;
  if (clip && cur && f.read(clip, n) == n) {
    podbench::Clip pc;
    const podbench::Err perr = podbench::parse(clip, n, pc, cur);
    ok = (perr == podbench::OK);
    if (!ok) Serial.printf("[ANIM] clip refusé (%s)\n", podbench::errName(perr));
    else Serial.printf("[ANIM] clip valide : %u images\n", (unsigned)pc.frames);
  } else if (sizeOk) Serial.println("[ANIM] mémoire insuffisante pour valider le clip");
  free(clip); free(cur);
  f.close();
  return ok;
}

/** Le pointeur du pull est-il nouveau ? Alors télécharge, valide, range en flash et active. À appeler APRÈS l'affichage de l'affiche. true = animation active. */
inline bool acquire(State& st, const String& serverUrl) {
  if (st.pendingHash.length() != 64) return st.on;
  if (st.on && st.hash == st.pendingHash) return true;                 // déjà en flash
  const size_t n = st.pendingBytes;
  if (n < (size_t)(podbench::HEADER_BYTES + 5 + podbench::FRAME_BYTES) || n > MAX_CLIP) { Serial.printf("[ANIM] taille refusée (%u)\n", (unsigned)n); return false; }

  if (st.fsOk) {
    // Avec une flash : téléchargement par morceaux directement dans un fichier (aucun tampon pendant le TLS), puis validation clip par clip hors TLS.
    Serial.printf("[ANIM] acquisition du clip : %u o vers la flash, plus gros bloc libre %u (besoin ≥ %u pour le TLS)\n", (unsigned)n, (unsigned)ESP.getMaxFreeBlockSize(), (unsigned)MIN_TLS_BLOCK);
    if (ESP.getMaxFreeBlockSize() < MIN_TLS_BLOCK) { Serial.println("[ANIM] mémoire insuffisante pour une connexion TLS maintenant : réessai au prochain pull"); return false; }
    if (LittleFS.exists(FILE_META)) LittleFS.remove(FILE_META);
    unsigned long ms = 0;
    if (!downloadToFile(serverUrl, st.pendingHash, n, FILE_TMP, ms)) { Serial.println("[ANIM] téléchargement échoué : réessai au prochain pull"); return false; }
    if (!validateFile(FILE_TMP, n)) { LittleFS.remove(FILE_TMP); return false; }
    if (LittleFS.exists(FILE_CLIP)) LittleFS.remove(FILE_CLIP);
    if (!LittleFS.rename(FILE_TMP, FILE_CLIP)) { Serial.println("[ANIM] renommage impossible"); LittleFS.remove(FILE_TMP); return false; }
    File m = LittleFS.open(FILE_META, "w");                            // clip COMPLET d'abord, marqueur ensuite
    if (m) { m.println(st.pendingHash); m.println((unsigned)n); m.close(); }
    st.on = true; st.hash = st.pendingHash; st.bytes = n;
    Serial.printf("[ANIM] clip reçu en %lu ms et rangé en flash : lecture en boucle\n", ms);
    return true;
  }

  // Sans flash : le clip doit tenir en RAM PENDANT la connexion TLS (clip + copie de travail + bloc TLS) ; il est retéléchargé avant chaque lecture.
  const uint32_t needDl = (uint32_t)n + podbench::FRAME_BYTES + MIN_TLS_BLOCK;
  Serial.printf("[ANIM] acquisition du clip : %u o en RAM (flash absente), plus gros bloc libre %u (besoin %u)\n", (unsigned)n, (unsigned)ESP.getMaxFreeBlockSize(), (unsigned)needDl);
  if (ESP.getMaxFreeBlockSize() < needDl) { Serial.println("[ANIM] mémoire insuffisante pour télécharger le clip : choisir un Flash Size avec FS (voir Apprendre), réessai au prochain pull"); return false; }
  uint8_t* clip = (uint8_t*)malloc(n);
  uint8_t* cur = (uint8_t*)malloc(podbench::FRAME_BYTES);
  if (!clip || !cur) { free(clip); free(cur); Serial.println("[ANIM] malloc impossible"); return false; }
  unsigned long ms = 0;
  const bool got = download(serverUrl, st.pendingHash, n, clip, ms);
  podbench::Clip pc;
  const podbench::Err perr = got ? podbench::parse(clip, n, pc, cur) : podbench::ERR_SIZE;
  free(cur); free(clip);
  if (!got || perr != podbench::OK) { Serial.printf("[ANIM] clip refusé (%s)\n", got ? podbench::errName(perr) : "téléchargement incomplet"); return false; }
  st.on = true; st.hash = st.pendingHash; st.bytes = n;
  Serial.printf("[ANIM] clip reçu en %lu ms, %u images (gardé par son hash, retéléchargé à chaque lecture)\n", ms, (unsigned)pc.frames);
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
