# Lot UX 3 — Remix d'un bloc, reprise d'un rejet (26/10/2026)

Décision du porteur : **pas de « fork »** ; on dit **Remix** / « créer une œuvre dérivée ». L'histoire n'est jamais réécrite : on COPIE pour créer une NOUVELLE œuvre.

## Ce que fait chaque geste
- **Bloc miné → « 🔀 Créer une œuvre dérivée (Remix) »** (détail d'un bloc de la galerie) : on choisit un écran du MÊME type, le studio s'ouvre sur `/draw/{appareil}/{écran}?remix={blockHash}` avec la copie de l'image ; l'artiste ajoute, efface, transforme ; l'envoi suit le parcours normal candidat → votes → bloc, **dans la chaîne canonique** (parentHash = tête courante, aucune branche). Le bloc source n'est **jamais** touché.
- **Dessin rejeté → « ↻ Reprendre ce dessin »** (onglet Rejetés, motif du rejet affiché) : `?resume={candidateId}` ouvre la copie archivée comme **nouveau brouillon**. **Aucune filiation** n'est créée (il n'existe pas de bloc) ; l'archive du rejet reste intacte ; le nouveau candidat a sa propre identité et son propre parcours.

## Filiation = `derivedFromBlockHash` (optionnel, strict, ENGAGÉ dans le hash)
- Champ du **nouveau** bloc (et du candidat), 64 hex minuscules. **Il entre dans le hash canonique du nouveau bloc quand il est présent** ; la clé est **absente** sinon, donc **tout bloc historique garde exactement son hash** (testé v1 et v2). Le retirer, le modifier ou l'ajouter après coup fait échouer le contrôle « hash » du vérificateur. Le hash du bloc source engage déjà ses données : rien n'est recopié, **aucune clé Redis de provenance**, aucune écriture supplémentaire.
- Audit des points de hash (tous mis à jour, une clé optionnelle placée après `animRoot`) : `finalizeBlock` (hash v1), `prepareBlockV2` / `sealBlockV2` + `blockCanonicalV2` (hash v2, `lib/podProtocolV3.ts`), `blockHashV1` et la reconstruction v2 de `lib/podVerify.ts`. `podVerifyAnim.ts` (animation v3, `rulesVersion` 2) **refuse** un bloc d'animation qui déclare une filiation. **Aucune nouvelle `rulesVersion`** : l'ajout est une clé optionnelle rétrocompatible (un ancien vérificateur ne peut simplement pas valider un bloc dérivé, ce qu'on veut) ; les messages de vote v1/v2 ne portent pas la filiation (voir « limites »).
- **Vérification publique** : `ProofBlock.derivedFromBlockHash` ; `verifyBlock` ajoute (uniquement pour un bloc dérivé) les contrôles `derivation` (forme, différent du bloc lui-même) et `derivation-source` (bloc d'origine retrouvé, hash identique, antérieur) ; `scripts/verify-block.ts` relit le bloc d'origine par son propre hash. Interface : « Remix du bloc #N » avec lien vers l'original (`/gallery?q=N`), lignes de hash « Dérivé de (Remix) ».
- **Contrôle serveur à la soumission** (`lib/derivation.ts`, `lib/derivationGate.ts`) : hash valide, bloc source existant dans la chaîne canonique, **même type d'écran**, source et dérivé = images fixes, et **œuvre réellement modifiée** (empreinte du payload ≠ celle du bloc source). Fait dans `/api/draw` **avant** le verrou de dépôt (une erreur ne consomme pas le délai), transmis par la file d'attente, puis re-vérifié dans `/api/submit-candidate` (rejet explicite, comme une automatisation suspecte).

## Studio
- `DrawSession.seedFromRGBA` : l'image source devient le **point de départ** sans journaliser d'action (score et replay = ce que l'artiste fait ensuite ; « annuler » ne descend pas sous l'image). `lib/remixSeed.ts` : **piège corrigé** — le décodeur d'écran inverse l'OLED (allumé = blanc) alors que le canvas suit l'encodeur (sombre = allumé) ; test d'aller-retour exact pour les 5 écrans (une œuvre chargée puis envoyée sans retouche = identique à l'original, donc refusée comme « non modifiée »).
- Un Remix a **son propre brouillon** (clé `{appareil}:{écran}:remix:{hash}`) : il n'écrase jamais le brouillon ordinaire. « Nouveau dessin » efface l'origine (plus de filiation). Erreur de chargement : « Réessayer » / « Dessiner sur une feuille blanche », **jamais de navigation automatique**.
- `/api/block-meta?hash=` : résumé public (numéro, titre, artiste, écran, nature, filiation), 1 GET puis CDN 1 jour.

## Impact Redis
Dessin ordinaire : **0** commande de plus (aucune lecture sans filiation déclarée, testé). Remix : +1 GET (bloc source) à la soumission, + 1 à la relecture du candidat dans `submit-candidate` (2 au plus, une fois par œuvre dérivée). Lecture publique : `block-meta` 1 GET puis CDN. Stockage permanent : un champ de 64 caractères dans le bloc dérivé.

## Principe à conserver
**Les appareils votent et signent le contenu ; la filiation est vérifiée par le serveur puis engagée dans le hash du bloc final.** Aucune modification de firmware ni de version de consensus dans ce lot.

## Limites connues
- La filiation est **déclarée par l'artiste et vérifiée par le serveur** ; les appareils votants ne la signent pas (leurs votes portent sur le contenu). Elle est en revanche engagée dans le hash : on ne peut ni la retirer ni la changer sans invalider le bloc.
- **Le noyau C++ `consensus-pod/src/consensusPoD.h` (miroir de `blockCanonicalV2`) ne connaît pas encore `derivedFromBlockHash`** : aucun firmware ne l'utilise ; à ajouter (clé après `animRoot`) avant qu'un appareil recalcule un hash de bloc dérivé. Non touché ici (consigne : pas de firmware ni de consensus hors besoin).
- Remix limité aux **images fixes** et à un **écran du même type** (pas de conversion entre écrans) ; une animation ne peut ni être remixée ni en dériver. Reprise d'un rejet : seulement si la copie d'archive existe (200 derniers rejets, 90 jours) ; un rejet d'animation (A_FAIRE #14) n'est pas géré.
- « Œuvre modifiée » = au moins un pixel différent ; l'anti-spam repose sur le verrou de dépôt par appareil (15 min) et les strikes existants. Droits d'auteur : non gérés au-delà du nom d'artiste d'origine affiché.
- Les dessins déjà en file d'attente avant le déploiement n'ont pas de filiation (champ absent).

## Tests
`tests/derivation.test.ts` (11 : règles, porte serveur sans lecture pour un dessin ordinaire, compatibilité v1 et v2 des hashs, falsifications, vérificateur, animation refusée, ordre des opérations dans `/api/draw` et `submit-candidate`), `tests/remixSeed.test.ts` (8 : aller-retour exact des 5 écrans, feuille sans action, adresses strictes, jamais de fausse filiation pour une reprise, câblage interface).
