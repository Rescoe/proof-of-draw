# Point d'avancement — 30/10/2026 (fin de séance)

Aucune valeur secrète dans ce document. Dossier de travail : `C:\Users\thibf\pod-work` (branche `claude/rangement-final`, suit `main`). Dernier commit poussé : `9f7178b`. L'ancien dépôt `C:\Users\thibf\Documents\App-Rescoe\proof-of-draw` n'a pas été modifié.

## 1. Fait et prouvé
- **Interface web** : bouton « Dessiner » (sans emoji ni couleur superflue), cercle privé « Agents IA », indice SGP40 numérique (validé de bout en bout, indice 112 côté serveur).
- **Carte du cousin `dev_T46HBXG1`** : vrai multiscreen (e-ink 2,9″ + OLED, une identité, une voix). Cause du gel de l'OLED trouvée et corrigée. Migration OTA vers `multibwr-2.1` publiée ; la carte s'enregistre en `multibwr-2.1` avec 2 écrans. **Non confirmé : l'affichage des mesures sur l'OLED** (retour visuel du cousin attendu).
- **Rangement Git** : nettoyage fait, outillage de build reproductible, procédure nouveau PC (`docs/PROCEDURE_NOUVEAU_PC_2026_10_29.md`).
- **Station R4 TFT 1,8″ `dev_I25D9Z7A`** (UNO R4 WiFi, COM7) :
  - portail Wi-Fi (2 QR, sans gris) ; Wi-Fi **hors du binaire** ; contrôle bloquant `wifi-guard` branché sur le build et la publication ;
  - sauvegarde de la data flash avant/après, diff validé (identité inchangée) ;
  - **A `r4tft18-2.8` séquence 14 flashé par câble et validé** : SGP40, vote signé accepté (voie v1, candidats = animations), affichage + ACK (blocs #128, #129) ;
  - **B `r4tft18-2.9` séquence 15 construit, signé et vérifié** (texte argent clair `C_SOFT` au lieu du gris foncé).
- **Canari OTA Internet R4 — partie réseau/TLS prouvée sur la carte (phase 1, port ouvert)** : manifeste signé accepté, 191 828 o téléchargés en 111 s, staging relu et conforme, ticket prêt, programmation correctement différée (hôte USB). Le client gère aussi le 404.

## 2. Non prouvé / en suspens
- **Phase 2 du canari (vraie mise à jour, port fermé)** : après un RESET, la station est restée en `r4tft18-2.8` plus de 12 minutes ; aucun réenregistrement en 2.9. Cause inconnue (programmation qui n'aboutit pas, jamais lancée, ou retour en A). Release B **retirée, 404 confirmé** ; état final présumé A/14, **à confirmer**. Détail et plan : `docs/REPRISE_OTA_R4_STATION_2026_11_02.md`.
- Vote **v2** (dessin fixe) de la station : même code que 2.6 (v2 prouvé au bloc #126), non observé sur A/14.
- Écran en argent clair de B jamais vu sur la carte.
- Un seul essai OTA R4 en conditions réelles ; les « deux OTA Internet R4 » mentionnées plus tôt n'ont aucune preuve dans le dépôt.

## 3. À faire (par priorité)
1. **Reprise du canari R4** (carte alimentée, un GO par phase) : confirmer l'état (lecture seule), puis diagnostiquer la programmation différée dans `pod_ota_r4_client.h` / `otaTick` ; ajouter une trace qui survit au redémarrage ; refaire l'essai carte alimentée par chargeur ou PC sans moniteur ; republier les mêmes octets B/15 (conservés dans `canary-builds/r4-release-B15/`, hors Git).
2. Si B s'installe : vérifier séquence 15, capteurs, vote, affichage, ACK, SD, animation ; mettre à jour la matrice (colonne `OTA`) et la feuille de route.
3. **Clôture sécurité** : changer le mot de passe Wi-Fi (et le SSID si possible), ajouter les nouvelles valeurs à `~/.pod-wifi-forbidden.txt`, décider ensuite de la purge d'historique (`docs/INCIDENT_WIFI_DANS_BINAIRE_R4_2026_10_30.md`). Supprimer ensuite les anciens dossiers de build locaux contenant l'ancien Wi-Fi (`C:\Users\thibf\r4-ota-build\`).
4. Confirmation visuelle du cousin (OLED multibwr) ; suivi dans `docs/SUIVI_CANARI_MULTIBWR_EN_ATTENTE_2026_10_29.md`.
5. Divers : tester Node 22.13.0 sur le nouveau PC ; bug du drapeau `playing` (ESP BWR OLED) ; réconcilier la branche `claude/r4-tft28-portail-vote` avant fusion ; points de relecture GPT/Codex en attente.

## 4. Règles à garder
Pas de publication ni d'OTA sans GO explicite ; aucun RESET/upload/retry automatique ; pas de réécriture d'historique, de `gc` ni de force-push ; clés privées et sauvegardes (qui contiennent une clé d'appareil) hors Git et hors conversation ; ne pas réinitialiser l'ancien dépôt ; tableau de la matrice honnête (`C` / `M` / `V2` / `OTA` jamais déduits).

## 5. Fichiers de référence
`docs/CANARI_OTA_INTERNET_R4_STATION_2026_10_30.md` · `docs/REPRISE_OTA_R4_STATION_2026_11_02.md` · `docs/CARTE_DATA_FLASH_STATION_R4_2026_10_30.md` · `docs/INCIDENT_WIFI_DANS_BINAIRE_R4_2026_10_30.md` · `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` · `docs/LOT_MULTIBWR_MIGRATION_2026_10_29.md`. Journaux bruts de la séance (hors Git) : `C:\Users\thibf\pod-backups\station-20261030-112604\`.

## 6. Avant d'éteindre
La carte doit rester alimentée si possible (elle est en A/14, sans mise à jour possible tant que la release est retirée). Rien d'autre n'est en cours côté matériel.
