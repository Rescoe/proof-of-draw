# OTA R4-B : client intégré, essais sur carte, publication (26/10/2026)

Suite de `ADR_OTA_5_R4B_MANIFESTE_SIGNE_2026_10_17.md` (conception) et `OTA3_*` (mécanique de reprogrammation). Niveaux : `[carte]` observé sur matériel · `[hôte]` testé sur PC · `[code]` lu · `[non prouvé]`.

## 1. Ce qui existe
- **Noyau** `consensus-pod/src/podOtaR4.h` (analyse stricte du manifeste signé, Ed25519, téléchargement borné, staging non approuvé, relecture, ticket, séquence anti-rejeu en data flash) — `[hôte]` 52 vecteurs, mutants refusés ; **familles** `uno-r4-wifi-tft28`, `uno-r4-wifi-tft18`, `uno-r4-wifi-sensor` (la station capteur, sans vote, est exemptée du contrôle « firmware capable de voter »).
- **Client** `arduino_uno_r4/pod_uno_r4_station/pod_ota_r4_client.h` (copié, identique, dans `pod_uno_r4_tft18_env/`). Option `POD_OTA_R4 = 0` par défaut : éteinte, rien n'est compilé.
- **Hébergement prévu** : fichiers STATIQUES `public/firmware-r4/<kind>/<canal>/manifest.txt` + `firmware.bin` (kind = `sensor` | `tft18` | `tft28`, canal = `canary` | `stable`) servis par le CDN : aucune route, **0 commande Redis**. **Fusionner ces fichiers sur `main` = envoyer la mise à jour** aux cartes du canal ; les retirer = « rien à faire » (404). Outil : `ota-lab/r4-ota5/tools/publish-r4-release.mjs` (vérifie, copie, ne commite rien). `public/firmware-r4/` est VIDE dans le dépôt (testé).
- Cadence : première vérification 90 s après le démarrage, puis toutes les 6 h (1 requête TLS vers un fichier statique) ; 30 min après un échec réseau ou de staging.

## 2. Déroulé d'une mise à jour (`checkOnce`)
1. `GET manifest.txt` (≤ 512 o, `Content-Length` obligatoire) → analyse stricte → **Ed25519** (clé publique `r4-a`/`r4-b` COMPILÉE ; sans clé : OTA inactive, échec fermé) → famille, canal, firmware capable de voter (écrans), `seq` > séquence installée, `notbefore` ≤ maintenant (la carte n'a pas d'horloge : `now = 0`, toute activation différée est refusée).
2. `GET firmware.bin` : écrit par blocs de 200 o dans `/update.bin` du **module** (staging NON approuvé) pendant la lecture (pile réseau dédiée de 3 072 o), SHA-256 au fil de l'eau.
3. Taille et SHA-256 = ceux du manifeste signé ; **relecture complète** du staging (SHA-256 des octets RELUS, vecteurs Cortex-M plausibles) → **ticket**.
4. Si un hôte USB a le port série ouvert : programmation DIFFÉRÉE (BOSSA échoue dans ce cas). Sinon le ticket est CONSOMMÉ puis `ota.update("/update.bin")` (**jamais `ota.begin(chemin)` : il supprime le fichier**) ; le module reprogramme le RA4M1 (≈ 50 s) et la carte redémarre.
5. Au démarrage de la nouvelle image (Wi-Fi + enregistrement faits) : la séquence compilée est inscrite en data flash (**blocs 2 et 3**, un effacement + un programme de 24 o, alternance, relecture vérifiée) — jamais les blocs 0 (clés), 5-6 (verrou de vote du TFT 2,8″), 7 (journaux de canari).
Les tampons de travail (2,4 Ko) sont pris au **tas** le temps d'une passe : pas de RAM statique permanente.

## 3. Essais sur carte (UNE carte, 26/10/2026 soir ; clés de TEST ; serveur de banc en HTTP clair)
| Essai | Résultat |
|---|---|
| S1 : manifeste signé (Ed25519 vérifié par le RA4M1), binaire 98 632 o, staging, relecture, ticket | **PASS** ; pile réseau : marge 2 212 o, relecture : marge 516 o, tas stable |
| S2 : 40 cas négatifs servis (signature, rejeu, downgrade, famille, canal, activation, champs, tailles, SHA-256…) | **PASS** : 37 refus de manifeste avec le code attendu + 3 binaires corrompus refusés, staging supprimé, aucun ticket |
| Mise à jour automatique A → B de la station (≈ 120 Ko en 51 s, `ota.update`, redémarrage, séquence en data flash) | **2 réussites** (seq 1→2, 3→4) ; **1 échec** (carte silencieuse après `ota.update`, port série fermé trop tard ; la course avec la fermeture du port est l'hypothèse, NON démontrée) → ajout d'un pré-délai de banc `OTAR4_PRE_UPDATE_MS` |
| Data flash : bloc 2 = seq 1, bloc 3 = seq 2 (puis alternance) | **PASS** ; le périphérique doit être fermé d'abord (`deinit`) : `read` renvoie une erreur parasite et `erase` ne fait rien s'il est ouvert |
| TLS vers la production, aucun manifeste publié | **PASS** : `404 → rien à faire` (le module vérifie la chaîne avec son lot racine) |
| TLS vers un serveur local à certificat auto-signé | **ÉCHEC non résolu** (`ECONNRESET` côté serveur, avec `setCACert`, certificat daté de 2020) |

## 4. Ce qui n'est PAS prouvé (à ne pas affirmer)
Téléchargement de l'image par TLS (seul le manifeste a été récupéré en TLS, et seulement jusqu'au 404) · coupure de courant (staging, programmation, écriture de séquence) · autre carte / autre module / autre firmware du module · retour arrière automatique (**il n'y en a pas** : une image qui démarre mal se récupère par câble, double appui RESET puis `arduino-cli upload`) · publication réelle sur le site · clés de production (seules des clés de TEST ont servi ; l'en-tête `pod_ota_r4_keys.h` est ignoré par git) · observabilité côté serveur (aucun journal renvoyé) · mise à jour par OTA du produit TFT 1,8″ complet · stabilité sur de nombreuses mises à jour.

## 5. Procédure de publication (quand le porteur donne le GO)
1. Générer les clés `r4-a`/`r4-b` de PRODUCTION hors ligne (jamais dans le dépôt) ; compiler le firmware avec le `pod_ota_r4_keys.h` de production et `OTAR4_COMPILED_SEQ` = N, canal `canary`.
2. Signer : `make-manifest.mjs --bin <firmware.bin> --seq N+1 --family uno-r4-wifi-tft18 --firmware r4tft18-X.Y --channel canary --keys-dir <clés>`.
3. `publish-r4-release.mjs --kind tft18 --channel canary --release <dossier> --pub <keys.json>`, revue, puis **fusion = envoi** aux cartes du canal canary seulement (un canal `stable` est un autre dossier).
4. Surveiller un appareil canari (série) : `[OTA] mise à jour disponible`, `TICKET PRÊT`, redémarrage, `séquence N+1 inscrite`. Retrait : supprimer les deux fichiers.

Banc : `pod_build_flags.h` (ignoré) règle `OTAR4_TLS`, `OTAR4_HOST`, `OTAR4_PORT`, `OTAR4_BASE`, `OTAR4_ALLOW_HOST`, `OTAR4_PRE_UPDATE_MS` ; serveurs `ota-lab/r4-ota5/tools/serve.mjs` (HTTP), `serve-cases.mjs` (négatifs), `serve-tls.mjs` (HTTPS de banc). Journaux : `docs/mesures/OTA_R4_STATION_2026_10_26/`.

## 6. Pièges rencontrés
`ota.begin(chemin)` supprime le fichier · `DataFlashBlockDevice` : fermer avant `read/erase` · un `Serial` ouvert fait échouer BOSSA · reset par `DtrEnable`/`RtsEnable` en PowerShell, qui refuse aussi les scripts sans `-ExecutionPolicy Bypass` · le module vérifie les certificats TLS (un auto-signé local exige `setCACert` et reste non résolu) · l'éditeur de liens refuse un tas inférieur à 8 Ko (RAM statique ≲ 23,5 Ko).
