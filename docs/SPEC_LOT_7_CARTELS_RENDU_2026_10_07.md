# Lot 7 — Cartels et rendu e-ink : zone du cartel (7.1 livré), rapport de rendu (7.5 côté serveur livré), cadrage de 7.2 / 7.3 / 7.4

| | |
|---|---|
| **Date** | 07/10/2026 — base `1a32f82` (6C-FIX1) |
| **Réalisateur** | Claude · **auditeur** : GPT |
| **Statut** | **7.1 (zone du cartel dans l'éditeur) : code livré, vérifié dans l'interface (aperçu navigateur) et par tests. 7.5 (rapport de rendu) : **réception et consignation côté serveur** livrées, inertes tant qu'aucun firmware n'envoie le rapport. **7.2, 7.3 : cadrés, NON codés, décisions demandées (§ 5).** 7.4 et la partie firmware de 7.5 : lot 8.** |
| **Interdits respectés** | aucun firmware, aucune variable, aucun secret, aucune route de vote ou de finalisation modifiée, aucun changement de `canvasToScreen`, du moteur de dessin, des hashes ou des métriques ; Redis **+0** commande ; pas de push ni de déploiement |
| **Rollback** | `git revert` du commit ; aucune donnée, aucun état à défaire (la préférence d'interface `cartel` est ignorée par l'ancien code) |

## 1. Faits relevés dans le code des firmwares [C — lecture des sources, vérifiée par test]

Le cartel est **gravé par l'appareil** après réception de l'image : les lignes des bandes sont blanchies puis un séparateur est tracé ; le texte vient de `cartelMeta` (titre, artiste, date, n° de bloc) fourni par `/api/pull`. L'image du bloc, les votes, les hashes et les métriques portent sur l'image **avant** gravure : rien n'est faussé, **l'artiste perd seulement ce qu'il a dessiné sous les bandes à l'affichage**.

| Écran (canvas) | Firmware | Lignes effacées (haut / bas) | Lignes libres |
|---|---|---|---|
| e-ink 2,9″ (296×128) | ESP8266 et **R4** | 0–13 / 114–127 | **100** |
| e-ink 2,7″ (264×176) | ESP8266 (solo et +OLED) | 0–12 / 163–175 | 150 |
| e-ink 2,7″ | **R4** (solo et +OLED) | 0–13 / 162–175 | 148 |
| TFT 1,8″ (128×160) | ESP8266 | 0–14 / 146–159 | 131 |
| TFT 1,8″ | **R4** | 0–12 / 146–159 | 133 |
| OLED 0,96″, TFT 2,8″ | tous | **aucun cartel gravé dans l'image** (le TFT 2,8″ affiche le cartel au toucher) | — |

**Zone retenue = UNION des ports** (conservatrice : ce qui est annoncé « sûr » l'est sur tous les firmwares) : e-ink 2,9″ **100** lignes sûres, e-ink 2,7″ **148**, TFT 1,8″ **131**. `lib/cartelZones.ts` est la source ; `tests/cartelZones.test.ts` **relit les sources `.ino`** et échoue si un firmware change sa bande.
Constats nouveaux par rapport aux notes précédentes : (a) **le TFT 1,8″ est aussi concerné** (29 lignes sur 160, 18 %) ; (b) **les ports ne sont pas identiques** (séparateur à la ligne `BAND` ou `BAND-1`) : l'e-ink 2,7″ perd 26 lignes sur l'ESP8266 mais 28 sur la R4 ; (c) le « 148 lignes » de l'audit GPT est exact pour la R4, pas pour l'ESP8266 (150).

## 2. 7.1 — zone du cartel dans l'éditeur (LIVRÉ)

| Élément | Détail |
|---|---|
| `lib/cartelZones.ts` | géométrie par écran, `cartelBandAt`, `countUnderCartel` (pixels dessinés — opaques et non blancs — sous les bandes) ; `FIRMWARE_CARTEL` = données de test |
| Éditeur (`Stage.tsx`) | **hachures dorées** sur les bandes + pointillés aux limites de la zone sûre, tracés dans l'espace dessin (suivent zoom et rotation), libellé « cartel · effacé à l'affichage » quand la place le permet ; **purement visuel** : aucun pixel, aucune action, aucun hash n'est modifié |
| Menu « Affichage » | interrupteur **« Zone du cartel »** (« 100 lignes sur 128 restent visibles »), **activé par défaut**, mémorisé (préférence globale, comme la grille) ; absent pour l'OLED et le TFT 2,8″ |
| Envoi (aperçu) | avertissement **non bloquant** : « *N points de ton dessin (X %) sont sous les bandes du cartel : <écran> les efface pour écrire la date, le bloc, ton nom et le titre. Le dessin enregistré dans le bloc reste complet.* » |
| Vérification visuelle (aperçu du navigateur, `/draw-lab`) | e-ink 2,9″ : bandes de 14 lignes haut et bas, deux traits (un dans la bande, un en zone sûre) → « 356 points (42 %) » ; bascule désactivée/activée ; e-ink 2,7″ et TFT 1,8″ : bandes aux bonnes proportions ; OLED : aucune bande, aucun item de menu ; aucune erreur de console |
| Tests | 4 (`tests/cartelZones.test.ts`) : géométrie dérivée des 8 firmwares, union conservatrice, comptage (bornes 13/14 et 113/114, blanc explicite, transparence, dimensions incohérentes → `null`), câblage de l'interface, **moteur de dessin et `canvasToScreen` sans mention du cartel** |

**Limites** : pas d'essai sur téléphone réel ; la préférence est globale (pas par écran) ; l'aperçu d'envoi montre le fichier envoyé, pas le cartel gravé ; seuls les **hachures** informent — rien n'empêche encore de dessiner sous les bandes (voir D7-1).

## 3. 7.5 — rapport de rendu (réception côté serveur LIVRÉE ; émission = lot 8)

Décision D9 du plan : on **ne vote pas** sur le rendu (le cartel contient le n° de bloc et l'heure, connus après le vote) ; l'appareil **rapporte après coup** ce qu'il a affiché.
- **Corps d'ACK facultatif** : `artworkHash` (hash de l'œuvre sur laquelle le réseau a voté), `renderHash` (hash du tampon FINAL, cartel compris), `layoutVersion` (1..255), `cartelMode` (`overlay` | `fit` | `hidden`). Lecture **stricte** (`sanitizeRenderReport` : hash hexadécimaux de 64 caractères, version entière, mode connu ; tout le reste ignoré ; jamais une erreur : l'ACK doit réussir).
- **Consigné dans l'enregistrement d'affichage existant** (`shown:{appareil}:{écran}`, ≈ +150 octets) : **0 commande Redis de plus** (test : commandes directes de la route inchangées).
- **Jamais voté, jamais vérifié** (le serveur ne connaît ni la date ni le texte gravés), **jamais public** (retiré de la vue réseau), **jamais pour une frame personnelle**. Visible dans « Mon profil → débogage des affichages » avec la mention « témoignage de l'appareil ».
- **Inerte aujourd'hui** : aucun firmware ne l'envoie. Le calcul de `renderHash` sur l'appareil (SHA-256 d'un tampon de 5,8 Ko déjà en RAM avant l'envoi à l'écran) est une tâche du **lot 8**.

## 4. `layoutVersion` et harmonisation des ports (proposition pour le lot 8)
`layoutVersion = 1` = « cartel en surimpression, géométrie de `lib/cartelZones.ts` ». Les huit firmwares devraient **tous** utiliser exactement ces lignes (aujourd'hui 3 variantes) : la zone sûre affichée dans l'éditeur serait alors **exacte** et non conservatrice, et le `renderHash` d'un même écran serait comparable entre cartes. Toute future géométrie incrémente `layoutVersion`.

## 5. Décisions demandées (GPT / porteur) — 7.2, 7.3, 7.4

| # | Question | Options | Proposition de Claude |
|---|---|---|---|
| **D7-1** (7.2) | Faut-il **empêcher** de dessiner sous les bandes, ou seulement avertir ? | **A** avertir (livré) · **B** verrouiller les bandes dans le moteur (masque : les outils ne peignent pas dans ces lignes) · **C** canvas réduit (296×100 / 264×148 / 128×131) complété en blanc par le serveur | **A maintenant.** **C change** le repère de toutes les actions et du replay (parité « replay == image » à réécrire), le score et les indices de couverture (`podHints`), les brouillons enregistrés par `appareil:écran`, et les tests de parité `canvasToScreen` ; **B** touche le moteur pixel-exact. Aucun des deux n'est nécessaire pour ne rien perdre *par surprise* : l'artiste est désormais **prévenu pendant et avant l'envoi**. À reprendre si les essais montrent que l'avertissement ne suffit pas. |
| **D7-2** (7.3) | « Ajuster » les œuvres existantes (variante réduite à la diffusion) ? | oui (aire → seuil, rouge préservé) / non | **Plus tard**, avec `cartelMode = fit` : la variante réduite est ce que `fit` envoie ; l'image affichée ≠ image du bloc (déjà admis pour les conversions inter-écrans) ; à spécifier avec l'algorithme exact et des vecteurs de test. |
| **D7-3** (7.4) | Réglage `cartelMode` par appareil (`overlay` / `fit` / `hidden`) : interface dès maintenant ? | maintenant / avec le firmware | **Avec le firmware (lot 8)** : un réglage sans effet serait trompeur. Transport prévu : dans la lecture de l'appareil **déjà faite** par le `MGET` du pull (+0 commande) ; interface « Gérer → Réglages » ; firmware : saute la gravure si `hidden`. |
| **D7-4** | Aligner les 8 firmwares sur `lib/cartelZones.ts` ? | oui / non | **Oui, au lot 8** (§ 4). |

## 6. Budget et sécurité
Redis : **+0** (aucune route nouvelle ; le rapport de rendu s'ajoute au SET déjà fait par l'ACK) · Neon : 0 · polling : 0 · aucune donnée envoyée au serveur par l'éditeur (le comptage se fait dans le navigateur) · aucun secret · le rapport de rendu n'entre ni dans le vote ni dans le bloc ni dans un hash (test).

## 7. Ce qui n'est PAS fait
7.2 (canvas réduit), 7.3 (ajustement), 7.4 (`cartelMode`) et l'émission du rapport par les firmwares ; essai sur téléphone ; harmonisation des ports ; préférence par écran ; version « verrouillage des bandes ». Aucun essai sur matériel.
