taskId: LOT0S-AUDIT-FIX1
statut: DELIVERED
commit: e0dc208
quand: 2026-10-07 (exécuté à la demande directe du porteur, hors fenêtre autonome — celle-ci était close ; la fiche READY de GPT avait été remplacée par FIN, son contenu a été lu dans le commit c325005)

Objectif livré :
- Budget Redis du lot 0S réécrit en deux lignes : chemin NOMINAL (200) inchangé ; chemin d'ERREUR 404 sur un candidateId valide : +1 lecture du candidat courant par requête (plus de cache CDN 30 s) — « coût d'erreur assumé, non nul », borné par le rate-limit de validate-candidate ; l'affirmation « 0 nouvelle commande » est supprimée. Même précision en commentaire de lib/candidateFrameResponse.ts.
- Plus aucun texte public ne dit qu'une animation est « validée image par image » : pastille de la galerie remplacée par un libellé centralisé (lib/animationWording.ts) : empreinte de chaque image consignée et recalculable ; vote des appareils encore v1 ; images pas encore validées par calcul.
- Tests : détecteur de la formulation interdite (variantes + faux positifs), balayage de app/ et lib/, vérification du libellé et du budget.

Fichiers modifiés/créés :
- modifiés : app/gallery/GalleryClient.tsx, docs/LOT_0S_PREUVES_ET_HYGIENE_2026_10_06.md, lib/candidateFrameResponse.ts (commentaire uniquement), tests/lot0sWording.test.ts
- créé : lib/animationWording.ts

Migrations ou variables : aucune.
Coût Redis avant/après : aucun changement de CODE ; le budget DOCUMENTÉ est corrigé (nominal inchangé ; 404 valide : +1 lecture/requête, coût d'erreur assumé).
Coût Neon avant/après : 0 / 0.
Mémoire/flash mesurées : sans objet (aucun firmware touché).
Tests exécutés et résultats :
- git diff --check : exit 0
- npx tsc --noEmit : exit 0
- node --import tsx --test tests/lot0sWording.test.ts tests/candidateFrame.test.ts : 16 pass, 0 fail
- npm test : 435 tests, 435 pass, 0 fail, 0 skipped (le différentiel C++/TypeScript a bien tourné : g++ C:/msys64/mingw64/bin/g++.exe 10.2.0)
Essais matériels : sans objet (aucun firmware) — statuts inchangés : e-ink 2,7" seul compilé non testé ; R4 + TFT 2,8" vote non testé.

Risques ou étrangetés découverts :
1. AUTOMATISATION : le montage « réveil planifié » n'a PAS fonctionné. Une seule session s'est déclenchée (19:07, local_9865cd77…) ; elle s'est figée après 3 appels d'outils (Bash, Read, Bash) — très probablement une demande d'approbation d'outil sans personne pour répondre (les approbations des tâches planifiées ne sont pas pré-accordées). Aucun autre réveil n'a pu s'exécuter tant que cette session était « running ». La tâche de réveil est maintenant DÉSACTIVÉE (enabled=false) et la session figée a été interrompue. La tâche d'arrêt de 22:10 s'est exécutée mais n'avait pas désactivé le réveil. Pour relancer une automatisation : pré-approuver les outils via « Run now » en présence du porteur, ou choisir un mode de permissions adapté (décision du porteur).
2. SendSheet (app/animer/SendSheet.tsx:48) dit « Une fois validée, elle est diffusée à tous les écrans capables » : « validée » désigne l'acceptation par le quorum (v1 pour une animation) ; acceptable mais à reformuler avec pod-anim-v2.
3. app/AnimBlockPlayer.tsx : « Vérifier image par image » recalcule réellement les empreintes de chaque image côté navigateur et les compare au bloc : exact, laissé tel quel.
4. Le NEXT_TASK.md de GPT (FIN) ne contient plus la fiche d'origine ; son contenu est dans le commit c325005.

Rollback : git revert e0dc208 (aucune migration, variable ou donnée persistante).
