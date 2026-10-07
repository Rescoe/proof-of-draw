import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { grindingSuccess, mulberry32, runTrial, shuffle, summarize, v2QuorumAttack } from "../lib/podSim";

// Simulateur S1 du protocole v3 : déterministe, sans réseau ni Redis. Les chiffres détaillés sont dans docs/SIMULATION_PROTOCOLE_V3_2026_10_07.md (scripts/sim-pod-v3.ts --write).
const root = path.join(__dirname, "..");

test("déterminisme : même paramètres, même graine ⇒ mêmes chiffres ; PRNG et mélange reproductibles", () => {
  const p = { n: 30, f: 0.2, pOnline: 0.85, model: "M1" as const, content: "good" as const };
  assert.deepEqual(summarize(p, 200, 42), summarize(p, 200, 42));
  assert.notDeepEqual(summarize(p, 200, 42), summarize(p, 200, 43));
  const a = mulberry32(7), b = mulberry32(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.deepEqual(shuffle([1, 2, 3, 4, 5, 6], mulberry32(9)), shuffle([1, 2, 3, 4, 5, 6], mulberry32(9)));
  assert.deepEqual([...shuffle([1, 2, 3, 4, 5, 6], mulberry32(9))].sort(), [1, 2, 3, 4, 5, 6]);
});

test("réseau honnête et en ligne : toujours accepté ; mauvais contenu toujours refusé ; aucun blocage", () => {
  const good = summarize({ n: 40, f: 0, pOnline: 1, model: "M1", content: "good" }, 300, 1);
  assert.equal(good.accept, 1); assert.equal(good.wave2, 0);
  const bad = summarize({ n: 40, f: 0, pOnline: 1, model: "M2", content: "bad" }, 300, 2);
  assert.equal(bad.reject, 1); assert.equal(bad.accept, 0);
});

test("M1 : un profil malhonnête ne fait JAMAIS accepter un mauvais contenu (le serveur invalide l'approbation) ; M1b : il ne peut plus faire refuser un bon contenu", () => {
  for (const f of [0.2, 0.4]) {
    assert.equal(summarize({ n: 60, f, pOnline: 0.85, model: "M1", content: "bad" }, 400, 3).accept, 0, `M1 f=${f}`);
    assert.equal(summarize({ n: 60, f, pOnline: 0.85, model: "M1b", content: "bad" }, 400, 3).accept, 0, `M1b f=${f}`);
    assert.equal(summarize({ n: 60, f: 0.2, pOnline: 0.85, model: "M1b", content: "good" }, 400, 4).reject, 0, "M1b : aucun refus à tort");
  }
  assert.ok(summarize({ n: 60, f: 0.3, pOnline: 0.85, model: "M1", content: "good" }, 400, 5).reject > 0.1, "M1a : sans validation des refus la nuisance existe");
});

test("règle « sièges » : nuisance par refus à tort INFÉRIEURE à l'ancienne règle « fenêtre » ; fausse acceptation non aggravée", () => {
  const base = { n: 100, f: 0.2, pOnline: 0.85, model: "M1" as const, content: "good" as const };
  const win = summarize({ ...base, rule: "window" }, 1500, 11), seats = summarize({ ...base, rule: "seats" }, 1500, 11);
  assert.ok(seats.reject < win.reject - 0.05, `sièges ${seats.reject} vs fenêtre ${win.reject}`);
  const badBase = { n: 100, f: 0.3, pOnline: 0.85, model: "M2" as const, content: "bad" as const };
  const w2 = summarize({ ...badBase, rule: "window" }, 3000, 12), s2 = summarize({ ...badBase, rule: "seats" }, 3000, 12);
  assert.ok(s2.accept <= w2.accept + 0.01, `sièges ${s2.accept} vs fenêtre ${w2.accept}`);
});

test("coût borné : les votes COMPTÉS ne dépassent jamais K = 7, quelle que soit la taille du réseau", () => {
  for (const n of [4, 10, 100, 300]) {
    const s = summarize({ n, f: 0.2, pOnline: 0.85, model: "M2", content: "good" }, 300, 20 + n);
    assert.ok(s.maxVotes <= 7, `n=${n} max=${s.maxVotes}`);
  }
  const rng = mulberry32(3);
  for (let i = 0; i < 200; i++) assert.ok(runTrial({ n: 200, f: 0.3, pOnline: 0.6, model: "M2", content: "good" }, rng).votesCounted <= 7);
});

test("accord avec le calcul exact : M2, 20 % de malhonnêtes toujours présents et honnêtes toujours en ligne ⇒ fausse acceptation ≈ P(≥ 5 malhonnêtes parmi 7) = 0,47 %", () => {
  const s = summarize({ n: 500, f: 0.2, pOnline: 1, model: "M2", content: "bad" }, 4000, 99);
  assert.ok(s.accept > 0.001 && s.accept < 0.011, `observé ${s.accept}`);
});

test("grinding : la réussite croît avec le nombre d'essais et avec la fraction de complices ; 10 % de complices : jamais avec un seul essai", () => {
  const g = (f: number, tries: number) => grindingSuccess({ n: 40, f, tries, trials: 60, seed: 5 });
  assert.equal(g(0.1, 1), 0);
  assert.ok(g(0.3, 200) >= g(0.3, 10), "monotone en essais");
  assert.ok(g(0.3, 200) > g(0.1, 200), "monotone en complices");
  assert.ok(g(0.3, 200) > 0.5, "30 % de complices et 200 variantes : l'attaque réussit le plus souvent");
});

test("quorum actuel (vote v2) : trois faux appareils non appairés finalisent face à 4 vrais (K4) ; la v3 ne leur donne aucune voix", () => {
  assert.deepEqual(v2QuorumAttack(4, 3), { quorum: 3, fakesAloneFinalize: true, honestAloneFinalize: true });
  assert.equal(v2QuorumAttack(4, 2).fakesAloneFinalize, false);
  assert.equal(v2QuorumAttack(10, 6).fakesAloneFinalize, true);
});

test("le simulateur n'est branché sur aucune route, aucun firmware, et n'utilise ni Math.random ni Date.now", () => {
  const src = fs.readFileSync(path.join(root, "lib", "podSim.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /Math\.random|Date\.now|new Date|fetch\(|redis/i);
  const offenders: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next", ".git", "firmware-backups", ".claude"].includes(e.name)) walk(rel); }
    else if (/\.(tsx?|ino|h)$/.test(e.name) && fs.readFileSync(path.join(root, rel), "utf8").includes("podSim")) offenders.push(rel.replace(/\\/g, "/"));
  } };
  for (const d of ["app", "esp8266", "arduino_uno_r4"]) walk(d);
  assert.deepEqual(offenders, []);
});
