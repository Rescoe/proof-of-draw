# Plan de travail — du canari validé au système de consensus final (avant nœuds Raspberry et PoDScan)

| | |
|---|---|
| **Date** | 06/10/2026 — dépôt `main` |
| **Auteur** | Claude (réalisateur). Plan à **auditer et ordonnancer par GPT** (orchestrateur/auditeur) puis à valider par le porteur. |
| **Objectif** | Un système **robuste et final** : calculs poussés sur les appareils, consensus **extrait** dans une bibliothèque réutilisable, preuves **vérifiables hors du serveur**, **animations calculées**, documentation à jour — de façon à pouvoir ensuite attaquer les nœuds Raspberry et un explorateur public **PoDScan** (équivalent d'Etherscan). |
| **Sources** | `NOTE_CLAUDE_AUDIT_VALIDATION_CONSENSUS_OTA_2026_10_06.md`, `AUDIT_GPT_CONSENSUS_POD_IOT_2026_10_06.md`, `CHANTIER_VALIDATION_REELLE.md`, `REPRISE_2026_10_06_VALIDATION_ET_RESEAU.md`, `CANARI_*`. |
| **État de départ** | Vote v2 recalculé et signé, validé sur 4 familles de cartes (06/10). Livré depuis : e-ink 2,7″ seul en v2 (compilé, non essayé). Reste à essayer : e-ink 2,7″ seul, R4 + TFT 2,8″. |

Légende : **[S]** serveur seul, sans reflash · **[F]** firmware, reflash · **[U]** action du porteur (essai matériel, déploiement, décision) · **[A]** audit GPT.

---

## 0. Rôles et règles de travail

### 0.1 Rôles
| Acteur | Rôle | Livrables |
|---|---|---|
| **GPT — orchestrateur et auditeur** | ordonnance les lots, gèle les spécifications, rédige les critères d'acceptation, audite chaque lot (code + tests + docs) avant de le déclarer clos, tient le **journal de décisions**, écrit des **tests hostiles indépendants** (red team) et, pour les formats critiques, une **seconde implémentation indépendante du vérificateur** (différentiel). | notes d'audit par lot, journal de décisions, tests hostiles, vérificateur indépendant |
| **Claude — réalisateur** | implémente (serveur, firmwares, bibliothèque, interface, documentation technique), écrit les tests, compile les firmwares, commit **par lot** avec le coût Redis dans le message. | code, tests, docs, commits |
| **Porteur du projet** | essais sur cartes, `git push`, variables Vercel, décisions de produit, flash. | traces série, essais, arbitrages |

### 0.2 Règles (reprises du dépôt, non négociables)
1. **Quota Redis d'abord** : tout lot écrit le coût en commandes/heure/acteur *avant* le code ; comités bornés (≤ 7), pas de `SCAN`, pas de nouveau polling.
2. **Règles mémoire ESP8266** (`CLAUDE.md` 1-10) : pas de gros tampon pendant le TLS, `[HEAP] après WiFi` ≈ 38 Ko relevé après chaque changement, RAM statique ≤ 40 000 o.
3. **Sauvegarde** dans `firmware-backups/<date>/` avant toute modification d'un `.ino` ; jamais d'identifiants Wi-Fi commités ; `git add` par chemin explicite.
4. **Rien ne passe « fait » sans preuve** : tests, essai matériel ou usage réel. Tout code non essayé sur carte porte l'avertissement « non testé ».
5. **Compatibilité** : un firmware ancien continue d'**afficher** ; les blocs existants ne sont jamais réécrits (version de bloc/vote explicite).
6. Avant chaque commit : `npm test`, `npx tsc --noEmit` ; pour un firmware : compilation `arduino-cli` + relevé RAM statique.
7. **Vocabulaire honnête** dans l'interface et la documentation : le niveau annoncé = le niveau atteint (page Apprendre, feuille de route).

### 0.3 Cycle d'un lot
```
GPT : spécification + critères d'acceptation ──► Claude : code + tests + doc + commit
        ▲                                                   │
        └────────── audit [A] (revue, tests hostiles) ◄─────┘
                         │ OK
                         ▼   [U] essai matériel / déploiement si le lot le demande
                   lot CLOS : feuille de route (Apprendre) et CLAUDE.md mis à jour
```

---

## 1. Décisions prises par défaut (à confirmer par le porteur, § 11)

Issues de la comparaison des deux audits ; elles évitent de bloquer les lots.

| # | Décision | Origine |
|---|---|---|
| D1 | Comité de **7 profils max**, seuil **⌈2K/3⌉**, repli séquentiel, **un vote par profil**, **auteur exclu** | commune |
| D2 | **Mode `bootstrap`** étiqueté (« validation partielle k/K ») tant que < 3 profils éligibles non-auteurs ; jamais présenté comme « validé par le réseau » | `REPRISE` |
| D3 | Niveaux de calcul **C0 / C1 / C2** (nomenclature GPT) ; **pas de poids de vote supplémentaire** par la puissance : la puissance donne des **attestations en plus** | GPT |
| D4 | Les votes sont **conservés dans le bloc** (reçus signés) et **liés au `parentHash`** | commune + Claude |
| D5 | Tirage du comité et du mineur **déterministes** : `SHA-256(candidateId ‖ parentHash ‖ clé publique)` | commune |
| D6 | Réputation par **profil**, uniquement sur événements prouvables (`falseAccept`, `falseReject`, `invalidSignature`, `timeout` à part) ; jamais sur le fait d'être minoritaire | GPT |
| D7 | Mises à jour : **pointeur de version dans `/api/pull`** (aucun polling), manifeste + binaire **statiques immuables** téléchargés quand la version change ; **signature du projet** + numéro de séquence anti-retour arrière | GPT + Claude |
| D8 | Identifiants Wi-Fi **hors du binaire** (portail de configuration, stockage EEPROM / `Preferences`) → un binaire par famille de carte | Claude |
| D9 | Cartel : on **ne vote pas** sur le rendu (le cartel contient numéro de bloc et heure, connus après le vote) ; vote sur l'œuvre (`artworkHash`) ; le **`renderHash`** est rapporté **après coup** par l'appareil à l'ACK ; `layoutVersion` consigné | compromis |
| D10 | `consensusPoD` : extraction **interne maintenant**, publication ouverte **après gel du protocole v3**, en version `0.x` | compromis |
| D11 | Un nœud sans écran = rôle `validator` (`screens: []`) | commune |
| D12 | Pas de PoW ni de calcul-preuve comme défense anti-Sybil (inefficace face à un PC) ; l'anti-Sybil repose sur l'identité (profil, ancienneté, réputation) | Claude |

---

## 2. Vue d'ensemble des lots

```
Lot 0  Preuves & hygiène            [S][U]   ◄── en premier, 1 session
Lot 1  Protocole v3 (spécification) [A]      ◄── gel avant tout code de format
Lot 2  Identité & éligibilité       [S]
Lot 3  Reçus signés & vérificateur  [S]      ──► PoDScan v0 (lecture seule) possible ici
Lot 4  Comité, mineur, réputation   [S]      ──► simulations avec menteurs
Lot 5  Noyau consensusPoD           [S][F]   (extraction interne, vecteurs d'or)
Lot 6  Animations calculées         [S][F]
Lot 7  Rendu e-ink & cartels        [S] puis [F]
Lot 8  Grand reflash : Wi-Fi + OTA + v3 + finitions   [F][U]
Lot 9  Documentation, Apprendre, publication         (continu, clôture en fin)
Lot 10 Porte « système final » → Raspberry, PoDScan, réplication
```
Dépendances : 1 → (2, 3) → 4 ; 1 → 5 ; 5 → (6, 8) ; 3 → PoDScan v0 ; 2+3+4+8 → porte du Lot 10.

Estimation (sessions de travail, hors temps d'essai matériel) : L0 1 · L1 1 · L2 1-2 · L3 1-2 · L4 2 · L5 2 · L6 2 · L7 1-2 · L8 3-4 · L9 continu + 1 · soit **≈ 16 à 20 sessions**. Estimation, pas un engagement.

---

## 3. Lot 0 — Preuves et hygiène (immédiat)

**Pourquoi** : figer la victoire du 06/10 par des preuves reproductibles et fermer les petits défauts.

| Tâche | Qui | Détail |
|---|---|---|
| 0.1 Essais restants | [U] | e-ink 2,7″ seul (`eink27bw-2.1`), R4 + TFT 2,8″ (`r4tft28-2.5`) ; relever `[HEAP]`, `[VALIDATE2]`, `Vote OK` |
| 0.2 Traces archivées | [U] + Claude | un fichier `docs/CANARI_TRACES_2026_10_06.md` : une ligne `[VALIDATE2]` (octets, ms, e/t/r, hash) et `[MEM]` **par variante** ; versions de firmware ; **valeurs des variables Vercel** (`MIN_V2_APPROVALS`, `ENFORCE_V2_REJECTIONS`, `PIN_DEVICE_KEY`, `STRICT_SIGNATURE`) |
| 0.3 `candidate-frame` : ne pas mettre un 404 en cache | Claude [S] | `Cache-Control: no-store` sur le 404 (constat K10) + test |
| 0.4 Harnais C++ : afficher commande et erreurs | Claude | `tests/podMetrics.test.ts` imprime la ligne de compilation et stderr (le poste de GPT n'a pas pu compiler) ; documenter `CXX=` |
| 0.5 Avertissements « non testé » à jour | Claude | retirer ceux devenus faux (`UNO_R4_PORTS_ECRANS_NON_TESTES.md`, en-têtes) ; garder pour 2,7″ seul et TFT 2,8″ jusqu'à essai |
| 0.6 Libellés | Claude | `blank` ➜ `uniform` dans l'interface (une image **toute pleine** n'est pas « vide ») ; correction du commentaire e-ink 2,7″ (`114`) |
| 0.7 Interface : `obsConfirmed` ne s'affiche pas comme vérification | Claude | (K7) libellé « reçu par l'appareil », pas « vérifié » |

**Acceptation** : traces archivées pour les 9 variantes (ou « non essayé » explicite), tests verts, K10 corrigé. **Coût Redis** : nul.

---

## 4. Lot 1 — Protocole v3 (spécification gelée)

**Livrable** : `docs/SPEC_PROTOCOLE_V3.md` (spécification normative) + vecteurs d'or (`tests/fixtures/pod-v3-vectors.json`). **GPT** relit et gèle ; **aucun code de format avant gel**.

Contenu à trancher et à écrire :

1. **Message de vote v3** (signé) :
   `pod-vote-v3|deviceId|candidateId|parentHash|metricsVersion|rulesVersion|rawHash|saltedHash|e|t|r|verdict|ruleCode`
   — ajoute `parentHash` (position dans la chaîne), `rulesVersion`, **`ruleCode`** (le motif devient signé, K14), `saltedHash` (A1 : `SHA-256(nonce ‖ contenu)`, `nonce = SHA-256(candidateId ‖ parentHash ‖ deviceId)`).
2. **Règles N2 versionnées** (`rulesVersion`) : `uniform`, `noise`, `format`, limites d'animation ; **le serveur les réapplique** avant d'accepter un verdict signé (K15).
3. **Format de bloc v2** : `votes[]` (identifiant public, clé publique, hash, e/t/r, verdict, code, signature) + **`votesRoot`** (racine de Merkle) **incluse dans `blockHash`** ; `blockVersion`. Les blocs v1 restent lisibles tels quels.
4. **Éligibilité** : fonction unique `isEligibleVoter(device, candidate)` — appairé, profil ≠ auteur, ancienneté (24 h), actif, clé épinglée, firmware déclarant `voteVersion ≥ 2`.
5. **Comité** : formule de classement, K, seuil, délais de repli, mode `bootstrap`, rôle du serveur comme **votant de référence** (jamais seul).
6. **Mineur** : tirage déterministe pondéré (conserver l'équité par poids inverse) calculé à partir de données publiques.
7. **Classes C0/C1/C2** et champ `vclass` (D3).
8. **Compatibilité** : table de transition v2 → v3 (quels firmwares votent comment, quand les rejets deviennent bloquants).
9. **Budget Redis** par candidat et par bloc (cible : ≤ 30 commandes/bloc pour K = 7, dont 1 lecture groupée du comité).

**Acceptation** : spécification relue par GPT, vecteurs d'or générés par une **première implémentation de référence TypeScript** et recoupés par la **seconde implémentation indépendante** (GPT). **Reflash** : non.

---

## 5. Lot 2 — Identité et éligibilité [S]

| Tâche | Constat traité | Détail |
|---|---|---|
| 2.1 Éligibilité unique | K3, K4 | `isEligibleVoter` utilisée par le **pool**, `validate-candidate` et `validation-result` (aujourd'hui incohérents) |
| 2.2 Un vote par profil | — | agrégation par `artistId` ; un artiste avec 5 cartes pèse 1 |
| 2.3 Auteur exclu | K3 | refus côté `validate-candidate` (pas de candidat proposé) et `validation-result` |
| 2.4 Défi-réponse à l'enregistrement | K2 | `register` renvoie un nonce ; l'enregistrement suivant exige une signature de la clé |
| 2.5 Épinglage de clé + récupération | K13 | `PIN_DEVICE_KEY` activable **après** « réinitialiser la clé » depuis la session du profil propriétaire ; l'outil « Ancien ➜ Nouveau » reste le chemin des cartes reflashées |
| 2.6 Mode `bootstrap` | — | calcul des profils éligibles ; étiquette « validation partielle » dans les blocs et l'interface |
| 2.7 Tests hostiles | [A] | usurpation de MAC, rejeu, double vote, appareils non appairés, faux profils, auteur votant sa propre œuvre |

**Acceptation** : un faux appareil non appairé ne vote plus ; l'auteur ne peut pas voter ; trois faux appareils ne finalisent plus un candidat (reproduit le scénario du § 3.3 de la note Claude, désormais refusé). **Redis** : +0 à 1 lecture groupée (profils) par candidat. **Reflash** : non.

---

## 6. Lot 3 — Reçus signés, vérificateur public, PoDScan v0 [S]

| Tâche | Détail |
|---|---|
| 3.1 Conserver les votes dans le bloc | `finalizeBlock` écrit `votes[]` + `votesRoot` (Merkle), version de bloc ; **une seule écriture** (même `SET` que le bloc : le bloc grossit d'environ 130 o/vote, ≈ 1 Ko pour K = 7) |
| 3.2 Vérificateur pur | `lib/podVerify.ts` : recalcule `blockHash`, `votesRoot`, vérifie chaque Ed25519 et la **sélection du comité** ; sans Redis, sans réseau |
| 3.3 CLI `scripts/verify-block.ts` | prend un bloc + l'image, affiche N1/N2 vérifiés ou non, **jamais « validé » sans preuve** |
| 3.4 API publique | `GET /api/block-proof?hash=…` (bloc + reçus), cache CDN immuable : coût Redis nul après la 1ʳᵉ lecture |
| 3.5 **PoDScan v0 (lecture seule)** | page `/scan` : liste de blocs, détail d'un bloc (reçus, validateurs sous leur identifiant public, niveau d'assurance vérifié **dans le navigateur** avec `podVerify`), statistiques de validateurs. Réutilise la page Réseau ; aucun nouveau polling |
| 3.6 Second vérificateur | [A] GPT écrit une implémentation indépendante ; test différentiel sur les vecteurs d'or |

**Acceptation** : un bloc **v2** se vérifie intégralement hors serveur ; les blocs v1 s'affichent « non vérifiable (ancien format) » ; les deux vérificateurs concordent. **Redis** : 0 commande de plus au repos ; +1 `SET` déjà existant. **Reflash** : non (les cartes v2 signent déjà ce qu'il faut pour le niveau N1 ; la liaison `parentHash` arrive avec le v3 du Lot 8 — le bloc enregistre alors `voteVersion` pour chaque reçu).

---

## 7. Lot 4 — Comité, mineur déterministe, réputation, simulation [S]

| Tâche | Détail |
|---|---|
| 4.1 Sélection du comité | classement public, K ≤ 7, repli séquentiel, `committee` écrit dans le candidat (1 écriture) |
| 4.2 Finalisation par seuil ⌈2K/3⌉ | remplace `⌈0,51 × pool⌉` ; le serveur vote en **référence** ; mode `bootstrap` étiqueté |
| 4.3 Mineur déterministe | calculable par un tiers, vérifié par `podVerify` |
| 4.4 Réputation | compteurs par profil (`validAccept`, `validReject`, `falseAccept`, `falseReject`, `invalidSignature`, `timeout`), **agrégés une fois à la finalisation** (un seul script/hash Redis), échantillon minimal, décroissance dans le temps ; aucun effet bloquant avant observation |
| 4.5 Rejets bloquants | `ENFORCE_V2_REJECTIONS` devient la règle **dans un comité exclusivement ≥ v2** |
| 4.6 **Simulateur S1 (en mémoire, sans nœud hôte)** — décision du 07/10 : voir `SPEC_PROTOCOLE_V3.md` § 17 ; le nœud hôte (S2, Lot 5) ne sert qu'à la non-régression bout en bout | n profils simulés appelant `lib/podProtocolV3.ts` : fraction f de profils malhonnêtes (hash faux, métriques fausses, clones, MAC rejouées, silence) ; sorties : fausses acceptations, blocages, commandes Redis/bloc |
| 4.7 Interface | bloc et galerie : « validé par k/K profils (vérifiable) » ou « validation partielle » |

**Acceptation (mesurée)** : pour K = 7, f = 20 % : fausse acceptation ≤ 0,5 % et blocage résolu par repli (valeurs théoriques du § 3.3 de la note Claude, **à confirmer par simulation** avant toute promesse publique). Budget ≤ 30 commandes/bloc. **Reflash** : non. **Condition de bascule** : `ENFORCE…`/comité activés par variable d'environnement, avec retour arrière.

---

## 8. Lot 5 — Noyau `consensusPoD` (extraction interne) [S][F]

**Objectif** : séparer **écrans** et **consensus** ; un seul code testé pour toutes les cartes ; base d'un nœud sans écran.

Structure (inspirée de la proposition GPT, enrichie) :
```
consensus-pod/
  consensusPoD.h           noyau pur : init / feed / finalize / verdict / build_vote_message (sans String, sans allocation, sans E/S)
  consensusPoD_profiles.h  grilles et lecteurs par écran (géométries figées)
  consensusPoD_vectors.h   vecteurs d'or (générés depuis le Lot 1)
  adapters/crypto_esp8266.h · crypto_uno_r4.h · crypto_posix.h
  adapters/transport_*.h   (couche 2, optionnelle) : PodNode::tick() = register / pull / validate / vote
  host/podnode.cpp         nœud hôte (PC / Raspberry) + simulateur
  SPEC.md · LICENSE · examples/
```
| Tâche | Détail |
|---|---|
| 5.1 Extraire le noyau sans changer le comportement | à partir de `pod_metrics.h` + messages de vote ; tests de parité inchangés |
| 5.2 Vecteurs d'or | buffers, SHA-256, métriques, message et signature attendus ; exécutés en **TypeScript, C++ hôte, ESP8266 (compilation croisée), R4** |
| 5.3 Adaptateurs de chiffrement | un par plateforme (ESP8266 BearSSL, R4 `SHA256`/`Ed25519`, POSIX) |
| 5.4 Nœud hôte `podnode` | validateur **sans écran** (rôle `validator`, `screens: []`) + serveur de test ; sert à la non-régression bout en bout (S2), plus au simulateur S1 |
| 5.5 Serveur : rôle `validator` | `register` accepte `screens: []`, exclu des diffusions d'images, compté par profil |
| 5.6 Remplacer les copies d'en-têtes | les 9 firmwares incluent le noyau ; **copies identiques synchronisées par script** jusqu'à la publication (règle « dossier autonome » conservée) |
| 5.7 Contrôle mémoire | `espStaticRam`, relevé `[HEAP]` : le noyau ne doit pas augmenter la RAM statique |

**Acceptation** : 0 changement de comportement observable (mêmes e/t/r/hash sur les 9 variantes) ; vecteurs passants sur 4 plateformes. **Reflash** : oui au moment du lot 8 (les firmwares utilisent le noyau) — **aucun reflash intermédiaire obligatoire**. **Publication** : **non** (D10) — la v0.x sera préparée au Lot 9.

---

## 9. Lot 6 — Animations calculées [S][F]

**Pourquoi** : aujourd'hui une animation est votée en **v1 (écho)** ; seul son affichage est dynamique.

| Tâche | Détail |
|---|---|
| 6.1 Spécification `pod-anim-v2` (dans le Lot 1) | pour un clip PBC1 : `clipHash` (SHA-256 du clip), **empreinte et métriques e/t/r de chaque image**, racine de Merkle des images, délais/boucles/couleurs inclus ; score = règle déterministe (moyenne entière) |
| 6.2 Serveur : `candidate.v2` pour animation | calcule déjà empreintes et scores par image (`lib/anim/block.ts`) : y ajouter e/t/r **entiers** et `rootV2` ; annonce légère (≈ 120 o) |
| 6.3 Service du clip | `GET /api/candidate-clip?candidateId=…` (≤ 9 Ko, CDN immuable) |
| 6.4 Firmware C0 | lecture du clip **en flux** (le clip fait ≤ 9 216 o : tient en un seul passage) ; décodage des différences PBC1 **image par image** dans une grille 128×64 (1 Ko, tampon alloué après le TLS), calcul e/t/r par image, racine ; vote v3-anim |
| 6.5 Quel appareil peut voter une animation | tout appareil capable de décoder PBC1 ; les autres s'abstiennent (pas d'écho) ; **plus aucun vote v1** pour un candidat animation dès que le quorum de classe suffisante existe |
| 6.6 Tests | différentiel TypeScript ↔ C++ sur ≥ 200 clips (cas limites : 1 image, 60 images, images identiques, plein, bruit) |
| 6.7 Interface | bloc animation : « n images recalculées par k profils » |

**Acceptation** : un clip altéré d'un octet est refusé (hash) ; e/t/r par image identiques au ppm sur 4 plateformes ; mémoire ESP8266 conforme. **Redis** : +0 (le clip passe par le CDN). **Reflash** : oui (Lot 8).

---

## 10. Lot 7 — Rendu e-ink : cartels et zone sûre [S] puis [F]

| Étape | Tâche | Reflash |
|---|---|---|
| 7.1 | **Zone sûre dans l'éditeur** : bandes du cartel hachurées sur le canvas e-ink (2,9″ : 296×100 utile ; 2,7″ : 264×148) | non |
| 7.2 | **Canvas réduit pixel-exact** : dessin 296×100 complété en blanc par le serveur (hash et métriques sur l'image complète ; aucun rééchantillonnage) | non |
| 7.3 | **Ajustement des œuvres existantes** (optionnel) : variante réduite à la diffusion (aire → seuil, rouge préservé) ; l'image affichée ≠ image du bloc, déjà admis pour les conversions inter-écrans | non |
| 7.4 | **`cartelMode` par appareil** (`overlay` / `fit` / `hidden`) : réglage dans « Gérer → Réglages » ; transmis dans le `MGET` existant du pull ; firmware : saute la gravure si `hidden` | oui (Lot 8) |
| 7.5 | **`artworkHash` / `renderHash` / `layoutVersion`** (D9) : l'appareil rapporte le hash de ce qu'il a réellement affiché dans l'ACK ; consigné dans l'enregistrement d'affichage (déjà existant) ; **jamais voté** | oui (Lot 8) |

**Acceptation** : plus aucune partie d'une œuvre dessinée en 7.2 n'est masquée ; `renderHash` visible dans l'onglet debug du profil. **Redis** : +0.

---

## 11. Lot 8 — Grand reflash groupé : Wi-Fi, OTA, protocole v3, finitions [F][U]

**Principe** : **un seul cycle de reflash par carte** regroupant tout ce qui touche au firmware. Chaque famille garde sa sauvegarde `firmware-backups/` et son essai.

| Tâche | Détail |
|---|---|
| 8.1 Identifiants Wi-Fi hors du binaire (D8) | portail captif (ESP8266 : `DNSServer` + serveur web ; R4 : `WiFi.beginAP`) ; stockage EEPROM / `Preferences` ; `secrets.h` reste pour le développement |
| 8.2 Mise à jour à distance signée (D7) | `ESP8266httpUpdate` + `Update.installSignature` (RSA/SHA-256, `signing.py`) ; R4 `OTAUpdate` (**à vérifier d'abord** : fabrication du `.ota` en local, ce que `verify()` authentifie, taille maximale) ; pointeur de version dans `/api/pull` ; **numéro de séquence anti-retour arrière** ; vagues (`hash(deviceId) mod 100`) ; réglage Manuel/Automatique ; **image de secours** (compteur de redémarrages → mode récupération) |
| 8.3 Clé de signature | générée **hors ligne**, jamais dans le dépôt ni sur Vercel ; procédure de remplacement documentée (§ 15, point 5) |
| 8.4 Vote v3 | message de vote v3 (Lot 1), hash salé, `ruleCode`, classe C0/C1 |
| 8.5 Signature spatiale (A2) | grille 8×8 de comptages (64 o) + dHash 64 bits, **en flux** (une ligne + 64 compteurs) ; sert à la détection de copies (Lot 10) |
| 8.6 Entropie des clés (K5) | ESP8266 : `ESP.random()`/registre matériel ; R4 : TRNG du RA4M1 si exposé ; documenté : les clés existantes ne changent qu'à la réinitialisation |
| 8.7 TLS authentifié (K9) | empreinte de certificat ou CA ; indispensable avant l'OTA publique |
| 8.8 `cartelMode`, `renderHash` (Lot 7.4-7.5) | |
| 8.9 Animations (Lot 6.4) | |
| 8.10 Noyau (Lot 5) | |
| 8.11 Matrice d'essai | 9 variantes × {démarrage à froid, enregistrement, vote image, vote animation, mise à jour OTA, coupure de courant pendant la mise à jour, retour arrière, réinitialisation de clé} ; **trace archivée par case** |

**Acceptation** : toutes les variantes passent la matrice ; `[HEAP] après WiFi` ≥ 38 Ko ; une mise à jour signée s'applique, une mise à jour **non signée est refusée**, une coupure de courant ne brique pas la carte (essai sur table). **Redis** : +0 (pointeur dans le pull existant). **Risque majeur** : brique d'un ESP8266 sans retour arrière → vagues, canari sur 1 carte par famille d'abord.

---

## 12. Lot 9 — Documentation, Apprendre, publication (continu)

À la **clôture de chaque lot** : mettre à jour
1. la **feuille de route** de la page Apprendre (`app/learn/data/roadmap.ts` ; test `learnRoadmap`) et la **synthèse** (parcours 04) si un niveau d'assurance change ;
2. `CLAUDE.md` (règles nouvelles), `CHANTIER_VALIDATION_REELLE.md` (annexe d'avancement) ;
3. les notes de canari (`CANARI_*`) avec les traces ;
4. le **journal de décisions** (GPT).

En fin de parcours :
- `SPEC_PROTOCOLE_V3.md` finalisée + **`consensus-pod` préparé pour publication `0.x`** (README, licence, exemples, CI `g++` + `arduino-cli`) — **publication seulement sur décision du porteur** ;
- page Apprendre : guide d'**installation universelle** (binaire + portail Wi-Fi) ; page « Participer comme validateur » (nœud sans écran) ;
- note vault (Obsidian) de synthèse.

---

## 13. Lot 10 — Porte « système final » puis suite

### 13.1 Porte (critères cumulatifs ; tous doivent être vrais)
- [ ] Un bloc **se vérifie intégralement hors du serveur** (reçus signés, comité rejouable, mineur rejouable), par **deux vérificateurs indépendants**.
- [ ] **Un vote par profil**, auteur exclu, appairage exigé, clés épinglées avec récupération.
- [ ] Comité K ≤ 7, seuil 2/3 ; mode `bootstrap` **affiché** quand applicable.
- [ ] Les **animations sont validées par calcul** (aucun écho v1 dans un bloc de la nouvelle version).
- [ ] Les 9 variantes de firmware passent la matrice d'essai ; OTA signée éprouvée sur au moins une carte par famille.
- [ ] **Simulation** : fraction de menteurs mesurée, chiffres publiés **avec leurs hypothèses**.
- [ ] Budget Redis mesuré ≤ cible (`PLAN_REDIS_200K.md`).
- [ ] Documentation et page Apprendre à jour, aucune promesse supérieure au niveau atteint.

### 13.2 Suite (hors périmètre de ce plan, préparée par lui)
| Chantier | S'appuie sur |
|---|---|
| **Nœuds Raspberry Pi** (miroir de la chaîne, vérification complète, validateurs C2, auditeurs de geste N3) | nœud hôte (Lot 5), vérificateur (Lot 3) |
| **PoDScan complet** (explorateur public : blocs, reçus, validateurs, réputation, recherche) | PoDScan v0 (Lot 3), API de preuves |
| **Co-signature de la tête de chaîne** par le comité | Lot 4 |
| **Ancrage externe** de la tête (dépôt public / horodatage) | Lot 3 (gratuit, peut se faire tôt) |
| **Réplication** au-delà d'un registre unique (gossip, miroirs) | Raspberry, vérificateur |
| **Détection de copies** par signature spatiale | Lot 8.5 |
| Primitives légères (VRF, Ascon) | recherche |

---

## 14. Risques transverses

| Risque | Gravité | Parade |
|---|---|---|
| Brique d'un ESP8266 par OTA (pas de retour arrière) | élevée | vagues, canari, image de secours, essai de coupure de courant |
| Régression mémoire ESP8266 (noyau + v3 + OTA) | élevée | RAM statique et `[HEAP]` en critère d'acceptation de chaque lot firmware |
| Gel prématuré du protocole | moyenne | Lot 1 relu par GPT, vecteurs d'or, versions explicites, publication après |
| Divergence numérique entre plateformes | élevée | entiers, vecteurs d'or, différentiel TypeScript/C++/seconde implémentation |
| Réseau trop petit pour un comité | moyenne | `bootstrap` étiqueté ; jamais « validé par le réseau » |
| Quota Redis | moyenne | budget écrit par lot ; reçus dans le même `SET` ; CDN immuable ; comité borné |
| Sur-promesse publique | moyenne | feuille de route et synthèse mises à jour à chaque lot ; règle 7 |
| Perte de la clé de signature OTA | élevée | procédure de remplacement + clé de secours hors ligne |
| Fatigue du porteur (flash de 9 variantes) | moyenne | **un seul reflash groupé** (Lot 8), puis OTA |

---

## 15. Décisions à confirmer par le porteur (ordre d'urgence)

1. Valider les décisions **D1 à D12** (§ 1), notamment D3 (pas de poids supplémentaire par la puissance) et D9 (cartel : vote sur l'œuvre, `renderHash` rapporté après coup).
2. **Ordre** : confirmer « serveur d'abord (Lots 1-4) pendant que le noyau est extrait (Lot 5), puis un seul reflash (Lot 8) ».
3. **PoDScan v0** dès le Lot 3 (lecture seule) ou après la porte du Lot 10 ?
4. **Mises à jour** : défaut Manuel (recommandé) ou Automatique ?
5. **Clé de signature OTA** : qui la détient et où (hors ligne) ?
6. **Publication de `consensus-pod`** : confirmer qu'elle attend la porte du Lot 10 (ou le gel du Lot 1 au plus tôt).
7. **Ancrage public** de la tête : où et à quelle fréquence.
8. **Nœuds sans écran** dans le comité dès le Lot 5, ou d'abord observateurs ?

---

## 16. Premier sprint proposé (à valider par GPT)

1. **Lot 0** complet (porteur : essais 2,7″ seul et TFT 2,8″ + traces ; Claude : K10, harnais, libellés).
2. **Lot 1** : Claude rédige `SPEC_PROTOCOLE_V3.md` et l'implémentation de référence des vecteurs ; **GPT audite et gèle**.
3. Démarrage **Lot 2** (éligibilité unique) dès le gel — c'est le plus gros gain de sécurité sans reflash.

*Chaque lot clos met à jour la feuille de route de la page Apprendre.*
