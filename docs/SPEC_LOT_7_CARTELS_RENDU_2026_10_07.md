# Lot 7 — Cartels et rendu e-ink : zone du cartel (7.1 livré), contrat de rendu (gelé pour le lot 8), réception du rapport (7.5 serveur livré)

| | |
|---|---|
| **Date** | 07/10/2026 — base `f41d595`, amendé par **LOT7-FIX1** (audit GPT) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Statut** | **7.1 (zone du cartel dans l'éditeur) : livré, vérifié dans l'interface et par tests.** **7.5 (rapport de rendu) : réception et consignation côté serveur livrées, inertes tant qu'aucun firmware n'envoie le rapport ; contrat de rendu GELÉ (§ 4) pour le lot 8.** 7.2, 7.3, 7.4 : **décisions gelées (§ 6)**, code au lot 8 avec le firmware. |
| **Interdits respectés** | aucun firmware, aucune variable, aucun secret, aucune route de vote ou de finalisation, aucun changement de `canvasToScreen`, du moteur de dessin, des hashes ou des métriques ; Redis **+0** commande ; pas de push ni de déploiement |
| **Rollback** | `git revert` du commit ; aucune donnée, aucun état à défaire |

## 1. Faits relevés dans le code des firmwares [C — lecture des sources, vérifiée par test]

Le cartel est **gravé par l'appareil** après réception de l'image : les lignes des bandes sont blanchies puis un séparateur est tracé ; le texte vient de `cartelMeta` (titre, artiste, date, n° de bloc) fourni par `/api/pull`. L'image du bloc, les votes, les hashes et les métriques portent sur l'image **avant** gravure : rien n'est faussé, **l'artiste perd seulement ce qu'il a dessiné sous les bandes à l'affichage**.

| Écran (canvas) | Firmware | Lignes effacées (haut / bas) | Lignes libres |
|---|---|---|---|
| e-ink 2,9″ (296×128) | ESP8266 et **R4** | 0–13 / 114–127 | **100** |
| e-ink 2,7″ (264×176) | ESP8266 (solo et +OLED) | 0–12 / 163–175 | 150 |
| e-ink 2,7″ | **R4** (solo et +OLED) | 0–13 / 162–175 | 148 |
| TFT 1,8″ (128×160) | ESP8266 | 0–14 / 146–159 | 131 |
| TFT 1,8″ | **R4** | 0–12 / 146–159 | 133 |
| OLED 0,96″, TFT 2,8″ | tous | **aucun cartel gravé dans l'image** (le TFT 2,8″ affiche le cartel au toucher) | — |

**Zone retenue = UNION des ports** (conservatrice) : e-ink 2,9″ **100** lignes sûres, e-ink 2,7″ **148**, TFT 1,8″ **131**. `lib/cartelZones.ts` est la source ; `tests/cartelZones.test.ts` **relit les sources `.ino`** et échoue si un firmware change sa bande.
Constats : (a) **le TFT 1,8″ est aussi concerné** (18 % de l'image) ; (b) **les ports ne sont pas identiques** ; (c) le « 148 lignes » de l'audit GPT est exact pour la R4, pas pour l'ESP8266 (150) ; (d) **les rendus des ports diffèrent bien au-delà des bandes** (voir § 5).

## 2. 7.1 — zone du cartel dans l'éditeur (LIVRÉ)

| Élément | Détail |
|---|---|
| `lib/cartelZones.ts` | géométrie par écran, `cartelBandAt`, `countUnderCartel`, `FIRMWARE_CARTEL` (données de test) |
| Éditeur | **hachures dorées** sur les bandes + pointillés aux limites de la zone sûre (espace dessin : suivent zoom et rotation), **purement visuel** ; interrupteur « Zone du cartel » (menu « Affichage », activé par défaut) ; absent pour l'OLED et le TFT 2,8″ |
| Envoi | avertissement **non bloquant** : « *N points de ton dessin (X %) sont sous les bandes du cartel : <écran> les efface… Le dessin enregistré dans le bloc reste complet.* » |
| **Comptage (LOT7-FIX1)** | **suit la quantification RÉELLE de chaque écran** : on passe par l'encodeur de diffusion (`rgbaToScreenPayload`), sans seuil de couleur propre. e-ink : compté seulement ce qui devient **noir** (luminance (3R+6G+B)/10 < 128) ou **rouge** (R > 150, G et B < 100) — un gris clair devient blanc : non compté ; TFT : compté tout mot RGB565 ≠ `0xFFFF` (`#F8F8F8` : visible, compté ; `#FFFFFE` : blanc, non compté ; α < 32 : blanc). |
| Tests | 5 : géométrie dérivée des 8 firmwares, union conservatrice, bornes des bandes sur **chaque** écran, quantification (gris et couleurs très clairs, rouge limite, RGB565), câblage ; **le moteur de dessin et `canvasToScreen` ne mentionnent pas le cartel** |

**Limites** : pas d'essai sur téléphone réel ; préférence globale (pas par écran) ; l'aperçu d'envoi montre le fichier envoyé, pas le cartel gravé.

## 3. 7.5 — rapport de rendu : ce qu'il est et n'est pas

C'est un **rapport NON AUTHENTIFIÉ reçu avec l'ACK** : l'ACK n'est pas signé, n'importe qui connaissant un `deviceId` peut en forger un. Il n'a **aucune valeur de preuve** tant qu'il n'est pas signé (§ 7). Il n'est **jamais voté**, **jamais vérifié** par le serveur (qui ne connaît ni la date ni le texte gravés), **jamais public**, **jamais consigné pour une frame personnelle**, et le **type public** (`PublicShown`) **exclut `render`** (le compilateur le refuse, pas seulement l'exécution).
Corps d'ACK facultatif lu **strictement** (`sanitizeRenderReport`) : `artworkHash`, `frameHash`, `renderHash` (hexadécimal minuscule de 64 caractères), `layoutVersion` (1..255), `cartelMode` (`overlay` | `fit` | `hidden`). Consigné dans l'enregistrement d'affichage **déjà écrit** (≈ +200 octets, **0 commande Redis de plus**) ; visible dans « Mon profil → débogage des affichages » sous la mention « rapport non authentifié reçu avec l'ACK ». **Aucun firmware ne l'envoie aujourd'hui.**
**Scènes animées** : `mode = scene` ⇒ **aucun `renderHash` ni `frameHash`** (une scène qui continue à bouger n'a pas de rendu unique ; elle est identifiée par `clipHash` / `animRoot`, déjà engagés dans le bloc) : le serveur les écarte ; `renderHash` ne s'applique qu'à une **affiche ou une frame fixe**.

## 4. Contrat de rendu — TROIS niveaux de hash (GELÉ, pour le lot 8)

| Niveau | Définition | Qui le calcule |
|---|---|---|
| **`artworkHash`** = `contentHash` du bloc | **identité canonique de l'œuvre**, indépendante de l'écran : `rawHash` (SHA-256 du contenu brut voté, `lib/podMetrics.rawContent`) pour une image fixe, `animRoot` (v3) pour une animation. | le **serveur** (annoncé dans `cartelMeta` / `pull`) ; l'appareil la **recopie** — il ne peut pas la recalculer s'il affiche une conversion inter-écrans |
| **`frameHash`** | hash **exact du buffer reçu, avant toute mise en page** (avant fit, avant cartel) | l'appareil, **en flux** pendant la réception |
| **`renderHash`** | hash **exact du buffer logique FINAL** envoyé au pilote **après fit et cartel** | l'appareil, sur ce qu'il envoie au pilote |

**Domaines SHA-256 et encodages** (octets exacts ; entiers en décimal ASCII canonique, sans zéro en tête) :
```
frameHash  = SHA-256( UTF-8("pod-frame-v1|"  écran "|" W "x" H "|" nbPlans "|")                              ‖ plan₀ [‖ plan₁] )
renderHash = SHA-256( UTF-8("pod-render-v1|" écran "|" W "x" H "|" nbPlans "|" layoutVersion "|" cartelMode "|") ‖ plan₀ [‖ plan₁] )
```
- `W x H` = dimensions **logiques du canvas** (paysage : 296x128, 264x176, 128x160, 240x320), `nbPlans` = 1, sauf **e-ink 2,9″ BWR = 2** : **plan₀ = noir, plan₁ = rouge**, chacun de 4 736 octets (même ordre que `/api/pull-frame`) ;
- chaque plan est pris **tel qu'envoyé au pilote** : e-ink = octets du pilote (portrait, 1 = blanc, 0 = noir, mêmes conventions que `lib/canvasToScreen.ts`), TFT = RGB565 **little-endian**, lignes de haut en bas ;
- les deux préfixes **diffèrent** : un `frameHash` n'est jamais confondu avec un `renderHash`, même si les octets sont identiques (cas `hidden` sans fit).
**Ce que dit `renderHash`** : le **framebuffer logique** envoyé au pilote — **pas** une preuve des pixels physiquement visibles (rafraîchissement, panneau, contraste).

**Tailles** : le « tampon final de 5,8 Ko déjà en RAM » **ne vaut que pour l'e-ink 2,7″** (5 808 o). E-ink 2,9″ : 2 × 4 736 o (les deux plans sont en RAM avant l'envoi). **TFT 1,8″ : aucun framebuffer final n'existe** (le firmware reçoit 40 960 o ligne par ligne et dessine le cartel directement sur l'écran) : **prévoir un compositeur ligne par ligne** qui, pour chaque ligne reçue, applique les bandes du cartel (et le fit) **avant `writePixels`** et **alimente le SHA-256 avec cette même ligne**, sans framebuffer complet (une ligne de 256 o + contexte SHA-256). Le même compositeur sert l'écran et le hash : ce qui est hashé est exactement ce qui est envoyé.

## 5. `layoutVersion` versionne TOUT le rasteriseur
Aligner uniquement les lignes des bandes ne rend **pas** les `renderHash` comparables entre ESP8266 et R4 : aujourd'hui les textes (`"#N"` contre `" Block #N"`), les **majuscules** (R4 : `toUpperCase`), les **accents** (R4 : `asciiFold`), les **positions** du texte (ordonnée 2 contre 3), la troncature, les polices et les routines de dessin **diffèrent**. **`layoutVersion` désigne donc le rasteriseur complet** : géométrie des bandes, séparateurs, police et table des glyphes, positions, règle de troncature, casse, repli des accents, séparateur titre/artiste, palette (TFT : couleurs du bandeau), encodage et ordre des octets. **Toute modification d'un de ces éléments incrémente `layoutVersion`.** Pour que deux cartes produisent le même `renderHash`, le lot 8 doit livrer : (1) un **rasteriseur de référence en TypeScript** (source unique, géométrie = `lib/cartelZones.ts`), (2) des **vecteurs de conformité** (entrées → octets du tampon final) générés par lui, (3) le même algorithme complet dans les huit firmwares, vérifié par ces vecteurs (compilation et auto-test hôte, puis carte canari).

## 6. Décisions GELÉES (audit GPT du lot 7)
| # | Décision |
|---|---|
| D7-1 | **Éditeur : avertissement seulement** ; aucun verrouillage des bandes, aucun canvas réduit, aucune modification du dessin source. |
| D7-2 | **`fit` = transformation au moment de l'affichage** : ratio conservé, centrage, **plus proche voisin** ; aucun changement du bloc, du vote ni du replay. Formule entière proposée (à figer avec le rasteriseur de référence du lot 8) : hauteur cible = lignes sûres ; `nouvelleLargeur = ⌊W · hauteurCible / H⌋` ; décalage `x0 = ⌊(W − nouvelleLargeur)/2⌋` ; pixel source `sx = ⌊(2·(x − x0) + 1) · W / (2 · nouvelleLargeur)⌋` (même règle en `y`) ; aucun flottant. |
| D7-3 | **Réglage par appareil livré uniquement avec le firmware qui le prend en charge** ; **aucun réglage visible avant** (pas d'interface sans effet). Transport : dans la lecture de l'appareil déjà faite par le `MGET` du pull (+0 commande). |
| D7-4 | **Nouveau firmware : `fit` par défaut** ; `overlay` et `hidden` configurables par appareil. |
| D7-5 | **Harmonisation = algorithme complet commun** (§ 5), pas seulement la hauteur des bandes. |

## 7. Plan du lot 8 : rapport de rendu SIGNÉ `pod-render-v1`
Message signé avec la **clé Ed25519 déjà utilisée pour les votes** (UTF-8, forme canonique, 9 éléments) :
```
pod-render-v1|deviceId|frameId|screen|layoutVersion|cartelMode|artworkHash|frameHash|renderHash
```
joint à l'ACK (`renderSig`, hexadécimal de 128 caractères). **`frameId` (unique par frame) et `deviceId` dans le message** : un rapport ne se rejoue ni sur une autre frame ni sur un autre appareil. **Vérification côté serveur sans lecture Redis de plus** : la fiche de l'appareil (avec sa clé publique) est **déjà lue par le `MGET` de l'ACK** (`raws[2]`). Signature absente, clé absente ou invalide ⇒ le rapport reste « non authentifié » (jamais d'échec de l'ACK) ; valide ⇒ « authentifié par la clé de l'appareil » (**toujours pas** une preuve des pixels physiques). Pour une scène : pas de `frameHash` ni de `renderHash` (champs vides dans le message). Coût appareil : une signature Ed25519 par ACK (déjà présente dans le firmware de vote) ; à mesurer.

## 8. Budget et sécurité
Redis : **+0** · Neon : 0 · polling : 0 · aucune donnée envoyée au serveur par l'éditeur (comptage dans le navigateur) · aucun secret · le rapport de rendu n'entre ni dans le vote, ni dans le bloc, ni dans un hash (test).

## 9. Ce qui n'est PAS fait
Rasteriseur de référence, compositeur TFT, `fit`, `cartelMode` (réglage et firmware), signature `pod-render-v1`, harmonisation des 8 firmwares, émission du rapport : **lot 8**. Essai sur téléphone ; préférence par écran. Aucun essai sur matériel.
