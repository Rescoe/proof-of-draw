// vote_policy_harness.cpp — LOT 1 (28/10/2026) : exerce pod_vote_policy.h (règles pures du vote d'un candidat). Chaque ligne de sortie est comparée par tests/voteCandidatePolicy.test.ts.
#include <cstdio>
#include "pod_vote_policy.h"

int main() {
  // 1. essais : garder, garder, abandonner ; le candidat abandonné ne repart pas même ré-annoncé ; un autre candidat repart à zéro
  PodVoteTries t; memset(&t, 0, sizeof(t));
  podVoteTrack(t, "5992f133-85bf-412e-9960-5c8342b5f500");
  for (int i = 1; i <= 3; i++) {                              // l'ordre d'évaluation des arguments de printf n'est pas défini : on séquence explicitement
    const int keep = podVoteKeep(t) ? 1 : 0;
    const int gaveUp = podVoteGaveUp(t) ? 1 : 0;
    std::printf("TRY%d %d %d\n", i, keep, gaveUp);
  }
  podVoteTrack(t, "5992f133-85bf-412e-9960-5c8342b5f500");
  const int again = podVoteGaveUp(t) ? 1 : 0;
  std::printf("REANNOUNCED gaveup=%d\n", again);
  podVoteTrack(t, "63fc141f-dc25-4fe1-bb82-5757a3f427d5");
  const int otherGave = podVoteGaveUp(t) ? 1 : 0;
  std::printf("OTHER gaveup=%d tries=%d\n", otherGave, (int)t.tries);
  // 2. une issue classée remet le compteur à zéro
  podVoteKeep(t); podVoteKeep(t); podVoteClassified(t);
  const int triesAfter = (int)t.tries;
  const int keepAfter = podVoteKeep(t) ? 1 : 0;
  std::printf("CLASSIFIED tries=%d keep=%d\n", triesAfter, keepAfter);
  // 3. tampon exigé par format
  std::printf("SCRATCH oled=%u eink27=%u eink29=%u tft18=%u tft28=%u\n", (unsigned)podScratchNeed(POD_OLED096), (unsigned)podScratchNeed(POD_EINK27BW), (unsigned)podScratchNeed(POD_EINK29BWR), (unsigned)podScratchNeed(POD_TFT18), (unsigned)podScratchNeed(POD_TFT28));
  // 4. pannes transitoires / définitives
  const int codes[] = {-5, -4, -2, 0, 200, 204, 301, 400, 403, 404, 409, 422, 429, 500, 503};
  std::printf("TRANSIENT");
  for (int c : codes) std::printf(" %d:%d", c, podHttpTransient(c) ? 1 : 0);
  std::printf("\nREADRETRY");
  for (int c : codes) std::printf(" %d:%d", c, podCandidateReadRetry(c) ? 1 : 0);
  std::printf("\n");
  return 0;
}
