// lib/pullBudget.ts — règles PURES qui font tenir un pull d'écran en ≈ 1,5 commande Redis au repos (quota Upstash).
//
// Un pull au repos coûtait 5 commandes : rate-limit (EVAL) + appareil (GET) + tout le reste (MGET) + présence (SET, toutes les 4 min donc à chaque pull de 300 s)
// + tâche d'observation (RPOP à chaque pull au repos). Maintenant :
//   • UN seul MGET lit l'appareil, ses frames, la tête de chaîne, le candidat, les votes, la notification, le mode banc d'essai et le drapeau d'observation ;
//   • le rate-limit est ÉCHANTILLONNÉ (1 pull sur 8 touche Redis) : un écran normal (≤ 1 pull/min) ne l'atteint jamais, un emballement est coupé en quelques secondes ;
//   • la présence (lastSeen/lastPing) n'est réécrite que toutes les 12 min, et « en ligne » vaut 20 min (même fenêtre que networkSnapshot) ;
//   • la tâche d'observation n'est dépilée que si le drapeau `chain:obs:pending` dit qu'il y en a une.

/** Un appareil est « en ligne » s'il a été vu depuis moins de ça. Doit rester > PRESENCE_REFRESH_MS + plus long intervalle de pull au repos. */
export const ONLINE_MS = 20 * 60 * 1000;
/** On ne réécrit lastSeen/lastPing que s'ils ont plus de ça (un SET du JSON de l'appareil). */
export const PRESENCE_REFRESH_MS = 12 * 60 * 1000;

/** Fraction des pulls qui comptent pour le rate-limit. */
export const RL_SAMPLE_RATE = 1 / 8;
/** Au-delà de ce nombre de pulls ÉCHANTILLONNÉS dans la fenêtre (≈ 8 × ça pulls réels) : 429. */
export const RL_SAMPLED_MAX = 4;
/** Au-delà : liste noire automatique (≈ 8 × ça pulls réels dans la fenêtre = un emballement). */
export const RL_SAMPLED_BLACKLIST = 40;

export const rlSampled = (rand: number, rate: number = RL_SAMPLE_RATE): boolean => rand < rate;

export function presenceStale(d: { lastSeen?: number; lastPing?: number }, now: number): boolean {
  return Math.max(d.lastSeen ?? 0, d.lastPing ?? 0) <= now - PRESENCE_REFRESH_MS;
}

