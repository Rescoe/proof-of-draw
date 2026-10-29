# Audit du plan de chantier UX

Date : 29 octobre 2026
Plan audité : `docs/PLAN_CHANTIER_UX_2026_10_29.md`
Code de référence du plan : `origin/main` `f2e2222`
Verdict : **GO conditionnel**, après intégration des corrections P0/P1 ci-dessous dans le plan.

## 1. Verdict général

Le plan reprend correctement les deux audits, distingue les constats confirmés des points déjà corrigés et respecte le périmètre : aucun changement du consensus, des firmwares, de l’OTA ou du schéma Redis.

Les points suivants sont particulièrement solides :

- travail par lots réversibles ;
- téléphone prioritaire ;
- navigation sémantique ;
- accueil sans répétition des affichages ni double journal ;
- activité des artistes bornée et dérivée du snapshot existant ;
- une seule lecture de mesures et une seule période ;
- maintien des niveaux qualitatifs du SGP40 sans afficher son indice brut ;
- matrice transformée en cartes sur téléphone ;
- conservation du remix, des animations de constellation, de l’OLED auxiliaire et des interrupteurs d’œuvres fixes ;
- tests de viewports séparés de la suite hôte actuelle.

Le chantier peut commencer une fois les points suivants corrigés dans le plan.

## 2. Corrections obligatoires

### P0 — capacité d’animation : ne pas se fier au seul écran

Le lot `/draw` propose d’afficher `Animer` si l’écran figure dans `lib/bench/screens.ts`. Ce critère est insuffisant : un écran compatible physiquement peut être porté par un firmware ancien ou sans la capacité nécessaire.

La source de vérité doit être la même que pour la diffusion réelle : `animCapable` et les capacités déclarées/déduites du firmware. Il faut donc :

1. exposer dans les réponses privées et publiques une capacité minimale, par exemple `canAnimate` par écran, calculée côté serveur depuis le firmware, les écrans et les caps ;
2. étendre `DrawTarget` avec cette capacité ;
3. n’afficher `Animer` que lorsque cette capacité est vraie ;
4. conserver une validation dans l’atelier `/animer` : l’interface ne constitue jamais une autorisation suffisante ;
5. tester écran compatible + firmware ancien, écran compatible + firmware récent, OLED auxiliaire et écran non compatible.

Ne pas dupliquer une nouvelle table de versions dans `DrawChoice`.

### P1 — accueil : ne pas juxtaposer deux listes d’artistes

Le plan ajoute `Artistes actifs` mais conserve `RecentArtists` juste après les œuvres au motif de ne rien supprimer. Cela risque de recréer la redondance que le chantier cherche à enlever.

Recommandation : une seule section **Artistes du réseau**, bornée, avec :

- vue principale `Actifs maintenant` ;
- éventuellement un petit lien ou sous-état `Nouveaux artistes` si cette information reste utile ;
- lien vers l’annuaire complet.

Le contenu n’est pas supprimé : il est fusionné dans une présentation unique. Ne pas afficher deux carrousels/listes presque identiques sur l’accueil.

### P1 — variante `NetworkMap surface="home"`

Masquer le terminal ne suffit pas si sa colonne reste réservée. En mode accueil :

- sans sélection, la constellation occupe toute la largeur ;
- avec sélection, le panneau détail apparaît à droite sur grand écran et sous la carte sur tablette/mobile ;
- aucune colonne vide ne subsiste ;
- aucun terminal ni `LiveDisplaysSection` n’est rendu ;
- les miniatures nécessaires aux nœuds et les boucles d’animation sont conservées.

Les tests doivent vérifier la structure de grille, pas seulement l’absence des chaînes `terminal` ou `ld-`.

### P1 — CTA « Connecter un appareil »

La destination ne doit pas rester formulée comme « Mon espace / parcours d’installation » dans le plan. Il faut choisir un comportement déterministe.

Recommandation : le CTA d’accueil mène au parcours `/learn?path=install#installer`, qui explique l’installation puis l’association. Dans Mon espace, l’action d’un utilisateur déjà équipé s’appelle `Associer un appareil` et mène à `/onboard`.

Ainsi :

- **Installer un appareil** = préparer/flasher/configurer le matériel ;
- **Associer un appareil** = rattacher un appareil déjà prêt au profil ;
- **Configurer le Wi-Fi** = portail local du matériel ;
- `Onboard` n’est jamais un libellé public.

### P1 — hook de mesures

Le cache en mémoire de session doit :

- dédupliquer les requêtes simultanées avec une Promise partagée ;
- utiliser une clé incluant `deviceId` et `owner/public` ;
- avoir une expiration mesurable ;
- permettre un rechargement explicite qui invalide la clé ;
- annuler proprement ou ignorer le résultat après démontage ;
- ne jamais partager une réponse privée avec un appel public.

Commencer par unifier le chargement et la période tout en gardant les deux moteurs de tracé. L’extraction de `ChartCore` vient ensuite : elle ne doit pas bloquer la correction immédiate du double fetch.

### P2 — performance des artistes actifs

Tester une sortie bornée avec 5 000 appareils est utile. Éviter en revanche une assertion chronométrique stricte en CI, trop dépendante de la machine. Tester la complexité de manière structurelle et mesurer le temps seulement comme information non bloquante.

## 3. Décisions validées

### Décision 1 — libellés

**Validé :**

```text
Accueil · Galerie · Créer une œuvre · Réseau · Communauté · Apprendre · Mon espace
```

- `Créer une œuvre` reçoit le traitement de CTA principal.
- `Communauté` regroupe Artistes et Cercles privés.
- `Mon espace` regroupe profil, appareils, écrans, capteurs et association.
- Animations et créations IA restent des vues de la Galerie.

### Décision 2 — hamburger

**Validé à 1024 px.**

À `1024 px` exactement, privilégier la navigation compacte si la barre complète ne tient pas avec le zoom et les libellés français. Le critère d’acceptation est l’absence totale de retour à la ligne, pas seulement la valeur du breakpoint.

### Décision 3 — journal d’accueil

**Conserver `EspActivityFeed`.**

Il est plus lisible et éditorial pour l’accueil. Le terminal technique reste sur `/network`. En mode accueil, aucun terminal caché ne doit conserver sa colonne.

### Décision 4 — Playwright

**Oui, comme dépendance de développement et suite séparée.**

- script séparé `test:ui` ;
- ne pas l’intégrer à `npm test` ;
- ne pas télécharger/lancer les navigateurs pendant le build Vercel ;
- fixtures déterministes ;
- captures et traces en artefacts ignorés par Git sauf références choisies ;
- commencer par Chromium, puis étendre si nécessaire.

### Décision 5 — snapshot réseau borné

**Lot séparé validé, non bloquant pour les premiers lots UX.**

Il doit néanmoins être inscrit dans la roadmap proche avant toute promesse de support de 10 000 appareils. L’accueil actuel peut être réorganisé sans nouvelle lecture Redis, mais cela ne rend pas le snapshot complet scalable.

### Décision 6 — remplacement de « Onboard »

Utiliser **`Associer un appareil`** pour l’action et **`page d’association`** uniquement dans une phrase documentaire.

Éviter `Connecter` lorsque l’action ne configure ni l’USB ni le Wi-Fi. Conserver une distinction stable entre installer, configurer le Wi-Fi et associer au profil.

## 4. Ajustement de l’ordre d’exécution

Le plan contient 17 commits, ce qui est acceptable si Claude travaille par étapes. Pour piloter le chantier, les regrouper en cinq jalons auditables :

1. **Navigation et vocabulaire** — commits 1 à 5 ;
2. **Accueil** — commits 6 à 8, avec fusion des deux listes d’artistes ;
3. **Créer et responsive principal** — commits 9, 14 et 15 selon dépendances ;
4. **Mesures** — chargement/période d’abord, tracé commun ensuite ;
5. **Modales, accessibilité et Playwright** — commits 13, 16 et retour documentaire.

Après chaque jalon : type-check, tests ciblés, suite complète comparée au socle, captures téléphone/tablette/desktop et audit Codex avant le jalon suivant.

## 5. GO proposé

Après mise à jour du plan avec les corrections P0/P1 :

- GO pour le jalon 1 Navigation et vocabulaire ;
- pas de modification des firmwares, OTA, consensus ou Redis ;
- pas de déploiement automatique avant captures et audit du jalon ;
- conserver le travail utilisateur présent dans le dépôt ;
- documenter les écarts entre le plan et l’implémentation réelle.
