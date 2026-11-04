# Release `multibwr-2.4` séquence 22 — PRÉPARÉE, NON PUBLIÉE (04/11/2026)

Statut : compilée et signée dans un dossier de staging hors de `ota-releases/`, contrôle de pré-publication OK. **Jamais flashée, jamais essayée sur une carte. Aucun GO de publication.**

## Pourquoi
`multibwr-2.3` s'est installée par OTA chez le cousin et a reçu un dessin fixe, mais sa carte disparaît toujours juste après `candidat GET → 200` (4 fois sur 4, dernière : 19:05 UTC), sans redémarrer, et n'est rétablie que par une coupure d'alimentation. Aucun journal série n'existe. Cette release ne prétend PAS corriger la cause : elle **rend la panne observable et auto-réparatrice**.

## Ce qui change (option `POD_LIVENESS`, 0 par défaut dans le dépôt, 1 dans ce build)
- Chaque étape qui peut bloquer (pull, lecture du candidat, lecture du contenu par morceaux, signature, envoi du vote, réception d'une frame) pose son numéro en mémoire RTC (mots 24..27) ; un `LiveGuard` le remet à 0 à la sortie de la fonction.
- Un minuteur (`Ticker`, 20 s) **redémarre la carte** si une étape dure plus de 300 s (aucune E/S ni allocation dans le minuteur ; l'étape est marquée « bloquée » en RTC avant le redémarrage).
- Au démarrage suivant, `register` porte `rr` (cause du reset), `rp` (étape où la carte s'était arrêtée) et `rh` (1 = redémarrée par le témoin de vie). Le serveur l'écrit dans le journal de l'appareil (`lib/bootReport.ts`, `lib/deviceLog.ts`) : ex. « reset : redémarrage logiciel, BLOQUÉ pendant : lecture du contenu par morceaux (candidate-frame) ».
- Reste inchangé : la POST du vote à tampon réduit de la 2.3.
- Le serveur ignore ces champs sur un ancien firmware ; le déploiement du côté serveur (poussé sur `main`) est indépendant de la publication de la release.

## ⚠ Limites
- Si la panne est un blocage **total** du processeur (interruptions coupées), le minuteur ne se déclenche pas ; le chien de garde matériel de l'ESP8266 (≈ 8 s) devrait alors le faire (`rr = 1`). Le silence observé sans redémarrage suggère plutôt une boucle qui alimente le chien de garde : le minuteur la rattrape.
- Les redémarrages du témoin de vie coûtent un redémarrage (≈ 20 s, Wi-Fi) : un faux positif est possible si une frame ou un affichage e-ink dépasse 300 s (non observé : ≈ 200 s au pire).
- Mémoire RTC : perdue à une coupure d'alimentation (le rapport n'existe qu'après un redémarrage logiciel / chien de garde).

## Pin
| Champ | Valeur |
|---|---|
| Commande | `node ota-lab/esp8266-canary/tools/build-bwr.mjs --ota --seq 22 --version multibwr-2.4 --sensor --oled --display --chunk --define POD_OLED_ANIM=1 --define POD_MULTI_OLED=1 --define POD_LIVENESS=1` |
| Binaire | 561 888 o, SHA-256 `8005322a0d130049df0ba704034db0da5b9cd26f6ba3dd92aa832554424af2a0`, RAM statique 36 520 o (2.3 : 559 968 / 36 344) |
| Fichier signé (`image.bin`) | 562 212 o, SHA-256 `7354339382a98a2bc149f86d3b78604a7d0ce80423c6a64d0f51783507967b17` |
| Région signée | `ffa2138e5e39abfdc083b95c04fa5c672ef64b8b5b5dced7db90a90f541dc752` |
| Manifeste | SHA-256 `c29cacb00157edab78ccca4cfcbf924d84351eda2078be6b6ab7d0a30da6d0b7` |
| Famille / version / séquence / canal | `esp8266-multibwr` / `multibwr-2.4` / 22 / `canary` |
| Cible | **uniquement** `dev_T46HBXG1` (installée : séquence 21) |
| Staging (hors Git) | `canary-builds/ota-staging/multibwr-2.4-ota22/{image.bin,manifest.json}` |
| Pin de build | `docs/mesures/APPAREILS_2026_11_04/MULTIBWR-2.4-BUILD-PIN.json` |

## Vérifié (hôte seulement)
`tests/livenessWitness.test.ts` (9 tests : texte du rapport, entrées hostiles, option éteinte par défaut, tout dans des blocs `POD_BWR`, gardes sur chaque étape, minuteur sans E/S, numéros alignés serveur/firmware, mutants), `tsc` propre, les tests d'identité du sketch BWR inchangés (mêmes 10 échecs préexistants du harnais hôte qu'avant). Compilation ESP8266 réelle OK.

## Pour publier (GO distinct du porteur) et suivre
Copier les deux fichiers du staging dans `ota-releases/multibwr-2.4-ota22/`, pousser, vérifier côté serveur ; la carte du cousin s'installe après un redémarrage (puis annonce → téléchargement). Ensuite : envoyer un dessin fixe pendant que les autres validateurs sont absents ; lire le journal de l'appareil : soit un vote v2 (la panne ne se reproduit pas), soit un `register` avec « BLOQUÉ pendant : … » (la panne est enfin localisée). Retrait immédiat si boucle de redémarrage. **Ne jamais réutiliser la séquence 22.**
