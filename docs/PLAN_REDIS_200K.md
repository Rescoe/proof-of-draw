# Tenir en 200 000 commandes Redis / 30 jours — analyse, leviers, décisions (05/10/2026)

Cible : **≈ 6 700 commandes / jour** pour tout le réseau (plan gratuit Upstash : 500 k / mois ; le porteur est à 70 % de ce plafond). Les chiffres ci-dessous sont des **estimations tirées du code**,
pas des mesures : la console Upstash et les journaux Vercel restent la référence (voir « Mesurer »).

## 1. Où vont les commandes (modèle)

| Poste | Coût unitaire | Fréquence | Poids |
|---|---|---|---|
| **Pull d'un écran au repos** | **5 commandes avant** (rate-limit EVAL + appareil GET + MGET + présence SET + dépilage d'observation) | 1 / 300 s / écran = 288 / jour | **≈ 1 440 / jour / écran = 43 000 / mois / écran** |
| Pull pendant un candidat en attente | idem | 1 / 60 s pendant ≈ 10 min | ≈ 50 / écran / bloc |
| Validation (écran qui vote) | GET validate (≈ 5) + vote POST (≈ 7) | 1 / écran / bloc | ≈ 12 / écran / bloc |
| Minage d'un bloc | ≈ 25 | 1 / bloc | négligeable |
| Pages web | plafonné par les caches CDN / `unstable_cache` (lot du 03/10) | — | à mesurer |
| Enregistrement (`/api/register`) | ≈ 10 | 1 / démarrage | négligeable |

Avec **5 écrans**, les seuls pulls au repos font ≈ 7 200 / jour : c'est déjà la cible entière. **Le pull est le poste dominant, de très loin** ; chaque écran d'un collègue ajoute ≈ 1 440 / jour.

## 2. Ce qui est fait aujourd'hui (commit « pull à ≈ 1,5 commande »)

Tout est côté serveur : **aucun firmware à reflasher**.

| Changement | Effet |
|---|---|
| **Un seul `MGET`** lit l'appareil, ses frames (toutes les clés d'écran connues), la tête de chaîne, le candidat, les **votes**, la notification, le mode banc d'essai et un drapeau « observation en attente » | l'appareil n'est plus lu à part (−1), les votes non plus (−1 pendant un candidat) |
| **Rate-limit échantillonné** : 1 pull sur 8 touche Redis (`lib/pullBudget.ts`) ; > 4 pulls échantillonnés par minute (≈ 32 pulls réels/min) → 429 ; ≥ 40 → liste noire | −0,875 commande par pull ; un écran sain (≤ 1 pull/min) ne l'atteint jamais, un emballement est coupé en quelques secondes |
| **Présence** (`lastSeen`/`lastPing`) réécrite seulement si > 12 min ; « en ligne » = 20 min (même fenêtre que `networkSnapshot`, restait 10 min à trois endroits) | de « à chaque pull » à 1 pull sur 3 |
| **Tâche d'observation** dépilée seulement si le drapeau `chain:obs:pending` est levé | −1 commande par pull au repos |

**Pull au repos : 5 → ≈ 1,5 commande** (1 MGET + 0,125 rate-limit + 0,33 présence). Par écran : 1 440 → ≈ 430 / jour (≈ 13 000 / mois).

| Nombre d'écrans | Pulls seuls avant | Pulls seuls maintenant | Avec repos 600 s (levier 2) |
|---|---|---|---|
| 5 | 7 200 / jour | ≈ 2 100 / jour | ≈ 1 100 / jour |
| 10 | 14 400 | ≈ 4 300 | ≈ 2 200 |
| 15 | 21 600 | ≈ 6 400 | ≈ 3 200 |

Reste à y ajouter les blocs (≈ 150 à 200 commandes par bloc pour 5 écrans : pulls à 60 s pendant le vote, votes, minage) et le web. **Ordre de grandeur : tenir la cible avec ≈ 10 écrans et ≈ 10 blocs/jour.**

## 3. Leviers restants, classés par rapport gain / risque

1. **Intervalle de repos 300 → 600 s** (`retryAfter` du serveur, aucun firmware à changer : les firmwares l'appliquent quand rien n'est en attente). Divise par 2 le coût des pulls.
   *Contrepartie* : une œuvre envoyée met jusqu'à 10 min à apparaître, et **le candidat doit rester valide plus longtemps** : `CANDIDATE_TTL_SEC` 600 → 1 500 s, sinon un écran qui tire toutes les 10 min ne voit jamais le vote
   (et la fenêtre « actif » du quorum, 30 min, reste suffisante). *Décision du porteur : latence contre quota.*
2. **Blocs : pulls à 60 s pendant le vote** → les écrans ne passent à 60 s qu'après avoir vu le candidat ; on peut les laisser à 120 s (même contrepartie, plus faible).
3. **`/api/validate-candidate`** : rate-limit (INCR + EXPIRE, 2 commandes) + appareil + candidat + votes → même regroupement en un MGET et rate-limit échantillonné (≈ −3 par vote).
4. **Pages web** : mesurer d'abord (journaux Vercel par route). Les caches CDN de 30 à 60 s et les `MGET` du 03/10 limitent déjà le coût ; si un poste ressort, allonger les fenêtres et invalider par événement (`revalidateTag` à l'écriture d'un bloc) plutôt que par expiration courte.
5. **Garde-fou** (`lib/redisBudget.ts`, non branché) : dégrader les fonctions annexes (galeries, journal) à 80 % du quota, jamais l'affichage des écrans.
6. **Plan payant à l'usage comme filet de sécurité** (voir § 5) : ne baisse pas la consommation, mais évite la coupure au plafond.

## 4. « Tout mettre en cache pour que les ESP lisent le cache sans commande » : pourquoi ça ne se fait pas tel quel

- Un pull est **propre à un appareil** : sa frame en attente, sa notification de bloc possédé, son mode banc d'essai. Un cache CDN public est partagé : on ne peut pas y mettre la frame d'un appareil précis sans la servir à tous, et
  **purger un cache CDN à la demande** (« dès qu'un dessin est fait ») n'est pas fiable sur le plan gratuit de Vercel. Une fenêtre `s-maxage` courte limite la fraîcheur au lieu de la garantir.
- Ce qui se met en cache **est déjà en cache** : tout le public et l'immuable (blocs, images, clips d'animation, galeries) passe par le CDN ou `unstable_cache`.
- Les données **globales** du pull (tête de chaîne, candidat) sont déjà dans le même `MGET` que le reste : les cacher ne retire pas de commande (un `MGET` de 16 clés coûte 1 commande, comme un `GET`).
- Une architecture **à deux étages** existerait : les écrans interrogent d'abord un petit état global mis en cache 60 s au CDN (« rien de nouveau »), et ne font le vrai pull que si quelque chose a changé. Elle fait passer le repos
  d'un coût par écran à un coût quasi fixe, mais **demande de reflasher tous les firmwares** et n'apporte rien tant qu'il y a moins de ≈ 20 écrans (le pull à 1,5 commande + repos 600 s est déjà dessous). À garder pour la montée en charge.

## 5. Neon (Postgres) à la place de Redis ?

Non, pas pour cet usage.
- Le coût d'un **sondage permanent** n'est pas en « commandes » mais en **temps de calcul** : la base ne se met en veille qu'après plusieurs minutes sans requête ; avec des écrans qui tirent toutes les 1 à 5 minutes, elle ne dort **jamais**.
  Mon souvenir du plan gratuit (≈ 100 h de calcul par mois, à vérifier sur la page tarifs) est **inférieur** à 24 h × 30 j : on viserait le même mur, plus tard.
- C'est une **réécriture** de `chain`, `queue`, `rateLimit`, `deviceStore`, files, verrous TTL — et « base de données » est un non-objectif du dépôt.
- Neon est déjà utilisé côté ANA pour des données froides : c'est sa place (galeries, historiques longs : tâche Q10 de la note du 03/10), pas le chemin chaud des pulls.
- **Filet d'urgence plus simple** : passer Upstash en **paiement à l'usage avec un plafond de dépense**. Tarifs relevés le 05/10/2026 sur [upstash.com/pricing/redis](https://upstash.com/pricing/redis) :
  gratuit = 500 k commandes / mois, 256 Mo, 10 Go de bande passante (au plafond : « on fait de notre mieux pour garder la base en marche, mais on peut limiter le débit ») ; **paiement à l'usage = 0,20 $ par 100 000 commandes**, stockage 0,25 $/Go (1 Go gratuit),
  **plafond mensuel de dépense réglable** (une fois atteint, la base est limitée en débit au lieu de continuer à facturer) ; plans fixes 10 $ (250 Mo) / 20 $ (1 Go), commandes illimitées. Le site ne dit pas si le paiement à l'usage garde les 500 k gratuits : on compte au pire.
  Coût au pire : 500 k = 1 $ · 1 M = 2 $ · 2,5 M = 5 $ · 5 M = 10 $. **Recommandé : paiement à l'usage, plafond 5 $.** Comptage des `EVAL` : non précisé par la doc (« chaque commande d'un pipeline / d'une transaction est facturée à part »), d'où le calibrage du § 6.

## 6. Mesurer (à faire avant de décider du reste)

1. **Console Upstash** : relever chaque matin « commandes des 24 h » ; objectif ≤ 6 700. Noter l'heure du déploiement de ce lot : la courbe doit casser.
2. **Calibrage de ce que « une commande » veut dire** (hypothèse non vérifiée du dépôt : un `EVAL` compte pour 1) : noter le compteur, appeler 50 fois `/api/pull?deviceId=…` d'un appareil de test, relire le compteur → attendu ≈ 50 × 1,5.
   Si la console compte chaque commande interne d'un script, **le rate-limit `EVAL` coûte 2 et non 1** ; il faudrait alors le remplacer par `SET NX EX` (déjà la voie de `benchPollFast`).
3. **Journaux Vercel par route** sur 24 h (Observability → chemins) : nombre d'appels × coût par appel (§ 1) = la répartition réelle.

## 7. Décisions attendues du porteur
- Latence acceptée pour une œuvre envoyée (5 min, 10 min ?) → intervalle de repos et `CANDIDATE_TTL_SEC`.
- Plan Upstash : rester gratuit, ou paiement à l'usage plafonné comme filet.
- Nombre d'écrans visé d'ici fin octobre (les collègues), pour dimensionner.

## 8. Lot du 05/10/2026 (suite) — flux par bloc et mode actif / dormant (serveur seulement, aucun firmware à reflasher)

### 8.1 Flux par bloc (par écran et par bloc : ≈ 34 → ≈ 9 commandes, estimation)
| Route | Avant | Maintenant |
|---|---|---|
| `/api/pull-frame` (image) | appareil + 1 lecture par écran + personnelle ≈ 3-4 | **1 MGET** |
| `/api/ack-frame` | 3 lectures de blacklist + appareil ×2 + 1 lecture par écran + `saveDevice` (3 SET) + personnelle + affichage ≈ 11 | 1 MGET + 1 DEL + 1 SET (clé appareil seule) + 1-2 SET d'affichage ≈ **5** |
| `/api/validate-candidate` | 2 blacklists + INCR/EXPIRE + appareil + candidat + votes ≈ 7 | **1 MGET** + rate-limit échantillonné 1/8 ≈ **1,1** |
| `/api/validation-result` (le vote) | blacklist + appareil + candidat + votes + écriture ≈ 5 | 1 MGET + 1 SET ≈ **2** |

`writeDeviceKey` (une seule clé `device:{id}`, au lieu des trois de `saveDevice`) sert aussi à la présence du pull, avec le bon TTL (90 j appairé / 48 h sinon : le pull remettait 48 h à un appareil appairé).

### 8.2 Mode actif / dormant
- Le réseau est « **chaud** » 30 min après la dernière activité : un candidat soumis, un bloc miné, une image envoyée à un écran, ou **l'ouverture de l'atelier de dessin / d'animation** (`POST /api/hot`, au plus 1 fois / 10 min / onglet).
- Au repos, un écran tire toutes les **5 min** si le réseau est chaud, toutes les **15 min** sinon (`retryAfter` du serveur ; réglable `PULL_HOT_SEC` / `PULL_DORMANT_SEC` — mettre 300 aux deux supprime le mode dormant).
- Le drapeau `net:hot` est lu dans le MGET du pull : zéro commande de plus.
- **`CANDIDATE_TTL_SEC` passe de 600 à 1 800 s** (un écran dormant voit le candidat à temps). **Vérifier dans Vercel qu'aucune variable `CANDIDATE_TTL_SEC` n'impose encore 600** : elle prime sur la valeur par défaut. Contrepartie : un candidat qui n'atteint pas le quorum bloque la file 30 min au lieu de 10.
- Présence : réécrite toutes les 10 min ; « en ligne » = 30 min ; « actif » du quorum = 45 min (une seule définition : `lib/pullBudget.ts` ; test de cohérence avec le pull dormant).
- **Latence** : une œuvre soumise après une période calme attend le réveil des écrans — jusqu'à 15 min dans le pire cas ; l'ouverture de l'atelier (souvent plusieurs minutes avant l'envoi) les réveille déjà.

### 8.3 Nouveau modèle (estimation)
Pull au repos : ≈ 1,4 commande ; 20 h dormantes à 15 min (80 pulls) + 4 h chaudes à 5 min (48 pulls) = **≈ 180 commandes / jour / écran** (1 440 au départ). Par bloc et par écran ≈ 9.
10 écrans, 10 blocs / jour : pulls ≈ 1 800 + blocs ≈ 900 + web/divers → **≈ 3 à 4 k / jour ≈ 100 k / mois**, très sous la cible (200 k) et sous le gratuit (500 k). Estimation à confirmer par la console Upstash.
