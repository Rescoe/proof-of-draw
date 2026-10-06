# Essai à 4 appareils — vote v2 en conditions réelles (06/10/2026)

Suite de `CANARI_2_9_PROTOCOLE.md` et `CANARI_R4_EINK29.md`. Objectif : **plusieurs matériels différents relisent le MÊME dessin, recalculent hash + métriques entières et votent en v2** ;
on compare leurs résultats. ⚠ Tout ce qui suit est **compilé, jamais exécuté sur les cartes** : seule la R4 e-ink 2,9″ a affiché une œuvre reçue le 06/10, mais son vote v2 n'a pas encore été confirmé par un journal.

## Les appareils et leurs versions

| Appareil | Dossier | Version annoncée | RAM statique (compilée) | Lit un candidat de… |
|---|---|---|---|---|
| ESP8266 + e-ink 2,9″ | `esp8266/esp_eink_2.9BWR` | `2.2` | 34 808 / 80 192 o | n'importe quel écran (tampon 4 736 o alloué avant le TLS) |
| ESP8266 + TFT 1,8″ | `esp8266/esp_tft1.8` | `tft18-2.3` | 42 016 / 80 192 o | n'importe quel écran (tampon alloué avant le TLS, seulement pour OLED / e-ink 2,9″) |
| ESP8266 multiscreen e-ink 2,7″ + OLED | `esp8266/esp_eink_2.7BW_OLED` | `multiscreen-2.4` | 47 128 / 80 192 o | n'importe quel écran (tampon statique `g_e27Buf`) |
| UNO R4 WiFi + e-ink 2,9″ | `arduino_uno_r4/pod_uno_r4_eink29` | `r4eink29-1.1` | 22 768 / 32 768 o | n'importe quel écran (tampon `blackBuf`) |
| UNO R4 WiFi + TFT 2,8″ tactile | `arduino_uno_r4/pod_uno_r4` | `r4tft28-2.5` | 21 444 / 32 768 o | n'importe quel écran (tampon statique 4 736 o) ; compilé avec la bibliothèque SD 1.3.0 |

Les trois autres ports R4 (`pod_uno_r4_eink27`, `…_eink27_oled`, `…_tft18`, écrits par GPT, versions `…-1.1`) ont la même logique mais ne font pas partie de cet essai.

**Règle commune** : un appareil relit le candidat COURANT quel que soit le type d'écran du dessin (le serveur annonce `v2 {écran, octets, hash}` à tout appareil actif). Avant la correction du
06/10 de l'après-midi, chaque firmware refusait les écrans qui n'étaient pas les siens : un dessin e-ink 2,9″ n'aurait été relu que par les 2,9″. Garde-fou : `tests/podHeaderCopies.test.ts`.

## Avant de téléverser
1. **Pousser** (`git push`) et attendre le déploiement Vercel : le serveur doit annoncer `v2`, accepter `screen` dans l'ACK, compter les votes atomiquement.
2. Variables Vercel : `STRICT_SIGNATURE` et `PIN_DEVICE_KEY` absentes ou `false` ; `ENFORCE_V2_REJECTIONS` **absente**.
3. **Wi-Fi** : dans un `secrets.h` LOCAL de chaque dossier (ESP et R4), ignoré par git et déjà prérempli ; les `.ino` ne contiennent plus aucun identifiant (`tests/noWifiSecrets.test.ts` échoue sinon). Sur une nouvelle machine : copier `secrets.h.example` en `secrets.h`.
4. Un appareil neuf ou réinitialisé a une nouvelle identité : l'appairer, puis (si c'est un remplacement) utiliser « ⇄ Fusionner » dans Mon profil.
5. `MIN_V2_APPROVALS` (Vercel, défaut 0). Le quorum est `ceil(pool × 0,51)` approbations. Si tous les appareils actifs du réseau sont vos 4 appareils v2 (pool = 4 ⇒ quorum 3) :
   - `MIN_V2_APPROVALS=3` : le bloc n'existe que si les 3 approbations sont recalculées (le vrai test) ;
   - si d'**anciens** appareils v1 sont encore actifs dans le pool, ils peuvent atteindre le quorum seuls (constat du bloc #92) : mettre au moins `1`. Sans appareil v2 capable, le candidat expire (30 min) sans bloc.

## Dessins à envoyer : IMAGES FIXES uniquement
Une **animation** (atelier `/animer`) n'a pas de spécification v2 : tous les appareils votent alors en **v1 (écho du score serveur)**, sans calcul. Pour tester la validation réelle, dessiner des images fixes.

## Déroulé
Serial 115200 enregistré dans un fichier **pour chaque carte**, noter l'heure de chaque essai.

1. **Dessin pour l'e-ink 2,9″** : les 4 appareils doivent logguer `[VALIDATE2] eink29bwr 9472 o … | e=… t=… r=… | verdict=accept`, `hash=…`, `Vote OK`.
   **Critère de parité : `hash`, `e`, `t`, `r` IDENTIQUES sur les 4 cartes** (mêmes octets, calcul entier). La page Réseau doit afficher « v2 vérifié×N ».
2. **Dessin pour le TFT 1,8″** (40 960 o), puis **pour l'e-ink 2,7″** (5 808 o) et **l'OLED** (1 024 o) : même contrôle de parité. Mesurer `en … ms` : le TFT demande 40 Ko de flux TLS.
3. **Refus forcé sur UNE carte** : `#define POD_TEST_FLIP_BYTE` en tête de son `.ino` (ESP ou R4), reflasher, dessiner. Attendu : `verdict=reject hash` chez elle, `refus enregistré (non bloquant)`,
   et le bloc est quand même miné si les autres approuvent (« refus×1 » dans la page Réseau). **Retirer la ligne ensuite.**
4. Observer `[HEAL]` (ESP : tas fragmenté ⇒ redémarrage de secours) et `maxBlock` ≥ 20 000 avant chaque TLS.

## À me rapporter
Pour chaque carte : le Serial complet, les lignes `[VALIDATE2]`, `[HEAP]`/`VALIDATE2-BEFORE` (tas, maxBlock), les durées, tout 403/422 avec la ligne Vercel. Pour la parité : le tableau
(carte × dessin → hash, e, t, r). Côté app : la page Réseau (journal des votes + niveau « v2 vérifié×N · v1 écho×M · refus×K »).

## Points de vigilance connus
- **TFT 1,8″ / multiscreen** : RAM statique plus élevée ; si `maxBlock` < 20 000 de façon répétée, le redémarrage de secours se déclenche (ESP seulement).
- **Un dessin d'un grand écran** (TFT 2,8″ : 153 600 o) prendrait ≈ 40 s à relire sur ESP8266 (limite `POD_FETCH_TIMEOUT_MS`) : hors de cet essai.
- **Appareil non appairé** : il peut encore voter (aucun contrôle d'appairage dans `/api/validation-result` : reste de P0).
- **Wi-Fi dans le dépôt** : ne jamais faire `git add .` ; vérifier `git diff --cached` avant tout commit.
