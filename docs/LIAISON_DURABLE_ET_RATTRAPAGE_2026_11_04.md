# Liaison appareil ↔ utilisateur durable, rattrapage des œuvres manquées, vote des multiscreen (04/11/2026)

Branche `claude/appareils-liaison-durable` (depuis `main` b6dbd60). Partie **serveur + web seulement** : aucun firmware modifié, rien flashé, aucune release OTA publiée.

## 1. Pourquoi un utilisateur « n'a plus d'écran »

**Constat (prouvé dans le code)** : la seule trace côté téléphone est le cookie `esp_session` (HttpOnly, 400 j, `lib/session.ts`). Il porte `deviceIds` + `artistId`. Sans lui, `GET /api/artist` renvoie `profile: null` et la page Profil montre « aucun écran ». Le lien SERVEUR, lui, est intact : `device.artistId` et `artist:device:{id}` existent (vérifié en lecture seule pour `dev_T46HBXG1`, lié au profil `be4e0a80…`, appareil stable depuis le 30/09, `mac:` sans expiration).

**Le chemin de retour existait mais était fermé** : ré-entrer le code d'appairage dans `/onboard` retrouve le profil propriétaire (`app/api/onboard/route.ts`). Mais ce code n'est affiché **que sur l'écran de l'ESP tant qu'il n'est pas appairé** ; une fois appairé, plus aucun endroit ne le montre — sauf le profil, auquel on n'a justement plus accès. D'où l'impasse « compte auquel il n'a plus accès ».

**Pourquoi le cookie disparaît (hypothèses, NON prouvées — une seule mesure future les départagera)** :
1. navigation privée ou navigateur intégré d'une application (le code détecte déjà Snapchat/Instagram… à l'appairage, pas après) ;
2. données du site effacées / « fermer les onglets » / nettoyage d'un iPhone ancien ;
3. autre navigateur (Safari ↔ Chrome ↔ icône sur l'écran d'accueil : jars de cookies séparés) ;
4. le portail Wi-Fi capture le téléphone dans le mini-navigateur de connexion d'iOS (jar séparé, éphémère) — à écarter si le QR PoD est scanné après retour sur la box.
Aucune de ces causes n'est démontrée : **la nouvelle télémétrie `stat:sesslost:*` (famille de navigateur, anonyme) les départagera** dès qu'un navigateur qui se souvenait d'un appairage reviendra sans cookie.

## 2. Ce qui est livré

| Élément | Fichiers | Effet |
|---|---|---|
| Lien de récupération signé et révocable | `lib/recoveryToken.ts`, `lib/recovery.ts`, `app/api/artist/recovery`, `app/api/artist/recover` | Mon profil → « 🔑 Sauvegarder mon accès » : un lien `…/retrouver#k=r1.…` (HMAC, epoch révocable) à garder dans une note ; l'ouvrir rétablit le cookie (profil + TOUS les ESP) |
| Page d'arrivée | `app/retrouver/page.tsx` | La clé est dans le **fragment** (jamais envoyée au serveur, effacée de la barre d'adresse) |
| Restauration silencieuse + diagnostic | `app/profile/Recovery.tsx` (`SessionGuard`) | Copie du jeton en stockage local (filet SUPPLÉMENTAIRE) : cookie perdu mais pas le stockage ⇒ accès rétabli seul ; sinon bandeau explicatif + saisie |
| Réaffichage du code d'appairage | `app/api/devices/pair-code`, `DevicesPanel.tsx` (Gérer → Accès → « Afficher le code ») | Plus d'impasse : le propriétaire revoit le code à tout moment |
| Saisie universelle | `RecoverAccess` (profil sans cookie, `/retrouver`) | Lien, clé `r1.…` OU code d'appairage de l'ESP (8 car.) |
| Rattrapage des œuvres manquées | `lib/missedWorks.ts`, `app/api/my-devices/[id]/missed`, `app/profile/CatchUp.tsx` | Bouton « ↻ Rattraper » sur chaque carte : liste (≤ 5) des œuvres que CET écran aurait dû recevoir, bouton « Afficher » → `/api/send-to-screen` existant |
| Télémétrie de perte | `app/api/artist/session-lost`, `lib/uaFamily.ts` | Compte + liste des 60 dernières « famille · jour » (ex. « iOS 12 · Safari ») |

**Sécurité** : le lien de récupération = clé d'accès au profil (comme le code d'appairage, déjà équivalent) — montré au seul propriétaire, révocable (« Nouveau lien »), 10 essais / 10 min / IP, signature de 22 caractères (≈ 132 bits), séparation de domaine avec le cookie de session. Le cookie restauré **ajoute** le profil, ne retire aucun ESP.

**Coût Redis (règle primordiale)** : au repos = **0 commande/heure**. Une ouverture de profil avec un cookie courant = **1 MGET** pour dériver le jeton (profil + epoch) ; le repli des anciens cookies peut lire le profil auparavant. Restauration = 1 MGET métier, rare, plus les garde-fous de sécurité. Rattrapage = 4 lectures métier **au clic seulement**, plus au plus 1 GET de propriété lorsque le deviceId n'est pas déjà dans le cookie ; jamais en arrière-plan. L'ACK d'une œuvre personnelle ajoute 1 GET rare pour conserver le dernier index consensus, puis garde son SET existant. Code d'appairage = 1 GET métier au clic. Télémétrie échantillonnée à 1 événement/heure/IP ; ses commandes de limite et de compteur ne tournent jamais sans perte détectée. Aucun SCAN ajouté par ces parcours.

**Correction après audit** : une frame personnelle écrasait la méta du dernier affichage consensus. Après un premier rattrapage, l'interface pouvait donc considérer à tort tous les blocs récents comme manqués. Le record personnel conserve maintenant `lastConsensusBlockIndex` (privé, jamais exposé publiquement), y compris après plusieurs affichages personnels successifs.

**Récupération depuis un navigateur portant déjà un autre profil** : le code d'appairage d'un appareil déjà lié restaure toujours le profil propriétaire de cet appareil. Les anciens `deviceIds` directs du navigateur ne sont pas mélangés dans ce cookie, afin d'éviter une session hybride entre deux comptes.

**Portée exacte du rattrapage** : ce n'est pas un journal de livraison illimité. Au clic, le serveur inspecte au plus les 25 blocs récents et en propose au plus 5, postérieurs au dernier bloc de consensus connu pour cet écran. Cela couvre le cas visé (frame expirée pendant une déconnexion récente) sans nouvelle écriture Redis par bloc ni tâche de fond. Si un écran a déjà affiché un bloc plus récent, les blocs plus anciens ne sont pas reproposés ; un historique exhaustif exigerait un registre de réception par appareil, avec un coût Redis durable qui n'est pas introduit dans ce lot.

## 3. Ce qui est prouvé / non prouvé

Prouvé (hôte) : tests `tests/recoveryAccess.test.ts` (22) — aller-retour du jeton, refus de tout jeton altéré / mauvais secret / epoch révoqué, séparation de domaine, sélection des œuvres manquées (règles e-ink / animation / conversion / « animations seulement »), famille de navigateur sans identifiant, garde-fous statiques des routes (propriétaire d'abord, aucune écriture dans `missed`, aucun SCAN). `tsc` propre, eslint sans erreur sur les fichiers nouveaux.
**Non prouvé** : le comportement sur un vrai iPhone (Safari ancien) ; le rendu navigateur (aucun serveur local lancé : pas de variables Redis dans cet espace de travail) ; la cause exacte de la perte du cookie chez l'utilisateur concerné.

## 4. Protocole d'essai (à faire après déploiement)
1. Sur le téléphone du propriétaire : Mon profil → « Copier le lien » ; ouvrir le lien dans une fenêtre **privée** ⇒ « ✓ Accès rétabli » puis le profil et ses écrans.
2. Vider les données du site, recharger : le bandeau « Ce navigateur a perdu le lien… » apparaît (si le stockage local est aussi vidé) ou l'accès revient seul (s'il ne l'est pas).
3. Gérer → Accès → « Afficher le code » ; le saisir dans `/retrouver` depuis un autre navigateur.
4. « Nouveau lien » : l'ancien lien doit répondre « invalide ou révoqué ».
5. Rattraper : couper un écran > 45 min pendant qu'un bloc est validé, le rallumer, « ↻ Rattraper » ⇒ l'œuvre manquée est listée, « Afficher » ⇒ affichée au prochain contact.
6. Plus tard : `GET` Redis `stat:sesslost:ua` (lecture seule) donne les familles de navigateurs concernées.

**Pour l'ami dont le profil est inaccessible aujourd'hui** : son appareil est lié à un profil existant et son code d'appairage est lisible côté serveur (clé `device:dev_T46HBXG1`, champ `pairCode`). L'exploitant peut le lui transmettre par un canal privé ; il le saisit sur `/retrouver` (ou `/onboard`), retrouve profil et écrans, puis copie son lien de récupération ; **faire tourner le code ensuite** (Gérer → Accès → « Régénérer le code »).

## 5. Vote v2 et réception des deux multiscreen — état (04/11/2026 matin)
Faits serveur (lecture seule, `devlog:*`, `device:*`) :
- `dev_KAD6PKC4` (`multiscreen-2.8`) : vote **v1 d'animation** réussi le 03/11 21:36 (bloc #133, `missedVotes` revenu à 0). Sur un dessin **statique** (#132, 02/11) : candidat lu plusieurs fois avec des `register` entre chaque lecture (redémarrages), aucun vote. L'OTA `multiscreen-2.9` (lecture par morceaux) est annoncée à chaque pull, **jamais téléchargée**.
- `dev_T46HBXG1` (`multibwr-2.2`, lecture par morceaux) : lit le candidat statique (01/11 10:26 ; 02/11 14:36) puis **disparaît sans redémarrer** (pas de `register` avant 13:32 / 20:03, soit une remise sous tension manuelle) ; **jamais de vote v2 statique prouvé** (son dernier vote, 31/10 22:18, est l'animation #130 en v1). Il n'a pas reçu les frames #131/#132 (hors ligne pendant les ≈ 42 min de validité) : son e-ink montre toujours #123.
- Les deux blocs d'animation récents (#130, #133) sont validés par vote **v1** : attendu (aucune spécification v2 d'animation, lot 8).

**Conclusion honnête : le problème de vote v2 statique des multiscreen n'est PAS résolu et sa cause n'est pas établie.** Le journal serveur ne voit pas `/api/candidate-frame` (réponse mise en cache par le CDN, sans identifiant d'appareil) : **seul le port série** dira où la carte s'arrête (`[VOTE-NET]`, `[VALIDATE2]`, `[HEAP]`). Aucune correction de firmware n'est justifiée sans cette mesure ; aucune release OTA n'est préparée ici.

Pistes à départager avec un journal série (dans l'ordre) :
1. T46 : tas au `[VOTE-NET] début` (tampon de 4 736 o malloc + tampon TLS 4 096 + 512 + BearSSL) et dernier `morceau` atteint ; si le journal s'arrête sans `[BOOT]`, c'est un blocage, sinon un redémarrage.
2. KAD : confirmer que le redémarrage est bien un `abort()` dans la poignée de main TLS (non chunké) ; l'installation de la 2.9 (USB ou OTA) est le correctif prévu — le canari `multiscreen-2.9` séq. 18 reste publié pour cette seule carte.
3. Amélioration déjà consignée (Codex) : délai global borné pour la lecture par morceaux (TFT 2,8″ ≈ 65 connexions) ; sans effet sur le BWR (4 morceaux).
