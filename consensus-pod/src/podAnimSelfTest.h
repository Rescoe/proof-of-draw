// podAnimSelfTest.h — AUTO-TEST du noyau d'animation (podAnimV3.h), UNIQUE pour l'ESP8266, l'UNO R4 et le PC (tests hôte). Lot 6C — BROUILLON INTERNE, NON PUBLIÉ.
//
// ⚠ Ce fichier n'est PAS un firmware : il est appelé par les exemples AnimSelfTestEsp8266 / AnimSelfTestUnoR4 (compilés, JAMAIS essayés sur une carte) et par consensus-pod/host/anim_selftest_host.cpp.
// Il utilise le VRAI noyau (PodAnimStream, PodSalted, pod_anim_vote_message) : aucune réimplémentation par plateforme. Seules deux choses dépendent de la carte : la lecture des clips en flash
// (memcpy_P sur ESP8266) et le SHA-256 (adaptateur fourni en paramètre de modèle).
//
// Le clip est traité EN FLUX par fragments de 1, 7, 61 et 256 octets, copiés de la flash vers UN tampon de 256 octets : le clip entier (jusqu'à 9 216 o) n'est JAMAIS en RAM. Les quatre découpages
// doivent donner exactement la même ligne de résultat, égale à la valeur attendue produite par la référence TypeScript (podAnimV3_selftest.h, généré).
//
// MÉMOIRE : tout l'état vit dans PodAnimTestWork, fourni par l'APPELANT (global/static ou tas alloué par lui) : JAMAIS sur la pile (la pile principale de l'UNO R4 fait ~1 Ko).
#pragma once
#include "podAnimV3.h"
#include "podAnimV3_selftest.h"

#if defined(ARDUINO_ARCH_ESP8266) || defined(ESP8266)
  #define POD_ANIMTEST_READ(dst, src, n) memcpy_P((dst), (src), (n))
  #define POD_ANIMTEST_STRCMP(a, b)      strcmp_P((a), (b))
  #define POD_ANIMTEST_STRCPY(dst, src)  strcpy_P((dst), (src))
#else
  #define POD_ANIMTEST_READ(dst, src, n) memcpy((dst), (src), (n))
  #define POD_ANIMTEST_STRCMP(a, b)      strcmp((a), (b))
  #define POD_ANIMTEST_STRCPY(dst, src)  strcpy((dst), (src))
#endif

#define POD_ANIMTEST_FRAG_MAX 256

typedef void (*PodAnimTestSink)(const char* line);
typedef uint32_t (*PodAnimTestClock)(void);    // microsecondes (micros() sur carte) ; peut être NULL

/** Tout l'état de l'auto-test (≈ 3,3 Ko avec un contexte SHA-256 de ~110 o) : à déclarer global/static, JAMAIS en variable locale. */
template <class Sha> struct PodAnimTestWork {
  PodAnimStream<Sha> stream;            // l'automate de lecture du clip
  PodSalted<Sha>     salted;            // hash salé par appareil (même lecture, second contexte SHA-256)
  PodAnimResult      res;               // résultat de l'automate
  uint8_t            frag[POD_ANIMTEST_FRAG_MAX];   // UN fragment de flux (jamais le clip entier)
  char               saltedHex[65];
  char               annClip[65], annRoot[65];      // valeurs « annoncées par le serveur »
  char               msg[512];          // message de vote pod-vote-v3-anim
  char               obs[768];          // ligne observée : rule|frames|E|T|R|S|poster|same|clipHash|framesRoot|animRoot|message
  char               line[160];         // ligne de compte rendu
};

template <class Sha> static inline const char* pod_anim_selftest_one(PodAnimTestWork<Sha>* w, const PodAnimTestCase* c, uint16_t fragSize, bool* ok) {
  PodAnimTestCase k; POD_ANIMTEST_READ(&k, c, sizeof(k));
  uint8_t nonce[32]; pod_salt_nonce<Sha>(POD_ANIMTEST_CANDIDATE, POD_ANIMTEST_PARENT, POD_ANIMTEST_DEVICE, nonce);
  w->stream.begin(); w->salted.begin(nonce);
  for (uint32_t off = 0; off < k.len;) {
    uint32_t n = k.len - off; if (n > fragSize) n = fragSize;
    POD_ANIMTEST_READ(w->frag, k.clip + off, n);
    w->stream.update(w->frag, n); w->salted.update(w->frag, n);
    off += n;
  }
  const bool formatOk = w->stream.finish(&w->res);
  w->salted.finish(w->saltedHex);
  POD_ANIMTEST_STRCPY(w->annClip, k.annClip); POD_ANIMTEST_STRCPY(w->annRoot, k.annRoot);
  if (k.corruptAnnounce) { char& last = w->annRoot[64 - 1]; last = (last == '0') ? '1' : '0'; }   // racine annoncée fausse
  const bool hashOk = formatOk && strcmp(w->res.clipHash, w->annClip) == 0 && strcmp(w->res.animRoot, w->annRoot) == 0;
  const PodAnimRule rule = pod_anim_evaluate_rules(formatOk, hashOk, w->res.allIdentical, w->res.E, w->res.T);
  const bool noCalc = (rule == POD_ANIM_FORMAT || rule == POD_ANIM_HASH);
  PodAnimVote v = { POD_ANIMTEST_DEVICE, POD_ANIMTEST_CANDIDATE, POD_ANIMTEST_PARENT, POD_METRICS_VERSION, POD_ANIM_RULES_VERSION, w->res.clipHash, w->annRoot, w->saltedHex,
                    rule == POD_ANIM_FORMAT ? 0u : w->res.frames, noCalc ? 0u : w->res.E, noCalc ? 0u : w->res.T, noCalc ? 0u : w->res.R, noCalc ? 0u : w->res.S, rule, POD_ANIMTEST_VCLASS };
  const int mlen = pod_anim_vote_message(w->msg, sizeof(w->msg), v);
  PodOut o(w->obs, sizeof(w->obs));
  o.str(pod_anim_rule_name(rule)); o.ch('|'); o.u64(formatOk ? w->res.frames : 0); o.ch('|');
  o.u64(formatOk ? w->res.E : 0); o.ch('|'); o.u64(formatOk ? w->res.T : 0); o.ch('|'); o.u64(formatOk ? w->res.R : 0); o.ch('|'); o.u64(formatOk ? w->res.S : 0); o.ch('|');
  o.u64(formatOk ? w->res.posterIndex : 0); o.ch('|'); o.u64(formatOk && w->res.allIdentical ? 1 : 0); o.ch('|');
  o.str(w->res.clipHash); o.ch('|'); o.str(formatOk ? w->res.framesRoot : ""); o.ch('|'); o.str(formatOk ? w->res.animRoot : ""); o.ch('|'); o.str(mlen < 0 ? "(message refusé)" : w->msg);
  *ok = o.ok && POD_ANIMTEST_STRCMP(w->obs, k.expect) == 0;
  return pod_anim_rule_name(rule);
}

static inline void pod_anim_selftest_say(PodAnimTestSink sink, char* line, size_t cap, const char* a, uint32_t n1, const char* b, uint32_t n2) {
  PodOut o(line, cap); o.str(a); o.u64(n1); if (b) { o.str(b); o.u64(n2); } sink(line);
}

/**
 * Exécute les 9 cas × 4 découpages. Retourne le nombre de VÉRIFICATIONS conformes (attendu : POD_ANIMTEST_COUNT × 4). `clock` (peut être NULL) : temps de traitement par cas, mesuré par l'APPELANT
 * (sur carte : micros() ⇒ MESURE MATÉRIELLE ; sur PC : horloge hôte ⇒ PAS une mesure de carte).
 */
template <class Sha> static inline int pod_anim_selftest_run(PodAnimTestWork<Sha>* w, PodAnimTestSink sink, PodAnimTestClock clock) {
  static const uint16_t FR[4] = { 1, 7, 61, POD_ANIMTEST_FRAG_MAX };
  int pass = 0;
  for (int i = 0; i < POD_ANIMTEST_COUNT; i++) {
    int good = 0; uint32_t us[4] = { 0, 0, 0, 0 }; const char* rule = "?";
    for (int f = 0; f < 4; f++) {
      const uint32_t t0 = clock ? clock() : 0; bool ok = false;
      rule = pod_anim_selftest_one<Sha>(w, &POD_ANIMTEST_CASES[i], FR[f], &ok);
      us[f] = clock ? clock() - t0 : 0;
      if (ok) good++; else { w->obs[60] = 0; PodOut o(w->line, sizeof(w->line)); o.str("[ANIMTEST] ECART c"); o.u64((uint64_t)i); o.str(" fragment="); o.u64(FR[f]); o.str(" obs="); o.str(w->obs); sink(w->line); }
    }
    pass += good;
    PodOut o(w->line, sizeof(w->line));
    o.str("[ANIMTEST] c"); o.u64((uint64_t)i); o.ch(' '); o.str(rule); o.str(good == 4 ? " OK " : " ECHEC "); o.u64((uint64_t)good); o.str("/4 decoupages");
    if (clock) { o.str(" us(frag1/7/61/256)="); for (int f = 0; f < 4; f++) { if (f) o.ch('/'); o.u64(us[f]); } }
    sink(w->line);
  }
  PodOut o(w->line, sizeof(w->line)); o.str("[ANIMTEST] RESULTAT "); o.str(pass == POD_ANIMTEST_COUNT * 4 ? "PASS " : "ECHEC "); o.u64((uint64_t)pass); o.ch('/'); o.u64((uint64_t)(POD_ANIMTEST_COUNT * 4)); sink(w->line);
  return pass;
}

/** Tailles (octets) des objets nécessaires au calcul : à relever à l'exécution ET à comparer à la taille mesurée dans l'ELF (nm). */
template <class Sha> static inline void pod_anim_selftest_sizes(PodAnimTestSink sink, char* line, size_t cap) {
  pod_anim_selftest_say(sink, line, cap, "[ANIMTEST] sizeof(PodAnimStream)=", (uint32_t)sizeof(PodAnimStream<Sha>), " sha=", (uint32_t)sizeof(Sha));
  pod_anim_selftest_say(sink, line, cap, "[ANIMTEST] sizeof(PodSalted)=", (uint32_t)sizeof(PodSalted<Sha>), " result=", (uint32_t)sizeof(PodAnimResult));
  pod_anim_selftest_say(sink, line, cap, "[ANIMTEST] sizeof(travail complet)=", (uint32_t)sizeof(PodAnimTestWork<Sha>), " fragment=", (uint32_t)POD_ANIMTEST_FRAG_MAX);
}
