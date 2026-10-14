# Reprise Claude locale — Proof-of-Draw — 12 octobre 2026

## Mission immédiate

Reprendre le lot TFT 2,8″ **sans repartir de `main` et sans réécrire les travaux validés**. Le premier objectif est de relire l'audit GPT, vérifier l'environnement local, puis accompagner un unique canari matériel de l'animation en flux. Le stockage distribué sur SD reste un chantier documentaire séparé tant que ce canari n'est pas vert.

## Point de départ exact

- worktree : `C:\Users\thibf\Documents\ChatGPT\ANA\worktrees\proof-of-draw-claude-local-resume`
- branche : `codex/claude-local-resume-2026-10-12`
- HEAD attendu après préparation : commit documentaire postérieur à `f8657d8`
- code firmware à auditer : `480eacd`
- production : `main = origin/main = 3239d2e`

Au début de la session :

```powershell
git status --short --branch
git log -5 --oneline
git diff --check 3239d2e..HEAD
```

Si le worktree n'est pas propre ou si `480eacd` n'est pas ancêtre de `HEAD`, arrêter et signaler l'écart. Ne pas utiliser `git reset --hard`.

## Lecture obligatoire, dans cet ordre

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/HANDOFF_CLAUDE_LOCAL_2026_10_12.md`
4. `docs/ETAT_BRANCHES_LOTS_8B_2026_10_12.md`
5. `docs/AUDIT_GPT_480EACD_ANIM_STREAM_PRELIMINAIRE_2026_10_12.md`
6. `docs/LOT_8B2E_ANIM_STREAM_FIX1_2026_10_13.md`
7. `docs/LOT_8B2D_R4_TFT28_CANARY_2026_10_12.md` et ses sections FIX1/FIX2 si le nom exact diffère, puis `docs/mesures/8B2D_2026_10_12/`
8. `arduino_uno_r4/pod_uno_r4/pod_bench_stream.h`
9. les fonctions animation/SD du fichier `arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino`
10. `tests/animStream.test.ts`, `tests/tft28AnimStream.test.ts` et la partie animation de `tests/tft28Host.test.ts`
11. `docs/SD_ARCHIVE_POD_V1_CADRAGE_2026_10_12.md`
12. `docs/NOTE_PREUVES_AFFICHAGE_MESURES_MODELE_ECONOMIQUE_2026_10_12.md`

## État technique synthétique

Le chemin des frames fixes du TFT a déjà été validé sur carte : plusieurs images de 153 600 octets ont été reçues ligne par ligne, affichées, mises en cache sur SD et acquittées. La pile principale gardait 184 octets de marge et la pile dédiée 732 à 740 octets.

Le défaut restant concernait les animations : l'ancien lecteur allouait le clip entier alors que le plus grand bloc libre n'était que de 4 884 octets. `480eacd` remplace ce mécanisme par :

- téléchargement vers la SD par blocs de 480 octets ;
- validation complète depuis la SD ;
- lecture avec 2 048 octets fixes ;
- absence de lecture SD pendant une transaction TFT ;
- échec fermé et canari sans vote.

Ce lot a été compilé pour les cœurs 1.5.3 et 1.6.0 et testé sur hôte par Claude. Il n'a jamais tourné sur le matériel.

## Première tâche de Claude

1. Vérifier la toolchain locale et relancer les tests ciblés sans modifier le code pour « faire vert » artificiellement.
2. Confirmer ou contester explicitement le verdict GPT « GO canari avec réserves ».
3. Ne modifier le code que si un défaut concret bloquant est découvert.
4. Préparer les deux drapeaux localement à `1/1` seulement dans le fichier de travail, compiler le vrai dossier Arduino, puis remettre `0/0` avant tout commit.
5. Donner au porteur les lignes précises à relever pendant le canari.
6. Après réception du journal, archiver le journal brut et produire un verdict matériel séparé.

Le canari doit utiliser une animation personnelle/finalisée et ne doit créer ni candidat ni vote.

## Discipline Git et sécurité

- ne pas travailler dans le checkout `main` ;
- un lot = un commit séparé, au périmètre annoncé ;
- aucun push, merge, PR ou déploiement sans demande ;
- préserver les modifications étrangères ;
- aucun secret, `secrets.h`, `.env`, clé, binaire ou cache de compilation ;
- conserver `POD_RENDER_V1=0` et `POD_CANARY=0` dans chaque commit ;
- après chaque lot : tests, compilation réelle, `git diff --check`, rapport, arrêt pour audit GPT.

## Travail suivant, uniquement après un canari vert

Rédiger une spécification formelle d'archive SD v1 à partir de `docs/SD_ARCHIVE_POD_V1_CADRAGE_2026_10_12.md`. Ne pas implémenter simultanément l'animation en flux et la réplication de chaîne : les risques, les rollbacks et les preuves doivent rester séparables.
