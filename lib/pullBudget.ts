// lib/pullBudget.ts — règles PURES qui font tenir les échanges écran ↔ serveur dans le quota Redis (Upstash).
//
// Un pull au repos coûtait 5 commandes : rate-limit (EVAL) + appareil (GET) + tout le reste (MGET) + présence (SET) + dépilage d'observation (RPOP). Maintenant :
//   • UN seul MGET lit l'appareil, ses frames, la tête de chaîne, le candidat, les votes, la notification, le mode banc d'essai, le drapeau d'observation et le drapeau « réseau chaud » ;
//   • le rate-limit est ÉCHANTILLONNÉ (1 requête sur 8 touche Redis) : un écran normal ne l'atteint jamais, un emballement est coupé en quelques secondes ;
//   • la présence (lastSeen/lastPing) n'est réécrite que toutes les 10 min ;
//   • la tâche d'observation n'est dépilée que si le drapeau `chain:obs:pending` dit qu'il y en a une ;
//   • MODE ACTIF / DORMANT : au repos, un écran tire toutes les 5 min si le réseau est « chaud » (quelqu'un a dessiné / envoyé / ouvert l'atelier depuis moins de 30 min),
//     toutes les 15 min sinon. Le candidat vit 30 min (CANDIDATE_TTL_SEC) pour qu'un écran dormant le voie à temps.

/** « En ligne » : vu depuis moins de ça. Doit rester > PRESENCE_REFRESH_MS + plus long intervalle de pull au repos (15 min). */
export const ONLINE_MS = 30 * 60 * 1000;
/** Fenêtre « actif » du quorum de validation (getGlobalActiveCount, validate-candidate). Doit rester > ONLINE_MS. */
export const ACTIVE_WINDOW_MS = 45 * 60 * 1000;
/** On ne réécrit lastSeen/lastPing que s'ils ont plus de ça (un SET du JSON de l'appareil). */
export const PRESENCE_REFRESH_MS = 10 * 60 * 1000;

/** Fraction des requêtes qui comptent pour le rate-limit. */
export const RL_SAMPLE_RATE = 1 / 8;
/** Au-delà de ce nombre de pulls ÉCHANTILLONNÉS dans la fenêtre (≈ 8 × ça pulls réels) : 429. */
export const RL_SAMPLED_MAX = 4;
/** Au-delà : liste noire automatique (≈ 8 × ça pulls réels dans la fenêtre = un emballement). */
export const RL_SAMPLED_BLACKLIST = 40;

export const rlSampled = (rand: number, rate: number = RL_SAMPLE_RATE): boolean => rand < rate;

export function presenceStale(d: { lastSeen?: number; lastPing?: number }, now: number): boolean {
  return Math.max(d.lastSeen ?? 0, d.lastPing ?? 0) <= now - PRESENCE_REFRESH_MS;
}

// ─── Mode actif / dormant ─────────────────────────────────────────────────────
export const HOT_KEY = "net:hot";
/** Le réseau reste « chaud » 30 min après la dernière activité (dessin, envoi, ouverture de l'atelier). */
export const HOT_TTL_SEC = 30 * 60;
/** Intervalle de repos (secondes) quand le réseau est chaud / dormant. Réglables : PULL_HOT_SEC, PULL_DORMANT_SEC (mettre la même valeur = pas de mode dormant). */
export const PULL_HOT_SEC = parseInt(process.env.PULL_HOT_SEC ?? "300");
export const PULL_DORMANT_SEC = parseInt(process.env.PULL_DORMANT_SEC ?? "900");
export const idleRetrySec = (hot: boolean): number => (hot ? PULL_HOT_SEC : Math.max(PULL_HOT_SEC, PULL_DORMANT_SEC));
