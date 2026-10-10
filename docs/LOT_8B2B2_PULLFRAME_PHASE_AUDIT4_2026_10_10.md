# LOT 8B-2B-2 — PULLFRAME-PHASE-AUDIT4 (10/10/2026)

**Instrumentation SEULE du canari. Aucune correction. Compilé (cœurs 1.5.3 ET 1.6.0) et testé sur l'hôte (flash, client TLS et LED simulés) : jamais flashé.** Base : `2cdfe54`. Drapeaux committés : `POD_RENDER_V1 = 0`, `POD_CANARY = 0`. Serveur, Redis (+0), Neon (0), protocole, vote, ACK, rendu, OTA, polling, tailles de pile : inchangés. `pod_http.h` (en-tête partagé) NON modifié.

## 1. Ce que le matériel a dit (canari AUDIT3, `2cdfe54`)

Journal : `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT4_2026_10_10/journal-audit3-2cdfe54-materiel.txt`. Deux démarrages consécutifs (flash puis un Reset) :

```
FFLOG demarrage precedent : gen=1 ; 10 entrees ; DERNIERE PHASE 9 (apres client.print) ; sequence … : 0123456789
```

Le journal en flash a donc **localisé** le blocage : l'armement puis les phases 1 à 9 sont écrits, la phase 10 ne l'est jamais. Connexion TLS réussie, requête construite, `client.print(req)` revenu. Précision de GPT, reprise ici : cela prouve que la requête a été **remise au client Wi-Fi**, pas qu'elle est arrivée chez Vercel (la présence de `/api/pull-frame` dans Vercel reste à vérifier : aucun extrait fourni à ce jour). Le démarrage `gen=2` s'est bloqué au même endroit (journal complet jusqu'à « nouvelle frame ») ; sa phase sera lue au prochain Reset.

Par ailleurs : les écritures flash de l'instrument fonctionnent (neuf octets programmés pendant le dialogue TLS sans erreur, `7a`/`6b` inchangés) ; le pic de pile de démarrage passe de 584 à 664 o (la lecture flash de `podFfBoot`), marge 360 o ; la ligne `FFLOG arme` était **tronquée à 255 caractères** par `logf` (la limite est de 255, un format plus long est coupé) : les rapports d'AUDIT4 tiennent en lignes courtes (un test refuse tout format de plus de 235 caractères).

## 2. Ce que la lecture du code permet de dire — et ce qui reste ouvert

Entre `client.print` (marque 9) et la marque 10, il n'y a que `rd.readHeaders()` puis le `podFfNote(10)` lui-même. `readHeaders → readLine → nextByte → fill` (`pod_http.h`) appelle `c_.read(buf, n)` et `c_.connected()` du client TLS, puis `delay(2)`, dans une boucle bornée par `millis()` (20 s). Dans le cœur : chaque commande AT du module (`Modem::buf_read`) est bornée par `millis()` (10 s) ; `WiFiSSLClient::read` / `available` / `connected` passent par ces commandes ; aucune boucle sans limite dans ce chemin. **Tant que `millis()` avance, `readHeaders` revient en 30 s au plus** (avec −1 si rien n'arrive). Un blocage de 30 minutes suppose donc l'une de ces situations :

| Hypothèse | Ce qui bloque | Témoin AUDIT4 |
|---|---|---|
| H1 | un appel du module (`read` ou `connected`) ne rend jamais la main (matériel, liaison UART, module) | LED **R** ou **C** allumée ; journal : entrée sans sortie ou dernier événement avant |
| H2 | `millis()` figé / interruptions masquées : le code tourne ou attend dans `delay(2)` | LED **A** seule ; journal : aucun événement `T` (seconde écoulée) ; temps 0 partout |
| H3 | boucle de logique hors des appels (bien que les bornes l'interdisent) ou faute du processeur | LED **A** seule ; `T` avancent d'abord puis s'arrêtent (boucle vivante) ou rien du tout |
| H4 | l'écriture flash de la phase 10 (ou d'un événement) ne revient pas : l'instrument lui-même | LED **F** allumée (avec **H** pour la phase 10) |

## 3. Conception (consignes de GPT, avec deux écarts motivés)

**(1) Client TLS « espion » `FfSSL`** (canari seulement) : classe dérivée du vrai `WiFiSSLClient`, qui surcharge `read(uint8_t*, size_t)` et `connected()`. Le nom `WiFiSSLClient` lui est redirigé (`#define WiFiSSLClient FfSSL`, après la définition, avant `struct Conn`) : `Conn` et `podhttp::Reader` l'utilisent sans qu'une ligne de production change (le texte de production est identique, vérifié). **Hors de la fenêtre « marque 9 → marque 10 », les deux méthodes appellent le vrai client sans rien d'autre** (autres transactions, corps de la réponse).
Dans la fenêtre : compteurs d'appels (`g_podFfNR`, `g_podFfNC`), **échantillonnage** (appels 1 à 3 puis puissances de deux : 1, 2, 3, 4, 8, 16, 32, 64, 128), et pour chaque appel échantillonné **un événement d'entrée AVANT l'appel et un événement de sortie APRÈS** ; un événement **« seconde écoulée »** (`T`) chaque fois que l'horloge a avancé d'une seconde depuis la marque 9. **Plafond : 64 événements (128 o) par téléchargement** (atteint en 60 s d'attente : testé). Chaque événement = 2 octets : `(id << 4) | (id ^ 0x0A)` puis un octet de temps (unités de 8 ms depuis la marque 9, plafonné à 254 ; pour `T` : secondes) ; `0xFF` reste « vierge ».

Identifiants : `R` entrée de `read` · `D` sortie de `read` avec des octets · `Z` sortie de `read` sans octet · `C` entrée de `connected` · `K` `connected` vrai · `X` `connected` faux · `T<n>` n secondes écoulées.

**(2) Témoin indépendant : cinq LED de la matrice de la carte**, pilotées EN STATIQUE par les registres de broches (mêmes masques et même routine que `turnLed` de la bibliothèque du cœur : toutes les broches de la matrice en entrée, puis l'anode commune en sortie haute et les cathodes voulues en sortie basse) : aucun minuteur, aucune interruption, aucune broche d'en-tête. Elles restent allumées si le firmware se fige. **GPT proposait la LED intégrée ; écart motivé : D13 est aussi l'horloge SPI de l'e-ink** (la passer en GPIO casserait l'affichage ensuite). La bibliothèque `Arduino_LED_Matrix` n'est pas utilisée (interruption à 10 kHz, matrice balayée).

| LED | Allumée quand |
|---|---|
| **F** | une écriture flash est en cours (allumée AVANT la programmation, éteinte APRÈS) |
| **R** | on est dans `read()` du module |
| **C** | on est dans `connected()` |
| **A** | la trace est active (de la marque 1 à la marque 15) |
| **H** | `readHeaders` est revenue (allumée à l'entrée de la marque 10, **avant** son écriture flash) |

Test séquentiel au démarrage : les cinq LED s'allument une à une, dans l'ordre F, R, C, A, H (0,25 s chacune) — pour que le porteur repère leurs positions physiques. Le brochage (indices 0, 2, 6, 12, 20 de la matrice, anode 7) est celui de la bibliothèque du cœur, **jamais essayé sur la carte**.

**(3) Rapport au démarrage suivant** (lignes courtes) : `FFLOG demarrage precedent : gen=… ; N elements ; DERNIERE PHASE P (nom)`, `FFLOG sequence (16 derniers elements) : …` et une ligne de légende. La séquence mêle les phases (`0123456789abcdef`, `!` pile détruite, `?` octet invalide) et les événements (` R0 Z0 C0 K0 …`, ` T3`). Le décodeur traite l'octet qui suit un événement comme son temps (jamais comme une entrée) ; lecture bornée, protégée contre les valeurs aléatoires.

**Écarts de consigne** : (a) l'entrée de `readLine` et de `fill` n'est pas journalisée séparément : ces fonctions sont des gabarits de `pod_http.h` (texte partagé par plusieurs firmwares, non modifié) ; ce qui les trahit, ce sont les appels au client (`fill` est le seul à appeler `read` / `connected`). (b) La LED D13 est remplacée par la matrice (voir plus haut).

## 4. Table de lecture (LED allumées au moment du blocage × journal relu au Reset suivant)

| LED allumées | Journal (après Reset) | Conclusion |
|---|---|---|
| A + **R** | dernier événement = `R` (entrée de read) ou événements antérieurs ; tick `T<n>` = secondes depuis la marque 9 | bloqué DANS `WiFiSSLClient::read` (module / liaison UART) ; `n` = depuis combien de temps au moins |
| A + **C** | idem avec `C` | bloqué DANS `connected()` |
| A seule, ticks absents, temps ≈ 0 | derniers événements = sorties d'un premier tour | `millis()` figé (le code attend dans `delay(2)`) : interruptions masquées ou horloge arrêtée |
| A seule, ticks qui progressent puis s'arrêtent | | boucle hors des appels, ou faute du processeur après un moment : à creuser |
| A + **F** (sans H) | dernier octet = événement inachevé | bloqué dans une écriture flash d'un événement (l'instrument) |
| A + **H** + **F** | phases jusqu'à 9 seulement | bloqué dans l'écriture flash de la **phase 10** (hypothèse H4) |
| A + **H** seules | phase 10 présente | `readHeaders` est revenue ET l'écriture a réussi : le blocage est APRÈS (lire les phases suivantes) |
| aucune LED | | les LED ne fonctionnent pas (brochage) ou la carte a redémarré : se fier au journal seul |

## 5. Coûts mesurés (ELF, cœurs 1.5.3 = 1.6.0)

| | AUDIT3 | AUDIT4 |
|---|---|---|
| Production OFF, flash | 124 612 o | 124 612 o |
| Production, RAM statique | 22 768 o | 22 768 o |
| Canari, flash (même chemin de build) | 138 716 o | 140 156 o (+1 440) |
| Canari, RAM statique | 22 784 o | 22 792 o (+8 mesurés : temps de départ, compteurs d appels, d événements, de secondes et état des LED) |
| Chaînes statiques `setup`/`loop → doPull` | 800 / 632 o | **800 / 632 o (identiques)**, cadre de `setup` 224 o |
| Pile réseau, lambda de `doFetchFrame` | 248 o, reste 880 o | **248 o, reste 880 o (identiques)** |

Production : **texte du sketch identique à `2cdfe54`** hors blocs de canari (vérifié) ; désassemblage normalisé OFF : 1 030 / 1 036 fonctions identiques (les 6 autres : données et chemin de build). `podFfBoot` est `noinline` et ses tampons ont été réduits (anneau de 16 éléments, chaîne de 96 o) pour que le pic de pile de démarrage reste sous celui de `6b` (784 o) ; le point `1c` le mesurera sur la carte. L'analyse statique ne suit pas les appels virtuels du client : le coût réel des événements dans la transaction (≈ 165 o d'écriture flash + le cadre de `FfSSL::read`) sera lu par la ligne `net http` du canari (marge attendue ≥ 256 o ; 780 – 848 o avant).

## 6. Tests

`tests/pullFramePhases.test.ts` (réécrit) : **statique** — 15 marques seules dans leur bloc gardé et dans l'ordre ; `podFfNote` (LED A à la marque 1, temps de départ à la marque 9, LED H AVANT l'écriture de la phase 10, jeton d'un octet pour 4 à 14, LED éteintes à la 15) ; `podFfAppend` (LED F autour de l'UNE programmation) ; `podFfLedSet` (masques et broches de la bibliothèque du cœur, registres seulement : ni `LED_BUILTIN`, ni `pinMode`, ni minuteur, ni la bibliothèque de la matrice) ; `podFfEv` (plafond 64, deux octets, temps plafonné) ; `FfSSL` (événement d'entrée, LED, vrai client, LED, événement de sortie, dans cet ordre ; rien hors de la fenêtre) ; redirection du nom unique, entre `FfSSL` et `Conn` ; aucun format `logf` de plus de 235 caractères ; production sans aucune trace ; **35 mutants + 15 suppressions refusés** ; carte de l'EEPROM des cinq firmwares ; **HÔTE** (`consensus-pod/host/ffl_harness.cpp` : code RÉEL contre une flash simulée, un faux client TLS dont le N-ième `read` / `connected` ne rend jamais la main et de fausses LED) — 26 scénarios dont : lecture normale (28 événements exacts pour 41 tours), 60 s d'attente (plafond de 64 atteint et tenu, 0 octet hors du bloc 7, appels du vrai client ni perdus ni ajoutés), **blocage dans `read` échantillonné / non échantillonné / dans `connected` / dans l'écriture flash de la phase 10 / hors des appels : LED exactement `A+R`, `A+R`, `A+C`, `A+H+F`, `A`**, horloge figée (aucun tick), serveur lent (temps plafonné à 254), relecture exacte de la séquence rapportée, test séquentiel des LED, 60 journaux à entrées aléatoires ou à faux événements ; **28 mutants du harnais refusés**. `canaryPrep` (dix statiques de canari initialisés, classe cliente espion autorisée), `canaryBootFix2` (point `1c`).

## 7. Protocole du prochain canari (après audit GPT)

Même fichier local `1`/`1`, **sans renvoyer d'image ni de dessin** (la frame en attente est le bon test).

1. Flasher, moniteur ouvert. Au démarrage : relever la ligne `BUILD PULLFRAME-PHASE-AUDIT4`, `FFLOG demarrage precedent …`, `FFLOG arme … relecture OK`, et **regarder la matrice : cinq LED s'allument une à une (F, R, C, A, H)** — noter où elles se trouvent.
2. Le premier pull télécharge la frame en attente. **Si le firmware se fige : NE PAS appuyer sur Reset tout de suite** — décrire (ou photographier) les LED de la matrice allumées (par leur position, comparée au test du démarrage). Attendre au moins 2 minutes.
3. Puis UN Reset : copier les premières lignes jusqu'à `FFLOG legende` (la phase et la séquence d'événements du démarrage précédent).
4. En parallèle, côté Vercel : la présence de `/api/pull-frame` à l'heure du blocage.

## 8. Réserves

- **Rien n'est flashé.** Le brochage des LED de la matrice est celui de la bibliothèque du cœur, jamais essayé ; si aucune LED ne s'allume au test du démarrage, le journal reste le seul témoin.
- Les écritures flash des événements (≤ 128 octets) se produisent PENDANT l'attente de la réponse du serveur : une programmation d'un octet est brève, mais ce n'est pas mesuré ; si le blocage disparaît ou se déplace, il faudra s'en souvenir. Les appels non échantillonnés ne touchent que des registres de LED (microsecondes).
- La redirection `#define WiFiSSLClient FfSSL` fait de `Conn` / `podhttp::Reader` des utilisateurs de la classe dérivée pour toutes les transactions du canari ; hors de la fenêtre 9 → 10 elle appelle simplement le vrai client.
- Le cœur effectivement flashé (1.5.3 ou 1.6.0) n'est toujours pas connu ; aucune récupération n'est implémentée ; TFT 2,8″ : BLOQUÉ.

## 9. Archives

`docs/AUDIT_GPT_AUDIT3_PULLFRAME_2026_10_10.md`, `docs/mesures/8B2B2_PULLFRAME_PHASE_AUDIT4_2026_10_10/` (journal série d'AUDIT3, chaînes statiques avant/après, pile réseau, comparaison de production, tailles), sauvegarde `firmware-backups/2026-10-10_avant-pullframe-phase-audit4/`, harnais `consensus-pod/host/ffl_harness.cpp`.
