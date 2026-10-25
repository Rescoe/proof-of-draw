# Prompt d'audit (GPT) — journée du 25/10/2026

À coller tel quel. Dépôt : `Rescoe/proof-of-draw`, branche `main` au commit `119883d` (ou plus récent). Rôle demandé : **auditeur** (lecture seule, aucun push). Réponds en français, par ordre de gravité, avec pour chaque point : fichier:ligne, scénario concret de défaillance, correction proposée, et ce qui est PROUVÉ (test, matériel) contre ce qui est seulement DÉDUIT.

Contexte de lecture : `CLAUDE.md`, `docs/A_FAIRE_PETITES_MODIFS.md`, `docs/CHANTIERS_EN_COURS_2026_10_25.md`, `docs/MATRICE_COMPATIBILITE_MATERIELLE.md`. Les niveaux de preuve de la matrice (`C`, `M`, `V2`, `OTA`, `EXP`) sont la référence ; signale tout endroit où le texte les dépasse.

## 1. Consensus : « quorum vivant » (priorité 1)
Fichiers : `lib/quorumHealth.ts`, `lib/quorumResponsive.ts`, `lib/deviceStore.ts` (`getGlobalActiveCount`, `getPoolSnapshot`), `app/api/validation-result/route.ts` (`noteVote`), `app/api/submit-candidate/route.ts` (`settleLostPrevious`), `app/api/rejected-draws/route.ts` (`settleExpired`).
Règle : un appareil actif, appairé et capable de voter qui n'a pas voté pour un candidat arrivé à expiration reçoit un « manque » (`missedVotes`) et sort du quorum (seuil `QUORUM_MAX_MISSED`, défaut 1) jusqu'à son prochain vote. Cause : réseau de 4 dont un TFT muet, 3 votes requis, 2 reçus, aucun dessin miné pendant 2 jours.
Questions : (a) un adversaire peut-il **faire exclure des validateurs honnêtes** (candidats que seuls ses appareils votent, candidats volontairement injouables) puis dominer un quorum réduit ? (b) un appareil légitime lent (pull toutes les 15 min, TTL du candidat 30 min) est-il exclu à tort ? oscillation exclusion/réhabilitation ? (c) conditions de course entre `settleLostPrevious`, `settleExpired` et la réconciliation (porte `SET NX`), idempotence, double pénalité ; (d) un seul manque suffit-il (seuil 1) — quel seuil recommandes-tu ? (e) taille de pool minimale : que se passe-t-il si tout le monde est exclu (`Math.max(1, …)`) ?

## 2. Données exposées
- **Journal par appareil** (`lib/deviceLog.ts`, `app/api/my-devices/[deviceId]/logs/route.ts`) : l'enrobage clone/relit les réponses JSON des routes appelées par les cartes ; vérifier qu'aucun secret (code d'appairage, signature, clé, image) n'est consigné, la taille/coût Redis (1 EVAL par ligne, porte « pull au repos » en mémoire), et l'accès propriétaire seulement.
- **Rejetés** : `app/api/rejected-image/route.ts` sert la copie d'archive d'un candidat rejeté/expiré à n'importe qui, via `candidateId` (aléa ?). Énumération, contenu sensible, durée de conservation (90 jours).
- **Mesures publiques par défaut** (`lib/networkSnapshot.ts`, `app/api/sensor/route.ts`, interrupteur `measuresPublic`) : défaut public pour tous les capteurs existants ; recoupements possibles (heure de présence, localisation déduite) ?
- **Journal réseau** (`app/api/network/activity-log/route.ts`, `?days=7`) : identifiants publics (`publicDeviceId`) et motifs de rejet exposés.

## 3. Portail Wi-Fi UNO R4 (`arduino_uno_r4/pod_uno_r4_eink29/`, option `POD_WIFI_PORTAL=1`)
Fichiers : `pod_wifi_portal_r4.h`, `pod_wifi_portal.h` (partagé avec les ESP8266 : tampon `Buf` en mode flux), `pod_wifi_cfg.h`, blocs `POD_WIFI_BEGIN/END` du `.ino`.
Points : entropie du mot de passe du point d'accès (SHA-256 du bruit analogique, 8 caractères sur 31 symboles) ; jeton de formulaire ; lecture de la requête en flux (en-têtes de téléphone > 600 o) et bornes ; enregistrement en flash de données (octets 512..616, un bloc de 1 Ko réécrit) et usure ; pile principale de 1 Ko (tout appel au module Wi-Fi sur pile dédiée : `tests/wifiCalls.test.ts`) ; fuite du SSID/mot de passe dans les journaux ; absence de DNS captif ; écran d'état « connecté ». Preuve matérielle : UN essai, UNE carte, le 25/10/2026.

## 4. OTA et distribution
`ota-releases/` (releases canari ciblées), porte `ota:kill` **ouverte en permanence** (décision du porteur), `docs/POLITIQUE_PORTE_OTA_2026_10_25.md`, `tests/otaReleasesPolicy.test.ts`. Constat du 25/10 : la `2.12` envoyée à `dev_T46HBXG1` a été téléchargée mais pas installée (réinscription en `2.6`), cause inconnue ; aucun journal côté carte. Que manque-t-il pour un déploiement distant sûr (retour arrière, confirmation d'installation, journal renvoyé au serveur) ?

## 5. Qualité et tests
Suite complète : ~75 échecs hors régression (environnement : PATH winlibs, harnais C++ sous Git Bash, sources tierces WiFiS3 absentes). Peux-tu proposer un moyen **reproductible** de la rendre verte (ou de séparer clairement « environnement » et « régression ») ? Deux tests `tests/hardwareMatrix.test.ts` échouent depuis plusieurs jours (version téléchargeable `eink29bwr-2.3` contre `2.5` de la matrice).

## 6. Hors périmètre / à ne pas conclure
Ne rien affirmer sur le matériel non essayé (TFT 2,8″, OLED réel sur le BWR). Le TFT 1,8″ (`dev_VIRBQRV1`) ne vote pas : cause à établir (diagnostic prévu le 26/10).
