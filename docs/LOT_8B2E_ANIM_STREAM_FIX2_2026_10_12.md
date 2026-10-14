# LOT8B2E — ANIM-STREAM-FIX2 : pic de tas du téléchargement, portabilité Windows des tests, mutant « pile SD » (12 octobre 2026)

**Base :** `685b1a0` (rapport d'audit) sur `480eacd`. **Périmètre :** `arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino` (une fonction) + tests / harnais hôte. Aucun changement de serveur, protocole, vote, polling, OTA ni d'autre firmware ; `pod_sd_stack.h` INCHANGÉ ; `POD_RENDER_V1 = 0`, `POD_CANARY = 0`. **Compilé + hôte seulement, jamais flashé.**

## 1. Pic de tas (`fetchAnimToSd`)
Avant : `work` (2 048 o) alloué AVANT `netGetBlockClipToSd()`, donc vivant pendant la transaction TLS (pile réseau de 2 048 o) sur un plus grand bloc de 4 884 o. Maintenant : suppression de l'ancien marqueur/clip → téléchargement COMPLET (retour de `netGetBlockClipToSd` = client TLS détruit, pile réseau libérée) → seulement si réussi, `malloc(ANIM_WORK_BYTES)` → validation + marqueur → `free(work)`. Échec d'allocation après téléchargement : `[ANIM] mémoire insuffisante (… o de travail) après le téléchargement : clip supprimé, animation non activée`, clip et marqueur supprimés, `animOn` inchangé, retour `false`.

Preuves : harnais — le tampon de 2 048 o du SKETCH (distingué des piles de PodNet par la sonde 1) est suivi (`g_workLive`) ; toute requête réseau émise pendant qu'il est vivant incrémente `g_workLiveDuringNet` (bilan : 0). Scénarios : nominal, téléchargement incomplet (aucune allocation), tampon refusé APRÈS le téléchargement (1 requête, rien d'inscrit, journal explicite). Test statique : une seule allocation, située entre le téléchargement et la validation. Mutants refusés : tampon alloué avant le téléchargement, jamais libéré, validation sans tampon, échec silencieux.

## 2. Portabilité Windows (tests et shims seulement)
- `animStream.test.ts` : découpage `/\r?\n/` (sortie du harnais en CRLF).
- `tft28_mock.h` : `struct mallinfo` / `mallinfo()` simulés sous MinGW (absents de `<malloc.h>`), uniquement pour l'hôte.
- `tft28Host.test.ts` : `pod_sd_stack.h` lu avec normalisation CRLF. **Cause réelle du « mutant SD non détecté » du rapport précédent sous Windows : le motif de mutation contient `\n`, ne s'appliquait pas à un fichier CRLF, le « mutant » était identique à l'original.**

## 3. Sensibilité à `onSd()` qui renverrait `true` sans exécution
Nouveaux scénarios (production ; en canari une pile dédiée indisponible provoque l'arrêt sûr, couvert par `halt:sd-nomem`) : (a) pile SD refusée pendant la lecture résidente → `AE_ERROR`, aucun octet sur le bus TFT, aucune requête ni ACK, cause journalisée ; (b) pile SD refusée pendant la validation (cible : l'allocation qui suit la requête du clip) → clip et marqueur supprimés, `animOn` faux, « validation du clip NON faite ». Le mutant `return true` de `pod_sd_stack.h` est maintenant refusé (test « CONTRÔLES NÉGATIFS »).

## 4. Vérifications
Tests ciblés dans le vrai worktree Windows (g++ 14.2) : **94 / 94** (animStream, tft28AnimStream, tft28Host, tft28Canary, tft28RegisterStack, benchHeaderCopies, netStack, edStack, animClip). Compilations réelles production + canari, cœurs 1.5.3 et 1.6.0 : OK, sans avertissement du sketch ; flash +64 o, RAM statique inchangée (21 468 / 21 464 o). Analyse statique : lecture 792 o, validation 752 o (pile SD, budget 1 344 o), téléchargement 1 040 o (pile réseau, budget 1 856 o) — inchangées ; rapport de pile principale (`tft28-stack-report.js`) identique avant/après.

Limites inchangées : débit SD, marge réelle de la pile SD pendant la lecture (toucher, appels indirects) et fragmentation réelle ne sont mesurables que sur la carte. Protocole du canari : `docs/AUDIT_CLAUDE_480EACD_ET_PROTOCOLE_CANARI_TFT28_2026_10_12.md` § 5 (la ligne `pile reseau block-clip` mesure maintenant un pic sans tampon de travail).
