# Audit de la chaîne de vote du R4 + TFT 2,8″ et plan du futur canari de vote — 13 octobre 2026

| | |
|---|---|
| **Statut** | **Audit et documentation seulement.** Aucune ligne de firmware, de serveur, de protocole, de Redis, de Neon ni d'OTA n'est modifiée. Aucun vote, aucun flash. |
| **Base** | `3f9b35e` (firmware identique à `0059f74`, vérifié par `git diff --stat 0059f74 3f9b35e -- arduino_uno_r4 consensus-pod` : vide). Branche `claude/r4-tft28-vote-audit-8b2e`, worktree séparé ; la branche du canari animation n'est pas touchée. |
| **Toolchain des mesures** | arduino-cli 1.4.1, `arm-none-eabi-gcc` 7.2.1 (7-2017q4, chaîne Arduino), cœurs R4 1.5.3 et 1.6.0 (répertoires dédiés), `SD` 1.3.0 ; build **production** (`POD_CANARY=0`, vote compilé). Mesures dans `docs/mesures/8B2E_VOTE_AUDIT_2026_10_13/`. |
| **Limite fondamentale** | **Rien de ce document n'est mesuré sur la carte** : le canari actuel exclut le vote de son binaire. Toutes les marges sont des analyses STATIQUES (appels directs seulement : ni interruptions, ni appels indirects, ni `alloca`). |
| **Secrets** | `secrets.h` n'a été ni lu ni copié (compilation sur une copie avec `secrets.h.example`). |

## 0. Synthèse en dix lignes

1. La voie de vote du TFT est un **portage** de la voie e-ink 2,9″ : lecture du candidat en flux sur la pile réseau dédiée → SHA-256 + métriques → verdict → signature `PodEd` → `POST /api/validation-result` → (éventuelle) ré-inscription différée.
2. **Marge principale statique au vote v2 : 152 o** (cadre de `doValidateV2` 352 o, 568 o de chaîne ; 872 / 1 024 depuis `loop`). Au-dessus du minimum de 128 o, **sous l'objectif de 256 o**, et jamais confirmée sur la carte.
3. Une **esquisse mesurée** (non appliquée) montre qu'un découpage en trois phases `noinline` avec la structure de travail au tas donne **248 o** ; 256 o est atteignable en y déplaçant aussi `sig[64]` (−64 o de cadre). § 5.
4. La voie **v1** (écho du score du serveur) reste atteignable sur le TFT et tient 384 o de pile dans `sniprintf` : à retirer du canari de vote (§ 4, R-H2).
5. **Aucun test hôte n'exécute la chaîne de vote du firmware TFT** (le harnais ne sait que « déjà voté ») : c'est le premier chantier (§ 6).
6. Les 21 `deserializeJson` : les **5 du TFT sont déjà sur la pile de travail** ; Wi-Fi, TLS, SD et JSON ne sont **atteignables sur la pile principale par aucun appel direct** (§ 3).
7. Défauts trouvés (§ 4) : auto-test Ed25519 non bloquant, `keysLoaded` jamais vérifié avant de signer, `netReadCandidate` qui ignore le défaut collant du client TLS, 5 gestionnaires d'échec de pile réseau sans arrêt sûr sur `GUARD`, aucun verrou « un seul vote », issue du POST non distinguée (`-4` / `-5`).
8. L'imbrication illégale est **refusée dynamiquement et à l'unisson** (même prédicat « SP est-il sur la pile principale ? »), vérifiée statiquement par `netStack`, `wifiCalls`, `edStack`, `validateJsonStack` pour les cinq sketches ; le chemin vote n'en viole aucune règle (§ 3.3).
9. Le canari de vote exige un **backend isolé** : avec un seul appareil actif, un seul vote atteint le quorum et **mine un vrai bloc** (§ 8). C'est la décision D-V1 à prendre avant tout flash.
10. La **sauvegarde SD distribuée** est cadrée dans un document séparé : `docs/SPEC_SAUVEGARDE_SD_DISTRIBUEE_R4_TFT28_2026_10_13.md`. Elle ne démarre qu'après un canari animation vert, et n'est pas un préalable du canari de vote.

## 1. La chaîne auditée, étape par étape

```
/api/pull  ── pendingValidation.candidateId ──► pendingCandidateId (RAM)            doPullApply / POD_CANARY_CANDIDATE
loop(): pendingCandidateId ≠ "" ET ≥ VALIDATE_INTERVAL depuis lastValidateMs        loop() l.2007
  doValidate()
    httpCall GET /api/validate-candidate?deviceId=…                                  pile réseau dédiée (netHttpRaw)
    doValidateDecode(resp)  ── JSON sur la pile de TRAVAIL, borné, refus jamais troncature
        mode 0 : rien (déjà voté / pas de candidat / réponse refusée / échec de pile) → pendingCandidateId = ""
        mode 1 : { v2: écran, taille, hash } → pendingCandidateId = "" ; doValidateV2
        mode 2 : v1 (score_server)           → doValidateV1  ◄── À RETIRER DU CANARI DE VOTE
  doValidateV2
    netReadCandidate  GET /api/candidate-frame?candidateId=…                         pile réseau dédiée, FERMÉE avant la suite
        podCheckStream : SHA-256 + métriques entières, 153 600 o lus en flux (tft28)
    podVerdict (hash annoncé == hash calculé ; non uniforme ; pas de bruit)          « accept » ou motif de refus
    podVoteMessage → PodEd::sign                                                     pile Ed25519 dédiée (2 304 o), jamais imbriquée
    httpCall POST /api/validation-result  (v2 signé)                                 pile réseau dédiée
        200  → "blockMined": true → loop(): delay(2000) + doPull()
        403 « Signature » → registered = false  → loop(): doRegister() au tour suivant   (réinscription DÉTACHÉE)
        autres codes / -2 / -3 / -4 / -5 → journal seulement
```

Serveur (lu, non modifié) : `validate-candidate` répond `{ candidate: { candidateId, score_server, poolScreen, expiresIn, v2? } }` pour le **candidat courant unique** (un seul emplacement Redis), refuse un second vote du même appareil (`alreadyVoted`) ; `validation-result` v2 : signature **obligatoire** (jamais permissive, 403), `rawHash` + `e,t,r` revérifiés (422), quorum historique `⌈0,51 × poolSize⌉` ou comité selon l'environnement ; **le vote qui atteint le quorum mine le bloc**.

## 2. Mesures — cadres et marges de pile principale (statique, production, cœurs 1.6.0 ; 1.5.3 identique)

`hal_entry 8 + arduino_main 16 ; setup 224 ; loop 280` (doValidate est inliné dans `loop`). Pile principale : 1 024 o.

| Chemin | Cadre | Chaîne dessous | Cumul depuis `loop` | **Marge** | Remarque |
|---|---:|---:|---:|---:|---|
| **Nominal v2** (`doValidateV2`) | 352 | 568 | 872 | **152 o** | pire chaîne : `httpCall` (72) + `substring` / `String` / `realloc` (144) ; `PodCheck` (≈ 100 o), `sig[64]`, 3 `String` et leurs temporaires dans le cadre |
| v2, **signature** (`PodEd::sign`) | — | 796 jusqu'à la barrière | — | **228 o** (rapport Ed25519) | la signature elle-même tourne sur la pile dédiée ; seul le trampoline est sur la pile principale |
| **v1** (`doValidateV1`) | 144 | 384 (`sniprintf`) + … = 528 | 832 | **192 o** | `snprintf("%d.%03d")` pose 384 o de pile ; voie à retirer |
| décodage `validate` (`doValidateDecode`) | 40 | 152 | 456 | 568 o | JSON sur la pile de travail |
| **signature refusée** (403 → `registered=false`) | — | — | — | = marge du POST (152 o) | le chemin ne descend pas plus bas que le POST ; la ré-inscription n'est PAS dans `doValidate` |
| **réseau en erreur** (`-2`, `-3`, `-4`, `-5`) | — | — | — | = marge de `httpCall` (504 o depuis `loop`) | le gestionnaire d'échec n'ajoute que `logf` (barrière : pile de journal) |
| **réinscription** (`doRegister`, tour de `loop` suivant) | 8 | 456 | 760 | **264 o** | même sous-arbre qu'au démarrage (REGISTER-STACK-FIX2) |

Autres piles dédiées sur le chemin du vote (statique) : réseau (lecture du candidat) ≈ 1 040 – 1 184 o sur 2 048 o (budget 1 856 o) ; Ed25519 `sign` : 1 148 o dans la bibliothèque, **pile PodEd 2 304 o** ; travail (JSON `validate`) < 1 536 o sur 2 048 o. Valeurs de la pile Ed25519 **validées sur carte e-ink 2,9″** au lot 8B-2B-2 (≥ 708 o de marge) — pas encore sur ce TFT en conditions de vote ; les piles réseau/SD/travail du TFT le sont par le canari FIX2 (marges 732 – 740 o) mais **jamais avec la lecture d'un candidat de 153 600 o ni avec un POST de vote**.

Données de 3 sources à ne pas confondre : (a) `docs/LOT_8B2D…` § 3.4 annonce **120 o** pour le vote v2 (mesure faite avec le compilateur du bac à sable Linux, 8B2D) ; (b) la présente mesure avec la chaîne Arduino officielle donne **152 o** ; (c) aucune des deux n'inclut les interruptions (≈ 100 – 200 o à prévoir sur la R4 selon les relevés de PodNet).

## 3. Inventaire des exécutions sur la pile principale

### 3.1 Résultat objectif (accessibilité par appels directs depuis `hal_entry`, sans traverser une pile dédiée — `docs/mesures/8B2E_VOTE_AUDIT_2026_10_13/inventaire-pile-principale-prod-1.6.0.txt`)

| Famille | Atteignable sur la pile principale ? | Détail |
|---|---|---|
| `deserializeJson` (ArduinoJson) | **non** — 0 fonction | 5 sites TFT (`registerParseWork`, `pullParseWork` ×2, `validateParseWork`, `benchPollParseWork`) tous sur `podWorkRun` (`scripts/json-inventory.js`) ; 12 autres sites dans les **autres** firmwares R4 restent sur la pile principale (hors périmètre) |
| Appels Wi-Fi (`WiFi.*`, `ModemClass`) | **non** — 0 fonction | six enveloppes `podWifiRun` ; testé statiquement (`wifiCalls.test.ts`) et dans l'ELF |
| TLS (`WiFiSSLClient`, `PodBoundedSSL`) | **non** | toute transaction passe par `podNetRun` ; `Conn` n'existe que dans des lambdas |
| Ed25519 | **non** (bibliothèque) | `PodEd` seul ; **SHA-256 : 6 fonctions depuis `setup`** (`gatherEntropy`, génération des clés au premier démarrage seulement), jamais depuis la voie de vote (le SHA-256 du candidat est un `static` utilisé sur la pile réseau) |
| Carte SD | **non** — 0 fonction | `onSd` partout |
| TFT / GFX / tactile | **oui, 37 fonctions** depuis `setup`, `loop` et `drainTouch` | affichages d'état, cartel, restauration : **aucun sur la voie du vote** |
| Journal (`vsniprintf`) | `logf` a sa pile ; **`sniprintf` direct : 1 appel** | uniquement `doValidateV1` (la voie v1) |
| `String` / tas | 58 fonctions | omniprésent ; la chaîne `String → realloc → _malloc_r → _sbrk` pèse 120 – 168 o |

Total : 339 fonctions atteignables, **61 appels indirects** dans ces fonctions (Adafruit/STMPE610, non suivis par l'analyse — réserve R-M7).

### 3.2 Gestionnaires d'échec de pile (constat)
`sdStackFailed`, `wifiFailed`, `registerWorkFailed`, `pullWorkFailed`, `validateWorkFailed`, le banc d'essai (`l.1538`) appellent `logfSafeStop()` sur `GUARD` **avant** tout journal (règle du dépôt : « `logf` alloue au tas »). **Cinq gestionnaires de pile RÉSEAU ne le font pas** : `httpCall` (l.606), `doFetchFrame` (l.808), **`netReadCandidate` (l.1307)**, le clip du banc (l.1573) et `netGetBlockClipToSd` (l.1741). En canari, `POD_CANARY_NET` tranche avant (arrêt sûr sur marge < 128 o) ; **en production — donc au vote — non** (R-M1).

### 3.3 Matrice d'imbrication (qui peut être appelé depuis quelle pile)
Prédicat unique : `__builtin_frame_address(0)` dans `[__StackLimit, __StackTop]` (`podNetOnMainStack` / `podEdOnMainStack`).

| Appelant ↓ \ Appelé → | PodNet (réseau, 2 048) | PodWork (2 048) | PodWifi (1 536) | PodEd (2 304) | journal (1 536) | SD (`onSd`, 1 536) |
|---|---|---|---|---|---|---|
| pile principale | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| dans PodNet | ✘ NESTED | ✘ | ✘ | ✘ | ✔ direct (sans nouvelle pile) | ✔ direct (écriture du clip : 1 040 o dans 1 856) |
| dans PodWork | ✘ | ✘ | ✘ | ✘ | ✔ direct | ✔ direct (inutilisé) |
| dans PodEd | ✘ | ✘ | ✘ | ✘ | **à éviter** (jamais appelé) | ✘ |
| dans la pile SD | ✘ | ✘ | ✘ | ✘ | ✔ direct | ✔ direct |
| dans le journal | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ |

Garanties : l'imbrication refusée rend `NESTED` (**transaction NON exécutée**) ; `onSd` et `logf` « exécution directe » ne vérifient **pas la capacité restante** de la pile hôte : c'est correct tant que les appelants restent ceux de la matrice (budgets §2) et doit être couvert par une mutation (§ 6, M-14). Le chemin vote respecte la matrice : la lecture du candidat est **fermée avant** la signature (`netReadCandidate` revient avant `PodEd::sign`), le POST est après la signature, la ré-inscription est dans `loop`.

## 4. Défauts et risques, classés

### Bloquants pour un canari de vote

| # | Constat | Pourquoi bloquant | Correctif minimal |
|---|---|---|---|
| **R-B1** | Marge principale statique du vote v2 : **152 o** (objectif 256 o), non mesurée sur la carte, aucun instrument de pile dans la voie vote (le canari actuel l'exclut). | Un dépassement de la pile principale de 1 024 o corrompt le haut du tas **en silence** (cf. incidents 08 – 10/10). | § 5 : découpage en phases + `VoteWork` au tas ; instrument de pile dans un build « canari de vote ». |
| **R-B2** | **Aucun test hôte** ne couvre le chemin « lecture → verdict → signature → POST → réponse » du firmware TFT (le harnais ne scripte que `validate-candidate` → `alreadyVoted`). | Impossible de garantir « pas de vote sur données incomplètes / hash faux / signature ratée ». | § 6 : extension du harnais et mutations. |
| **R-B3** | Pas de **verrou « un seul vote »** persistant ni de **candidat épinglé** : après un reset, un **autre** candidat serait voté. | « Un seul candidat connu, arrêt après un vote » n'est pas garanti. | § 7 : hash du contenu épinglé à la compilation + drapeau « dépensé » en EEPROM. |

### Élevés

| # | Constat | Correctif minimal |
|---|---|---|
| **R-H1** | `selfTestEd25519()` journalise « ECHEC » mais **ne bloque rien** ; `doValidate*` ne vérifie **pas `keysLoaded`** ni le résultat de l'auto-test. Une clé nulle (génération annulée) ou incohérente signerait puis recevrait 403 → ré-inscription. | `g_voteGate` : `keysLoaded && selfTestOk && registered && paired` sinon aucun vote (journal explicite). |
| **R-H2** | La voie **v1** (`mode 2`) est atteignable sur le TFT : signature de `score_server` recopié, `snprintf` (384 o de pile), et **un vote v1 ne doit jamais valider une animation v3** (CLAUDE.md). | `POD_VOTE_V1 = 0` : `mode 2` → aucun vote, journal ; `doValidateV1` et `signED25519` absents du binaire du canari de vote. |
| **R-H3** | `netReadCandidate` ne contrôle **ni `c.client.fault()` ni `c.rd.complete()`** (le clip et l'image le font) : le vote est décidé sur « nombre d'octets reçus == annoncé ». | Même condition que `netGetBlockClipToSd` : `chk.ok && complete && fault()==0`, sinon `chk` remis à zéro. |
| **R-H4** | Le POST ne distingue pas **« non exécuté »** (`-4`) de **« exécuté mais résultat local rejeté »** (`-5`, le vote a pu partir) ni de `-2/-3` ; le message affiché (« 403 = signature, 422 = … ») est faux pour ces codes ; et `pendingCandidateId` a été effacé AVANT la lecture. | Énumération `VoteOutcome` (NOT_SENT, SENT_UNKNOWN, ACCEPTED, REFUSED_BY_SERVER, SIGNATURE_REFUSED, HASH_REFUSED) ; journal par valeur ; **aucune nouvelle tentative automatique** après `SENT_UNKNOWN`. |
| **R-H5** | Décision de protocole : sur **divergence de hash**, le firmware vote **reject signé** (voulu : « refus enregistré par le serveur »). La consigne de ce lot demande « aucun vote si le hash échoue ». | D-V2 à trancher par GPT (§ 9). Pour le **canari** : abstention et arrêt sur toute divergence. |

### Moyens

| # | Constat | Correctif minimal |
|---|---|---|
| **R-M1** | Cinq gestionnaires de pile réseau sans `logfSafeStop()` sur `GUARD` (§ 3.2). | Un gestionnaire commun `netStackFailed(what, ni)` qui appelle `logfSafeStop()` d'abord. |
| **R-M2** | Re-registration : chaque vote refusé « Signature » entraîne un `doRegister()` ; si le serveur ne met pas la clé à jour, une **boucle d'un re-register par candidat** est possible ; `registered=false` est déclenché par une simple sous-chaîne « Signature » du corps. | Plafond : 1 ré-inscription par candidat et par heure ; non déclenchée en canari de vote (journal seulement). |
| **R-M3** | RAM statique de **4 992 o** (`g_voteScratch` 4 736 + `g_voteChunk` 256) pour un besoin réel (e-ink 2,9″ : 4 736 o ; OLED : 1 024 o ; **tft28 : 0**). | Canari de vote épinglé `tft28` : `scratch = NULL`, tampon statique retiré (tas +4,7 Ko). Production : décision D-V3. |
| **R-M4** | Durée du vote : lecture de 153 600 o + hash + métriques dans `loop` (`POD_FETCH_TIMEOUT_MS` = 40 s) : le toucher et l'animation sont figés pendant ce temps. | À **mesurer** au canari ; bornes déjà en place (40 s). |
| **R-M5** | `loop()` : `doValidate()` est inliné ; le cadre de 280 o de `loop` porte 3 `String` du vote. | Reste après le découpage (cadre `loop` 272 – 280 o) ; envisager `noinline` seulement avec V1 retiré (sinon +96 o au pire chemin, mesuré : 104 o de marge). |
| **R-M6** | `podCheckStream` utilise des `static` (`PodFeeder`, `SHA256`) : état résiduel possible entre deux appels. | `begin()` / `reset()` sont appelés à chaque lecture (vérifié) ; garder une mutation de non-réinitialisation. |
| **R-M7** | 61 appels indirects (Adafruit, STMPE610) non suivis par l'analyse statique. | Le canari de vote mesure la pile principale par peinture (instrument existant du canari). |

### Faibles
Entropie des clés (`gatherEntropy` : bruit analogique + `micros()` + MAC + RSSI, « suffisant pour identifier un écran, pas un générateur certifié » — point K5 du plan de travail, lot 8.6) : sans incidence sur ce lot mais à ne pas oublier avant un vote réel durable. `logf` de vote affiche `Echec vote (%d) : 403 = …` quel que soit le code ; `pendingCandidateId` effacé avant la lecture (un vote perdu n'est jamais rejoué avant le prochain `pull` ; acceptable, à documenter) ; chaînes `[VALIDATE]`/`[VALIDATE2]` non homogènes.

## 5. Architecture proposée (≥ 128 o de marge principale garantis, 256 o visés)

### 5.1 Esquisse mesurée (non appliquée)
Variante A, compilée dans une copie jetable (`docs/mesures/8B2E_VOTE_AUDIT_2026_10_13/ESQUISSE_sketch_phases_NON_APPLIQUEE.js` + `esquisse-phases-pile-principale-1.6.0.txt`) :

| | cadre | cumul `loop` | marge |
|---|---:|---:|---:|
| `doValidateV2` d'origine | 352 | 872 | **152 o** |
| `doValidateV2` en 3 phases (`votePhaseRead` 48, `votePhaseSign` 32, `votePhasePost` 144) + `VoteWork` au tas | 112 | 776 | **248 o** |
| même, avec `sig[64]` déplacé dans `VoteWork` (estimation −64 o de cadre) | ≈ 48 | ≈ 712 | **≈ 312 o** (à re-mesurer) |

RAM statique inchangée (21 468 o) ; flash −328 o. **La seule voie qui reste plus étroite est la voie v1 (192 o) — qu'on retire.**

### 5.2 Architecture cible (pour le lot d'implémentation, après le résultat matériel de l'animation)
```
doValidate()                                  petit cadre, pas de String locale longue
  ├─ gate  (keysLoaded ∧ selfTestOk ∧ registered ∧ paired ∧ latch « vote non dépensé »)   sinon : aucun vote, journal
  ├─ doValidateDecode()                       JSON sur pile de travail (inchangé) ; mode 2 (v1) REFUSÉ
  ├─ [canari] candidat épinglé : écran == tft28 ∧ hash annoncé == POD_VOTE_PIN_HASH       sinon : aucun vote
  ├─ votePhaseRead()                          netReadCandidate (pile réseau FERMÉE au retour) ; exige ok ∧ complete ∧ fault()==0
  │                                           ∧ octets == annoncés ; verdict ; si hash ≠ annoncé : canari → abstention
  ├─ votePhaseSign()                          message + PodEd::sign ; échec ⇒ aucun envoi ; (option canari : PodEd::verify)
  └─ votePhasePost()                          corps + httpCall ; VoteOutcome ; latch « dépensé » écrit AVANT l'envoi
  [retour] loop(): si SIGNATURE_REFUSED ∧ plafond non atteint → registered=false (ré-inscription détachée)
```
Principes : (1) chaque phase `noinline` détruit ses `String` avant la suivante ; (2) tout état volumineux (`PodCheck`, signature) dans une structure au tas allouée une fois (`new (std::nothrow)`) et libérée sur tous les chemins ; (3) aucune sortie avant un résultat complet ; (4) tout échec de pile ⇒ aucun vote, `GUARD` ⇒ arrêt sûr silencieux d'abord ; (5) jamais de `snprintf`/`printf` sur la pile principale du vote ; (6) l'instrument du canari relève le cadre de chaque phase.

## 6. Tests hôte et mutations à écrire (cahier des charges, rien n'est écrit)

Extension de `consensus-pod/host/tft28_harness.cpp` : routes scriptées `GET /api/validate-candidate` (candidat v2 `tft28` avec hash annoncé), `GET /api/candidate-frame` (153 600 o, avec fautes : tronqué, silence, octet altéré, défaut collant, plus long que annoncé), `POST /api/validation-result` (200 `blockMined` vrai / faux, 403 « Signature », 422, 409, 429, connexion refusée, corps illisible, `-4` et `-5` injectés par `g_failNext` / garde simulée), `PodEd` réel contre une vérification TypeScript (`lib/ed25519.ts verifyEd25519`, `voteMessageV2`).

| # | Scénario (production, sauf mention) | Attendu |
|---|---|---|
| S1 | candidat valide, tout réussit | exactement 1 POST ; corps v2 conforme ; signature **valide** (vérifiée en TS) ; verdict `accept` ; `VoteOutcome=ACCEPTED` ; latch dépensé |
| S2 | lecture tronquée / silence / plus longue que annoncé | **0 POST** ; « données incomplètes » |
| S3 | octet altéré (hash ≠ annoncé) | canari : **0 POST** ; production : POST `reject` + motif `hash` seulement si D-V2 le confirme |
| S4 | défaut collant du client TLS après les octets complets | **0 POST** (R-H3) |
| S5 | `PodEd::sign` échoue (NOMEM / NESTED / MARGIN) | **0 POST** ; aucun état « voté » |
| S6 | auto-test Ed25519 en échec, ou `keysLoaded` faux | **0 requête** `candidate-frame` et **0 POST** (R-H1) |
| S7 | réponse 403 « Signature » | `registered=false` posé, **aucun `doRegister` dans `doValidate`**, un seul re-register au tour de `loop` suivant, plafond respecté |
| S8 | `httpCall` renvoie `-4` (non exécuté) | journal « NON envoyé » ; pas de latch dépensé (canari : arrêt) |
| S9 | `httpCall` renvoie `-5` (exécuté, rejeté localement) | journal « a PU atteindre le serveur » ; latch **dépensé** ; **aucune** nouvelle tentative |
| S10 | même candidat annoncé deux fois (pull puis pull) | 1 seul vote (`alreadyVoted` + latch) |
| S11 | reset simulé après le POST, candidat ré-annoncé | pas de second vote (serveur `alreadyVoted` ; latch EEPROM) |
| S12 | candidat d'un autre écran / d'un autre hash que l'épinglé (canari) | **0 requête `candidate-frame`**, **0 POST** |
| S13 | mode 2 (v1) annoncé | **0 POST** (`POD_VOTE_V1=0`) |
| S14 | aucun affichage, aucun ACK, aucun cache SD modifié pendant tout vote | invariant vérifié sur tous les scénarios |
| S15 | pile principale peinte : marge mesurée par le harnais `canary_check` après chaque phase | ≥ 128 o, objectif 256 o |

Mutations à REFUSER (chaque mutant doit faire échouer au moins un scénario) : M-1 hash non comparé ; M-2 `chk.ok` ignoré ; M-3 `complete()`/`fault()` ignorés ; M-4 signature non testée (`if (!sign) …` supprimé) ; M-5 latch non posé / posé après l'envoi ; M-6 `keysLoaded` ignoré ; M-7 mode 2 admis ; M-8 `doRegister()` appelé depuis `doValidate` ; M-9 `-4` et `-5` confondus ; M-10 candidat non épinglé ; M-11 second vote autorisé après un 200 ; M-12 ACK/affichage déclenché par le vote ; M-13 `GUARD` sans arrêt sûr dans `netReadCandidate` ; M-14 `onSd`/`logf` appelés depuis une pile `PodEd` ; M-15 `PodEd::sign` appelé DANS la transaction de lecture (imbriqué) ; M-16 `new` non libéré (fuite de `VoteWork`). Tests statiques (comme `validateJsonStack.test.ts`) : ordre lecture < signature < POST, absence de `snprintf` dans la voie, aucune `String` globale, `VoteWork` libéré sur tous les chemins.

## 7. Protocole du futur canari de vote CONTRÔLÉ (à n'exécuter qu'après : canari animation vert, lot d'implémentation, audit GPT)

### 7.1 Principe
Un build **local** (jamais commité) `-DPOD_VOTE_CANARY=1 -DPOD_CANARY=1 -DPOD_VOTE_V1=0 -DPOD_VOTE_PIN_HASH="<sha256 hex du contenu connu>" -DPOD_VOTE_MAX=1` : le firmware refuse tout candidat dont le hash annoncé n'est pas EXACTEMENT celui épinglé, vote **une seule fois** (verrou en EEPROM), puis **s'arrête** (arrêt sûr silencieux après le journal du résultat).

### 7.2 Préconditions (D-V1 à trancher)
- **Backend isolé recommandé** (déploiement de prévisualisation avec Redis dédié ; `ELIGIBILITY_MODE`, `COMMITTEE_MODE`, `BLOCK_RECEIPTS` explicitement fixés) : un unique appareil actif ⇒ `poolSize = 1` ⇒ quorum = 1 ⇒ **le vote mine un bloc**. Sur la production, ce bloc serait réel et permanent.
- Aucun autre appareil actif (ou aucun capable de voter) pendant l'essai ; le dessin candidat est soumis **avant** le flash, son contenu et son SHA-256 sont connus et notés ; son format est `tft28` (153 600 o).
- Retour arrière prêt : binaire stable `POD_CANARY=0`, sauvegarde du `.ino`, carte SD intacte.
- Le porteur lit le journal ; **aucune ligne contenant une clé privée n'existe** (vérifier).

### 7.3 Déroulé
1. Flash du canari de vote ; démarrage **sans candidat** : lignes `[CANARY] BUILD … VOTE-CANARY pin=<8 premiers hex>`, `[CANARY] vote : verrou EEPROM=libre`, marges de pile au boot.
2. Au moins 3 pulls sans candidat : aucun `validate-candidate`.
3. Soumission du candidat épinglé. Au pull suivant : `pendingCandidateId` posé ; au tour de `VALIDATE_INTERVAL` : `GET /api/validate-candidate` ; **si le hash annoncé ≠ épinglé : arrêt sans lecture**.
4. Lecture du candidat : `[HTTP GET] /api/candidate-frame -> 200`, `[CANARY] pile reseau candidat …` (≥ 128 o, objectif 256), durée de lecture, `bytes=153600`, `e t r s`, `hash=…` (== épinglé).
5. Signature : `[CANARY] ed25519 sign … marge …`, `signature en N ms`.
6. POST unique : `[CANARY] VOTE ENVOYE (verrou DEPENSE) candidat=…` **avant** l'envoi, puis `[VALIDATE2] vote -> 200`, `blockMined`.
7. Arrêt : `[CANARY] VOTE TERMINE — arrêt sûr` ; plus aucune requête.

### 7.4 Preuves attendues
**Série** : toutes les lignes ci-dessus dans l'ordre ; `grep -c "validation-result"` = 1 ; marges : pile principale ≥ 128 o à chaque contrôle, réseau ≥ 128 o, Ed25519 ≥ 128 o ; tas stable. **Serveur** (journaux Vercel de l'environnement isolé) : `validate-candidate` 200 pour le seul appareil ; `validation-result` : « vote v2 » / signature valide / `votes=1/1 quorum=true` / bloc miné (index, hash) ; **0** autre appel `validation-result` ; Redis : carte des votes à 1 entrée, bloc écrit (+ reçus si `BLOCK_RECEIPTS`) ; vérification hors ligne `scripts/verify-block.ts --base <url> --hash <blockHash>` : niveau `content` (hash et métriques recalculés).

### 7.5 Arrêts immédiats
Marge de pile < 128 o (arrêt automatique) ; reset imprévu ; hash annoncé ≠ épinglé ; deux lignes `validation-result` ; `ACK`/affichage sans vote ; 403 (pas de ré-inscription en canari : journal et arrêt) ; lecture > 40 s ; tout `[HTTP …] pile … EXÉCUTÉE mais … REJETÉ`.

## 8. Plan de correctif minimal (ordonné, chaque lot = un commit, arrêt pour audit GPT entre les lots)

| Lot | Contenu | Tests | Condition d'entrée |
|---|---|---|---|
| **V0** | Canari animation vert (verdict matériel archivé) | — | **non commencé** (consigne) |
| **V1** | Harnais de vote de bout en bout sur le firmware TFT (S1 – S5, S8 – S10, S14) **sur le code actuel** + mutations M-1 – M-5, M-9 : établit l'état de référence et révèle les défauts réels | `tft28Host` étendu | V0 |
| **V2** | `POD_VOTE_V1=0`, `g_voteGate` (R-H1), exigence `fault()/complete()` (R-H3), `VoteOutcome` (R-H4), `netStackFailed` avec arrêt sûr (R-M1) | S6, S7, S13 + M-6 – M-8, M-13 | V1 vert |
| **V3** | Découpage en phases + `VoteWork` au tas ; re-mesure statique ; cible ≥ 256 o | rapport de pile, S15 | V2 vert |
| **V4** | Build « canari de vote » : épinglage, verrou EEPROM, arrêt après un vote, instrument de pile dans la voie vote | S10 – S12 + M-10, M-11 | V3 vert + décision D-V1 |
| **V5** | Essai matériel (§ 7) par le porteur | — | audit GPT de V4 |

Aucun de ces lots ne modifie le serveur, Redis, Neon, le protocole, le polling ni l'OTA. La correction de la cadence « frame déjà affichée » (LOT_8B2D § 9.4) est **indépendante** du vote et reste un lot séparé.

## 9. Décisions à prendre (GPT / porteur)

| # | Question | Recommandation |
|---|---|---|
| **D-V1** | Où exécuter le canari de vote : production, ou déploiement de prévisualisation avec Redis dédié ? | Backend isolé ; en production, un bloc réel et permanent serait créé. |
| **D-V2** | Divergence de hash : voter `reject` signé (protocole actuel) ou s'abstenir ? | Canari : abstention + arrêt. Production : conserver `reject` signé. |
| **D-V3** | RAM statique du vote (4 992 o) : garder, rendre dynamique, ou ne voter que pour les écrans sans scratch ? | Canari : épinglé `tft28`, sans scratch. Production : décision après mesure du tas. |
| **D-V4** | Faut-il vérifier sa propre signature (`PodEd::verify`, 1 388 o sur la pile dédiée) avant le POST ? | Oui, en canari seulement (coût mesurable). |
| **D-V5** | Plafond de ré-inscription après 403 : 1 par candidat et par heure ? | Oui ; zéro en canari. |

## 10. Ce que cet audit ne prouve pas
Aucune marge réelle (interruptions, appels indirects, 153 600 o par TLS avec `PodBoundedSSL`), aucune durée de vote, aucun comportement du serveur sous quorum > 1, aucune validité de la signature sur la carte (seuls l'auto-test du boot et le canari e-ink 2,9″ l'ont exercée), aucun vote réel du TFT. Les mesures ci-dessus sont reproductibles : `node docs/mesures/8B2E_VOTE_AUDIT_2026_10_13/callees.js <worktree> <fichier.dis> <symbole>` et `scripts/tft28-stack-report.js`.
