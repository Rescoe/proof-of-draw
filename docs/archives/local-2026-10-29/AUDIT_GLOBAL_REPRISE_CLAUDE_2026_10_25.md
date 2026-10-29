# Audit global de reprise — matériel, vote et OTA

**Date :** 25 octobre 2026
**Destinataire :** Claude, réalisateur du chantier
**Auteur :** audit indépendant Codex, lecture seule
**Périmètre :** dépôt local, `origin/main`, branches et worktrees présents, sources, procédures et journaux archivés. Aucune carte, aucun port série, aucune variable Vercel/Upstash, aucun déploiement ni aucune clé privée n'ont été ouverts ou modifiés.

---

## 1. Verdict court : ce qui est réellement acquis

Le projet a franchi une étape importante : le chemin complet PoD est réellement démontré sur plusieurs profils matériels :

```text
web → candidat → vote V2 ESP → bloc miné → frame → affichage → ACK
```

et l'OTA Internet **signée** a été démontrée sur des canaris ESP8266 précis. Ce n'est plus un prototype théorique.

Mais il ne faut pas dire « OTA opérationnelle sur tout ESP et sur R4 » sans qualification. La situation exacte à la date de l'audit est :

| Affirmation | Verdict de l'audit |
|---|---|
| ESP8266 TFT 1,8″ : une OTA Internet sûre existe | **Oui, prouvée sur un canari précis** (`tft18-2.7 → 2.8`), avec vote et affichage après. La marge RAM est très faible. |
| ESP8266 e-ink BWR 2,9″ : une OTA Internet sûre existe | **Oui, prouvée sur un canari précis** (`eink29bwr-2.4 → 2.5`). Des canaris plus récents BWR + DHT ont aussi été observés, mais restent expérimentaux par variante. |
| ESP8266 multiscreen e-ink 2,7″ + OLED : OTA validée | **Oui, une fois** (`2.6 → 2.7`), mais avec seulement **608 o** de tas au minimum : pas stable/public tant qu'une marge n'est pas reconquise. |
| Tout firmware ESP8266 du dépôt est prêt à recevoir une OTA | **Non.** `eink27bw` seul n'a que des preuves de compilation ; TFT + DHT et certains hybrides BWR/OLED restent expérimentaux/non aboutis. |
| UNO R4 : mécanisme OTA Wi-Fi démontré | **Oui, en banc de laboratoire** (A→B→A, conservation de données). |
| UNO R4 : client OTA applicatif signé, distribué et validé en production pour BWR | **Non démontré par les sources actuelles.** La matrice de `origin/main` dit explicitement « pas d'OTA applicative » pour les profils R4. |

La bonne formulation publique actuelle est donc : **« Certains profils ESP8266 disposent d'une OTA Internet signée validée par canari ; chaque profil et chaque variante matérielle garde son propre niveau de preuve. Les R4 ne disposent pas encore d'une OTA applicative distribuée. »**

Cette note demande de préserver cette précision, car c'est elle qui protège le projet contre une promesse de compatibilité trop large.

---

## 2. Situation Git : risque principal avant toute autre évolution

### 2.1 Deux lignées actives et divergentes

Au moment de l'audit :

```text
origin/main                         48ee14d (25/10)  docs: prompt d'audit...
branche locale courante             8dbcee4 (25/10)  feat(bwr): affichage capteur v2...
ancêtre commun                       f6f648e
écart origin/main...HEAD             97 commits à récupérer / 142 commits locaux à publier
```

Ce n'est pas un simple retard de quelques commits. C'est une divergence majeure. Les deux côtés contiennent des travaux utiles mais différents :

- `origin/main` contient notamment les travaux récents R4 portail, les mises à jour de matrice et les éléments de quorum/publication.
- la branche locale contient les canaris et itérations ESP OTA, BWR DHT/OLED, TFT DHT, multiscreen et leur documentation associée.

**Interdiction opérationnelle recommandée :** ne pas faire de push global, de merge aveugle, de rebase massif ou de nettoyage de worktree avant d'avoir établi une table de correspondance des lots. Un tel geste pourrait embarquer des canaris incomplets, écraser des corrections R4, ou rendre les preuves impossibles à relier au code.

### 2.2 État de travail non commité

La branche locale est sale. Les changements à préserver et à qualifier avant toute intégration incluent :

- `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` : modification de mise en page capteur BWR ;
- `ota-lab/esp8266-canary/tools/build-bwr.mjs` et `run-bwr-test.mjs` : nouveaux paramètres de source/simulation OLED ;
- `tests/bwrSensorDisplay.test.ts` : attentes associées ;
- fichiers de pins et releases BWR non suivis sous `ota-lab/...` et `ota-releases/eink29bwr-*` ;
- sauvegardes de firmware et mesures locales non suivies ;
- plusieurs notes locales non suivies, dont la matrice et la note de consentement propriétaire.

Le diff du sketch BWR est fonctionnellement significatif (bande capteur, persistance/rafraîchissement), pas un simple formatage. Il ne doit pas être amalgamé à un correctif de documentation.

### 2.3 Worktrees

De nombreux worktrees Claude existent dans `%TEMP%` et dans `Documents/ChatGPT/ANA/worktrees`, couvrant entre autres BWR, distribution, multiscreen, hybride, canari minimal, R4 et anciens audits. Ils sont des artefacts de travail utiles tant que la provenance n'est pas cartographiée.

**À faire plus tard, jamais maintenant :** créer un inventaire `branche → but → dernier commit → commits déjà intégrés → état à archiver`, puis archiver seulement les worktrees dont le contenu est présent dans une branche pérenne. Ne supprimer aucun worktree dans le cadre du présent audit.

---

## 3. Matrice technique et niveau de preuve réellement disponible

La matrice `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` sur `origin/main` est la meilleure base de vérité présente : elle définit correctement la légende `C` (compilé), `M` (observé), `P` (parcours utilisateur), `V2` (vote/frame/ACK observé), `OTA` (mise à jour Internet complète observée) et `EXP` (expérimental).

### 3.1 ESP8266

| Profil | Preuve certaine | Limites / décision |
|---|---|---|
| **TFT 1,8″ `tft18`** | V2, affichage, ACK, bloc #111 ; portail Wi-Fi à deux QR observé ; OTA Internet signée `2.7 → 2.8` avec conservation de l'identité et du Wi-Fi. | OTA réussie mais marge de mémoire minimale observée autour de 1,2 Ko pendant téléchargement. Profil publiable avec surveillance, pas prétexte à ajouter des options lourdes sans canari propre. Le portail `2.9` a été flashé et a affiché/ACKé, mais une OTA vers/de `2.9` n'est pas encore prouvée. |
| **TFT 1,8″ + DHT22 D3** | Compilation et tests hôte ; release `tft18-2.10-ota7` annoncée. | Installation non observée après ouverture ; absence de journal série de la carte. **EXP**, ne pas publier comme OTA fonctionnelle. |
| **BWR 2,9″ `eink29bwr`, sans capteur** | V2 + portail + OTA Internet `2.4 → 2.5`, redémarrage sain, identité/Wi-Fi conservés et flash relue. | Un seul appareil et un seul parcours complet ; très bonne base de profil stable, mais pas une généralisation automatique aux variantes. |
| **BWR 2,9″ + DHT22, OLED non piloté** | Vote/affichage/ACK et lecture/envoi DHT observés ; variantes ultérieures avec cartel capteur et OTA ont des mesures matériel consignées. | Les séquences et versions sont nombreuses (`2.6` à `2.12` selon canari) et certaines releases sont encore locales/non suivies. Garder **EXP/canari ciblé** jusqu'à une deuxième carte et une lignée de release propre. |
| **BWR + OLED d'état + DHT22** | OLED et DHT observés. | Le vrai OLED coûtait ≈ 2,7 Ko de tas et a empêché un téléchargement de frame. La simulation par ballast n'est pas équivalente à un OLED matériel. Ne pas appeler cette variante compatible pour les œuvres, ni lui envoyer de release stable. |
| **Multiscreen e-ink 2,7″ + OLED** | Vote V2, deux affichages, ACK ; portail ; OTA `2.6 → 2.7` avec flash relue. | Minimum mémoire de **608 o** seulement. C'est un canari réussi, pas un profil de diffusion sûre. Geler l'ajout de fonctionnalités et traiter la mémoire avant toute généralisation. |
| **e-ink 2,7″ BW seul `eink27bw`** | Compilation V2. | Aucune preuve matérielle actuelle de vote, frame, portail ou OTA. Pas distribuable comme OTA. |

### 3.2 UNO R4 WiFi

| Profil | Preuve certaine | Limites / décision |
|---|---|---|
| **R4 TFT 2,8″ tactile** | Vote V2 et affichage/ACK observés ; les essais OTA-3 de banc ont démontré A→B→A et conservation programme/données. | OTA-3 transportait une image avec CRC, pas le contrat applicatif signé ESP. Les animations restent à qualifier. Aucun client OTA applicatif de production listé. |
| **R4 e-ink BWR 2,9″** | Vote V2 + affichage observés ; portail Wi-Fi `r4eink29-1.2` observé ; téléchargement de frame/vote de cette variante observés. | La matrice de `origin/main` indique explicitement **pas d'OTA applicative**. Le matériel R4 est donc un bon candidat de vote/portail, mais pas encore un produit OTA équivalent à l'ESP. |
| **R4 DHT22** | DHT22 → `/api/sensor` 200 observé. | Capteur seul : ni écran, ni votant, ni OTA. |
| **R4 e-ink 2,7″ / multiscreen / TFT 1,8″** | Compilation seulement. | Non essayés matériellement ; pas de promesse OTA. |

### 3.3 Sens de « porté »

Une variante ne devient jamais compatible simplement parce que son sketch compile ou parce que le sketch voisin a passé un canari. Pour chaque nouvelle combinaison, distinguer impérativement :

```text
profil de câblage + écran(s) réseau + modules actifs + version/sequence + budget mémoire
```

Une BWR avec OLED d'état n'est pas un multiscreen. Une BWR avec DHT22 n'est pas automatiquement une BWR sans capteur. Une R4 BWR n'hérite pas de l'OTA ESP8266. Cette règle doit figurer dans le README public et dans l'installer.

---

## 4. OTA : architecture, points forts et limites observées

### 4.1 Ce qui est solide côté ESP8266

Le chemin de distribution implémenté dans la lignée ESP contient les briques attendues :

- annonce légère via `/api/pull` ;
- sélection de release par famille, version/séquence et appareil ciblé ;
- interrupteur de diffusion Redis (`ota:kill`) ;
- ticket lié à l'appareil, signé par la clé privée appareil ;
- TLS authentifié avec ancres épinglées ;
- image signée, vérifiée côté ESP avant activation ;
- anti-retour arrière par séquence ;
- tentative inscrite après un signe authentique, pauses et refus fermés ;
- contrôles de santé, relecture de flash et canari manuel.

Les canaris Internet ont aussi établi une chose importante : le réseau public, la signature, l'identité et le vote post-OTA peuvent fonctionner ensemble sur un même appareil réel. C'est bien plus fort qu'une compilation ou un serveur local.

### 4.2 Ce qui reste structurellement limité

1. **Pas de rollback automatique prouvé.** L'ESP conserve l'image actuelle lorsqu'un téléchargement/vérification échoue, mais une image qui passerait la vérification et casserait au démarrage ne bénéficie pas d'un retour automatique démontré.
2. **Pas de test de coupure d'alimentation.** À traiter uniquement via protocole dédié, pas pendant une session de diffusion normale.
3. **Marge mémoire très variable.** TLS BearSSL, fragmentation, buffers d'écran et pilotes peuvent faire passer la même carte d'un refus propre à un succès. Les garde-fous sont nécessaires mais n'augmentent pas la mémoire disponible.
4. **Pas de consentement propriétaire implémenté.** La note locale `SECURITE_OTA_CONSENTEMENT_PROPRIETAIRE_2026_10_23.md` décrit correctement la cible (décision locale par appareil, mode manuel/auto, signature inchangée) ; elle ne doit pas être confondue avec une fonctionnalité active. C'est compatible avec une addition OTA ultérieure si le client actuel est bien maintenu.
5. **Les credentials Wi-Fi ont deux modèles.** Le build générique + provisionnement local est préférable à un Wi-Fi compilé. Les notes doivent dire clairement quand une carte exige encore une liaison série et quand le portail de première connexion suffit.

### 4.3 Le refus/porte OTA

La fermeture `ota:kill` n'est pas nécessaire à chaque débogage parce que le mécanisme serait intrinsèquement dangereux ; c'est une ceinture opérationnelle pendant un canari surveillé. Une « séance ouverte » avec surveillance et appareil ciblé est acceptable. Hors séance et hors présence humaine, la porte doit rester fermée pour empêcher une écriture inattendue au prochain pull et préserver la traçabilité des essais.

Cette règle doit être documentée une seule fois, de manière simple :

```text
canari surveillé : porte ouverte jusqu'à la fin du run ;
hors séance / nuit / absence : porte fermée ;
diffusion publique : politique de consentement propriétaire avant activation large.
```

---

## 5. Ce que le code serveur actuellement audité sait réellement distribuer

Dans `lib/otaDistribution.ts`, la table de clients OTA connue est actuellement :

```ts
tft18       >= 2.7    → esp8266-tft18
eink29bwr   >= 2.4    → esp8266-eink29bwr
multiscreen >= 2.6    → esp8266-multiscreen
```

**Aucune famille R4 n'y est inscrite.** C'est cohérent avec la matrice de `origin/main` : la R4 ne doit pas recevoir une release applicative par ce chemin aujourd'hui.

La présence d'anciens prototypes R4 (`ota-lab/r4-ota3`, `podOtaR4`, rapports OTA-3/OTA-5) ne doit pas être interprétée comme une activation de production. Ils sont précieux pour le futur, mais le contrat R4 (format `.ota`, signature applicative, activation, reprise/coupure) doit être validé séparément.

Action demandée : ajouter un test de cohérence qui interdit d'afficher, dans l'installer ou dans le README, « OTA disponible » pour une famille absente de `OTA_CLIENT_FIRMWARE`, sauf si l'on documente clairement un autre canal.

---

## 6. Documentation : dette majeure, corrections prioritaires

### 6.1 Source de vérité à instaurer

Adopter la matrice matérielle comme index canonique de l'état produit :

```text
docs/MATRICE_COMPATIBILITE_MATERIELLE.md
```

Elle est déjà riche et contient une politique de publication. Elle doit être mise à jour sur **la branche qui sera effectivement intégrée**, puis référencée depuis :

- `README.md` ;
- `AGENTS.md` et `CLAUDE.md` (instructions de travail, beaucoup trop figées) ;
- page Installer / documentation publique ;
- chaque compte rendu de canari.

La matrice affiche encore dans son en-tête une relecture sur `main = 9fa5701`, alors que le remote audité est `48ee14d`. Corriger ce repère lors de la prochaine mise à jour, avec le hash réellement fusionné, sans modifier l'historique des preuves.

### 6.2 README : en retard et contradictoire

Le README de la branche locale dit encore que « l'OTA signée ESP8266 est prouvée en laboratoire » mais que « sa distribution Internet reste inactive et non déployée ». Cette phrase est devenue fausse pour les canaris Internet ESP signalés dans la matrice et les rapports du 22–25/10.

Il doit être remplacé par un résumé lisible :

- profils OTA Internet validés, avec lien vers la matrice ;
- profils expérimentaux/non compatibles, explicitement ;
- R4 : vote/portail selon le profil, **pas encore OTA applicative distribuée** ;
- procédure d'ajout : portail Wi-Fi puis appairage PoD, sans promettre qu'un portail captif s'ouvre toujours ;
- installation filaire vs mise à jour distante ;
- pas de promesse sur les capteurs/OLED/animations avant leur ligne de matrice.

Le README ne doit ni raconter tous les canaris ni copier les tableaux détaillés. Il doit pointer vers la matrice et vers une procédure courte de récupération.

### 6.3 Documents historiques à conserver mais reclasser

De nombreuses notes de 08–21/10 restent factuellement utiles, mais deviennent trompeuses si lues sans date :

- `OTA_FAISABILITE_ET_PLAN_2026_10_15.md` ;
- `OTA_PAUSE_ESP8266_ET_REPRISE_2026_10_16.md` ;
- `PASSATION_CLAUDE_OTA_2026_10_20.md` ;
- `POINT_AVANCEMENT_2026_10_19.md` ;
- `PROTOCOLE_CANARI_OTA_INTERNET_2026_10_20.md` ;
- les plans G2/G3/G4 et rapports de préparation R4.

Ils ne doivent pas être supprimés : ils constituent l'audit trail. Ajouter en tête une bannière standard :

> **Historique — état à la date du document. Pour l'état actuel, voir la matrice et le point d'avancement courant.**

Ne réécrire les faits passés que lorsqu'ils sont objectivement faux ; sinon, dater la supersession.

### 6.4 Licence et firmware téléchargeable

Le README local indique qu'aucune licence logicielle n'est accordée, tandis que des éléments générés/anciens peuvent annoncer MIT ou CC0. Cette contradiction est juridique et produit une ambiguïté pour les utilisateurs.

Avant une publication large, décider :

1. licence du serveur ;
2. licence des sketches/fichiers partagés ;
3. licence des binaires/releases ;
4. attribution des bibliothèques tierces.

Puis faire correspondre README, zip généré, page Installer et headers. Ne pas improviser cette décision dans un lot OTA.

---

## 7. Qualité vérifiée pendant cet audit

### 7.1 Campagne `npm test`

Commande lancée sur **la branche locale sale**, sans toucher au matériel :

```text
npm test
```

La campagne a produit de nombreux succès, puis a été interrompue après une longue absence de progression. Elle n'est donc **pas un résultat vert complet**. Avant l'interruption, cinq échecs ont été observés :

| Test | Constat |
|---|---|
| `pod_metrics.h` copies | `esp8266/esp_eink_2.9BWR/pod_metrics.h` diverge de `esp8266/_shared/pod_metrics.h` |
| `pod_vote_esp.h` copies | même divergence BWR / source partagée |
| `pod_dht22.h` copies | même divergence BWR / source partagée |
| `boundedSsl` Renesas 1.5.3 | échec hôte Windows : code `3221226356` au lieu de 0 |
| `boundedSsl` Renesas 1.6.0 | même échec |

Les trois divergences BWR peuvent être le résultat temporaire du lot capteur en cours, mais elles rendent la branche rouge. Elles doivent être soit synchronisées depuis la source commune, soit justifiées par une architecture qui n'utilise plus l'identité des copies (ce qui demanderait une décision explicite). Ne pas ignorer ce test.

Les deux erreurs `boundedSsl` avaient déjà été décrites dans des notes antérieures comme dépendantes de l'environnement de compilation Windows. Elles ne prouvent pas une panne R4 sur carte ; elles empêchent néanmoins de prétendre que la suite hôte est verte tant que le harnais n'est pas reproduit avec son compilateur attendu.

### 7.2 TypeScript

`npx tsc --noEmit` n'a pas pu être lancé dans cette session : `npx` a tenté de résoudre le paquet `tsc` depuis npm et l'environnement était sans accès DNS au registre. Ce n'est pas une erreur TypeScript démontrée. Claude devra employer le compilateur local du projet (`node_modules/.bin/tsc` si présent) ou un environnement installé, et enregistrer la commande exacte.

### 7.3 Ce que ces tests ne couvrent pas

Une suite hôte ne prouve ni : TLS réel sur l'ESP, fragmentation, activation bootloader, rendu physique, frame ACK, quorum à plusieurs appareils, comportement lors d'une coupure, ni état du déploiement Vercel. Le niveau de preuve de chaque ligne doit rester dans la matrice.

---

## 8. Risques classés et décisions recommandées

| Priorité | Risque | Pourquoi c'est important | Décision demandée |
|---|---|---|---|
| P0 | Deux lignées Git très divergentes | risque de publier un mélange incomplet ou d'écraser des correctifs | geler les merges globaux ; faire une cartographie de lots et intégrer par PR thématique |
| P0 | Énoncé « OTA partout / R4 prête » | peut faire flasher un appareil non couvert | faire du README/matrice la seule autorité publique ; R4 = non OTA applicative jusqu'à preuve dédiée |
| P1 | BWR DHT/OLED en cours non commité | des binaires/release peuvent ne pas correspondre au source fusionnable | isoler ce lot, compiler, tester, consigner sa preuve avant publication |
| P1 | Multiscreen à 608 o et TFT à 1,2 Ko de marge | une petite régression peut transformer une OTA en refus ou comportement instable | ne pas distribuer comme stable ; fix mémoire et deux canaris indépendants avant promotion |
| P1 | Tests de copies BWR rouges | source partagée et copies peuvent diverger sans visibilité | corriger/synchroniser ou documenter l'exception avec test adapté |
| P1 | R4 pile/réseau historiquement complexe | les anciens rapports montrent de vrais problèmes de pile et d'instrumentation | faire de l'OTA R4 un chantier isolé, jamais un simple port de `pod_ota_esp.h` |
| P2 | Docs et README divergents | une personne suivant un vieux plan peut faire une mauvaise manipulation | index canonique + bannière « historique » + réécriture README |
| P2 | Licences incohérentes | bloque la distribution et crée une promesse juridique ambiguë | décision explicite hors canari |
| P2 | Absence de test de coupure/rollback | limite de sécurité connue | protocole futur séparé, jamais improvisé |

---

## 9. Ordre de travail imposé pour la reprise

### Lot A — Réconciliation documentaire et Git, sans matériel

1. Créer une courte note de cartographie : `origin/main`, branche locale ESP, worktrees, dernier commit, objectif, statut (intégrer / garder / archiver).
2. Définir une branche d'intégration vide ou une suite de PR thématiques ; ne pas déplacer le travail local non commité avant cette décision.
3. Mettre à jour la matrice sur la lignée choisie avec : hash `main` réel, profils, version/séquence, niveau de preuve, décision de diffusion.
4. Réécrire le README uniquement à partir de cette matrice.
5. Ajouter les bannières d'historique aux anciens plans majeurs.
6. Résoudre les écarts de copies partagées ou les qualifier dans un test/ADR.
7. Rejouer TypeScript et la suite sur l'environnement reproductible ; produire un tableau `vert / rouge connu / non exécuté`.

**Sortie attendue de Lot A :** une PR purement documentaire/qualité, sans changement de comportement firmware ni déploiement.

### Lot B — Clore les profils ESP déjà proches, un par un

Ordre recommandé :

1. BWR 2,9″ + DHT sans OLED (le plus proche d'un profil utilisable) : seconde carte ou second parcours, source/release/manifest exactement alignés, puis promotion éventuelle de `EXP` à canari reproduit.
2. TFT 1,8″ standard : prouver une OTA incluant le build portail actuel si ce build doit être distribué, sinon le retirer de la promesse OTA.
3. Multiscreen : optimisation de mémoire et deux canaris indépendants ; avant cela, pas de diffusion stable.
4. TFT + DHT : récupérer le journal local de la carte et résoudre le refus pré-téléchargement ; ne jamais déduire la compatibilité du succès TFT sans DHT.
5. BWR + vrai OLED : traiter comme un nouveau profil ; ne pas valider par ballast seul.

À la fin de chaque lot : mise à jour matrice + compte rendu mesure + décision de diffusion. Pas de prolifération de fichiers « VERSION FINALE » hors de ce protocole.

### Lot C — R4, chantier indépendant après ESP

1. Écrire un ADR R4 à jour : protocole `.ota`, signature sur l'application, activation, anti-retour, état persistant, restauration.
2. Démontrer un client OTA applicatif **sur un seul profil R4**, probablement BWR, sans prendre les essais CRC OTA-3 pour preuve de sécurité.
3. Rejouer : identité, Wi-Fi, vote, frame, ACK, image installée, journal et reprise.
4. Ensuite seulement, déclarer une famille R4 dans une table de distribution séparée ou étendue, avec tests de cohérence.

### Lot D — Consentement propriétaire, après les fondations

La sécurité demandée par le porteur est pertinente : l'utilisateur propriétaire doit pouvoir demander/autoriser ses propres mises à jour. Elle est réalisable a posteriori via OTA **si** le client OTA actuel reste fonctionnel. Concevoir en priorité :

- mode local `manual / scheduled / auto` persistant ;
- demande signée/ciblée depuis l'app ;
- confirmation visible à l'écran ;
- refus par défaut hors fenêtre ;
- aucune baisse de signature, de séquence ou de TLS.

Ce lot ne doit pas retarder la stabilisation immédiate des profils ESP ; il doit être spécifié maintenant et implémenté après la réconciliation.

---

## 10. Contrat de livraison demandé à Claude pour chaque futur lot

Chaque réponse de fin de lot doit fournir, dans cet ordre :

1. **But et périmètre** — une phrase, profil matériel exact.
2. **Source Git** — branche, commit, parent/base, fichiers touchés.
3. **Niveau de preuve** — `[code]`, `[hôte]`, `[carte]`, `[production]`, sans amalgamer.
4. **Résultats mesurés** — hashes, version, séquence, RAM/plus grand bloc/pile quand pertinent ; jamais de secret.
5. **Tests** — commande exacte, nombre vert/rouge/ignoré et raison.
6. **État matériel** — ce qui est flashé et ce qui ne l'est pas.
7. **État diffusion** — local / poussé / preview / production / porte fermée ou ouverte.
8. **Matrice et docs mises à jour** — ou une justification explicite si le lot n'a pas changé le niveau de preuve.
9. **Prochaine action unique** — avec effet réel, risque et GO précis nécessaire.

Interdit : appeler « prêt » un build compilé, un test hôte ou une sonde isolée ; annoncer « OTA R4 » sans préciser que c'est le mécanisme de banc CRC ou le client applicatif signé ; mélanger une release de capteur expérimentale avec le firmware stable d'un autre profil.

---

## 11. Conclusion opérationnelle

Le socle PoD est réel et prometteur : les canaris OTA Internet ESP8266 ne sont plus du papier, le portail simplifie réellement la première connexion, les votes/frames/ACK ont été observés sur plusieurs appareils et l'idée d'une matrice de profils est le bon antidote à l'explosion combinatoire.

Le frein actuel n'est pas l'absence de technologie. C'est la **convergence** : rendre les branches, releases, preuves et documents cohérents avant d'élargir le catalogue. Le plus grand gain de vitesse à partir de maintenant viendra d'un registre de profils fiable et d'une intégration par lots étroits — pas d'une promesse globale qui obligerait ensuite à diagnostiquer indistinctement ESP, R4, écrans, OLED et capteurs.

**Décision d'audit :** commencer par le Lot A, sans flash ni publication. Une fois la lignée et la matrice cohérentes, reprendre les profils ESP à marge saine. L'OTA R4 applicative reste explicitement hors périmètre jusqu'à son propre canari signé de bout en bout.
