// LOT8B2C-ESP8266-EINK29-CANARY-FIX2 : la SEULE modification de production du lot FIX2 (doPull, ESP8266 e-ink 2,9″).
// Les tests « chemin désactivé == firmware d'avant » annulent exactement ce fragment avant de comparer (ils prouvent donc que rien d'autre n'a bougé).
export const FIX2_NEW = `  // Frame déjà affichée (même frameId) sans candidat : rien à faire → retryAfter, comme « aucune frame »
  // (sinon une frame personnelle acquittée, qui reste dans /api/pull, imposait un pull toutes les 60 s).
  bool sameFrameIdle = newFrameId.length() > 0 && newFrameId == lastFrameId;
  if ((newFrameSource == "none" || sameFrameIdle) && newCandId.length() == 0) {
`;
export const FIX2_OLD = `  if (newFrameSource == "none" && newCandId.length() == 0) {
`;
export function undoFix2(src: string): string {
  if (!src.includes(FIX2_NEW)) return src;
  return src.replace(FIX2_NEW, FIX2_OLD);
}
