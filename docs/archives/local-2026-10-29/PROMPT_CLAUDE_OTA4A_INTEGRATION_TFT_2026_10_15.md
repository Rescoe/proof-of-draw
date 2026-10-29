# Prompt Claude — OTA-4A : contrat final et intégration TFT hors matériel

Tu reprends le chantier OTA de Proof of Draw dans le dépôt `C:\Users\thibf\Documents\App-Rescoe\proof-of-draw`.

## Mission

Avance de manière autonome sur **OTA-4A : fermer le contrat de sécurité ESP8266 et préparer l'intégration OTA du firmware complet TFT 1,8″, désactivée par défaut, sans carte ni activation serveur**. Tu peux auditer, documenter, coder, tester, compiler et committer sur la branche de travail. Tu ne dois ni flasher, ni lancer une OTA matérielle, ni déployer, ni pousser, ni modifier `main`.

## Lecture obligatoire avant action

Lis intégralement, dans cet ordre :

1. `AGENTS.md` ;
2. `lib/projectStatus.ts` ;
3. `docs/ETAT_PUBLIC_ET_SOURCES_IA_2026_10_15.md` ;
4. `docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md` ;
5. `docs/RESTE_A_FAIRE_2026_10_14.md` ;
6. `docs/OTA_ETAT_ACQUIS_ET_CHEMIN_PRODUCTION_2026_10_15.md` ;
7. `docs/OTA_FAISABILITE_ET_PLAN_2026_10_15.md` ;
8. `docs/OTA2_T1_VERDICT_2026_10_15.md`, `docs/OTA2_T2_VERDICT_2026_10_15.md` et `docs/mesures/OTA2_2026_10_15/LISEZMOI.md` ;
9. `ota-lab/esp8266-ota2/README.md`, le sketch et les outils ;
10. `lib/otaManifest.ts`, ses tests, `lib/voteCapability.ts` et `esp8266/esp_tft1.8/esp_tft1.8.ino` en entier.

Commence par `git status`, `git log --oneline --decorate -12` et `git diff`. La branche attendue est `claude/ota-1-manifest-contract`. Préserve absolument les deux documents non suivis préexistants hors périmètre. Ne nettoie, ne déplace et ne réécris aucun travail que tu n'as pas créé.

## Faits acquis à ne pas redémontrer

- Le banc ESP8266 RSA-2048 a réussi en HTTP local.
- `tampered`, `wrongsig` et `badlen` ont été refusés sur carte avec `ERROR[12]`, sans remplacer A.
- `good` a été vérifié, copié par eboot et a démarré en B.
- Sur le succès : image 349 284 o, 9 334 ms, `minLibre=34536`, `minMaxBloc=33624`, `minPileCont=2240`.
- Le chemin RSA stock tient une pile permanente ; le coût de la pile à second étage mesuré est de 6 208 o.
- Ces résultats concernent la sonde, pas le firmware complet PoD.
- Aucune clé de production n'existe. Les clés du laboratoire sont jetables et ignorées.
- L'OTA publique/généralisée reste fausse et ne doit être annoncée nulle part.

## Travail demandé

### 1. Clore proprement OTA-2

- Vérifie que `journal-T3-2026-10-15.txt` et `serve-T2-T3-2026-10-15.log` sont archivés dans `docs/mesures/OTA2_2026_10_15/` avec les SHA-256 annoncés.
- Mets à jour `LISEZMOI.md`, `SHA256SUMS.txt`, `OTA2_T2_VERDICT_2026_10_15.md` et la section d'avancement de `OTA_FAISABILITE_ET_PLAN_2026_10_15.md` afin que T3 soit le verdict final, en conservant la nuance historique de T2.
- Ne modifie jamais les journaux bruts pour les rendre plus propres.

### 2. Rédiger une décision de sécurité courte avant de coder

Produis un ADR daté qui tranche ou encadre explicitement :

- la signature du manifeste actuellement ECDSA P-256 dans `lib/otaManifest.ts` ;
- la signature binaire RSA-2048 matériellement prouvée ;
- qui vérifie quoi, dans quel ordre, et quelle propriété empêche famille erronée, URL détournée, rejeu et downgrade ;
- le nombre de primitives/clefs publiques conservées en flash et leur coût mémoire ;
- la séparation totale avec les clés Ed25519 de vote ;
- clé active + clé de secours et rotation.

Recommandation par défaut : privilégier le chemin RSA fourni par le cœur pour le premier canari et réduire le nombre de piles cryptographiques. Mais ne l'applique pas aveuglément : vérifie le code et chiffre l'impact. Si le contrat OTA-1 doit évoluer, adapte-le avec tests, sans compatibilité silencieuse ni double contrat ambigu.

### 3. Auditer le firmware TFT complet avant insertion

- Cartographie les phases réseau/TLS, les allocations, l'affichage, les animations, le vote v2 et les moments où une OTA pourrait être sûre.
- Cartographie chaque offset EEPROM/flash et prouve qu'une future zone `otaSeq` ne collisionne avec rien.
- Identifie les invariants précis à préserver : `deviceId`, appairage, clés Ed25519, `blockHash`, Wi-Fi local, ACK, vote, écran.
- Vérifie la taille maximale réellement disponible avec le schéma `4M2M`.
- Aucun déplacement global, aucun refactor cosmétique.

### 4. Intégrer un socle OTA étroit, OFF par défaut

- Crée le minimum de code nécessaire, de préférence un petit module local à la famille ESP8266 si cela évite de gonfler le `.ino`, mais sans inventer une nouvelle architecture.
- `POD_OTA=0` doit être la valeur par défaut et rendre le comportement observable identique à l'avant.
- Avec `POD_OTA=1`, prépare seulement les briques locales : validation bornée de métadonnées, anti-downgrade, installation explicite du vérificateur, états de tentative/boot et points d'appel sûrs.
- Ne branche aucune route, aucun Redis, aucun hébergement réel et aucune annonce dans `/api/pull` dans ce lot.
- Ne mets aucune clé privée, aucun secret et aucune vraie clé publique de production. Une clé publique de test clairement marquée peut exister uniquement si elle est nécessaire aux tests/compilations.
- Ne réutilise jamais la clé de vote.

### 5. Prouver le comportement hors matériel

- Ajoute des tests hôte pour les états, séquences, refus de downgrade, mauvaises familles/profils, tailles et entrées inconnues.
- Ajoute un garde-fou testant que toute version OTA cible reste `voteV2Capable`.
- Compile le firmware TFT complet OFF puis ON avec esp8266 3.1.2, `nodemcuv2`, `4M2M`.
- Rapporte pour OFF/ON : taille programme, RAM statique, espace OTA, et delta exact.
- Si possible, démontre l'équivalence OFF par préprocesseur/symboles ou explique honnêtement la limite ; ne prétends pas à une identité binaire si elle n'est pas obtenue.
- Exécute les tests OTA ciblés, les tests `voteCapability`, TypeScript strict et la suite raisonnablement pertinente. Ne masque aucun échec préexistant.

## Contraintes absolues

- Ne touche pas au protocole de vote v2 ni à ses clés.
- Ne casse aucun invariant mémoire documenté dans `AGENTS.md`.
- Aucun nouveau poller, aucune nouvelle base, aucun état critique en mémoire Vercel.
- Aucun fetch serveur vers une IP locale.
- Aucun flash, serveur local, port ouvert, coupure de courant, déploiement ou push.
- Aucun changement public affirmant que l'OTA est disponible.
- Pas de commit de `secrets.h`, clé privée, `.bin`, `.signed`, logs locaux non archivés ou configuration générée.
- Si le contrat de sécurité ne peut pas être rendu cohérent sans choix du porteur, documente précisément les options et arrête avant l'intégration concernée ; n'improvise pas.

## Commits et arrêt

Fais des commits atomiques sur la branche actuelle, uniquement après tests :

1. clôture documentaire OTA-2 ;
2. ADR/contrat et tests ;
3. socle TFT OFF par défaut + tests/compilations.

Tu peux corriger de toi-même les défauts strictement internes à ce lot s'ils sont réversibles, testés et documentés. Arrête-toi impérativement avant toute action matérielle ou activation serveur.

## Rapport final attendu

Donne :

- verdict GO/NO-GO pour un premier flash manuel du firmware TFT complet ;
- commits produits ;
- fichiers créés/modifiés ;
- contrat cryptographique retenu et justification ;
- cartographie EEPROM ;
- tailles OFF/ON et marges ;
- tests exécutés et résultats ;
- risques encore ouverts ;
- procédure matérielle exacte proposée pour le lot suivant, **sans l'exécuter** ;
- une seule question finale : demande le GO pour ce prochain lot matériel.
