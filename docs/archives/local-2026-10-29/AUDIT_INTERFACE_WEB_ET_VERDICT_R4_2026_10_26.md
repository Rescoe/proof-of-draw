# Audit interface web et vérification R4 — préparation des sessions cloud

**Date :** 26 octobre 2026
**Destinataires :** porteur du projet et Claude / agents cloud
**Nature :** audit de lecture seule ; aucun code, appareil, port série, secret, déploiement ou donnée distante n'a été modifié.

## 1. Résumé de décision

Le site possède déjà les fonctions d'un vrai produit : création, envoi, galerie, réseau vivant, artistes, profils, écrans, capteurs, appairage et documentation. La prochaine étape UI ne doit donc pas être « ajouter des pages ». Elle doit rendre les **trois parcours humains** immédiatement compréhensibles :

1. **Je crée une œuvre** ;
2. **Je découvre ce que le réseau a produit** ;
3. **Je branche et je gère mon écran**.

Les sessions cloud peuvent tout à fait améliorer cette interface, à condition de partir de cette contrainte : elles ne doivent ni refaire l'application, ni modifier le consensus, ni toucher aux routes de firmware, ni simplifier les protections de gestion d'appareil.

### Verdict R4

Il faut corriger précisément l'affirmation « l'OTA R4 est terminée » au regard de l'état Git audité :

| Niveau | Verdict |
|---|---|
| Vote, affichage et ACK R4 BWR | **Oui, prouvés** sur matériel. |
| Portail Wi-Fi R4 BWR | **Oui, prouvé** : AP, formulaire, enregistrement, redémarrage, connexion, `register` et vote observés. |
| Mécanique OTA R4 de laboratoire | **Oui, prouvée** : banc A→B→A, conservation programme/données, port PC fermé durant la reprogrammation. |
| OTA R4 applicative signée, intégrée à un firmware PoD, distribuée par le serveur et validée sur carte | **Non démontrée dans les sources, releases et documents actuellement accessibles.** |

La distinction est importante : le banc R4 a prouvé qu'une R4 peut être reprogrammée par Wi-Fi. Il n'a pas encore prouvé qu'un profil R4 PoD en production reçoit, authentifie, installe, redémarre, confirme sa santé et vote après une release applicative signée, comme les canaris ESP8266.

Si un lot R4 plus récent vient d'être terminé dans une autre session, il doit fournir au minimum :

- commit ou PR intégrable ;
- famille R4 ajoutée explicitement au registre de distribution ;
- manifeste/release et empreintes ;
- journal matériel A→B avec identité, Wi-Fi, données flash, vote/frame/ACK post-installation ;
- mise à jour de la matrice.

En l'absence de ces cinq preuves, l'interface ne doit jamais promettre « mises à jour à distance » pour une UNO R4.

---

## 2. Périmètre réellement observé

### Sources et état Git

- `origin/main` est à `ea39438` au moment de l'audit ; la branche locale d'audit est toujours profondément divergente (`claude/ota-1-manifest-contract`, +142/-101 au relevé).
- Les travaux R4 récents sur `origin/main` concernent le portail BWR et le TFT 2,8, les votes, les affichages et les profils matériels ; ils ne changent pas la table de distribution OTA.
- `lib/otaDistribution.ts` ne reconnaît que les familles `tft18`, `eink29bwr` et `multiscreen`. Aucune famille `r4*` n'est éligible.
- `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` et `app/learn/data/installProfiles.ts` disent toutes deux qu'il n'y a pas d'OTA pour les profils UNO R4.

### Limite de l'audit visuel

L'outil de navigation visuelle n'a pas pu s'initialiser et l'URL Vercel n'était pas accessible par le lecteur web de cette session. Cet audit est donc une analyse poussée des sources, des routes, des composants, des styles et des parcours déclarés ; il **ne prétend pas** avoir validé le rendu de production pixel par pixel.

Avant toute fusion UI, un humain doit donc faire un passage visuel sur téléphone et bureau avec la grille de recette § 8.

---

## 3. Inventaire : ce qui existe déjà et doit être préservé

| Domaine | Éléments existants | Valeur produit |
|---|---|---|
| Création | studio de dessin, modèles, outils, annulation, brouillons, aperçu de l'écran cible, flux d'envoi en trois étapes | cœur artistique solide ; le preview avant envoi est une excellente protection contre les surprises e-ink/TFT |
| Envoi | titre, aperçus, avertissements de cartel, taille, cooldown, erreurs et conservation du dessin | très bon retour utilisateur ; ne pas réduire ce flux en un bouton brut |
| Découverte | galerie complète, recherche, filtres, œuvres rejetées consultables, pages artistes, galerie IA/animations | matière culturelle riche |
| Réseau | carte topologique, modes de vue, terminal/journal, écrans en direct, états de présence | différenciation forte de PoD |
| Gestion propriétaire | profil artiste, appairage multi-navigateurs, écrans, écrans partagés, renommage, transfert/fusion, suppression protégée, mesures | socle sérieux pour un réseau d'appareils réels |
| Première connexion | portail firmware, QR, page `/onboard`, avertissement navigateur intégré, guide d'installation | parcours déjà nettement meilleur qu'un projet Arduino standard |
| Documentation | guide matériel, profils, câblages, résumé réseau, matrice de compatibilité | la complexité technique existe déjà sous forme consultable |

Le site n'a pas un problème de manque de fonctionnalités. Il a un problème de **hiérarchie, de vocabulaire et de focalisation**.

---

## 4. Diagnostic UX : problèmes prioritaires

### P0 — la navigation « Dessiner » ne dessine pas

La navigation principale et la documentation pointent vers `/draw`, mais `app/draw/page.tsx` redirige immédiatement vers `/profile`.

Conséquences :

- un visiteur clique « Dessiner » et arrive dans une zone de gestion personnelle ;
- le bouton « Dessiner maintenant » de la documentation fait la même chose ;
- le projet explique qu'on peut participer sans matériel, mais l'action principale ne l'exprime pas ;
- le flux réel (choisir son appareil, un écran public ou un écran personnel, puis ouvrir `/draw/[device]/[screen]`) est caché.

**Décision UI à prendre avant toute retouche graphique :**

- soit `/draw` devient la page de choix « Où veux-tu dessiner ? » (mes écrans / écrans partagés / explication sans matériel) ;
- soit tous les liens et libellés sont renommés honnêtement : « Mes écrans » ou « Choisir un écran », jamais « Dessiner ».

La première option est recommandée : elle ne change pas le moteur de dessin et rend immédiatement le parcours cohérent.

### P0 — huit destinations de premier niveau, sans hiérarchie

La navigation expose aujourd'hui : `Accueil`, `Dessiner`, `Explorer`, `Agents IA`, `Artistes`, `Apprendre`, `Mon profil`, `+ Onboard`.

Problèmes :

- `+ Onboard` est du jargon interne pour une étape rare, non une destination quotidienne ;
- `Agents IA` a la même importance que créer ou gérer un écran, alors que c'est un sous-univers ;
- `Explorer` masque la galerie ;
- `Réseau`, pourtant central et présent dans le README, n'est pas une destination principale ;
- la navigation ne sépare pas « public », « création » et « propriétaire d'écran ».

**Information architecture recommandée :**

```text
Logo
Créer                 → /draw (choix d'écran puis studio)
Découvrir             → galerie, artistes, réseau, IA/animations (menu secondaire)
Mes écrans            → /profile
Installer un écran    → /learn?path=install
```

Sur mobile : les quatre mêmes intentions, dans cet ordre. `Onboard` doit apparaître comme une action contextuelle après scan QR ou dans « Mes écrans », pas comme un terme à apprendre avant d'avoir un écran.

### P1 — l'accueil montre le système avant l'intention humaine

La page d'accueil ouvre directement sur carte réseau, activité, galerie et artistes. C'est intéressant pour une personne déjà convaincue, mais il manque une réponse immédiate aux trois questions d'un nouveau visiteur :

- Que puis-je faire ici maintenant ?
- Ai-je besoin d'un écran ?
- Que devient mon dessin ?

**Recommandation :** garder la carte réseau comme preuve vivante, mais la placer après un bloc d'orientation très court avec trois cartes-action :

1. « Créer une œuvre » ;
2. « Voir les œuvres et les écrans » ;
3. « Connecter mon écran ».

Ne pas ajouter de marketing vide. Trois phrases, des actions, puis le réseau réel.

### P1 — mélange de langage utilisateur et de langage de laboratoire

Le produit utilise alternativement : ESP, écran, appareil, device, pool, bloc, ACK, candidat, onboarding, OTA, réseau, artiste. C'est normal dans le code, mais fatigant à l'interface.

Règle éditoriale recommandée :

| Utilisateur voit | Terme technique réservé au détail |
|---|---|
| écran | ESP / UNO R4 / deviceId |
| œuvre en attente de validation | candidat |
| reçu d'affichage | ACK |
| mise à jour du logiciel | OTA |
| mes écrans | appareils / matériel |
| connecter un écran | onboard / pair code |

Les détails techniques doivent rester accessibles par une ligne « Voir les détails techniques », jamais être supprimés.

### P1 — profil propriétaire très riche, mais trop dense

`app/profile/page.tsx` fait environ 1 000 lignes et `DevicesPanel.tsx` environ 600. L'utilisateur y trouve des actions courantes (dessiner, nommer, voir l'état) à côté d'actions rares ou dangereuses (rotation de code, transfert, fusion, don, suppression).

**Objectif UI :** faire émerger trois couches visuelles, sans modifier les APIs :

1. **Utiliser** : dessiner, voir l'écran, statut en ligne ;
2. **Gérer** : nom, partage, mesures, appairage ;
3. **Maintenance avancée** : transfert, fusion, don, suppression, diagnostics.

Les actions irréversibles sont déjà protégées par confirmation : conserver cette protection. Le travail cloud doit seulement rendre la couche avancée repliée et explicitement nommée.

### P1 — erreurs réseau silencieuses ou confondues avec « aucun contenu »

L'audit a relevé de nombreux `catch { ... }` dans des composants client, notamment des cas qui remplacent l'état par une liste vide. Pour l'utilisateur, « aucun écran », « aucune œuvre » et « le réseau a échoué » deviennent visuellement semblables.

À corriger dans un lot dédié UX :

- états `chargement`, `vide`, `erreur`, `hors-ligne` distincts ;
- bouton « Réessayer » lorsque la requête a échoué ;
- ne jamais effacer des données précédemment affichées à cause d'un échec de polling ;
- message utilisateur court, détail technique replié.

### P2 — cohérence visuelle et dette de présentation

L'audit source recense 78 fichiers TSX, 49 composants client, 46 fichiers utilisant beaucoup de styles inline, et un `globals.css` de 1 262 lignes. Le résultat peut être joli, mais il devient coûteux à faire évoluer : des réglages identiques sont réécrits dans des pages différentes.

Il ne faut pas lancer une grande réécriture CSS. La stratégie raisonnable est :

- conserver les variables de thème existantes ;
- créer seulement quelques primitives réutilisables (`PageHeader`, `ActionCard`, `StatusBadge`, `EmptyState`, `ErrorState`, `Section`, `DangerZone`) ;
- migrer d'abord les nouvelles modifications vers elles ;
- ne toucher aux anciens styles inline qu'au passage d'un écran concerné.

### P2 — accessibilité et recette mobile à formaliser

Points positifs : nombreux `aria-label`, états pressés, fermeture Escape du menu, verrouillage du défilement et dialogues nommés.

Points à vérifier réellement dans le navigateur :

- focus bloqué dans les modales et le drawer mobile ;
- focus visible partout ;
- ordre Tab logique dans le studio ;
- taille tactile >= 44 px pour les actions principales ;
- textes/contrastes du terminal, chips et métadonnées ;
- taille/scroll de la topologie et du studio à 320–390 px ;
- lecteur d'écran pour états réseau et erreurs ;
- respect de `prefers-reduced-motion` pour les cartes/animations.

Il n'y a pas de preuve d'un test automatisé d'accessibilité ou de tests visuels Playwright/Lighthouse dans la source audité. C'est une lacune de contrôle, pas une condamnation de l'UI actuelle.

---

## 5. Parcours cible à préserver puis clarifier

### A. Visiteur sans matériel

```text
Accueil → Créer une œuvre → choisir un écran partagé → studio → aperçu → envoi
                                              ↓
                                        Galerie / artistes / réseau
```

La page de choix doit dire sans ambiguïté si aucun écran partagé n'est disponible et proposer dans ce cas « Explorer la galerie » ou « Installer mon propre écran », sans présenter une erreur réseau comme une absence normale.

### B. Nouveau propriétaire d'écran

```text
Flash initial → portail Wi-Fi de l'écran → QR PoD → Connecter mon écran
→ nom d'artiste → Mes écrans → premier dessin
```

Le langage à retenir est « Connecter mon écran », pas `Onboard`. Le QR reste le chemin principal ; MAC/moniteur série restent un secours avancé, pas une option mise au même niveau au premier regard.

### C. Propriétaire régulier

```text
Mes écrans → statut + dernière œuvre → Dessiner / gérer → éventuellement maintenance avancée
```

Les statistiques, capteurs et mises à jour futures doivent s'insérer dans ce parcours, pas créer une nouvelle destination globale.

---

## 6. Plan recommandé pour les sessions cloud UI

### Session 1 — architecture et parcours, sans esthétique cosmétique

**But :** supprimer les impasses et clarifier les rôles, sans modifier les routes API ni le firmware.

Livrables :

1. proposition de navigation réduite ;
2. spécification de `/draw` comme sélecteur d'écran (ou décision documentée de le renommer) ;
3. wireframes légers des parcours A/B/C ;
4. liste précise de libellés à remplacer (`Onboard`, `device`, `ACK`, etc.) ;
5. critères d'acceptation mobile/bureau.

**Interdits :** pas de refonte globale, pas de changement de consensus, pas de changement de modèle Redis, pas de promesse OTA supplémentaire, pas de suppression des garde-fous de profil.

### Session 2 — shell et pages prioritaires

Ordre d'implémentation :

1. navigation + accueil ;
2. sélection d'écran `/draw` ;
3. profil/mes écrans : séparation utiliser/gérer/maintenance ;
4. onboard : wording et aide de secours ;
5. états vides/erreurs communs.

Ne pas ouvrir galerie, réseau, IA, animations et documentation dans le même lot : ils doivent seulement être correctement reliés.

### Session 3 — finition et contrôle

- validation manuelle des tailles 320, 375, 768, 1024, 1440 px ;
- clavier, focus, contraste et absence de scroll horizontal ;
- état données vides et erreur réseau ;
- vérification que dessin, envoi, appairage, transfert et suppression conservent les mêmes appels API ;
- captures avant/après pour revue humaine.

---

## 7. Règles de vérité pour l'interface matérielle

L'installer, le profil et les pages de gestion doivent être pilotés par la matrice matérielle, jamais par une intuition ou une réussite voisine.

| Statut matrice | Ce que l'interface peut dire |
|---|---|
| `C` | « Compilation vérifiée », jamais « compatible ». |
| `M` / `P` | « Installation filaire expérimentale », jamais OTA. |
| `V2` | « Vote et affichage observés », OTA seulement si la ligne l'indique. |
| `OTA` | « Mise à jour à distance validée pour ce profil/canari », avec limites connues. |
| `EXP` | hors parcours public normal ou étiqueté laboratoire. |

À la date de l'audit, les R4 doivent donc afficher leur niveau réel : matériel/vote/portail selon profil, **pas d'OTA applicative distribuée**.

---

## 8. Grille de recette humaine avant fusion d'un lot UI

### Mobile

- Navigation utilisable à une main ; aucune ligne essentielle coupée.
- Visiteur comprend en moins de 20 secondes comment dessiner sans posséder d'écran.
- Le scan QR aboutit à « Connecter mon écran » avec un secours lisible.
- Aucune action destructive n'est visible ou atteignable par erreur.
- Le studio reste utilisable en portrait et en paysage.

### Bureau

- La hiérarchie Accueil → Créer / Découvrir / Mes écrans est évidente.
- La topologie et les journaux restent une preuve vivante mais ne bloquent pas l'action principale.
- Les écrans privés et partagés se distinguent sans jargon.
- Les erreurs API sont distinguées des listes vides.

### Fonctionnel

- Dessin → preview → envoi inchangé ; cooldown et brouillon inchangés.
- Onboard QR, code manuel et avertissement navigateur intégré inchangés.
- Gestion d'écran : renommage, partage, transfert, fusion, don et suppression conservent leurs confirmations.
- Aucun changement de route serveur, de Redis, de vote, d'OTA ou de firmware sans lot explicite séparé.

---

## 9. Conclusion

Le site est prêt pour un chantier d'interface ambitieux parce que son socle fonctionnel est déjà riche. La bonne stratégie n'est pas de le rendre « plus tech » : il faut le rendre plus immédiatement humain, puis laisser la profondeur technique apparaître à la demande.

La première victoire UI à viser est simple et mesurable : un nouveau visiteur doit savoir où dessiner ; un propriétaire doit savoir où gérer son écran ; un curieux doit pouvoir explorer le réseau — sans apprendre le vocabulaire interne du projet.

Concernant la R4 : excellente progression sur le matériel, le portail et le vote. Mais dans l'état Git audité, l'OTA applicative R4 n'est pas encore un acquis à afficher ou à distribuer. La vérifier est un lot matériel/sécurité distinct ; elle ne doit pas bloquer le travail UI, mais elle ne doit pas être masquée par celui-ci.
