# Prompt Claude — appliquer la taxonomie des familles et mettre à jour la matrice

Tu reprends la documentation et la matrice matérielle de Proof of Draw depuis l'état actuel de `main`.

Lis d'abord intégralement :

1. `docs/TAXONOMIE_FAMILLES_COMPOSITIONS_MATERIELLES.md` ;
2. `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` ;
3. la section « Matrice matérielle — règle de maintenance » de `CLAUDE.md` ;
4. les données de compatibilité et d'installation dans `app/learn/`.

La taxonomie datée du 29/10/2026 est une décision du porteur. Ne rediscute pas sa définition :

- exactement un écran physique = famille mono-écran ;
- au moins deux écrans physiques = famille multiscreen ;
- ajouter un écran fait migrer la composition vers multiscreen ;
- ajouter seulement un capteur ne change pas la famille ;
- la plateforme, la famille fonctionnelle, le profil matériel et la cible OTA sont quatre notions distinctes ;
- une famille mutualise une architecture, mais chaque profil incompatible garde son propre build OTA ;
- un appareil multiscreen reste une seule identité et une seule voix.

## Objectif

Mettre à jour la matrice canonique et sa présentation dans l'application afin que toutes les compositions connues soient classées selon cette règle et que les futures IA puissent identifier immédiatement les briques réutilisables.

## Travail demandé

1. Audite les profils existants dans les firmwares, `screenProfiles`, les profils d'installation, les familles OTA, les capacités, les documents récents et l'historique matériel.
2. Corrige `docs/MATRICE_COMPATIBILITE_MATERIELLE.md` sans augmenter artificiellement les niveaux de preuve.
3. Ajoute pour chaque profil les colonnes ou champs nécessaires :
   - famille fonctionnelle ;
   - plateforme ;
   - identifiant de profil matériel ;
   - écrans et rôle de chacun ;
   - modules ;
   - capacités ;
   - firmware actuel ;
   - famille/cible OTA et séquence ;
   - preuves `C`, `M`, `V2`, `OTA` ;
   - diffusion publique, canari ou expérimental.
4. Corrige la page de matrice/compatibilité dans `app/learn` pour afficher cette distinction de façon lisible sur téléphone et ordinateur. Réutilise les composants responsive déjà livrés ; ne refais pas l'interface globale.
5. Classe explicitement :
   - ESP8266 + e-ink 2,7″ BW + OLED comme multiscreen historique ;
   - ESP8266 + e-ink 2,9″ BWR + OLED + DHT22 comme multiscreen BWR, et non comme BWR mono-écran avec simple OLED auxiliaire ;
   - R4 + TFT 1,8″ + DHT22 + SGP40 comme mono-écran avec modules capteurs ;
   - les profils capteurs sans écran comme nœuds capteurs ;
   - les R4 e-ink 2,7″ + OLED comme multiscreen R4.
6. Garde la compatibilité documentaire avec les anciens noms de firmware et les appareils déjà déployés. Indique les migrations nécessaires au lieu de réécrire l'historique.
7. Ajoute une aide courte expliquant qu'une famille fonctionnelle ne signifie pas « même binaire OTA ».
8. Mets à jour `CLAUDE.md`, `AGENTS.md`, le README si nécessaire, la roadmap et la note canonique du Vault pour pointer vers la taxonomie.
9. Ajoute des tests empêchant les régressions de classification, notamment :
   - un second écran implique multiscreen ;
   - un capteur seul ne transforme pas un mono-écran en multiscreen ;
   - deux variantes multiscreen peuvent avoir des cibles OTA différentes ;
   - un multiscreen ne gagne jamais plusieurs voix ;
   - la matrice mobile ne déborde pas.

## Contraintes

- Ne modifie aucun firmware et ne publie aucune release dans ce lot documentaire/application.
- Ne change aucun niveau de preuve sans journal matériel correspondant.
- Ne supprime pas les anciens identifiants encore utilisés par des appareils déployés.
- Ne transforme pas la matrice en générateur automatique de firmware : elle décrit et oriente la réutilisation des briques.
- Ne demande pas de décision intermédiaire si un ancien nom est ambigu : applique la taxonomie canonique, conserve un alias historique et documente-le.

## Livraison

Avance jusqu'au bout, teste TypeScript, les tests ciblés et les viewports de la matrice, puis pousse le lot si tout est vert. Donne à la fin :

- commit poussé ;
- fichiers modifiés ;
- profils ajoutés ou reclassés ;
- niveaux de preuve conservés ;
- captures téléphone/ordinateur de la matrice ;
- incohérences historiques restant à migrer dans les firmwares ou l'OTA.
