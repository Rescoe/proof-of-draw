# Reprise du canari OTA Internet de la station R4 TFT 1,8″ (`dev_I25D9Z7A`) — à reprendre vers le 02/11/2026

État consigné le 30/10/2026 en fin de séance. Aucune valeur secrète dans ce document.

## État final
- Carte : `dev_I25D9Z7A`, UNO R4 WiFi + TFT 1,8″, COM7 (VID 2341, PID 1002 = mode application). **État présumé : A `r4tft18-2.8`, séquence 14** (dernier enregistrement serveur lu à 15:18 UTC : `r4tft18-2.8`). À confirmer au retour (écran, ligne `[BOOT]`, champ firmware du serveur).
- Release B `r4tft18-2.9`, séquence 15 : **RETIRÉE** (commit `a9ddd4d`), `/firmware-r4/tft18/canary/manifest.txt` et `firmware.bin` répondent **404**. Les octets signés restent hors Git dans `canary-builds/r4-release-B15/` (manifeste SHA-256 `47d0b18d49d981f00d7d885a364913d251b39f7b4eb8067addfa0a02bb1d8d80`, image `5f5b58275ba0fd2ba7ff69babf80b85e00b1f58c227af5d681d08684d1474558`, 191 828 o). Ils sont republiables tels quels (même commande, mêmes octets).
- Aucun RESET, upload, portail ni retry après le retrait. Si la programmation s'était terminée tardivement, la carte serait en B/15 sans mise à jour possible ensuite (la release étant retirée).

## Ce qui est PROUVÉ (phase 1, avec port série ouvert, journal `phase1b-b15.log` + `phase1c-b15.log`, hors Git)
- Manifeste signé accepté : `mise à jour disponible : r4tft18-2.9 seq 15 (191828 o, canal canary, clé r4-a) ; installée 14`.
- Téléchargement TLS complet : statut 200, Content-Length 191 828, **191 828 o reçus en 111 s**, pile réseau 844/2048 o (marge 1 140 o).
- SHA et relecture du staging : `TICKET PRÊT : image r4tft18-2.9 seq 15 relue et conforme`.
- Programmation correctement **différée** parce qu'un hôte USB avait le port série ouvert (`R_DEFERRED_HOST`, 1 800 s avant le contrôle suivant) : comportement prévu, pas un échec.
- Le client gère le 404 (« rien à faire », prochain contrôle 21 600 s).

## Ce qui n'est PAS prouvé
- **Phase 2 (véritable OTA, port série FERMÉ)** : après un RESET unique à 14:59:19 UTC (réenregistrement visible dans `lastSeen`), le champ firmware du serveur est resté `r4tft18-2.8` pendant plus de 12 minutes (surveillance jusqu'à 15:12 UTC, lecture Redis seule). Aucun réenregistrement en `r4tft18-2.9` observé. La cause est INCONNUE : programmation BOSSA qui n'aboutit pas, programmation jamais lancée (autre report ?), ou carte revenue en A après un échec. Le journal série de cette fenêtre n'existe pas (port fermé voulu).
- Le journal série pris APRÈS le retrait montre seulement `[OTA] aucun manifeste publié (404)` : aucune information sur la tentative.
- L'écran en argent clair de B n'a jamais été vu.

## Observations utiles
- Le client contrôle 90 s après le démarrage puis toutes les 6 h ; un contrôle est suivi d'un téléchargement ≈ 111 s à 65 kbit/s ; la mise à jour part ensuite si aucun hôte USB n'a le port ouvert.
- `lastSeen` n'est réécrit que toutes les ≈ 12 min : ce n'est PAS un indicateur de panne ; seul le champ `firmware` de `device:<id>` (relu en lecture seule) compte.
- Un `git revert` raté puis un `commit --amend` ont réécrit un commit local non poussé pendant la republication (corrigé par reset sur `origin/main` ; rien de faux n'a été publié ; octets servis vérifiés identiques).

## Plan de reprise (une action matérielle à la fois, un GO par phase)
1. **Confirmer l'état** : lecture seule du champ firmware côté serveur ; puis, carte branchée, ouvrir le port en écoute SEULE et lire `[BOOT]` (version), `[OTA]` et l'état de la séquence (`Serial` n'envoie rien). Ne rien flasher.
2. **Diagnostic ciblé de la programmation** (cœur de la reprise) : lire le code du chemin de programmation différée dans `pod_ota_r4_client.h` / `otaTick` (conditions de déclenchement, détection de l'hôte USB sur le port natif, appel à BOSSA/`ota` du module, ce que devient la carte si le port série est fermé mais qu'aucun hôte n'est branché — alimentation par chargeur seul ?). Préparer un journal qui survive au redémarrage (comme la trace en flash de données des canaris AUDIT3/4) pour savoir où la programmation s'arrête sans port série.
3. **Reproduire avec la carte alimentée par un chargeur (pas de PC USB)** ou avec le PC branché mais sans moniteur ouvert, après republication des mêmes octets B/15 et UN RESET : surveiller le champ firmware 20 minutes, fenêtre de retrait automatique inchangée.
4. Si B/15 s'installe : vérifier séquence 15 inscrite, capteurs, vote, affichage, ACK, SD, animation, texte en argent clair ; mettre à jour la matrice (`OTA` pour le profil R4 TFT 1,8″ seulement alors) et `ROADMAP`.
5. Rotation du Wi-Fi et purge d'historique : toujours en attente (action de clôture, voir `INCIDENT_WIFI_DANS_BINAIRE_R4_2026_10_30.md`).

## Garde-fous maintenus
Pas de publication sans GO explicite ; pas de RESET/upload/portail automatiques ; `wifi-guard` obligatoire à la publication ; clés `r4-a`/`r4-b` hors Git ; journaux avec clé privée d'appareil hors Git (`C:\Users\thibf\pod-backups\station-20261030-112604\`).
