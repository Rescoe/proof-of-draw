# Attestations tardives — laisser voter les appareils après le quorum (07/11/2026)

**Interrupteur `ATTESTATIONS_MODE`** (`on` pour activer ; absent ou autre valeur = ÉTEINT, comportement strictement identique à avant). Code : `lib/lateAttest.ts` ; branchements : `app/api/{pull,validate-candidate,validation-result,candidate-frame}/route.ts` ; tests : `tests/lateAttest.test.ts`.

## Principe
Le quorum, le comité, les reçus signés et le minage ne changent PAS. Aujourd'hui le vote qui atteint le quorum mine le bloc, puis le candidat est effacé (et la file d'attente met le dessin suivant à sa place) : un appareil qui tire plus tard ne voit rien à voter. Avec le mode `on` :
1. **Au minage**, avant l'effacement, une copie légère du candidat reste lisible 10 minutes : `candidate:closed` (métadonnées, sans image ni séquence d'actions, ≈ 1 Ko), `candidate:closed:votes` (votes déjà reçus), `candidate:closed:payload` (image, lue seulement par `/api/candidate-frame`). Dessins v2 seulement (une animation n'a pas de spécification v2).
2. **`/api/pull`** invite un appareil qui n'a pas de candidat ouvert à voter (ou n'a plus rien à voter) à attester le candidat clos, s'il ne l'a pas dessiné et n'a pas encore voté : deux clés de plus à la fin du MGET existant (0 commande de plus).
3. **`/api/validate-candidate`** sert ce candidat clos (même forme de réponse), **`/api/candidate-frame`** sert son image (chargeur `loadCandidateForFrame` : le candidat courant gagne ; réponse 200 immuable par identifiant, donc cachée par le CDN).
4. **`/api/validation-result`** : un vote v2 pour un candidat qui n'est plus le courant est vérifié comme d'habitude (signature, hash et métriques recalculés, éligibilité) puis enregistré comme **attestation** (`castLateVote` : même script atomique, clé `candidate:closed:votes`, doublon refusé) avec une **trace durable** `chain:attest:<hash du bloc>` (30 jours). Réponse : `{ ok, blockMined: false, alreadyFinalized: true, attestation: true, attested, voteCount, needed: 0 }` (la forme d'un vote tardif ordinaire : aucun changement requis côté firmware). Hors comité (le bloc est déjà miné), vote v1 refusé (409), jamais de minage, jamais de reçu dans le bloc.

## Coût Redis (mode `on`)
Minage +3 écritures ; pull et validate-candidate +0 commande ; chaque attestation = 1 MGET (méta + votes) + 1 script de vote + 1 HSET + 1 EXPIRE ; un appareil invité mais refusé est ré-invité à chaque pull pendant 10 minutes au plus (borné par le TTL). Mode `off` : zéro, listes de clés des MGET inchangées (garde de structure testée).

## Ce qui est prouvé / non prouvé
Prouvé (tests) : mode éteint == avant (structure), copie légère et TTL, doublon refusé, trace durable, aucune écriture dans `candidate:current` / `candidate:votes`, copie écrite avant l'effacement, 3 mutants refusés. `npx tsc --noEmit` propre. **Non prouvé** : tout comportement sur une carte (une carte recevra-t-elle l'invitation et votera-t-elle sur un candidat clos ? l'affichage des attestations dans l'interface n'est PAS fait : seules les traces existent) ; pas de lecture de la trace par l'interface ni par `/api/block-meta`.

## Activer / retirer
Activer : variable Vercel `ATTESTATIONS_MODE=on` puis redéploiement ; retirer : supprimer la variable (les clés closes expirent seules en 10 minutes). Retour arrière du code : `git revert` du commit.

## Suite possible
Afficher « N attestations » dans la page du bloc (lire `chain:attest:<hash>`) ; chiffrer le coût réel après une semaine de mode `on` ; décider si une attestation tardive doit compter pour la réputation des appareils (aujourd'hui : non).
