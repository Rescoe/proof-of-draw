# Mesures de l'audit de vote du R4 + TFT 2,8" (13/10/2026)

Analyse STATIQUE (désassemblage `arm-none-eabi-objdump -d --no-show-raw-insn` de l'ELF de **production**, cœur 1.6.0, chaîne Arduino gcc 7.2.1) du commit `3f9b35e` (firmware identique à `0059f74`). Rien n'est mesuré sur la carte.

- `pile-principale-statique-prod-1.6.0.txt` : `scripts/tft28-stack-report.js` (production).
- `appeles-voie-vote-prod-1.6.0.txt` : appelés directs et profondeurs de `doValidateV2`, `doValidateV1`, `httpCall`, `netReadCandidate` (`callees.js`).
- `inventaire-pile-principale-prod-1.6.0.txt`, `chaines-pile-principale-prod-1.6.0.txt` : fonctions atteignables sur la pile PRINCIPALE par famille (`mainreach.js`, `mainreach2.js`).
- `ed25519-pile-prod-1.6.0.txt` : `scripts/ed25519-stack-report.js`.
- `esquisse-phases-*.txt` + `ESQUISSE_sketch_phases_NON_APPLIQUEE.js` : ESQUISSE de mesure (découpage en phases) compilée dans une copie jetable ; **jamais appliquée au dépôt**.

Usage : `node callees.js <worktree> <fichier.dis> <symbole>` ; les scripts `mainreach*.js` prennent `<worktree> <fichier.dis> [motifs]`.
