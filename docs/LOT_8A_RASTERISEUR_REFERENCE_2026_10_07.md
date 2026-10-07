# Lot 8A — Rasteriseur de référence (TypeScript) + port C++ hôte + vecteurs d'or + table `artworkHash`

| | |
|---|---|
| **Date** | 07/10/2026 — base `8c268ef` (lot 7 + LOT7-FIX1 acceptés) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Statut** | **Référence logicielle seulement. Jamais essayée sur un écran. Aucun firmware modifié, aucun matériel.** |
| **Interdits respectés** | aucun `.ino`, aucun flash, aucune variable Vercel, aucun secret, aucune route de vote / finalisation / OTA, aucun Redis, aucun Neon |
| **Budget** | Redis **+0** commande, Neon **0**, Vercel : aucune route nouvelle, aucun octet servi en plus (le rasteriseur n'est importé par aucune route) |
| **Rollback** | `git revert` du commit ; aucune donnée, aucun état à défaire |
| **Correctif** | **LOT8A-FIX1** (audit GPT) : format ANA `sha256:<hex64>` normalisé, preuves de police et d'encodage TFT renforcées — voir § 3, § 5 |
| **Correctif 2** | **LOT8A-FIX2-DOC** : un bloc du début du document avait été recopié au milieu de la règle ANA (§ 3) par un remplacement de texte défectueux ; supprimé, test de structure ajouté. Aucun code modifié |
| **Suite** | **arrêt pour audit GPT avant LOT8B** (intégration firmware / stratégie mémoire) |

## 1. Ce que le lot livre

| Fichier | Rôle |
|---|---|
| `lib/renderLayout.ts` | **source unique** de `layoutVersion = 1` : police, repli des accents, lignes du cartel, gravure, `fit`, encodage pilote ⇄ grille, hashes `frameHash` / `renderHash`, motifs de test, table `artworkIdentity` |
| `consensus-pod/src/podRender.h` | port C++ à l'identique : sans STL, sans allocation, sans flottant, tampons fournis par l'appelant ; seul `consensusPoD.h` est inclus |
| `consensus-pod/host/render_harness.cpp` | harnais hôte : relit les vecteurs, recalcule, compare ; **n'intègre aucun `.ino`** |
| `consensus-pod/test-vectors/render-vectors.txt` | **vecteurs d'or** (268 lignes, 228 rendus complets), produits par `scripts/gen-render-vectors.ts` |
| `tests/renderLayout.test.ts`, `tests/renderCore.test.ts` | 11 + 4 tests (voir § 5) |

## 2. Contrat de rendu figé par `layoutVersion = 1`

Ce que le numéro de version couvre (toute modification d'un point l'incrémente) :

* **Géométrie** : `lib/cartelZones.ts` (e-ink 2,9″ 0..13 / 114..127 → 100 lignes sûres ; 2,7″ 0..13 / 162..175 → 148 ; TFT 1,8″ 0..14 / 146..159 → 131). Le port C++ répète ces nombres ; un test les compare.
* **Police** : 5×7, avance 6 colonnes, 42 glyphes (0-9, A-Z, `: . - / #`, espace) — **la table de la R4**, relue dans `pod_uno_r4_eink29.ino` par un test. Tout autre caractère = espace.
* **Casse et accents** : majuscules ; table Latin-1 de la R4 (`Ã`+0x80..0xBF) ; tout autre caractère multi-octets = **un** `?` (donc un espace gravé) ; contrôles = espace ; octet de continuation isolé ignoré ; `Ã` final tronqué = `?`.
* **Troncature** : suppression des derniers caractères, `⌊(W−4)/6⌋` (e-ink : 48 / 43) ou `⌊(W−6)/6⌋` (TFT : 20). Séparateur ` - `. Repli `PROOF-OF-DRAW`. Centrage entier (e-ink), alignement à gauche (TFT).
* **Palette TFT** : fond `0x10C4`, or `0xFEA0`, gris `0x7BEF`, blanc `0xFFFF`.
* **Encodage** : mêmes conventions que `lib/canvasToScreen.ts` (testé octet pour octet contre `rgbaToScreenPayload`).
* **Modes** (`cartelMode`) : `hidden` = image inchangée ; `overlay` = bandes écrasées, reste intact (le rouge est conservé dans la zone sûre) ; `fit` = image entière ramenée entre les bandes puis cartel.
* **`fit`**, arithmétique **entière** : `hs` = lignes sûres ; `nw = ⌊W·hs/H⌋` ; `x0 = ⌊(W−nw)/2⌋` ; `y0` = première ligne sûre ; `sx = ⌊(2·(x−x0)+1)·W/(2·nw)⌋`, `sy = ⌊(2·(y−y0)+1)·H/(2·hs)⌋` (centre du pixel de destination), reste blanc. Valeurs : 2,9″ → 231 × 100, marge 32 ; 2,7″ → 222 × 148, marge 21 ; TFT 1,8″ → 104 × 131, marge 12 (largeurs paire et impaire couvertes).
* **Écrans sans cartel gravé** (OLED 0,96″, TFT 2,8″) : plans **inchangés quel que soit le mode** (figé, testé, présent dans les vecteurs).
* **Hashes** (domaines gelés au lot 7) : `frameHash = SHA-256("pod-frame-v1|écran|WxH|plans|" ‖ plans reçus)` ; `renderHash = SHA-256("pod-render-v1|écran|WxH|plans|layoutVersion|mode|" ‖ plans finaux)`. `renderHash` désigne le **framebuffer logique** envoyé au pilote, pas les pixels physiquement visibles.

## 3. Table de décision de l'`artworkHash` (« absent plutôt qu'inventé »)

| Type de bloc | `artworkHash` | Étiquette | Pourquoi |
|---|---|---|---|
| Humain v2 (`blockVersion 2`), image fixe | `contentHash` du bloc | `block-content-hash` | rawHash voté, recalculable depuis l'image |
| Humain v2, animation `rulesVersion 2` | `contentHash` (= `animRoot` v3) | `anim-root-v3` | recalculable depuis le clip |
| Animation v1 (`kind: "animation"`, sans `blockVersion`) | `anim.root` v1 | `anim-root-v1` | recalculable depuis le clip stocké ; domaine **différent** du v3 |
| Humain v1 / legacy (image fixe) | **ABSENT** | — | `imageHash` n'est que le SHA-256 du JSON base64 du tampon d'UN écran : ce n'est pas le rawHash voté ; le recalculer exigerait de relire l'image (Redis) et donnerait une valeur que personne n'a jamais votée |
| ANA avec `contentHash` valide : **`sha256:<64 hex minuscules>`** | les **64 hex nus** (préfixe retiré) | `ana-declared` | **déclaré** par ANA, non recalculable par PoD — l'étiquette le dit |
| ANA ancien sans `contentHash` | **ABSENT** | — | le `blockHash` ANA identifie la **publication** (source, écran, agent, date), pas le contenu : une révision garde le même hash |
| ANA + champs PoD (`contentHash` PoD, sans `contentHash` ANA) | **ABSENT** | — | on n'emprunte jamais l'identité d'un autre système |
| `contentHash` ANA mal formé (64 hex **nus** sans préfixe, mauvaise longueur, majuscules, espace / saut de ligne, autre préfixe, non-chaîne) | **ABSENT** | — | jamais « réparé » : format strict |
| `contentHash` / racine PoD préfixé `sha256:` | **ABSENT** | — | le préfixe n'est accepté que côté ANA ; les hashes des blocs PoD sont des hex nus |

Fonction pure `artworkIdentity()` (retourne `{hash|null, source|null, reason}`). Elle n'est **appelée par aucune route** : le branchement serveur (lot 8B/8C) décidera où l'exposer.

**Normalisation ANA (LOT8A-FIX1).** ANA émet toutes ses empreintes sous la forme `sha256:<64 hex minuscules>` (`lib/scene/hash.ts` : `hashArtworkSource`, `hashSceneJson`, `hashGenerativeBundle` ; feed V2 des poèmes, manifestes et scènes). La version initiale du lot n'acceptait que les 64 hex nus et aurait donc déclaré « sans identité » toutes les œuvres ANA réelles. Règle désormais : côté ANA, **seul** `^sha256:[0-9a-f]{64}$` est accepté ; `artworkHash` = les 64 hex **sans** le préfixe (même représentation que les `contentHash` des blocs PoD, l'origine restant portée par l'étiquette `ana-declared`). Tests : valeurs réelles produites par les fonctions du contrat (poème, scène, capture) + 13 falsifications refusées.

**Exigence du LOT 8B (non réalisée ici).** `AnaWorkMeta` (`lib/anaChain.ts`) ne conserve pas aujourd'hui le `contentHash` et `toWorkMeta()` (`lib/anaFeed.ts`) l'abandonne. Le branchement du lot 8B devra : (a) ajouter `contentHash` à `AnaWorkMeta` ; (b) le recopier dans `toWorkMeta()` ; (c) le stocker dans l'**enregistrement existant** de l'œuvre — **aucune commande Redis supplémentaire** (même `SET`/`HSET`, un champ de plus) ; (d) passer sa valeur brute (`sha256:…`) à `artworkIdentity`. Les œuvres ANA déjà enregistrées sans ce champ resteront « sans identité » (jamais reconstituées).

## 4. Vecteurs d'or

`rfont` (table de police), `rtext` (repli des accents : table Latin-1 complète + chaque champ des cas), `rvec` (écran, motif, graine, mode, n° de bloc, date, artiste, titre → `frameHash` + `renderHash`).

* **A** : 8 motifs (blanc, plein, bord, limites des bandes, damier, rayures, bruit, noir/rouge) × 3 modes × 3 écrans à cartel ;
* **B** : 16 cas de texte (normal, très long, accents, vide, titre seul, artiste seul, caractères inconnus / UTF-8 invalide / contrôles, parités 1 et 2, minuscules, titres de 19/20/21/47/48/49 caractères) × 3 modes × 3 écrans ;
* **C** : OLED et TFT 2,8″ (octets pseudo-aléatoires) × 3 modes × 2 graines ;
* motifs et plans pseudo-aléatoires **déterministes des deux côtés** (`hash32`, arithmétique modulo 2³²) : le fichier ne contient que des paramètres et des hashes, pas d'image.

Le fichier commité doit être identique à la sortie du générateur (test) ; le harnais C++ retrouve les **495 vérifications** (dont 228 rendus) ; un contrôle négatif (hash, mode, n° de bloc, texte, police modifiés ; commande inconnue, ligne mal formée, mode inconnu, fichier vide) est **détecté**.

## 5. Tests

`renderLayout.test.ts` (11) : police == R4 (**les trois firmwares R4 parsés et comparés en entier**, 42 × 5) ; géométrie == `cartelZones` == `podRender.h` ; texte ; encodage == production **octet par octet** (e-ink 2,9″ / 2,7″ et **TFT 1,8″** sur des mots 16 bits quelconques et sur un rendu avec cartel) + aller-retour ; modes ; formule du `fit` pixel par pixel ; écrans sans cartel ; hashes recalculés à la main ; table `artworkHash` (valeurs ANA réelles, format strict) ; fraîcheur et couverture des vecteurs ; périmètre (aucun import Redis / route / firmware).
`renderCore.test.ts` (4) : différentiel C++ (`g++ -std=c++11 -Wall -Wextra -Werror`, ignoré **en le disant** sans compilateur), contrôle négatif, portabilité (ni `String`, ni allocation, ni STL, ni flottant, ni E/S ; aucune variable statique modifiable), seul consommateur de `podRender.h` = le harnais.

## 6. Limites et dette assumées (à traiter au LOT 8B)

1. **Version hôte à grille logique complète** : 75 776 o par grille pour l'e-ink 2,9″ (et il en faut **deux** pour `fit`), 40 960 o pour le TFT 1,8″. C'est la **définition de l'algorithme**, pas la stratégie mémoire des microcontrôleurs (règle 8 du CLAUDE.md : ≤ 40 000 o de RAM statique, aucun gros tampon pendant le TLS). Le lot 8B doit prouver, par différentiel, qu'un rendu **pixel par pixel sans grille** (e-ink : chaque pixel de sortie calculé depuis les plans reçus, 4 736 o par plan ; TFT 1,8″ : compositeur **ligne par ligne**, SHA-256 alimenté par la même ligne) donne **les mêmes hashes** que cette référence. Aucune équivalence n'est affirmée avant cette preuve.
2. Les firmwares gravent aujourd'hui le cartel avec leurs propres routines : leur identité avec ce rasteriseur n'est **pas** établie (positions de texte, polices du TFT, ports ESP8266 / R4 non identiques — voir le lot 7). C'est précisément l'objet du 8B.
3. Rapport de rendu **non signé** : la signature `pod-render-v1` reste prévue au lot 8 ; tant que ce n'est pas fait le rapport reste « non authentifié ».
4. Aucune mesure d'affichage réel : `renderHash` ne prouve pas ce que l'œil voit.

## 7. Niveau d'assurance

Aucun niveau d'assurance de la synthèse « Apprendre » ne change (aucune route, aucun firmware, aucune activation) : `roadmap.ts` et `SynthesisPath.tsx` restent inchangés.
