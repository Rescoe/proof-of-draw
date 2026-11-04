# Multiscreen `dev_KAD6PKC4` : diagnostic série, correctifs, vote v2 statique PROUVÉ (04/11/2026)

Carte branchée en USB par le porteur ; sauvegarde complète de la flash (4 Mo, lecture seule) AVANT chaque téléversement ; téléversements vérifiés (« Hash of data verified »). Identité (`dev_KAD6PKC4`), clés et Wi-Fi conservés. Les journaux bruts contiennent le code d'appairage : non commités.

## Cause 1 — l'OTA annoncée ne partait jamais (PROUVÉE par lecture du code + série)
Série de la `multiscreen-2.8` : `[OTA] annonce acceptee : seq=18` au démarrage, puis AUCUNE ligne `[OTA]` pendant 150 s. Dans `loop()`, le bloc « animation de bloc » fait `return` à chaque tour tant qu'un clip joue (la carte rejoue en boucle l'animation en flash), et l'appel `podotaesp::maybeRun()` était placé APRÈS lui : jamais atteint. Le BWR (`esp_eink_2.9BWR`) appelle l'OTA AVANT l'animation et sans `return` : il n'est pas concerné. Correctif : l'appel (mêmes conditions de sûreté) est placé avant l'animation. Test : `tests/multiscreenOtaOrder.test.ts` (3 tests, mutants).
**Non prouvé sur la carte** : le téléchargement OTA lui-même (la carte a été mise à jour par USB, pas par OTA).

## Cause 2 — la POST du vote échouait après les lectures par morceaux (PROUVÉE par le série)
1re tentative sur un dessin statique avec la 2.10 (lecture par morceaux OK : 3 morceaux, `verdict=accept`, hash 550889…) : `[MEM] avant TLS: libre=35288 plus gros bloc=16704`, puis `Echec vote … :` (réponse vide), `[PULL] HTTP error: -1`, redémarrage (`cause=4`). Un TLS « normal » réclame ≈ 16,4 Ko de tampon de réception d'un seul tenant : le tas, fragmenté par les lectures, n'a plus de bloc assez grand. Après le redémarrage, plus gros bloc 31 872 o : le vote est parti (`vote POST → 200`, vote v2). Correctif : pour CETTE requête seulement, `client.setBufferSizes(4096, 512)` (drapeau global `g_httpSmallRx`, levé puis rabaissé autour de l'appel ; pas de paramètre par défaut à cause du générateur de prototypes d'Arduino).

## Résultat
- Image `multiscreen-2.11` (séquence 20, 586 736 o, SHA-256 `c93f7191…e8a4`, RAM statique 37 876 o), flashée par USB, UNE tentative de vote sur dessin statique après flash : **`vote POST → 200 · vote : ACCEPTE, vote v2`** (candidat `c9959168-bc4`, 11:43:49 UTC), bloc #135 « Brossé cool » miné à 11:46:11 — validateurs `dev_I25D9Z7A` + `dev_KAD6PKC4`, `votesSummary {v2:2, v1:0, rejects:0}`, sans redémarrage. Avant cela, avec la 2.10 : un vote v2 (11:25:14, candidat `0e3012b2-50b`, après la panne de POST ci-dessus). `missedVotes` = 0.
- Cadence : lecture par morceaux 3,3 à 4,5 s pour 5 808 o ; pile cont. libre 592 à 1056 o au début de la lecture (116 o dans la tentative en échec : marge étroite, à surveiller).
- Frames : #134 reçue et ACK à 11:30:47.
- **Un seul essai réussi sur une seule carte** (et un échec corrigé) : ce n'est pas une série.

## Séquences OTA consommées par cet essai (jamais publiées)
`19` (multiscreen-2.10) et `20` (multiscreen-2.11) servent d'images USB ; `21` est réservée à `multibwr-2.3` (compilé). Le canari publié `multiscreen-2.9` séquence 18 reste inerte pour cette carte (installée = 20 ≥ 18 : annonce refusée).

## BWR + OLED du cousin (`dev_T46HBXG1`, `multibwr-2.2`)
- Même correctif de POST porté à `esp_eink_2.9BWR.ino` (blocs `POD_BWR_BEGIN/END`, option `POD_VOTE_CHUNK` déjà à 1) ; compilé avec les MÊMES options que `multibwr-2.2` (dont `--define POD_OLED_ANIM=1 --define POD_MULTI_OLED=1` : un premier essai sans elles faisait 551 264 o, 8 Ko de moins = fonctions OLED manquantes, écarté) : `multibwr-2.3`, séquence 21, **559 968 o, RAM statique 36 344 o** (2.2 : 559 936 / 36 336), SHA-256 `1ace1acf…60bd` (`docs/mesures/APPAREILS_2026_11_04/MULTIBWR-2.3-BUILD-PIN.json`). **Niveau C seulement : ni M, ni V2, ni OTA.** Non signé, non publié.
- ⚠ **Ce correctif n'explique PAS forcément le comportement du cousin** : sa carte ne se plaint pas à la POST, elle disparaît juste après `candidat GET` (3 fois sur 3 : 01/11 10:26, 02/11 14:36, 04/11 11:27), sans `register` (pas de redémarrage visible) ; la 2.11 du multiscreen, qui a le même code de lecture, ne s'arrête pas là. Ce qui distingue le BWR : candidat e-ink 2,9″ de 9 472 o (4 morceaux), tampon de travail de 4 736 o alloué avant, tas plus étroit, OLED + DHT22. **Cause inconnue.** Un journal série de cette carte reste le seul moyen de la prouver.
- Recommandation avant toute publication : ajouter à la même release un témoin de vie (reset après N minutes sans pull réussi + cause du dernier arrêt envoyée au `register`), pour que le prochain blocage se décrive tout seul côté serveur.
