# Reprise du 06/10/2026 — validation réelle et page Réseau

Cette note est le point de départ commun pour le porteur du projet et Claude. Elle complète
`CHANTIER_VALIDATION_REELLE.md` et `SESSION_2026_10_05_CLOTURE.md` ; elle ne les remplace pas.

## 1. Décision courte

Le chantier de validation réelle peut continuer, mais **pas en déploiement aveugle**.

- P0 est partiel : l'identité et l'éligibilité des votants ne sont pas encore sécurisées.
- P1 et P2 constituent une bonne base technique.
- P3 e-ink 2,9 pouces est un **canari non testé sur carte**.
- Aucun mode strict ne doit être activé avant les barrières ci-dessous.
- Le produit ne doit pas présenter un vote hérité v1 comme une validation N1/N2.

## 2. Décisions de conception retenues par défaut

À utiliser tant que le porteur ne demande pas explicitement autre chose :

1. réseau trop petit : mode `bootstrap` autorisé, mais affiché comme **validation partielle** ;
2. comité : 7 profils maximum, seuil d'approbation de 2/3 ;
3. une voix par profil éligible, quel que soit son nombre de cartes ;
4. profil auteur exclu du comité de son œuvre ;
5. appairage obligatoire et 24 heures d'ancienneté minimum ;
6. règles N2 uniquement objectives : intégrité, format, image uniforme, bruit, limites techniques ; jamais de jugement esthétique ;
7. firmware v1 conservé comme afficheur, mais plus comme validateur après la bascule stricte ;
8. réinitialisation de clé uniquement depuis une session authentifiée du profil propriétaire ;
9. Raspberry Pi, navigateur et PC commencent comme auditeurs N3 non bloquants.

Une voix par profil réduit le Sybil par multiplication des ESP, mais ne supprime pas le Sybil par
création de profils. Avant P5, documenter aussi les critères d'éligibilité du profil : ancienneté,
appairage vérifié et activité minimale.

## 3. Barrières obligatoires avant extension aux autres firmwares

### G1 — Rejets v2 sans pouvoir de blocage pendant le canari

Pendant la transition, un rejet v2 doit être enregistré et observable, mais ne doit pas supprimer
un candidat tant que P0 n'est pas terminé et que les métriques n'ont pas été validées sur matériel.
Le mélange actuel « approbations v1 cosmétiques + rejets v2 bloquants » n'a pas de sémantique sûre.

Prévoir un interrupteur serveur explicite, désactivé par défaut, par exemple
`ENFORCE_V2_REJECTIONS=false`. Ne l'activer qu'avec un comité exclusivement v2.

### G2 — Votes atomiques

Corriger la course de `castVote` avant tout essai multi-appareils. Deux votes simultanés ne doivent
jamais s'écraser. Utiliser une écriture Redis atomique par candidat et votant (`HSET`/script), avec
TTL et finalisation idempotente. Écrire le coût Redis exact avant le code.

### G3 — P0 réellement terminé

- clé épinglée avec procédure de récupération propriétaire ;
- vote compté par profil ;
- auteur exclu ;
- appareil et profil éligibles contrôlés côté serveur ;
- tests d'usurpation, rejeu, double vote et Sybil ;
- aucun `deviceId` déclaré par le client ne doit suffire à obtenir un poids de vote.

### G4 — Parité numérique prouvée

Installer ou fournir `g++`, puis exécuter le test différentiel TypeScript/C++ sur tous les vecteurs.
Une compilation croisée réussie ne remplace pas ce test. Tolérance : zéro ppm pour les métriques
entières et hash identique octet par octet.

### G5 — Canari matériel e-ink 2,9 pouces

Sur une seule carte, relever et conserver :

- `[VALIDATE2]` complet ;
- `[MEM]` avant et après ;
- durée de téléchargement/calcul ;
- `Vote OK` ;
- un refus forcé par modification d'un octet ;
- toute réponse 403/422 et les journaux Vercel correspondants.

Ne porter P3 aux e-ink 2,7 pouces, OLED et TFT qu'après ce résultat. Passer ensuite à la R4, une
famille matérielle à la fois.

## 4. Déploiement autorisé et interdit

### Autorisé avec surveillance

- déployer le serveur compatible v1/v2 ;
- laisser `PIN_DEVICE_KEY=false` et `STRICT_SIGNATURE=false` pendant la migration ;
- observer les signatures v1 dans les journaux ;
- tester un firmware v2 canari avec les rejets non bloquants ;
- mesurer les commandes Redis et la bande passante par candidat.

### Interdit pour l'instant

- reflash généralisé ;
- comité mixte v1/v2 présenté comme validation réelle ;
- activation globale de `STRICT_SIGNATURE` ou `PIN_DEVICE_KEY` ;
- rejets v2 bloquants avant G1–G5 ;
- promesse publique de N3 vérifié par le réseau ;
- activation d'un comité non borné ou sollicitation de tous les appareils par œuvre.

## 5. Invariant Redis/Upstash

Cette règle reste absolue pendant tout le chantier : aucun changement ne doit augmenter le trafic
Redis sans budget écrit et testable.

- comité borné à 7 profils ;
- pas de `SCAN` ;
- lectures groupées ;
- une écriture atomique par vote ;
- TTL sur candidat, votes, verrous et données de canari ;
- aucun polling supplémentaire côté page Réseau ;
- fixture `?fixture=` pour les essais de charge, jamais Redis réel ;
- mesure des commandes par candidat avant activation en production.

## 6. Ordre de reprise conseillé à Claude

1. Lire cette note, `CHANTIER_VALIDATION_REELLE.md`, `SESSION_2026_10_05_CLOTURE.md` et `CLAUDE.md`.
2. Ajouter le mode observation des rejets v2 et ses tests.
3. Rendre `castVote` atomique avec tests concurrents et budget Redis documenté.
4. Terminer P0 : profil, auteur, éligibilité, récupération de clé.
5. Exécuter le différentiel C++/TypeScript.
6. Faire le canari physique 2,9 pouces avec le porteur.
7. Seulement ensuite : autres ESP8266, R4, puis comité P5 et audit P6.

## 7. Sécurité Git

Le fichier local `esp8266/esp_tft1.8/esp_tft1.8.ino` est modifié et peut contenir des identifiants
Wi-Fi. Il ne doit jamais être ajouté à un commit.

- ne jamais utiliser `git add .` ni `git add -A` ;
- ajouter chaque fichier par son chemin explicite ;
- contrôler `git diff --cached --name-only` avant chaque commit ;
- ne pas pousser de firmware marqué « non testé » comme firmware recommandé.

## 8. Page Réseau — état de reprise

La vue historique **Topologie** reste conservée. La nouvelle **Constellation** utilise un zoom
sémantique : zones de navigation, artistes, appareils, écrans, puis œuvres. Les zones sont des
repères visuels et non des groupes sociaux. Les vignettes restent réservées aux écrans confirmés,
à la sélection ou au niveau de zoom le plus proche.

À vérifier avant le prochain commit Réseau :

- le clic sur une zone ouvre le niveau artistes ;
- la sélection d'un appareil ne réinitialise pas le zoom ;
- les appareils hors champ sont bien éliminés du DOM ;
- les vignettes ne chargent qu'à la sélection ou au niveau Œuvres ;
- Topologie et Constellation restent toutes deux accessibles ;
- tests à `fixture=1, 20, 100, 500`, ordinateur et mobile ;
- aucune requête client ni commande Redis supplémentaire.

## 9. Critère de fin du chantier validation

Le chantier ne sera qualifié de « validation réelle » que lorsqu'un bloc pourra être vérifié hors du
serveur avec : votes v2 signés, profils éligibles indépendants, auteur exclu, vote atomique, comité
rejouable, métriques identiques sur matériel, niveau d'assurance affiché et vérificateur public.
