# Compte rendu — lots 1 à 3 du plan « réseau de validateurs » (28/10/2026)

| | |
|---|---|
| **Base** | `origin/main` au commit `930dbc8` (plan canonique : `PLAN_RESEAU_VALIDATEURS_ET_STATION_R4_2026_10_28.md`) |
| **Statut** | **Commits locaux, rien de poussé, rien de flashé, aucune écriture Redis.** Niveaux : `C` compilé · `H` hôte · `S` relevé serveur en lecture seule. Aucun `M` ni `V2` pour ces corrections tant qu'elles ne sont pas flashées. |

## 1. Lot 3 — le refus « blank » (cause établie)

- **Preuve serveur (`S`)** : l'archive du candidat du 27/10 (« Les animations ne sont pas encore v2!!! », `tft18`, 40 960 o) donne une spécification v2 **e = 0, t = 0, r = 6987**, identique à ce que la R4 a calculé et signé. **Il n'y a pas de divergence TypeScript/C++.**
- **Mécanisme** : pour un écran couleur, la projection des métriques est binaire (pixel ≠ blanc pur 0xFFFF = encre). Un fond noir ou coloré avec des traits colorés, sans aucun pixel blanc, devient « tout encre » : e = t = 0. Les firmwares ESP décidaient déjà « blank » par l'uniformité **réelle** des pixels (`uniformTft`) ; les six `pod_vote_r4.h` utilisaient la projection seule, donc un faux refus. Le fond noir est un choix artistique valide.
- **Correctif** (`b88a8d4`) : les six en-têtes R4 renseignent `tft` / `uniformTft` et appliquent la règle de l'ESP : `blank` si (écran couleur ? tous les pixels identiques : e = t = 0). Les métriques e, t, r ne changent pas (aucune nouvelle version de métriques).
- **Test** (`tests/tftBlankVerdict.test.ts`, `consensus-pod/host/tft_blank_harness.cpp`) : dix contenus (blanc, noir, doré uni, noir + traits blancs, blanc + traits noirs, **noir + traits colorés**, bleu + rouge, un pixel, dense) ; `pod_metrics.h` réel contre `lib/podMetrics.ts` ; la règle identique dans les 11 en-têtes R4/ESP. Comparaison avant/après sur 5 fichiers de tests : mêmes 47 échecs (préexistants, environnement), aucun nouveau.
- **Limite** : on ne dispose pas du contenu exact du candidat (non archivé) ; le diagnostic dit « tous non blancs » pour la classe, pas « ce dessin précis ».

## 2. Lot 1 — voter sans perdre le candidat ni la mémoire

| Changement | Où | Preuve |
|---|---|---|
| Une frame n'efface plus le candidat en attente | station R4 (`doFetchFrame`) ; ESP BWR (2 sites), multiscreen e-ink 2,7″ + OLED (3 sites), e-ink 2,7″ seul (1 site) | `C` + test d'inventaire par fonction |
| Tampon de validation pris au tas **seulement** pour OLED (1 024 o) et e-ink 2,9″ (4 736 o) | station R4 (le tampon statique de 4 736 o est supprimé : RAM statique 21 828 → 17 108 o, tas libre de 10 940 → 15 660 o) ; ESP BWR (avant : 4 736 o systématiques) | `C` ; les autres ESP le faisaient déjà |
| Abstentions explicites et bornées, jamais un faux refus | station R4 : `memoire`, `pile-reseau`, `http`, `telechargement`, `signature`, `post`, `ecran-inconnu` | `H` (règles pures) + test statique des raisons |
| Candidat conservé sur panne **transitoire**, retiré sur issue classée ; 3 essais par candidat puis abandon journalisé | station R4 (`pod_vote_policy.h`) | `H` + 8 mutants tous détectés |

- **Firmwares compilés (sans téléversement)** : station R4 (cœur 1.6.0, flash 165 916 o, RAM statique 17 108 o) ; ESP BWR (`esp8266:esp8266:nodemcuv2`).
- **Sauvegardes** : `firmware-backups/2026-10-28_avant-lot1-candidat/`.
- **Non modifiés, même défaut constaté (à traiter dans un lot dédié, ces sketchs ont des tests d'identité de canari)** : `doFetchFrame` efface le candidat dans R4 e-ink 2,9″ (ligne 1344), e-ink 2,7″ (696), e-ink 2,7″ + OLED (758, 790), TFT 1,8″ de base (565) et TFT 2,8″ (894, 933). Conséquence limitée : le serveur ré-annonce le candidat au pull suivant (≈ 1 minute) ; le risque est un retard, sauf expiration entre deux pulls.
- **Limite connue ESP** : `doValidate` efface le candidat **avant** d'appeler le vote (BWR, multiscreen, e-ink 2,7″, TFT 1,8″) : pas de nouvel essai local sur panne transitoire, seule la ré-annonce du serveur rattrape.

## 3. Lot 2 — quorum et électorat

**Diagnostic en lecture seule** (`scripts/diag-electorate.ts`, jeton Redis **lecture seule** `KV_REST_API_READ_ONLY_TOKEN`, un SMEMBERS + un MGET + quelques GET/LRANGE, aucun secret affiché) — état du 27/10 à 11:57 UTC :

| Appareil (famille) | État | Raison |
|---|---|---|
| `r4tft18-2.3` (station) | **compté** | actif, appairé, capable |
| `multiscreen-2.8` | actif, exclu (seuil 1) | un manque : candidats d'animation impossibles à voter ; jamais de `lastVoteAt` |
| 6 autres (BWR ×3, R4 e-ink 2,9″, R4 TFT 2,8″, ESP TFT 1,8″) | inactifs | ping de 12 heures à 21 jours |

- **Chronologie** : « Zombimouche v2 » : réseau de 6, 4 votes requis, 77 min sans décision ; « Zombimouche v3 » : réseau de 1 ; « Les animations ne sont pas encore v2!!! » : réseau de 1 (la station). Chaque animation expirée sans vote donnait un manque à tous les appareils actifs ; avec un seuil de 1, l'électorat s'est vidé. Le « réseau de 1 » du 27/10 était donc un **vrai** validateur, pas le plancher.
- **Pourquoi le multiscreen n'a pas voté** : ses votes d'animation sont v1 et étaient refusés (403 « v1-vote-refused ») depuis le 14/10 ; corrigé en production le 28/10 par `ANIM_V1_VOTE` (transitoire).
- **Politique `QUORUM_MAX_MISSED`** : 1 → **3 manques consécutifs** (`lib/quorumResponsive.ts`) ; réhabilitation immédiate au premier vote réussi (inchangé : `noteVote`) ; un appareil exclu reste invité. Avec 3, le même relevé compterait 2 appareils (la station et le multiscreen).
- **Électorat figé dans le candidat** : `lib/electorate.ts` (pur) ; `Candidate.pool` = `{ total, counted, floor, excluded par raison, maxMissed, at }` (< 200 o, sans identifiant ni secret) ; `floor` dit si le « 1 » est le plancher. Le motif de « Rejetés » ajoute « électorat au dépôt : … ». Source unique pour le quorum, le résumé et le diagnostic.
- **Coût Redis** : **0 commande de plus** (même SMEMBERS + MGET ; le résumé est calculé sur les fiches déjà lues) ; le candidat grossit d'environ 110 octets ; aucun SCAN, aucune écriture.

## 4. Tests et commits

- Nouveaux : `tftBlankVerdict`, `voteCandidatePolicy` (dont mutants), `electorate` ; adaptés : `quorumHealth`, `eligibility`, `tft18EnvR4`.
- Échecs préexistants (environnement, déjà présents sur `main`) : voir le bilan de la suite complète dans la réponse de livraison ; aucun nouvel échec attribuable à ces lots.

## 5. Risques ouverts

1. Rien n'est observé sur carte : le prochain essai (un seul flash de la station) doit prouver le vote d'**acceptation** d'un fond noir à traits colorés.
2. Les sketchs R4 e-ink et TFT 2,8″ gardent l'ancien effacement du candidat et l'ancienne règle `blank` tant qu'ils ne sont pas reflashés (la règle `blank` est dans leurs en-têtes, corrigée dans le dépôt).
3. `ELIGIBILITY_MODE=enforce` reste interdit ; les capteurs seuls restent exclus du quorum (capacité de validation explicite : lot suivant).
4. Le seuil à 3 manques ralentit l'exclusion d'un appareil réellement muet : le diagnostic `scripts/diag-electorate.ts` doit être relu après chaque série d'essais.

## 6. Addendum — suite autonome du 28/10 (lots 4, 5, outil d'essai) — commits locaux, rien de poussé ni de flashé

- **Lot 4 — matrice validateur × format** (`9516ce7`) : `docs/MATRICE_VALIDATEUR_X_FORMAT_2026_10_28.md`, tableau **généré depuis le code des sketchs** (`tests/helpers/voteFormatMatrix.ts`) et comparé au document par `tests/voteFormatMatrix.test.ts`. Résultat `C` + `H` : les dix familles (six R4, quatre ESP) relisent les cinq formats ; aucune cellule « NON ». Ce n'est pas un vote croisé observé (`V2`).
- **Lot 5 — capacités de vote déclarées** (`20f8a75`) : `caps` (liste fermée `vote-static-v2`, `vote-anim-v3`) lue par `/api/register`, persistée, jamais suffisante seule ; `VALIDATOR_NODE_FIRMWARE` et `VOTE_ANIM_V3_FIRMWARE` **vides** : aucun appareil existant ne change (testé : `r4dht22-1.3` reste non votant, un capteur seul reste exclu). Quand une famille de validateur sans écran sera ajoutée à la table, elle sera comptée dans le quorum, admise au vote v2 et indexée sans jamais entrer dans une pool d'écran.
- **Outil d'essai** (`e75e002`, `2e25b01`) : `scripts/trial-report.ts` (jeton Redis LECTURE SEULE) produit, par candidat, l'électorat figé, les votants, le format local de chacun, les **votes croisés v2**, la comparaison des métriques à la référence du serveur et l'issue exacte ; il dit honnêtement quand le détail d'un vote n'a pas été conservé (candidat archivé). Le résumé d'électorat compte aussi les validateurs capables de voter une animation v3 (0 aujourd'hui) : c'est la couverture à atteindre avant de passer le mode d'animation de `shadow` à `enforce`.
- **Images de l'essai matériel** : `r4tft18-2.4` construite (165 924 o) et image de **retour arrière** reconstruite à l'identique du firmware actuellement sur la carte (165 172 o) ; protocole : `PROTOCOLE_ESSAI_STATION_R4_2026_10_28.md`.
- **Refus d'une image réellement uniforme à la soumission** (`3f8f40c`) : `rawIsUniform` (écran couleur : tous les pixels identiques ; autres : e = t = 0) ; un fond noir avec des traits colorés n'est pas uniforme. Évite 30 minutes d'attente avant une expiration certaine. Ne concerne pas les animations.
- **Décision** : les sketchs R4 e-ink et TFT 2,8″, validés sur matériel et protégés par des tests d'identité, ne sont PAS modifiés ce soir (le défaut ne coûte qu'un cycle de pull) ; lot dédié en backlog.
- **Animation v3 (lot 6) — OMBRE sur la station** : `POD_ANIM_V3_SHADOW` (0 par défaut ; image à 0 identique octet pour octet à `r4tft18-2.4`) relit le clip reçu depuis la SD dans l'automate `podAnimV3.h` (copie identique de l'original, objet de ~2 Ko au tas, pile de travail dédiée) et JOURNALISE ce qu'un vote v3 signerait (règle, images, E/T/R/S, `clipHash`, `animRoot`, durée, pile, tas) ; **aucun réseau, aucune signature, aucun vote** (testé). Sert à mesurer sur la carte et à comparer au calcul du serveur (journal `[anim-v3]`). Compilé : +3 328 o de flash, RAM statique inchangée. **Jamais exécuté sur la carte.**
- **(avant) Animation v3 (lot 6)** : non intégrée au firmware. Le noyau de calcul (TypeScript et C++ en flux, vecteurs, route `candidate-clip`, mode `shadow`) existe depuis le 07/10 ; manque l'appel depuis un sketch (relecture du clip sur la SD ou en flux, signature `pod-vote-v3-anim`), à faire sur la station d'abord puis à mesurer. `ANIM_V1_VOTE` reste le secours étiqueté.
