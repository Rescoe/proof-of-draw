# Canari — OTA Internet de la station R4 TFT 1,8″ (30/10/2026) — A PROPRE PRÊT (compilé), **EN ATTENTE DU GO FLASH USB**

**Statut : aucune release publiée, aucun flash.** La release `r4tft18-2.7` séquence 2 a été publiée par erreur puis retirée (`d76e3f0`, 404 prouvé) : ce n'est pas un échec matériel. Incident Wi-Fi : `INCIDENT_WIFI_DANS_BINAIRE_R4_2026_10_30.md`. Tous les builds A/B précédents (qui contenaient l'ancien Wi-Fi) sont INVALIDES et ne seront jamais publiés ni flashés.

## Objectif
Un SEUL dernier flash USB installe la station complète : portail Wi-Fi, enregistrement persistant des identifiants, client OTA Internet actif, canal `canary`. Toutes les mises à jour suivantes sont publiables sans secret Wi-Fi dans le binaire (contrôle bloquant `wifi-guard.mjs`).

## A (à flasher) — pin : `docs/mesures/OTA_R4_STATION_INTERNET_2026_10_30/PIN.json`
| | |
|---|---|
| Firmware | `r4tft18-2.8` (portail), famille `uno-r4-wifi-tft18`, canal `canary` |
| Séquence compilée | **14** (> 13, plus haute séquence connue sur `dev_I25D9Z7A`) |
| Taille / flash / RAM | 191 188 o ; flash 191 180 o (72 %) ; RAM globale 18 452 o (56 %) ; maximum d'une image OTA R4 : 245 760 o |
| SHA-256 | `30f1a1d0478e1270888ecb00a0517025f8009d5d1ddfdf462accd4ea65a8ac08` |
| Options compilées | `POD_SENSORS=1` (DHT22 + SGP40 + indice COV), `POD_ENV_DISPLAY=1` (écran de station), `POD_SD_CS_PIN=4` (microSD, animations), `POD_OTA_R4=1`, `POD_WIFI_PORTAL=1`, `OTAR4_COMPILED_SEQ=14` ; TLS vers le site de production ; vote v2 universel et ACK par défaut |
| Clés publiques OTA | `r4-a` `dbf04c04…8efc`, `r4-b` `dd310cbb…2ed0` (présentes dans l'image, hexadécimal texte) |
| Wi-Fi | **aucun** : `secrets.h` n'est jamais copié dans le build ; mode « enregistrement » ; ancien SSID et ancien mot de passe **absents des octets** de l'image (contrôle d'octets, 2/2 valeurs) ; marqueur `PODWIFI:record-v1` présent, `PODWIFI:compiled-v1` absent |

Carte de la data flash et procédure de récupération USB : `CARTE_DATA_FLASH_STATION_R4_2026_10_30.md`. Reconstruction : `node ota-lab/r4-ota5/tools/build-r4-station.mjs --seq 14 --keys-dir <dossier des clés publiques r4-a/r4-b> --forbid-file ~/.pod-wifi-forbidden.txt`.

## Tests (hôte) — `tests/r4StationPortal.test.ts`
Aucune zone de la data flash ne se chevauche · le portail n'écrit que `[512, 617)` · aucune constante SSID/mot de passe, `secrets.h` jamais inclus en mode portail · portail rouvrable (commande série ; automatique si la box ne répond plus) · l'écran du portail n'affiche jamais les identifiants de la box · capacités conservées · copies du portail identiques aux sources · contrôle d'octets : 6 mutants refusés (SSID présent, mot de passe présent, nouveau Wi-Fi seul fourni, marqueur compilé, marqueur absent, liste vide) et aucune valeur secrète dans les sorties · publication et build bloquants. **Limite : le portail de la station n'a jamais tourné sur la carte** (seul celui de la UNO R4 e-ink 2,9″ l'a fait, le 25/10/2026).

## Après le GO FLASH USB (aucune release publiée)
1. Flasher A, ouvrir le port série (115 200). Premier démarrage : pas d'enregistrement Wi-Fi ⇒ le portail s'ouvre (`PoD-XXXX`, QR + nom + mot de passe de session + 192.168.4.1 sur le TFT). Saisir le **nouveau** Wi-Fi sur le téléphone (jamais dans la conversation ni dans Git).
2. Redémarrage : persistance de l'enregistrement, connexion, IP. Vérifier : identité inchangée (`deviceId`, clé publique), register 200, pull 200, vote, image + ACK, DHT22, SGP40 + indice chiffré, microSD, animation.
3. Client OTA actif (≈ 90 s après le démarrage) : `GET /firmware-r4/tft18/canary/manifest.txt` → **404 propre** ; lire la séquence installée (attendu 14).
4. Seulement ensuite : B = séquence effective de A + 1 (15), **sans Wi-Fi** (wifi-guard), second GO avant publication.

## Ce qui n'est PAS prouvé
Portail sur la station · tenue du tas avec le portail et le produit complet · téléchargement TLS d'une image de ~190 Ko depuis le site de production · séquence réellement stockée sur la carte (13 supposée minimale, à lire) · « deux essais OTA Internet R4 » rapportés par le porteur : aucune pièce rattachée.
