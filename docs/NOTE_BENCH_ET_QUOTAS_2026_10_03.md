# Note du 03/10/2026 — banc d'essai TFT, cartel, et manquement à la règle « quotas Redis »

Rédigée pour le porteur. Elle couvre : ce qui a été trouvé, ce qui a été modifié (commits `3465331` et `d2c5fd4`), le manquement à la règle sur les quotas Upstash, et les chantiers « scale / quotas » à planifier.

---

## 1. Règle primordiale (rappel, désormais écrite dans `CLAUDE.md`)

> **Ne jamais saturer Upstash Redis.** Toute fonctionnalité qui lit ou écrit dans Redis doit être pensée en *nombre de commandes par heure et par utilisateur / appareil*, AVANT d'être codée.

Cette règle existait seulement dans la tête du porteur. Elle n'était écrite nulle part dans le dépôt : c'est ce qui a permis le manquement ci-dessous.

## 2. Le manquement (à ne plus jamais reproduire)

**Ce qui s'est passé.** La page `/bench` (écrite par Claude) relisait l'état du banc d'essai **toutes les 2,5 secondes, en permanence**, y compris :
- quand le mode banc d'essai était éteint,
- quand l'onglet était caché ou en arrière-plan,
- aussi longtemps que la page restait ouverte (aucune limite).

Chaque lecture (`/api/bench/status`) coûte environ **6 commandes Redis** (3 `GET`, 2 `LRANGE`, 1 lecture de l'appareil, plus la vérification de propriété). Soit :

| | Valeur |
|---|---|
| Rythme | 1 lecture / 2,5 s = 24 lectures / min |
| Coût | ≈ 144 commandes / min ≈ **8 600 commandes / heure** par onglet ouvert |
| Si l'onglet reste ouvert une nuit (8 h) | ≈ **69 000 commandes** pour rien |

Ce n'est pas une mesure sur Upstash (le tableau de bord n'a pas été consulté) : c'est le calcul à partir du code. À vérifier dans la console Upstash.

**Pourquoi c'est grave.** Le quota est partagé par tout le réseau : un onglet de test oublié peut consommer ce qui sert au fonctionnement normal des écrans.

**Pourquoi ça n'a pas été vu.** Aucun contrôle n'existait au moment de l'écriture : ni règle écrite, ni relecture du coût Redis, ni test. Le correctif a été fait seulement après que le porteur a posé la question.

**Ce qui a été corrigé.** Rythme adaptatif dans `app/bench/BenchClient.tsx` :
- 2,5 s pendant 45 s après un envoi (et 30 s après un changement de mode),
- 8 s tant que le mode banc d'essai est actif,
- 20 s sinon,
- **aucune lecture quand l'onglet est caché** (reprise immédiate au retour).

Résultat attendu : de ≈ 8 600 à ≈ 700–1 100 commandes / heure pendant qu'on regarde la page avec le mode actif, et ≈ 1 800 / heure au repos onglet visible, 0 onglet caché.

**Côté écran (R4).** Le poll rapide du banc d'essai coûte 3 commandes / 3 s (verrou + lecture + présence) pendant 30 minutes au plus : ≈ 1 800 commandes par session de test, puis retour au pull normal. En lecture « en boucle sans fin », un seul contrôle toutes les 20 s (3 commandes) au lieu d'un poll continu.

### Garde-fous à appliquer à partir de maintenant

1. **Avant de coder** une page, un cron ou un firmware qui parle au serveur : écrire le coût en `commandes Redis / heure / acteur` dans le commit ou la doc.
2. **Interface web** : jamais de `setInterval` nu. Toujours : pause quand `document.hidden`, rythme réduit au repos, arrêt après inactivité, et reprise sur `visibilitychange`.
3. **Mode « test / accéléré »** : toujours **borné dans le temps** (TTL) et automatiquement éteint.
4. **Regrouper** les lectures (un `MGET` plutôt que 5 `GET`), éviter les écritures de « présence » à chaque poll.
5. **Revue du coût** à chaque nouvelle route : combien de commandes par appel ? appelée à quelle fréquence ?

## 3. Ce qui a été trouvé et modifié sur le banc d'essai (firmware `r4tft28-2.2` puis `2.3`)

### 3.1 « Les images arrivent en retard » : erreur de mesure
Le premier essai affichait « 23 images en retard » avec un travail moyen de 39,6 ms. La cadence de 10 images/s était en réalité tenue : le retard était calculé **en fin de peinture** contre l'instant prévu **de début**, donc le temps de travail comptait comme du retard.
Maintenant : *retard de démarrage* (début réel − début prévu, seuil 5 ms) et *marge minimale* (temps restant avant l'image suivante), plus la capacité estimée en images/s.

### 3.2 Vitesse de peinture
La bibliothèque Adafruit envoie, sur la R4, chaque pixel par **deux transferts SPI d'un octet**. Le firmware envoie désormais les pixels **par blocs** (`SPI.transfer(buf, n)`) avec une seule transaction SPI par image.
Mesuré sur ta carte : travail moyen **39,6 → 14,4 ms** (×2,7), marge minimale 57 ms, 0 retard. Ce n'est ni un problème de tampon ni l'absence de carte SD.

### 3.3 Arrêt après 3 tours
Pas un bug : la case « ∞ en boucle » n'était pas cochée et le défaut était 3 tours. Le défaut est maintenant « en boucle ». La lecture s'arrête au toucher, à un nouvel envoi, à la fin du mode ou après 1 h. Un brouillon déjà enregistré dans le navigateur garde son ancien réglage.

### 3.4 Historique des mesures
L'ancien essai (« 23 en retard ») restait affiché : l'historique garde les 10 derniers essais. Ajout d'un bouton « Effacer l'historique » (`POST /api/bench/clear`, 1 commande Redis) ; seul le dernier essai est en pleine opacité.

### 3.5 Cartel bloqué sur le dernier bloc (bug ancien)
Quand on renvoie une œuvre depuis une galerie, le cartel affichait titre/artiste/n° du **dernier bloc de la chaîne** (« Yo le jacq », bloc 82) au lieu de ceux de l'œuvre. Cause :
- après l'accusé de réception, le serveur n'a plus l'image ; chaque pull répond alors avec la **tête de chaîne** ;
- le firmware écrasait titre, artiste et n° de bloc **à chaque pull**, même sans nouvelle image ;
- `send-to-screen` ne transmettait pas le n° de bloc d'origine.

Correctif : le cartel n'est appliqué que lorsque le pull apporte une nouvelle image ; `send-to-screen` joint `blockIndex` ; `/api/pull` l'utilise dans `cartelMeta`. Le n° de bloc suit maintenant l'image affichée, pas la chaîne.

### 3.6 Fichiers
Firmware `pod_uno_r4.ino`, `pod_bench.h`, `host/bench_harness.cpp` ; `lib/bench/{clip,store}.ts` ; `app/bench/BenchClient.tsx` ; `app/api/{bench/send,bench/clear,pull,send-to-screen}/route.ts` ; tests `benchClip`, `podBenchR4` ; docs `BENCH_ANIMATION.md`, `CLAUDE.md`.

### 3.7 À vérifier après reflash
- Une animation envoyée avec la case cochée tourne jusqu'au toucher.
- Une ancienne œuvre renvoyée depuis la galerie affiche son propre cartel et le garde aux pulls suivants.
- Le journal et les mesures se vident avec « Effacer l'historique ».

## 4. Tâches « scale / quotas » (à planifier — non commencées)

Estimation de départ, **lue dans le code, non mesurée** : un pull d'écran coûte environ 8 à 9 commandes Redis (rate limit `INCR`, lecture de l'appareil, frame du consensus, frame personnelle, tête de chaîne, candidat, notification, mode banc d'essai pour le TFT). À 1 pull/min, c'est ≈ 12 000 commandes / jour / écran, soit ≈ 370 000 par mois **pour un seul écran** (60 s ; 300 s au repos si le serveur renvoie `retryAfter`). Le réseau grandit : il faut un budget par acteur.

| # | Tâche | Pourquoi / piste | Risque |
|---|---|---|---|
| Q1 | **Mesurer** : relever la consommation réelle dans la console Upstash (commandes/jour, plan, plafond) et la répartir par route | Tout le reste dépend de ces chiffres ; jusqu'ici rien n'est mesuré | nul |
| Q2 | **Compteur de commandes par route** (middleware léger, échantillonné) affiché dans une page admin | Voir qui consomme sans ouvrir Upstash | faible |
| Q3 | **Pull** : lire en un seul `MGET` tout ce qui peut l'être (frame, frame perso, notif, mode banc d'essai…) ; rate limit sans `EXPIRE` séparé (`SET … NX EX` ou script) | 8–9 → 3–4 commandes par pull | moyen : touche le contrat des firmwares |
| Q4 | **Pull idle** : généraliser `retryAfter` long (5 à 15 min) quand rien n'est en attente ; réveil par un signal bon marché | Le plus gros levier : le gros du trafic est du pull « rien de neuf » | moyen : latence d'affichage |
| Q5 | **ETag / « rien de changé »** : le firmware envoie le dernier `blockHash` vu ; le serveur répond 304 sans lire le détail | Moins de commandes ET moins d'octets | moyen |
| Q6 | **Cache mémoire par instance** de la tête de chaîne et du candidat (quelques secondes) | Évite N lectures identiques entre appareils | faible (attention au cache Next, voir `project_ana_neon_fetch_cache_bug`) |
| Q7 | **Pages web à polling** (`GlobalTerminal`, `EspActivityFeed` : 5 s ; `LiveDisplays` : 60 s) : vérifier pause onglet caché, rythme adaptatif, arrêt après inactivité | Même défaut que `/bench` à vérifier ; `GlobalTerminal`/`EspActivityFeed` n'ont pas de test `document.hidden` dans le code lu | faible |
| Q8 | **Présence/`lastSeen`** : n'écrire que si périmé (déjà fait à 4 min pour le pull) ; l'étendre aux autres routes | Écritures évitées | faible |
| Q9 | **Journaux et listes** (`LPUSH`+`LTRIM`+`EXPIRE` = 3 commandes) : regrouper dans un pipeline / une transaction, ou limiter le volume | Le journal du banc d'essai coûte 3 commandes par événement | faible |
| Q10 | **Données froides hors Redis** : galeries, historiques, journaux longs vers Neon (déjà utilisé côté ANA) ; Redis réservé au chaud (pull, verrous, TTL courts) | Plafond de stockage et de commandes | élevé : migration |
| Q11 | **Budget par appareil** et alerte : plafond de commandes/jour/appareil avec dégradation douce (pull plus lent) plutôt que coupure | Protège le quota commun d'un écran bavard | moyen |
| Q12 | **Règle de revue** : checklist « coût Redis » dans le gabarit de commit/PR et test automatisé qui compte les commandes d'une route sur un scénario type | Empêche la récidive | faible |

Ordre suggéré : **Q1 → Q7 → Q4 → Q3 → Q5 → Q9**, puis le reste. Q1 d'abord : sans mesure on optimise à l'aveugle.

## 5. Décisions à prendre plus tard (par le porteur)
- Plan Upstash visé et plafond acceptable (commandes/mois).
- Latence d'affichage acceptable pour un pull « idle » plus long (Q4).
- Faut-il garder le poll rapide du banc d'essai à 3 s (≈ 1 800 commandes / session de 30 min) ou passer à 5 s ?

---

## 6. Suite du 03/10 (après lecture de la console Upstash : 210 k / 500 k commandes, 165 k lectures, 45 k écritures)

Le constat du porteur invalide l'estimation de la section 2 : le banc d'essai n'était **pas** le plus gros consommateur.

### 6.1 Le coupable principal (trouvé dans le code, à confirmer par les journaux Vercel)

La **page d'accueil** monte deux composants (`EspActivityFeed` et `GlobalTerminalPanel`) qui appelaient chacun `/api/network/activity-log` **toutes les 5 s, sans pause onglet caché ni arrêt**. Chaque appel coûtait ≈ **36 commandes** (1 `LRANGE` + candidat + votes + **30 `GET` de blocs un par un** + animations).

| | Avant | Après |
|---|---|---|
| Appels par onglet d'accueil | 2 × 12/min | 1 requête / 30 s (onglet visible, interaction < 10 min) |
| Commandes par appel | ≈ 36 | ≈ 6 (blocs en 1 `MGET`) |
| Coût par onglet ouvert | **≈ 52 000 / heure** | **0 côté Redis** (cache CDN 30 s + mémo 30 s partagés par tous les visiteurs) |
| Coût total de la route | proportionnel aux visiteurs | ≈ 720 / heure, quel que soit le nombre de visiteurs |

Un seul onglet laissé ouvert 2 heures suffit à expliquer ≈ 100 k commandes. Les 100 k d'hier s'expliquent par cette route + mes essais sur `/bench`, sans qu'on puisse les départager sans les journaux.

### 6.2 Autres économies faites (même commit)
- **`/api/pull`** : 13 → **4 commandes** par pull au repos (rate limit `INCR`+`EXPIRE` en un `EVAL`, blacklist + frames + frame perso + tête de chaîne + candidat + notification + mode banc d'essai en **un `MGET`**, appareil inconnu → 404 sans autre lecture). Réponse JSON strictement inchangée.
- **`/api/bench/poll`** (écran en mode banc d'essai) : 3 → **1 commande** (`EVAL` : verrou + lecture + présence). Les scripts Lua ont été vérifiés contre Redis avec des clés jetables, puis nettoyées.
- **`lib/usePolling.ts`** : hook commun (pause onglet caché, arrêt après 10 min sans interaction, reprise à l'interaction) à utiliser pour TOUT nouveau polling.

### 6.3 Ce qui n'est PAS encore audité (risque restant)
`/api/ack-frame`, `/api/validate-candidate` (les écrans valident toutes les 30 s quand un candidat est en cours), `/api/draw`, `/api/blocks*`, `/api/device-activity`, les pages de profil/galerie, le pont ANA (`maybeCheckAnaFeed`), les crons. **Il faut les journaux Vercel** : nombre de requêtes par route sur 24 h (Observability → par chemin). Multiplié par le coût par appel, c'est la mesure qui manque (tâche Q1).

### 6.4 Le filet existe mais n'est pas branché
`lib/redisBudget.ts` (compteur mensuel, mode dégradé à 80 %, maintenance à 95 %) n'est utilisé que par `/api/budget` : **aucune route ne l'appelle**. Le brancher coûte lui-même 1–2 commandes par appel, donc à faire seulement sur une route à faible trafic ou avec un échantillonnage (1 appel sur 20).

### 6.5 Plan d'action pour tenir le mois (250 k restants sur 28 jours ≈ 8,9 k / jour)

Ordre de priorité (le plafond de 8,9 k/jour est la cible ; rappel : on était à ≈ 100 k/jour) :
1. **Déployer ce lot** (activity-log, pull, bench) et **surveiller** la console Upstash 24 h : la consommation journalière doit tomber nettement sous 20 k.
2. **Fournir les journaux Vercel par route** (Q1) pour attaquer le reste avec des chiffres.
3. **Fermer les onglets de la page d'accueil et `/bench` laissés ouverts** (ils ne coûtent plus en Redis, mais c'est la bonne hygiène pendant la mesure) et **couper le mode banc d'essai** quand on ne teste pas.
4. Si, après 24 h, la consommation dépasse encore ≈ 9 k/jour : allonger `retryAfter` des écrans au repos (Q4), puis ETag/304 (Q5), puis cache mémoire des lectures communes (Q6).
5. **Brancher le garde-fou budget** (échantillonné) pour que le dépassement dégrade les fonctions annexes (journal, galeries) et jamais l'affichage des écrans.

### 6.6 Facture : options à examiner (non décidées)
- Rester sur le plan gratuit tant que la consommation tient ≈ 9 k/jour : coût 0 €.
- Si on dépasse : **vérifier sur la page Pricing d'Upstash** (le tarif actuel, ce que fait le plan gratuit au plafond — blocage ou facturation — et le plan « à l'usage » vs plan fixe). Je n'ai pas ces chiffres de façon fiable : ne pas décider sur mémoire.
- Le levier le moins cher reste de **ne pas faire la requête** : chaque commande évitée ci-dessus est de l'argent non dépensé, contrairement au plan payant qui ne fait que l'effacer.
