# Protocole matériel R4-B — prochain essai (NON autorisé tant que le porteur n'a pas donné le GO matériel)

> Rédigé le 17/10/2026 à la fin du lot OTA-5 hors matériel. **Rien de ce document n'a été exécuté.** La carte de test est restée en build A du canari ; aucun port n'a été ouvert, aucun téléversement fait, `ota.update()` jamais appelé.
> Niveaux de preuve : `[code]` lu dans le code · `[hôte]` exécuté sur l'ordinateur · `[carte]` mesuré sur la carte · `[hyp]` hypothèse non démontrée.

## 0. Principes

- Chaque étape a **son GO écrit** du porteur (« GO matériel OTA-5 S<n> »). Un GO ne vaut jamais pour l'étape suivante.
- Aucune étape ne programme le RA4M1 avant S6. S1 à S5 : **zéro appel de programmation** (le croquis n'en contient pas : `tests/otaR4Core.test.ts` le vérifie).
- Avant toute étape : carte seule branchée (shield retiré), un seul `COM`, ancien serveur de laboratoire fermé, `git status` propre sur `ota-lab/r4-ota5/`.
- **Arrêt immédiat** (aucune poursuite, journal brut archivé, rien d'autre tenté) si : une ligne `pile … erreur ≠ 0` ; un `GUARD` ; une marge de pile principale < 128 o ; un redémarrage inattendu ; un `Exception` ; un ticket émis alors qu'un cas négatif était servi ; un bloc 0 de la data flash modifié.
- Clés : uniquement des clés de **test** (`ota-lab/r4-ota5/tools/keygen.mjs`, dossier `artifacts/keys/` ignoré par git). Aucune clé de production.

## 1. Ce qui a changé depuis le canari A → B → A

| Sujet | État au 17/10/2026 |
|---|---|
| Mécanique OTA R4 (staging, hash, relecture, BOSSA, retour arrière, 3 PASS) | `[carte]` démontrée sur la carte de test (port série du PC fermé pendant BOSSA) |
| Manifeste signé Ed25519, famille, version, séquence, canal, taille, SHA-256, activation différée, clé | `[hôte]` référence TypeScript + noyau C++ `consensus-pod/src/podOtaR4.h`, 46 vecteurs, 62 mutants |
| Téléchargement du binaire brut, Content-Length obligatoire, blocs de 200 o, SHA-256 au fil de l'eau, refus + suppression du staging | `[hôte]` noyau ; `[code]` croquis `ota-lab/r4-ota5/sketch/ota5_r4b_probe` **compilé** (cœurs 1.5.3 et 1.6.0, TLS et clair) |
| Séquence anti-rejeu en deux blocs (2 et 3), coupure à chaque octet | `[hôte]` simulateur de flash ; **non câblé** dans le croquis (`flWrite` refuse) |
| Piles : TLS + écriture `+FS` dans une même transaction | `[code]` majorant statique ≈ 1 144 o (voir § 3) ; **à mesurer** |
| Intégration dans le firmware TFT 2,8″ de production, vote, distribution serveur, déploiement progressif | **non commencé** |

Formulation à employer : **la mécanique OTA R4 fonctionne sur la carte de test ; la couche de sécurité et l'intégration de production restent à construire.**

## 2. Étapes

### S1 — Staging seul, sans TLS, sans écriture de séquence (clair, serveur de laboratoire)
But : démontrer sur la carte le flux `manifeste signé → binaire brut → staging non approuvé → hash → relecture → ticket émis (non consommé)`.
1. Poste : `node --import tsx ota-lab/r4-ota5/tools/keygen.mjs`, `make-manifest.mjs` (binaire = l'image **B** du canari, seq 6), `serve.mjs --dir artifacts/release --port 8081`.
2. Construire `ota5_r4b_probe` avec `-DOTA5_TLS=0` et `secrets.h` local ; téléverser **avec la procédure déjà validée** (`arduino-cli upload`, port PC fermé ensuite). *Ce téléversement remplace le build A du canari : à autoriser explicitement ; le retour arrière est l'image A (`ota-lab/r4-ota3/canary`).*
3. Commandes série : `w` · `s <ip du PC>:8081` · `p <clé publique r4-a>` · `m` · `d`.
4. Critères : `manifeste : ok` · `ACCEPTÉ` · `binaire : … reçu = Content-Length = taille signée` · `téléchargement conforme` · `relecture : OK` · `TICKET PRÊT` · toutes les lignes `pile … erreur 0` · **marge de la pile réseau relevée** · tas stable avant/après · bloc 0 de la data flash inchangé (CRC avant/après).
5. À relever : durée d'écriture (≥ 28 s annoncées pour 76 Ko), durée de relecture (≈ 8 s), capacité réelle de SPIFFS (le plus grand fichier accepté ; image TFT ≈ 160 Ko), comportement de `+FS` à 200 o dans une transaction réseau, `heap` minimal.
6. Résultat à comparer indépendamment : `node ota-lab/r4-ota5/tools/compare-staging.mjs` n'a pas d'accès à la carte ; la preuve est la relecture C++ (SHA-256 complet) — **ne pas affirmer davantage**.

### S2 — Cas négatifs servis (aucune programmation)
Servir tour à tour `artifacts/negatives/<cas>/` (générés par `negatives.mjs`, **jamais commités**) : signature invalide, manifeste modifié après signature, clé inconnue, mauvaise famille, canal non éligible, rejeu, downgrade, activation différée, binaire tronqué / plus long / SHA-256 faux, Content-Length ≠ taille signée.
Critères : refus avec le code attendu, **aucun ticket**, staging supprimé (`d` suivi de `x` ne trouve rien), aucun redémarrage. Un cas qui passe = arrêt.

### S3 — TLS réel (`-DOTA5_TLS=1`, `PodBoundedSSL`)
Prérequis **à décider par le porteur** : un point HTTPS public ou privé servant `manifest.txt` et `firmware.bin` (aucune route publique ne doit être créée dans l'application ; un hébergement statique à part convient). Mesurer la pile réseau avec 2 048 o puis 3 072 o (`OTA5_NET_STACK`), objectif ≥ 256 o de marge, plancher 128 o.

### S4 — Écriture de la séquence anti-rejeu (sans programmation)
Câbler `flWrite` par **un seul effacement de bloc** (méthode de l'`AUDIT3` : `DataFlashBlockDevice`, pas `EEPROM.update` octet par octet : 1 Ko de tas et un effacement par appel). Vérifier : blocs 2 et 3 seuls modifiés, CRC du bloc 0 inchangé, alternance A/B, relecture. Point à trancher avant : l'accès à la data flash pendant que le module est utilisé (`[hyp]`).

### S5 — Coupures (un GO par coupure)
(a) Coupure d'alimentation pendant le staging : au redémarrage, aucun ticket ; `/update.bin` partiel → refusé par taille/SHA-256 ; suppression. (b) Coupure pendant l'écriture de la séquence : la séquence ne baisse pas ; une des deux copies reste valide. Aucune de ces coupures n'est faite à ce stade.

### S6 — Programmation depuis le ticket (dernière étape)
Seulement après S1–S5 verts. `ota.update()` appelé **une seule fois**, **après** `consume()` du ticket, port série du PC **fermé** pendant BOSSA (condition observée 3/3 ; cause non démontrée), séquence consommée après redémarrage de la nouvelle image. Retour arrière vers A par `arduino-cli upload`.

## 3. Estimations de pile `[code]` (statique, majorant, branche flottante de printf comptée)

- Pile principale (`loop` + `evaluate` + `parse` en ligne) : cadre de `loop` 256 o + chemin le plus profond avant une pile dédiée 112 o ⇒ **368 o** au-dessus du socle du cœur (≈ 200 o) ; marge statique attendue ≈ 450 o sur 1 024 o. Fichiers : `docs/mesures/OTA5_2026_10_17/pile_statique_pile_principale.txt`.
- Pile réseau pendant le téléchargement : `getFn` 96 o + max(chaîne TLS ≈ 1 000 o, chaîne `feed → writefile` 848 o) ≈ 1 100 o ; les deux chaînes ne sont **pas** simultanées. Avec garde (64) + invocateur (32) + exception (104) + objectif de marge (256) ≈ 1 560 o ⇒ **2 048 o pourraient suffire** ; 3 072 o par prudence dans le laboratoire. `docs/mesures/OTA5_2026_10_17/pile_statique_net_fs.txt`. **Aucune mesure matérielle.**
- La relecture du staging s'exécute sur `podWifiRun` (1 536 o) : chaîne `stRead` 848 o ⇒ 64 + 848 + 32 + 104 = 1 048 o ≤ 1 536 (marge ≈ 488 o `[code]`).

## 4. Questions encore ouvertes

1. Capacité de SPIFFS du module (plus grand fichier) : jamais mesurée.
2. Vitesse réelle d'écriture `+FS` dans une transaction TLS (le ≈ 2,7 Ko/s `[carte]` vient d'un essai hors TLS).
3. Écriture de la data flash pendant l'usage du module.
4. Le Wi-Fi « now » : la carte n'a pas d'horloge fiable ; l'activation différée est refusée (`now = 0`). Source de temps à décider.
5. Intégration au firmware TFT 2,8″ (réserve de RAM statique, marge de pile du vote : 120 o statiques annoncées).
6. Portée de BOSSA « port fermé » : cause non démontrée.
7. Distribution : où se publie le manifeste, qui signe, rotation des clés `r4-a` / `r4-b` (ADR OTA-5 § 3).
