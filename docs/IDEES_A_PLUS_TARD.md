# Idées notées pour plus tard (hors périmètre actuel)

Ce fichier garde les idées validées « sur le principe » mais volontairement pas construites.
Ne pas les implémenter sans feu vert explicite.

## Système d'amis (noté le 30/09/2026)

**Idée du porteur :** au fur et à mesure que l'application grandit, ajouter une fonction
« amis » — demande d'ajout, acceptation — pour pouvoir **s'envoyer des choses directement,
sans passer par le réseau public** (pas de pool, pas de validation, pas de galerie).

**Ce que ça débloquerait :**
- Le niveau **« amis »** de la réception d'images (voir `PROMPT_REFONTE_DESSIN.md`,
  réglage de réception à 4 valeurs : désactivée / privée / amis / universelle). Tant que le
  système d'amis n'existe pas, le niveau « amis » est **affiché comme indisponible** (« bientôt »).
- Envoyer un dessin ou une image à l'écran d'un ami, à la demande (extension de
  « Afficher sur mon écran » et de l'envoi d'image).
- Une base pour d'autres échanges privés (messages courts, cadeaux d'œuvres…).

**Questions à trancher le moment venu :** identifiant d'un ami (profil artiste ? code
d'appairage ?), demande d'ajout et consentement mutuel, blocage/suppression, ce qu'un ami peut
faire (envoyer une image seulement ? un dessin ?), limites de débit entre amis, et quoi
conserver en trace (rien ? journal court sans contenu ?).

## Quota Upstash Redis (noté le 01/10/2026) — à traiter BIENTÔT, pas tout de suite

**Constat du porteur :** ~25 000 commandes/jour pour un plafond gratuit de 500 000/mois ⇒ quota épuisé en
~20 jours, et ça empire avec l'audience. Ne pas commencer par là ; garder en tête pour la suite.

**Constat code (lecture du 01/10/2026) :**
- `lib/redisBudget.ts` (`incrBudget`) n'est **appelé nulle part** : `/api/budget` affiche toujours 0. Aucune mesure
  interne de la consommation — première chose à faire = **mesurer par route** avant d'optimiser.
- Suspects relevés à la lecture, **non mesurés** : `getAllDevices()` (SCAN `device:*` + MGET) appelé par l'accueil,
  l'annuaire, les fiches, le profil, le réseau ; `readReverseLinks` (SCAN `artist:device:*`) ; `saveDevice` = 3 SET à
  chaque ping ; `incrementFramesSent` = GET + SET ; `getArtistBlocks` (N blocs + images à chaque vue de fiche) ;
  rate limiting (INCR + EXPIRE) à chaque requête ESP.

**Pistes (même démarche que pour ANA : mesurer, regrouper, mettre en cache, coupe-circuits) :**
1. instrumenter (compteur par route, échantillonné pour ne pas consommer le quota qu'on mesure) ;
2. remplacer les SCAN par l'index `devices:all` (SMEMBERS) + cache court des listes publiques ;
3. un seul SET au ping (ou EXPIRE + `lastPing` écrit rarement) ;
4. cache `s-maxage`/ISR sur annuaire, accueil, réseau ; pipelines/MGET partout où des GET sont enchaînés ;
5. brancher réellement le budget (modes dégradé / maintenance) ;
6. comparer avec le plan payant à l'usage d'Upstash (tarif à vérifier).
Attention : contrairement à Neon (ANA), Upstash facture à la **commande**, pas à la fenêtre d'éveil — regrouper =
pipelines, MGET et cache, pas calendrier.

## Pérennité des profils et récupération des blocs (noté le 01/10/2026)

**Constats vérifiés en lecture seule sur la vraie base :**
- `device:{id}` n'a que **48 h** de TTL restant sur un ESP appairé : `incrementFramesSent` (`lib/deviceStore.ts`)
  réécrit la clé avec le TTL « non appairé » (48 h) au lieu de `deviceTtl()`. Un ESP éteint plus de 48 h perd donc
  son enregistrement, et son retour crée un **nouvel `deviceId` aléatoire** (la clé `mac:` survit 90 j mais pointe
  vers une fiche disparue). Ses anciens blocs restent en Redis (aucune expiration) mais ne sont plus rattachés à rien.
- 10 appareils orphelins (9 de mai–juin 2026, 1 de septembre) portent ~69 listes de blocs au total ; seul
  `dev_TDLVORP6` (septembre) a encore un lien vers le profil, les 9 autres ne sont rattachés à rien.
- `artist:{id}`, `artist:slug:*` et `artist:device:*` expirent **90 j après la dernière écriture**, sans rafraîchissement
  par l'activité : le profil « Roubzi » disparaît vers le 12/12/2026 s'il n'est pas modifié (72 j restants au 01/10).
- Cookie de session : 30 j fixes, non glissants ⇒ une absence d'un mois vide « mon profil » et « mes blocs ».

**Plan proposé (non réalisé, en attente de feu vert) :**
1. Plus aucune expiration sur profil, slug, liens inverses ; `PERSIST` des clés existantes ; corriger `incrementFramesSent`.
2. Identité d'un ESP = sa MAC (clé `mac:` permanente) : un ESP qui se ré-enregistre retrouve **son** `deviceId` même si
   sa fiche a expiré — fin des orphelins, sans toucher au firmware.
3. Cookie 400 jours, glissant (renouvelé à chaque visite).
4. « Retrouver mon profil » : saisir le code d'appairage affiché par l'ESP (preuve de possession physique) ⇒ la session
   retrouve le profil de l'ESP, ses autres ESP et ses blocs. La clé privée ED25519 ne doit **jamais** quitter l'ESP ;
   plus tard, preuve par signature d'un défi (`deviceId` dérivé de la clé publique) ; un reset de l'ESP change la paire
   de clés mais pas la MAC.
5. Récupération des blocs orphelins existants : rattacher chaque ancien `deviceId` au profil (une clé
   `artist:device:{ancien}` par appareil, réversible), sur choix explicite du propriétaire.
