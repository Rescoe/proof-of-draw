# Lot 8B-2E V4-FIX1 — aucun écran, tactile ni carte SD dans le canari de vote (14/10/2026)

Correctif de l'audit GPT/Codex de V4 (`448bc759`) : **flash en NO-GO tant que ce lot n'est pas accepté**. Hôte et compilation seulement : **aucun flash, aucun vote, aucun déploiement, aucune fusion**. Base : `448bc759`, branche `claude/r4-tft28-vote-audit-8b2e`, commit séparé. Drapeaux à `0` dans le dépôt (`POD_CANARY`, `POD_RENDER_V1`, `POD_VOTE_V1`, `POD_VOTE_CANARY`).

## 1. Défaut constaté
V4 affirmait « aucun affichage / tactile / SD », mais dans le build `POD_VOTE_CANARY` : `setup()` exécutait encore `tft.begin()`, `ts.begin()`, `initSD()` et `tftStatus()` ; les erreurs Wi-Fi s'affichaient par `tftStatus()` ; `doRegister()` appelait `registerShowFailure`, `registerShowOnboarding` (QR, clés) ou `registerShowConnected`. L'affirmation « le linker retire ces familles » n'était pas une preuve.

## 2. Correctif (build de vote uniquement ; la production est inchangée)
- `setup()` : les trois CS restent à `HIGH` (contention évitée), puis **aucune** initialisation d'écran, de tactile ni de carte SD (`tft.begin`, `ts.begin`, `initSD`, `tftStatus` absents) ; module Wi-Fi absent et échec Wi-Fi : **journal série seulement**.
- `doRegister()` : échec HTTP = journal série seulement ; **carte non appairée ⇒ `vcHalt` (arrêt définitif)**, aucun QR, aucun écran d'onboarding, aucun pull ; carte appairée = journal `[REGISTER]` seulement (plus de « Connecté »).
- `doPull()` : après le décodage, retour immédiat ; le reste (frame, animation, banc d'essai, ACK) **n'existe pas** dans le build de vote (`#else`).
- `loop()` : le build de vote ne contient que `voteCanaryLoop()` ; le corps d'origine (toucher, animation, banc d'essai, observation, ACK) n'existe pas dans ce build (`#else`).
- **Production identique** : avec `POD_VOTE_CANARY = 0`, le texte du sketch est identique à V3-FIX1 (test d'identité inchangé) ; tailles identiques à l'octet (158 740 o / 21 532 o ; canari d'affichage 149 704 o / 21 464 o) sur les deux cœurs.
- **Verrou EEPROM, épinglage, ordre « verrou avant POST » : strictement inchangés** (même code, mêmes tests de coupures).

## 3. Preuve d'inatteignabilité (remplace l'argument « le linker »)
1. **Source** (`tests/helpers/voteCanaryReach.ts`, test « PORTÉE ») : évalue les conditionnelles du préprocesseur pour le build de vote, découpe les définitions, calcule la fermeture transitive des références **par nom depuis `setup`, `loop` et `voteCanaryLoop`** (donc TOUT le chemin atteignable, pas seulement la boucle) et cherche dans chaque fonction atteignable : fonctions d'affichage / tactile / SD / animation / ACK / banc d'essai / observation, et accès `tft.`, `ts.`, `SD.`, `File`, `onSd(`. Résultat : **0 occurrence**, 101 fonctions atteignables ; l'analyse n'est pas vide (elle doit atteindre `doRegister`, `doPull`, `doValidateV2`, `votePhasePost`, `voteLockCommitAttempt`, `httpCall`…). Sur-approximation volontaire (une référence par nom compte).
2. **13 mutants de portée refusés** : `tft.begin`, `initSD`, `ts.begin` dans `setup` ; erreurs Wi-Fi dessinées ; `registerShowFailure`, `registerShowConnected`, `registerShowOnboarding` dans register ; fin de `doPull` rétablie ; ancien `loop` rétabli ; `serviceTouch`, `restoreLastFrame`, `ackFrame` appelés.
3. **ELF** (`scripts/vote-canary-elf-reach.js`, sortie archivée `docs/mesures/8B2E_V4_FIX1_2026_10_14/portee-elf-vote-1.6.0.txt`) : sur le désassemblage du build de vote (cœur 1.6.0), fonctions atteignables par appels directs depuis `setup` et `loop` (lambdas rattachées à leur fonction parente) : 232 ; **aucune** fonction d'écran, de tactile, de carte SD, d'animation, d'ACK ou d'image ; 36 appels indirects non suivis (limite honnête de l'analyse, voir § 6).
4. **Constructeurs statiques** : les objets `tft`, `ts` et `SD` sont **construits** avant `setup()` (constructeurs `Adafruit_ILI9341`, `Adafruit_STMPE610`, `Adafruit_SPITFT`, `Adafruit_GFX`), mais l'analyse ELF montre que les constructeurs statiques n'atteignent **aucun** accès au bus (`pinMode`, `digitalWrite`, SPI) : ils n'initialisent que des champs.
5. **Pas de pragma** : GCC 7 ignore `-Wunused-function` par pragma pour ces avertissements ; une fonction statique jamais appelée (`voteCanaryNeverCalledRefs`, `unused`, sans appelant, éliminée à l'édition de liens — `nm` : absente du binaire) prend l'adresse des 14 fonctions restées inutilisées afin que le build de vote n'ajoute **aucun avertissement**. Elle n'est pas atteignable depuis les points d'entrée (l'analyse le vérifie).

## 4. Compteurs du harnais (tests hôte, `tests/tft28VoteCanary.test.ts`, 23 tests)
Le harnais compte TOUT accès à l'écran (`g_hwTft` + bus + remplissages + textes + fenêtres), au tactile (`g_hwTouch` + interrogations), à la carte SD (`g_hwSd` + ouvertures / lectures / écritures / suppressions) et à `onSd` (`g_hwOnSd`, par une copie de test de `pod_sd_stack.h` qui incrémente le compteur). Il exécute le **vrai `setup()` puis la vraie boucle** :

| Scénario | Résultat vérifié |
|---|---|
| démarrage nominal + vote (candidat annoncé avec frame, animation, banc d'essai et observation) | 1 register, 1 pull, 1 validate, 1 lecture, 1 POST signé ; **tous les compteurs écran / tactile / SD / onSd = 0** ; 0 ACK, 0 pull-frame, 0 observation, 0 banc d'essai |
| register échoué deux fois (HTTP 500) puis réussi | échecs journalisés par la série seulement (3 requêtes register), compteurs = 0, vote |
| appareil non appairé | arrêt définitif, **0 pull, 0 validate, 0 lecture, 0 POST**, verrou intact, compteurs = 0, cause journalisée |
| sensibilité | appeler directement `tftStatus`, `initSD`, `ts.begin`, `ts.touched` incrémente bien les compteurs (sinon les zéros ne prouveraient rien) |

Mutants dynamiques ajoutés (refusés) : `tft.begin` ou `initSD` réintroduits dans `setup` ; `registerShowFailure` dans register ; `registerShowOnboarding` sur carte non appairée.

## 5. Mesures (cœurs 1.5.3 et 1.6.0 ; `docs/mesures/8B2E_V4_FIX1_2026_10_14/`, mêmes résultats sur les deux cœurs)
| Build | Flash | RAM statique | Avertissements |
|---|---:|---:|---|
| production | 158 740 o | 21 532 o | identiques à V3-FIX1 et V4 |
| canari d'affichage | 149 704 o | 21 464 o | identiques à V3-FIX1 et V4 |
| **canari de vote** | **134 264 o** | **15 824 o** | **identiques à la production** |
| `VoteLockErase` (outil manuel) | 57 116 o | 7 176 o | identiques entre cœurs |

Pile principale du build de vote (analyse statique, 1.6.0) : `doValidateV2` marge 568 o ; `doRegister` 312 o depuis `setup` (576 o depuis `loop`) ; `setup` 232 o, `loop` 112 o. Aucune dégradation par rapport à V4.

## 6. Limites
1. L'analyse de portée suit les **appels directs** et rattache les lambdas à leur parent ; les 36 **appels indirects** de l'ELF (fonctions virtuelles de `Print`/`Stream`, pointeurs de fonction du cœur) ne sont pas suivis : l'analyse source (par nom) les couvre pour le code du sketch, pas pour le cœur Arduino.
2. Les objets `tft`, `ts`, `SD` restent **construits** (champs initialisés, aucun accès au bus, vérifié sur l'ELF). Aucun test sur carte : le comportement réel des broches CS (`HIGH`) n'est pas mesuré.
3. Le correctif ne touche pas à la production : le défaut de l'ACK (`TFT28-ACK-STATE-FIX1`) reste un lot séparé à réaliser avant l'intégration finale.
4. Suite complète : voir § 7.

## 7. Suite globale
(complétée à la livraison)

## 8. Rollback
`git revert` du commit : retour exact à `448bc759` (V4).

## 9. Suite
Audit GPT/Codex de V4-FIX1 ; **précondition non logicielle** du protocole (§ 7 du lot V4, ajoutée) : preuve, hors firmware, que le domaine de prévisualisation utilise un Redis dédié et que le candidat épinglé n'existe que sur ce backend ; revalidation du transport (frame personnelle + animation) avec le canari d'affichage ; puis un seul essai.
