# Canari UNO R4 WiFi + e-ink 2,9″ — vote v2 (06/10/2026)

Firmware `arduino_uno_r4/pod_uno_r4_eink29` **r4eink29-1.1** : la R4 relit le dessin candidat, recalcule SHA-256 + métriques entières (« pod-metrics-2 »),
décide d'un verdict objectif, le signe (Ed25519) et vote en v2 — **même protocole** que l'ESP8266 (`CANARI_2_9_PROTOCOLE.md`). ⚠ **Écrit et compilé, jamais
exécuté sur la carte.** Sauvegarde du firmware d'avant : `firmware-backups/2026-10-06_avant-validation-v2-r4/`.

## Ce qui a été fait
- `pod_vote_r4.h` : lecture en flux (lecteur `pod_http.h`, déjà testé sur PC) → SHA-256 (bibliothèque Crypto) + `PodFeeder` (`pod_metrics.h`, **même fichier** que l'ESP8266 : test différentiel g++ = TypeScript à 0 ppm).
- `doValidateV2()` dans le `.ino` ; `doValidate()` bascule en v2 quand le serveur annonce `candidate.v2` (sinon : vote v1 inchangé).
- Mémoire : `blackBuf` (4 736 o) sert de tampon « noir » pendant la lecture (il est ré-écrit avant le prochain affichage) ; morceau de lecture de 256 o **statique** (pile R4 petite) ; RAM globale 22 080 → 22 768 / 32 768 o.
- `pgmspace.h` n'existe pas sur le cœur R4 : la table d'entropie inclut maintenant `<Arduino.h>` (générateur `scripts/gen-pod-metrics-table.js` corrigé, copies identiques vérifiées par `tests/podHeaderCopies.test.ts`).

## Essai (cartes : la R4 ET, ce soir, l'ESP8266 2,9″ — jamais les deux sur le même dessin sans noter lequel a voté)
1. Bibliothèques : ArduinoJson, QRCode, Crypto (rweather). Carte « Arduino UNO R4 WiFi ». `secrets.h` local (jamais committé).
2. Téléverser, Serial 115200 **enregistré dans un fichier**.
3. Dessiner vers l'écran et envoyer. Attendu :
   `[VALIDATE2-avant]` (tas/pile) → `[HTTP GET] /api/candidate-frame -> 200` → `[VALIDATE2] eink29bwr 9472 o en … ms | e=… t=… r=… s=… | verdict=accept` →
   `hash=…` → `signature en … ms` → `Vote OK` → `BLOC MINÉ` → `[VALIDATE2-après]`.
4. **Refus forcé** : `#define POD_TEST_FLIP_BYTE` en tête du `.ino`, reflasher → `verdict=reject hash` et `refus enregistré par le serveur (non bloquant)`. **Retirer ensuite la ligne et reflasher.**

## À me rapporter
Le Serial complet · `[MEM]` avant/après (tas libre, pile max) · la durée `en … ms` et `signature en … ms` · tout `Echec vote (403/422)` avec la ligne Vercel ·
`connexion TLS impossible` ou `corps incomplet` s'ils apparaissent · si `e/t/r` sont **identiques** à ceux de l'ESP8266 pour le même dessin (le journal du Réseau les affiche).

## Pièges connus de cette carte
Pile principale petite : aucun gros tableau local ajouté (tout est statique). BUSY : polarité du pilote Waveshare (voir `UNO_R4_EINK29.md`). Le Wi-Fi/TLS vit sur le
coprocesseur : un flux TLS rend souvent MOINS que demandé — `readBody` boucle jusqu'au compte exact.
