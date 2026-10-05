import test from "node:test";
import assert from "node:assert/strict";
import { ONLINE_MS, PRESENCE_REFRESH_MS, RL_SAMPLED_BLACKLIST, RL_SAMPLED_MAX, RL_SAMPLE_RATE, presenceStale, rlSampled } from "../lib/pullBudget";

test("présence : réécrite seulement quand elle a plus de 12 min ; « en ligne » = 20 min", () => {
  const now = 1_000_000_000_000;
  assert.equal(presenceStale({ lastSeen: now - 5 * 60_000, lastPing: now - 5 * 60_000 }, now), false, "vu il y a 5 min : pas d'écriture");
  assert.equal(presenceStale({ lastSeen: now - 13 * 60_000, lastPing: now - 13 * 60_000 }, now), true);
  assert.equal(presenceStale({}, now), true, "jamais vu : on écrit");
  assert.equal(presenceStale({ lastSeen: now - 20 * 60_000, lastPing: now - 2 * 60_000 }, now), false, "le plus récent des deux compte");
});

test("cohérence : avec un pull au repos de 5 min, un écran vivant n'est jamais « hors ligne » entre deux écritures de présence", () => {
  const worstAgeAtRead = PRESENCE_REFRESH_MS + 5 * 60_000;   // écrit à t, prochain pull qui réécrit au plus tard 12 min + un intervalle de pull plus tard
  assert.ok(worstAgeAtRead < ONLINE_MS, `${worstAgeAtRead} ms < ${ONLINE_MS} ms`);
  assert.ok(ONLINE_MS < 30 * 60_000, "reste sous la fenêtre « actif » du quorum (30 min)");
});

test("rate-limit échantillonné : 1 pull sur 8 touche Redis ; un écran normal ne déclenche jamais le 429", () => {
  assert.equal(RL_SAMPLE_RATE, 1 / 8);
  let hits = 0;
  for (let i = 0; i < 8000; i++) if (rlSampled((i + 0.5) / 8000)) hits++;
  assert.equal(hits, 1000, "exactement 1/8 sur un balayage régulier");
  // un écran sain : 1 pull/min → au plus ~1 pull échantillonné par fenêtre de 60 s, très loin de RL_SAMPLED_MAX
  assert.ok(RL_SAMPLED_MAX >= 3, "marge pour la variance de l'échantillonnage");
  // un emballement : 240 pulls/min → ≈ 30 échantillonnés dans la fenêtre > RL_SAMPLED_MAX (429 en quelques secondes), blacklist vers ≥ 320 pulls/min
  assert.ok(240 * RL_SAMPLE_RATE > RL_SAMPLED_MAX);
  assert.ok(RL_SAMPLED_BLACKLIST > RL_SAMPLED_MAX * 5, "la liste noire exige un emballement franc");
});
