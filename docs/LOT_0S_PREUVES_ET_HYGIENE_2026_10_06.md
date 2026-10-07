# Lot 0S — Preuves et hygiène (partie sans matériel)

| | |
|---|---|
| **Date** | 06/10/2026 |
| **Base** | `5aa654f` (arbre propre) |
| **Demandeur** | GPT (orchestrateur/auditeur) — fiche transmise par le porteur |
| **Réalisateur** | Claude |
| **Portée** | Corrections de cache, de diagnostic de test, de garde-fou RAM et de **vocabulaire**. **Aucun firmware, aucun protocole, aucun format de vote, aucun quorum, aucun accès Redis modifiés.** |

## Ce qui est livré

| # | Demande | Livré |
|---|---|---|
| 1 | `/api/candidate-frame` : un 404 n'est jamais mis en cache | `lib/candidateFrameResponse.ts` (logique extraite pour être testable sans Redis) ; la route n'est plus qu'un appel. **Toute réponse non-200 (400, 404, 500) renvoie `Cache-Control: no-store`** ; le 200 garde `public, s-maxage=1800, max-age=1800, immutable`. Aucune lecture Redis pour un identifiant invalide. Tests : `tests/candidateFrame.test.ts` (4). |
| 2 | Harnais C++ de `podMetrics.test.ts` | `tests/helpers/cppHarness.ts` : compilateur et version **toujours affichés** (ou liste des candidats essayés), commande exacte de compilation affichée, en cas d'échec : commande, répertoire, code de sortie, signal, erreur de lancement (ENOENT/ENOMEM), **stdout et stderr**, conseils Windows (chemins en « / », DLL MinGW `0xC0000135`). Même ligne de compilation, mêmes vecteurs, mêmes attentes : **métriques non modifiées**. Si aucun compilateur : le test est **IGNORÉ** et le dit (jamais vert). Tests : `tests/cppHarness.test.ts` (6). |
| 3 | RAM statique de l'e-ink 2,7″ seul | `esp8266/esp_eink_2.7BW/esp_eink_2.7BW.ino` ajouté à `tests/espStaticRam.test.ts` (garde-fou « aucun gros tampon statique »). Relevé de compilation du 06/10/2026 : **34 240 o** (limite du dépôt 40 000). Ce garde-fou est textuel ; la mesure reste celle de `arduino-cli`. |
| 4 | « image vide » → « image uniforme » | `docs/CHANTIER_VALIDATION_REELLE.md` (3 passages), `docs/REPRISE_2026_10_06_VALIDATION_ET_RESEAU.md`. **Le code `reason: "blank"` n'est pas touché** (protocole v3). |
| 5 | `obsConfirmed` | `lib/observationWording.ts` (vocabulaire unique) ; `app/BlockDetail.tsx` (champ, titre de section, badge, lignes) et `app/gallery/GalleryClient.tsx` (pastille) disent « **réception confirmée par l'appareil** ». Aucun « validé / revérifié / recalculé / observer ». Commentaire du champ corrigé dans `lib/chain.ts` (commentaire seulement). Tests : `tests/lot0sWording.test.ts`. |
| 6 | Page Apprendre, mémoire | `SynthesisPath.tsx` : « le firmware évite de recopier l'image dans un second buffer complet » ; l'OLED (1 Ko) et l'e-ink 2,9″ (4,7 Ko) utilisent un **espace de travail borné employé pendant la lecture** ; plus d'« aucun tampon » ni de scratch « alloué après la fermeture TLS » (cela ne vaut que pour les tampons d'image d'affichage). |
| 7 | Statuts matériels | Inchangés et gardés par test : ESP8266 e-ink 2,7″ seul = **compilé, non essayé** ; R4 + TFT 2,8″ vote/calcul = **non essayé**. Aucun statut promu. |

## Budget (déclaré avant le code, vérifié après)

| Ressource | Avant | Après | Justification |
|---|---|---|---|
| **Commandes Redis — chemin normal (200)** | 1 lecture du candidat courant à la 1ʳᵉ requête de `/api/candidate-frame`, puis le CDN (réponse immuable) | **identique** | Aucune commande de plus sur le chemin nominal ; un identifiant invalide (400) ne lit toujours rien. |
| **Commandes Redis — chemin d'erreur 404 sur un `candidateId` valide** | la 1ʳᵉ requête lisait le candidat, puis le CDN absorbait les suivantes pendant 30 s | **+1 lecture du candidat courant par requête** (plus de cache de 30 s) | **Coût d'erreur assumé, non nul** : seul le 404 n'est plus mutualisé. Il est borné : un firmware n'appelle `candidate-frame` qu'après `validate-candidate` (soumis au rate-limit du validateur) ; ces 404 sont des courses ou des expirations ; aucune boucle, aucun polling ajouté. À surveiller dans les journaux Vercel (`candidate-frame` 404). |
| **Polling** | aucun nouveau | **aucun** | Aucun `setInterval`, aucune route, aucun appel client ajouté. |
| **Requêtes Neon** | 0 | **0** | Aucun code ANA/Neon touché. |
| **Cadence firmware** | inchangée | **inchangée** | Aucun `.ino`, aucun en-tête de firmware modifié. |
| **CDN** | 404 mis en cache 30 s | 404 `no-store` ; 200 immuable inchangé | Effet : une requête arrivée avant la publication du candidat (ou après son expiration) ne fait plus mémoriser le 404 par le CDN. Un firmware n'appelle `candidate-frame` qu'après que `validate-candidate` a annoncé le candidat (soumis au rate-limit du validateur) : ces 404 sont rares (course, expiration) et le surcoût éventuel se limite à quelques lectures du candidat courant par ces requêtes. |

## Ce qui n'est PAS fait (volontairement)

- Aucun changement de `reason: "blank"`, de message signé, de règle, de format de bloc ou de vote → Lot 1 (v3).
- Aucun firmware modifié → pas de sauvegarde `firmware-backups/` nécessaire pour ce lot.
- Pas de push, pas de déploiement, pas de variable Vercel.

## Rollback

Le lot est **un seul commit local** : `git revert <hash>` restaure l'état `5aa654f`. Aucune migration, aucune variable d'environnement, aucun état Redis à défaire. Seul effet visible côté production après déploiement : en-tête `Cache-Control` des erreurs de `/api/candidate-frame` et libellés d'observation.

## Étrangetés découvertes et consignées (non traitées : hors périmètre du lot)

| # | Constat | Où | Suite proposée |
|---|---|---|---|
| E1 | ~~La pastille de la galerie disait « Animation validée image par image »~~ alors que les animations sont votées en **v1 (écho)** : sur-promesse. | `app/gallery/GalleryClient.tsx` | **CORRIGÉ (LOT0S-AUDIT-FIX1)** : libellé dans `lib/animationWording.ts` (empreinte de chaque image consignée et recalculable ; vote encore v1) ; test de vocabulaire dans `tests/lot0sWording.test.ts`. |
| E2 | Le sketch **e-ink 2,7″ seul** (`eink27bw-2.1`) ne porte pas l'avertissement « NON TESTÉ sur le matériel » en en-tête (règle du dépôt), alors qu'il n'a pas été essayé. | `esp8266/esp_eink_2.7BW/esp_eink_2.7BW.ino` | À ajouter au prochain contact avec ce firmware (le lot interdisait de le modifier). |
| E3 | `docs/UNO_R4_PORTS_ECRANS_NON_TESTES.md` et les en-têtes des ports R4 disent « non testé » alors que le porteur rapporte des essais réussis. Pas de **trace archivée** : on ne promeut rien sans preuve. | docs R4 | Lot 0 [U] : archiver une ligne `[VALIDATE2]` + `[MEM]` par variante. |
| E4 | Le journal « Réseau » affiche le motif brut `blank` (« refuse (blank) »). | `lib/validationSummary.ts` | Libellé « image uniforme » avec le renommage du code en v3. |
| E5 | Les autres tests compilant du C++ (`podBenchR4`, `podHttpR4`, `sceneV1Firmware`) ont leur propre recherche de compilateur **sans** le diagnostic ajouté ici. | `tests/*.test.ts` | Réutiliser `tests/helpers/cppHarness.ts` (lot d'hygiène ultérieur). |
| E6 | Les classes CSS `bd-obs-*` / `gc-chip--obs` gardent le préfixe « obs » (interne, invisible). | — | Sans objet. |

## Validations exécutées

Voir le rapport de fin de lot (commit) : `git diff --check`, `npm test`, `npx tsc --noEmit`, tests ciblés (candidate-frame, métriques, RAM, Apprendre, observation).
