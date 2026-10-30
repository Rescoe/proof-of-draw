# Canari — OTA Internet de la station R4 TFT 1,8″ (30/10/2026) — A PROPRE PRÊT (compilé), **EN ATTENTE DU GO FLASH USB**

**Statut : aucune release publiée, aucun flash.** La release `r4tft18-2.7` séquence 2 a été publiée par erreur puis retirée (`d76e3f0`, 404 prouvé) : ce n'est pas un échec matériel. Incident Wi-Fi : `INCIDENT_WIFI_DANS_BINAIRE_R4_2026_10_30.md`. Tous les builds A/B précédents (qui contenaient l'ancien Wi-Fi) sont INVALIDES et ne seront jamais publiés ni flashés.

## Objectif
Un SEUL dernier flash USB installe la station complète : portail Wi-Fi, enregistrement persistant des identifiants, client OTA Internet actif, canal `canary`. Toutes les mises à jour suivantes sont publiables sans secret Wi-Fi dans le binaire (contrôle bloquant `wifi-guard.mjs`).

## A (à flasher) — pin : `docs/mesures/OTA_R4_STATION_INTERNET_2026_10_30/PIN.json`
| | |
|---|---|
| Firmware | `r4tft18-2.8` (portail), famille `uno-r4-wifi-tft18`, canal `canary` |
| Séquence compilée | **14** (> 13, plus haute séquence connue sur `dev_I25D9Z7A`) |
| Taille / flash / RAM | 191828 o ; flash 191820 o (73 %) ; RAM globale 18452 o (56 %) ; maximum d'une image OTA R4 : 245 760 o |
| SHA-256 | `f1ab4b2a5d5b846422bf060a639447e024b2d6a16cfe56d0f4201e269b39b982` (A2 : portail à deux QR sans gris, commande série `FLASH-DUMP` en lecture seule ; remplace A `39d8e4fb…`, flashé puis remplacé le 30/10/2026) |
| Options compilées | `POD_SENSORS=1` (DHT22 + SGP40 + indice COV), `POD_ENV_DISPLAY=1` (écran de station), `POD_SD_CS_PIN=4` (microSD, animations), `POD_OTA_R4=1`, `POD_WIFI_PORTAL=1`, `OTAR4_COMPILED_SEQ=14` ; TLS vers le site de production ; vote v2 universel et ACK par défaut |
| Clés publiques OTA | `r4-a` `dbf04c04…8efc`, `r4-b` `dd310cbb…2ed0` (présentes dans l'image, hexadécimal texte) |
| Wi-Fi | **aucun** : `secrets.h` n'est jamais copié dans le build ; mode « enregistrement » ; ancien SSID et ancien mot de passe **absents des octets** de l'image (contrôle d'octets, 2/2 valeurs) ; marqueur `PODWIFI:record-v1` présent, `PODWIFI:compiled-v1` absent |

Carte de la data flash et procédure de récupération USB : `CARTE_DATA_FLASH_STATION_R4_2026_10_30.md`. Reconstruction : `node ota-lab/r4-ota5/tools/build-r4-station.mjs --seq 14 --keys-dir <dossier des clés publiques r4-a/r4-b> --forbid-file ~/.pod-wifi-forbidden.txt`.

## Tests (hôte) — `tests/r4StationPortal.test.ts`
Aucune zone de la data flash ne se chevauche · le portail n'écrit que `[512, 617)` · aucune constante SSID/mot de passe, `secrets.h` jamais inclus en mode portail · portail rouvrable (commande série ; automatique si la box ne répond plus) · l'écran du portail n'affiche jamais les identifiants de la box · capacités conservées · copies du portail identiques aux sources · contrôle d'octets : 6 mutants refusés (SSID présent, mot de passe présent, nouveau Wi-Fi seul fourni, marqueur compilé, marqueur absent, liste vide) et aucune valeur secrète dans les sorties · publication et build bloquants. **Limite : le portail de la station n'a jamais tourné sur la carte** (seul celui de la UNO R4 e-ink 2,9″ l'a fait, le 25/10/2026).

## Décision du porteur (30/10/2026) : rotation du Wi-Fi différée
Le risque d'exposition publique des identifiants actuels est connu et **accepté temporairement** ; la rotation du Wi-Fi est une **action de clôture du chantier, encore nécessaire, qui ne bloque PAS le canari**. Les valeurs actuelles (dans `~/.pod-wifi-forbidden.txt`) sont les valeurs de référence interdites dans tout binaire : `wifi-guard` prouve leur absence de A. Le porteur saisira localement les MÊMES identifiants sur le portail.

## Déroulé exact avec la sonde (aucune release publiée)
0. Pré-vol : chemins R4 de production en 404 ; suite complète sans nouvelle régression ; `wifi-guard` sur A (SSID et mot de passe actuels absents) ; sauvegarde des 8 192 o **avant toute écriture**.
1. **Sonde (lecture seule)** : téléverser `flash_dump_probe` (programme seulement), capturer le vidage (`flash-dump-capture.ps1`), décoder (`flash-dump-decode.mjs --log … --out … --lookup` : CRC-32 de 256 lignes, clé publique, `deviceId`/appairage par recherche de la clé publique côté serveur, séquence OTA, SHA-256 des 8 192 o). Le fichier `.bin` contient la clé privée : **hors Git, hors conversation**.
2. **Flash de A, UNE seule fois, sans retry.** Arrêt au portail.
3. Le porteur saisit le Wi-Fi sur le portail ; redémarrage ; **vidage après** par la commande série `FLASH-DUMP` (`flash-dump-capture.ps1 -ResetAndAsk`), puis `flash-dump-decode.mjs --diff avant.bin apres.bin` : seuls l'enregistrement Wi-Fi (512..616) et la séquence OTA (blocs 2/3) ont le droit de changer ; identité, drapeaux, blocs possédés, reste du bloc 0 et autres blocs inchangés.

## Après le GO FLASH USB (aucune release publiée)
1. Flasher A, ouvrir le port série (115 200). Premier démarrage : pas d'enregistrement Wi-Fi ⇒ le portail s'ouvre (`PoD-XXXX`, QR + nom + mot de passe de session + 192.168.4.1 sur le TFT). Saisir le **nouveau** Wi-Fi sur le téléphone (jamais dans la conversation ni dans Git).
2. Redémarrage : persistance de l'enregistrement, connexion, IP. Vérifier : identité inchangée (`deviceId`, clé publique), register 200, pull 200, vote, image + ACK, DHT22, SGP40 + indice chiffré, microSD, animation.
3. Client OTA actif (≈ 90 s après le démarrage) : `GET /firmware-r4/tft18/canary/manifest.txt` → **404 propre** ; lire la séquence installée (attendu 14).
4. Seulement ensuite : B = séquence effective de A + 1 (15), **sans Wi-Fi** (wifi-guard), second GO avant publication.

## Ce qui n'est PAS prouvé
Portail sur la station · tenue du tas avec le portail et le produit complet · téléchargement TLS d'une image de ~190 Ko depuis le site de production · séquence réellement stockée sur la carte (13 supposée minimale, à lire) · « deux essais OTA Internet R4 » rapportés par le porteur : aucune pièce rattachée.

## Pin de B — `r4tft18-2.9`, séquence 15 (30/10/2026, construit, NON publié)
- Différence avec A (`r4tft18-2.8`, séquence 14) : texte du TFT en argent clair (`C_SOFT`) au lieu du gris foncé ; version portail 2.9. Mêmes options : `POD_SENSORS=1 POD_ENV_DISPLAY=1 POD_SD_CS_PIN=4 POD_OTA_R4=1 POD_WIFI_PORTAL=1 OTAR4_COMPILED_SEQ=15`.
- Image : 191 828 o, SHA-256 `5f5b58275ba0fd2ba7ff69babf80b85e00b1f58c227af5d681d08684d1474558` ; flash 191 820 o, RAM statique 18 452 o (identiques à A).
- Manifeste signé `r4-a` : famille `uno-r4-wifi-tft18`, canal `canary`, seq 15, 338 o, SHA-256 du fichier `47d0b18d49d981f00d7d885a364913d251b39f7b4eb8067addfa0a02bb1d8d80`. `verify-manifest` : ACCEPTÉ pour une carte en séquence 14, REFUSÉ (rejeu) à 15.
- `wifi-guard` : 2 valeurs interdites absentes, marqueur `PODWIFI:record-v1` présent, aucun `secrets.h` réel.
- Fichiers hors Git : `canary-builds/r4-release-B15/{manifest.txt,firmware.bin}`. Production : `/firmware-r4/tft18/canary/*` répond 404 (rien de publié).
