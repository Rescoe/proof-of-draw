# Point d'arrêt du 04/11/2026 — avant le chantier « appareils / utilisateur / frames manquées »

## Refonte vue capteurs (session `Refonte vue artistique des capteurs`) — poussée sur `main` jusqu'à `b6dbd60`
- 9d5d8c0 : confidentialité par grandeur (liste blanche par appareil, filtrage serveur avant réponse publique).
- 84166f6 / 35621b3 / b6dbd60 : vue capteurs v2 puis v3 (courbes interactives, œuvres en bulles, lecture), ancien code archivé.
- **Non vérifié** : aucune capture d'écran (volet de navigation masqué) ; le rendu mobile/bureau, clair/sombre n'a pas été vu.
- **À contrôler** : la session rapporte 76 échecs de la suite complète, « tous dans des tests de harnais firmware » (les six échecs du harnais 8B2C étaient déjà préexistants ; le total de 76 n'a pas été comparé à `main` d'avant), et un **build de production qui échoue à la génération de `/`** (variable Redis absente en local : à confirmer que Vercel déploie bien).

## Multiscreen KAD6PKC4 / multibwr T46HBXG1 (état serveur du 03/11 matin)
- `dev_KAD6PKC4` : toujours `multiscreen-2.8` ; OTA `multiscreen-2.9` séq. 18 annoncée à chaque pull, jamais téléchargée ; au dessin #132 (02/11 14:36 UTC) il a lu le candidat plusieurs fois avec des `register` répétés (redémarrages), **n'a pas voté** ; frame #132 reçue et ACK à 14:45. Lecture du port série prévue (rappel en mémoire).
- `dev_T46HBXG1` (`multibwr-2.2`) : lit le candidat puis disparaît (01/11 10:26 → 13:32 ; 02/11 14:36 → 20:03), **n'a pas voté** ; n'a pas reçu les frames #131/#132 (hors ligne pendant leur validité ≈ 42 min). Son écran e-ink montre toujours le bloc #123.
- Aucun vote v2 des deux cartes multiscreen/multibwr prouvé côté serveur pour les dessins statiques récents.

## Chantier ouvert (demande du 04/11)
1. Bouton utilisateur « mettre à jour mes écrans » : récupérer les dessins/animations manqués pendant une déconnexion (frame expirée).
2. Liaison appareil ↔ utilisateur qui se perd (téléphone iOS ancien) : retrouver/réappairer un appareil existant, durablement.
3. Corriger la réception et le vote du BWR multiscreen.
