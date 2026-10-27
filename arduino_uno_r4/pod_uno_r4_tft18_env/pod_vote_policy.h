// pod_vote_policy.h — LOT 1 (28/10/2026) : règles PURES du vote d'un candidat (aucune dépendance Arduino ; testées sur l'hôte par tests/voteCandidatePolicy.test.ts).
//   • un candidat en attente n'est retiré que lorsque son issue est CLASSÉE (vote envoyé, refus définitif du serveur, candidat disparu) ou après VOTE_MAX_TRIES essais transitoires ;
//   • un échec transitoire (mémoire, pile réseau, panne HTTP, téléchargement incomplet, signature) est une ABSTENTION journalisée, jamais un refus signé « blank » ;
//   • le tampon de métriques n'est réservé que pour les formats qui en exigent (OLED 1 024 o, e-ink 2,9″ 4 736 o).
#ifndef POD_VOTE_POLICY_H
#define POD_VOTE_POLICY_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "pod_metrics.h"

#define VOTE_MAX_TRIES 3                    // au plus 3 essais par candidat ; au-delà il est abandonné (journalisé) pour ne pas relire 40 Ko en boucle

struct PodVoteTries { char id[9]; uint8_t tries; };

/** Compte les essais PAR candidat : un autre identifiant remet le compteur à zéro. */
static inline void podVoteTrack(PodVoteTries& t, const char* candidateId) {
  if (strncmp(t.id, candidateId, 8) != 0) { strncpy(t.id, candidateId, 8); t.id[8] = 0; t.tries = 0; }
}
/** Le candidat a déjà épuisé ses essais : il ne repart pas, même ré-annoncé par le serveur. */
static inline bool podVoteGaveUp(const PodVoteTries& t) { return t.tries >= VOTE_MAX_TRIES; }
/** Un essai transitoire vient d'échouer : true = garder le candidat pour le prochain cycle, false = abandon. */
static inline bool podVoteKeep(PodVoteTries& t) { return ++t.tries < VOTE_MAX_TRIES; }
/** L'issue est classée (vote envoyé, refus définitif, candidat disparu) : le compteur repart de zéro. */
static inline void podVoteClassified(PodVoteTries& t) { t.tries = 0; }

/** Tampon exigé par la lecture d'un candidat de ce format (0 = aucun). */
static inline size_t podScratchNeed(PodScreenKind k) { return k == POD_OLED096 ? 1024 : (k == POD_EINK29BWR ? 4736 : 0); }

/** Panne HTTP transitoire (connexion impossible, pile indisponible, erreur serveur) : on peut réessayer. 4xx = décision du serveur : définitif. */
static inline bool podHttpTransient(int code) { return code <= 0 || code >= 500; }
/** Lecture du candidat échouée : réessayer ? (panne transitoire, ou 200 avec un téléchargement incomplet) ; 4xx (candidat disparu, refus) : définitif. */
static inline bool podCandidateReadRetry(int httpCode) { return podHttpTransient(httpCode) || httpCode == 200; }

#endif  // POD_VOTE_POLICY_H
