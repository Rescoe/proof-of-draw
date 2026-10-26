# À faire — petites modifications différées (vivant, mis à jour à chaque tâche)

Règle (demandée par le porteur le 25/10/2026) : **toute demande faite pendant qu'un autre chantier est en cours, et qu'on ne traite pas tout de suite, est consignée ICI, avec la date et la formulation du porteur.** On la traite quand le chantier en cours est fini. Une ligne cochée est une ligne faite (avec le commit). Ne jamais ignorer une demande sans la noter.

## À traiter (par ordre de priorité)

| # | Demandé le | Demande | État |
|---|---|---|---|
| 1 | 25/10 | **Journal d'appareil plus complet** : en plus des échanges vus par le serveur (déjà en production), recevoir les **messages internes de la carte** (ce que le port série affiche) : le firmware enverrait un lot de lignes à chaque pull/heartbeat vers une route `POST /api/device-log` (limite de taille et de débit, même rétention de 7 jours). Sans cela, un blocage côté carte (Wi-Fi, mémoire, e-ink) reste invisible à distance. | à faire |
| 2 | 25/10 | Journal : décider s'il reste **visible du seul propriétaire** (aujourd'hui) ou aussi d'autres personnes (« moi aussi et quiconque ») ; si public, masquer identifiants et adresses. | à décider |
| 3 | 25/10 | **Rejetés** : garder une **trace des votes au moment de l'expiration** (aujourd'hui, les votes disparaissent avec le candidat : seul le nombre de validateurs et le quorum attendu sont notés). Copier le résumé des votes dans la copie d'archive à chaque vote, ou le noter à l'expiration. | à faire |
| 4 | 25/10 | Rejetés : miniature de l'image pour le candidat **encore en attente** (aujourd'hui seulement après rejet ou expiration). | à faire |
| 5 | 25/10 | Afficher **le nom donné ET l'identifiant `dev_…`** dans la vue réseau, la constellation et le panneau latéral (la liste « Mes ESP » les montre déjà). | à faire |
| 6 | 25/10 | Profils artistes : **accéder aux mesures publiques** des capteurs des autres artistes (FAIT le 25/10, voir « Fait ») ; accès rapide aux profils **depuis la constellation**. | fait (profil + constellation) |
| 7 | 25/10 | Pilote e-ink 2,9″ (ESP8266) : `ReadBusy` à polarité probablement inversée, écran blanc 2 à 4 minutes par œuvre ; à essayer sur le banc **avant** toute distribution. | à faire |
| 8 | 25/10 | Écran du portail R4 : numéro d'affichage ajouté (fait) ; **heure réelle** impossible avant la connexion (pas d'horloge) : à reprendre quand la carte est en ligne (heure du serveur). | partiel |
| 9 | 25/10 | `tests/hardwareMatrix.test.ts` : 2 tests échouent déjà sur `main` (version téléchargeable `2.3` contre `2.5` de la matrice) et `sensor.test.ts` (harnais DHT22, en-tête introuvable) ; suite complète : ~75 échecs hors régression (PATH winlibs, PowerShell). | à faire |
| 10 | 25/10 | TFT 1,8″ (`dev_VIRBQRV1`) : série pendant l'annonce OTA pour comprendre pourquoi la carte ne télécharge pas ; image allégée (textes en flash, morceaux, DHT22). Prévu le 26/10 au soir. | à faire |
| 11 | 25/10 | ~~Version `2.12` envoyée à `dev_T46HBXG1`~~ : **INSTALLÉE** — le serveur la voit en `eink29bwr-2.12`, en ligne, dernier contact 21:35 UTC (25/10/2026). Reste à vérifier à l'œil par son propriétaire : cartel capteur v3 et OLED réel (affichage des lignes d'état). | fait côté serveur ; vérification visuelle en attente |
| 12 | 25/10 | `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` : ajouter UNO R4 e-ink + portail (`r4eink29-1.2`) quand l'essai matériel est fait. | en attente |
| 13 | 25/10 | **Pourquoi le TFT 1,8″ (`dev_VIRBQRV1`) ne vote pas** alors qu'il est actif et invité (tire toutes les 15 min, annonce OTA reçue) : série pendant un candidat. Tant que ce n'est pas réglé, le quorum vivant l'exclut automatiquement. | à faire (26/10 au soir) |
| 14 | 25/10 | **Rejetés — animations** : un dessin rejeté qui est une animation (ex. « zombie mouche ») doit être reconnu comme tel (`kind: "animation"` dans l'entrée de la liste) et, au clic, se **voir en entier** (lecture du clip), pas seulement l'image fixe. | à faire |
| 15 | 25/10 | **Reprendre un dessin rejeté ou publié** → FAIT le 26/10 (Remix d'un bloc + reprise d'un rejet) : `docs/LOT_UX_3_REMIX_2026_10_26.md`. Reste : droits d'auteur affichés, conversion entre types d'écran, animations (#14), noyau C++ du hash de bloc. | fait (limites listées) |
| 16 | 25/10 | **Branche `claude/r4-eink29-portail`** (portail Wi-Fi UNO R4 + e-ink 2,9″, validé sur la carte le 25/10 : enregistrement, redémarrage, connexion, inscription, vote v2) : avant de la fusionner, 4 tests R4 échouent à cause d'ancres de restitution du sketch d'avant (`renderFirmware` ×2, `edStack`, `netStack` : motifs de `tests/helpers/netStackEdits.json` à rendre uniques malgré le nouveau démarrage Wi-Fi) ; ajouter la ligne R4 + portail à la matrice. | à faire |
| 17 | 26/10 | **Réconcilier le statut OTA Internet R4** : le porteur confirme 2 essais matériels distincts sur 2 R4 (release reçue et installée, redémarrage, portail temporaire, nouveau Wi-Fi, réception d'œuvres, calcul et vote après mise à jour). Statut provisoire : « OTA Internet R4 réussie sur deux appareils selon les observations matérielles du porteur ; rattachement documentaire aux commits, releases et journaux encore à faire ». Attendu de l'autre session : profil exact des 2 R4, commits avant/après, release + manifeste, journaux/verdicts, preuve du vote post-OTA, statut production/canari. Ensuite seulement : matrice, README, page Installer et documents historiques (la matrice dit encore « OTA applicative R4 non validée »). | en attente des preuves |
| 18 | 26/10 | ~~Remix (bloc miné) : `derivedFromBlockHash` optionnel entrant dans le hash du NOUVEAU bloc ; « Reprendre ce dessin » (rejeté) = brouillon seulement, sans filiation. Décisions dans le message du porteur du 26/10 ; lot 3.~~ | fait (26/10) ; à essayer avec un vrai vote en production |
| 19 | 26/10 | ~~Cercles d'artistes sans médias binaires (jamais dans Redis) ; contrat futur de stockage objet à documenter sans choisir de service. Lot 4.~~ | fait (26/10) : `docs/LOT_UX_4_CERCLES_2026_10_26.md` ; à essayer avec deux profils réels ; médias = nouveau GO |
| 20 | 26/10 | ~~Apprendre : intentions, recherche, filtres (3 profondeurs × 5 types), feuille de route et matrice comme destinations dédiées. Lot 5.~~ | fait (26/10) : `docs/LOT_UX_5_APPRENDRE_2026_10_26.md` |

## À faire — station R4 (26/10/2026)

- [ ] **Station `r4env-1.1` / produit `r4tft18-2.0`** (`arduino_uno_r4/pod_uno_r4_station`, `pod_uno_r4_tft18_env`) : premier essai matériel avec TFT, DHT22 et SGP40 branchés (protocoles : `STATION_MONITORING_R4_2026_10_26.md`, `PRODUIT_R4_TFT18_ENV_2026_10_26.md`) ; frame + ACK + vote à observer ; OTA R4 : TLS de l'image, coupure d'alimentation, autre carte, clés de production, publication (`OTA_R4_CLIENT_ET_PUBLICATION_2026_10_26.md`). Le produit `tft18_env` est capable de voter : le brancher sur `dev_I25D9Z7A` change sa nature côté serveur (capteur → écran).

## Fait (dernier en tête)

- [x] 25/10 — **Historique public des capteurs sur le profil artiste** : onglet « Capteurs » (visible s'il existe un capteur public), sélecteur par appareil (nom du device + `dev_…`), 24 h / 7 j / 30 j, courbes groupées (environnement / connexion dont débit `dl`) ; grandeur future (gaz) = une ligne dans `MEASURE_KINDS` (bloc « Autres mesures » sinon). `/api/artists/:id` ajoute `sensors` seulement si `measuresPublic !== false`. Lecture : `GET /api/sensor?public=1&hours=` (CDN 2 min, rien tant que l'onglet est fermé). `app/artists/[artistId]/ArtistSensors.tsx`, `tests/artistSensors.test.ts`.
- [x] 25/10 — **Journal réseau** (page réseau) : toute la semaine (`/api/network/activity-log?days=7` : blocs de la chaîne canonique + dessins rejetés), horodatage complet JJ/MM/AAAA HH:MM:SS, filtre par jour et recherche libre, défilement qui ne saute plus (suivi des nouvelles lignes seulement si le lecteur est en bas). Limite connue : les votes individuels des blocs anciens ne sont pas conservés (seul le résumé « v2 vérifié ×N » l'est) ; le journal par appareil (Gérer → Journal) reste réservé au propriétaire.

- [x] 25/10 — **Quorum vivant** (`lib/quorumHealth.ts`, `lib/quorumResponsive.ts`) : un appareil actif qui ne vote pas pour un candidat arrivé à expiration reçoit un « manque » (`missedVotes`) et sort du quorum (seuil `QUORUM_MAX_MISSED`, défaut 1) ; dès qu'il vote il y revient. Cause des rejets « sans quorum » depuis 2 jours : réseau de 4 (MN67, R4, TFT 1,8″ muet, un 4ᵉ) pour 3 votes nécessaires, 2 reçus. Un candidat miné ou refusé par décision ne pénalise personne. Interrupteur : `DEVICE_LOG=off` pour le journal.

- [x] 25/10 — Journal par appareil, 7 jours, onglet « Journal » de « Gérer » (`lib/deviceLog.ts`, commit `affa3f6` sur `main`).
- [x] 25/10 — Rejetés : lecture qui enregistre les candidats expirés (plus de « N+1 »), carte « En attente de validation » avec les votes, motif détaillé, image des rejetés (`affa3f6`).
- [x] 25/10 — Mesures publiques par défaut, interrupteur par appareil, message fermable (fusionné).
- [x] 25/10 — Galerie : toute la chaîne (#0 à #116), recherche par numéro exact (fusionné).
- [x] 25/10 — Cartel d'une frame personnelle : date de minage du bloc d'origine (fusionné).

## Spécification de référence — ce qui est en production le 25/10/2026

### Rejetés (`/gallery` → Rejetés)
- `GET /api/rejected-draws` : réconcilie d'abord le candidat perdu (`reconcileLostCandidate`), renvoie `rejected` (50 derniers, avec `candidateId`) et `pending` (candidat en cours : appareil, écran, titre, quorum attendu, votes reçus avec verdict, version v1/v2 et détail).
- `GET /api/rejected-image?id=` : image de la copie d'archive, uniquement si l'état final du candidat est `rejected` ou `expired` ; 404 identique sinon.
- Motif d'un expiré : « expiré ou remplacé sans quorum (réseau de N validateur(s), Q vote(s) nécessaire(s) · M min sans décision) » ; motif d'un refus : « refusé par le comité (x/K refus) » ou « refusé par le réseau (x/N refus) ».
- Limite : la copie d'image est gardée tant que l'entrée est dans les 200 dernières, et 90 jours au plus.

### Journal d'appareil (`Gérer` → `Journal`)
- Écrit par l'enrobage `withDeviceLog` autour de `register`, `pull`, `pull-frame`, `ack-frame`, `validate-candidate`, `validation-result`, `sensor`, `obs-confirm` : méthode, statut, champs utiles (frame, candidat, bloc, vote accepte/refuse et motif, nombre de lectures du capteur, erreur). Jamais d'image, de signature, de code d'appairage ni de clé.
- Liste Redis `devlog:{deviceId}` : 400 lignes au plus, TTL de 7 jours renouvelé à chaque écriture ; la lecture écarte aussi les lignes de plus de 7 jours.
- Quota : 1 commande (EVAL) par ligne ; un pull au repos n'est noté qu'une fois par heure et par instance (porte en mémoire).
- Lecture et effacement : `GET` et `DELETE /api/my-devices/{deviceId}/logs`, propriétaire seulement.
