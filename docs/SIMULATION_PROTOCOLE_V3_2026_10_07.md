# Simulation du protocole v3 (simulateur S1) — résultats

> **Généré** par `scripts/sim-pod-v3.ts` (graines fixes, reproductible) à partir de `lib/podSim.ts` et de l'implémentation de référence `lib/podProtocolV3.ts`. Ce sont des **résultats de simulation**, pas des mesures sur le réseau réel : ils valent sous les hypothèses ci-dessous. Aucun accès Redis, Neon ou réseau.

## Hypothèses
- Comité : K = min(7, n−1) profils éligibles non-auteurs, seuil ⌈2K/3⌉ (K=7 → 5 approbations, tolérance de 2 refus), vague 2 (repli) = jusqu'à 2K candidats. **1000 tirages par case.**
- Un profil **honnête** répond avec la probabilité 0,85 (un appareil peut être éteint) ; un profil **malhonnête** répond **toujours** et **à l'inverse de la vérité** (pire cas).
- **M1a « le serveur valide les approbations »** : un « accept » malhonnête sur un contenu qui viole une règle est invalidé (silence) ; un « refus » à tort d'un bon contenu **compte**.
- **M1b « le serveur valide aussi les refus »** : un refus dont le motif objectif (`uniform`, `noise`) est faux pour le contenu connu du serveur est invalide ; un refus `hash` avec un autre hash signé est un « dispute » qui ne bloque pas. Les malhonnêtes ne peuvent alors que **se taire**.
- **M2 « le comité seul décide »** : aucune vérification serveur (garantie du comité en soi, réseau futur décentralisé).
- **Règle « sièges » (référence)** : parmi les votants de la fenêtre, seuls les K premiers rangs comptent ; **« fenêtre » (ancienne règle)** : tous les votants de la fenêtre comptent, qui double en vague 2 sans changer la tolérance de refus.
- « Profil malhonnête » = un **profil éligible** (appairé, ancienneté respectée). Un faux appareil non appairé n'a **aucune voix** en v3.

## 1. Bon contenu : le réseau finalise-t-il ? (nuisance par refus à tort)

Chaque case : **accepté / refusé à tort / bloqué**.

| n | f | M1a, règle « fenêtre » | M1a, règle « sièges » | **M1b, « sièges »** |
|---|---|---|---|---|
| 10 | 10 % | 100 % / 0 % / 0 % | 100 % / 0 % / 0 % | 100 % / 0 % / 0 % |
| 10 | 20 % | 100 % / 0 % / 0 % | 100 % / 0 % / 0 % | 100 % / 0 % / 0 % |
| 10 | 30 % | 28 % / 72 % / 0 % | 56 % / 44 % / 0 % | 98 % / 0 % / 2 % |
| 10 | 40 % | 7 % / 93 % / 0 % | 16 % / 84 % / 0 % | 76 % / 0 % / 24 % |
| 100 | 10 % | 92 % / 8 % / 0 % | 97 % / 3 % / 0 % | 100 % / 0 % / 0 % |
| 100 | 20 % | 68 % / 32 % / 0 % | 84 % / 16 % / 0 % | 100 % / 0 % / 0 % |
| 100 | 30 % | 43 % / 57 % / 0 % | 63 % / 37 % / 0 % | 99 % / 0 % / 1 % |
| 100 | 40 % | 24 % / 76 % / 0 % | 40 % / 60 % / 0 % | 96 % / 0 % / 4 % |

**Lecture.** Sans validation serveur des refus (M1a), des profils malhonnêtes qui **refusent à tort** bloquent des dessins légitimes : avec n = 100 et 20 % de profils malhonnêtes, **32 %** des bons contenus sont refusés avec l'ancienne règle « fenêtre » (8 % à 10 %), contre **16 %** avec la règle « sièges » — qui est donc adoptée comme référence : doubler la fenêtre sans changer la tolérance de refus **augmentait** la nuisance. Avec la **validation serveur des refus (M1b)**, la nuisance tombe à **0 %** : il ne reste que les silences (colonne « bloqué »), que la vague 2 absorbe. **Recommandation : un refus ne compte que si le serveur le confirme par une règle objective** (spec § 4).

## 2. Mauvais contenu (uniforme ou bruit) : fausse acceptation

| n | f | M1a / M1b : accepté à tort | M2, « fenêtre » : accepté à tort | M2, « sièges » : accepté à tort |
|---|---|---|---|---|
| 10 | 10 % | 0.00 % | 0.00 % | 0.00 % |
| 10 | 20 % | 0.00 % | 0.00 % | 0.00 % |
| 10 | 30 % | 0.00 % | 0.00 % | 0.00 % |
| 10 | 40 % | 0.00 % | 0.00 % | 0.00 % |
| 100 | 10 % | 0.00 % | 0.00 % | 0.00 % |
| 100 | 20 % | 0.00 % | 0.60 % | 0.60 % |
| 100 | 30 % | 0.00 % | 2.10 % | 2.30 % |
| 100 | 40 % | 0.00 % | 8.20 % | 8.80 % |
| 500 | 10 % | 0.00 % | 0.00 % | 0.00 % |
| 500 | 20 % | 0.00 % | 0.70 % | 0.70 % |
| 500 | 30 % | 0.00 % | 2.40 % | 2.80 % |
| 500 | 40 % | 0.00 % | 9.40 % | 10.10 % |

**Lecture.** Tant que le serveur valide les approbations (M1a/M1b), un profil malhonnête **ne peut jamais** faire accepter un mauvais contenu. Si le **comité seul** devait décider (M2), la fausse acceptation est de 0.6 % (n = 100) et 0.7 % (n = 500) à 20 % de profils malhonnêtes (n ≥ 100), atteint 2.3 % à 30 % et 8.8 % à 40 %. La règle « sièges » ne l'aggrave pas.

## 3. Un attaquant peut-il CHOISIR son comité ? (grinding de l'auteur)

Le comité ne dépend que de `(parentHash, contentHash)` : **tout est connu de l'auteur avant de soumettre**. Il peut calculer hors ligne le comité de `g` variantes de son image (quelques pixels changés) et ne soumettre que la meilleure. Succès = au moins T complices parmi les K membres (donc, en M2, un mauvais contenu accepté). n = 50 profils éligibles, 100 essais d'attaque par case.

| complices f | g = 1 | g = 10 | g = 100 | g = 1000 |
|---|---|---|---|---|
| 10 % | 0 % | 0 % | 0 % | 0 % |
| 20 % | 0 % | 3 % | 28 % | 93 % |
| 30 % | 1 % | 21 % | 88 % | 100 % |

**Constat : le grinding est réel et peu coûteux.** À 20 % de profils complices, **28 %** de réussite avec 100 variantes et **93 %** avec 1 000 ; à 30 %, **88 %** dès 100 variantes. Une graine calculable avant la soumission **ne protège donc pas** contre un attaquant qui contrôle une fraction importante de profils éligibles. Parades (spec § 15) : **(1) une balise aléatoire publique postérieure à la soumission** (type drand) incluse dans la graine — recommandée ; **(2) un tirage séquentiel** où chaque membre suivant dépend des signatures des précédents ; **(3) limiter la fraction de profils éligibles contrôlables** (appairage vérifié, ancienneté, plafond par parrain). **Tant que (1) ou (2) n'existe pas, ne pas annoncer de tolérance aux profils malhonnêtes au-delà de la validation par le serveur (M1).**

## 4. Le quorum actuel (vote v2) face à de faux appareils non appairés — constat K4

| appareils appairés réels | faux appareils non appairés | quorum (⌈0,51×pool⌉) | les faux seuls finalisent ? | v3 : voix des faux |
|---|---|---|---|---|
| 4 | 0 | 3 | non | 0 (non éligibles) |
| 4 | 2 | 3 | non | 0 (non éligibles) |
| 4 | 3 | 3 | **oui** | 0 (non éligibles) |
| 4 | 10 | 3 | **oui** | 0 (non éligibles) |
| 10 | 5 | 6 | non | 0 (non éligibles) |
| 10 | 6 | 6 | **oui** | 0 (non éligibles) |

En v3, des appareils d'un même profil comptent pour **une** voix et un appareil non appairé **aucune** : l'attaque K4 disparaît ; reste le Sybil par **profils** (§ 3).

## 5. Seuils de référence

| K | seuil T = ⌈2K/3⌉ | refus tolérés (K−T) |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 2 | 0 |
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 4 | 1 |
| 6 | 4 | 2 |
| 7 | 5 | 2 |

## 6. Coût borné

| n (profils éligibles) | votes comptés (moyenne / max) | votes reçus dans la fenêtre (borne par construction) |
|---|---|---|
| 10 | 5.8 / 7 | ≤ 14 |
| 100 | 6.2 / 7 | ≤ 14 |
| 500 | 6.2 / 7 | ≤ 14 |

Avec la règle « sièges », les votes **comptés** ne dépassent jamais **K = 7** et les votes **reçus** jamais **2K = 14**, quel que soit n (jusqu'à 500 profils testés) : le coût Redis par candidat est borné (spec § 14).

