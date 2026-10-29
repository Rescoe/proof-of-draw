# Inventaire local à préserver — 29/10/2026

Cet inventaire décrit le checkout historique de l'ancien PC. Il sert à éviter une perte lors du passage à un second ordinateur. Il ne constitue ni une liste de fichiers à fusionner en bloc, ni une autorisation de publier des données privées.

## Checkout historique

- chemin : `C:\Users\thibf\Documents\App-Rescoe\proof-of-draw` ;
- branche observée : `claude/ota-1-manifest-contract` ;
- HEAD observé : `8dbcee4` ;
- divergence observée : 142 commits locaux et 170 commits de retard par rapport à `origin/main` ;
- état : fichiers suivis modifiés et fichiers non suivis ; ne pas réinitialiser, nettoyer ou fusionner globalement.

## Chantier actif séparé

Le worktree `claude/multibwr-migration`, créé depuis `origin/main` à `ed441d8`, contenait 14 modifications non commitées au moment de l'audit. Il appartient au chantier multiscreen BWR + OLED + DHT22 en cours. Sa livraison doit être commitée et poussée par son auteur avant toute opération de nettoyage.

## Notes locales à trier

Les fichiers suivants existaient seulement dans le checkout historique au moment de l'audit. Une copie a été placée dans `docs/archives/local-2026-10-29/` après recherche de secrets usuels. Les originaux restent à conserver jusqu'à validation du clone neuf :

- `docs/AUDIT_GLOBAL_REPRISE_CLAUDE_2026_10_25.md` ;
- `docs/AUDIT_INTERFACE_WEB_ET_VERDICT_R4_2026_10_26.md` ;
- `docs/AUDIT_PLAN_CHANTIER_UX_2026_10_29.md` ;
- `docs/AUDIT_UX_NAVIGATION_ACCUEIL_2026_10_29.md` ;
- `docs/AUDIT_UX_RESPONSIVE_COMPOSANTS_2026_10_29.md` ;
- `docs/DIAGNOSTIC_TFT18_OTA_2_9_VERS_2_10_2026_10_26.md` ;
- `docs/LIVRAISON_UX_JALON1_2026_10_29.md` ;
- `docs/PLAN_CHANTIER_UX_2026_10_29.md` ;
- `docs/POINT_OTA_INTERNET_2026_10_21_G4_G5.md` ;
- `docs/SECURITE_OTA_CONSENTEMENT_PROPRIETAIRE_2026_10_23.md` ;
- `docs/VISION_LONG_TERME_OEUVRE_RESEAU_APRES_FXHASH_2026_10_13.md` ;
- anciens prompts de passation et d'audit.

`docs/MATRICE_COMPATIBILITE_MATERIELLE.md` apparaît non suivi dans cet ancien checkout parce que sa branche est ancienne. Ne jamais remplacer la version plus récente de `origin/main` par cette copie.

## Artefacts locaux privés ou à vérifier

- `docs/captures/` ;
- `docs/mesures/REPRISE_WIFI_2026_10_18/` ;
- `firmware-backups/2026-10-24_avant-chaines-en-flash/` ;
- plusieurs fichiers `BWR-OTA-*-BUILD-PIN.json` ;
- deux anciens répertoires de release `eink29bwr-2.10-ota10` et `eink29bwr-2.11-ota11`.

Les deux anciens répertoires de release ont été comparés aux versions déjà présentes sur `origin/main` et étaient identiques lors de l'audit. Les autres artefacts doivent rester hors Git public tant qu'ils n'ont pas été nettoyés et vérifiés. Les dumps de flash, secrets, identifiants Wi-Fi, clés privées, cookies et journaux bruts ne doivent jamais être publiés.

## Worktrees

De nombreux worktrees historiques restent attachés, dont certains sont très anciens et un est marqué `prunable`. Aucune suppression n'a été effectuée. Après livraison du chantier actif et validation d'un clone neuf :

1. vérifier chaque worktree avec `git status` ;
2. pousser les commits réellement uniques sur une branche d'archive nommée ;
3. sauvegarder à part les artefacts privés ;
4. archiver ou retirer seulement les worktrees propres et confirmés inutiles ;
5. ne jamais lancer un nettoyage récursif fondé sur une variable de chemin non validée.

## Critère de fin de migration vers le nouveau PC

La migration est considérée sûre lorsque :

- `main` contient la documentation canonique ;
- le chantier multiscreen actif est poussé ;
- un clone neuf peut installer les dépendances, passer le type-check et retrouver les profils publics ;
- les secrets sont recréés localement depuis des exemples, jamais copiés dans Git ;
- l'ancien PC est conservé jusqu'à comparaison des fichiers privés et des branches d'archive.
