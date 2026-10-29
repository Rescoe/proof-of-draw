# État Git et reprise depuis plusieurs ordinateurs

**Audit du 29/10/2026 — aucune suppression effectuée.**

## Situation observée

- `origin/main` : `ed441d8` au moment de l'audit.
- Le checkout historique principal était sur `claude/ota-1-manifest-contract`, avec 142 commits propres, 170 commits manquants et 33 entrées modifiées/non suivies.
- Un worktree temporaire `claude/multibwr-migration`, basé sur `origin/main`, contenait 14 modifications non commitées correspondant au chantier actif multiscreen BWR. Il ne doit pas être nettoyé avant livraison de Claude.
- Plusieurs anciens worktrees sont propres mais attachés à des branches déjà fusionnées ou très en retard.
- Quelques branches non fusionnées conservent des archives ou expériences historiques ; elles doivent être classées, pas fusionnées globalement.

## Décision

`origin/main` reste la base de tout nouveau travail. Le checkout historique divergent est un espace d'archive tant que son contenu n'a pas été trié. On ne fait ni `reset --hard`, ni suppression de worktree, ni fusion massive.

## À pousser dans Git

Code actif, documentation canonique, matrices et preuves nettoyées, manifests/images explicitement destinés aux releases, scripts reproductibles et branches d'archive utiles.

## À garder hors du Git public

Dumps de flash, secrets, clés privées, logs bruts non nettoyés, builds temporaires et fichiers de surveillance. Les sauvegarder sur un stockage privé avec empreintes si nécessaire.

## Procédure sur le nouveau PC

```text
git clone <URL_DU_DEPOT>
cd proof-of-draw
git fetch --all --prune
git switch main
git pull --ff-only
nvm use
npm ci
npm test
```

Si `nvm` n'est pas installé, utiliser directement Node 22.13.0 ou plus récent. Après `npm ci`, vérifier que `node_modules/next/package.json` existe avant d'interpréter un échec de test comme un défaut du code.

Pour chaque chantier, partir de `main`, créer une branche et la pousser avant de changer de machine. Ne jamais travailler simultanément sur la même branche depuis deux PC.

## Règle quotidienne multi-PC

1. début : fetch, branche et status ;
2. une branche par chantier ;
3. fin : tests, commit, push ;
4. autre PC : fetch puis reprise de la branche distante ;
5. jamais de `secrets.h` dans Git ;
6. documenter la preuve matérielle avant de quitter la machine qui possède les journaux.

## Nettoyage différé de l'ancien PC

Après livraison du multiscreen et vérification du nouveau clone : inventorier les worktrees sales, pousser ou archiver les commits uniques, sauvegarder les artefacts privés, puis seulement archiver les worktrees obsolètes. Remettre le checkout principal sur `main` par une opération contrôlée, jamais par reset destructif.
