# ADR OTA-5 — UNO R4 WiFi : architecture R4-B (manifeste signé, binaire brut, staging non approuvé) · 17/10/2026

> **Statut : DÉCIDÉ pour la conception et le prototype hôte/laboratoire ; AUCUNE validation matérielle de R4-B.** Complète `docs/ADR_OTA_4A_CONTRAT_DE_SECURITE_2026_10_15.md` (ESP8266, inchangé). Niveaux : `[code]` lu · `[hôte]` testé sur PC · `[carte]` observé sur matériel · `[hyp]` hypothèse. Seule affirmation publique : « OTA non généralisée ».

## 0. Ce qui est acquis (OTA-3, `[carte]`)

Sur UNE carte UNO R4 WiFi (module Wi-Fi 0.5.2), le moteur de reprogrammation fonctionne : 3 canaris A → B → A consécutifs, 6 reprogrammations par le module (BOSSA), SHA-256 de la flash programme égal au `.bin` attendu après chacune, 8 Ko de data flash inchangés, relecture octet pour octet du fichier de staging par l'application, ticket de flash, 0 retry. **Condition établie : la programmation a échoué 3/3 quand le port série du PC restait ouvert et réussi 3/3 quand il était fermé ; la cause exacte n'est pas démontrée.** Ce que le format `.ota` ne donne PAS (`[code]`, `docs/OTA_R4_LECTURE_OTAUPDATE_2026_10_16.md`) : ni authenticité (le contrôle est un CRC-32), ni famille, ni version, ni séquence ; `update(chemin)` ignore `verify()` ; un `verify()` négatif ou une magie fausse font planter le module.

## 1. Décision principale : R4-B

| | R4-A | **R4-B (retenu)** |
|---|---|---|
| qui télécharge | le module (`OTAUpdate.download`, HTTP/HTTPS à lui, CA Amazon par défaut) | **l'application** (`PodBoundedSSL`, pile dédiée, TLS déjà éprouvé sur carte) |
| format | `.ota` = en-tête + LZSS + CRC-32 | **`.bin` brut** de l'application RA4M1 ; aucun `.ota`, aucun décodeur LZSS |
| ce que traite le module avant vérification | un flux non authentifié (décodeur, CRC, assertions défaillantes `[code]`) | **des octets bruts écrits par l'application** (commandes `+FS`), jamais interprétés |
| authenticité | à ajouter par relecture | manifeste **signé** vérifié AVANT le téléchargement, hash complet vérifié APRÈS |
| surface de plantage du module | `badmagic`, `verify()` négatif, flux corrompu | aucune des trois (le chemin n'est pas emprunté) |

Recommandation : **R4-B pour tout ce qui ressemble à la production ; R4-A reste un banc de laboratoire**. Aucune découverte bloquante n'a été faite à l'audit. Réserves que R4-B n'écarte pas : le débit d'écriture `+FS` (≈ 2,7 Ko/s `[carte]`), la capacité SPIFFS pour 240 Ko (non mesurée), la marge de pile d'une écriture `+FS` à l'intérieur d'une transaction TLS (§ 6).

## 2. Frontières de confiance

```
serveur (HTTPS, NON authentifié : setInsecure) ──► RA4M1 : TLS + SHA-256 en flux, écrit des blocs ──► module ESP32-S3 (SPIFFS, BOSSA) ──► flash applicative RA4M1
        │                                                  ▲                                              │
   manifeste signé (Ed25519)  ───────── vérifié par l'APPLICATION avant tout octet de binaire ◄───────────┘ relecture complète par l'application
```

1. **Le transport n'est pas une preuve.** L'authenticité repose sur (a) la signature Ed25519 du manifeste (clé publique compilée dans le firmware), (b) le SHA-256 du binaire entier lié par ce manifeste.
2. **Le binaire téléchargé est placé dans une zone de staging non approuvée ; il ne devient flashable qu'après validation de la signature du manifeste, du hash complet et de la relecture.** (Les octets ne sont pas « déjà vérifiés » au moment où ils sont écrits : le SHA-256 est calculé en flux, mais la décision n'est prise qu'à la fin.)
3. **Le module ESP32-S3 est un programmeur BOSSA de confiance résiduelle.** Il contrôle le SPIFFS, la commande `+OTAUPDATE`, la programmation du RA4M1 et ses lignes RESET/BOOT. Un module compromis peut remplacer le fichier entre la relecture et la programmation, ou programmer autre chose : **non couvert**.
4. **TOCTOU relecture → programmation** : réduit par une dernière relecture complète juste avant l'appel (≈ 8 s pour 76 Ko `[carte]`), jamais supprimé.
5. **Le bootloader du RA4M1 ne vérifie aucune signature** `[code]` : une image de n'importe quelle origine, écrite par BOSSA ou par un câble USB, sera démarrée. La barrière est entièrement dans l'application qui autorise l'appel.
6. **Le port série d'un hôte USB doit être fermé pendant BOSSA** (constat `[carte]` du § 0). Un firmware de production n'a normalement aucun hôte ; si le PC est branché, l'OTA doit être refusée ou différée (`serial` ouvert détectable côté RA4M1 : `if (Serial)` ; à valider).

## 3. Contrat cryptographique — réconciliation avec OTA-1 / OTA-4A

Audit (`lib/otaManifest.ts`, 148 lignes ; `docs/ADR_OTA_4A…` ; `PodEd` ; ESP8266) :

| Élément | ESP8266 (OTA-1 v2 + OTA-4A) | R4 (cet ADR) |
|---|---|---|
| primitive validée sur carte | RSA-2048 PKCS#1 v1.5 / SHA-256, vérificateur à pile temporaire (T3, OTA-4B) | **Ed25519 via `PodEd`** (sign 1 316 o, verify 1 532 o de pile dédiée, marge 708 o `[carte]`, octets = RFC 8032) ; SHA-256 de la bibliothèque Crypto |
| ce que l'appareil vérifie | la signature sur le **binaire** (fichier = image ‖ trailer ‖ signature) | la signature sur un **manifeste** (≈ 300 o) qui lie le SHA-256 du binaire |
| manifeste OTA-1 v2 | vérifié par le serveur uniquement (D3), `alg = rsa2048-pkcs1-sha256`, clés `ota-a/ota-b` | **schéma distinct** `pod-ota-manifest-r4-v1`, `alg = ed25519`, clés `r4-a/r4-b` |

**Décision : algorithmes PAR FAMILLE, schémas distincts, aucun format partagé ambigu.**
- Le contrat OTA-1 v2 **n'est pas modifié** (`lib/otaManifest.ts` et ses tests intacts). Un manifeste R4 est refusé par `parseManifest` v2 (`schema inconnu`) et inversement : pas de confusion possible. Le tri famille → schéma se fera côté serveur (lot OTA-6).
- Le manifeste R4 est un **texte canonique à lignes `clé=valeur` dans un ordre fixe** (pas de JSON sur le RA4M1 : pas d'ArduinoJson, pas de pile de travail, analyse stricte en quelques dizaines de lignes de C++). Octets signés = `"POD-OTA-R4-MANIFEST-V1\n"` (séparation de domaine, jamais dans le fichier) ‖ corps exact. Hash : SHA-256 du binaire brut, hexadécimal minuscule sur 64 caractères.
- **Rotation / gestion des clés** : deux emplacements de clés publiques (`r4-a` active, `r4-b` de secours hors ligne) compilés dans le firmware ; clés de test du dépôt = zéros (**refusées**, échec fermé : un firmware compilé sans clé réelle n'accepte rien) ; la rotation = une release signée par la clé active dont le firmware embarque la nouvelle paire. Aucune clé de production dans le dépôt ; les clés privées de laboratoire restent hors git.
- **Séparation avec les clés de vote** : clés distinctes, domaine de signature distinct (le préfixe ci-dessus ne peut pas être un message de vote), stockage distinct (constantes de flash vs EEPROM). `[hôte]` testé.
- **Option non décidée (à rouvrir après essais ESP8266)** : unifier sur Ed25519 pour les deux familles (l'ESP8266 embarque déjà Ed25519 pour le vote). Elle n'est pas prise ici : l'ESP8266 a un chemin RSA validé sur carte, R4 a un chemin Ed25519 validé sur carte, et l'unification ne se décide pas sans mesure.

## 4. Contrat du manifeste R4 (refus fermé)

Champs, dans cet ordre exact, un par ligne, séparateur `=`, fin de ligne `\n`, ASCII imprimable, taille totale ≤ 512 o :
`schema` (= `pod-ota-manifest-r4-v1`) · `family` (= `uno-r4-wifi-tft28` pour le TFT 2,8″) · `firmware` (ex. `r4tft28-2.6`) · `seq` (entier ≥ 1, ≤ 2³¹−1) · `channel` (`development` | `canary` | `stable`) · `size` (1 … `0x3C000` = 245 760) · `sha256` (64 hex minuscules) · `notbefore` (secondes Unix UTC, 0 = immédiat) · `keyid` (`r4-a` | `r4-b`) · puis la ligne `sig=` suivie de 128 hex minuscules.

Refus (aucun repli) : champ inconnu / manquant / dupliqué / dans le désordre ; ligne trop longue ; caractère hors ASCII ; mauvaise famille ; `size` nulle ou > 0x3C000 ; `sha256` mal formé ; `sig` mal formée ou invalide ; clé inconnue ou nulle ; `seq` ≤ séquence installée (rejeu / downgrade) ; firmware incompatible avec `VOTE_V2_FIRMWARE` (l'appareil ne serait plus compté ni servi) ; `notbefore` dans le futur (activation différée) ; réponse réseau tronquée ou excédentaire (pas de `Content-Length`, valeur ≠ `size`, octets au-delà de `size`).

## 5. Anti-rejeu, anti-downgrade et data flash

**Inventaire de la data flash R4** (8 192 o = 8 blocs de 1 Ko ; le cœur **réécrit le bloc entier à chaque `update`/`put`**, avec une allocation de 1 Ko au tas : `EEPROM.h` « erase and write block » `[code]`) :

| Zone | Contenu | Propriétaire |
|---|---|---|
| 0–31 / 32–63 / 64 / 65–96 / 97 / 98–99 / 100–419 | clé privée Ed25519, hash de bloc, drapeau, clé publique, onboarding, tête+nombre des blocs possédés, 10 × 32 o de hash | les 5 firmwares R4 (bloc 0) |
| 420–451 / 452 / 453… | `frameId` affiché (e-ink 2,7″/2,9″) · drapeau et tampon OLED (variante 2,7″ + OLED, jusqu'à ≈ 1 476, donc dans le bloc 1) | variantes e-ink |
| **5 120–5 135 et 6 144–6 159** | **verrou de vote** (deux emplacements de 16 o dans DEUX blocs distincts, `VL_NEED = 7 168`) | TFT 2,8″ (`pod_uno_r4.ino`) |
| 7 168–8 191 | journal de localisation des canaris (bloc 7, jamais en production) | instruments |
| **blocs 2, 3 et 4 (2 048–5 119)** | **libres dans les cinq firmwares du dépôt** | — |

**Décision : deux enregistrements dans deux blocs distincts, 2 (offset 2 048) et 3 (offset 3 072)**, jamais dans le bloc 0 ni les blocs 5–6 (le plan ESP8266 « 420..447 » ne se transpose pas : sur R4 ce serait le bloc 0 des clés, réécrit en entier). Le bloc 4 reste en réserve. Raison : une écriture n'efface/réécrit QUE le bloc visé ; une coupure en cours d'écriture peut détruire ce bloc mais pas l'autre, ni les clés.

Enregistrement de 20 o : `magic 'OTS1'` · `ver` · `kind = 0xA5` · `réservé` · `seq` (plus haute séquence acceptée) · `gen` (compteur d'écritures) · `CRC-32`. Règles (échec fermé) : la séquence installée effective = max(séquence compilée dans l'image qui tourne, `seq` des enregistrements VALIDES) ; deux enregistrements non vierges et invalides tous les deux → **OTA refusée** (récupération par câble) ; écriture dans le bloc de la génération la plus ancienne, relue et vérifiée avant de considérer la séquence consommée ; la séquence ne peut qu'augmenter. Une coupure pendant l'écriture laisse l'autre enregistrement intact : `seq` ne baisse jamais, donc aucun downgrade n'est rendu possible, et le bloc 0 n'est pas touché `[hôte]` (simulateur de flash avec coupure à chaque étape). Non testé sur carte dans ce lot.

## 6. Limites (taille, mémoire, pile, temps, stockage)

- **Taille** : ≤ 245 760 o (flash applicative 0x40000 − 0x4000) ; image de test actuelle ≈ 76 Ko ; image de production TFT 2,8″ ≈ 160 Ko `[code]` (163 460 o au dernier relevé) — **non essayée**.
- **Piles (1 024 o sur la pile principale)** : TLS sur la pile réseau dédiée (`podNetRun`, 2 048 o, 1 172 o utilisés `[carte]`) ; accès au module hors TLS sur `podWifiRun` (1 536 o) ; Ed25519 sur `PodEd`. **Point ouvert** : le staging écrit des blocs au module PENDANT la lecture TLS (le binaire ne tient pas en RAM) ; `podWifiRun` ne peut pas être imbriqué dans `podNetRun` (NESTED `[code]`) ; l'écriture `+FS` doit donc s'exécuter directement sur la pile réseau, qui doit être agrandie (≥ 3 072 o proposé) et dont la marge est **à mesurer** (objectif ≥ 256 o, plancher 128 o). Aucune garantie avant mesure.
- **Blocs `+FS`** : 200 o par commande (démontrés `[carte]`) ; la limite théorique de 255 o (`uint8_t` côté module `[code]`) n'est pas démontrée et n'est pas utilisée.
- **Temps** `[carte]` : écriture ≈ 2,7 Ko/s (≥ 28 s pour 76 Ko, ≥ 90 s pour 240 Ko) ; relecture 8,2 s pour 76 Ko (≈ 26 s pour 240 Ko), à faire deux fois (après staging, juste avant programmation) ; téléchargement TLS à ajouter ; programmation ≈ 50 s.
- **Stockage SPIFFS** : capacité inconnue (`pad200`/`pad400` jamais exécutés) ; un seul fichier de staging `/update.bin`, supprimé avant chaque tentative et après tout échec.
- **Heap** : l'écriture de l'enregistrement de séquence alloue 1 Ko ; tas libre ≈ 22 Ko.

## 7. Récupération

Application incomplète ou muette : débrancher puis rebrancher ; si besoin double appui rapide sur RESET ; `arduino-cli upload --fqbn arduino:renesas_uno:unor4wifi -p <port>` (le cœur choisit son outil) a toujours fonctionné pendant OTA-3, y compris sur une carte muette après un échec `[carte]`. Le bootloader n'est jamais touché (écriture à 0x4000 `[code]`, non vérifiée sur cette carte). Aucune récupération automatique n'est promise.

## 8. Ce qui reste NON démontré

Coupure de courant (téléchargement, staging, programmation) · autre carte / autre module · firmware complet (TFT, vote, animations) avec ce chemin · flotte et déploiement progressif · TLS réel vers le CDN et la marge de pile de l'écriture `+FS` dans la transaction · capacité SPIFFS pour une image de production · stabilité du module après de nombreuses reprogrammations · détection fiable d'un hôte USB (`Serial`) · comportement si `ota.update(chemin)` reçoit un `.bin` brut (le canari lui a donné un fichier SPIFFS décompressé : même contenu, mais jamais écrit par l'application).

## 9. Suite

OTA-6 : serveur (tri famille → schéma, publication, vague), essai matériel du staging R4-B (protocole `docs/PROTOCOLE_MATERIEL_R4B_2026_10_17.md`), mesure de pile, puis intégration au firmware TFT/vote derrière un drapeau éteint par défaut.
