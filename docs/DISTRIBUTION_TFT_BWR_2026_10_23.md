# Profil de distribution — TFT 1,8″ et BWR 2,9″ (ESP8266) — 23/10/2026

Objectif : qu'une personne qui télécharge le firmware d'un **TFT 1,8″** ou d'un **e-ink BWR 2,9″** depuis le site (`/api/esp-firmware`, page Installer) obtienne directement la version finale : **Wi-Fi réglé depuis son téléphone** (portail), **association à l'application**, puis **mises à jour à distance signées** (OTA). Rien à modifier dans le code.

## Ce que change ce profil
| | TFT 1,8″ (`esp_tft1.8`) | BWR 2,9″ (`esp_eink_2.9BWR`) |
|---|---|---|
| Version déclarée au serveur | `tft18-2.9` (client OTA ≥ 2.7 requis côté serveur) | `eink29bwr-2.5` (client OTA ≥ 2.4) |
| Séquence OTA compilée | 6 | 7 (= la release canari `eink29bwr-2.5-ota7`) |
| Wi-Fi | enregistrement EEPROM `512..616`, saisi par le portail `PoD-XXXX` | idem |
| Options par défaut | `POD_WIFI_FROM_RECORD=1`, `POD_WIFI_PORTAL=1`, `POD_OTA=1`, `POD_OTA_CLIENT=1` | idem |
| Clés de publication | `pod_ota_keys.h` : clés PUBLIQUES `ota-a` / `ota-b` (les moitiés privées restent hors du dépôt) | idem |
| Mémoire (compilé, sans `secrets.h`) | RAM statique 38 884 o (≤ 40 000) | RAM statique 36 996 o |

Les options restent surchargeables par `-D` (les builds de laboratoire passent leurs propres valeurs). Les autres firmwares (e-ink 2,7″, multiscreen, UNO R4) ne sont **pas** concernés.

## Parcours utilisateur (déjà décrit dans la page Installer et le README du ZIP)
1. Câbler, ouvrir le dossier dans Arduino IDE, **téléverser sans rien modifier**.
2. Étape 1/2 : l'écran affiche des QR ; scanner le n° 1 (rejoindre `PoD-XXXX`), la page s'ouvre (sinon QR n° 2 ou `http://192.168.4.1`), choisir sa box, saisir le mot de passe (case « Afficher »), Enregistrer, remettre le téléphone sur sa box.
3. Étape 2/2 (carte neuve) : QR du compte → nom d'artiste. Une carte déjà associée n'affiche pas ce QR.
4. Ensuite, les mises à jour arrivent seules (OTA) quand une release `stable` est publiée pour la famille.

## Statut de test (honnête)
- **BWR** : portail, écran (deux QR de même taille, « / » corrigé), œuvre affichée, **OTA séquence 6 → 7 réussie en production** (flash relue identique, identité et Wi-Fi conservés). Un seul essai, une seule carte.
- **TFT** : première OTA (2.7 → 2.8) réussie le 22/10 ; parcours Wi-Fi en deux étapes validé ; le build `tft18-2.9` a été installé par câble — **aucune OTA depuis/vers ce build** n'a été essayée.
- **Non testé de bout en bout** : association d'une carte NEUVE, mauvais mot de passe dans le portail, vote réel et dessin neuf avec ces versions. La page de téléchargement (README du ZIP) le dit.
- Pas de rollback automatique ; tas minimal pendant l'OTA 3,7 Ko (BWR) / 1,2 Ko (TFT).

## Publier une mise à jour pour tous (processus, rien n'est publié ici)
1. Incrémenter la séquence et la version dans le `.ino` (BWR : séq. ≥ 8, `eink29bwr-2.6` ; TFT : séq. ≥ 7, `tft18-3.0`), compiler avec le profil.
2. Signer : `node --import tsx scripts/ota-release-sign.ts --image <bin> --family esp8266-eink29bwr --version … --seq … --channel stable --wave 10 --key-slot a --keys-dir <dossier hors dépôt>` (image **sans** identifiant Wi-Fi : refusé sinon).
3. PR avec `ota-releases/<id>/{manifest.json,image.bin}`, fusion, déploiement ; vérifier avec `scripts/ota-probe-release.ts` **porte fermée**.
4. Ouvrir la porte (`DEL ota:kill`) par vagues (10 % puis plus), surveiller, refermer en cas de doute.
Une release `canary` (liste d'appareils) est le moyen sûr d'essayer sur une carte ; `stable` touche tous les appareils éligibles de la famille.
