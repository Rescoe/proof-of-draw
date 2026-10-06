# Note Claude — audit du calcul réel, comparaison avec une blockchain IoT distribuée, mises à jour à distance, cartels e-ink, `consensusPoD.h`

| | |
|---|---|
| **Auteur** | Claude (note « C ») — une note équivalente est écrite en parallèle par GPT ; l'analyse croisée viendra ensuite. |
| **Date** | 06/10/2026 — dépôt `main`, dernier commit `879ef21`. |
| **Contexte** | Premier essai réel à 4 appareils réussi (affichage multiscreen animation/image, TFT 1,8″, e-ink 2,9″ ESP **et** R4). Le TFT 2,8″ tactile (R4) n'a **pas** encore été essayé en vote/calcul. |
| **Méthode** | Lecture du code (serveur + firmwares + cœurs Arduino installés localement), compilations réelles, calculs reproductibles, recherches web. **Rien n'a été modifié dans le code** pour cette note : c'est un état des lieux. |

**Légende** (même convention que `CHANTIER_VALIDATION_REELLE.md`) : **[C]** confirmé par lecture du code ou exécution ce jour · **[D]** dit par une documentation, non revérifié · **[E]** estimation/raisonnement, à mesurer · **[P]** proposition · **[?]** je n'ai pas pu le vérifier.

---

## 0. Résumé (à lire en premier)

1. **Oui, les appareils calculent réellement** [C]. Un ESP8266 ou une R4 en firmware v2 télécharge le contenu brut du candidat, en calcule **le SHA-256 et trois métriques entières** (entropie, transitions, RLE) *en flux*, **signe** le résultat en Ed25519 et l'envoie. Le serveur refuse tout vote « accept » dont le hash ou une métrique diffère **d'un seul ppm**. La parité C++/TypeScript a été prouvée par `g++` (tests). C'est une vraie victoire : c'était un écho du score serveur jusqu'au 05/10.
2. **Mais ce n'est pas encore un consensus distribué** [C]. Le serveur reste **l'oracle** (un vote est « bon » s'il est égal à ce que le serveur a calculé), il est **le seul à finaliser**, il **ne conserve pas les votes signés dans le bloc**, et un appareil v1 (écho) compte encore comme une approbation. Un tiers ne peut donc **pas** vérifier un bloc sans faire confiance au serveur. Niveau honnête atteint aujourd'hui : **N1 partiel** (« des appareils ont recalculé ces octets exacts »), pas N2 complet, pas de comité, pas de vérification publique.
3. **Le « taux de menteurs » promis dans la doc n'existe pas encore** [C]. C'est la phase P5 (comité, seuil 2/3, simulations avec 30 % d'appareils fictifs) : **non commencée**. Le quorum actuel (51 % des appareils *appairés* actifs) peut être atteint par des votes d'appareils **non appairés** (la route de vote ne vérifie pas l'appairage) : face à 4 vrais appareils (quorum 3), trois faux appareils enregistrés par simple requête HTTP suffisent à finaliser (§ 3.3). *[Corrigé le 06/10 après lecture de l'audit GPT : ma première version affirmait à tort que les faux appareils gonflaient le quorum.]*
4. **Les prochains gains sont peu coûteux** : (a) **conserver les votes signés dans le bloc** + y lier `parentHash` → bloc vérifiable hors serveur ; (b) **un vote par profil, auteur exclu, comité tiré au sort** ; (c) **hash salé par appareil** pour qu'on ne puisse pas recopier la réponse d'un voisin ; (d) vérificateur public. Rien de tout cela n'exige plus de RAM sur l'ESP8266.
5. **Mises à jour à distance : faisables** (§ 6) — ESP8266 via `ESP8266httpUpdate` + **binaire signé** (le cœur installé contient `signing.py` et `Update.installSignature`), R4 via la bibliothèque officielle `OTAUpdate` (présente dans le cœur 1.5.3 installé). **Une première installation manuelle reste nécessaire**, mais on peut la rendre universelle (un seul binaire par famille, **identifiants Wi-Fi saisis ensuite** par portail captif et stockés en EEPROM/`Preferences`) : c'est ce qui rend les mises à jour distantes possibles *sans* recompiler par utilisateur.
6. **Cartels e-ink** (§ 7) : le firmware **efface 28 lignes sur 128** (22 %) de l'e-ink 2,9″ et 26 sur 176 (15 %) de l'e-ink 2,7″ pour y graver le texte [C]. Solution **sans reflash** : dessiner sur une zone réservée (canvas 296×100, complété en blanc par le serveur). Solution **avec reflash** : un réglage `cartelMode` lu dans `/api/pull`. Je recommande les deux, dans cet ordre.
7. **`consensusPoD.h`** (§ 8) : **faisable et souhaitable**, mais **à publier seulement après gel du protocole v3** (sinon on publie un protocole connu pour être incomplet). Le noyau portable existe déjà (`pod_metrics.h`, message de vote) ; il reste à isoler l'E/S derrière une petite interface et à produire un nœud « sans écran » (ESP32 / Raspberry Pi / PC) qui sert aussi de banc de simulation.

---

## 1. Ce qui est réellement calculé, appareil par appareil

### 1.1 Ce que fait un validateur v2 (identique sur toutes les familles) [C]

```
GET  /api/validate-candidate?deviceId=…          → { candidate: { candidateId, score_server, v2:{screen, bytes, hash} } }
GET  /api/candidate-frame?candidateId=…           → octets bruts du contenu (immuable, CDN)
     ── pour chaque morceau lu (256 o) ──
        SHA-256 (BearSSL sur ESP8266 ; bibliothèque SHA256 sur R4)
        PodFeeder → PodMetrics : ones, runs, transitions, ligne précédente (aucun tampon d'image)
     ── fin ──
        e = TABLE_ENTROPIE[ round(1024·ones/n) ]   t = 10⁶·T/total   r = isqrt(10¹²·runs/n)   s = (4e+4t+2r)/10
        verdict = accept | reject(hash | blank | noise)
        message = pod-vote-v2|deviceId|candidateId|hash|2|e|t|r|verdict      → signature Ed25519 (clé privée en EEPROM)
POST /api/validation-result { v:2, deviceId, candidateId, rawHash, e, t, r, verdict, signature }
```

Fichiers : `esp8266/_shared/pod_metrics.h` (cœur, 143 l.), `pod_vote_esp.h` (ESP8266 : lecture HTTPS + SHA-256 + verdict), `arduino_uno_r4/*/pod_vote_r4.h` (R4), `lib/podMetrics.ts` + `lib/podVote.ts` (miroir serveur).

### 1.2 Ce que chaque famille calcule vraiment

| Famille (firmware) | Contenu relu | Tampon | Mesures / état |
|---|---|---|---|
| ESP8266 e-ink 2,9″ BWR (`"2.2"`) | 9 472 o (noir ‖ rouge) | `scratch` 4 736 o **alloué après le TLS** | essai réel ✔ (vous) |
| ESP8266 multiscreen e-ink 2,7″ + OLED (`multiscreen-2.5`) | 5 808 o ou 1 024 o (lit n'importe quel écran) | scratch alloué après TLS | essai réel ✔ |
| ESP8266 TFT 1,8″ (`tft18-2.4`) | 40 960 o (RGB565) | aucun | essai réel ✔ |
| R4 + e-ink 2,9″ (`r4eink29-1.1`) | 9 472 o | statiques | essai réel ✔ |
| R4 + TFT 2,8″ tactile (`r4tft28-2.5`) | 153 600 o | `g_voteScratch[4736]` statique | **non essayé** ; lecture série ≈ 15-25 s [D] |
| R4 e-ink 2,7″ / e-ink 2,7″ + OLED / TFT 1,8″ (ports GPT) | idem | statiques | essai réel ✔ (retour du porteur, 06/10) |
| **ESP8266 e-ink 2,7″ BW « seul »** (`eink27bw-2.0`) | **aucun calcul** : le sketch n'a pas `doValidateV2` ni `pod_vote_esp.h` | — | **reste en v1 (écho)** — omis de ma première version, relevé par GPT, vérifié [C] |

**Ce que ça prouve** : l'appareil *a lu* le contenu (sinon e/t/r seraient faux) et possède la clé qui signe. **Ce que ça ne prouve pas** : que le calcul a été fait *sur le microcontrôleur* — un script sur PC qui connaît la clé fait pareil (le contenu est public, l'enregistrement est ouvert, § 3.4).

### 1.3 Ce qui n'est PAS calculé / reste décoratif [C]

| Élément | Réalité |
|---|---|
| **Animations** | un candidat animation n'a pas de `v2` : les appareils votent en **v1 (écho du score serveur)** (`validate-candidate/route.ts` l. 98 ; `Candidate.v2` absent pour `kind:"animation"`). Aucun calcul par image côté appareil. |
| **Ré-validation des blocs précédents** (`obs-confirm`, `observer-result`) | l'ESP renvoie la liste de hashes **qu'on lui a donnée**, sans signature, sans calcul (`doObsConfirm`, `app/api/obs-confirm/route.ts`). Le champ `revalidated[].observerIds` / `obsConfirmed` est **cosmétique** : il ne doit pas être présenté comme une vérification. |
| **Preuve de geste (N3)** | uniquement serveur (`drawScore`, replay, `automationRatio`) — et ses résultats ne sont pas re-calculables par un tiers aujourd'hui (la séquence d'actions est stockée, le moteur est pur : c'est faisable, § 5.5). |
| **Seuils qualité** | informatifs seulement (F5 du chantier). |
| **`score`** | avec des votes v2 « accept », le score final = score serveur (les appareils sont forcés d'être égaux au serveur) : le calcul ne *peut* pas diverger, donc ne peut pas encore *corriger* le serveur. |

---

## 2. Écart entre ce qui était annoncé et ce qui existe

Doc de référence : `CHANTIER_VALIDATION_REELLE.md` (niveaux N0-N3, phases P0-P6) et `REPRISE_2026_10_06…` (garde-fous G1-G5).

| Annoncé | État réel | Niveau |
|---|---|---|
| P1 métriques entières déterministes | **Fait**, parité C++/TS prouvée sur 5 écrans | ✔ [C] |
| P2 vote v2 signé, contenu servi par CDN, refus signé recevable | **Fait** | ✔ [C] |
| P3/P4 firmwares ESP8266 et R4 | **Faits**, essai réel concluant sur 4 familles | ✔ (vos essais) |
| G1 rejets v2 non bloquants pendant le canari | **Fait** (`ENFORCE_V2_REJECTIONS`) | ✔ [C] |
| G2 votes atomiques | **Fait** (Lua `VOTE_SCRIPT`) ; sémantique réelle sur Upstash à confirmer dans les logs | ✔/[?] |
| `MIN_V2_APPROVALS` (bloc seulement si N approbations recalculées) | **Fait**, **désactivé par défaut** | ◐ |
| P0 identité : épinglage de clé | codé mais **désactivé** (`PIN_DEVICE_KEY=false`) | ✘ en pratique |
| P0 : un vote par profil, auteur exclu, appairage exigé, récupération de clé | **non fait** | ✘ |
| P0 : signature stricte | **non activée** (`STRICT_SIGNATURE=false`) ; vote v2 stricte de fait, v1 permissive | ◐ |
| P5 comité tiré au sort, seuil 2/3, simulations « 30 % fictifs » | **non commencé** | ✘ |
| P6 vérificateur public, bloc vérifiable hors serveur, audit N3 | **non commencé** | ✘ |
| « taux de menteurs » (tolérance aux appareils malhonnêtes) | **aucun modèle implémenté** ; seule trace : l'étape P5 du plan de test | ✘ |

---

## 3. Face à une vraie blockchain IoT distribuée

### 3.1 Tableau comparatif

| Propriété d'une blockchain distribuée | PoD aujourd'hui | Écart |
|---|---|---|
| **Réplication** : N nœuds gardent la chaîne | une seule copie dans Redis (Upstash) ; aucun appareil ne stocke ni ne vérifie la chaîne | total |
| **Un seul auteur de la tête** ? | oui : le serveur écrit `chain:head` (finalisation par un handler Vercel) | total |
| **Preuve d'acceptation vérifiable par un tiers** | les votes signés sont dans `candidate:votes` puis **supprimés** (`clearCandidate`) ; le bloc ne garde que `validatorIds` et un compte `votesSummary` (additif, **hors hash**) [C] | **bloquant** |
| **Liaison votes ↔ bloc** | la signature couvre `candidateId` + hash + e/t/r + verdict, **pas** `parentHash` : un vote ne prouve pas « j'ai validé *à cette position de la chaîne* » | à ajouter |
| **Sélection des validateurs** | tous les appareils actifs, v1 inclus ; quorum 51 % de `poolSize` figé à la soumission | à remplacer par un comité |
| **Sélection du mineur** | `Math.random()` côté serveur, pondération inverse du nombre de blocs (`selectEquitableMiner`) — **non rejouable** | à rendre déterministe/vérifiable |
| **Anti-Sybil** | enregistrement ouvert : MAC *déclarée* (non secrète), pas de preuve de possession de clé, plafond global + 5 register/min/IP ; l'appairage à un profil n'est **pas exigé pour voter** [C] | critique |
| **Finalité / fork** | pas de fork possible (écrivain unique) ; finalité = écriture Redis | acceptable tant que le serveur est l'autorité |
| **Tolérance aux fautes byzantines** | aucune garantie formelle | à définir (§ 3.3) |
| **Ancrage externe de la tête** | aucun | facile (§ 5.4) |
| **Authentification du serveur par l'appareil** | `setInsecure()` partout (pas de validation de certificat) [C] ; les signatures de vote protègent le contenu, mais pas un firmware OTA futur | à traiter avec l'OTA |

**Verdict.** Aujourd'hui PoD est une **chaîne de blocs à autorité unique avec témoins** (« PoA à un seul signataire + témoins qui confirment le hash »). C'est une base **honnête et correcte pour l'étape actuelle**, à condition de ne pas l'appeler « consensus distribué » avant d'avoir au minimum le point 3 (votes signés conservés dans le bloc).

### 3.2 Ce que l'état actuel garantit réellement

- **Intégrité du contenu** : un appareil v2 « accept » signé ⇒ le contenu qu'il a lu a exactement ce hash et ces métriques (sinon 422). [C]
- **Non-rejeu d'un vote sur un autre candidat** : le message signé contient `candidateId` et `hash`. [C]
- **Liveness** : un candidat unique, quorum numérique, TTL 30 min. [C]
- **Pas de garantie** : que les votants soient indépendants, que ce soient de vrais appareils, ni que le bloc soit vérifiable après coup.

### 3.3 « Taux de menteurs » : ce que le système tolère aujourd'hui, et ce que viserait le comité

**Aujourd'hui** : quorum = `ceil(0,51 × poolSize)`, où `poolSize` = appareils **appairés** actifs (`getGlobalActiveCount`) ; mais **tout appareil enregistré et actif peut voter** (aucun contrôle d'appairage dans `validation-result`), et le vote est **par appareil**. Avec 4 vrais appareils appairés (pool 4, quorum 3) :

| Faux appareils **non appairés** votant | pool (inchangé) | quorum | Les faux seuls l'atteignent ? |
|---|---|---|---|
| 1-2 | 4 | 3 | non (mais ils comptent dans les 3) |
| **3** | 4 | 3 | **oui** — bloc finalisé sans aucun vrai appareil |

Conséquences réalistes [E, déduites du code, non rejouées] :
- **Capture** : trois requêtes d'enregistrement + trois votes v1 « écho » finalisent un candidat et attribuent la propriété du bloc (`ownerDeviceId`) à un faux appareil. Un faux v2 doit en revanche reproduire hash et métriques exacts : il lui faut télécharger le contenu public, ce qui est trivial sur PC.
- **Blocage** : il n'est possible qu'en faisant **appairer** des faux appareils (ce qui gonfle `poolSize`) ; la facilité dépend de `/api/onboard` (non auditée ici).
- Un contenu altéré reste **impossible** à faire valider (hash lié) et il faut un candidat émis par le serveur : c'est le garde-fou majeur actuel.

**Comité visé** (proposition P5 : K membres tirés par profil, seuil ⌈2K/3⌉, avec repli séquentiel). Probabilité qu'une fraction *f* de profils malhonnêtes (tirage indépendant, calcul binomial reproductible par `node -e`) :

| K (seuil) | f = 10 % | f = 20 % | f = 30 % | f = 40 % |
|---|---|---|---|---|
| 7 (5) — fausse acceptation | 0,02 % | 0,47 % | **2,9 %** | 9,6 % |
| 7 (5) — blocage d'un tirage | 2,6 % | 14,8 % | 35 % | 58 % |
| 13 (9) — fausse acceptation | 0,00 % | 0,02 % | 0,40 % | 3,2 % |
| 13 (9) — blocage d'un tirage | 0,6 % | 9,9 % | 35 % | 65 % |

Lecture : avec K = 7 on tolère raisonnablement ~20 % de profils malhonnêtes pour la sûreté ; le **blocage** (liveness) est plus sensible — d'où le **repli séquentiel** (si un membre ne répond pas, le suivant) et un comité mixte **appareils + serveur-référence** pendant l'amorçage. À 3 artistes réels, **aucun** de ces chiffres ne s'applique : il faut le mode `bootstrap` étiqueté déjà décidé. Je recommande de **ne jamais promettre un taux** avant d'avoir la simulation P5 (§ 5.6).

### 3.4 Une limite structurelle à dire honnêtement

Aucune preuve cryptographique ne peut établir « ce calcul a été fait sur *un ESP* » : pas d'élément sécurisé, clé lisible dans l'EEPROM [D], enregistrement par MAC déclarée. **Le calcul-preuve ne résiste pas à un attaquant doté d'un PC** (un PC est ~10⁴ fois plus rapide qu'un ESP8266 : tout puzzle de type hashcash dimensionné pour l'ESP est trivial pour lui). La résistance au Sybil doit donc venir de **l'identité** (profil appairé, ancienneté, réputation), pas du calcul. C'est cohérent avec la décision déjà prise (vote par profil). Le calcul reste utile pour **l'intégrité** et pour **détecter les paresseux** (un appareil qui recopierait un hash).

---

## 4. Constats, bugs et choses étranges (à traiter après coup)

Priorité : 🔴 impacte la sûreté / la vérité des affichages · 🟠 important · 🟡 mineur.

| # | Gravité | Constat | Source | Action proposée |
|---|---|---|---|---|
| **K1** | 🔴 | **Les votes signés ne sont pas conservés** : `clearCandidate()` supprime `candidate:votes` ; `Block` ne garde que `validatorIds` et `votesSummary` (hors hash). Un bloc n'est pas vérifiable hors serveur. | `lib/chain.ts` `finalizeBlock`, `app/api/validation-result` | Stocker `votes[]` (id public, hash, e/t/r, verdict, signature ≈ 130 o/vote) dans `chain:block:*` ; inclure leur racine dans `blockHash` pour les **nouveaux** blocs (version de bloc). |
| **K2** | 🔴 | **Enregistrement sans preuve de possession** : l'identité = MAC déclarée ; la clé publique est acceptée telle quelle (`PIN_DEVICE_KEY=false`) ; n'importe quel script crée/usurpe un appareil. | `app/api/register/route.ts` | Défi-réponse : `register` renvoie un nonce, le suivant exige une signature ; épinglage + récupération par session propriétaire (déjà décidée). |
| **K3** | 🔴 | **Vote non réservé aux appareils appairés** et **auteur non exclu** (aucun test de `candidate.deviceId` / profil dans `validation-result` ni `validate-candidate`). | `app/api/validation-result/route.ts` | Éligibilité côté serveur (voir reste de P0). |
| **K4** | 🔴 | **Incohérence pool/vote** : `poolSize` (`getGlobalActiveCount`) ne compte que les appareils **appairés** actifs, mais `validate-candidate` et `validation-result` acceptent tout appareil enregistré et actif. Des votes non appairés s'ajoutent au numérateur sans toucher au dénominateur (§ 3.3). *(Constat de GPT, vérifié ; ma version initiale décrivait l'inverse.)* | `lib/deviceStore.ts` l. 388-416, `app/api/validation-result/route.ts` | Une seule fonction d'éligibilité partagée par le pool, `validate-candidate` et `validation-result`. |
| **K5** | 🟠 | **Génération de la clé privée ESP8266 : entropie faible** : `randomSeed(analogRead(A0) ^ millis() ^ RSSI)` puis `random(256) ^ analogRead(A0)` (PRNG 32 bits, broche A0 flottante). Le champ des clés possibles est loin de 2²⁵⁶. La R4, elle, hache 384 lectures ADC + `micros()` + MAC + RSSI (mieux, mais pas un TRNG). | `esp8266/*/*.ino` `generateKeys()` ; `pod_uno_r4_*.ino` `gatherEntropy()` | ESP8266 : `ESP.random()` / registre matériel `RANDOM_REG32` (Wi-Fi allumé) ; R4 : le TRNG du RA4M1 si exposé. Les clés existantes ne changent qu'au prochain reset de clé (acceptable, à documenter). |
| **K6** | 🟠 | **Sélection du mineur non rejouable** (`Math.random()` serveur). | `lib/chain.ts` `selectEquitableMiner` | Tirage déterministe `SHA-256(candidateId ‖ parentHash ‖ clé)` — publiquement recalculable. |
| **K7** | 🟠 | **`obs-confirm` / `observer-result` : écho non signé** ; `revalidated[].observerIds`/`obsConfirmed` ressemble à une vérification sans en être une. À ne pas afficher comme « re-vérifié ». | `app/api/obs-confirm/route.ts`, `esp_*.ino doObsConfirm()` | Soit le supprimer, soit en faire une vraie revérification signée (re-hash du bloc via `/api/block-image`). |
| **K8** | 🟠 | **Animations : vote v1 (écho)** : tant qu'une animation n'a pas de spécification `v2` (par image + racine), ses « validations » sont des échos. | `lib/podVote.ts` `buildCandidateV2` (null si animation) | Spécifier `pod-anim-v2` : hash du clip + e/t/r par image (déjà calculables par `lib/anim/block.ts`). |
| **K9** | 🟡 | **TLS non authentifié** : `client.setInsecure()` sur toutes les requêtes (frames, votes, futur OTA). Un attaquant sur le réseau local peut censurer ou servir de fausses frames ; il ne peut pas forger un vote (signature) mais pourrait servir un faux binaire OTA. | tous les `.ino` | Épinglage d'empreinte du certificat ou CA ; **obligatoire** avant l'OTA (ou binaire signé, § 6). |
| **K10** | 🟡 | **`/api/candidate-frame` met en cache 30 s un 404** quand le candidat demandé n'est pas encore « courant » : un validateur trop rapide peut empoisonner le CDN 30 s pour cette URL. | `app/api/candidate-frame/route.ts` l. 25 | `Cache-Control: no-store` sur le 404. |
| **K11** | 🟡 | **`finalizeBlock` lit tête et longueur puis écrit sans verrou** : sûr tant qu'un seul candidat existe et que `claimFinalization` protège, mais fragile si on autorise deux candidats ou l'importation de blocs. | `lib/chain.ts` | Script atomique ou `WATCH`/CAS avant d'augmenter le débit. |
| **K12** | 🟡 | **Le score final d'un bloc `(score serveur + moyenne des scores votés)/2`** mélange échos v1 et v2 ; tant que les v2 sont forcés égaux au serveur, c'est neutre, mais cela masque un éventuel désaccord. | `lib/chain.ts` l. 487 | À revoir avec le comité. |
| **K14** | 🟠 | **`reason` non signé** : le verdict l'est, pas le motif du refus ; un relais pourrait en changer le texte. *(GPT)* | `lib/podVote.ts` `voteMessageV2` | Signer un code de règle + `rulesVersion` dans le message (v3). |
| **K15** | 🟠 | **Le serveur ne revérifie pas `blank`/`noise`** : il vérifie hash et métriques, pas les règles N2 avant d'accepter un verdict signé ; et `blank` désigne toute image **uniforme** (blanche *ou* pleine), pas seulement « vide ». *(GPT, vérifié)* | `lib/podVote.ts` `checkVoteV2`, `pod_vote_esp.h` `podVerdict` | Réappliquer les règles côté serveur ; renommer le motif `uniform`. |
| **K13** | 🟡 | **Redemande de clé au téléversement R4** (EEPROM effacée) ⇒ nouveau `deviceId` ⇒ outil « Ancien ➜ Nouveau » déjà fait ; mais l'épinglage de clé strict le casserait. | `lib/keyPinning.ts` | Prévoir la récupération par le profil avant d'activer `PIN_DEVICE_KEY`. |

---

## 5. Propositions d'algorithmes pour des calculs réels de « preuve de dessin »

### 5.1 Ce qu'on peut raisonnablement attester sur un MCU

Rappel du principe retenu (`CHANTIER` § 3) : les appareils attestent **N1-N2** (intégrité, règles objectives) ; **N3** (le geste) reste serveur/auditeurs. Recherches (littérature IoT, voir sources) : les consensus « légers » adaptés à des nœuds contraints sont plutôt de type **autorité/témoins** (PoA, « Clique ») que de type PoW ; des variantes comme *Proof-of-Authentication*, *Proof-of-Resource* ou *Proof-of-Trusted-Work* cherchent précisément à faire participer des nœuds faibles sans PoW. Notre architecture (autorité serveur + témoins signés) est donc dans la bonne famille.

### 5.2 Propositions, par ordre d'intérêt/coût

| # | Proposition | Idée | Coût appareil | Apporte |
|---|---|---|---|---|
| **A1** | **Hash salé par appareil** (« preuve de lecture ») | l'appareil signe aussi `H(nonce ‖ contenu)` avec `nonce = H(candidateId ‖ parentHash ‖ deviceId)` ; le serveur le recalcule | un 2ᵉ contexte SHA-256 (~100 o de RAM) | impossible de recopier le vote d'un voisin ou de répondre sans avoir lu le contenu **pour soi** ; rend visibles les paresseux |
| **A2** | **Signature spatiale** (métrique v3) | grille 8×8 de comptages de pixels actifs (64 octets) + dHash 64 bits en flux | une ligne + 64 compteurs | détecte les copies/quasi-doublons entre blocs (anti-plagiat) ; plus riche que 3 scalaires ; reste entier/déterministe |
| **A3** | **Calcul proportionnel à la capacité** (classes) | classe A (ESP8266/R4) : métriques v2 ; classe B (ESP32) : + A2 + composantes connexes (tampon 1 bit ≤ 20 Ko) ; classe C (Pi/PC) : replay N3 | variable | vote déclare `vclass` ; le comité exige ≥ 1 membre de classe B/C — reprend l'Annexe C du chantier |
| **A4** | **Votes liés à la position dans la chaîne** | le message signé inclut `parentHash` (+ version de bloc) ; le bloc embarque les signatures | 0 | un tiers recalcule `blockHash`, vérifie chaque Ed25519 → **bloc vérifiable** (corrige K1) |
| **A5** | **Tirage de comité déterministe** | rang = `SHA-256(candidateId ‖ parentHash ‖ clé publique)` ; K=7 ; repli séquentiel ; **un vote par profil** | 0 (serveur) | vérifiable a posteriori, imprévisible avant le candidat ; l'étape « VRF » d'Algorand (ECVRF-Ed25519) donnerait un tirage *privé* mais demande des opérations de courbe absentes de la bibliothèque `Crypto` actuelle — **hors de portée immédiate** [?] |
| **A6** | **Témoignage collectif (co-signature)** de la tête | en plus des votes, la tête `blockHash` est co-signée par ≥ ⌈2K/3⌉ témoins (style transparence de certificats) | 1 signature de plus (~15 ms sur ESP8266 [E]) | le serveur ne peut plus forger de tête sans les clés des témoins |
| **A7** | **Ancrage externe périodique** | publier `chain:head` toutes les N h (commit GitHub, OpenTimestamps/Bitcoin, ou transaction publique) | 0 | preuve d'antériorité indépendante, **coût nul** |
| **A8** | **Auditeurs N3** (navigateur / Pi) | rejouer `actionSequence` avec le moteur pur, vérifier replay = image, `drawScore`, rythme humain, publier une signature d'audit | — | seule vraie preuve de « fait à la main », non bloquante |

**Recommandation** : A4 + A5 (+ éligibilité par profil) d'abord (serveur, pas de reflash), puis A1 et A2 au prochain cycle firmware (en même temps que l'OTA/`cartelMode`), A7 tout de suite (gratuit). Éviter tout PoW : il n'apporte rien contre un attaquant doté d'un PC (§ 3.4) et brûle l'énergie des ESP.

### 5.3 Pourquoi le serveur doit cesser d'être l'oracle

Aujourd'hui `checkVoteV2` exige `vote == calcul serveur`. Pour un vrai consensus, le serveur devient **un votant parmi d'autres** : le bloc est valide si ≥ ⌈2K/3⌉ membres du comité signent **le même tuple (hash, e, t, r)** ; le serveur publie sa propre valeur mais n'est plus juge. Cela ne change rien tant que tout le monde est honnête, mais permet de **détecter un serveur défaillant** (le comité refuse) — c'est le vrai sens de « distribué ». À faire **après** A4/A5, sinon le désaccord ne peut pas être démontré.

### 5.4 Ancrage (A7) — coût
Une écriture par jour (ex. un fichier `anchor.json` dans le dépôt par GitHub Action, ou un horodatage OpenTimestamps) ; aucune commande Redis de plus, aucun firmware.

### 5.5 N3 par un tiers
Le moteur de dessin est pur et déterministe (`lib/drawEngine`) ; `chain:actions:*` conserve la séquence. Un auditeur navigateur n'a besoin que de `GET /api/block-actions` et du bloc : **aucun nouveau secret**. Coût serveur nul (lecture CDN).

### 5.6 Plan de simulation (avant de parler de « taux »)
Le test différentiel `g++` existe déjà ; un **nœud hôte** (§ 8) permet de lancer 100-500 faux appareils contre un serveur de test avec une fraction f de menteurs (hash faux, métriques fausses, clones, MAC rejouées) et de **mesurer** : fausses acceptations, blocages, commandes Redis par bloc. C'est la phase P5 du chantier ; elle ne demande aucun matériel.

---

## 6. Mises à jour à distance (OTA) — faisabilité

### 6.1 Faits constatés ce jour [C]

| | ESP8266 | UNO R4 WiFi |
|---|---|---|
| Taille actuelle du programme | e-ink 2,9″ : **408 Ko** ; multiscreen : **474 Ko** ; TFT 1,8″ : **502 Ko** de flash (+ ~29 Ko IRAM) sur 1 019 Ko disponibles (profil `4M2M`) | e-ink 2,9″ : **118 Ko / 262 Ko** (45 %) |
| RAM statique | 34,8 à 36,1 Ko / 80 Ko (règle ≤ 40 Ko du dépôt) | 22,8 Ko / 32 Ko (69 %) |
| Bibliothèque OTA dans le cœur installé | `ESP8266httpUpdate`, `ArduinoOTA`, outil `signing.py` + `Update.installSignature()` (cœur 3.1.2) | `OTAUpdate` (cœur renesas 1.5.3) : `setCACert`, `begin(file)`, `download(url)`, `verify()`, `update()`, `reset()` — le module Wi-Fi (ESP32-S3) télécharge le fichier |
| Persistance du Wi-Fi | `WiFi.persistent` vaut **false** par défaut dans ce cœur ; à activer ou stocker en EEPROM | pas de persistance Wi-Fi native ; `Preferences` et `EEPROM` existent dans le cœur |

### 6.2 Verdict : faisable

**ESP8266** — [E, à valider par un essai]
- Mécanisme standard : `ESPhttpUpdate.update(client, url)` en HTTPS (BearSSL). **Contrainte mémoire** : le TLS réclame ≈ 35 Ko de tas (le même budget que nos GET) ; l'OTA doit donc être faite **juste après la connexion Wi-Fi, avant toute allocation**, comme `/api/register` — on a ≈ 38 Ko après Wi-Fi (`NOTE_MULTISCREEN_TAS`), c'est **juste** : à mesurer. Le binaire (≈ 0,5 Mo) devrait tenir dans l'emplacement OTA de 1 019 Ko ; **si la règle est « ancienne + nouvelle image dans la même zone »** (point soulevé par GPT), le TFT 1,8″ (502 Ko ×2 ≈ 1 004 Ko) est **à la limite** : à mesurer avant de conclure.
- **Signature obligatoire** : `Update.installSignature(&hash, &sign)` avec une clé publique RSA compilée dans le firmware ; `signing.py` signe le `.bin` (outil déjà dans le cœur). Indispensable puisque le TLS n'est pas authentifié (K9) et parce que **pousser du code sur tous les appareils est le pouvoir le plus dangereux du système** : la clé privée de signature ne doit jamais être sur Vercel.
- **Pas de retour arrière automatique** sur ESP8266 (l'ancienne image est écrasée au redémarrage) : une mauvaise image peut exiger un reflash par câble. Parades : déploiement par **vagues** (canari → 10 % → 100 %, par `hash(deviceId) mod 100`), image de **secours** (compteur de redémarrages en EEPROM ; après 3 échecs : point d'accès + téléchargement du firmware « recovery »), et OTA essayée d'abord sur vos 4 appareils.

**UNO R4 WiFi** — [?] partiellement vérifié
- La classe `OTAUpdate` du cœur permet `download → verify → update → reset` avec un CA racine que l'on fournit. Je n'ai **pas** trouvé dans `platform.txt` 1.5.3 la recette qui fabrique le fichier `.ota` en local (l'IDE/Cloud le fait) ni de détails sur la signature d'auteur : **à vérifier** avant de promettre quoi que ce soit. Prévoir : fabrication d'un `.ota` par script, taille maximale, et si `verify()` contrôle autre chose qu'une intégrité (CRC).

### 6.3 Le point clé : séparer les identifiants Wi-Fi du binaire
Aujourd'hui les identifiants sont compilés (`secrets.h`) : chaque utilisateur doit recompiler, donc il n'existe pas de binaire commun. Pour que l'OTA ait un sens :
1. Premier flashage **manuel et unique** d'un binaire universel (par famille de carte/écran) **sans identifiants**.
2. Au premier démarrage : **point d'accès + portail captif** (l'ESP8266 a `DNSServer`/serveur web ; la R4 sait faire `WiFi.beginAP`, exemple `AP_SimpleWebServer` présent) → saisie du SSID/mot de passe → stockage EEPROM (`Preferences` sur R4).
3. Les mises à jour suivantes sont **à distance** et **conservent** les identifiants (stockés hors de l'image).
Bonus [E] : le premier flashage de l'ESP8266 peut se faire **depuis le navigateur** (WebSerial / « ESP Web Tools ») sans Arduino IDE ; non vérifié ici, et sans équivalent connu pour la R4.

### 6.4 Conception proposée (coût Redis nul)
```
manifest statique : public/firmware/manifest.json  (CDN, jamais Redis)
  { "esp-eink29": { "stable": {"v":"2.3","url":"/firmware/esp-eink29-2.3.bin","sha256":"…","sig":"…","minHeap":36000}, "canary": {…} }, … }
Appareil : au démarrage et 1 fois / 24 h → GET manifest (≈ 1 Ko) ; si v_manifest > v_installée ET réglage « mises à jour automatiques » activé ET vague ≥ hash(deviceId)%100 → télécharge, vérifie sha256 + signature, applique.
Réglage par appareil dans « Gérer → Réglages » : Automatique / Manuel / Désactivé (par défaut : Manuel pour la phase de test).
```
**Étapes recommandées** : (1) outil de signature + clé hors ligne ; (2) portail captif + EEPROM ; (3) OTA ESP8266 essayée sur un appareil, mesure du tas ; (4) manifest + vagues ; (5) R4 après vérification du format `.ota`. Chaque étape ≈ une session ; (1)-(2) sont des prérequis communs avec `cartelMode` et A1/A2, d'où l'intérêt de **regrouper dans un seul « gros reflash »**.

---

## 7. Cartels e-ink : réglage ou redimensionnement

### 7.1 Constat [C]
Le firmware grave le cartel **dans le tampon** de l'image reçue, après réception :
- e-ink 2,9″ (296×128) : bandes de 13 px + séparateur en haut (lignes 0-13) et en bas (lignes 114-127) ⇒ **28 lignes sur 128 effacées = 22 % de l'image** ; zone visible réelle : **296×100**.
- e-ink 2,7″ (264×176) : bandes de 13 px de chaque bord ⇒ **26 lignes sur 176 = 15 %** (le commentaire du firmware dit : « l'artwork est légèrement rogné »).
- La page de dessin n'indique **aucune zone sûre** (aucune occurrence « cartel / zone sûre » dans `app/draw`, `lib/drawEngine`, `lib/screenProfiles.ts`).
Les calculs de vote portent sur l'image **avant** gravure : aucun impact sur la validation.

### 7.2 Options

| Option | Reflash ? | Principe | Avantages | Limites |
|---|---|---|---|---|
| **O1 — zone sûre dans l'éditeur** | non | afficher les bandes du cartel en hachures sur le canvas e-ink et empêcher/avertir de dessiner dessous | immédiat, zéro risque | n'aide pas les dessins existants |
| **O2 — canvas réduit + remplissage serveur** | non | pour l'e-ink, dessiner sur **296×100** ; le serveur complète en blanc à 296×128 avant la soumission (pixel-exact, hash et métriques sur l'image complète) | aucune perte, aucun rééchantillonnage | change le format de dessin des e-ink |
| **O3 — redimensionnement automatique des dessins existants** | non | à la diffusion, produire une variante réduite (aire → seuil, rouge préservé) | corrige l'existant | dégrade les pixels (1 bit) ; l'image affichée ≠ image du bloc (déjà le cas pour les conversions inter-écrans) |
| **O4 — `cartelMode` piloté par l'app** | **oui** | `/api/pull` renvoie `cartelMode: "overlay"|"off"|"reserved"` (≈ 20 o) ; le firmware saute `burnEinkCartel` si `off` | l'utilisateur choisit dans « Gérer → Réglages » ; plein cadre possible | demande le reflash (qui sera de toute façon fait pour l'OTA) |

**Recommandation** : **O1 + O2 maintenant** (sans reflash), puis **O4** lors du prochain cycle de firmware (avec l'OTA). O3 seulement comme « ajuster » facultatif pour d'anciennes œuvres. Le réglage doit être **par appareil** (stocké dans l'objet appareil, lu dans le `MGET` du pull : 0 commande Redis de plus).

---

## 8. Faisabilité d'un `consensusPoD.h` réutilisable (séparer écrans / consensus)

### 8.1 État du code aujourd'hui
- **Déjà portable** : `pod_metrics.h` + table (aucune dépendance Arduino, testé en `g++`), construction du message signé, verdict objectif.
- **Dupliqué par plateforme** : `pod_vote_esp.h` (ESP8266 : `WiFiClientSecure` + BearSSL) et `pod_vote_r4.h` (R4 : `pod_http.h` + bibliothèque `SHA256`) — même logique, deux copies.
- **Mélangé aux écrans** : le cycle register → pull → validate → vote vit dans chaque `.ino` (1 000-1 500 lignes chacun), avec la gestion de l'écran.

### 8.2 Architecture cible (3 couches)

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ PoDDisplay-<écran>           │  │ PoDConsensus (consensusPoD.h)│  ← publiable
│ (pilotes, cartel, scene)     │  │ 1. métriques + digest (flux) │
└───────────────┬──────────────┘  │ 2. vote : message, verdict   │
                │ ne se parlent    │ 3. vérif. bloc / signatures  │
                │ que via 3 appels │ 4. machine d'états du nœud   │
┌───────────────┴──────────────┐  └───────────────┬──────────────┘
│ Application (le .ino)         │                  │ interface PodPlatform
└───────────────────────────────┘     ┌────────────┴─────────────┐
                                      │ adaptateurs : ESP8266 /   │
                                      │ R4 / ESP32 / hôte (Linux) │
                                      └───────────────────────────┘
```

Esquisse d'interface (C++ sans STL, sans allocation dynamique) :
```cpp
struct PodPlatform {                         // fourni par l'adaptateur
  bool   (*httpGetStream)(const char* path, PodSink& sink, uint32_t timeoutMs);   // lit en flux
  bool   (*httpPostJson)(const char* path, const char* body, char* resp, size_t n);
  void   (*sha256Update)(void*, const uint8_t*, size_t);  /* init/final aussi */
  void   (*ed25519Sign)(uint8_t sig[64], const uint8_t* msg, size_t n);
  uint32_t (*nowMs)(); void (*log)(const char*);
  bool   (*kvGet)(const char* k, uint8_t* v, size_t n); bool (*kvPut)(const char* k, const uint8_t* v, size_t n);
};
class PodNode { public: void begin(PodPlatform*, const char* deviceId);
                PodStep tick();            // un pas non bloquant : register / pull / validate / vote
                const PodStats& stats(); };
bool podVerifyBlock(const PodBlock&, const PodVote* votes, size_t n);   // vérification hors serveur
```

### 8.3 Ce que ça permet
- **Nœuds sans écran** : un ESP32, un Raspberry Pi ou un PC peuvent **voter sans dessiner** — le protocole n'exige déjà aucun écran pour valider. **Point serveur à adapter** : `register` exige `screens[]` non vide (`app/api/register/route.ts` l. 36) et les pools d'affichage sont indexés par écran ; il faudrait un rôle `validator` (`screens: []`) exclu des diffusions d'images, mais compté pour le comité.
- **Un seul code testé** pour toutes les cartes (fin des « copies identiques » synchronisées par script).
- **Un banc de simulation** : l'adaptateur hôte (OpenSSL/libsodium) devient le moteur de la phase P5.
- **Recherche** : d'autres équipes peuvent brancher leurs propres appareils sur le même protocole.

### 8.4 Risques et conditions
1. **Geler le protocole d'abord** : aujourd'hui les votes ne sont pas liés à `parentHash` et ne sont pas stockés (K1) ; publier maintenant ferait figer une version dont on sait qu'elle changera. Je propose de publier une **v0.x « expérimentale »** avec la spécification et les **vecteurs de test** (`tests/fixtures`), après A4.
2. **Contrainte mémoire ESP8266** : bibliothèque **en en-têtes, sans tampon statique > 2 Ko**, sans allocation pendant le TLS (règles 8-10 de `CLAUDE.md`) ; garder le test `espStaticRam`.
3. **Compatibilité Arduino** : structure `library.properties` + `src/` + `examples/` ; en attendant, le dépôt peut garder des copies synchronisées (`scripts/sync-*`).
4. **Licence et sécurité** : licence permissive (MIT/Apache-2.0) pour le code ; le protocole documenté dans un `SPEC.md` ; clés de signature OTA **jamais** dans le dépôt.

### 8.5 Découpage proposé (une session ≈ une étape)
1. Extraire le noyau (métriques, message, verdict, vérification) **sans changer le comportement** — tests de parité inchangés.
2. Interface `PodPlatform` + adaptateurs ESP8266 et R4 ; porter **un** firmware (e-ink 2,9″) ; essai matériel.
3. Adaptateur hôte + CLI `podnode` (nœud sans écran) + simulation de n appareils (P5).
4. Adaptateur ESP32 (mbedtls) — nœud sans écran bon marché.
5. Publication : README, `SPEC.md`, vecteurs, CI (`g++` + `arduino-cli`), version `0.1.0`.

---

## 9. Plan d'enchaînement recommandé

| Ordre | Chantier | Reflash ? | Pourquoi maintenant |
|---|---|---|---|
| 1 | **K1+A4** : votes signés dans le bloc, liés au `parentHash`, vérificateur Node | non | transforme « le serveur a vérifié » en « n'importe qui peut vérifier » |
| 2 | **P0 restant** : éligibilité par profil, auteur exclu, un vote par profil, défi-réponse `register`, récupération de clé | non | ferme K2-K4 |
| 3 | **A5 + A7** : tirage de comité déterministe, ancrage | non | gratuit côté appareils |
| 4 | Simulation P5 (hôte) avec fraction de menteurs | non | produit les vrais chiffres de tolérance |
| 5 | **O1+O2** zone sûre / canvas réduit e-ink | non | résout les cartels immédiatement |
| 6 | **Gros reflash groupé** : portail captif + OTA signée, `cartelMode`, hash salé A1, signature spatiale A2, entropie des clés K5, `pod-anim-v2` K8 | **oui, une fois** | tout ce qui touche le firmware dans un seul cycle |
| 7 | `consensusPoD.h` v0.x publié | — | après gel du protocole (étapes 1-4 et 6) |

À faire sans attendre (petits et sans risque) : **K10** (404 non mis en cache), documenter K7 dans l'interface (ne pas afficher `obsConfirmed` comme une vérification), et ne pas activer `STRICT_SIGNATURE`/`PIN_DEVICE_KEY`/`ENFORCE_V2_REJECTIONS` avant l'étape 2.

---

## 10. Points à trancher par le porteur

1. **Publier plus tôt ou plus tard** `consensusPoD.h` (je recommande après l'étape 4).
2. **Autoriser des nœuds sans écran** (ESP32/Pi/PC) dans le comité tout de suite, ou d'abord comme observateurs.
3. **Défaut des mises à jour** : Manuel (recommandé pour la phase de test) ou Automatique.
4. **Cartels** : O1+O2 d'abord, ou directement O4 avec le gros reflash.
5. **Clé de signature OTA** : qui la détient, où (hors ligne), et plan de remplacement en cas de perte.
6. **Ancrage public** de la tête de chaîne : où (dépôt GitHub, OpenTimestamps) et à quelle fréquence.

---

## 11. Limites de cette note

- **Je n'ai pas relu les journaux de vos essais** (Serial/Vercel) : l'affirmation « ça calcule » repose sur le code, les tests de parité et votre compte rendu (« tout fonctionne »). Pour l'archive, il faudrait ajouter dans la note de canari les lignes `[VALIDATE2]` (durée, `e/t/r`, `hash`) et `[MEM]` de chaque carte.
- **Aucun essai matériel n'a été fait pour l'OTA** : toutes les affirmations OTA sont [E] ou [?] (R4).
- Le calcul binomial (§ 3.3) suppose des profils malhonnêtes **indépendants** et un tirage uniforme ; une collusion ou un Sybil par profils faux le rend optimiste.
- Les attaques de blocage/capture du § 3.3 sont **déduites du code**, pas rejouées contre un serveur.

## 12. Écarts avec l'audit GPT (analyse croisée du 06/10/2026)

Voir `AUDIT_GPT_CONSENSUS_POD_IOT_2026_10_06.md`. Les deux audits **convergent** sur : calcul v2 réel pour les images fixes, chaîne « centralisée à témoins signés », animations en v1, reçus signés non conservés, mineur non rejouable, `obs-confirm` = écho, `setInsecure()`, comité ≤ 7 profils / 2/3 / auteur exclu / un vote par profil, OTA faisable avec binaire signé, nœuds sans écran via `screens: []` + rôle `validator`.

**Corrigé dans ma note grâce à GPT** : K4 (pool = appairés seulement), ESP e-ink 2,7″ seul resté en v1, K14 (`reason` non signé), K15 (`blank`/`noise` non revérifiés, `blank` = uniforme), état « essayé » des ports R4, nuance flash OTA (ancienne + nouvelle image).

**Que GPT n'a pas relevé (propre à cette note)** : K1 détaillé avec liaison `parentHash` (A4), K5 entropie des clés, K10 cache CDN du 404, K11 finalisation sans verrou, K13 clé R4 régénérée, tableau de tolérance du comité (§ 3.3), taille réelle des binaires, parcours de provisioning Wi-Fi par portail captif, argument « le calcul ne protège pas contre un PC ».

**Désaccords restants** — voir la réponse à l'utilisateur dans la conversation (ordre de la feuille de route, périmètre de `consensusPoD.h`, pondération par classe, cartels et `renderHash`, manifeste OTA).

## Sources consultées

- Documentation du cœur ESP8266 sur les mises à jour OTA et les mises à jour signées : https://esp8266-arduino.readthedocs.io/en/stable/ota_updates/readme.html
- Mises à jour ESP8266 signées et en HTTPS (article de synthèse) : https://mischianti.org/esp8266-ota-update-with-web-browser-sign-the-firmware-and-https-ssl-tls-2/
- Support OTA de l'UNO R4 WiFi (Arduino Cloud) : https://forum.arduino.cc/t/arduino-uno-r4-wifi-over-the-air-ota-updates-supported-in-arduino-cloud/1172045
- Bibliothèque `OTAUpdate` du cœur renesas 1.5.3 (lue localement) : `…/Arduino15/packages/arduino/hardware/renesas_uno/1.5.3/libraries/OTAUpdate`
- Consensus légers pour IoT (PoA, Proof-of-Authentication, Proof-of-Resource, Proof-of-Trusted-Work) : https://journal.hep.com.cn/dcn/EN/1214938943520490135 et https://eprints.whiterose.ac.uk/190836
- Tirage de comité par fonction aléatoire vérifiable (Algorand) : https://developer.algorand.org/docs/algorand_consensus et https://docs.oasis.io/adrs/0010-vrf-elections

## Fichiers lus pour cette note (preuves)

`app/api/validation-result/route.ts`, `app/api/validate-candidate/route.ts`, `app/api/candidate-frame/route.ts`, `app/api/register/route.ts`, `app/api/obs-confirm/route.ts`, `app/api/observer-result/route.ts`, `lib/chain.ts` (`castVote`, `finalizeBlock`, `selectEquitableMiner`), `lib/podVote.ts`, `lib/podMetrics.ts`, `lib/validationSummary.ts`, `lib/keyPinning.ts`, `esp8266/_shared/pod_metrics.h`, `esp8266/_shared/pod_vote_esp.h`, `arduino_uno_r4/pod_uno_r4_eink29/pod_vote_r4.h`, `esp8266/esp_tft1.8/esp_tft1.8.ino` (`generateKeys`, `doValidateV2`), `esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino` (cartel), `esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino` (cartel), `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` (`gatherEntropy`), docs `CHANTIER_VALIDATION_REELLE.md`, `REPRISE_2026_10_06_VALIDATION_ET_RESEAU.md`, `CANARI_MULTI_ESP_PROTOCOLE.md`.
