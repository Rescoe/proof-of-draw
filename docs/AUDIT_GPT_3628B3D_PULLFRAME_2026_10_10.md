# Audit GPT — canari 3628b3d (PULLFRAME-PHASE-AUDIT1) : aucune marque FF, instruction du lot AUDIT2 (10/10/2026)

Transcription de l'analyse transmise par le porteur (texte tel que reçu, mis en forme).

## Analyse des journaux Vercel

Les journaux Vercel prouvent seulement que l'œuvre a été mise en file à 18:04:40 :

- `POST /api/send-to-screen → 200` ;
- aucune requête `/api/pull` après cet envoi ;
- donc aucune `/api/pull-frame` ;
- aucun ACK.

En seulement quatre minutes, la carte pouvait simplement attendre son prochain pull. Mais comme elle avait déjà semblé se bloquer sur la frame précédente, elle peut aussi être encore coincée dans ce chemin.

## Consigne au porteur

1. Ne renvoie plus d'image.
2. Garde le moniteur série ouvert.
3. Appuie une seule fois sur Reset, sans reflasher.
4. Copie le journal depuis `[BOOT]` jusqu'au dernier message ou au silence.
5. Regarde simultanément si Vercel reçoit successivement `/api/register`, `/api/pull`, `/api/pull-frame`, `/api/ack-frame`.

Lecture du résultat :

- `/pull` absent : problème avant ou pendant le pull.
- `/pull` présent, mais `/pull-frame` absent : blocage du firmware entre le décodage du pull et l'émission de la requête de frame.
- `/pull-frame` présent, mais aucun ACK : blocage pendant le téléchargement, le rendu ou l'affichage.
- ACK présent, mais écran inchangé : problème du pilote ou du rafraîchissement physique.

Message à transmettre à Claude : le commit `3628b3d` a bien été téléversé et exécuté ; ne pas remettre en cause la procédure de flash. `POST /api/send-to-screen` a répondu 200 le 10 octobre à 18:04:40 pour `dev_W29I1TW7`, écran `eink29bwr`, bloc `26c4f1b82f3d`. Dans la fenêtre fournie jusqu'à 18:08, aucun `/api/pull`, `/api/pull-frame` ou `/api/ack-frame` n'apparaît : cela prouve uniquement la mise en file. Un seul Reset sera fait, sans renvoyer d'image, pour provoquer register + pull immédiat. La frame personnelle est déjà en attente.

## Instruction : LOT8B2B2-PULLFRAME-PHASE-AUDIT2 (instrumentation uniquement)

1. ajouter au boot une empreinte explicite du build et du commit d'instrumentation ;
2. remplacer les marques FF utilisant `logf` par des marqueurs minimaux réellement non bloquants, par exemple un seul octet par phase via `Serial.write`, uniquement si l'espace exact est disponible ;
3. ne faire dans ces marqueurs ni formatage, ni `String`, ni allocation, ni attente USB, ni appel à `logf` ;
4. prévoir un moyen de connaître la dernière phase atteinte même si une marque série est perdue, sans écrire fréquemment en EEPROM et sans modifier les chemins de production ;
5. ajouter un marqueur de contrôle au démarrage pour prouver que le mécanisme de trace fonctionne avant `doFetchFrame` ;
6. conserver le découpage des 15 phases de `3628b3d` ;
7. aucune correction fonctionnelle avant localisation du blocage ;
8. aucun changement serveur, Redis, Neon, protocole, polling, vote, ACK ou OTA ;
9. commit avec drapeaux `0/0`, compilation sur les deux versions du cœur R4, puis arrêt pour audit GPT.

Point important : lors de l'essai précédent, après `[PULL] nouvelle frame … (personal)`, aucune marque `FF`, pas même FF1, n'est apparue. L'instrumentation AUDIT1 n'a donc fourni aucune localisation exploitable. Ne pas conclure « ancien binaire ». L'image déjà minée est le bon test : elle ne crée aucun vote ni nouveau candidat. Il faut maintenant exploiter cette frame en attente, pas en créer d'autres.

## Remarque du porteur (même message)

« La chute de WallStreet » est l'œuvre envoyée tout à l'heure sur l'écran seul (déjà minée, jamais arrivée) ; ce n'est PAS le dessin neuf (qui n'a jamais passé les votes). Le porteur dit qu'il va renvoyer une image pour voir s'il obtient plus d'informations (contraire à la consigne GPT ci-dessus : à signaler).
