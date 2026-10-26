# Lot UX 4 — cercles privés entre artistes, MVP sans médias (26/10/2026)

Décisions du porteur : cercles, invitations avec consentement, droits côté serveur, interface, messages texte très bornés ; **aucun PNG/JPEG/GIF dans Redis**, aucun service payant ni dépendance externe choisi.

## Modèle (`lib/circles.ts`, pur ; adaptateur Upstash + enveloppe des routes : `lib/circlesRedis.ts`)
| Clé Redis | Contenu | Borne / TTL |
|---|---|---|
| `circle:{id}` | JSON nom, propriétaire, date | TTL 365 j renouvelé à chaque écriture |
| `circle:{id}:members` | HASH artistId → nom à l'adhésion | ≤ 12 membres ; TTL 365 j |
| `circle:{id}:pending` | HASH invitéId → JSON | ≤ 10 ; TTL 30 j ; lisible du seul propriétaire |
| `circle:{id}:msgs` | LIST des 50 derniers messages | 280 caractères/message ; TTL 90 j |
| `artist:circles:{id}` | SET des cercles de l'artiste | ≤ 10 ; TTL 365 j (simple index : la liste des membres fait foi) |
| `circle:invites:{id}` | HASH cercle → invitation reçue | ≤ 20 ; TTL 30 j (+ péremption à la lecture) |
| `rl:circle:{action}:{id}` | débit : créer 5/jour, inviter 10/h, écrire 10/10 min | fenêtre = TTL |
Identité = le **profil artiste de la session** (`resolveSessionArtist`) ; sans profil : 401 « connecte un écran d'abord ». Seuls les profils réels sont invitables (pas les artistes « implicites »).

## Règles de droits (toutes vérifiées dans `lib/circles.ts`, jamais dans l'interface)
- **Consentement** : le propriétaire invite, l'invité n'est PAS ajouté ; seule la session de l'invité peut accepter ou refuser SA propre invitation ; un tiers qui connaît l'identifiant ne peut rien accepter (404). Refuser retire l'invitation des deux côtés. Invitation périmée après 30 jours.
- **Propriétaire** : invite, annule une invitation, retire un membre (jamais lui-même), supprime le cercle (nom retapé ; nettoie les index des membres et les invitations en attente). Il ne peut pas quitter (il supprime). **Membre** : lit, écrit, quitte. Décision MVP : **seul le propriétaire invite** (anti-spam ; à rouvrir si besoin).
- **Un non-membre reçoit la MÊME réponse (404 « Cercle introuvable. ») qu'un cercle inexistant ou qu'un identifiant invalide, pour les 9 opérations** (testé) : aucune fuite d'existence. La source de vérité est le HASH des membres, pas l'index `artist:circles` (index orphelin nettoyé à la lecture, sans donner accès).
- **Isolation** (testé) : aucun fichier hors `app/api/circles`, `app/circles`, `lib/circles*` (+ le lien de navigation) ne touche aux cercles : rien dans la galerie, la carte, les recherches, l'annuaire, les flux ni le consensus. Aucun contenu de cercle n'est miné ou voté. Réponses `private, no-store`.
- **Plafonds** : nom 2–40 car. ; 5 cercles possédés, 10 au total, 12 membres (invitations en attente comprises), 10 invitations en attente par cercle, 20 reçues par artiste ; corps de requête ≤ 2 Ko ; textes nettoyés (caractères de contrôle et de direction retirés), affichés **comme du texte** (jamais interprétés).

## Interface (`/circles`, menu « Plus » → « Cercles privés »)
Invitations reçues (Accepter / Refuser), mes cercles, création, et un cercle ouvert : membres (propriétaire 👑, Retirer), invitations en attente (Annuler), invitation par recherche de nom dans l'annuaire public (chargé à la demande), messages texte (Actualiser, pas de sondage), Quitter / Supprimer (nom retapé). États explicites : chargement, erreur réseau (Réessayer), pas de profil.

## Impact Redis (aucune activité hors action de l'utilisateur ; aucun sondage)
Lister mes cercles ≈ 2 + 2 par cercle (≤ 22) ; ouvrir un cercle ≈ 2 (+ 1 propriétaire) ; messages : lire 2, publier ≈ 8 ; inviter ≈ 9 ; accepter ≈ 9. À l'échelle d'un usage soutenu (20 artistes × 20 actions/jour ≈ 4 000 commandes/mois) : ~2 % du plan de 200 000. Stockage : ≤ ~25 Ko par cercle plein (50 messages × ~300 o + membres).

## Contrat futur du stockage de médias (NON implémenté ; aucun service choisi, aucune dépendance ajoutée — nouveau GO requis)
Les médias privés exigent un **stockage objet**, pas Redis. Exigences : bucket **privé** ; clé d'objet non devinable ; **téléversement par URL signée à durée courte** délivrée seulement après contrôle d'appartenance au cercle ; **lecture par URL signée courte** (jamais d'URL publique, jamais de CDN public) ; types PNG/JPEG/GIF **vérifiés par signature d'octets** (pas par extension), taille ≤ ~1 Mo, dimensions bornées, ré-encodage côté serveur (retrait des métadonnées EXIF) ; quotas par cercle et par artiste ; suppression en cascade avec le cercle / le retrait du membre ; journal minimal ; TTL ou purge ; coût mensuel estimé AVANT choix. Côté Redis : un index court `circle:{id}:media` (≤ 50 entrées {objectKey, auteur, date, commentaire ≤ 140 car.}), jamais le binaire. Rien d'un média ne devient bloc ni vote.

## Correctif d'audit (26/10/2026) : invitations expirées et concurrence
- **Expiration** : le TTL d'un HASH est renouvelé par chaque nouvelle invitation, il ne purge donc pas une entrée ancienne ; c'est la date `at` de CHAQUE entrée qui fait foi. Une invitation de plus de 30 jours **n'est jamais affichée, ne compte dans aucun plafond** (MAX_PENDING, MAX_MEMBERS, invitations reçues) et est retirée **des deux index** (`circle:{id}:pending` et `circle:invites:{invité}`) par toute lecture qui la rencontre (voir un cercle en tant que propriétaire, inviter, lister mes invitations) et par une réponse tardive (404 + nettoyage des deux côtés). Aucun SCAN ni KEYS ; le nettoyage est borné par les plafonds (≤ 10 attentes, ≤ 20 invitations reçues, entrées périmées comprises). Coût : +2 HDEL par entrée périmée rencontrée (une seule fois).
- **Concurrence** : `inviteArtist` et l'acceptation prennent un **verrou court par cercle** (`lock:circle:{id}`, `SET NX EX 10`, jeton propre, une seule tentative ; occupé → 409 `circle_busy` « réessaie », échec FERMÉ, rien n'est écrit ; libéré dans tous les cas, jamais le verrou d'un autre ; le TTL couvre un plantage). Deux acceptations simultanées à la limite : une entre, l'autre reçoit 409 (testé avec entrelacement forcé, et un témoin sans verrou prouve que le test détecte le dépassement). Libération par **compare-and-delete atomique** (script Lua `GET == jeton ? DEL : 0`, une seule opération Redis) : un verrou expiré puis repris par un autre n'est jamais supprimé par l'ancien détenteur (testé : A expire, B acquiert, A libère tard → B reste verrouillé). Coût : +2 commandes (SET NX, EVAL) par invitation ou acceptation. Les droits et le consentement ne sont pas touchés.
- **Course restante, assumée** : les plafonds PAR ARTISTE (5 cercles possédés, 10 au total) si le MÊME artiste crée ou accepte plusieurs cercles exactement en même temps → dépassement de 1 au pire, sans effet sur les droits. Correctif minimal suivant si nécessaire : un second verrou `lock:circle-artist:{artistId}` pris dans un ordre fixe (cercle puis artiste). Le libellé « Retirer » / « Quitter » n'est pas verrouillé (ils ne font que retirer).
- Smoke test réel (non exécuté) : `docs/SMOKE_TEST_CERCLES_UPSTASH.md`, `scripts/smoke-circles.mjs`.

## Limites connues
- Pas de liste de blocage : un artiste peut être réinvité par un autre propriétaire (limites de débit et plafond de 20 invitations reçues, refus immédiat) ; pas de transfert de propriété (le propriétaire supprime ou garde) ; pas de renommage de cercle.
- Les noms de membres sont ceux **de l'adhésion** (un renommage de profil n'est pas répercuté) ; les messages gardent le nom d'auteur au moment de l'écriture, même après son départ.
- La session identifie un profil, pas une personne : un profil appairé sur plusieurs équipements les partage tous.
- Non essayé en production (Redis non disponible dans l'environnement de développement) : logique testée en mémoire (15 tests) et interface vérifiée avec des réponses simulées ; routes à essayer avec deux profils réels.
