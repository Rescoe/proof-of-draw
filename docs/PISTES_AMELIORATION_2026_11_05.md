# Pistes d'amélioration — note ciblée (05/11/2026)

Note de réflexion, **aucun code modifié**. Part de l'état de `main` après les lots UX 1–5 (Remix, capteurs, Apprendre, cercles, correctifs de verrou). Chaque piste : pourquoi, taille (S ≤ ½ j, M ≈ 1–2 j, L > 2 j), risque.

## A. À faire d'abord (valident ce qui est déjà livré)
1. **Smoke test réel des cercles à deux profils** (S) — `scripts/smoke-circles.mjs`. Le script Lua de libération de verrou et le verrou lui-même n'ont jamais tourné sur un vrai Upstash. Rien d'autre sur les cercles avant ce résultat.
2. **Essai du Remix avec un vrai vote** (S) — un bloc dérivé miné de bout en bout : vérifier `derivedFromBlockHash` dans le hash, `node scripts/verify-block.ts` sur le bloc, « Remix du bloc #N » en galerie. Le roadmap le dit « en cours » tant que ce n'est pas fait.
3. **Réconcilier le statut OTA R4** (S, documentaire) — attend les preuves de l'autre session (profils des deux R4, commits, releases/manifestes, journaux, vote après OTA) ; ensuite seulement matrice, README, page Installer.
4. **Les 70 échecs préexistants** (M) — 66 viennent du compilateur C++ absent de l'environnement cloud (tests de firmware) : les marquer « ignoré faute de toolchain » avec une cause explicite, ou fournir la toolchain à la session, pour qu'un vrai rouge ne se noie plus dans le bruit. Corriger à part les 4 de `hardwareMatrix` et le harnais DHT22 (n° 9 de la liste de suivi).

## B. Consolidation technique (faible risque)
5. **Un seul calcul du hash de bloc** (M) — il existe en quatre exemplaires TypeScript (`finalizeBlock`, `blockCanonicalV2`, `podVerify`, `podVerifyAnim`) plus le miroir C++. Un module unique « canonique » + vecteurs d'or partagés évite qu'une future clé optionnelle (comme `derivedFromBlockHash`) soit oubliée quelque part. Prérequis avant tout nouveau champ de bloc.
6. **C++ `consensusPoD.h` : clé `derivedFromBlockHash`** (S) — à ajouter avec ses vecteurs avant qu'un firmware recalcule un hash de bloc ; sans effet tant qu'aucun appareil ne le fait.
7. **Test d'intégration serveur avec un Redis simulé** (M) — un faux `@upstash/redis` en mémoire (get/set/hash/list/eval) permettrait de tester les vraies routes `/api/circles/**`, `/api/draw` + Remix, sans réseau. Aujourd'hui la logique est testée en mémoire mais pas les routes ni les adaptateurs.
8. **Build en CI hors Redis** (S) — `next build` échoue au prérendu de `/` sans variables Upstash ; rendre `/` tolérant (ou dynamique) pour pouvoir compiler en CI et détecter les erreurs de build avant le déploiement.

## C. Produit (par valeur décroissante)
9. **Cercles : liste de blocage et transfert de propriété** (M) — aujourd'hui un artiste ne peut pas refuser durablement un propriétaire, et un propriétaire ne peut que supprimer. Un « ne plus m'inviter » (set court par artiste, TTL long) + « passer le cercle à un membre » ferment les deux manques les plus visibles.
10. **Cercles : partage d'images** (L, GO requis) — contrat déjà écrit (stockage objet privé, URL signées courtes, signature d'octets, ré-encodage sans EXIF, quotas). À lancer seulement après choix du service et estimation de coût ; jamais dans Redis.
11. **Remix : animations et autre type d'écran** (L) — aujourd'hui images fixes, même type d'écran. Pistes : conversion contrôlée entre écrans (réduction avec aperçu avant envoi), puis remix d'animation (image par image) quand le lot 8 d'animations calculées existera.
12. **Remix : arbre de filiation** (M) — page « descendance » d'un bloc (qui l'a remixé), sans nouvelle clé : une recherche dans la chaîne par `derivedFromBlockHash`, mise en cache par le CDN. Rend le Remix visible comme pratique collective.
13. **Capteurs : œuvre partageable** (M) — exporter l'œuvre du jour/semaine en image (PNG côté navigateur, titre + capteur + artiste + période) sans toucher aux données ; option « envoyer sur mon écran » via la frame personnelle existante.
14. **Mes écrans : « dernière œuvre » par appareil** (S) — un seul appel déjà existant (`/api/my-devices/displays`) lu à l'ouverture de la liste, 1 commande Redis ; complète la séparation utiliser / gérer / maintenance.
15. **Apprendre : suivre la lecture** (S) — retenir (en local, sans compte) les sujets ouverts et proposer « reprendre » ; indexer mot à mot le texte des guides d'installation (aujourd'hui seuls titres, résumés, mots-clés).

## D. Qualité d'usage
16. **Accessibilité** (M) — passe clavier + lecteur d'écran sur `/draw`, `/circles`, l'explorateur de mesures (les disques et étoiles ont déjà `tabIndex` et libellés ; vérifier ordre de tabulation, contrastes en mode clair, annonces `aria-live`).
17. **Anglais** (M) — le README a un résumé anglais, l'interface est française seule ; un fichier de libellés par page (pas de framework) permettrait d'ouvrir le projet sans réécriture.
18. **Quotas Redis : tableau de bord interne** (S) — compter les commandes par route (déjà documentées une à une) dans un récapitulatif unique pour vérifier le budget de 200 000/mois quand les cercles et le Remix seront utilisés.

## Ordre proposé
`1 → 2 → 3` (preuves) · `8 → 7 → 5 → 6` (consolidation) · `14 → 9 → 12` (valeur visible, faible coût) · `13`, `16` · puis `10` et `11` seulement avec GO (coût, firmware, consensus).

## Ce que je ne recommande pas pour l'instant
Messagerie en temps réel dans les cercles (sondage = quota Redis), médias dans Redis, nouvelle version de règles de consensus pour la filiation (la déclaration serveur engagée dans le hash suffit à ce stade), refonte visuelle globale.
