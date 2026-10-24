# Matrice de compatibilité matérielle PoD

> État rétrospectif au **24/10/2026**, établi depuis les commits, les procédures et les journaux archivés dans ce dépôt.  
> **Relue le 24/10/2026 par Claude contre Git (`main` = `9fa5701`, PR #7), les relevés serveur publics et les mesures de session** — corrections listées en fin de document. Les références de commits ne citent que des commits présents sur GitHub.
> Elle remplace les formulations imprécises du type « cela devrait marcher ». Une ligne décrit un **profil matériel reproductible**, jamais une carte personnelle ni une promesse sur un montage improvisé.

## Légende de preuve

| Marque | Signification |
|---|---|
| `—` | absent ou non étudié |
| `C` | source compilée / contrôles hôte ; aucune preuve sur carte |
| `M` | observé sur au moins une carte réelle (démarrage et comportement indiqué) |
| `P` | parcours utilisateur réellement observé (portail ou appairage) |
| `V2` | vote réel V2 et/ou réception + affichage + ACK observés |
| `OTA` | mise à jour Internet signée, installation, démarrage sain et relecture de flash observés |
| `EXP` | expérimental : ne pas proposer comme profil public ni stable |

Une case `OTA` ne garantit pas que toute future variante de la famille a été validée : elle prouve seulement le client OTA et la combinaison qui a réellement traversé le canari.

## Profils ESP8266

| Profil déclaré | Écran(s) réseau | Modules additionnels | Vote / affichage réel | Portail Wi-Fi | OTA Internet | DHT22 | État à distribuer |
|---|---|---|---|---|---|---|---|
| `tft18` | TFT ST7735S 1,8″ | — | `V2` : vote, frame, ACK et bloc #111 observés | `P` : parcours deux QR validé | `OTA` : `tft18-2.7` → `2.8` ; marge mémoire très faible (1,2 Ko min.) | — | profil public, surveillé. `2.9` (portail) flashée par câble ; **carte distante `dev_VIRBQRV1` en `tft18-2.9` : frame du bloc #115 affichée et ACK reçu le 24/10 à 08:38 UTC** (relevé serveur public ; vote non relevé). Aucune OTA vers/de `2.9` prouvée |
| `tft18` | TFT ST7735S 1,8″ | DHT22 sur D3/GPIO0 | `C` pour l'ajout capteur ; socle écran/V2 prouvé ci-dessus | hérite du profil TFT | release canari `tft18-2.10-ota7` (séquence 7) **publiée et annoncée** par le serveur (pull simulé en production, 24/10) ; **installation non observée plus d'une heure après l'ouverture de la porte** : aucune demande de téléchargement `[ota-image]` visible côté serveur, la carte semble refuser avant de télécharger (cause inconnue, pas de journal série) | `C` : tests + compilation (binaire 616 368 o, RAM statique 39 092 o) ; aucune lecture de DHT22 observée sur cette carte | `EXP` — OTA **non aboutie** ; ne pas la présenter comme fonctionnelle |
| `eink29bwr` | e-ink 2,9″ BWR | — | `V2` : vote, frame, affichage et ACK observés | `P` : portail à deux QR observé | `OTA` : `eink29bwr-2.4` → `2.5`, identité/Wi-Fi conservés, flash relue | — | profil public ; un seul appareil et un seul OTA complet |
| `eink29bwr` | e-ink 2,9″ BWR | OLED 0,96″ d'état/portail + DHT22 D3 | **`M` : l'OLED et le DHT22 fonctionnent, mais le téléchargement d'une frame ÉCHOUE** (tas avant `pull-frame` 37 680 o / plus grand bloc 31 320 o, contre 40 720 / 33 728 o pour le BWR OTA : `pull-frame → -1`, bloc #113 jamais affiché sur la carte `dev_T46HBXG1`) | `M` : portail OLED (QR) observé | non essayée (carte reflashée sans OLED) | `M` : DHT22 lu (13 °C, 92 %) et `/api/sensor` 200 | **`INCOMPATIBLE` pour afficher des œuvres** — l'OLED coûte ≈ 2,7 Ko de tas ; ne jamais distribuer |
| `eink29bwr` | e-ink 2,9″ BWR | DHT22 D3 (sans OLED) | **`V2` : bloc #114 « Libourne » miné par `dev_T46HBXG1` (validateurs v2 = 2, rejets 0), affichage + ACK 200** (relevés serveur publics, 24/10) | `P` hérité (portail, ONBOARD) | client actif (`eink29bwr-2.6`, séquence 8), **aucune mise à jour reçue** ; marge de tas mince (1 échec de téléchargement sur 2 avant réussite) | `M` : lecture + envoi, mesures stockées | canari matériel réussi sur UNE carte ; `EXP` pour la distribution (OTA de cette variante non prouvée) |
| `eink29bwr` | e-ink 2,9″ BWR | DHT22 D3 + température/humidité gravées dans le cartel (`eink29bwr-2.7`, séquence 8) | `C` seulement | `C` | `C` | `C` | `EXP` — compilé, jamais flashé ; test avec `dev_MN67OG7R` prévu |
| `multiscreen` | e-ink 2,7″ BW + OLED 0,96″ | — | `V2` : vote, deux affichages et ACK observés (bloc #103) | `P` : portail OLED, Wi-Fi et conservation d'identité observés | `OTA` : `multiscreen-2.6` → `2.7`, flash relue ; seulement 608 o de tas min. | — | canari réussi, **pas stable** tant que la marge OTA n'est pas améliorée |
| `multiscreen` | e-ink 2,7″ BW + OLED 0,96″ | DHT22 sur D3/GPIO0 | carte flashée sans capteur, démarrage/absence capteur observés | hérite du portail OLED | aucune OTA de l'image capteur ; marge estimée ≈ 400 o après OTA | `C` + chemin sans capteur `M`; vraie lecture et envoi non observés (l'image **déclarait** des capteurs sans en avoir : le menu « Mesures » apparaissait à tort ; corrigé côté serveur, PR #7 : le menu exige une vraie mesure) | `EXP` — ne pas publier |
| `eink27bw` | e-ink 2,7″ BW | — | `C` : vote V2 compilé | — | — | — | port source uniquement : aucune preuve matérielle actuelle |

### Contraintes ESP8266 à ne jamais contourner

- Une option activée est une variante de build ; la version et la séquence OTA doivent identifier cette variante.
- Les paires **écran + capteur** doivent conserver les invariants mémoire : buffers d'image libérés avant TLS, aucun envoi capteur pendant un vote ou une OTA, garde sur le plus grand bloc libre.
- D3/GPIO0 est le seul pin encore libre dans les profils TFT et multiscreen recensés ; un DHT22 sur cette broche doit rester débranché pendant un téléversement USB, car GPIO0 participe au mode de flash.
- **Mesuré le 24/10/2026 : l'OLED sur le BWR coûte ≈ 2,7 Ko de tas et empêche le téléchargement de frame** ; seule la variante sans OLED est exploitable. Les plans image (2 × 4 736 o) sont alloués avant le TLS : il faut ≥ ≈ 24 Ko contigus restants.
- OLED « d'état » du BWR hybride n'est pas un second écran du réseau : il ne reçoit pas de frames PoD. Le multiscreen, lui, a deux écrans réseau.

## Profils UNO R4 WiFi

| Profil déclaré | Écran(s) réseau | Modules | Vote / affichage réel | OTA Internet de production | Capteur / notes | État |
|---|---|---|---|---|---|---|
| `r4tft28-2.5` | TFT 2,8″ tactile | microSD, animations | `V2` : vote réel ; affichage/ACK observés | — | animations : fonctionnalités distinctes, à qualifier par essai matériel dédié | matériel de vote validé ; OTA applicative non portée/validée comme pour ESP8266 |
| `r4eink29-1.1` | e-ink 2,9″ BWR | — | `V2` : vote réel et affichage observés | — | pile R4 sécurisée par les lots dédiés | matériel de vote validé ; OTA applicative non validée |
| `r4dht22-1.3` | aucun (`sensor`) | DHT22 | n'est ni écran ni votant | — | `M` : DHT22 → `/api/sensor` 200 observé | profil capteur validé par câble ; pas d'OTA |
| `r4eink27-1.1` | e-ink 2,7″ BW | — | `C` | — | — | port compilé, non essayé |
| `r4multiscreen-1.1` | e-ink 2,7″ BW + OLED | — | `C` | — | — | port compilé, non essayé |
| `r4tft18-1.1` | TFT 1,8″ | — | `C` | — | — | port compilé, non essayé |

Les essais OTA R4 de laboratoire ont prouvé le mécanisme de reprogrammation Wi-Fi et la conservation de l'état sur une R4 de canari. Ils ne constituent **pas** encore un client OTA applicatif distribué pour les profils R4 ci-dessus.

## Chantiers connus (non commencés, à ne pas présenter comme disponibles)

- **BWR 2,9″ + OLED en second écran du réseau** (comme le multiscreen) : aujourd'hui l'OLED du BWR n'affiche que l'état (Wi-Fi, mesure) et il est **désactivé** parce qu'il empêche le téléchargement des frames. Pistes : récupérer au moins 3 Ko de tas (pilote OLED minimal sans bibliothèque Adafruit, un seul tampon de page ; libération avant chaque TLS). Un OLED qui reçoit des frames serait un **nouveau profil** (famille OTA propre, préfixe de vote, page Installer), pas une option.
- **Mise à jour à distance du TFT + DHT22** : release `tft18-2.10-ota7` publiée, installation non aboutie ; cause à établir (journaux serveur d'observabilité, puis essai sur place).

## Qui vote en V2, qui peut être mis à jour à distance (par famille de firmware)

Le serveur reconnaît une famille par le **préfixe de la version déclarée** à l'enregistrement. Une carte dont la version est **plus ancienne que le minimum** ne compte pas dans le quorum, ne reçoit pas de candidat et ne peut pas voter (403) ; les capteurs seuls ne votent jamais. La colonne « a voté » ne dit **que ce qui a été observé** sur une vraie carte.

| Famille | Vote V2 dès (serveur) | Client OTA dès (serveur) | Version dans le téléchargement | A voté en V2 sur carte | OTA prouvée |
|---|---|---|---|---|---|
| `tft18` | 2.4 | 2.7 | 2.9 | oui (bloc #111, 22/10) | oui : 2.7 → 2.8 ; 2.9 → 2.10 **non aboutie** |
| `eink29bwr` | 2.3 | 2.4 | 2.5 | oui (#101, 14/10 ; #114, 24/10) | oui : 2.4 → 2.5 |
| `multiscreen` | 2.5 | 2.6 | 2.7 | oui (#103, 14/10) | oui : 2.6 → 2.7 (marge 608 o) |
| `eink27bw` | 2.1 | — | 2.1 | **non** (jamais essayé en V2) | non |
| `r4tft28` | 2.5 | — | 2.5 | oui (#100 et #103, 14/10) | non (pas de client OTA applicatif) |
| `r4eink29` | 1.1 | — | 1.1 | oui (#100 et #101, 14/10) | non |
| `r4eink27`, `r4multiscreen`, `r4tft18` | 1.1 | — | 1.1 | **non** (compilés seulement) | non |
| `r4dht22` (capteur seul) | ne vote pas | — | 1.3 | sans objet | non |

Les valeurs « dès » viennent de `lib/voteCapability.ts` (`VOTE_V2_FIRMWARE`) et `lib/otaDistribution.ts` (`OTA_CLIENT_FIRMWARE`) ; un test compare ce tableau au code.

## Règle de composition : éviter l'explosion combinatoire

Un firmware public est défini par :

```text
famille MCU + profil de câblage/écran + modules explicitement compatibles
```

Exemple : `ESP8266 4 Mo + BWR 2,9 + OLED d'état + DHT22` est **un profil**. Deux appareils qui partagent ce profil reçoivent la même release, mais chaque release peut être ciblée par `deviceId` pendant le canari.

On ne crée donc ni un code par personne, ni une promesse de compatibilité pour tout assemblage. Les choix utilisateur futurs devront être limités au catalogue de profils déclarés, avec vérification automatique des conflits de pins, du rôle d'écran et du budget mémoire.

## Politique de publication

| Niveau | Peut apparaître sur la page Installer ? | Peut recevoir une release stable ? |
|---|---|---|
| `C` | non | non |
| `M` ou `P` sans OTA | oui, uniquement comme installation filaire expérimentale clairement étiquetée | non |
| `V2` sans OTA | oui, profil écran/vote, sans promettre de mise à jour distante | non |
| `OTA` avec marge étudiée | oui | oui, après canari ciblé de la release concernée |
| `EXP` | non, sauf page laboratoire explicite | jamais |

La page publique ne doit jamais présenter une option DHT22, OLED ou trafic comme « compatible » avant que sa ligne passe au minimum à `M` pour le matériel concerné.

## Contrat de maintenance obligatoire

À chaque nouveau profil, build, flash ou test, la personne qui réalise le lot met à jour **dans le même commit ou le même compte rendu** :

1. cette matrice ;
2. la version, la séquence OTA, les pins et les modules activés ;
3. le niveau de preuve réel (`C`, `M`, `P`, `V2`, `OTA`) et le lien vers le journal/procédure ;
4. la décision de diffusion : expérimental, canari ciblé, stable ou interdit ;
5. la page Installer/README seulement lorsque le profil devient publiable.
6. **La page « Apprendre → Compatibilité matérielle » est le rendu direct de ce fichier** (aucune copie) ; `tests/hardwareMatrix.test.ts` doit passer : il vérifie que les profils d'installation (`testedOnHardware`), les avertissements de `/api/esp-firmware`, la table de la synthèse technique et les firmwares téléchargeables (options capteur/OLED à 0, version compatible avec le client OTA) restent cohérents avec cette matrice. Un test qui échoue signale qu'une moitié n'a pas été mise à jour dans le même lot.

Interdit de faire passer une case de `C` à `M`, `V2` ou `OTA` sans journal matériel archivé. Interdit aussi de déduire qu'une variante capteur est sûre parce que le firmware sans capteur a réussi une OTA.

## Sources principales

- `docs/DISTRIBUTION_TFT_BWR_2026_10_23.md`
- `docs/PROCEDURE_OTA_BWR_2026_10_23.md`
- `docs/MULTISCREEN_PORTAIL_OTA_2026_10_23.md`
- `docs/CAPTEUR_DHT22_MULTISCREEN_ESP8266_2026_10_23.md`
- `docs/CAPTEUR_TEMPERATURE_R4_DHT22.md`
- `docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md`
- PR #7 (`9fa5701`) : `3c3f5b2` (hybride BWR), `482d738` (ACK, plans libérés), `394e64a` (TFT + DHT22), `b64964c`/`a7adc12` (preuves) ; docs `docs/BWR_HYBRIDE_OLED_DHT22_ONBOARD_2026_10_24.md`, `docs/TFT18_DHT22_MESURES_2026_10_24.md`, `docs/BWR_MESURES_SUR_AFFICHAGE_2026_10_24.md` (branche de laboratoire) ;
- premiers OTA : `3f9b72c` (BWR), `61b33ee` (multiscreen) — ces deux hashes sont des commits de la branche de laboratoire locale ; la preuve publique est dans `docs/PROCEDURE_OTA_BWR_2026_10_23.md` et `docs/MULTISCREEN_PORTAIL_OTA_2026_10_23.md`.

## Corrections apportées à la première version (24/10/2026, relecture)
1. BWR + OLED + DHT22 : passé de « `C`, correctif ACK non essayé » à **`M` + INCOMPATIBLE** (échec mesuré du téléchargement de frame).
2. Ajout du profil **BWR + DHT22 sans OLED** (`V2` : bloc #114, ACK 200) et du profil **surimpression T/H** (`C`).
3. TFT + DHT22 : « release préparée » → **publiée, annoncée, installation non aboutie**.
4. TFT `2.9` : affichage + ACK observés à distance (relevé serveur).
5. Références de commits : remplacées par des commits présents sur GitHub (les hashes `21ba48c`, `023687f`, `c0f7f08`, `f2d2075` n'existent que dans la branche de laboratoire locale).
6. Menu « Mesures » : déclaration firmware ≠ capteur branché (note multiscreen).

