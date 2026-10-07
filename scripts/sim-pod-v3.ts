// scripts/sim-pod-v3.ts — exécute le simulateur S1 (lib/podSim.ts) et produit docs/SIMULATION_PROTOCOLE_V3_2026_10_07.md.
// Usage : node --import tsx scripts/sim-pod-v3.ts          → affiche le rapport
//         node --import tsx scripts/sim-pod-v3.ts --write  → écrit le fichier docs/…
// Déterministe (graines fixes) : deux exécutions donnent le même rapport. Aucun accès réseau, Redis ou Neon. Les chiffres cités dans le texte sont CALCULÉS ici (jamais saisis à la main).
import fs from "node:fs";
import path from "node:path";
import { grindingSuccess, summarize, v2QuorumAttack, type DecisionRule, type SimParams, type ThreatModel } from "../lib/podSim";
import { threshold } from "../lib/podProtocolV3";

const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)} %`;
const TRIALS = 1000;
const lines: string[] = [];
const out = (s = "") => lines.push(s);
const run = (n: number, f: number, model: ThreatModel, rule: DecisionRule, content: "good" | "bad", seed: number) =>
  summarize({ n, f, pOnline: 0.85, model, rule, content } satisfies SimParams, TRIALS, seed + n + Math.round(f * 100));

out("# Simulation du protocole v3 (simulateur S1) — résultats");
out();
out("> **Généré** par `scripts/sim-pod-v3.ts` (graines fixes, reproductible) à partir de `lib/podSim.ts` et de l'implémentation de référence `lib/podProtocolV3.ts`. Ce sont des **résultats de simulation**, pas des mesures sur le réseau réel : ils valent sous les hypothèses ci-dessous. Aucun accès Redis, Neon ou réseau.");
out();
out("## Hypothèses");
out(`- Comité : K = min(7, n−1) profils éligibles non-auteurs, seuil ⌈2K/3⌉ (K=7 → 5 approbations, tolérance de 2 refus), vague 2 (repli) = jusqu'à 2K candidats. **${TRIALS} tirages par case.**`);
out("- Un profil **honnête** répond avec la probabilité 0,85 (un appareil peut être éteint) ; un profil **malhonnête** répond **toujours** et **à l'inverse de la vérité** (pire cas).");
out("- **M1a « le serveur valide les approbations »** : un « accept » malhonnête sur un contenu qui viole une règle est invalidé (silence) ; un « refus » à tort d'un bon contenu **compte**.");
out("- **M1b « le serveur valide aussi les refus »** : un refus dont le motif objectif (`uniform`, `noise`) est faux pour le contenu connu du serveur est invalide ; un refus `hash` avec un autre hash signé est un « dispute » qui ne bloque pas. Les malhonnêtes ne peuvent alors que **se taire**.");
out("- **M2 « le comité seul décide »** : aucune vérification serveur (garantie du comité en soi, réseau futur décentralisé).");
out("- **Règle « sièges » (référence)** : parmi les votants de la fenêtre, seuls les K premiers rangs comptent ; **« fenêtre » (ancienne règle)** : tous les votants de la fenêtre comptent, qui double en vague 2 sans changer la tolérance de refus.");
out("- « Profil malhonnête » = un **profil éligible** (appairé, ancienneté respectée). Un faux appareil non appairé n'a **aucune voix** en v3.");
out();

// ── 1. bons contenus : liveness et nuisance par refus ─────────────────────────────────────────────────────────────────────────────────────────
out("## 1. Bon contenu : le réseau finalise-t-il ? (nuisance par refus à tort)");
out();
out("Chaque case : **accepté / refusé à tort / bloqué**.");
out();
out("| n | f | M1a, règle « fenêtre » | M1a, règle « sièges » | **M1b, « sièges »** |");
out("|---|---|---|---|---|");
const grief: Record<string, { win: number; seats: number; m1b: number }> = {};
for (const n of [10, 100]) for (const f of [0.1, 0.2, 0.3, 0.4]) {
  const a = run(n, f, "M1", "window", "good", 1000), b = run(n, f, "M1", "seats", "good", 1000), c = run(n, f, "M1b", "seats", "good", 1000);
  const cell = (s: typeof a) => `${pct(s.accept, 0)} / ${pct(s.reject, 0)} / ${pct(s.stall, 0)}`;
  out(`| ${n} | ${pct(f, 0)} | ${cell(a)} | ${cell(b)} | ${cell(c)} |`);
  grief[`${n}-${f}`] = { win: a.reject, seats: b.reject, m1b: c.reject };
}
out();
const g = grief["100-0.2"], g1 = grief["100-0.1"];
out(`**Lecture.** Sans validation serveur des refus (M1a), des profils malhonnêtes qui **refusent à tort** bloquent des dessins légitimes : avec n = 100 et 20 % de profils malhonnêtes, **${pct(g.win, 0)}** des bons contenus sont refusés avec l'ancienne règle « fenêtre » (${pct(g1.win, 0)} à 10 %), contre **${pct(g.seats, 0)}** avec la règle « sièges » — qui est donc adoptée comme référence : doubler la fenêtre sans changer la tolérance de refus **augmentait** la nuisance. Avec la **validation serveur des refus (M1b)**, la nuisance tombe à **${pct(g.m1b, 0)}** : il ne reste que les silences (colonne « bloqué »), que la vague 2 absorbe. **Recommandation : un refus ne compte que si le serveur le confirme par une règle objective** (spec § 4).`);
out();

// ── 2. mauvais contenus : fausse acceptation ──────────────────────────────────────────────────────────────────────────────────────────────────
out("## 2. Mauvais contenu (uniforme ou bruit) : fausse acceptation");
out();
out("| n | f | M1a / M1b : accepté à tort | M2, « fenêtre » : accepté à tort | M2, « sièges » : accepté à tort |");
out("|---|---|---|---|---|");
const fa: Record<string, number> = {};
for (const n of [10, 100, 500]) for (const f of [0.1, 0.2, 0.3, 0.4]) {
  const m1 = run(n, f, "M1", "seats", "bad", 2000), w = run(n, f, "M2", "window", "bad", 3000), s = run(n, f, "M2", "seats", "bad", 3000);
  out(`| ${n} | ${pct(f, 0)} | ${pct(m1.accept, 2)} | ${pct(w.accept, 2)} | ${pct(s.accept, 2)} |`);
  fa[`${n}-${f}`] = s.accept;
}
out();
out(`**Lecture.** Tant que le serveur valide les approbations (M1a/M1b), un profil malhonnête **ne peut jamais** faire accepter un mauvais contenu. Si le **comité seul** devait décider (M2), la fausse acceptation est de ${pct(fa["100-0.2"], 1)} (n = 100) et ${pct(fa["500-0.2"], 1)} (n = 500) à 20 % de profils malhonnêtes (n ≥ 100), atteint ${pct(fa["100-0.3"], 1)} à 30 % et ${pct(fa["100-0.4"], 1)} à 40 %. La règle « sièges » ne l'aggrave pas.`);
out();

// ── 3. grinding ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
out("## 3. Un attaquant peut-il CHOISIR son comité ? (grinding de l'auteur)");
out();
out("Le comité ne dépend que de `(parentHash, contentHash)` : **tout est connu de l'auteur avant de soumettre**. Il peut calculer hors ligne le comité de `g` variantes de son image (quelques pixels changés) et ne soumettre que la meilleure. Succès = au moins T complices parmi les K membres (donc, en M2, un mauvais contenu accepté). n = 50 profils éligibles, 100 essais d'attaque par case.");
out();
out("| complices f | g = 1 | g = 10 | g = 100 | g = 1000 |");
out("|---|---|---|---|---|");
const grind: Record<string, number> = {};
for (const f of [0.1, 0.2, 0.3]) {
  const row = [1, 10, 100, 1000].map((tries) => { const p = grindingSuccess({ n: 50, f, tries, trials: 100, seed: 4000 + tries + Math.round(f * 100) }); grind[`${f}-${tries}`] = p; return pct(p, 0); });
  out(`| ${pct(f, 0)} | ${row.join(" | ")} |`);
}
out();
out(`**Constat : le grinding est réel et peu coûteux.** À 20 % de profils complices, **${pct(grind["0.2-100"], 0)}** de réussite avec 100 variantes et **${pct(grind["0.2-1000"], 0)}** avec 1 000 ; à 30 %, **${pct(grind["0.3-100"], 0)}** dès 100 variantes. Une graine calculable avant la soumission **ne protège donc pas** contre un attaquant qui contrôle une fraction importante de profils éligibles. Parades (spec § 15) : **(1) une balise aléatoire publique postérieure à la soumission** (type drand) incluse dans la graine — recommandée ; **(2) un tirage séquentiel** où chaque membre suivant dépend des signatures des précédents ; **(3) limiter la fraction de profils éligibles contrôlables** (appairage vérifié, ancienneté, plafond par parrain). **Tant que (1) ou (2) n'existe pas, ne pas annoncer de tolérance aux profils malhonnêtes au-delà de la validation par le serveur (M1).**`);
out();

// ── 4. quorum actuel ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
out("## 4. Le quorum actuel (vote v2) face à de faux appareils non appairés — constat K4");
out();
out("| appareils appairés réels | faux appareils non appairés | quorum (⌈0,51×pool⌉) | les faux seuls finalisent ? | v3 : voix des faux |");
out("|---|---|---|---|---|");
for (const [h, fk] of [[4, 0], [4, 2], [4, 3], [4, 10], [10, 5], [10, 6]] as const) {
  const r = v2QuorumAttack(h, fk);
  out(`| ${h} | ${fk} | ${r.quorum} | ${r.fakesAloneFinalize ? "**oui**" : "non"} | 0 (non éligibles) |`);
}
out();
out("En v3, des appareils d'un même profil comptent pour **une** voix et un appareil non appairé **aucune** : l'attaque K4 disparaît ; reste le Sybil par **profils** (§ 3).");
out();

// ── 5. seuils et coût ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
out("## 5. Seuils de référence");
out();
out("| K | seuil T = ⌈2K/3⌉ | refus tolérés (K−T) |");
out("|---|---|---|");
for (const K of [1, 2, 3, 4, 5, 6, 7]) out(`| ${K} | ${threshold(K)} | ${K - threshold(K)} |`);
out();
const cost = [10, 100, 500].map((n) => ({ n, s: run(n, 0.2, "M1b", "seats", "good", 5000) }));
out("## 6. Coût borné");
out();
out("| n (profils éligibles) | votes comptés (moyenne / max) | votes reçus dans la fenêtre (borne par construction) |");
out("|---|---|---|");
for (const { n, s } of cost) out(`| ${n} | ${s.meanVotes.toFixed(1)} / ${s.maxVotes} | ≤ ${Math.min(14, 2 * Math.min(7, n - 1))} |`);
out();
out("Avec la règle « sièges », les votes **comptés** ne dépassent jamais **K = 7** et les votes **reçus** jamais **2K = 14**, quel que soit n (jusqu'à 500 profils testés) : le coût Redis par candidat est borné (spec § 14).");
out();

const report = lines.join("\n") + "\n";
if (process.argv.includes("--write")) {
  const file = path.join(__dirname, "..", "docs", "SIMULATION_PROTOCOLE_V3_2026_10_07.md");
  fs.writeFileSync(file, report);
  console.log("écrit", file);
} else process.stdout.write(report);
