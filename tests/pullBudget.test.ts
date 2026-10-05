import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_WINDOW_MS, HOT_TTL_SEC, ONLINE_MS, PRESENCE_REFRESH_MS, PULL_DORMANT_SEC, PULL_HOT_SEC, RL_SAMPLED_BLACKLIST, RL_SAMPLED_MAX, RL_SAMPLE_RATE, idleRetrySec, presenceStale, rlSampled } from "../lib/pullBudget";
import { parseVotesRaw } from "../lib/chain";

test("présence : réécrite seulement quand elle a plus de 10 min ; « en ligne » = 30 min ; « actif » (quorum) = 45 min", () => {
  const now = 1_000_000_000_000;
  assert.equal(presenceStale({ lastSeen: now - 5 * 60_000, lastPing: now - 5 * 60_000 }, now), false, "vu il y a 5 min : pas d'écriture");
  assert.equal(presenceStale({ lastSeen: now - 11 * 60_000, lastPing: now - 11 * 60_000 }, now), true);
  assert.equal(presenceStale({}, now), true, "jamais vu : on écrit");
  assert.equal(presenceStale({ lastSeen: now - 20 * 60_000, lastPing: now - 2 * 60_000 }, now), false, "le plus récent des deux compte");
});

test("cohérence : même avec le pull dormant (15 min), un écran vivant n'est jamais « hors ligne » ni exclu du quorum entre deux écritures de présence", () => {
  const worstAge = PRESENCE_REFRESH_MS + PULL_DORMANT_SEC * 1000;
  assert.ok(worstAge < ONLINE_MS, `${worstAge} ms < ${ONLINE_MS} ms (en ligne)`);
  assert.ok(ONLINE_MS < ACTIVE_WINDOW_MS, "la fenêtre « actif » du quorum est plus large que « en ligne »");
});

test("actif / dormant : repos à 5 min si le réseau est chaud, 15 min sinon ; jamais plus rapide chaud que dormant", () => {
  assert.equal(PULL_HOT_SEC, 300);
  assert.equal(PULL_DORMANT_SEC, 900);
  assert.equal(idleRetrySec(true), 300);
  assert.equal(idleRetrySec(false), 900);
  assert.ok(idleRetrySec(false) >= idleRetrySec(true));
  assert.equal(HOT_TTL_SEC, 1800);
  // un candidat doit survivre à un écran dormant : TTL du candidat (30 min) > intervalle dormant (15 min) avec de la marge pour voter
  assert.ok(1800 > PULL_DORMANT_SEC * 1.5);
});

test("rate-limit échantillonné : 1 requête sur 8 touche Redis ; un écran normal ne déclenche jamais le 429", () => {
  assert.equal(RL_SAMPLE_RATE, 1 / 8);
  let hits = 0;
  for (let i = 0; i < 8000; i++) if (rlSampled((i + 0.5) / 8000)) hits++;
  assert.equal(hits, 1000, "exactement 1/8 sur un balayage régulier");
  assert.ok(RL_SAMPLED_MAX >= 3, "marge pour la variance de l'échantillonnage");
  assert.ok(240 * RL_SAMPLE_RATE > RL_SAMPLED_MAX, "240 pulls/min = emballement : coupé");
  assert.ok(RL_SAMPLED_BLACKLIST > RL_SAMPLED_MAX * 5, "la liste noire exige un emballement franc");
});

test("votes lus dans un MGET : même résultat que la lecture seule (chaîne JSON, objet déjà décodé, absent, corrompu)", () => {
  const vm = { candidateId: "c1", votes: { dev_AAAAAAAA: { deviceId: "dev_AAAAAAAA", score: 0.5 } } };
  assert.deepEqual(parseVotesRaw(JSON.stringify(vm)), vm);
  assert.deepEqual(parseVotesRaw(vm), vm);
  assert.equal(parseVotesRaw(null), null);
  assert.equal(parseVotesRaw("{pas du json"), null);
});
