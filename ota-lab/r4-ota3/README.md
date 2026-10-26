# OTA-3 — sonde UNO R4 WiFi (carte + TFT 2,8″ du porteur)  ·  mis à jour le 16/10/2026 (OTA3-FIX5)

> **État réel.** La sonde a tourné sur la carte (essais du 16/10 : téléchargement, `verify()`, relecture, fichiers) mais **n'a jamais reprogrammé le RA4M1**. Compilée (cœur Renesas 1.6.0) et testée sur l'hôte (18 tests). Rien ne s'exécute tout seul : chaque étape est une commande que VOUS tapez. Lecture du code du module : `docs/OTA_R4_LECTURE_OTAUPDATE_2026_10_16.md` ; journal d'enquête : `docs/OTA3_ESSAI1_ECHEC_ET_CORRECTIFS_2026_10_16.md` ; audit : GPT du 16/10 (verdict NO-GO tant que le « ticket de flash » manquait — FIX5 l'ajoute). Aucun protocole PoD dans la sonde.

## 1. Ce que c'est

Une sonde jetable **sans écran ni capteur** (retirez le shield TFT : un essai a décroché la carte avec le TFT branché, cause non établie). Elle sait : se connecter au Wi-Fi, télécharger un `.ota` **par le module** (`OTAUpdate`), `verify()`, **relire** le fichier du module et le hacher, faire un aller-retour de fichier, lire la cause du dernier reset, et — **seulement avec un ticket de flash valide puis `YES`** — reprogrammer le RA4M1. Chaque appel au module passe par la pile dédiée `podWifiRun`.

Deux builds : **A** (téléversée par l'IDE) et **B** (cible de l'OTA, bannière `build B`). Les `.ota` sont fabriqués à partir de B ; `to-a.ota` ramène à A. **Chaque `prepare-ota3.sh` change les SHA-256 (l'heure de compilation est dans le binaire) : il faut retéléverser A après chaque préparation.**

## 2. Le ticket de flash (FIX5) — pourquoi `YES` ne suffisait pas

`U` est refusé, puis `YES` annulé, sauf si l'application a ELLE-MÊME relu `/update.bin` chez le module et constaté, **au moment de `U` puis à nouveau juste avant l'appel du module** : (1) des valeurs attendues saisies par `e <SHA-256> <taille>` ; (2) module non « sale » ; (3) dernier `verify()` = 0 ; (4) taille ≤ 245 760 o (flash applicative) et égale à l'attendue ; (5) SHA-256 égal à l'attendu ; (6) pointeur de pile initial dans la SRAM du RA4M1 ; (7) vecteur de reset impair et dans l'image chargée à 0x4000. Logique pure dans `sketch/ota3_r4_probe/ota3_ticket.h`, testée avec mutants (`tests/ticket.test.mjs`). Reste hors garde : un module hostile (il contrôle le fichier, BOSSA et RESET), l'absence de vérification BOSSA après écriture (pont 0.5.2), et le TOCTOU résiduel entre la dernière relecture et le début de la programmation.

## 3. Matériel et risques

- UNO R4 WiFi, **shield TFT retiré**, câble USB court sur un port direct du PC, même Wi-Fi 2,4 GHz. La carte est appairée au réseau PoD : hors réseau pendant l'essai ; **à la fin vous reflashez le firmware de production** (§ 7).
- Adresse d'écriture de BOSSA : `SKETCH_FLASH_OFFSET` = 0x4000 (bootloader Arduino officiel) `[code]` ; le bootloader reste en dessous. Une image cassée ou un courant coupé devrait se réparer par **double appui rapide sur RESET** puis téléversement IDE `[hyp]`, non vérifié sur votre carte : **aucune coupure dans cette séance**.
- **Après tout `verify()` négatif (ex. `badcrc`, `trunc`) : débrancher l'USB 10 s avant de retélécharger** (la sonde refuse `d`) — le module ne libère pas son contexte et plante au téléchargement suivant `[code]`. `badmagic` plante le module (boucle sur −11 puis pointeur nul) `[code]`, jamais observé proprement : écarté (`artifacts/serve-danger`). `badpayload` : effet inconnu (n'a jamais été servi à un module propre) : écarté aussi.
- `artifacts/` contient des binaires qui **embarquent votre Wi-Fi** : ignorés par git, servis sur le réseau local seulement.
- **Ne jamais** taper `U` après `d pad200` / `d pad400` (remplissage) : le ticket les refuse (taille).

## 4. Préparation sur le PC (aucune carte)

Dans Git Bash, depuis `/c/Users/thibf/Documents/App-Rescoe/proof-of-draw` :

```bash
bash ota-lab/r4-ota3/tools/prepare-ota3.sh
```
```bash
node --test ota-lab/r4-ota3/tests/*.test.mjs
```
```bash
ipconfig | grep -i ipv4
```

- Le 1ᵉʳ affiche **les deux lignes `e …` à coller dans le moniteur** (B pour aller, A pour le retour). Le 2ᵉ doit donner 18 tests verts (PATH avec `winlibs-14.2/mingw64/bin` en tête pour le test du ticket). Le 3ᵉ : l'IPv4 du **PC**.
- Serveur (fenêtre dédiée, Ctrl+C pour l'arrêter) :

```bash
node ota-lab/r4-ota3/tools/serve-r4.mjs
```

`ota-lab/r4-ota3/logs/serve-r4.log` (brut) est la preuve indépendante de ce que le module a demandé.

## 5. Procédure sur la carte

Moniteur série 115200, fin de ligne « Nouvelle ligne ». Copiez TOUT le moniteur dans `logs/journal-OTA3-<date>.txt` après chaque étape.

**Étape 0 — téléverser A** (IDE, carte UNO R4 WiFi, shield TFT retiré). Attendu : `build A`, `cause du dernier reset`, `flash de données au démarrage (8192 o) : CRC[0-451]=… CRC[452-5119]=… CRC[5120-7167]=… CRC[7168-fin]=… CRC[tout]=…` — **noter ces cinq CRC** (le verrou de vote est dans 5120–7167). `i` : module Wi-Fi (0.5.2 attendu).

**Étape 1** : `w`, `s <IPv4 du PC>:8080`.

**Étape 2 — téléchargements sans reprogrammer** (une commande à la fois, attendre la dernière ligne ; `verify()` négatif ⇒ débrancher l'USB 10 s avant la suite) :

| Commande | Attendu | Déjà observé |
|---|---|---|
| `d good` | `download` = taille de B (affichée par prepare), `verify = 0` | oui |
| `e <SHA-256 de B> <taille de B>` | `attendu enregistré` | — |
| `r` | `relu` = taille de B, SHA-256 égal, **`TICKET VALIDE`** | relecture oui ; ticket nouveau |
| `d chunked/good` | `download = -7` | oui |
| `d sigbit` / `d lenlie` | `verify = 0` | sigbit oui ; lenlie à refaire sur module propre |
| `f` puis `x` | 2000 o écrits/relus `IDENTIQUE` | oui |
| `d badcrc` | `verify = -10` ; **puis USB débranchée 10 s** | oui |
| `d trunc` | `verify = -10` ; **puis USB débranchée 10 s** | oui |

**Étape 3 — A → B → A** (si l'étape 2 est propre) :
1. `d good`, puis `e <SHA-256 de B> <taille de B>`, puis `r` → `TICKET VALIDE`.
2. `U` : la sonde relit tout (≈ 8 s) et affiche `TICKET VALIDE` puis `U ARMÉ`. Dans les 60 s, `YES` : nouvelle relecture complète, `flash de données AVANT update`, puis le module reprogramme.
3. Ne rien toucher pendant 90 s. Attendu : `build B`, mêmes cinq CRC de flash de données. Noter la durée.
4. Retour : `w`, `s …`, `d to-a`, `e <SHA-256 de A> <taille de A>`, `r`, `U`, `YES` → `build A`.
5. **Archiver** : moniteur complet, `serve-r4.log`, les cinq CRC avant/après.

**Arrêt immédiat si** : `STOP` (garde de pile) · marge de pile < 128 o · une ligne `REFUS` inattendue sur `good` · redémarrage non demandé · `download` qui ne revient pas au bout de 3 min · CRC de flash de données qui change après la reprogrammation.

## 6. Ce qui est volontairement exclu
Coupure de courant (téléchargement et `update`), `ota.begin()` / `ota.update()` sans chemin (partition de l'ESP32), HTTPS et CA, `startDownload`, `badmagic` et `badpayload`, toute intégration à `/api/pull`, tout vote, toute clé de production, tout push.

## 7. Fin de séance — restaurer la production
Ctrl+C sur le serveur ; téléverser le firmware de production R4 TFT 2,8″ (`arduino_uno_r4/pod_uno_r4`, drapeaux à 0 ; `secrets.h` et `pod_vote_pins.h` restent locaux) ; la carte doit se ré-enregistrer sans nouvel appairage (la flash de données n'est pas touchée). Renvoyer les journaux.

## 8. Contenu du dossier
`sketch/ota3_r4_probe/` (sketch, `ota3_ticket.h`, `podNetStack.h` copié, `secrets.example.h`) · `tools/` (`ota-format.mjs`, `make-ota.mjs`, `serve-r4.mjs`, `prepare-ota3.sh`) · `tests/` (18 tests : format, serveur, sûreté du sketch, ticket avec mutants) · `artifacts/`, `logs/` (ignorés par git).

## 9. Canari automatique A → B → A (OTA3-AUTO1) — double-clic sur `RUN-CANARY.cmd`

Remplace la procédure manuelle des § 4–5 : prévol, compilation, détection de la carte, **une seule confirmation `OTA3-A-B-A`** avant le téléversement de A, puis tout est automatique (ticket, reprogrammations A → B → A, suivi du port COM, contrôle du SHA-256 de la flash et des CRC de la flash de données), verdict dans `runs/<horodatage>/`. Détails, sécurité, limites et séquence de GO matériel : `docs/OTA3_CANARI_AUTOMATIQUE_2026_10_16.md`. **Jamais exécuté avec une carte** ; `RUN-CANARY.cmd --dry-run` fait le prévol et la compilation avec une carte fictive, sans énumérer ni ouvrir de port.
