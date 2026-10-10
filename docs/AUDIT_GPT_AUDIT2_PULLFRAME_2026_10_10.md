# Audit GPT — canari PULLFRAME-PHASE-AUDIT2 (3ace43b) : instruction du lot AUDIT3 (10/10/2026)

Transcription de l'analyse transmise par le porteur (texte tel que reçu, mis en forme).

## Constats

Le texte annonce « trois faits » et en énumère quatre :

- le bon build AUDIT2 est bien exécuté ;
- la frame `ce693868…` est bien annoncée par `/api/pull` ;
- la zone `.noinit` est effacée au Reset sur cette configuration, donc elle ne permet pas de récupérer la dernière phase ;
- même `[FF00]` a été perdu parce que le tampon USB était plein : les jetons série ne sont pas suffisamment fiables.

Le porteur peut débrancher la carte et ne plus renvoyer d'image : la frame restera en attente sans ACK.

Résultat matériel AUDIT2, build confirmé : `BUILD PULLFRAME-PHASE-AUDIT2 | base 3628b3d` ; après le Reset : `FFREC ... AUCUN enregistrement valide` ; `[FF00] PERDU (tampon USB trop plein)` ; le pull récupère bien la frame personnelle `ce693868-b895-4b7c-8dae-48c14e884e83` ; silence immédiat après `[PULL] nouvelle frame ... (personal)`.

Conclusions : 1. le bon binaire est formellement confirmé ; 2. `.noinit` ne survit pas au Reset sur cette chaîne de démarrage ; 3. la sortie série est déjà saturée au boot, elle ne peut pas être notre unique trace ; 4. AUDIT2 ne localise donc toujours pas la phase, mais démontre pourquoi ses deux mécanismes sont inexploitables sur ce matériel.

## Instruction : PULLFRAME-PHASE-AUDIT3 (instrumentation seulement)

- audit préalable complet de la carte EEPROM utilisée par les clés, le dernier bloc et l'état du firmware ;
- réserver une adresse canari qui ne chevauche aucune donnée existante ;
- sauvegarder magic, génération, phase et complément de phase dans cette zone persistante ;
- au maximum une mise à jour par phase, uniquement avec `POD_CANARY=1` ;
- imprimer la phase précédente au démarrage avant de réarmer la trace ;
- protéger la lecture contre les valeurs aléatoires ou une écriture interrompue ;
- documenter le nombre maximal d'écritures et l'usure ; ce mécanisme ne doit jamais rester actif en production ;
- conserver en parallèle des jetons série d'un seul octet, mais rendre silencieux le chemin canari juste avant `doFetchFrame` afin de ne plus saturer l'USB ;
- ne modifier aucune logique de téléchargement, de rendu ou d'affichage avant localisation ;
- aucun changement serveur, Redis, Neon, protocole, polling, vote, ACK ou OTA ;
- drapeaux committés à `0/0`, fichier local remis à `1/1`, compilation sur les deux cœurs, puis arrêt pour audit GPT.

Si l'EEPROM ne peut pas être utilisée sans risque, étudier d'abord un registre de sauvegarde RA4M1 réellement conservé après Reset, avec une petite sonde séparée. Ne pas supposer sa persistance.

Nous avons donc identifié l'échec de l'instrumentation, pas encore celui de la frame.

## Remarques de l'implémentation (Claude) sur ce texte

- Le journal fourni ne contient qu'UN démarrage : « AUCUN enregistrement valide » est la valeur NORMALE d'un premier démarrage après téléversement. La conclusion « `.noinit` est effacée au Reset » n'est établie que si ce démarrage suivait un premier démarrage du même binaire.
- `EEPROM.update` sur la R4 alloue une page de 1 Ko au tas et efface puis reprogramme un bloc entier de 1 Ko à chaque valeur modifiée : le lot utilise donc la programmation d'UN octet vierge (voir `docs/LOT_8B2B2_PULLFRAME_PHASE_AUDIT3_2026_10_10.md`).
