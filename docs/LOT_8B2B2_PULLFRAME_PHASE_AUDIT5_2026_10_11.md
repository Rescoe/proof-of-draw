# LOT 8B-2B-2 — PULLFRAME-PHASE-AUDIT5 (11/10/2026)

**Instrumentation SEULE du canari. Aucune correction. Compilé (cœurs 1.5.3 ET 1.6.0), testé sur l'hôte puis essayé sur une vraie UNO R4 WiFi + e-ink 2,9 pouces le 11/10/2026.** Base : `fd8b1dc`, commit du lot : `3387088`. Drapeaux committés : `POD_RENDER_V1 = 0`, `POD_CANARY = 0` ; le porteur a flashé une copie locale `1/1`. Serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, tailles de pile : inchangés. `pod_http.h` NON modifié.

Ce lot est la suite d'AUDIT4 acceptée en principe par GPT (`docs/AUDIT_GPT_AUDIT4_PULLFRAME_2026_10_11.md`) : « redéfinir `abort()` en canari, signature fixe + LED dédiée + boucle, mesures du tas AVANT les `read()` échantillonnés ». Les trois informations que GPT demandait avant ce lot (LED du démarrage figé, journal `gen=4`, Vercel `/api/pull-frame`) ne sont PAS toutes arrivées ; elles affineront la lecture, pas l'instrument.

## 1. Ce que le matériel a dit (canari AUDIT4, `fd8b1dc`)

Journal : `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT5_2026_10_11/journal-audit4-fd8b1dc-materiel.txt` (démarrage `gen=4`, qui relit le blocage de `gen=3`) :

```
gen=3 ; 34 elements ; DERNIERE PHASE 9 (apres client.print)
sequence : R3 Z4 C4 K5 R5 Z6 C6 K6 R12 Z13 C13 K14 R26 Z27 C27 K28
```

- 34 éléments = l'armement + les phases 1 à 9 (10) + 24 événements = **6 itérations échantillonnées de la boucle de `Reader::fill`** (itérations 1, 2, 3, 4, 8, 16 ; `R→Z` = `read()` entré puis sorti avec 0 octet, `C→K` = `connected()` entré puis sorti « vrai »). Les quatre dernières (itérations 3, 4, 8, 16) tombent à 24, 40, 96 et 208 ms : **≈ 13 ms par itération**, la 16e se termine à ≈ 224 ms.
- **Plus rien ensuite** : ni l'itération 32 (attendue vers 420 ms), ni l'événement `T1` (une seconde écoulée, écrit au premier appel après la 1re seconde). Le gel commence donc **entre ≈ 224 ms et 1 s après la remise de la requête** au module — c'est la fenêtre où la réponse du serveur commence à arriver.
- La connexion est saine (`connected` vrai), l'horloge avance jusqu'à ≈ 224 ms ; le blocage n'est donc pas immédiat. Le démarrage `gen=4` s'est figé au même endroit.
- Pile : pic de démarrage 736 o (marge 288 o) ; les autres marges sont celles d'AUDIT3/4.

## 2. Observation des LED du porteur — lecture ambiguë

Le porteur écrit : « il me semble que les 1 et 3 restent allumés sur l'ordre » (du test séquentiel F, R, C, A, H). Deux lectures :

| Lecture | LED | Compatible avec le code ? |
|---|---|---|
| comptées depuis 1 sur les cinq LED du test | F + C | **NON** : la LED A est allumée de la marque 1 à la 15 (elle devrait être vue), et F (écriture flash) et C (dans `connected`) ne peuvent pas être allumées ensemble |
| la LED F du test n'a pas été vue (le test a lieu pendant le démarrage) : les quatre vues sont R, C, A, H, donc « 1 et 3 » = R et A | **A + R** | **OUI** : c'est exactement la signature attendue d'un blocage DANS `read()` |

Non tranché. AUDIT5 aide à le trancher : le test des LED s'ouvre par un **repère « les six LED ensemble » (0,5 s)** puis les allume une à une (0,4 s chacune, plus lent), pour qu'aucune ne soit manquée ; une vidéo au téléphone suffit.

## 3. Hypothèse H5 — la piste d'`abort()` (Claude, reprise par GPT, NON démontrée)

Faits établis dans le binaire compilé (cœurs 1.5.3 = 1.6.0) :

- `operator new(size_t)` : si `malloc` renvoie 0 et qu'aucun gestionnaire n'est installé → `abort()` ; `abort` → `raise(6)` → `_exit(1)` ; `_exit` = **`b.n _exit` (boucle vide)**, interruptions actives. `__throw_length_error` aboutit au même `abort()`. Aucun message, aucun reset : l'horloge et l'USB continuent, les LED gardent leur état.
- Dans le module, `Modem::buf_read` accumule une réponse « dimensionnée » par `data_res += c` sur une `std::string` du tas ; `WiFiSSLClient::_read` demande jusqu'à `rx_buffer->freePositions() - 1` octets (≈ 511) : un bloc de plus de 480 octets force une croissance de la chaîne à 960 o (allocation contiguë, la précédente encore vivante pendant la copie). Les réponses JSON de `/api/register` et `/api/pull` (≈ 330 – 700 o avec en-têtes) passent ; le premier bloc de la réponse binaire de `pull-frame` (en-têtes + début du corps) remplit les 511 octets.
- Le tas disponible pendant la transaction : ≈ 5,7 Ko libres avant, moins 2 048 o pris par la pile réseau dédiée, avec seulement ≈ 1,9 Ko de sommet vierge (`sbrk -> limite 1900` aux points `6b` / `7a`).

Cela expliquerait : la fenêtre du gel (arrivée de la réponse), le silence indéfini, l'absence de reset, pourquoi aucun délai ne peut agir, pourquoi les petites réponses passent. Cela n'est **pas démontré** : le journal ne dit ni quel appel, ni quelle allocation. AUDIT5 sert à le démontrer ou le réfuter.

**Écart de consigne motivé — pas de `set_new_handler`** : `operator new(nothrow)` (`_ZnwjRKSt9nothrow_t`) appelle le gestionnaire s'il existe au lieu de renvoyer 0 ; en installer un détournerait les chemins « échec = rejet » (`new (std::nothrow)`) des décodeurs `PullParsed` / `RegisterParsed` / `ValidateParsed`, qui s'en servent. Seule `abort()` est redéfinie (comme GPT le demandait).

## 4. Conception (consignes de GPT)

**(a) `abort()` redéfinie** (`extern "C" void abort(void) { podFfDie(0xAB); }`, canari seulement). `podFfDie` fait EXACTEMENT : allumer la LED **X**, inscrire UNE signature (`0xAB`) dans le journal flash déjà réservé, boucler (`POD_FF_HALT()` = `for (;;) { }`). Aucune allocation, aucun `String`, ni `logf` ni Serial, aucune exception, aucun verrou du tas, **pas de `mallinfo`** (testé : le corps de `podFfDie` est vérifié au mot près). La LED X est allumée AVANT l'écriture flash (visible même si cette écriture ne revient pas) ; si le journal n'est pas armé ou plein, seule la LED reste.

**(b) Mesures du tas AVANT chaque `read()` échantillonné**, depuis `FfSSL::read` (jamais depuis `abort`) : événements **M** = tas libre total (`mallinfo().fordblks`) et **V** = sommet vierge (`sbrk(0)` jusqu'à `__StackLimit`), en unités de 32 o, plafonnés à 254 (0xFF = vierge), écrits AVANT l'événement d'entrée `R`. **Plus grand bloc libre : non disponible** — la `mallinfo` de la bibliothèque C du cœur ne renseigne que l'arène et le total libre, la liste libre n'est pas accessible sans allocation ; une sonde `malloc/free` aurait modifié le tas (elle est interdite par un test). La fragmentation reste donc inférée (total libre grand, sommet petit).

**(c) Sixième LED X** (cathode 5, anode 7). Le test de démarrage allume d'abord **les six ensemble**, puis F, R, C, A, H, X une à une.

**(d) Rapport au démarrage suivant** : `sequence` (16 derniers éléments, `#` = signature d'`abort`), légende, et une ligne `FFLOG tas avant read : libre A o puis B o ; sommet vierge C o puis D o ; abort() : OUI|non` (première et dernière mesure). Plafond d'événements porté de 64 à **96** (192 o) pour loger les mesures.

| Identifiant | Lettre | Donnée |
|---|---|---|
| 0, 1, 2 | R, D, Z | entrée de `read` · sortie avec octets · sortie sans octet — temps (8 ms) |
| 3, 4, 5 | C, K, X | entrée de `connected` · vrai · faux — temps (8 ms) |
| 6 | T | n secondes écoulées |
| 7 | M | tas libre ÷ 32 o |
| 8 | V | sommet vierge ÷ 32 o |
| octet 0xAB (seul) | # | `abort()` a été appelée |

## 5. Table de lecture (LED × journal au Reset suivant)

| LED allumées | Journal | Conclusion |
|---|---|---|
| **A + R + X** | `#` après `M… V… R…` | **H5 démontrée** : `abort()` appelée DANS `read()` ; les mesures M / V avant le dernier `read` échantillonné donnent l'état du tas (comparer à 960 o et à la pile dédiée de 2 048 o) |
| A + X (sans R, C) | `#` | `abort()` appelée hors des appels du client (autre cause, à lire avec les phases) |
| A + R (sans X) | pas de `#` | bloqué dans `read()` SANS `abort()` : H5 réfutée pour ce cas → module / UART |
| A + C | | bloqué dans `connected()` |
| A seule | pas de `T`, temps ≈ 0 | `millis()` figé ; sinon boucle hors des appels |
| A + F | | bloqué dans une écriture flash d'un événement (l'instrument) |
| A + H + F | phases jusqu'à 9 | bloqué dans l'écriture flash de la phase 10 |
| aucune LED | | LED non fiables ou carte redémarrée : se fier au journal |

## 6. Coûts mesurés (ELF, cœurs 1.5.3 = 1.6.0)

| | AUDIT4 | AUDIT5 |
|---|---|---|
| Production OFF, flash / RAM | 124 612 o / 22 768 o | 124 612 o / 22 768 o |
| Canari, flash (même chemin de build) | 140 156 o | 140 564 o (+408) |
| Canari, RAM statique | 22 792 o | 22 792 o (aucun statique ajouté) |
| Chaînes statiques `setup`/`loop → doPull` | 800 / 632 o | **800 / 632 o (identiques)**, cadre de `setup` 224 o |
| Pile réseau, lambda de `doFetchFrame` | 248 o, reste 880 o | **248 o, reste 880 o (identiques)** |
| Cadre de `podFfBoot` | 208 o (pic de démarrage mesuré 736 o) | 232 o (pic attendu ≈ 760 o < 784 o de `6b`) |

Production : **texte du sketch identique à `fd8b1dc`** hors blocs de canari (vérifié) ; désassemblage normalisé OFF : 1 030 / 1 036 fonctions identiques (les 6 autres : données et chemin de build). Forme IDE 1/1 : 140 564 o / 22 792 o, aucun avertissement du sketch. `podFfDie` : 68 o de pile statique (cadre + `podFfAppend`) ; `podFfHeap` : 124 o.

## 7. Tests

`tests/pullFramePhases.test.ts` : **statique** — en plus des règles d'AUDIT4 : `podFfHeap` (mallinfo + sbrk(0), unités de 32 o, plafonné, AUCUNE allocation ni sonde) ; `FfSSL::read` : les mesures du tas PRÉCÈDENT l'événement d'entrée ; `podFfDie` = « LED X ; signature ; boucle » au mot près, sans `mallinfo` / `logf` / Serial / exception ; `abort()` redéfinie une fois, uniquement en canari ; boucle `for (;;)` explicite ; **aucun `set_new_handler`** ; six cathodes ; test des LED (six ensemble puis une à une) ; format `logf` ≤ 235 caractères ; **48 mutants + 15 suppressions refusés**. **HÔTE** (`consensus-pod/host/ffl_harness.cpp` : code RÉEL contre flash, client TLS, `mallinfo`/`sbrk` et LED simulés ; le test substitue deux lignes de sa copie : la boucle finale lève `Stall`, `abort()` n'est pas installée) — 34 scénarios dont **E13 : `abort()` appelée dans le 6e `read` → LED exactement A + R + X, signature `0xAB` = dernier octet du journal, rapport `abort() : OUI` avec premières et dernières mesures du tas** ; E14 : `abort()` hors des appels n'imprime RIEN (ni `logf` ni série), un seul octet ; E15 : aucun abort → `abort() : non` ; E17 : mesures plafonnées à 8 128 o ; E18 : journal non armé → LED X seule, aucune écriture ; E19 : journal plein → aucune écriture hors du bloc 7 ; **37 mutants du harnais refusés**. `canaryPrep`, `canaryBootFix2` inchangés.

## 8. Protocole du prochain canari (après audit GPT)

Même fichier local `1`/`1`, **sans renvoyer d'image ni de dessin**.

1. Flasher. **Filmer la matrice** pendant les ≈ 3 premières secondes du démarrage : repère « six LED ensemble » puis F, R, C, A, H, X une à une ; en noter les positions.
2. Le premier pull télécharge la frame en attente. **Si le firmware se fige : NE PAS faire Reset tout de suite** — photographier / filmer les LED allumées et les situer par rapport au test (X devrait s'ajouter si `abort()` a été appelée). Attendre au moins 2 minutes.
3. UN Reset, puis copier les lignes jusqu'à `FFLOG tas avant read` (phase, séquence avec `M` / `V` / `#`, légende, tas).
4. Côté Vercel : `/api/pull-frame` à l'heure du blocage.

## 9. Réserves

- **Jamais flashé** : le brochage des LED de la matrice (dont la sixième, X) est celui de la bibliothèque du cœur, jamais essayé ; la redéfinition d'`abort()` en canari n'a jamais été liée sur la carte (le texte est testé statiquement et la logique sur l'hôte ; la substitution de la boucle finale et du symbole `abort` n'est donc validée qu'à la compilation).
- La signature d'`abort()` ne dit pas POURQUOI elle a été appelée (échec d'allocation, `std::length_error`, fonction virtuelle pure, assertion…) ; les mesures du tas avant le dernier `read` échantillonné et la LED R/C en désignent la cause probable, sans la prouver. Elles datent de l'appel échantillonné précédent, pas de l'instant de l'échec.
- Le plus grand bloc libre n'est pas disponible (voir § 4 b).
- Les écritures flash des événements ont lieu PENDANT l'attente de la réponse (≤ 192 o) : non mesuré ; si le blocage disparaît ou se déplace, s'en souvenir.
- Le cœur effectivement flashé (1.5.3 ou 1.6.0) n'est toujours pas connu ; aucune récupération n'est implémentée ; TFT 2,8″ : BLOQUÉ. Si H5 est confirmée, un contournement borné (par exemple limiter la taille demandée au module, ou réserver la mémoire avant la requête) fera l'objet d'un lot SÉPARÉ, après audit.

## 10. Archives

`docs/AUDIT_GPT_AUDIT4_PULLFRAME_2026_10_11.md`, `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT5_2026_10_11/` (journal du démarrage `gen=4`, chaînes statiques avant/après, pile réseau, comparaison de production, tailles), sauvegarde `firmware-backups/2026-10-11_avant-pullframe-phase-audit5/`, harnais `consensus-pod/host/ffl_harness.cpp`.

## 11. Résultat matériel AUDIT5 — 11/10/2026

Le démarrage suivant a relu le blocage précédent :

```text
DERNIERE PHASE 9 (apres client.print)
sequence ... M93 V59 R54#
tas avant read : libre 2976 o puis 2976 o
sommet vierge 1888 o puis 1888 o
abort() : OUI
```

**Verdict : AUDIT5 ACCEPTÉ.** `abort()` est appelée dans `WiFiSSLClient::read()` pendant l'arrivée de la réponse de `/api/pull-frame`. H5 est confirmée au niveau « abandon dans read » ; l'échec exact de l'allocation de `std::string` reste la cause principale, sans être enregistré directement.

Le prochain lot est `PULLFRAME-BOUNDED-SSL-FIX1`, défini dans `docs/HANDOFF_CLAUDE_CLOUD_PULLFRAME_2026_10_11.md`. Aucun AUDIT6 général n'est demandé avant ce correctif borné. Journal brut : `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT5_2026_10_11/journal-audit5-3387088-materiel.txt`. Audit : `docs/AUDIT_GPT_AUDIT5_PULLFRAME_2026_10_11.md`.
