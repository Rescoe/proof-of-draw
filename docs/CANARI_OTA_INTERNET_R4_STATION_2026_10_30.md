# Canari — OTA Internet de la station R4 TFT 1,8″ (30/10/2026) — **RELEASE RETIRÉE, PLAN À REFAIRE, AUCUN FLASH**

**Statut : la release `r4tft18-2.7` séquence 2 a été publiée par erreur puis RETIRÉE (commit `d76e3f0`, 404 prouvé sur `/firmware-r4/{tft18,sensor,tft28}/canary/manifest.txt` et `/firmware-r4/tft18/stable/manifest.txt`) avant tout essai. Ce n'est PAS un échec matériel : la station n'a jamais été branchée ni flashée pour ce test.**

## Pourquoi elle a été retirée
1. **Erreur de séquence** : le client calcule la séquence effective par `max(séquence compilée, séquence enregistrée en data flash)` et `confirmBoot()` ne la diminue jamais. Les essais documentés du produit complet sur la station ont atteint la séquence **13** (`r4tft18-2.0` seq 12 → `r4tft18-2.1` seq 13, `docs/mesures/OTA_R4_STATION_2026_10_26/ota_env_ab2.txt`) ; A était compilé en séquence 1 et B publié en séquence 2 : B aurait été refusé comme retour en arrière. Plus haute séquence connue : **13** ; aucune pièce n'en montre une plus haute.
2. **Publication avant GO** et avant le contrôle du 404 par le firmware A, contraire au protocole.
3. **DÉFAUT DE SÉCURITÉ constaté en vérifiant** : la station R4 TFT 1,8″ **n'a pas de portail Wi-Fi ni de Wi-Fi hors binaire** (`secrets.h` compilé en dur ; aucune option `POD_WIFI_PORTAL` dans ce sketch). Le binaire B publié (`firmware.bin`, SHA-256 `aa809140…`) **contenait en clair le SSID et le mot de passe Wi-Fi** du banc. Il a été servi publiquement environ 25 minutes par le CDN et figure dans l'historique Git PUBLIC (commit `0ae60a9`, non réécrit). L'outil de publication R4 n'a, contrairement à l'outil ESP, aucun contrôle « SSID absent du binaire ». Le mot de passe courant figure aussi dans 8 anciens commits publics (retirés de l'arbre depuis, jamais de l'historique) : **considérer ce mot de passe comme compromis et le changer**.

## Conséquence : B ne peut PAS être publié tel quel
Tant que le firmware de la station embarque `secrets.h`, toute image OTA publiée contient le Wi-Fi. Il faut d'abord un firmware **à Wi-Fi hors binaire** (enregistrement en EEPROM + portail de première connexion, comme `r4eink29-1.2`), puis un contrôle automatique « aucun identifiant dans le binaire » dans l'outil de publication R4. Rien ne sera publié avant.

## État du plan (aucune publication, aucun flash)
| Pièce | Valeur |
|---|---|
| Clés Ed25519 `r4-a` / `r4-b` | générées le 30/10/2026 **hors dépôt** (`~/.pod-ota-release-r4`), non régénérées ; publiques `dbf04c04…8efc` / `dd310cbb…2ed0` embarquées en hexadécimal texte (vérifié dans le binaire A) |
| A recompilé (LOCAL, ne jamais publier : contient le Wi-Fi) | `r4tft18-2.6`, **séquence 14**, famille `uno-r4-wifi-tft18`, canal `canary`, 177 004 o, RAM globale 18 204 o (55 %), SHA-256 `b3af4241dab905138f164f274364b38b020bfb5bf33d395bba3d327bcfc7e942` |
| Options exactes de A | `POD_SENSORS=1` (DHT22 + SGP40 + indice COV), `POD_ENV_DISPLAY=1` (écran de station), `POD_SD_CS_PIN=4` (microSD, lecture des clips d'animation), `POD_OTA_R4=1`, `OTAR4_COMPILED_SEQ=14`, TLS vers le site de production ; vote v2 et ACK : compilés par défaut. **Portail Wi-Fi : ABSENT de ce sketch** |
| B | **non reconstruit** (séquence prévue : séquence effective de A + 1 = 15) ; à construire seulement après vérification de A |

## Suite (chaque ligne = un GO du porteur)
1. Décider de la correction Wi-Fi hors binaire pour la station (portail) — sinon aucune OTA R4 de cette station n'est publiable.
2. GO FLASH USB de A (seq 14) ; sans aucune release publiée : lire la séquence réellement installée, vérifier que le client reçoit un 404 propre, identité, Wi-Fi, register, pull, vote, affichage, capteurs, SD, animation.
3. Construire B (séquence A + 1) avec contrôle « aucun Wi-Fi dans l'image », demander un nouveau GO avant publication.

## Ce qui n'est PAS prouvé
Téléchargement TLS d'une image de ~177 Ko depuis le site de production · tenue du tas avec le produit complet pendant le TLS · séquence réellement stockée sur la carte (13 supposé minimal, à lire) · « deux essais OTA Internet R4 » rapportés par le porteur : aucune pièce rattachée dans le dépôt.
