# Audit indépendant GPT — calcul distribué, votes, signatures et évolution de PoD

**Auteur de l'audit : GPT**  
**Date : 6 octobre 2026**  
**Base de code inspectée : `879ef21` (`main`)**  
**Nature du document : audit et proposition de recherche, sans modification du firmware ni du protocole**

## 1. Verdict synthétique

PoD dispose désormais d'un **vrai calcul embarqué** sur la majorité des firmwares testés : les ESP8266 et UNO R4 téléchargent les octets finaux d'une image fixe, recalculent leur SHA-256 et trois métriques déterministes, prennent une décision locale, puis signent leur vote en Ed25519. Ce n'est donc plus un simple accusé de réception pour ces appareils.

Le terme techniquement juste pour le système actuel est toutefois :

> **chaîne de blocs centralisée, append-only et liée par hachage, alimentée par des attestations distribuées signées.**

Ce n'est pas encore une blockchain IoT décentralisée : le serveur choisit les candidats, forme le quorum, choisit le mineur, écrit l'unique registre Redis et ne conserve pas dans le bloc toutes les preuves signées permettant à un tiers de refaire l'audit.

Les retours matériels du porteur du projet sont très positifs : multiscreen, TFT 1,8 pouces, e-ink 2,7 pouces et e-ink 2,9 BWR fonctionnent sur ESP8266 et/ou UNO R4 selon les variantes testées. Le vote/calcul du TFT 2,8 tactile sur UNO R4 reste le seul essai matériel explicitement non réalisé. Cet audit n'a pas eu accès aux traces série de ces essais : il distingue donc le **retour matériel utilisateur** de la **preuve reproductible archivée**.

Les deux limites les plus importantes sont les suivantes :

1. les animations sont encore validées en **v1**, donc par écho et non par recalcul embarqué ;
2. le taux de « menteurs » annoncé dans les notes n'est **pas encore calculé ni persisté**. Un vote peut seulement recevoir un drapeau temporaire `suspect`.

Cela n'empêche pas de valider l'étape actuelle comme une grande avancée : **le calcul v2 des images fixes est réel**. Il faut simplement ne pas lui attribuer aujourd'hui des propriétés de consensus, de réputation ou de décentralisation qu'il n'a pas encore.

## 2. Périmètre et méthode

L'audit s'appuie sur :

- le code serveur de soumission, distribution, vote, quorum, chaîne et observation ;
- les firmwares ESP8266 et UNO R4 présents dans le dépôt ;
- les en-têtes partagés `pod_metrics`, `pod_vote` et leurs copies ;
- les tests unitaires ciblant le vote atomique, Ed25519, les clés, les métriques et les résumés de validation ;
- les notes existantes, notamment `CHANTIER_VALIDATION_REELLE.md`, les protocoles canari et la documentation animation ;
- le retour d'essai réel fourni le 6 octobre 2026.

Résultat du passage de tests ciblés sur ce poste : **30 tests réussis sur 36**. Les six échecs proviennent tous du crochet du test différentiel C++/TypeScript des métriques, dont le petit exécutable C++ ne s'est pas compilé ici sans diagnostic exploitable. Les tests Ed25519, vote v2, atomicité du vote, `MIN_V2_APPROVALS`, pinning de clé, absence de secrets Wi-Fi suivis et résumé de validation passent. La parité C++/TypeScript possède bien un test automatisé et a été annoncée comme validée lors de son intégration, mais elle n'a pas pu être reproduite sur cette machine pendant cet audit.

## 3. Ce que les microcontrôleurs calculent réellement

### 3.1 Donnée vérifiée

Pour une œuvre fixe, l'appareil ne valide ni une miniature ni une réponse JSON. Il télécharge le buffer brut canonique destiné au type d'écran :

| Écran | Géométrie logique | Octets bruts |
|---|---:|---:|
| OLED 0,96 | 128 × 64 monochrome | 1 024 |
| e-ink 2,7 BW | 176 × 264 monochrome | 5 808 |
| e-ink 2,9 BWR | 128 × 296, plans noir + rouge | 9 472 |
| TFT 1,8 | 128 × 160, RGB565 | 40 960 |
| TFT 2,8 | 240 × 320, RGB565 | 153 600 |

Pendant la lecture en flux, le firmware :

1. alimente un SHA-256 ;
2. transforme chaque pixel en état actif/inactif suivant le profil d'écran ;
3. compte les pixels actifs, les changements horizontaux et verticaux et les runs ;
4. calcule les métriques entières v2 ;
5. compare hachage et métriques avec l'annonce du serveur ;
6. produit un verdict local ;
7. signe le message de vote.

L'algorithme est conçu pour une mémoire contrainte : calcul en flux, entiers fixes en parties par million et au plus une ligne de travail, sans bitmap complet supplémentaire.

### 3.2 Métriques v2

Les trois métriques sont déterministes et exprimées entre 0 et 1 000 000 :

- `e` : entropie binaire de Shannon selon le taux de pixels actifs ;
- `t` : proportion normalisée de transitions entre pixels voisins horizontaux et verticaux ;
- `r` : mesure dérivée de la compression par runs, `sqrt(runs / pixels)`.

Le score synthétique est :

```text
s = min(1 000 000, (4e + 4t + 2r) / 10)
```

Il donne donc 40 % à l'entropie, 40 % aux transitions et 20 % aux runs. Il mesure une **complexité visuelle locale**, pas la beauté, l'originalité, le travail humain ni la valeur artistique.

### 3.3 Verdict embarqué

Le verdict actuel rejette :

- un hachage différent ;
- une image uniforme lorsque `e = 0` et `t = 0` ;
- un motif assimilé à du bruit lorsque `e > 980 000` et `t > 900 000`.

Attention : « uniforme » couvre aussi bien une image entièrement blanche qu'une image entièrement pleine. Employer seulement le mot « vide » dans l'interface ou la documentation serait inexact.

Le serveur vérifie que les valeurs signées correspondent à son calcul. Il ne réapplique cependant pas lui-même toutes les règles `blank/noise` avant d'accepter un verdict signé. Les règles de qualité sont donc aujourd'hui en partie une politique du firmware, et un refus reste non bloquant par défaut.

### 3.4 Ce que l'appareil ne prouve pas

Le microcontrôleur ne prouve pas que l'œuvre a été dessinée par une personne. Il ne reçoit ni ne rejoue les gestes, et ne vérifie ni `actionsHash`, ni `drawScore`, ni le ratio d'automatisation.

Le serveur analyse le replay pour repérer notamment un rythme trop automatique et peut rejeter une soumission dont plus de 80 % des intervalles sont inférieurs à 15 ms. Cette preuve de processus reste **centralisée**. Le calcul embarqué est actuellement une preuve d'intégrité et de complexité du rendu final.

## 4. Matrice réelle des firmwares

| Matériel / firmware | Vote image fixe v2 | Animation | État matériel communiqué |
|---|---|---|---|
| ESP8266 e-ink 2,9 BWR | Oui | v1 | testé avec succès |
| ESP8266 e-ink 2,7 BW seul | **Non, v1 seulement** | v1 | affichage testé ; calcul v2 absent du code |
| ESP8266 multiscreen e-ink 2,7 + OLED | Oui | v1 | testé avec succès |
| ESP8266 TFT 1,8 | Oui | v1 | testé avec succès |
| UNO R4 e-ink 2,9 BWR | Oui | v1 | testé avec succès |
| UNO R4 e-ink 2,7 BW seul | Oui | v1 | testé avec succès |
| UNO R4 multiscreen e-ink 2,7 + OLED | Oui | v1 | testé avec succès |
| UNO R4 TFT 1,8 | Oui | v1 | testé avec succès |
| UNO R4 TFT 2,8 tactile | Oui dans le code | v1 | vote/calcul non testé matériellement |

Le cas à corriger en priorité si l'objectif est « tous les appareils recalculent » est donc l'ancien firmware **ESP8266 e-ink 2,7 BW seul**, qui n'implémente pas `doValidateV2()`.

Les animations sont volontairement soumises sans objet `v2`. Même lorsque leur lecture est dynamique sur TFT/OLED, leur consensus est encore un écho v1. **Affichage dynamique opérationnel et validation dynamique sont deux sujets différents.**

## 5. Vote, signature et quorum réellement en place

### 5.1 Vote v2

Le message signé contient :

```text
pod-vote-v2|deviceId|candidateId|rawHash|metricsVersion|e|t|r|verdict
```

La signature Ed25519 d'un vote v2 est vérifiée obligatoirement côté serveur, indépendamment de l'option `STRICT_SIGNATURE`. Le vote v1 reste en revanche compatible avec un mode permissif tant que cette option n'est pas activée.

Le motif textuel d'un rejet (`reason`) n'est pas dans le message signé. Le verdict l'est, mais pas son explication. Pour une preuve durable, le futur format doit signer aussi un code de règle et un motif canonique.

### 5.2 Atomicité

L'enregistrement principal des votes utilise un script Lua Redis atomique : un appareil ne peut pas facilement voter deux fois et deux votes simultanés ne s'écrasent plus. Un chemin de repli historique, non atomique, existe encore si `EVAL` échoue.

### 5.3 Quorum actuel

Le seuil numérique est `ceil(tailleDuPool × 0,51)` et compte les approbations. Deux options changent fortement la solidité réelle :

| Option | Défaut dans le code | Conséquence |
|---|---|---|
| `MIN_V2_APPROVALS` | `0` | un candidat v2 peut être finalisé uniquement avec des échos v1 |
| `ENFORCE_V2_REJECTIONS` | `false` | un refus v2 est observé mais ne bloque pas le candidat |
| `PIN_DEVICE_KEY` | `false` | la clé publique d'un identifiant matériel peut être remplacée lors d'un nouvel enregistrement |
| `STRICT_SIGNATURE` | permissif pour v1 | les anciens votes restent moins forts que les votes v2 |

Le dépôt ne permet pas de connaître la valeur réellement déployée dans Vercel. Elle doit être archivée avec chaque protocole d'essai. Pour affirmer qu'un bloc résulte d'un vrai recalcul, `MIN_V2_APPROVALS` doit être strictement positif, puis évoluer vers un comité exclusivement v2.

### 5.4 Identité et droit de vote

Aujourd'hui le vote est essentiellement **par appareil**, pas par personne ou profil. Un artiste possédant cinq appareils peut donc peser davantage qu'un artiste en possédant un. Les appareils de l'auteur ne sont pas explicitement exclus du comité.

Autre incohérence à traiter : le pool de quorum compte les appareils actifs et appairés, alors que la route de validation accepte un appareil enregistré et actif sans imposer le même critère d'appairage. Le droit de recevoir un travail et le droit de voter doivent être définis par une seule fonction partagée.

## 6. « Taux de menteurs » : état réel

Il n'existe pas encore de taux de menteurs persistant.

Le code sait seulement marquer `suspect` un rejet v2 qui invoque une divergence de hachage ou de métriques alors que les valeurs envoyées correspondent exactement à celles du serveur. Ce drapeau vit dans le vote du candidat. Les votes détaillés ne sont pas conservés comme reçus signés dans le bloc final et sont supprimés avec l'état du candidat. Il n'existe ni compteur historique par profil, ni score de réputation, ni pénalité.

Une future métrique ne doit jamais qualifier de menteur un appareil simplement parce qu'il est minoritaire. Seuls les événements objectivement prouvables doivent compter :

- signature invalide ;
- acceptation avec hachage ou métriques faux ;
- rejet pour divergence alors que toutes les valeurs signées sont identiques ;
- réponse mal formée ou hors version, à distinguer d'une panne réseau ;
- timeout, suivi séparément mais jamais assimilé à un mensonge.

Proposition : maintenir au niveau du **profil** des compteurs `validAccept`, `validReject`, `falseAccept`, `falseReject`, `invalidSignature` et `timeout`. Un taux d'invalidité ne devient visible qu'après un échantillon minimal et doit décroître dans le temps. La mise à jour doit être agrégée une seule fois lors de la finalisation, par script ou hash Redis, sans nouveau polling.

## 7. Comparaison avec une blockchain IoT distribuée

| Propriété | PoD actuel | Réseau distribué cible |
|---|---|---|
| Chaînage cryptographique des blocs | Oui | Oui |
| Calcul indépendant sur objets fixes | Oui, v2 selon firmware | Oui, obligatoire |
| Votes signés | Oui en v2 | Oui, reçus conservés |
| Registre répliqué | Non, Redis est l'unique registre | Au moins plusieurs réplicas/auditeurs |
| Sélection de comité vérifiable | Non | Oui, déterministe ou VRF |
| Unité de pouvoir résistante au multi-équipement | Non | Un vote par identité/profil éligible |
| Auteur exclu du comité | Non | Oui |
| Tolérance byzantine explicite | Non, majorité 51 % | Règle documentée, idéalement 2/3 |
| Vérification publique d'un ancien bloc | Partielle | Bloc + reçus signés + règles versionnées |
| Consensus animations | Non, v1 | Racine/frames/replay vérifiés |
| Anti-rollback et mise à jour signée | Non | Oui |

La chaîne actuelle n'est pas « fausse » : elle garantit bien qu'une modification d'un ancien contenu change les hachages descendants. Sa faiblesse est organisationnelle, pas mathématique : un serveur unique décide et stocke, et la preuve complète du quorum n'est pas embarquée dans le bloc.

Le `votesSummary` n'est pas inclus dans le hachage canonique du bloc. Le bloc conserve des identifiants de validateurs, mais pas les reçus signés complets. Un observateur externe ne peut donc pas vérifier rétrospectivement que le quorum a réellement approuvé les octets annoncés.

La sélection du « mineur » utilise actuellement `Math.random()` côté serveur avec une pondération inverse du nombre de blocs déjà minés. Elle améliore une forme d'équité d'affichage, mais elle n'est ni reproductible ni vérifiable par les appareils. Certains commentaires parlent du votant déclencheur alors que le code choisit un appareil aléatoire pondéré : le vocabulaire doit être corrigé.

Enfin, l'observation secondaire via `/api/obs-confirm` ne recalcule pas réellement le bloc : le firmware renvoie les hachages que le serveur lui a fournis. Elle atteste une réception, pas une vérification indépendante de la chaîne ou des actions.

## 8. Proposition de consensus PoD v3

### 8.1 Principe

Tous les appareils doivent exécuter le **même noyau minimal objectif**. La puissance supplémentaire ne doit pas donner le droit de changer la vérité ni nécessairement augmenter le poids du vote ; elle doit produire des attestations complémentaires.

Niveaux proposés :

- **C0 — ESP8266** : format, longueur, SHA-256, métriques déterministes, règles de base ;
- **C1 — UNO R4** : même noyau obligatoire, plus parsing de scène/animation et statistiques optionnelles ;
- **C2 — Raspberry Pi, navigateur ou serveur auditeur** : replay complet, racine de frames, conservation/mirroring de chaîne, audit historique.

Un résultat n'est valide que si le noyau C0 est identique sur toutes les plateformes. Les attestations C1/C2 enrichissent la confiance, sans créer deux vérités selon le matériel.

### 8.2 Comité raisonnable à court terme

Une évolution réaliste, sans prétendre immédiatement à un pair-à-pair complet :

1. comité borné, par exemple sept profils au maximum ;
2. auteur exclu ;
3. un vote par profil éligible, quel que soit le nombre d'écrans ;
4. sélection déterministe à partir du hachage du bloc précédent et du candidat ;
5. seuil de 2/3 pour les décisions byzantines ;
6. bloc final contenant les reçus signés ou une racine de Merkle qui les engage ;
7. mode « bootstrap » clairement affiché si le réseau n'a pas assez d'identités indépendantes.

Un PBFT pair-à-pair complet serait trop coûteux et complexe à ce stade : ses échanges croissent fortement avec le nombre de nœuds. Le serveur peut rester coordinateur dans une première version, tant que la sélection et les preuves deviennent vérifiables. Une VRF normalisée peut être étudiée plus tard pour rendre le tirage du comité encore plus robuste.

## 9. Faisabilité de `consensusPoD.h`

La faisabilité est **élevée** et le dépôt contient déjà le début de cette séparation avec `pod_metrics.h`, `pod_vote_esp.h` et `pod_vote_r4.h`. Le risque actuel est la dérive entre copies de firmwares, même si un test contrôle leur synchronisation.

Le fichier public ne doit pas devenir un énorme en-tête Arduino gérant à la fois Wi-Fi, écran, JSON et consensus. Il doit rester un noyau portable, sans `String`, sans allocation dynamique et sans dépendance à un écran :

```cpp
pod_init(ctx, profile, expectedBytes, announcedHash);
pod_feed(ctx, bytes, length);
pod_finalize(ctx, result);
pod_verdict(result, rulesVersion);
pod_build_vote_message(result, identity, candidate, output);
```

Organisation recommandée :

```text
consensus-pod/
  consensusPoD.h                 noyau entier, profils et règles
  consensusPoD_vectors.h         vecteurs de test officiels
  crypto_esp8266.h               SHA-256 / Ed25519 BearSSL
  crypto_uno_r4.h                adaptateur ArduinoCrypto
  crypto_posix.h                 Raspberry Pi et tests
  transport_http_arduino.h       optionnel, hors consensus
  examples/
  LICENSE
  SPEC.md
```

Chaque changement des pixels, métriques, règles ou message signé impose une version distincte. La bibliothèque doit être publiée avec des vecteurs d'or : buffers, SHA-256, métriques et vote attendu. Une implémentation qui ne passe pas ces vecteurs ne peut pas annoncer la capacité correspondante.

### 9.1 Nœuds sans écran

Oui, un appareil peut participer au consensus sans calculer ni afficher un dessin. La route de validation est déjà essentiellement indépendante de l'écran physique. Il faudra néanmoins introduire proprement :

- un rôle/capacité `validator` ;
- `screens: []` au lieu d'inventer un faux écran ;
- la classe matérielle et les niveaux C0/C1/C2 ;
- des règles d'éligibilité communes ;
- un vote par profil afin que des validateurs bon marché ne créent pas une attaque Sybil.

Les Raspberry Pi pourront ensuite devenir des validateurs C2 et des miroirs de chaîne, sans bloquer la finalisation actuelle des ports ESP/R4.

## 10. Mise à jour distante : faisabilité et architecture

### 10.1 Verdict

- **ESP8266 : faisable**, après un premier flash USB. Le cœur Arduino ESP8266 fournit l'OTA et sait faire des mises à jour HTTP. Il faut vérifier l'espace de partition, car la mémoire flash doit généralement accueillir l'ancien et le nouveau binaire pendant l'opération.
- **UNO R4 WiFi : faisable**, avec la bibliothèque officielle `OTAUpdate`. L'exemple officiel télécharge, vérifie puis installe une image et permet de définir un certificat CA. Il faut encore réaliser un prototype sur chacune de nos variantes et éprouver la récupération après coupure.

La faisabilité ne vaut pas validation de production. L'ESP8266 ne possède ni chiffrement de flash ni racine matérielle de confiance équivalente à un secure boot moderne. Une personne ayant l'accès physique peut lire ou modifier la flash. L'objectif réaliste est d'empêcher une mise à jour réseau non autorisée, pas de résister à une attaque physique de laboratoire.

### 10.2 Architecture recommandée sans exploser les quotas

Le manifeste de mise à jour doit être ajouté à la **réponse `/api/pull` déjà existante**. Aucun nouveau polling, aucune clé Redis lue à chaque boucle :

```json
{
  "version": "3.0.1",
  "sequence": 12,
  "board": "uno-r4-wifi",
  "variant": "eink29bwr",
  "minBoot": 1,
  "size": 123456,
  "sha256": "…",
  "url": "https://…/immutable-release.bin",
  "rollout": 10,
  "signature": "…"
}
```

Le manifeste et les binaires peuvent vivre comme fichiers statiques immuables sur CDN ou dans une GitHub Release. Redis ne stocke au maximum qu'un petit pointeur de version mis en cache côté serveur, ou rien si le manifeste est fourni par la configuration de déploiement.

Processus appareil :

1. vérifier carte, variante d'écran, version minimale et séquence monotone ;
2. n'agir que lorsque l'appareil est inactif et correctement alimenté ;
3. télécharger par HTTPS ;
4. vérifier la taille, le SHA-256 et une signature du projet avant écriture ;
5. installer puis redémarrer ;
6. reporter le résultat dans le prochain échange normal ;
7. garder le flash USB comme procédure de récupération.

La clé publique de mise à jour doit être incluse au premier flash. Les identifiants Wi-Fi restent saisis localement par l'utilisateur, stockés hors de l'image applicative et ne sont jamais publiés ni remplacés par OTA. Les artefacts ne doivent pas être téléchargés depuis la branche `main`, mais depuis des versions immuables et signées.

L'ESP8266 utilise aujourd'hui `setInsecure()` pour ses connexions TLS. C'est insuffisant pour faire confiance au seul transport d'une mise à jour. Même après amélioration TLS, le binaire et son manifeste doivent être signés et vérifiés indépendamment. Les standards IETF SUIT donnent le bon modèle : identité du fournisseur et de la classe matérielle, digest, séquence anti-rollback, conditions d'installation et signature.

### 10.3 Déploiement prudent

Commencer par : un canari par famille, 10 % des appareils, fenêtre de maintenance, puis élargissement. Une mise à jour ne doit jamais interrompre l'affichage d'une œuvre ou un vote. Il faut tester la coupure de courant à chaque étape sur table avant d'activer l'OTA publique.

## 11. Cartels e-ink et image utile

Les firmwares ajoutent aujourd'hui les cartels **après** le téléchargement et le calcul du buffer de l'œuvre. Sur le 2,9 pouces paysage, environ 13 px en haut et 14 px en bas sont occupés, laissant près de 100 px utiles sur 128. Sur le 2,7 pouces, la zone utile est d'environ 148 px sur 176.

Deux problèmes en résultent :

1. le cartel peut masquer une partie de l'œuvre ;
2. les pixels réellement affichés ne sont plus exactement ceux dont le hachage a été voté.

### 11.1 Solution immédiate, sans reflash

Pour les rendus e-ink, ajuster côté serveur l'œuvre dans une **safe area** centrale en conservant son ratio, puis laisser des marges blanches destinées aux cartels. Le firmware actuel superpose alors ses textes sur les marges. Cette solution change le rendu canonique envoyé, mais ne demande pas de reflasher les appareils.

### 11.2 Solution propre

Après introduction de l'OTA, proposer par appareil :

- `fit` — recommandé : œuvre redimensionnée entre les cartels ;
- `overlay` — comportement actuel ;
- `hidden` — plein écran sans cartel.

Pour préserver l'intégrité cryptographique, le serveur devrait construire le buffer final déterministe, cartel inclus, et distinguer :

- `artworkHash` : œuvre originale ;
- `renderHash` : pixels réellement envoyés et affichés ;
- `layoutVersion` : règles de mise en page et de cartel.

Le vote porte sur `renderHash`. Le firmware ne modifie plus les pixels après le calcul. L'aperçu de réglage peut être intégré au setup et la préférence transmise dans `/api/pull`, sans nouvelle boucle réseau.

## 12. Problèmes et étrangetés consignés

### Priorité 0 — avant d'affirmer un consensus v2 généralisé

1. ESP8266 e-ink 2,7 BW seul toujours en v1.
2. Toutes les animations encore en v1.
3. Critères d'éligibilité incohérents entre pool et route de validation.
4. Vote par appareil et appareils de l'auteur non exclus.
5. `MIN_V2_APPROVALS=0` et refus non bloquants par défaut.
6. Reçus signés non conservés dans le bloc ; historique détaillé supprimé.
7. Pinning de clé désactivé par défaut ; réenregistrement possible avec remplacement de clé.

### Priorité 1 — solidité et honnêteté des preuves

1. `reason` non signé.
2. Observation de bloc sans recalcul indépendant.
3. Mineur choisi par hasard serveur non reproductible.
4. « vide » confondu avec toute image uniforme.
5. TLS ESP8266 configuré avec `setInsecure()`.
6. Cartels e-ink ajoutés après le hachage du rendu.
7. Documentation de versions et avertissements « non testés » désormais en retard sur les essais réels.

### Priorité 2 — maintenance

1. Copies multiples des en-têtes de consensus dans les sketches.
2. Commentaire e-ink 2,7 contenant encore une ancienne valeur `114`, alors que le calcul utilise correctement la hauteur réelle.
3. Test différentiel C++ impossible à relancer sur le poste de cet audit : le harnais doit afficher la commande et stderr de compilation.

## 13. Feuille de route proposée

### Étape A — figer et prouver la victoire actuelle

- archiver les versions de firmware et variables de déploiement du test ;
- enregistrer une trace série par variante montrant bytes, SHA-256, métriques, verdict et signature acceptée ;
- tester le vote du TFT 2,8 R4 ;
- porter v2 sur l'ESP8266 e-ink 2,7 seul ;
- corriger les avertissements de documentation devenus obsolètes.

### Étape B — bibliothèque commune

- extraire `consensusPoD.h` et ses adaptateurs ;
- publier spécification, licence et vecteurs d'or ;
- exécuter les mêmes vecteurs en TypeScript, C++ ESP8266, C++ R4 et POSIX ;
- ne toucher ni au protocole Redis ni aux écrans pendant cette extraction.

### Étape C — preuve v3

- un vote par profil, auteur exclu, éligibilité partagée ;
- règles versionnées et motif signé ;
- comité déterministe borné et seuil 2/3 ;
- reçus signés engagés dans le bloc ;
- réputation uniquement sur mensonges objectivement prouvables.

### Étape D — animation et nœuds spécialisés

- définir une racine vérifiable pour scène/replay/frames ;
- C0 vérifie manifeste et racine, C1 échantillonne/rejoue, C2 vérifie intégralement ;
- ajouter des validateurs sans écran et des Raspberry Pi miroirs.

### Étape E — OTA et rendu e-ink

- canari OTA ESP8266 puis R4 avec manifeste signé ;
- safe area serveur immédiate ;
- ensuite `artworkHash` / `renderHash` / `layoutVersion` et préférences de cartel.

## 14. Règle de budget immuable

Toutes ces évolutions doivent respecter la contrainte déjà posée : **aucune nouvelle boucle de polling, aucun `SCAN`, aucun coût proportionnel non borné par œuvre ou appareil**.

- Les métadonnées OTA voyagent dans `/api/pull`.
- La réputation est agrégée une fois à la finalisation.
- Les comités sont bornés.
- Les reçus sont écrits avec le bloc, idéalement dans une seule transaction/script.
- Les artefacts lourds sont servis par CDN ou stockage immuable, pas par Redis.
- Les tests de charge utilisent les fixtures locales et non la base Upstash.

## 15. Sources externes de recherche

- ESP8266 Arduino Core, OTA : <https://arduino-esp8266.readthedocs.io/en/3.1.2/ota_updates/readme.html>
- ArduinoCore-renesas, exemple officiel UNO R4 `OTAUpdate` : <https://github.com/arduino/ArduinoCore-renesas/blob/main/libraries/OTAUpdate/examples/OTA/OTA.ino>
- ArduinoCore-renesas, implémentation `OTAUpdate` : <https://github.com/arduino/ArduinoCore-renesas/tree/main/libraries/OTAUpdate>
- Arduino UNO R4 WiFi et Arduino Cloud/OTA : <https://github.com/arduino/docs-content/blob/main/content/hardware/02.uno/boards/uno-r4-wifi/tutorials/cloud-setup/cloud-setup.md>
- IETF SUIT, architecture de mise à jour IoT, RFC 9019 : <https://www.rfc-editor.org/rfc/rfc9019.html>
- IETF SUIT, manifeste, RFC 9124 : <https://www.rfc-editor.org/info/rfc9124/>
- Ed25519, RFC 8032 : <https://www.rfc-editor.org/info/rfc8032/>
- PBFT, publication originale : <https://www.usenix.org/conference/osdi-99/presentation/practical-byzantine-fault-tolerance>
- VRF, RFC 9381 : <https://www.rfc-editor.org/rfc/rfc9381.html>
- Sécurité matérielle ESP8266, FAQ Espressif : <https://docs.espressif.com/projects/esp-faq/en/latest/software-framework/security.html>
- NIST Lightweight Cryptography / Ascon, piste future pour des primitives légères : <https://csrc.nist.gov/projects/lightweight-cryptography>

## 16. Conclusion à comparer avec l'audit Claude

Le jalon matériel peut être validé sous une formulation précise :

> **PoD sait faire recalculer et signer par plusieurs ESP8266 et UNO R4 l'intégrité et la complexité d'une œuvre fixe, avec un vote atomique côté serveur.**

Il ne faut pas encore annoncer :

- que toutes les variantes recalculent ;
- que les animations sont validées ;
- qu'un taux de menteurs est opérationnel ;
- que PoD est une blockchain distribuée ou un consensus résistant aux identités multiples.

La suite logique n'est pas d'ajouter immédiatement des calculs plus lourds. Elle est d'abord de **figer un noyau portable `consensusPoD.h`, rendre le comité et les preuves auditables, puis ajouter des niveaux de calcul C1/C2**. L'OTA et le rendu e-ink peuvent progresser en parallèle à condition de rester adossés au pull existant et à des artefacts signés.
