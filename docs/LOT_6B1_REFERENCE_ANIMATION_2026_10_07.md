# Lot 6B-1 — Référence pure `pod-anim-v3` (TypeScript + noyau C++), sans route, sans Redis, sans firmware

| | |
|---|---|
| **Date** | 07/10/2026 — base `2922a55` (6A-R2) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Spécification** | `docs/SPEC_PODANIM_V3.md` (R2) |
| **Statut** | **Code de référence livré et vérifié bit à bit ; AUCUNE route, AUCUN Redis, AUCUN firmware, AUCUNE variable, AUCUNE activation.** Production strictement inchangée. Rien n'est essayé sur une carte. |
| **Hors périmètre (6B-2)** | route `/api/candidate-clip` + ticket HMAC (`CLIP_TICKET_SECRET`), appareil représentant par profil, `ANIM_V3_MODE` (off/shadow), contrôles du vérificateur de bloc, journal des défauts de cache. |

## 1. Livré

| Fichier | Rôle |
|---|---|
| `lib/animV3.ts` | **référence pure** : `analyzeClip` (TOTALE, ne lève jamais), `frameMetrics` (`pod-metrics-2` sur la grille logique 128×64), `frameLeaf` (46 octets, préfixe `0x02`), `framesRoot` (Merkle, nœud impair promu), `animRootOf`, agrégats entiers `E/T/R/S`, affiche (premier maximum), règles A1 (`evaluateAnimRules` : format → hash → static → noise → ok, **pas de `uniform`**), message `pod-vote-v3-anim` (`animVoteMessage` / `parseAnimVoteMessage`, 17 éléments, forme canonique stricte, `frames = 0` seulement pour `reject/format`, `E=T=R=S=0` pour `format`/`hash`), `animRejectIsObjective`. |
| `lib/podProtocolV3.ts` | `BlockCanonicalV2.rulesVersion?` : **variable par bloc** (1 = image fixe, 2 = animation ; absent ≡ 1 ; toute autre valeur **lève une exception**). Le texte canonique et le hash des blocs sans champ ne changent pas. |
| `consensus-pod/src/podAnimV3.h` | **noyau C++ en flux** : `PodAnimStream<Sha>` (automate PBC1 octet par octet : en-tête, image 0, transitions, runs, retour à l'image 0, CRC32, taille ≤ 9 216, durée ≤ 120 s), `PodMerkleStack<Sha>` (≤ 7 hachages en attente), `pod_anim_leaf`, `pod_anim_root`, `pod_anim_evaluate_rules`, `pod_anim_vote_message`. Aucun `String`, aucune allocation, aucun tampon statique ; **l'objet appartient à l'appelant** (≈ 2 Ko, borne vérifiée à la compilation par `static_assert`). |
| `consensus-pod/src/consensusPoD.h` | `PodBlockV2.rulesVersion` (1 ou 2, sinon −1) ; le texte canonique l'écrit tel quel. Les vecteurs des images fixes sont **inchangés**. |
| `consensus-pod/host/anim_harness.cpp` | harnais PC : lit chaque clip par **morceaux irréguliers** (1, 2, 3, 5, 8… 1 024 octets) et compare tout à la référence. |
| `consensus-pod/test-vectors/anim-vectors.txt` | **460 lignes dont 260 clips → 2 926 vérifications** (générées par `scripts/gen-anim-v3-vectors.ts` depuis la référence). |
| `tests/animV3.test.ts`, `tests/animV3Core.test.ts`, `tests/helpers/animV3Vectors.ts` | 13 + 4 tests (voir § 3). |

## 2. Familles de clips du différentiel (260, exigence ≥ 200)

100 animations « de dessin » (N de 2 à 64, dont 2, 3, 4, 5, 8, 16, 32, 64) · statiques (vide, plein, scène × N 2/3/5/17/64) · **alternance noir ↔ blanc** (acceptée si le clip tient dans 9 216 o, soit ≤ 7 images ; au-delà : `format` par la taille) · **damier alterné** (bruit pur) · images **aléatoires** (E = 10⁶ mais T ≈ 50 % : *pas* du bruit) · **bords des runs de 255** (1, 254, 255, 256, 509, 510, 511, 1 023, 1 024 octets) · délais extrêmes (20 ms, 2 550 ms × 47 images = limite de 120 s, × 48 = refus) · **≈ 40 clips invalides** isolant UNE cause (n = 1, `fg = bg`, boucles 1 et 100, CRC, magie, version, largeur, hauteur, drapeaux, réservé, n = 0/65, transitions, taille du corps ±1, troncatures en 13 points, octets en trop avant/après la CRC, retour ≠ image 0, délai de retour, délais 0/1, run de longueur 0, run hors image, 9 217 octets, durée 122 s, clip vide) · **60 mutations aléatoires d'octets** (avec ou sans correction de la CRC).

Des vecteurs explicites couvrent **la racine de Merkle des images pour CHAQUE N de 1 à 64** (impairs compris, nœud promu, jamais dupliqué), 24 feuilles (bornes comprises), 12 racines d'animation, 64 combinaisons de règles A1, 18 messages de vote (tous motifs, `frames = 0`) et 12 blocs (`rulesVersion` 1 et 2) + 5 valeurs refusées.

## 3. Preuves

- `npm test` : voir § 6 ; `tsc` 0 ; `g++ -std=c++11 -Wall -Wextra -Werror` sans avertissement.
- **Parité** : le noyau C++ retrouve les **2 926** vérifications de la référence.
- **Contrôles négatifs** : un caractère modifié dans une valeur attendue, dans un **octet du clip**, dans un message ou dans un bloc est détecté ; une commande inconnue ou une ligne mal formée est une **erreur** (jamais ignorée).
- **T3 (mise en page)** : les métriques d'une image PBC1 (lignes) = `pod-metrics-2` de l'écran `oled096` (pages) sur ≥ 60 images.
- **T4 (modification détectée)** : tout octet isolé d'un clip casse la CRC (boucle sur **tous** les octets) ; avec la CRC corrigée, le hash du clip et la racine changent ; délai, ordre, pixel, couleurs, nombre d'images : racines différentes (le délai et l'ordre changent `framesRoot` ; les couleurs ne changent que `animRoot`) ; `loops ≠ 0` → `format`.
- **T8 (domaines)** : un message d'image n'est pas lisible comme message d'animation et inversement ; le préfixe `pod-vote-v3` n'est pas un préfixe de `pod-vote-v3-anim|`.
- **Régression** : `rulesVersion` absent ≡ 1 → texte canonique et hash identiques ; vecteurs des images fixes inchangés (`consensus-pod/test-vectors/vectors.txt` non modifié).
- **Aucun usage en production** : test qui échoue si une route, un `.ino`, un en-tête de firmware ou une variable (`ANIM_V3_MODE`) référence `animV3`/`podAnimV3`/`pod-vote-v3-anim`.

## 4. Budget
Redis : **0**. Neon : 0. Polling : 0. Cadence firmware : inchangée. Mémoire d'un appareil futur (à mesurer en 6C, [E]) : un objet `PodAnimStream` ≈ 1,8–2 Ko + un contexte SHA-256 pour le hash salé ; temps : 64 images × (SHA-256 de 1 Ko + 8 192 pixels) **non mesuré**.

## 5. Constats de la fabrication (à relire par GPT)
1. **Limite de 9 216 octets** : une alternance noir/blanc coûte ≈ 1 042 octets par image (toutes les octets changent) : **au plus 7 images** (N = 8 et plus : `format` par la taille). Les animations « de dessin » réelles (petites différences) tiennent largement (64 images dans ≈ 4 Ko).
2. **`static` est évalué sur les empreintes d'images** (toutes égales au hash de l'image 0) : équivalent à « images identiques » aux collisions SHA-256 près, et calculable en flux sans garder l'image 0.
3. **Le clip lu en entier est toujours haché**, même si le format est refusé : un rejet `format` signe donc le hash des octets effectivement lus (conforme à la spec § 3 bis).
4. **Les 4 derniers octets d'un clip sont la CRC** : un test qui « corrige la CRC » après avoir modifié ces octets rétablit le clip d'origine (cas traité dans T4).
5. `ruleCode = rules` est accepté par le parseur du message (code des règles inconnues) mais n'est jamais objectif (`animRejectIsObjective`).

## 5 bis. 6B1-FIX1 (audit GPT de `f445ea6`) — un rejet = un message
La référence renvoyait `N = 0` pour tout échec de format alors que le parseur acceptait aussi `format` avec `frames = 2..64` : un même rejet avait plusieurs représentations. Règle fixée : **`format` ⇒ `frames = 0` et `E = T = R = S = 0` TOUJOURS** ; **`hash` ⇒ clip lisible : `frames` 2..64, métriques nulles** ; `static`/`noise`/`ok`/`rules` ⇒ `frames` 2..64. Appliquée par `animVoteShapeOk` (TypeScript, utilisée par `parseAnimVoteMessage`) **et** `pod_anim_vote_valid` (C++ : `pod_anim_vote_message` retourne −1 pour un message non canonique). 21 vecteurs `avotebad` (format avec N déclaré, format avec métriques, hash avec N inconnu ou hors 2..64, hash avec métriques, motifs avec `frames` 0, versions et bornes) sont refusés des deux côtés. Les vecteurs des images fixes (`vectors.txt`) sont **inchangés**.

## 6. Rollback
Fichiers ajoutés seulement + `rulesVersion?` optionnel dans `BlockCanonicalV2` et un champ de plus dans `PodBlockV2` (valeur explicite passée par le harnais existant). `git revert` du commit suffit ; aucun état, aucune donnée, aucune variable à défaire.

## 7. Réserves / suite
| # | Point |
|---|---|
| R1 | **6B-2** : route + ticket HMAC + représentant par profil + `ANIM_V3_MODE` (off/shadow) + vérificateur de bloc (§ 9 de la spec) + budget testé. |
| R2 | **6C** : compilation ESP8266 / R4 de l'automate (auto-test), mesures de RAM et de temps. Aucune compilation embarquée n'a été faite en 6B-1. |
| R3 | Le noyau ne vérifie pas la **signature Ed25519** (elle reste dans le sketch) ni ne construit le hash salé (`PodSalted`, existant). |
| R4 | `E`, `T`, `R`, `S` sont des **moyennes arrondies à l'inférieur** : une animation de 64 images dont une seule est du bruit n'est pas du bruit (A1 gelé sur les agrégats). |
