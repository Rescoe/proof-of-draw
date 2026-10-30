# Index et gouvernance de la documentation

**Mis à jour le 29/10/2026.** Cet index évite qu'une note chronologique ancienne soit interprétée comme l'état actuel.

## Sources canoniques

| Document | Rôle |
|---|---|
| `../AGENTS.md` | règles courtes obligatoires pour tout agent |
| `ETAT_ACTUEL_CANONIQUE.md` | état transversal actuel et point de reprise |
| `TAXONOMIE_FAMILLES_COMPOSITIONS_MATERIELLES.md` | sens stable des familles et profils |
| `MATRICE_COMPATIBILITE_MATERIELLE.md` | registre cumulatif des profils, versions et preuves ; contient aussi de l'historique, à lire après l'état canonique |
| `../README.md` | présentation publique, volontairement moins détaillée |
| `../CLAUDE.md` | mémoire technique longue et historique, jamais prioritaire sur les documents précédents |
| `ETAT_GIT_ET_REPRISE_MULTI_PC.md` | procédure de travail propre entre plusieurs ordinateurs |
| `PROCEDURE_NOUVEAU_PC_2026_10_29.md` | clone, Node, secrets, artefacts privés et inventaire des worktrees avant tout nettoyage |
| `CANARI_OTA_INTERNET_R4_STATION_2026_10_30.md` | station R4 : A propre (portail, séquence 14) prêt, release retirée, en attente du GO flash |
| `CARTE_DATA_FLASH_STATION_R4_2026_10_30.md` | carte de la data flash de la station R4 (sans chevauchement) et récupération USB |
| `INCIDENT_WIFI_DANS_BINAIRE_R4_2026_10_30.md` | identifiants Wi-Fi dans un binaire R4 publié : faits, contrôles, plan de purge séparé |
| `SUIVI_CANARI_MULTIBWR_EN_ATTENTE_2026_10_29.md` | canari Multibwr publié, carte hors ligne : état, contrôles à la reconnexion, verdict à compléter |
| `LOT_MULTIBWR_MIGRATION_2026_10_29.md` | multiscreen e-ink BWR + OLED + DHT22 (`multibwr-2.1`) : construction, migration OTA signée non publiée, protocole du canari |
| `INVENTAIRE_LOCAL_A_PRESERVER_2026_10_29.md` | inventaire de l'ancien checkout et des artefacts à trier sans perte |

## Documents de chantier récents

Ils décrivent un lot précis et restent utiles comme preuves, sans remplacer l'état canonique :

- `UX_CHANTIER_RETOUR_2026_10_29.md` ;
- `PLAN_RESEAU_VALIDATEURS_ET_STATION_R4_2026_10_28.md` ;
- `MATRICE_VALIDATEUR_X_FORMAT_2026_10_28.md` ;
- `OTA_R4_CLIENT_ET_PUBLICATION_2026_10_26.md` ;
- `LOT_BWR_OLED_ANIMATIONS_2026_10_29.md` ;
- rapports de canari cités directement par la matrice.

## Règle pour les notes datées

Une note datée est un journal de recherche. Ses phrases au présent décrivent la date de la note. Lorsqu'un résultat change le niveau de preuve : conserver la note, ajouter le rapport, mettre à jour la matrice, puis l'état canonique si la conclusion générale change.

Les notes récupérées de l'ancien checkout le 29/10/2026 sont rangées dans `archives/local-2026-10-29/`. Elles sont conservées contre la perte, mais explicitement non canoniques.

## Niveaux de preuve

- `D` : documentation ou intention ;
- `C` : compilation ;
- `H` : test ou harnais hôte ;
- `M` : observation matérielle ;
- `S` : observation serveur/Redis ;
- `V2` : vote/affichage réel selon le protocole ;
- `OTA` : mise à jour distante complète, démarrage et santé contrôlés.

Toujours citer date, appareil, firmware, commit/release et journal lorsque disponibles.

## Exclus du Git public

Secrets, cookies, clés privées, dumps complets de flash, journaux contenant un jeton, répertoires de build et sauvegardes locales non nettoyées. Les empreintes, manifests publics, verdicts nettoyés et procédures reproductibles peuvent être suivis.
