# Plan maître de collaboration — PoD robuste, vérifiable et évolutif

**Version : 1.0 — 6 octobre 2026**  
**Base de départ : `75878d3`**  
**Périmètre : Proof of Draw, liaison ANA → PoD, firmwares ESP8266 / UNO R4, futur Raspberry Pi et explorateur PoDScan**  
**Statut : contrat de pilotage et feuille de route ; il n'autorise aucun déploiement**

Ce document rassemble les décisions des audits indépendants GPT et Claude. Il devient le point d'entrée commun pour les prochains chantiers. Les documents techniques spécialisés restent les références de détail ; en cas de contradiction, le constat le plus récent et vérifié dans le code prévaut, puis l'arbitrage du porteur.

## 1. Gouvernance : qui décide, qui pilote, qui code

### Le porteur du projet — direction et validation réelle

Le porteur :

- fixe la finalité artistique et produit ;
- arbitre les choix qui changent l'expérience, la sécurité ou le coût ;
- décide quand pousser, déployer ou activer une variable de production ;
- conserve les secrets, les accès Vercel, Upstash, Neon et les clés de publication ;
- réalise ou organise les essais sur le matériel réel ;
- donne le feu vert entre deux lots.

Ni GPT ni Claude ne poussent, ne déploient, n'activent un mode strict ou ne changent une infrastructure sans demande explicite du porteur.

### GPT — pilote technique et auditeur

GPT :

- tient la feuille de route, l'ordre des dépendances et les critères d'acceptation ;
- transforme chaque étape en fiche de travail bornée pour Claude ;
- vérifie le coût Redis/Neon **avant** l'implémentation ;
- audite le commit livré par Claude dans le code réel, sans se limiter à son compte rendu ;
- relance les tests pertinents et recherche les régressions, secrets, dérives de protocole et sur-promesses documentaires ;
- classe le lot `ACCEPTÉ`, `ACCEPTÉ SOUS RÉSERVE`, `CORRECTIONS REQUISES` ou `BLOQUÉ` ;
- maintient la cohérence entre protocole, firmware, interface publique et documentation ;
- propose le lot suivant seulement après fermeture ou acceptation explicite des réserves du lot courant.

GPT peut corriger directement une erreur urgente si le porteur le demande. Par défaut, il n'édite pas les mêmes fichiers que Claude pendant un lot actif : il audite, puis rédige la demande de correction.

### Claude — implémentation et preuve d'exécution

Claude :

- implémente un seul lot cohérent à la fois ;
- commence depuis le commit de base donné par GPT ;
- ne mélange pas une refonte opportuniste ou un autre chantier ;
- écrit les tests, le budget et la documentation correspondant au code ;
- crée une sauvegarde avant tout changement de firmware ;
- compile et exécute les validations disponibles ;
- termine par un commit local et un rapport factuel : hash, fichiers, tests, mesures, budget, limites et éléments non testés ;
- attend l'audit GPT et la décision du porteur avant d'enchaîner sur un lot dépendant.

### Principe de séparation

```text
Porteur : décide, teste le matériel, déploie et publie
    ↓
GPT : spécifie le lot, pilote, audite et accepte/refuse
    ↓
Claude : code, teste, documente et commit localement
    ↓
GPT : relit le diff réel et produit le rapport d'audit
    ↓
Porteur : donne le feu vert, pousse/déploie, puis transmet le résultat réel
```

## 2. Cycle obligatoire d'un lot

### 2.1 Fiche de départ préparée par GPT

Chaque fiche contient :

1. commit de base et état attendu du dépôt ;
2. objectif unique et non-objectifs ;
3. fichiers probablement concernés ;
4. protocole et compatibilité à préserver ;
5. budget Redis, Neon, réseau et mémoire ;
6. tests automatiques et matériels ;
7. stratégie de rollback ;
8. documents à mettre à jour ;
9. critères exacts de fin.

Une tâche qui touche Redis ou Neon sans budget écrit est incomplète et ne doit pas être codée.

### 2.2 Livraison Claude

Le rapport de fin doit utiliser ce format :

```text
Commit :
Objectif livré :
Fichiers modifiés/créés :
Migrations ou variables :
Coût Redis avant/après :
Coût Neon avant/après :
Mémoire/flash mesurées :
Tests exécutés et résultats :
Essais matériels : testé / compilé seulement / non testé :
Risques ou étrangetés découverts :
Rollback :
```

### 2.3 Audit GPT

GPT contrôle au minimum :

- portée réelle du diff et absence de changements étrangers au lot ;
- invariants de sécurité, mémoire, conversion et quotas ;
- compatibilité des anciens firmwares et blocs ;
- tests annoncés comparés aux commandes et sorties réelles ;
- cas hostiles et chemins d'erreur ;
- documentation conforme à l'état du code ;
- statut matériel honnête ;
- absence de secret ou clé privée ;
- coût à 1, 10, 100 et 500 appareils lorsque le changement dépend de l'échelle.

Le rapport d'audit doit séparer :

- **bloquant avant merge/déploiement** ;
- **à corriger dans le lot suivant** ;
- **amélioration facultative** ;
- **inconnu nécessitant un essai matériel ou de production**.

### 2.4 Porte de sortie

Un lot n'est « terminé » que si :

- ses tests automatiques sont verts ou les exceptions sont expliquées ;
- le budget est documenté ;
- le rollback existe ;
- les éléments non essayés portent explicitement la mention « non testé » ;
- GPT l'a audité ;
- le porteur a accepté les réserves et, si nécessaire, réalisé le test matériel.

## 3. Règles immuables du projet

### R1 — Quotas Upstash Redis

Redis est une ressource chaude et bornée. La cible opérationnelle actuelle reste **environ 200 000 commandes par mois**, soit **environ 6 700 par jour** pour tout le réseau, avec 500 000 commandes mensuelles comme plafond du plan gratuit et non comme objectif.

Avant chaque changement, écrire :

```text
commandes / appel × appels / heure / acteur × nombre d'acteurs
+ coût par candidat, bloc, affichage ou finalisation
= coût journalier et mensuel estimé
```

Contraintes :

- aucun `SCAN` dans un chemin utilisateur, de pull ou de vote ;
- aucun nouveau polling par appareil si l'information peut voyager dans `/api/pull` ;
- aucun `setInterval` web nu : pause onglet caché, ralentissement au repos et arrêt après inactivité ;
- fixtures locales pour 1/5/20/100/500 appareils, jamais la base réelle pour un test de charge ;
- `MGET`, pipelines ou scripts atomiques pour regrouper, sans perdre l'idempotence ;
- toute donnée éphémère porte un TTL ;
- aucune écriture de présence à chaque pull ;
- médias, images, clips, firmwares et preuves immuables servis par CDN/stockage statique, pas par Redis à chaque lecteur ;
- tout comité est borné ; ajouter des appareils ne doit pas rendre le coût d'un bloc non borné ;
- les fonctions annexes peuvent se dégrader à 80 % du budget, jamais le chemin d'affichage essentiel ;
- une optimisation ne peut pas déplacer silencieusement la dépense vers une autre route.

Référence de mesure : la console Upstash et les journaux Vercel priment sur les estimations. Un changement sensible doit relever la consommation avant/après sur une fenêtre comparable.

### R2 — Quotas Neon et liaison ANA → PoD

La règle est symétrique côté ANA : aucune nouvelle lecture périodique, boucle par écran ou reconstruction complète répétée dans Neon.

- ANA publie une génération/snapshot immuable puis un pointeur atomique ;
- PoD consomme une référence ou un paquet mis en cache, pas une série de requêtes Neon ;
- une œuvre est normalisée une fois, puis distribuée depuis PoD/CDN ;
- aucune requête PoD ne doit déclencher une requête Neon par appareil ;
- un échec de reconstruction conserve le dernier snapshot valide ;
- tout nouveau flux ANA → PoD annonce le nombre de requêtes Neon par publication et de commandes Redis par destinataire ;
- les tests d'échelle utilisent des fixtures, pas Neon ou Upstash de production.

La protection des quotas Neon et Redis est **immuable pendant tout le chantier**, y compris OTA, consensus, animation, PoDScan et futurs nœuds Raspberry Pi.

### R3 — Firmware et mémoire

- sauvegarde obligatoire dans `firmware-backups/<date>/` avant toute modification d'un `.ino` ;
- jamais de SSID, mot de passe, token, clé privée OTA ou secret suivi par Git ;
- ESP8266 : libérer les buffers d'image avant TLS, fermer TLS avant de les réallouer ;
- tous les gros contenus sont lus en flux ; pas d'image complète supplémentaire en RAM ;
- `http.useHTTP10(true)` reste obligatoire pour les GET streaming ESP8266 ;
- `/api/pull` et `/api/validate-candidate` ne transportent jamais les buffers de pixels en JSON ;
- UNO R4 : pas de gros tableau local sur la pile principale ; tampons statiques contrôlés ;
- une fonctionnalité seulement compilée n'est jamais déclarée « testée » ;
- les logs série de validation doivent exposer version, octets, durée, métriques, verdict et mémoire libre sans secret.

### R4 — Sécurité et identité

- signature obligatoire pour toute nouvelle version de vote ;
- un vote doit être lié au candidat, au contenu, à la version des règles et, pour v3, à la position de chaîne ;
- une clé publique déjà épinglée ne peut pas être remplacée silencieusement ;
- inscription et récupération de clé utilisent un défi signé ou une autorisation du profil ;
- auteur exclu du comité ; un vote par profil éligible ; appareils non appairés non éligibles ;
- aucun taux de « menteurs » fondé sur un désaccord subjectif : uniquement des contradictions cryptographiquement démontrables ;
- les clés de signature OTA restent hors dépôt et hors Vercel ;
- `setInsecure()` ne suffit jamais pour l'OTA : artefact et manifeste doivent être signés et vérifiés ;
- aucune clé Wi-Fi n'est distribuée par OTA.

### R5 — Honnêteté de la documentation

Quatre statuts seulement :

- **vérifié dans le code et les tests** ;
- **compilé** ;
- **essayé sur matériel** ;
- **hypothèse/proposition**.

Ne jamais employer « blockchain décentralisée », « consensus distribué », « taux de menteurs » ou « preuve de dessin humain » tant que leurs critères publics ne sont pas atteints. Aujourd'hui, la formulation correcte reste : **chaîne centralisée liée par hachage avec attestations distribuées signées pour les images fixes v2**.

### R6 — Compatibilité, historique et rollback

- aucun ancien bloc n'est réécrit ;
- tout changement de métriques, message signé, règles, rendu ou bloc incrémente sa version ;
- coexistence v1/v2/v3 documentée et limitée dans le temps ;
- bascules strictes par capacité/version de firmware et variables réversibles ;
- un ancien appareil peut rester afficheur même s'il cesse d'être validateur ;
- pas de bascule stricte tant que le parc réel n'est pas compatible ;
- toute finalisation reste idempotente et atomique.

### R7 — Architecture existante

- pas de réécriture globale de l'application ni de refonte opportuniste ;
- pas de nouvelle base de données pour remplacer Redis ;
- pas d'état critique en mémoire Vercel ;
- pas de cron nécessaire au chemin essentiel ;
- pas de fetch serveur vers une IP locale ;
- conversions d'écran uniquement par les encodeurs de référence testés ;
- moteur de dessin unique, déterministe, sans duplication ;
- affichage, consensus, transport et identité doivent devenir des couches séparées sans casser l'existant.

### R8 — Git, tests et déploiement

- un lot = un ou plusieurs commits cohérents et explicitement ordonnés ;
- ne jamais écraser les changements non liés du porteur ou de l'autre agent ;
- `npm test`, `npx tsc --noEmit`, tests différentiels C++ et tests de copies d'en-têtes selon la portée ;
- compilation de chaque firmware touché et mesures mémoire avant de le qualifier ;
- pas de push, déploiement, activation de variable ou migration destructive sans le porteur ;
- les tests de production sont des canaris bornés, jamais une activation globale immédiate.

## 4. Feuille de route maîtresse

L'ordre ci-dessous minimise les doubles reflashes et empêche de bâtir PoDScan ou les nœuds Raspberry sur un protocole encore mouvant.

### Lot 0 — Fermer proprement le jalon images fixes

**Implémentation Claude**

1. Porter le vote v2 sur l'ESP8266 e-ink 2,7 BW seul.
2. Conserver exactement `pod-metrics-2` et le message v2 actuel.
3. Ne changer aucune route ni aucun coût Redis.
4. Compiler, synchroniser les en-têtes et documenter « non testé » jusqu'au test réel.

**Audit GPT**

- diff firmware, gestion du tas/TLS, parité des en-têtes, version déclarée, absence de secret ;
- tests différentiels et non-régression ;
- protocole de test matériel court.

**Validation porteur**

- flash et trace série ;
- vote sur au moins un dessin non uniforme ;
- confirmation de l'affichage ;
- essai séparé TFT 2,8 R4 vote/calcul encore manquant.

**Fin du lot** : toutes les variantes fixes annoncées disposent du code v2 ; le statut testé/non testé est exact.

### Lot 1 — Rendre chaque nouveau bloc vérifiable hors serveur

**Objectif** : fermer le défaut principal avant tout discours blockchain.

- définir `Block v3` sans modifier les blocs historiques ;
- signer `parentHash`, `rulesVersion` et un motif canonique ;
- conserver les reçus signés ou leur racine engagée dans `blockHash` ;
- fournir un vérificateur Node pur qui reconstruit le bloc et vérifie chaque signature ;
- corriger le cache 404 du contenu candidat et rendre la finalisation atomique ;
- calculer le coût exact des reçus avec comité borné.

**Critère de fin** : un tiers exporte un bloc v3 et ses preuves, coupe l'accès au serveur, puis vérifie intégralement la finalisation.

### Lot 2 — Fermer l'identité et le droit de vote

- une fonction d'éligibilité commune au pool, à `validate-candidate` et à `validation-result` ;
- appareil appairé à un profil obligatoire ;
- un vote par profil ;
- auteur exclu ;
- pinning de clé et défi-réponse à l'inscription ;
- procédure explicite de récupération/remplacement de carte ;
- correction de l'entropie des nouvelles clés ESP8266/R4 ;
- anciens appareils v1 conservés comme afficheurs, pas comme membres du comité v3.

**Critère de fin** : créer de nombreuses MAC ou appareils pour un même profil ne donne pas davantage de voix et une clé ne peut être remplacée sans autorisation vérifiable.

### Lot 3 — Comité, quorum 2/3 et réputation mesurable

- comité déterministe et rejouable, au plus sept profils ;
- seuil `ceil(2K/3)` ;
- auteur exclu, repli séquentiel pour les absents ;
- mode `bootstrap` visible pour un petit réseau ;
- simulateur local 3/10/100/500 nœuds avec faux votes, silence, clones et partitions ;
- réputation basée uniquement sur les mensonges démontrables ;
- agrégation Redis une fois à la finalisation, sans polling.

La sélection peut d'abord être dérivée de `SHA-256(parentHash || candidateHash || version)` ; une VRF reste une recherche ultérieure. Aucun Proof of Work ne doit être ajouté : un puzzle dimensionné pour un ESP est trivial pour un PC et ne résout pas le Sybil.

**Critère de fin** : résultats de simulation publiés, coût borné, aucune finalisation par des appareils non éligibles, et vocabulaire de tolérance limité aux mesures obtenues.

### Lot 4 — Extraire le noyau `consensusPoD`

L'extraction interne commence une fois les structures v3 figées. La publication GitHub attend le canari v3.

```text
consensus-pod/
  src/consensusPoD.h
  src/metrics.h
  src/vote.h
  adapters/esp8266/
  adapters/uno_r4/
  adapters/posix/
  test-vectors/
  SPEC.md
  library.properties
```

Le noyau :

- ne connaît ni écran, ni Wi-Fi, ni Redis, ni Arduino `String` ;
- n'alloue pas dynamiquement ;
- consomme un flux d'octets et produit une attestation versionnée ;
- expose les mêmes vecteurs d'or en TypeScript, C++ hôte, ESP8266 et R4 ;
- distingue noyau obligatoire C0 et attestations supplémentaires C1/C2.

**Critère de fin** : une seule implémentation du protocole, utilisée par au moins un ESP8266, une R4 et le vérificateur hôte, avec résultats bit à bit identiques.

### Lot 5 — Validation réelle des animations

Ne pas confondre lecture dynamique et consensus dynamique.

- spécifier `pod-anim-v3` : hash du clip, format, géométrie, nombre d'images, cadence, limites et racine des frames ;
- C0/ESP8266 : vérification en flux du clip, structure, bornes et racine accessible sans buffer complet ;
- C1/R4 : mêmes règles plus contrôles de frames selon le budget mesuré ;
- C2/hôte ou Raspberry : replay et vérification complète ;
- signer le résultat et conserver le reçu dans le bloc ;
- télécharger le clip immuable une fois via CDN ; aucune lecture Redis supplémentaire par boucle ou image.

**Critère de fin** : modifier un octet, une durée ou une frame du clip provoque un rejet reproductible sur serveur, C++ hôte et matériel compatible.

### Lot 6 — Rendu e-ink vérifiable et cartels configurables

- afficher immédiatement une zone sûre dans les éditeurs e-ink ;
- définir `artworkHash`, `renderHash` et `layoutVersion` ;
- construire un rendu final déterministe correspondant réellement aux pixels affichés ;
- modes par appareil `fit`, `overlay`, `hidden`, avec `fit` recommandé ;
- transmettre la préférence dans le pull/MGET existant ; zéro nouvelle commande ;
- conserver le ratio et éviter un rééchantillonnage destructeur non annoncé.

**Critère de fin** : le hash de rendu correspond aux pixels effectivement envoyés, cartel compris, et aucune œuvre n'est masquée par défaut.

### Lot 7 — Premier flash universel et OTA signée

Regrouper les changements nécessitant un reflash : portail/provisionnement Wi-Fi, OTA, cartel et bibliothèque de consensus stable.

- prototype ESP8266 sur un canari, mesure tas et taille double image ;
- vérifier le format `.ota`, la nature de `verify()` et la récupération sur UNO R4 ;
- clé de signature hors ligne, clé publique dans le premier firmware ;
- petit pointeur de version dans `/api/pull`, sans commande Redis supplémentaire ;
- manifeste et binaire immuables sur CDN/GitHub Release, téléchargés uniquement si la version change ;
- séquence anti-rollback, ciblage exact carte/écran, canari 1 → 10 % → 100 % ;
- mode manuel par défaut pendant la phase d'essai ;
- conservation locale du Wi-Fi, jamais dans le binaire commun ;
- procédure câble de récupération testée.

**Critère de fin** : coupures de courant testées, mauvais binaire et mauvaise signature refusés, anciens identifiants Wi-Fi conservés, rollback/recovery documenté.

### Lot 8 — Nœuds sans écran, Raspberry Pi et réplication

Ce lot ne commence qu'après stabilité de v3 et de `consensusPoD`.

- rôle `validator` avec `screens: []` ;
- adaptateur Linux/Raspberry Pi ;
- nœuds C2 capables de rejouer, auditer et conserver la chaîne ;
- réplication de la tête et détection de divergence ;
- cosignature de la tête par le comité ;
- ancrage externe optionnel et mesuré ;
- protocole de rattrapage et stockage froid hors Redis pour l'historique lourd.

**Critère de fin** : plusieurs nœuds indépendants reconstruisent la même chaîne, détectent une tête falsifiée et continuent à auditer sans dépendre de l'état volatile d'un seul serveur.

### Lot 9 — PoDScan

PoDScan est construit sur les preuves publiques, pas comme une simple nouvelle interface Redis.

- recherche bloc, œuvre, profil public, validateur et version de protocole ;
- vérification locale des hashes, reçus et quorum ;
- affichage clair du niveau de preuve : bootstrap, v2 centralisé, v3 comité, audit C2 ;
- transparence sur le nombre de validateurs, abstentions et rejets prouvés ;
- données historiques servies par snapshots/stockage froid/CDN ;
- aucune page qui poll Redis ou parcourt toute la chaîne à chaque visite.

**Critère de fin** : un visiteur peut vérifier une preuve sans faire confiance à une affirmation de l'interface et sans augmenter le coût Redis proportionnellement à la longueur de la chaîne.

## 5. Documentation publique « Apprendre »

Claude a reçu la tâche d'ajouter une synthèse exhaustive et une feuille de route en fin de page. Cette livraison doit être un lot séparé du firmware e-ink 2,7 afin de rester auditable.

La page doit distinguer :

1. dessiner et envoyer une œuvre ;
2. ce que l'appareil calcule réellement ;
3. vote, signature, quorum et bloc ;
4. différence entre intégrité du rendu et preuve du geste ;
5. différences images fixes / animations ;
6. état centralisé actuel et objectif distribué ;
7. rôle futur des nœuds Raspberry ;
8. sécurité, limites et respect de la vie privée ;
9. feuille de route `livré / expérimental / prévu / recherche`.

L'interface ne doit jamais transformer une proposition de recherche en fonctionnalité livrée. La feuille de route doit être alimentée par ce document mais reformulée pour un public non expert.

## 6. Ordre immédiat des trois prochaines livraisons

1. **Claude — firmware ESP8266 e-ink 2,7 seul en v2**, commit séparé.
2. **GPT — audit du commit**, puis protocole d'essai matériel pour le porteur.
3. **Claude — synthèse et feuille de route dans Apprendre**, commit séparé, puis audit GPT de l'exactitude technique et de l'accessibilité.

Après ces trois livraisons, GPT prépare la fiche détaillée du **Lot 1 : bloc v3 vérifiable hors serveur**. Aucun développement Raspberry Pi ou PoDScan ne commence avant la fermeture des Lots 1 à 5.

## 7. Décisions réservées au porteur

Les points suivants ne seront jamais tranchés implicitement par GPT ou Claude :

- activation du mode strict et exclusion des validateurs v1 ;
- seuil minimal d'identités en mode bootstrap ;
- taille du comité si différente de sept ;
- publication de la bibliothèque et choix de licence ;
- mise à jour OTA manuelle ou automatique par défaut ;
- emplacement et gardien de la clé privée OTA ;
- mode de cartel par défaut ;
- service d'ancrage externe ;
- budget Upstash/Neon payant éventuel ;
- formulation marketing finale de la technologie.

## 8. Références obligatoires

Avant toute nouvelle fiche ou implémentation, lire selon le lot :

- `CLAUDE.md` et `AGENTS.md` ;
- `docs/PLAN_REDIS_200K.md` ;
- `docs/CHANTIER_VALIDATION_REELLE.md` ;
- `docs/AUDIT_GPT_CONSENSUS_POD_IOT_2026_10_06.md` ;
- `docs/NOTE_CLAUDE_AUDIT_VALIDATION_CONSENSUS_OTA_2026_10_06.md` ;
- `docs/ANIMATIONS_PIPELINE.md` pour l'animation ;
- `docs/NOTE_GPT_ANA_POEMES_GENERATIF.md` et le contrat ANA/PoD pour les échanges interprojets.

Ce document est le contrat d'organisation. Les audits restent la photographie technique détaillée au 6 octobre 2026.
