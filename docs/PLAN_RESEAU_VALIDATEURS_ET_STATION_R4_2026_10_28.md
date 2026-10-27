# Plan détaillé — réseau de validateurs « tous votent tout », station R4, animations (28/10/2026)

| | |
|---|---|
| **Auteur** | Claude (réalisateur) — destiné à GPT (auditeur) et au porteur |
| **Base de code** | `origin/main` au commit `f47942e` (station R4 `r4tft18-2.3`, correctifs de vote du 28/10) |
| **Statut** | PLAN. Rien de ce qui est listé en « à faire » n'est codé. Ce document remplace, là où ils divergent, les hypothèses du message de GPT du 27/10 (voir § 3). |
| **Niveaux de preuve** | **C** compilé · **H** testé sur l'hôte (g++/node) · **M** observé sur la carte · **V** vote réel observé · **S** observé sur le serveur de production |

## 1. État réel au 28/10/2026 (avec niveaux de preuve)

La carte de laboratoire est `dev_I25D9Z7A` : UNO R4 WiFi + TFT 1,8″ ST7735 (CS D10, DC D9, RST D8) + DHT22 (D2) + SGP40 (I2C) + module SD (CS D4, SPI partagé D11/D12/D13), firmware `r4tft18-2.3` (dossier `arduino_uno_r4/pod_uno_r4_tft18_env`). L'ESP8266 + TFT 1,8″ est archivé (non supprimé : `docs/ARCHIVE_TFT18_ESP8266_2026_10_26.md`) ; le **type d'écran serveur `tft18` est partagé** avec la R4 et reste pris en charge.

| Fonction | Niveau | Détail |
|---|---|---|
| Démarrage, Ed25519, register, pull | **M** | register 200, pull 200, auto-test Ed25519 OK |
| DHT22 | **M** | 19–20 °C, 78–82 % lus |
| SGP40 + indice COV Sensirion | **M** (brut) · **C** (indice) | brut lu ; l'indice COV (bibliothèque officielle 3.2.3) est compilé, journalisé, jamais comparé à une référence |
| SD | **M** | « carte lisible » ; écriture de l'historique sans erreur journalisée |
| Historique + pages température / humidité / air / synthèse | **M** (tracé sans erreur de pile, marge ≈ 1 400 o) · **H** (fonctions pures) | rendu visuel non constaté par Claude ; le porteur a vu l'ancienne version et la juge propre |
| Affichage d'une œuvre du réseau (image) | **C** | **jamais observé** : aucune frame reçue sur ce firmware |
| Lecture d'une animation depuis la SD | **C** | **jamais observée** |
| Vote v2 d'un dessin | **V** (un vote) | un vote REFUS signé « blank » accepté par le serveur (HTTP 200) ; aucun vote d'acceptation observé |
| ACK d'une frame | non observé | |
| OTA R4 A→B du produit complet | **M** | 148 896 o en 75 s, une seule fois, clés de test, HTTP clair (`docs/OTA_R4_CLIENT_ET_PUBLICATION_2026_10_26.md`). Les chiffres « 98 632 o / marge 516 o » appartiennent à un essai antérieur de la station, pas au produit complet |
| Production | **S** | `main` part en production directe : `ANIM_V1_VOTE` (vote v1 admis pour les animations), grandeur `vocidx`, pointeur d'animation `r4tft18 ≥ 2.3` sont **déjà en ligne** |

## 2. Règle produit (confirmée par le porteur)

1. **Quatre capacités indépendantes** : affichage, mesure, vote, OTA. Aucune ne se déduit d'une autre.
2. **Tout appareil qui embarque réellement le moteur de vote vote pour TOUS les formats** : `oled096` 1 024 o, `eink27bw` 5 808 o, `eink29bwr` 9 472 o, `tft18` 40 960 o, `tft28` 153 600 o. Le format du candidat ne filtre jamais l'électorat. La conversion/diffusion finale de l'œuvre vers les écrans reste un sujet **distinct** (affichage).
3. Trois notions à ne pas confondre : **qui reçoit et calcule** · **qui est autorisé à voter** · **combien de voix comptent dans le quorum**.
4. Un futur appareil **sans écran** (capteurs seulement) mais avec le moteur de vote est un validateur : il reçoit des candidats, jamais de frame d'affichage, et n'entre dans aucun `pool:screen:*`.
5. Un ancien firmware capteur sans moteur de vote (`r4dht22-1.3`) reste **non votant**.

## 3. Corrections au message de GPT du 27/10 (incohérences constatées)

1. **« Votes reçus : 0 » est faux.** Journal série de la station : le premier essai de vote a échoué par manque de mémoire (pile réseau dédiée de 3 Ko, corrigée le 28/10 : 2 Ko par défaut, 3 Ko seulement pour image/clip). Ensuite le vote a été **accepté (HTTP 200)** avec le verdict signé **refus « blank »** (e = 0, t = 0, r = 6987). Le journal public montre « 0 accept / 1 refus ». Un refus ne finalise rien : l'expiration vient de **deux** causes cumulées (électorat = 1 ; le seul validateur a voté non).
2. **Le « blank » est un problème ouvert**, absent de son plan. Le serveur annonçait 0,14 % de complexité ; la carte a compté 143 passages de couleur mais e = t = 0. Soit l'image était uniforme au sens de la métrique (« encre » = pixel ≠ blanc 0xFFFF), soit les moteurs TypeScript et C++ divergent pour `tft18`. À trancher (§ 5, L3).
3. **Phase 0 périmée** : les modifications « non commitées » (`pod_hist.h`, `.ino`, `measures.ts`, `stationHistory.test.ts`) sont commitées et poussées (`f47942e`) ; l'arbre de travail est propre.
4. **La R4 n'est pas « seule » ni « à moitié branchée »** : TFT, DHT22, SGP40 et SD sont présents (les journaux le prouvent).
5. **« Affichage des dessins et animations » est listé comme démontré ou intégré** : intégré et compilé, **jamais observé** (voir § 1).
6. **« Aucun basculement production sans GO »** : les correctifs de vote et de capteur du 28/10 sont déjà sur `main`, donc en production.
7. **Le capteur seul ne vote pas aujourd'hui** (`sensor-cannot-vote`, exclu de `devices:all` et des décomptes). Le lui permettre est un **changement de règle**, pas une précision.
8. **`ELIGIBILITY_MODE=enforce` est dangereux ici** : tous les appareils du porteur partagent un profil et l'auteur est exclu ; l'électorat tomberait à zéro et rien ne serait miné. À ne pas activer avant plusieurs profils indépendants.
9. **« ESP + TFT 1,8″ abandonné »** : ne pas retirer `tft18` de `VOTE_V2_FIRMWARE` ni de `ANIM_POINTER_FIRMWARE` ; le type d'écran est partagé avec la R4.
10. **Pertinent chez GPT, à conserver** : le candidat effacé par l'arrivée d'une frame (§ 4, H3), `QUORUM_MAX_MISSED=1` trop sévère (H2), le besoin d'un état figé du pool au dépôt du candidat.

## 4. Diagnostic : pourquoi chaque famille ne valide-t-elle que son format ? (hypothèses classées)

Constat serveur (lu dans le code) : `app/api/pull/route.ts` invite tout appareil appairé, actif et **capable de voter** (`mayVote`), sans regarder l'écran du candidat ; `validate-candidate` et `candidate-frame` ne filtrent pas non plus. La distribution est donc déjà globale. Les causes sont à chercher ailleurs :

| # | Hypothèse | Preuve actuelle | Comment la trancher |
|---|---|---|---|
| H1 | Seule la R4 est en ligne (ESP débranchés, `lastPing` > 45 min) : « réseau de 1 » est exact | probable | instantané du pool au dépôt du candidat (L2) |
| H2 | `QUORUM_MAX_MISSED=1` (`lib/quorumResponsive.ts`) : un seul candidat expiré sans vote exclut l'appareil du dénominateur ; il revient en votant son propre format → « chaque famille valide son format » | code lu ; effet plausible | `missedVotes` par appareil (diagnostic L2) |
| H3 | `doFetchFrame` fait `pendingCandidateId = ""` après affichage (R4 tft18 : ligne 721 ; BWR : lignes 2002+) : un pull qui apporte candidat ET frame perd le vote | **vérifié dans le code R4** ; BWR à confirmer | test d'hôte « candidat et frame dans le même pull » (L1) |
| H4 | Les ESP réservent toujours 4 736 o de tampon pour un vote v2, même pour un format qui n'en exige aucun (TFT, e-ink 2,7″) ; un échec d'allocation = abstention silencieuse | code BWR `doValidateV2` | journaliser la raison d'abstention + n'allouer que si le format l'exige (L1) |
| H5 | Firmware dans l'allowlist mais ne sachant pas voter un format étranger (tampon trop petit, `podKindFromName`) | à tester | matrice validateur × format (L4) |
| H6 | Vote refusé côté serveur (403/422) : firmware non capable, signature, métriques divergentes | partiellement vu | journal serveur des refus (L2) |

## 5. Plan par lots

Chaque lot : périmètre, fichiers, preuve attendue, risque. Ordre = ordre d'exécution recommandé.

### L1 — Firmware : voter sans perdre le candidat ni la mémoire (R4 + ESP)
- **Candidat non effacé par une frame** : `pendingCandidateId` n'est effacé que par `doValidate` (vote émis, déjà voté, candidat obsolète) — jamais par `doFetchFrame`.
- **Tampon à la demande** : allouer le tampon de métriques uniquement si `feeder.begin(kind, …)` en exige (OLED 1 024 o, BWR 4 736 o) ; aucune allocation pour `eink27bw`, `tft18`, `tft28`. Jamais d'image entière en mémoire.
- **Raison d'abstention bornée** au journal série (« NOMEM », « HTTP 4xx », « hash », « format inconnu », « signature », « POST »).
- Fichiers : `pod_uno_r4_tft18_env.ino` (produit), puis les 4 autres R4, puis les ESP (BWR, e-ink 2,7″ ±OLED, multiscreen) — **un firmware à la fois**, copie de sauvegarde dans `firmware-backups/`.
- Preuve : hôte (harnais existants étendus) → compilation → carte pour la station R4 seulement. Les ESP ne passent pas **M/V** sans reflash et GO.

### L2 — Serveur : quorum vivant et diagnostic (lecture seule)
- **Politique `quorumHealth`** : exclusion après N manques **consécutifs** (proposition N = 3, configurable), réhabilitation immédiate au premier vote, conservation de la raison et de l'heure d'exclusion. `QUORUM_MAX_MISSED` par défaut 1 → 3.
- **Résumé de pool figé au dépôt du candidat** (borné, sans MAC/pairCode/clé) : total connu, actifs, capables, responsive, retenus, exclusions par raison (`inactif`, `firmware incapable`, `capteur seul`, `manques`, `non appairé`). Stocké avec le candidat (aucune lecture de plus), repris par « Rejeté » dans l'interface.
- **Diagnostic admin en lecture seule** : par appareil, famille, firmware, écrans, capteurs, appairé, `lastPing`, `missedVotes`, `lastVoteAt`, capable (statique / animation), compté ou exclu + raison. Lectures bornées (`devices:all`), pas de `KEYS`/`SCAN`.
- **Journal des refus de vote** (403/422) par raison, borné.
- Budget Redis : aucun polling ; +0 commande au repos.

### L3 — Le « blank » : image uniforme ou divergence TypeScript/C++ ?
- Vecteurs RGB565 `tft18` (128×160) rejoués dans `lib/podMetrics.ts` ET `pod_metrics.h` : image blanche, noire, colorée uniforme, texte noir sur blanc, fond coloré + traits clairs, dessin réel du porteur.
- Si divergence : correctif de la référence fautive + test de non-régression. Sinon : documenter que la métrique « encre = ≠ blanc » juge uniforme un fond coloré plein, et décider si ce critère convient aux écrans couleur.
- Essai matériel contrôlé : un dessin noir sur fond blanc sur la station (journal `[VALIDATE2] e t r verdict`).

### L4 — Matrice validateur × format (preuve centrale)
- Table de vérité hôte : chaque famille (R4 e-ink 2,9″/2,7″/2,7″+OLED, R4 TFT 1,8″, R4 TFT 2,8″, ESP BWR, ESP e-ink 2,7″, ESP multiscreen) × 5 formats, avec le tampon requis et le résultat attendu ; les lignes impossibles sont **déclarées** (jamais comptées dans le dénominateur).
- Tests croisés : BWR sur candidat TFT1.8 ; R4 TFT sur candidat BWR ; multiscreen sur TFT ; R4 sur OLED ; futur sans écran sur les cinq ; candidat + frame dans le même pull ; appareil exclu mais toujours invité puis réhabilité ; appareil incapable jamais au dénominateur.
- L'allowlist `VOTE_V2_FIRMWARE` devient la **conséquence** de cette matrice et des preuves matérielles, pas une preuve.

### L5 — Capacités de vote déclarées (découplage écran / capteur / vote)
- `/api/register` accepte un champ **borné** `caps` (valeurs d'une liste fermée : `vote-static-v2`, plus tard `vote-anim-v3`), persisté dans la fiche appareil ; **aucun texte libre**, validation stricte, anciens firmwares inchangés.
- Le serveur croise la capacité déclarée avec la famille/version autorisée : **une déclaration seule ne gonfle jamais le quorum** ; la signature reste vérifiée.
- `screens` = sorties d'affichage ; `sensors` = mesures ; `caps` = vote. Le pseudo-écran `sensor` reste pour l'interface mais ne décide plus du droit de vote.
- Les firmwares écran actuels gardent une capacité **déduite** de leur version (période de transition) ; les nouvelles versions la déclarent.
- Un capteur-validateur entre dans l'index électoral, jamais dans `pool:screen:*` ni dans la diffusion d'œuvres.

### L6 — Votes v2 sur les animations (pod-anim-v3)
- Déjà dans le dépôt, inactif : `docs/SPEC_PODANIM_V3.md`, `lib/animV3.ts`, message signé `pod-vote-v3-anim`, noyau C++ en flux (compilé ESP8266/R4), vérificateur de bloc, route `candidate-clip` (ticket HMAC), mode `ANIM_V3_MODE` `off`/`shadow`.
- Principe retenu : **chaque validateur recalcule tout** (une lecture en flux du clip, ≤ 9 216 o ; clipHash, hash salé, métriques de chaque image, racine de Merkle, E/T/R/S) et signe. Le calcul n'est pas le goulot (≈ 1 s pour 64 images sur ESP8266 [E]) ; ce sont la mémoire et le TLS.
- **Pas de seuil de similarité (75 %)** : un hash n'a pas de « presque identique » ; accepter 75 % d'images concordantes laisserait truquer le reste. Les gains légitimes : **arrêt à la première divergence** (rejet immédiat) ; éventuellement un sous-ensemble d'images tiré au sort par le nonce du validateur (réduit le calcul, pas le téléchargement) — à décider après mesure.
- Règles proposées (à valider) : ≥ 2 images distinctes ; rejet « statique » si toutes les images sont identiques ; rejet « bruit » ; quorum d'au moins un vote **v3** d'animation ; un écho v1 ne compte **jamais** dans un quorum v3.
- Déploiement : code + tests → `shadow` → canari matériel (station R4 d'abord) → couverture des familles → `enforce`. `ANIM_V1_VOTE` reste le secours étiqueté « écho » pendant la migration. Tous les ESP et R4 doivent être mis à jour (OTA ciblée, L8) pour que `vote-anim-v3` soit déclaré.

### L7 — Station R4 : ce qui reste
- Observer pour de bon : une œuvre reçue (frame, cartel, ACK), une animation jouée depuis la SD, un vote d'acceptation, la reprise de l'état COV après redémarrage.
- **Synchronisation SD ↔ serveur** (non codée, à décider) : (a) *SD → serveur* : une coupure ≤ 6 h est déjà couverte par le tampon de 12 lectures ; au-delà, envoi de rattrapage des points de la SD, ce qui exige d'assouplir la règle « pas moins de 50 min entre deux envois » pour un lot de rattrapage borné ; (b) *serveur → SD* : sur une carte neuve, récupérer les 31 derniers jours (30 min) pour remplir le fichier horaire. Coût Redis à chiffrer avant tout code.
- La courbe annuelle n'apparaît qu'avec ≥ 200 jours de données (déjà adaptatif).
- Seuils COV (≤ 120 bon, ≤ 200 moyen) à étalonner par essais (fumée, cuisine).

### L8 — OTA ciblée
- Publication par famille/version, un appareil canari puis famille par famille ; l'OTA ne touche ni identité, ni clé privée, ni Wi-Fi, ni historique SD ; un firmware capteur ne reçoit jamais une release écran et inversement. Releases et manifestes préparés localement ; **aucune publication sans GO**.

## 6. Protocole d'essai (à exécuter quand les appareils sont branchés)

Soumettre successivement : un dessin BWR, un dessin TFT 1,8″, un dessin OLED, si possible un TFT 2,8″, puis une animation. Pour chaque candidat, relever : pool global (résumé figé L2), appareils invités, format local de chaque appareil, format du candidat, téléchargement, hash/métriques recalculés, signature, vote accepté/refusé, quorum, bloc miné **ou** raison exacte de non-décision. **Preuve centrale** : un appareil vote pour un format qu'il ne peut pas afficher.

## 7. Décisions à valider (proposition entre parenthèses)

1. `QUORUM_MAX_MISSED` : 1 → 3 consécutifs (oui).
2. Mode d'éligibilité : rester en `off` tant qu'il n'existe pas plusieurs profils (oui).
3. Capteur-validateur : nouvelle famille de firmware et nouveau préfixe (oui).
4. Animations : recalcul complet, arrêt à la première divergence, pas de seuil de similarité (oui) ; échantillonnage par nonce seulement après mesure.
5. `ANIM_V1_VOTE` : conservé jusqu'à `enforce` (oui).
6. Synchronisation SD ↔ serveur : après L1–L5 (oui).

## 8. Ce qui ne change pas

Pas de nouvelle base, pas de refonte de l'application ni de l'interface globale, aucun secret touché, quotas Redis préservés (aucun polling nouveau, lectures groupées), un seul flash par étape sur la station, binaire de retour conservé, aucune publication OTA ni fusion sans GO.

## 9. Avancement au 28/10/2026 (fin de journée) — mis à jour par Claude

| Lot | État | Niveau | Référence |
|---|---|---|---|
| L3 — refus « blank » | **cause prouvée**, correctif dans les 6 en-têtes R4 (commit local) | `C` + `H` | `COMPTE_RENDU_LOTS_1_A_3…` § 1 |
| L1 — candidat conservé, tampon à la demande, abstentions | station R4 + ESP BWR / multiscreen / e-ink 2,7″ (commits locaux) ; **R4 e-ink et TFT 2,8″ non modifiés** (même défaut recensé) | `C` + `H` | § 2 |
| L2 — électorat expliqué, seuil à 3 manques, résumé figé, diagnostic lecture seule | codé (commits locaux) ; **le diagnostic a été exécuté** sur Redis en lecture seule | `H` + `S` | § 3 |
| L4 — matrice validateur × format | générée depuis le code et testée | `C` + `H` | `MATRICE_VALIDATEUR_X_FORMAT_2026_10_28.md` |
| L5 — capacités déclarées, validateur sans écran | codé, **sans effet** tant qu'aucune famille n'est autorisée | `H` | `lib/voteCapability.ts` |
| L6 — vote d'animation v3 | noyau existant ; **pas d'intégration firmware** ; compteur de couverture ajouté | `H` | § 6 du compte rendu |
| L7 — station : observer œuvre, ACK, animation, acceptation | image `r4tft18-2.4` et retour arrière prêts ; **essai non exécuté** | — | `PROTOCOLE_ESSAI_STATION_R4_2026_10_28.md` |
| L8 — OTA ciblée | non commencée (aucune publication sans GO) | — | — |

**Prochain et seul GO nécessaire** : pousser les commits comportementaux et exécuter l'essai matériel instrumenté sur la station.
