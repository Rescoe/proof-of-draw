# Audit GPT — `0059f74` — ANIM-STREAM-FIX2 — 13 octobre 2026

## Verdict

**ACCEPTÉ — flash du canari TFT 2,8″ sans vote autorisé.**

Ce verdict autorise uniquement l'essai matériel décrit ci-dessous. Il n'autorise ni fusion dans `main`, ni déploiement, ni vote réel, ni propagation à un autre firmware.

## Correctif audité

- Le tampon de validation de 2 048 octets est désormais alloué seulement après le retour complet de `netGetBlockClipToSd` : le client TLS et la pile réseau dédiée ne coexistent plus avec ce tampon.
- Un échec d'allocation après téléchargement supprime le clip et son marqueur, laisse l'animation inactive et ne produit aucun faux succès.
- Les tests Windows acceptent LF et CRLF ; `mallinfo` est simulé uniquement dans le mock hôte MinGW.
- Le mutant `onSd()` qui présenterait une opération non exécutée comme réussie est maintenant effectivement appliqué et refusé.
- Deux scénarios injectent une panne de pile SD pendant la validation et la lecture : aucun affichage, ACK ou état de succès n'est produit.

## Vérification indépendante GPT/Codex

Commande ciblée relancée dans le vrai worktree avec WinLibs g++ 14.2 et ses DLL dans le `PATH` :

```text
tests/animStream.test.ts
tests/tft28AnimStream.test.ts
tests/tft28Host.test.ts
tests/tft28Canary.test.ts
```

Résultat : **35/35 sous-tests Node réussis**, dont :

- équivalence du lecteur en flux avec la référence en RAM et TypeScript ;
- environ 3 000 clips mutés ;
- absence de lecture SD pendant une transaction TFT ;
- firmware complet production et canari ;
- aucune route de vote atteignable dans le canari ;
- pannes TLS, SD, mémoire et pile ;
- ACK uniquement après affichage complet ;
- arrêt sûr du canari ;
- tous les contrôles négatifs et mutants, y compris la pile SD.

Claude a en outre compilé production et canari avec les cœurs R4 1.5.3 et 1.6.0, sans avertissement du sketch. RAM statique inchangée. Les drapeaux sont à `0/0` dans les commits et le worktree est propre.

## Risques que seul le matériel peut trancher

- appels indirects du tactile et des bibliothèques Adafruit sur la pile SD dédiée ;
- débit réel de la carte SD et fluidité des animations ;
- fragmentation réelle du tas ;
- retrait ou défaut matériel de la carte ;
- reprise après reset.

Le canari mesure ces points et s'arrête si une marge de pile passe sous 128 octets.

## Protocole autorisé

1. Compiler le commit `0059f74` avec `POD_RENDER_V1=1` et `POD_CANARY=1`, uniquement dans une copie temporaire ou via les drapeaux de compilation. Ne jamais commiter `1/1`.
2. Ne soumettre aucun dessin au consensus et ne provoquer aucun vote.
3. Démarrer avec la SD actuelle et vérifier la reprise du clip résident sans message de mémoire insuffisante.
4. Observer deux minutes, puis tester toucher/pause/cartel et toucher/reprise.
5. Envoyer une seule animation personnelle finalisée et relever le téléchargement `/api/block-clip`, la pile réseau, la validation, la pile `animPlay`, le tas et la fluidité.
6. Faire un seul reset et vérifier la reprise depuis la SD.
7. Laisser au moins trois pulls au repos.

Arrêt immédiat en cas de marge inférieure à 128 octets, reset imprévu, corruption visuelle, ACK incohérent, téléchargement en boucle ou erreur SD répétée.

## Après l'essai

Archiver le journal série brut et produire un verdict matériel séparé. La spécification d'archive SD distribuée ne commence qu'après un canari vert.
