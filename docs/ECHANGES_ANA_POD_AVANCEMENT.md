# Échanges ANA ↔ PoD — avancement (fait / en cours / à faire)

Tenu par Claude (côté PoD) en concertation avec GPT (côté ANA). Contrat de référence :
`C:\Users\thibf\Documents\ChatGPT\ANA\notes\32-contrat-echange-ana-pod-oeuvres-2026-10-01.md` (+ note 33, coût Neon/Upstash).
Dernière mise à jour : **02/10/2026** (phase 0 scene-v1). Rien de ce qui est listé « fait » n'est déployé tant que le porteur n'a pas poussé.

## Fait — scene-v1, phase 0 PoD (02/10/2026, non déployé)

Spécification normative et décisions : **`docs/SCENE_V1_MOTEUR.md`**. Code : `lib/scene/`. 62 tests nouveaux (137 au total), `tsc` et `next build` propres.

| Sujet | Où | Preuve |
|---|---|---|
| Revalidation stricte du bundle ANA (manifeste, sceneHash, bytes, sourceHash, contentHash, suffixe d'id) ; scène seule, scène + capture, capture seule | `lib/anaFeedItem.ts`, `lib/scene/bundle.ts` | `tests/sceneV1Feed.test.ts` (9) |
| Moteur de référence unique (xorshift32, table Q15 + hash, Bresenham, midpoint, mouvements entiers) | `lib/scene/engine.ts`, `spec.ts`, `validate.ts` | `tests/sceneV1Spec.test.ts` (17), `sceneV1Engine.test.ts` (13) |
| Golden vectors **calculés par le code ANA et par PoD, identiques** (6 scènes, framebuffers OLED/TFT ticks 0/1/milieu/dernier, poster e-ink) | `tests/fixtures/scene-v1-golden.json` | générateur refuse d'écrire si ANA ≠ PoD |
| Poster e-ink par le moteur puis le chemin frame existant (aucun changement e-ink) | `lib/anaFeed.ts` | golden poster 2.7" et 2.9" |
| Paquet binaire `ANAS` ≤ 4 Ko + CRC32, rejet atomique des paquets tronqués/corrompus | `lib/scene/package.ts` | `tests/sceneV1Package.test.ts` (10) |
| Compilation unique par (contentHash, profil, classe), 1 paquet Redis par `artifactId`, pointeur léger dans la livraison | `lib/scene/store.ts`, `delivery.ts` | `tests/sceneV1Delivery.test.ts` (12) |
| `/api/pull` : `kind`/`scene` **uniquement** pour un appareil déclaré scene-v1 (réponse inchangée pour les autres) ; `/api/pull-frame?kind=scene&fmt=bin` | `app/api/pull*/route.ts`, `register` | tests de pointeur/JSON léger |
| Galerie : onglet « Scène » — aperçu animé OLED/TFT, poster e-ink, repli et erreurs visibles | `app/gallery-ana/ScenePreview.tsx` | vérifié dans le navigateur |
| Endurance : 10 s et 30 min d'animation sans aucun appel réseau ; blocs galerie remplacés par `sourceId` | tests moteur, `lib/anaChain.ts` | tests |

**Reste (phases 1–2, matériel)** : firmware OLED `dev_KAD6PKC4` (5 FPS), puis TFT (2 FPS, dirty rectangles) ; ACK/lecture bornée ; canari réel et compteurs Upstash.
**À valider avec GPT** : voir § 8 de `SCENE_V1_MOTEUR.md` (cadence sur appareil lent, scène invalide sans capture, repli en tore de `linear`).

## Fait — scene-v1, phase 2 TFT (02/10/2026, code prêt, matériel NON testé)

Détail et procédure de mesure : **`docs/SCENE_V1_FIRMWARE_TFT.md`**.

| Sujet | Où | Preuve |
|---|---|---|
| Lecteur de scènes C++ portable (même fichier sur PC et ESP8266), tampon 4 bits 10 Ko, rectangles sales | `esp8266/esp_tft1.8/ana_scene_v1.h` | `tests/sceneV1Firmware.test.ts` (9) : frames identiques octet pour octet, lecture complète, ~2 700 paquets mutés = mêmes décisions que le parseur TS |
| Rectangles sales : référence TypeScript + propriété « frame complète puis rectangle = référence » | `lib/scene/engine.ts` | `tests/sceneV1Engine.test.ts` |
| Firmware TFT `tft18-2.0` : capacité déclarée, téléchargement, vérification, TLS fermé, lecture 2 FPS, ACK `mode:"scene"`, repli | `esp8266/esp_tft1.8/esp_tft1.8.ino` | compilé xtensa (+11 Ko flash), sketch complet compilé contre le cœur ESP8266 3.1.2 |

**Reste** : test sur le TFT réel (mesures § « Mesures à faire »), phase 1 OLED (le header est prêt), benchmark 4 FPS.

## Fait (jalon « poème publié → tous les écrans opt-in »)

| Sujet | Où | Preuve |
|---|---|---|
| Lecture tolérante des items V1 **et** V2 (`schemaVersion`, `sourceId`, `media`, `display`, `capture`) | `lib/anaFeedItem.ts` | `tests/anaFeedItem.test.ts` (9 tests) |
| Poèmes : texte rendu en pixels par écran, cadre Normie 40×40 réservé, troncature visible « ... » | `lib/poemRender.ts` | `tests/screenConvert.test.ts` (4 écrans) |
| Portrait du Normie : `api.normies.art/normie/{id}/pixels`, mis en cache par instance, repli = pas de cadre | `lib/anaFeed.ts` | à tester en réel |
| **Ingestion fiable** : `chain:ana:ingested` et `meta-synced` écrits **après** la réussite ; reprise par écran (`chain:ana:screen-done`) sans doublon de blocs | `lib/anaFeed.ts` | revue de code ; non testé contre Redis |
| Items invalides marqués pour ne pas être relus ; `generative-scene` et kinds inconnus ignorés **sans** être marqués | `lib/anaFeedItem.ts` | tests |
| Capture générative `rgba8888` / `gray8` → bitmap → tous les écrans (couleur perdue : gris seulement) | `lib/anaFeedItem.ts`, `lib/anaFeed.ts` | tests du décodage ; pas de bout en bout |
| Coût Redis du contrôle : 2 `SMISMEMBER` par contrôle (au lieu d'1 `SADD` par item et par contrôle) | `lib/anaFeed.ts` | revue de code |
| Log visible du fetch du feed : `[anaFeed] HTTP 200 — N item(s)` | `lib/anaFeed.ts` | à lire dans Vercel |
| Galerie : texte du poème + visage du Normie + contexte | `app/gallery-ana/AnaWorkDetail.tsx` | visuel non testé |
| Conversion inter-écrans, 4×4 dont 2.9" BWR | `lib/screenConvert.ts` | tests (12 conversions + aller-retours) |
| Tableau de compatibilité | `docs/COMPATIBILITE_ECRANS.md` | — |
| ANA (non déployé) : le feed émet les **poèmes** au format V2 (`id = ana-work:<id>:poem:r1`, `contentHash`, `agentImageUrl`, `language`, forme normalisée), cache `ana-art-feed-v3` | `Agentic-Normie-Association/src/app/api/ana-art/feed/route.ts` | `tsc` ANA propre ; GPT à relire |

## Relecture GPT du 01/10 (note 36) — état des P0

| P0 | État |
|---|---|
| ANA ignorait les formes réelles `poem` / `manifesto` | **Corrigé** (normalisation tolérante, langue `und`, hash `forme:texte` NFC) — tests unitaires du builder encore à écrire côté ANA |
| Cache ANA expirant (réveil de Neon par un pull PoD) | **Atténué seulement** : `revalidate` 1800 s → 86 400 s, reconstruction à la publication (`revalidateTag`). La vraie solution (générations + pointeur atomique) reste à faire par GPT |
| `SCAN device:*` dans le chemin d'ingestion | **Corrigé** : `getAllDevices()` lit l'index `devices:all` (SMEMBERS + MGET = 2 commandes, repli SCAN seulement si l'index est vide) ; opt-in lus **une fois par passe** ; debounce mémoire par instance (le SET NX ne part plus à chaque pull). Bénéfice aussi pour l'annuaire, l'accueil, le profil et le réseau. À noter : `readReverseLinks` (SCAN `artist:device:*`) existe encore hors du chemin ANA |
| Livraison durable (file, ACK exact, rattrapage, hors-ligne > 2 h) | **À faire** — plus gros lot restant, avant de parler de « compatibilité terminée » |

Budget par nouvelle œuvre après correction : `32 + D` commandes + 2 de découverte pour toute la passe (valeurs de la note 36).
Tests PoD : 75 passent sur le poste de Claude ; l'erreur `uv_os_get_passwd: ENOMEM` vue par GPT vient de son environnement Windows/Node.

## À vérifier au premier test réel (poème)

1. Logs Vercel PoD : `[anaFeed] HTTP 200 — N item(s)`, puis `ingéré poem « … »`. Si `N = 0` : cache/feed ANA (voir note du 01/10).
2. `/gallery-ana` : une carte avec 4 écrans, texte du poème, visage du Normie.
3. Sur chaque appareil opt-in (`dev_KAD6PKC4` OLED + 2.7", `dev_VIRBQRV1` TFT, `dev_MN67OG7R` 2.9") : le poème s'affiche au prochain pull (~7,5 min, TTL de la frame 2 h).
4. Lisibilité sur l'OLED (≈ 13 colonnes × 7 lignes) : si trop dense, raccourcir via `display.excerpt` côté ANA.

## En cours / à faire — PoD

- **Livraison fiable (contrat § Ingestion)** : aujourd'hui une œuvre = une clé `frame:{device}:{écran}` écrasée (TTL 2 h) ; un appareil hors ligne plus de 2 h perd l'œuvre, et deux œuvres rapprochées s'écrasent. À faire : file bornée par appareil/écran, statuts `pending → displayed`, ACK exact (`deliveryId`, `payloadHash`), retry et dead-letter, **sans** coût Redis proportionnel aux frames.
- **Rattrapage à l'activation** : un appareil qui active `acceptsAnaArt` après une publication ne reçoit rien tant qu'une nouvelle œuvre n'est pas publiée (les blocs existent dans la galerie).
- **Politique de désactivation** de `acceptsAnaArt` pour ce qui est déjà en file.
- **Image du Normie** : cache par hash, placeholder déterministe avec le tokenId quand l'API est indisponible (aujourd'hui : pas de cadre).
- **Poèmes V2** : défilement local OLED/TFT ou séquence bornée (multi-frames ; mémoire ESP8266 à mesurer) ; pagination e-ink.
- **Génératif** :
  - *Capture fixe* : prête côté PoD (parseur + encodage) ; manque le **renderer isolé côté ANA** (voir note 32).
  - *`scene-v1`* : **phase 0 PoD faite (voir ci-dessus)** ; prototype matériel isolé d'abord (sous-ensemble de primitives commun aux firmwares, plafonds taille/CPU/heap, zéro requête par frame). **Exécuter du HTML/JS sur les ESP8266 actuels : NO-GO** (≈ 47 Ko de heap, BearSSL ≈ 16 Ko, TFT en streaming ligne par ligne) — avis partagé avec GPT.
  - Écrans e-ink : poster frame calculée, jamais d'animation.
- **ACK signé Ed25519** (cible durable) ; la V1 vérifie la tête de file exacte.
- **Budget Redis** : brancher réellement `incrBudget` (jamais appelé aujourd'hui), mesurer par route avant d'optimiser (`docs/IDEES_A_PLUS_TARD.md`, § Quota Upstash).
- **Récupération de blocs par l'ESP** : le firmware 2.9" envoie `ownedHashes` à l'enregistrement, ignoré par `app/api/register/route.ts`.
- **Page « Apprendre » (`app/learn/page.tsx`)** : découper en deux parcours — « Mettre en service mon ESP » (utilisateur) et « Documentation technique » (index, sous-sections, recherche) ; y intégrer les schémas de câblage déjà présents (`5da47df`) et le tableau de compatibilité. **Pas commencé.**
- **Galerie PoD** : afficher `agentImageUrl` directement (aujourd'hui : visage reconstruit depuis les pixels des Normies).
- **Firmware** : aucun changement n'a été nécessaire pour ce jalon (frame fixe).

## En cours / à faire — ANA (GPT)

- Relire et fusionner le patch du feed (poèmes V2) ; ajouter `schemaVersion/sourceId/revision/contentHash/agentImageUrl` aux **autres** items si souhaité (rétrocompat à garder : alias `pixels/canvasW/canvasH` à la racine).
- Tests unitaires du builder de feed.
- Renderer headless isolé + stockage de capture durable ; manifeste `ana-scene-v1` compagnon à la création générative.
- Respect de `PRIMORDIAL-ANA-POD` : aucune lecture Neon liée au nombre d'appareils, aucun nouveau planificateur.

## Décisions déjà prises

- `acceptsAnaArt` = toutes les œuvres d'agents ANA (dessins, poèmes, captures) sur tous les profils d'écran.
- Premier jalon = **frame fixe par profil** ; défilement et boucles ensuite.
- PoD ne résume ni ne réécrit un poème : tout extrait est explicite (`display`) et la frame l'indique (« ... »).
