# Sauvegarde SD distribuée du R4 + TFT 2,8″ — cadrage technique (13 octobre 2026)

| | |
|---|---|
| **Statut** | **Document de conception. Aucune implémentation, aucune route, aucun format gelé.** Il prolonge `docs/SD_ARCHIVE_POD_V1_CADRAGE_2026_10_12.md` (idée structurée) en y ajoutant les contraintes mesurées du matériel et du dépôt. Indépendant du canari de vote. |
| **Condition d'entrée** | Canari animation TFT 2,8″ **vert** et verdict matériel archivé (l'animation en flux est la première brique : réception vers la SD, validation en flux, marqueur en dernier). |
| **Autorité** | **La SD n'est jamais une autorité.** Elle conserve des copies ; seuls les hash, les signatures, les règles et le consensus font foi. Une carte altérée doit être détectée, jamais crue. |

## 1. Contraintes réelles (vérifiées dans le dépôt et dans les bibliothèques)

| Contrainte | Source | Conséquence de conception |
|---|---|---|
| Bibliothèque `SD` 1.3.0 : **noms de fichiers 8.3 uniquement** (`SdFatmainpage.h` : « only supports short 8.3 names ») ; pas de `rename` exposé | `…/libraries/SD/src` | Le nom `<hash 64 hex>` est **impossible** : chemin = répertoires de 2 hex + nom de 8 hex + `.OBJ` ; le hash COMPLET est dans l'en-tête de l'objet et vérifié à la lecture |
| Pas de renommage atomique | idem | Écriture atomique par **journal en ajout seul** + publication par un enregistrement final (§ 5), pas par `*.tmp` → renommage |
| Bus SPI **partagé** carte / TFT / tactile ; aucune lecture SD pendant une transaction TFT | lot 8B2E | Le service d'archive ne s'exécute **qu'entre** les tâches réseau et d'affichage, en tranches courtes |
| RAM : 21 468 o statiques, tas ≈ 8 Ko libres, plus grand bloc ≈ 4,9 Ko ; tampons de travail disponibles : `g_row` 480 o (statique) et 2 048 o au tas **hors transaction TLS** ; pile SD dédiée 1 536 o | lots 8B2D / 8B2E | Tout se fait **en flux** (lecture, hash, écriture par blocs de 480 – 1 024 o) ; aucun objet entier en RAM |
| Aucun accès entrant, aucun fetch vers IP locale : `ESP → serveur` seulement | CLAUDE.md | **Pas de réplication directe écran à écran** ; la réplication passe par le serveur (§ 8) |
| Budget Redis (règle primordiale, plan 200 k/mois) | CLAUDE.md | Routes **statiques, adressées par hash, mises en cache par le CDN** (précédent : `/api/block-clip`, `/api/block-proof`, `/api/block-image`) : 0 commande Redis par lecture après la première |
| Clés privées en EEPROM | lots 8B-2B | **Jamais** sur la SD, jamais dans un manifeste, jamais dans un journal |
| FAT32 : 65 534 entrées par répertoire (sans noms longs, moins avec) ; usure par écritures de secteurs | FAT | Répertoires **fragmentés par hash** ; journal en ajout seul ; **aucune** écriture à chaque pull |

## 2. Ce qu'une sauvegarde doit contenir pour être utile hors ligne

Pour chaque bloc conservé, le nécessaire pour qu'un tiers vérifie **sans croire le serveur ni l'écran** (précédent : `lib/podVerify.ts`, `scripts/verify-block.ts --file proof.json`, niveaux `chain` → `receipts` → `content`) :

| Objet | Contenu | Vérification |
|---|---|---|
| **ART** — œuvre complète | octets **originaux votés** (image brute du type d'écran voté : `tft28` = 153 600 o RGB565) ; pour une animation : le clip **PBC1 complet** (≤ 9 216 o) | `contentHash` = SHA-256 du contenu brut (= `artworkHash`, `docs/SPEC_LOT_7_CARTELS_RENDU_2026_10_07.md`) ; pour une animation, racine des empreintes d'images (`lib/anim/block.ts`) |
| **BLK** — bloc et preuve de consensus | réponse `/api/block-proof` **verbatim** : champs immuables du bloc + **reçus signés** (votes Ed25519, clé publique au moment du vote, `votesRoot` Merkle) + version des règles | `podVerify` : hash du bloc, chaînage `parentHash`, racine, signatures, liaison candidat / appareil / contenu |
| **MAN** — manifeste | liste d'objets (type, hash, taille), plage de blocs, `headHash`, hash du manifeste précédent, rôle du nœud, époque de clé | signature Ed25519 de l'appareil (§ 4) |
| **CHK** — checkpoint | `blockIndex`, `blockHash`, `votesRoot`, hash du manifeste, version des règles | recoupement avec le serveur ; un checkpoint seul ne prouve rien |
| **KEY** — clés publiques par époque | clés publiques des validateurs et rotations observées | dérivées des reçus ; utilisées par la vérification hors ligne |

**Ce qu'on ne stocke pas comme preuve :** le rendu final d'un écran (`frameHash` / `renderHash`) ni le cartel gravé : ce sont des *rapports non authentifiés* de rendu, pas des preuves de consensus. Les conversions vers d'autres écrans se **recalculent** depuis l'œuvre originale.

## 3. Format d'un objet (propositions, non gelées)

```
offset  taille  champ
0       4       magic "PODO"
4       1       version du format d'objet (1)
5       1       type : 1 ART, 2 BLK, 3 MAN, 4 CHK, 5 KEY
6       2       drapeaux (bit 0 : compressé = 0 en v1)
8       4       taille du payload (octets)
12      32      SHA-256 du payload (identité de l'objet = ce hash)
44      4       CRC-32 des 44 premiers octets
48      …       payload
fin     4       CRC-32 du payload (détection rapide ; le SHA-256 fait foi)
```
Lecture : en-tête (48 o) → SHA-256 recalculé **au fil de la lecture** (blocs de 480 – 1 024 o) → comparaison avec l'en-tête **avant** toute utilisation (affichage, service, réparation). Un objet qui ne vérifie pas est **mis en quarantaine** (§ 7), jamais montré.

## 4. Manifestes signés

- Message signé (séparation de domaine) : `pod-sdman-v1|<deviceId>|<epoch>|<seq>|<headBlockIndex>|<headBlockHash>|<hash du manifeste précédent>|<hash du payload du manifeste>` ; signature Ed25519 de la clé de l'appareil, **via `PodEd` uniquement** (jamais d'appel direct, règle R4).
- Ce que la signature prouve : « ce nœud affirme posséder cet ensemble ». Ce qu'elle **ne prouve pas** : que le contenu est vrai ou accepté (cela vient des reçus du bloc, § 2). Un manifeste ne peut **jamais** étendre une autorité.
- Cadence : un manifeste **par lot de N blocs** (par exemple 16) ou par arrêt propre, jamais par objet : la signature coûte une pile PodEd de 2 304 o et plusieurs secondes.
- Chaînage : chaque manifeste engage le précédent ⇒ une troncature ou un retour en arrière sont visibles.

## 5. Écriture atomique et reprise après coupure (sans `rename`)

1. Écrire le payload sous son **nom final immuable** (hash → chemin § 6) avec un champ « état » de l'en-tête à `0xFF` (non publié).
2. Relire et **recalculer le SHA-256** ; échec ⇒ supprimer.
3. **Publier** : ajouter UN enregistrement au journal (`/POD/V1/J/<seq>.JNL`, ajout seul) : `PUB | type | taille | hash | CRC-32`. Un enregistrement tronqué est ignoré (CRC).
4. Seulement ensuite, écrire/mettre à jour le **manifeste** et le **pointeur `HEAD` à double emplacement A/B** (numéro de séquence + CRC, l'emplacement valide le plus récent gagne).
5. Au démarrage : tout objet **non référencé par le journal** est « orphelin » → quarantaine puis suppression ; tout enregistrement du journal dont l'objet est absent ou invalide est marqué « à réparer ».
Propriété visée : à toute coupure, la carte contient soit l'état précédent, soit le nouveau, jamais un objet « à moitié valide » visible comme publié.

## 6. Arborescence (8.3)

```
/POD/V1/O/ab/cd/ef012345.OBJ      objets : ab,cd = octets 0 et 1 du hash ; nom = octets 2 à 5 (8 hex) ; collision → .O01 … .O99 (l'en-tête porte le hash complet)
/POD/V1/J/00000001.JNL            journal d'ajout seul (rotation à taille fixe)
/POD/V1/M/00000042.MAN            manifestes (numéro de séquence)
/POD/V1/H/HEAD.A  /POD/V1/H/HEAD.B  pointeur de tête, double emplacement
/POD/V1/X/INDEX.V1                index (cache reconstructible, § 7)
/POD/V1/Q/…                       quarantaine
/POD/V1/G/GENESIS.OBJ             genèse (jamais évincée)
```
Compatibilité : les fichiers actuels (`/pod/frame.bin`, `/pod/frame.txt`, `/pod/anim.bin`, `/pod/anim.txt`) ne bougent pas ; l'archive est un **second espace**, et le cache d'affichage reste le chemin rapide.

## 7. Index reconstructible et détection de corruption

- **INDEX.V1 est un cache**, jamais une source de vérité : absent, tronqué ou incohérent ⇒ reconstruction par parcours des manifestes et du journal (parcours **incrémental et reprenable**, quelques objets par tour de `loop`, jamais pendant une transaction TFT ni TLS).
- **Vérification à la lecture** : obligatoire (§ 3).
- **Scrub périodique** : budget fixe (par exemple 4 objets par heure et par nœud, 153 600 o ≈ une image) pour limiter l'usure et le temps SPI ; état par objet `OK / SUSPECT / CORROMPU` ; un objet `CORROMPU` est déplacé en quarantaine et **réparé** par téléchargement depuis le serveur **vérifié par son hash** (le serveur ne peut pas imposer un contenu qui ne correspond pas).
- **Carte retirée / pleine / illisible** : le firmware échoue **fermé** (aucun message de succès), continue d'afficher l'œuvre courante et ne perd jamais l'affichage pour une erreur d'archive.

## 8. Réplication entre plusieurs écrans

Principe : **les écrans ne se parlent pas** (aucun accès entrant, aucun accès à une IP locale). Chaque nœud est un client du serveur qui télécharge des objets **immuables adressés par hash** et les vérifie. La « réplication » est donc la **convergence de plusieurs copies indépendantes vers les mêmes hash**.

| Rôle (déclaré, borné par la capacité réelle de la carte) | Conserve |
|---|---|
| **léger** | derniers blocs (fenêtre de quelques dizaines), œuvres affichées, preuves courantes |
| **conservateur** | fenêtre longue de blocs et objets associés |
| **archive** | tout ce qui tient ; checkpoints, genèse, inventaire complet |

Mécanisme (futur, **hors de ce document** pour le serveur) : un nœud lit un manifeste public d'un intervalle de blocs (JSON statique, mis en cache), télécharge les objets manquants (routes existantes `/api/block-proof`, `/api/block-image`, `/api/block-clip`, plus une route d'archive à spécifier), vérifie chaque hash, puis publie son manifeste signé *localement* (la publication vers le serveur n'est pas requise pour la conservation). Recoupement : si plusieurs nœuds exposent le même `headBlockHash` et la même racine, la copie est corroborée ; un hash différent est un **signal de désaccord**, traité par la vérification de la chaîne, pas par le vote des cartes. Aucune « preuve de possession » défiée par le serveur n'est proposée : elle exigerait du polling (interdit par la règle Redis).

Politique d'éviction : jamais la genèse ni les checkpoints ; d'abord les objets non référencés ; puis les plus anciens non épinglés ; un nœud « léger » peut tout perdre sans conséquence pour le réseau.

## 9. Sécurité

| Menace | Réponse |
|---|---|
| carte échangée / modifiée hors ligne | tout objet est vérifié par hash avant usage ; manifestes chaînés et signés ; la carte n'élève jamais une autorité |
| clé privée exfiltrée par la SD | impossible : jamais écrite sur la SD (test statique à ajouter : aucun appel d'écriture SD ne reçoit `privateKey`) |
| rejeu d'un ancien manifeste | `seq` croissant, hash du précédent, `HEAD` A/B ; un retour en arrière est détecté |
| objet malveillant servi par le réseau | hash annoncé = hash calculé, sinon rejet ; taille bornée avant écriture |
| remplissage de la carte | quotas par rôle, taille maximale par type, éviction (§ 8) |
| fausse sécurité | l'interface n'affiche **« archivé »** que pour un objet dont le SHA-256 vient d'être recalculé ; jamais « validé » à partir de la seule présence d'un fichier |

## 10. Budgets

- **RAM** : aucune structure nouvelle au-delà de l'existant (480 o de ligne + 2 048 o de travail hors TLS + pile SD 1 536 o). Le hash en flux utilise un `SHA256` statique (≈ 100 o).
- **Capacité** : une image `tft28` = 153 600 o + preuve ≈ 2 – 5 Ko ; une carte de 8 Go contient de l'ordre de 50 000 blocs d'image brute ; une animation PBC1 ≤ 9 Ko ; les index et journaux sont négligeables.
- **Redis / Neon** : **0** dans la conception cible (routes statiques adressées par hash, CDN) ; toute route nouvelle doit écrire son coût en commandes/heure/acteur AVANT le code (règle primordiale).
- **Temps SPI** : tranches courtes entre tâches ; scrub et réparation interruptibles par le réseau, le toucher et l'affichage.

## 11. Plan de lots (chacun un commit, arrêt pour audit entre les lots)

| Lot | Contenu | Preuves |
|---|---|---|
| **S0** | gel de ce cadrage en spécification : 8.3, en-tête d'objet, journal, manifeste, `HEAD` A/B, vecteurs d'or | revue GPT |
| **S1** | **lecteur et vérificateur hors ligne** (TypeScript + C++ hôte) sur un répertoire simulé ; corpus de vecteurs (valides, corrompus, tronqués) | tests hôte ; octet-à-octet |
| **S2** | écriture atomique locale sur la SD (injection de coupures à chaque instruction du harnais SD) | harnais de pannes (comme `g_sd.writeBudget`, `readFailAt`) |
| **S3** | inventaire, index reconstructible, scrub budgété, quarantaine | tests + mutations |
| **S4** | route(s) serveur statiques adressées par hash + budget Redis écrit | tests serveur ; CDN |
| **S5** | essai matériel unique, un nœud ; puis plusieurs nœuds | journal brut + verdict |

## 12. Décisions à prendre

| # | Question | Recommandation |
|---|---|---|
| **D-S1** | Garder le format minimal 8.3 avec `SD` 1.3.0, ou passer à une bibliothèque FAT à noms longs / `rename` (SdFat 2) ? | Rester sur `SD` 1.3.0 (déjà validée sur la carte) ; le journal en ajout seul rend le renommage inutile. |
| **D-S2** | Stocker l'œuvre **brute votée** ou aussi des dérivés d'affichage ? | Brut seulement ; dérivés recalculés. |
| **D-S3** | Cadence et nombre d'objets par manifeste (signature coûteuse) ? | 16 blocs, à mesurer (temps de `PodEd::sign`). |
| **D-S4** | Quel rôle par défaut (léger / conservateur / archive) selon la taille de carte détectée ? | léger par défaut ; promotion explicite. |
| **D-S5** | La route d'archive du serveur : un manifeste par intervalle, ou des objets seulement ? | Manifestes d'intervalle immuables (cache CDN). |

## 13. Hors périmètre
Chiffrement de la carte, accès aux données par un tiers via la carte (PoDScan), synchronisation poste à poste (LAN), compression, toute modification du consensus ou du vote.
