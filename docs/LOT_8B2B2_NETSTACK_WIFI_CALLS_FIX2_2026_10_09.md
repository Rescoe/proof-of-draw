# Lot 8B-2B-2 · NETSTACK-WIFI-CALLS-FIX2 — retirer le faux positif « pile max » du canari ; arrêt sûr AVANT tout journal sur GUARD

| | |
|---|---|
| **Date** | 09/10/2026 (nuit) |
| **Statut** | **Correctif étroit livré, COMPILÉ (cœurs 1.5.3 et 1.6.0), testé sur l'hôte. JAMAIS flashé.** Aucune frame, aucun dessin. Le canari sans frame est à refaire (même fichier local 1/1) après l'audit GPT. |
| **Origine** | journal matériel du canari NETSTACK-WIFI-CALLS-FIX1 (`docs/mesures/8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09/journal-wifi-calls-fix1-materiel.txt`) et verdict GPT sur `297251d` |
| **Portée** | l'instrument du canari e-ink 2,9″ (`podCanaryCheck` / `podCanaryPrint`), `wifiFailed()` des cinq firmwares, tests, documentation. **Aucun** serveur, Redis, Neon, vote, ACK, rendu, OTA, polling. Redis +0, Neon 0. |
| **Défauts du dépôt** | `POD_RENDER_V1 = 0`, `POD_CANARY = 0` (commit). `1`/`1` seulement dans le fichier local du canari. |

## 1. Ce que le canari WIFI-CALLS-FIX1 prouve sur la carte

Source : le verdict transmis et l'audit `docs/AUDIT_GPT_CANARI_WIFI_STACKS_R4_2026_10_09.md` (extraits du journal : appels Wi-Fi, `net http`, Ed25519, diagnostic de `6b`). **Les lignes série brutes complètes n'ont pas été fournies** : elles ne sont pas reconstituées ici (archivage brut demandé par l'auditeur, correction C4 : à coller dans `docs/mesures/8B2B2_NETSTACK_WIFI_CALLS_FIX2_2026_10_09/` par le porteur).

| Mesure matérielle | Valeur |
|---|---|
| Pile Wi-Fi dédiée (1 536 o) | **448 – 608 o utilisés, 864 – 1 024 o de marge** (objectif 256 o : très largement atteint ; la taille est confortable) |
| TLS / HTTP dédié (PodNet) | 1 172 o utilisés, **812 o de marge** (inchangé) |
| Ed25519 dédié (PodEd) | pire marge **708 o** |
| Erreurs de toutes les piles dédiées | **0** |
| `POST /api/register` | **200** |
| Marqueur de la pile principale et sa longueur | **intacts** ; aucun octet modifié sous `__StackLimit` |
| Pile principale à `doRegister` | **880 / 1 024 o utilisés, marge 144 o** (seuil fatal 128 o, objectif 256 o) |

Les hypothèses du lot précédent sont donc confirmées : `WiFi.macAddress()` était bien la cause, et les enveloppes sur pile dédiée la suppriment. **PodNet a enfin été exercé sur la carte** et ses phases sont restées à zéro.

## 2. L'arrêt à `6b` : un faux positif de l'ancien instrument

`stackDepthBytes()` mesure la profondeur de la pile en cherchant les octets modifiés dans la zone **0xA5 peinte SOUS `__StackLimit`** (haut du tas, peinte une fois par `paintStack`). `podCanaryCheck` en faisait un critère **fatal** (`below > 1024`). Or, depuis NETSTACK-FIX1, FIX2 et WIFI-CALLS-FIX1, quatre piles temporaires sont prises **au tas** (PodEd 2 304 o, PodNet 2 048 o, pile Wi-Fi 1 536 o, pile de journal 1 536 o) et recouvrent légitimement cette zone : l'instrument a annoncé « pile max 3072 », valeur absurde (pile + zone). Il n'y a eu **ni débordement ni écriture sous la limite** : le marqueur et sa longueur étaient intacts, la mesure fiable est celle de la pile principale (880 / 1 024 o, marge 144 o).

## 3. Correctif de l'instrument

| Avant | Après |
|---|---|
| fatal si `below > 1024` (zone 0xA5 sous la limite) | **plus un critère** |
| critères fatals : marqueur, longueur, `margin < 128`, `below > 1024`, SP | **marqueur ou longueur invalides · SP hors pile · marge principale < 128 o** — exactement quatre conditions |
| ligne de mesure : `… \| ecrit sous la limite ou pile max N \| …` | **la ligne ne porte plus de « pile max »** : `[CANARY] <étiquette> : pile utilisee au plus <N> o / 1024 (marge <N> o) \| SP=… \| tas libre … \| sbrk->limite …` |
| marge 128 – 255 o : identique à 600 o | **`(marge 144 o, SOUS L'OBJECTIF 256)`**, sans alerte ni arrêt |
| `reportMem()` (production, cinq firmwares) : `[MEM] <tag>: tas libre N o, pile max ~N o` | **`[MEM] <tag>: tas libre N o, zone 0xA5 sous la pile N o (INDICATIF : NON fiable des la 1re pile temporaire)`** — plus jamais présenté comme une pile max (texte de log seulement) |
| `stackDepthBytes()` calculé à chaque point de contrôle | calculé **seulement pour le diagnostic d'alerte** (jamais par un point silencieux sain) et imprimé comme `zone 0xA5 sous la limite (INDICATIF seulement, NON fiable depuis les piles temporaires allouées dans le tas)` |

Le marqueur (`CNRY` à `__StackLimit`) reste le détecteur d'écriture sous la limite : une pile qui descendrait sous `__StackLimit` détruit le marqueur (c'est ainsi que FIX1 à FIX3 ont vu les 24 o). `reportMem()` (code de **production**) utilisait la même fonction et affichait `pile max ~N` : la ligne est **rebaptisée** (zone 0xA5 sous la pile, INDICATIF) — c'est un simple texte de log, aucun calcul ne change ; la mesure de pile principale fiable est la ligne `[CANARY] … pile utilisee au plus …`. Remarque de l'audit : cette zone ne doit **jamais être repeinte** après le démarrage (elle contient désormais des données ou métadonnées de l'allocateur du tas).

## 4. `wifiFailed()` : arrêt sûr AVANT tout journal sur `GUARD`

Avant : `logf(…)` puis `if (GUARD) logfSafeStop();`. Or `GUARD` signifie que la garde basse de la pile dédiée a été écrasée — le voisin au tas peut être corrompu — et `logf` **alloue au tas** (pile de journal de 1 536 o) : journaliser d'abord contredisait « arrêt silencieux ». **Après** (cinq firmwares) :

```cpp
if (ni.err == POD_NET_GUARD) logfSafeStop();   // avant TOUT logf
logf("[WIFI] %s : pile Wi-Fi dédiée : %s (erreur %u, marge %u o) — résultat IGNORÉ", …);
```

Tests : (a) statique, pour chacun des cinq sketches, `logfSafeStop()` précède l'unique `logf` de `wifiFailed` ; (b) **hôte** : sur `GUARD`, les six enveloppes s'arrêtent avec **zéro ligne journalisée** ; (c) mutant « journal avant l'arrêt » **refusé**. Pour les autres erreurs (NOMEM, NESTED, MARGIN), le journal reste écrit (la mémoire voisine n'est pas suspectée).

## 5. Marge principale à `doRegister` : 144 o — constat, pas de correction ici

144 o est **16 o au-dessus** du minimum fatal et sous l'objectif 256 o : acceptable pour poursuivre le canari sous surveillance, **pas encore pour la production**. Aucune correction dans ce lot (étroit, pas d'architecture). Pistes statiques (ELF, à mesurer, non retenues) : sous `doRegister` (cadre 240 o) les chemins les plus profonds sont l'analyse JSON d'ArduinoJson de la réponse (≈ 608 o), `displayOnboardingQR` (≈ 616 o, surestimé car l'analyse suit la branche directe de `logf`), `persistFrameId`, la construction du corps (`String`, `bytesToHex`, `loadOwnedHashesJson`). Les sous-phases silencieuses du canari (R0 à R2, A/B/C) peuvent localiser la consommation.

## 6. Compilations — deux cœurs

Dix compilations par cœur (cinq firmwares × OFF/ON, TFT 2,8″ OFF seul, + canari 1/1), `--warnings all`, **cœurs 1.5.3 ET 1.6.0, 20 / 20 exit=0, aucun avertissement du projet**. Référence = le commit WIFI-CALLS-FIX1 `297251d` (mêmes drapeaux).

| Firmware | Rendu v1 | Flash, cœur 1.5.3 (WIFI-CALLS-FIX1 → WIFI-CALLS-FIX2) | Flash, cœur 1.6.0 | RAM statique (o) | Marge statique (o) | Avertissements du projet (2 cœurs) |
|---|---|---|---|---|---|---:|
| R4 e-ink 2,9″ BWR | OFF | 121796 → 121844 (**+48**) | 121796 → 121844 (**+48**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |
| R4 e-ink 2,9″ BWR | ON | 124812 → 124876 (**+64**) | 124812 → 124876 (**+64**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |
| R4 e-ink 2,7″ | OFF | 120956 → 121004 (**+48**) | 120956 → 121004 (**+48**) | 19128 → 19128 (**+0**, 2 cœurs) | 4168 | 0 |
| R4 e-ink 2,7″ | ON | 123676 → 123724 (**+48**) | 123676 → 123724 (**+48**) | 19128 → 19128 (**+0**, 2 cœurs) | 4168 | 0 |
| R4 e-ink 2,7″ + OLED | OFF | 135784 → 135848 (**+64**) | 135784 → 135848 (**+64**) | 21500 → 21500 (**+0**, 2 cœurs) | 1796 | 0 |
| R4 e-ink 2,7″ + OLED | ON | 138512 → 138560 (**+48**) | 138512 → 138560 (**+48**) | 21500 → 21500 (**+0**, 2 cœurs) | 1796 | 0 |
| R4 TFT 1,8″ | OFF | 131584 → 131648 (**+64**) | 131584 → 131648 (**+64**) | 20864 → 20864 (**+0**, 2 cœurs) | 2432 | 0 |
| R4 TFT 1,8″ | ON | 134208 → 134272 (**+64**) | 134208 → 134272 (**+64**) | 21424 → 21424 (**+0**, 2 cœurs) | 1872 | 0 |
| R4 TFT 2,8″ tactile | OFF | 150396 → 150444 (**+48**) | 150396 → 150444 (**+48**) | 21444 → 21444 (**+0**, 2 cœurs) | 1852 | 0 |
| R4 e-ink 2,9″ BWR | ON + CANARI (1/1) | 130468 → 130684 (**+216**) | 130468 → 130684 (**+216**) | 22768 → 22768 (**+0**, 2 cœurs) | 528 | 0 |

Pile principale à la signature du vote (analyse statique de l'ELF, **identique** à WIFI-CALLS-FIX1) :

| Firmware | Pile principale à la signature du vote, cœur 1.5.3 (marge) | cœur 1.6.0 (marge) |
|---|---|---|
| R4 e-ink 2,9″ BWR | 740 o (284) | 740 o (284) |
| R4 e-ink 2,7″ | 716 o (308) | 716 o (308) |
| R4 e-ink 2,7″ + OLED | 724 o (300) | 724 o (300) |
| R4 TFT 1,8″ | 716 o (308) | 716 o (308) |
| R4 TFT 2,8″ tactile | 964 o (60) | 964 o (60) |

Audit de l'ELF des appelants du module Wi-Fi (`scripts/wifi-stack-report.js`, rapports `wifi-stack-<cœur>-<firmware>.txt`) — **inchangé** :

| Firmware | Cœur | Pire appel au module (o) | Appelants directs du module | Dont HORS pile dédiée | Contrôle |
|---|---|---:|---:|---:|---|
| R4 e-ink 2,9″ BWR | 1.5.3 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ | 1.5.3 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ + OLED | 1.5.3 | 664 | 6 | **0** | OK |
| R4 TFT 1,8″ | 1.5.3 | 664 | 6 | **0** | OK |
| R4 TFT 2,8″ tactile | 1.5.3 | 664 | 6 | **0** | OK |
| R4 e-ink 2,9″ BWR | 1.6.0 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ | 1.6.0 | 664 | 6 | **0** | OK |
| R4 e-ink 2,7″ + OLED | 1.6.0 | 664 | 6 | **0** | OK |
| R4 TFT 1,8″ | 1.6.0 | 664 | 6 | **0** | OK |
| R4 TFT 2,8″ tactile | 1.6.0 | 664 | 6 | **0** | OK |

**Constat** : RAM statique **+0 o** (e-ink 2,9″ : marge 528 o inchangée) sur les cinq firmwares et les deux cœurs ; flash **+48 à +64 o** en production (libellé `[MEM]` plus explicite ; l'ordre de `wifiFailed` ne coûte rien) et **+216 o** au canari (ligne « sous l'objectif », indicateur de diagnostic) ; marges de vote inchangées (284/308 o) ; TFT 2,8″ à 60 o, **toujours BLOQUÉ**. Les deux cœurs donnent des tailles identiques.

## 7. Tests (hôte)

* **Instrument du canari — code RÉEL exécuté sur l'hôte** (`consensus-pod/host/canary_check_harness.cpp`, **33 scénarios**, +3) : une écriture sous `__StackLimit` ou une zone sous la limite **entièrement écrasée** (piles temporaires) ne déclenche **plus aucune alerte** (point silencieux muet, ligne verbeuse normale **sans « pile max »**) ; **880 o utilisés → `(marge 144 o, SOUS L'OBJECTIF 256)`**, sans alerte ni verrou ; marge 128 o (seuil) acceptée ; marge 124 o, marqueur détruit, longueur détruite, SP hors pile → alerte + verrou fatal (inchangé), et le diagnostic d'alerte imprime la zone sous la limite comme **INDICATIF seulement**.
* **Contrôles négatifs** : le mutant « la zone sous la limite redevient fatale » (régression du faux positif « pile max 3072 ») est **refusé** ; les autres mutants (repeint, pas de verrou, marqueur ignoré, marge ignorée, silencieux bavard) le restent.
* **Test statique** : `alert = !magicOk || !paintedOk || margin < 128 || !spOk` exactement ; `stackDepthBytes()` absent de la décision et calculé seulement après le retour des points silencieux ; plus de « pile max » ni de « écrit sous la limite » dans la ligne de mesure ; texte « SOUS L'OBJECTIF 256 » conditionné par `!alert`.
* **Ordre de `wifiFailed`** (`tests/wifiCalls.test.ts`, `tests/canaryBootFix2.test.ts`) : pour les **cinq** sketches, `logfSafeStop()` précède l'unique `logf` ; **hôte** (`wifi_calls_harness.cpp`) : sur `GUARD`, les six enveloppes s'arrêtent avec **zéro ligne journalisée** ; mutant « journal avant l'arrêt » **refusé**. Les 22 tests des enveloppes (échec fermé, hexadécimal, 10 → 11 mutants) restent verts.
* **`reportMem`** (cinq sketches) : test statique — plus de « pile max », libellé « zone 0xA5 sous la pile … (INDICATIF …) ».
* **Documentation** : la ligne `[CANARY] … pile utilisee au plus …` attendue (`docs/CANARY_R4_EINK29_RENDU_V1_2026_10_08.md`) est vérifiée contre le firmware par `tests/canaryPrep.test.ts` : mise à jour, sans « pile max ».
* **Suite complète** : `npm test` **701 / 703** dans l'arbre du porteur (les 2 échecs viennent uniquement de ses copies Arduino non suivies de `consensus-pod/examples/Ed25519StackProbeUnoR4/podRender*.h`, comptées comme « consommateurs » de `podRender.h`) ; depuis un `git clone --local` du commit (sans copies Arduino locales, sans `secrets.h`, sans drapeaux 1/1) : **703 / 703**, `tsc` propre ; `npx tsc --noEmit`, `npx eslint` et `git diff --check` propres.

## 8. Canari à refaire (APRÈS audit GPT) — même fichier local `1`/`1`, aucun dessin

Moniteur 115200 ; **register puis trois pulls pendant cinq minutes** ; copier TOUT le journal.

| À observer | Critère |
|---|---|
| lignes `[CANARY] wifi … erreur 0` | marges ≥ 256 o (attendu : 864 – 1 024) |
| `net http` / `pull-frame`, `[ED25519] …` | erreurs 0, PodNet 812 o, PodEd ≥ 708 o |
| `[CANARY] 6b …` et tous les points suivants | **plus d'arrêt** ; ligne `pile utilisee au plus N o / 1024 (marge M o[, SOUS L'OBJECTIF 256])` **sans « pile max »** |
| marge principale | **≥ 128 o** à tous les points (144 o attendu à `doRegister`, signalé « sous l'objectif » sans arrêt) |
| marqueurs | intacts ; aucune ligne `macString : PREMIERE sous-phase …`, `PodNet : PREMIERE phase fautive …` |
| 3 pulls | `/api/pull` ×3, aucun verrou |

Si ces critères sont atteints, l'auditeur autorisera **une seule frame personnelle** (« Afficher sur mon écran »), pas avant.

## 9. Ce qui reste ouvert / bloqué

* Marge principale de `doRegister` : 144 o (§ 5).
* RSSI n'a pas été exercé sur ce boot (les clés existaient déjà : `gatherEntropy` n'a pas tourné) ; il l'est à la première génération de clés.
* **TFT 2,8″ : toujours BLOQUÉ pour tout flash** (pile principale au vote : 964 o, marge 60 o).
* Les ESP8266 ne sont pas concernés.
