# OTA sur UNO R4 WiFi — ce que fait (et ne fait pas) `OTAUpdate`, lu dans le code (16/10/2026)

> **Lecture de sources seulement. Rien n'a été flashé, aucun port série ouvert, aucun serveur lancé.** Niveaux : `[code]` lu dans les sources ci-dessous · `[hôte]` testé sur l'hôte · `[hyp]` hypothèse · `[carte]` observé sur matériel (aucun ici). Complète `docs/OTA_FAISABILITE_ET_PLAN_2026_10_15.md` § 4.2 (P3–P6 du plan). Protocole d'essai : `ota-lab/r4-ota3/README.md`.

## 1. Sources lues

| Source | Version consultée | Remarque |
|---|---|---|
| Cœur Arduino Renesas, bibliothèque `OTAUpdate` (côté RA4M1) | **1.6.0**, installé localement | 166 lignes : chaque méthode n'envoie qu'une commande AT |
| Micrologiciel du module (dépôt `arduino/uno-r4-wifi-usb-bridge`) : `OTA.cpp`, `cmds_ota.h`, `BossaUnoR4WiFI.cpp`, `cmds_esp_generic.h` | branche `main` (dernière version publiée : 0.6.0) | **La version réellement flashée dans VOTRE module est inconnue** `[hyp]` : la sonde l'affiche (`WiFi.firmwareVersion`) |
| Bibliothèque `Arduino_ESP32_OTA` (téléchargement, en-tête, CRC, LZSS) | branche `main` | utilisée par le module |
| Bibliothèque `BOSSA` (programmation SAM-BA du RA4M1) | **NON lue** (sous-module du dépôt du pont) | décalage d'écriture, relecture/vérification après programmation : **inconnus** |

Ces sources sont sous GPL/LGPL : elles sont lues, **jamais copiées dans le dépôt**.

## 2. La chaîne, commande par commande `[code]`

| Appel côté RA4M1 | Ce que fait le module |
|---|---|
| `ota.begin("/update.bin")` | supprime l'éventuel fichier, fixe la magie `0x23411002` (R4). **Par défaut `formatOnFail = true`** : si SPIFFS ne se monte pas, le module **la formate** |
| `ota.download(url, "/update.bin")` | télécharge **lui-même** (HTTP ou HTTPS selon l'URL ; CA racine Amazon par défaut, `setCACert` possible). **Content-Length obligatoire** (sinon −7). Les 20 premiers octets = en-tête ; magie différente → −11 ; le reste est décodé en LZSS **octet par octet et écrit tout de suite dans le fichier SPIFFS** ; un CRC-32 est accumulé |
| `ota.verify()` | compare le CRC-32 accumulé à celui de l'en-tête : égal → 0, sinon −10. **Rien d'autre** |
| `ota.update("/update.bin")` | `BOSSA.program` : lignes BOOT/RESET → SAM-BA → **programme le RA4M1 avec le fichier** → efface le fichier → réinitialise le RA4M1. Ne consulte PAS le résultat de `verify()` |
| `ota.begin()` / `ota.update()` **sans chemin** | visent **la partition de l'ESP32 lui-même**. Jamais appelés par la sonde (testé) |

Format `.ota` `[code]` : `len` u32 · `crc32` u32 · `magic` u32 · version 8 octets (dont un bit « signature ») · flux LZSS (EI = 11, EJ = 4). Le CRC couvre `magic ‖ version ‖ flux compressé`. **`len` n'est jamais comparé à rien ; le bit « signature » n'est jamais lu.**

## 3. Conséquences pour la sécurité `[code]`

1. **`verify()` est un contrôle d'intégrité (CRC-32), pas d'authenticité.** Quiconque fabrique un `.ota` recalcule le CRC en une ligne (`ota-lab/r4-ota3/tools/ota-format.mjs`).
2. **Le module écrit le fichier AVANT de le vérifier, et `update(chemin)` ne tient aucun compte de `verify()`.** Un fichier dont le CRC est faux est déjà dans SPIFFS et **peut être flashé** si l'application appelle `update` quand même. La barrière doit donc être **dans l'application**, jamais dans le module.
3. **Pas de signature, pas d'anti-rejeu, pas de contrôle de famille ni de version** dans le format. Le contrat OTA-4A (trailer signé dans les octets, séquence, famille, clés) reste **entièrement à implémenter côté RA4M1**.
4. **Pas de retour arrière** : BOSSA reprogramme directement l'application (pas de double partition côté RA4M1). Récupération en cas d'image cassée : bootloader Renesas (double appui sur Reset → DFU) `[hyp]` — à confirmer, **jamais promis**.
5. **Transport** : le module fait son propre HTTPS (CA Amazon par défaut). Sans épinglage de notre serveur, l'authenticité ne peut reposer sur le transport (même conclusion que pour l'ESP8266).
6. **Le module expose des commandes de fichiers (`+FS`) sur le MÊME SPIFFS** : écriture par morceaux de **≤ 255 o** (champ `uint8_t`), ajout, **lecture à un décalage**, suppression. Donc l'application peut (a) **relire** ce que le module a téléchargé, (b) **y écrire elle-même** l'image qu'elle a téléchargée par sa propre pile TLS (`PodBoundedSSL`).

## 4. Deux dessins possibles (aucun décidé — dépend des mesures de la sonde)

| Dessin | Principe | Atout | Doute à lever |
|---|---|---|---|
| **R4-A** | le module télécharge ; l'application **relit** le fichier (`+FS` lecture), calcule SHA-256, vérifie la signature (Ed25519 via `PodEd`, ou RSA), contrôle le trailer, **puis seulement** appelle `update(chemin)` | pas de TLS à gérer sur le RA4M1 pour l'image ; le module garde le gros du travail | la relecture est-elle fiable et assez rapide (≈ 70–200 Ko) ? la place SPIFFS suffit-elle ? un module compromis peut tout de même changer le fichier entre la relecture et `update` (hors modèle : le module est déjà dans la base de confiance) |
| **R4-B** | l'application télécharge elle-même (`PodBoundedSSL`, pile dédiée), **écrit** le fichier chez le module (`+FS`), vérifie, puis `update` | aucune dépendance au téléchargeur ni à la CA du module | débit d'écriture (255 o par commande) ; plus de code sur une pile principale de 1 024 o |

Dans les deux cas : **trailer signé + séquence + famille + enregistrement d'état** peuvent réutiliser `podOta.h` (enregistrement de 28 o à `EEPROM` 420..447, dans les 452 premiers octets du bloc 0 que le firmware R4 utilise déjà) — **à vérifier** : sur R4, l'« EEPROM » est une flash de données de 8 Ko ; la compatibilité de l'adresse n'est pas démontrée. Le choix Ed25519 (déjà éprouvé sur carte avec `PodEd`) plutôt que RSA est à instruire : une seule primitive par plateforme est acceptable, deux plateformes = deux contrats (à écrire dans un ADR OTA-5, pas ici).

## 5. Ce que la sonde doit établir (inconnues → mesure)

| # | Inconnue | Réponse apportée par |
|---|---|---|
| U1 | version du module Wi-Fi de la carte | `i` (`WiFi.firmwareVersion`) |
| U2 | HTTP en clair accepté ; `Content-Length` exigé | `d good`, `d chunked/good` (−7 attendu) |
| U3 | place disponible dans SPIFFS | `d pad200`, `d pad400` |
| U4 | `verify()` détecte CRC / magie / troncature | `d badcrc`, `badpayload`, `badmagic`, `trunc` |
| U5 | champs ignorés (`len`, bit signature) | `d lenlie`, `d sigbit` (acceptés attendus) |
| U6 | l'application peut relire le fichier, avec quel débit et quelle fidélité | `r` après `d good` (SHA-256 relu = binaire décodé attendu) ; `f` (aller-retour de 2 Ko écrit par l'application) |
| U7 | la reprogrammation fonctionne : durée, nouvelle image démarre | `U` (build A → B) |
| U8 | l'EEPROM du firmware de production (bloc 0) est préservée | CRC-32 du bloc 0 avant / après `U` (lecture seule) |
| U9 | marge de la pile dédiée pour chaque appel (objectif ≥ 256 o, plancher 128 o) | ligne `[OTA3] pile …` après chaque appel |
| U10 | `update` malgré un `verify()` négatif flashe quand même | essai OPTIONNEL `d badcrc` puis `U` avec une image inoffensive (B) |
| U11 | comportement si le courant est coupé pendant `update` ou pendant le téléchargement | **essais SÉPARÉS, autre GO** (`slow/…`), jamais dans la première séance |
| U12 | décalage d'écriture et vérification de BOSSA | **non lisible dans les sources lues** : seulement indirectement (la nouvelle image démarre, le bootloader reste atteignable) |

## 6. Limites assumées

- Source `main` du module ≠ nécessairement le micrologiciel de la carte (U1).
- Aucun test n'a tourné sur carte : tous les « attendus » ci-dessus sont des prévisions `[code]`.
- Le format `.ota` fabriqué par nos outils est vérifié contre une **transcription** du décodeur dans le même dépôt (`ota-lab/r4-ota3/tests/format.test.mjs`), pas contre le code C++ réel du module (non compilable ici). Un `.ota` officiel n'a pas été utilisé comme témoin.
- Cette note ne dit PAS que l'OTA R4 est sûre : elle dit ce qu'il faut ajouter pour qu'elle le soit.
