id: LOT0S-AUDIT-FIX1
statut: READY
base: d13280f
lot: Lot 0 — Preuves et hygiène, corrections post-audit GPT
objectif: Fermer les deux réserves non bloquantes de l'audit du commit d13280f, sans changer aucun protocole ni comportement de production hors libellé/cache déjà livré.
non-objectifs: Ne pas commencer le protocole v3 ; ne pas modifier firmware, quorum, vote, identité, cadence, variable Vercel, déploiement ou secret ; ne pas ajouter de polling ni d'accès Redis/Neon.
fichiers probables: app/gallery/GalleryClient.tsx ; docs/LOT_0S_PREUVES_ET_HYGIENE_2026_10_06.md ; lib/candidateFrameResponse.ts (commentaire uniquement si nécessaire) ; tests/lot0sWording.test.ts ou test dédié.
budget: Redis chemin 200 inchangé ; sur un candidateId valide qui renvoie 404, chaque nouvelle requête peut désormais refaire 1 lecture du candidat au lieu de profiter de l'ancien cache CDN de 30 s — coût d'erreur assumé, borné par la cadence/rate-limit existante, aucune nouvelle boucle ; Neon 0 ; réseau aucun nouvel appel ; mémoire aucun changement significatif.
tests attendus: git diff --check ; node --import tsx --test tests/candidateFrame.test.ts tests/lot0sWording.test.ts ; npx tsc --noEmit ; npm test si l'environnement le permet (avec C:/msys64/mingw64/bin dans PATH pour le différentiel C++).
rollback: git revert du commit du lot ; aucune migration, variable ou donnée persistante.
documents à mettre à jour: docs/LOT_0S_PREUVES_ET_HYGIENE_2026_10_06.md uniquement pour corriger l'affirmation de coût strictement nul sur le chemin 404 valide.
critères de fin: 1) le budget distingue explicitement chemin normal et chemin d'erreur 404 ; 2) aucun texte public ne dit qu'une animation est « validée image par image » tant que son vote reste v1 ; 3) un test protège ce vocabulaire ; 4) aucun changement Redis/Neon, firmware ou protocole ; 5) commit local unique puis DELIVERY.md séparé conformément à PROTOCOLE.md.
