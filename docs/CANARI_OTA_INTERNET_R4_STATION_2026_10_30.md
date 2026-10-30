# Canari — OTA Internet de la station R4 TFT 1,8″ (30/10/2026)

**Statut : préparé et publié (release B), firmware A à flasher par câble, NON ESSAYÉ sur la carte.** Cause du retard : la station a été flashée le 29/10 avec `POD_OTA_R4 = 0` (flags du banc `b26`) ; une carte qui n'a pas le client OTA ne peut pas se l'activer par Internet — un premier flash par câble est inévitable.

## Pièces (pin public : `docs/mesures/OTA_R4_STATION_INTERNET_2026_10_30/PIN.json`)
| | Version | Séquence compilée | Taille | SHA-256 |
|---|---|---|---|---|
| **A** (par câble, client OTA actif) | `r4tft18-2.6` (sketch de `9e9270d`) | 1 | 177 004 o | `1f11b766533b340a94f5747fba8e6cc524618c142b06f7ca680add34af664287` |
| **B** (par Internet) | `r4tft18-2.7` (sketch de `23cc3c8` : indice COV chiffré) | 2 | 177 188 o | `aa809140a0e40da75e012c423cf26b0743036d43be4abce73aeceae14f522755` |

Maximum d'une image R4 : 245 760 o. RAM globale 18 204 o (55 %). Clés Ed25519 `r4-a` / `r4-b` **générées le 30/10/2026 hors dépôt** (`~/.pod-ota-release-r4`, graines privées jamais dans Git) ; les clés publiques sont compilées dans A (`pod_ota_r4_keys.h`, ignoré par Git) et listées dans le pin. Manifeste signé `r4-a`, famille `uno-r4-wifi-tft18`, canal `canary`, vérifié par le vérificateur indépendant (`verify-manifest.mjs`) avant copie.

Publication : fichiers statiques `public/firmware-r4/tft18/canary/{manifest.txt,firmware.bin}` (CDN, aucune route, 0 commande Redis). **Retrait = supprimer ces deux fichiers** (le client reçoit 404 : rien à faire). Pas de retour arrière automatique.

## Protocole
1. Brancher la station (port série), A construit avec `secrets.h` du banc `b26` (Wi-Fi) — jamais dans Git.
2. Téléverser A (`arduino-cli upload`), ouvrir le port série (115 200), attendre ~90 s : première vérification OTA.
3. Attendu au journal : `[OTA]` mise à jour disponible (seq 2) → téléchargement TLS de 177 188 o → staging → relecture/SHA-256 → ticket → redémarrage → `r4tft18-2.7`, séquence 2 inscrite ; l'écran montre « air : indice NNN/500 ».
4. Échecs possibles et lecture : 404 (release non déployée), signature/hash refusés (rien n'est installé), débit TLS lent (≈ 1 Ko/s mesuré en écriture : compter 3 à 5 min), tas insuffisant (échec propre, nouvel essai dans 5 min).

## Ce qui n'est PAS prouvé (à ne pas affirmer avant observation)
Téléchargement d'une image de ~177 Ko **par TLS depuis le site de production** (le dépôt n'a prouvé que 10 Ko par TLS et 245 Ko en HTTP de banc) · tenue du tas avec le produit complet pendant le TLS · coupure de courant pendant la programmation · retour arrière. Les « deux essais OTA Internet R4 » rapportés par le porteur ne sont rattachés à aucune pièce du dépôt : cette procédure est la première avec commits, release et journaux.
