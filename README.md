# Proof of Draw

> Un réseau artistique expérimental dans lequel des dessins numériques deviennent des œuvres physiques, vérifiables et rejouables sur des écrans embarqués.

[Application](https://proof-of-draw.vercel.app) · [Dessiner](https://proof-of-draw.vercel.app/draw) · [Galerie](https://proof-of-draw.vercel.app/gallery) · [Réseau](https://proof-of-draw.vercel.app/network) · [Documentation interactive](https://proof-of-draw.vercel.app/learn)

## English summary

Proof of Draw is an experimental art network connecting a web drawing studio, a serverless coordination layer and physical ESP8266 / Arduino UNO R4 WiFi displays. Artworks can be drawn or animated in the browser, converted into deterministic screen payloads, proposed to a pool of devices, signed and acknowledged by embedded clients, then rendered on e-paper, OLED or TFT screens.

The project explores verifiable digital-to-physical art, constrained rendering, embedded signatures, device consensus, local SD archives and environmental measurements. It is active research software. Real v2 voting is operational: capable devices recompute the content and metrics and sign their votes with Ed25519, and the server verifies the signatures; real blocks (#100, #101, #103, #104) have been mined by multi-device quorum. Some device families still await hardware qualification, and remote firmware updates (OTA) are neither generalised nor validated across the fleet.

This repository is public for transparency and research. **No software licence has been granted yet**; see [Licence and reuse](#licence-et-réutilisation) before reusing the code.

---

## Pourquoi ce projet ?

Une image envoyée vers un écran connecté est généralement traitée comme un simple fichier à afficher. Proof of Draw expérimente une autre approche : conserver la relation entre le geste, sa représentation binaire, les appareils qui l’observent et l’objet physique qui l’affiche.

Le projet associe ainsi :

- un atelier de dessin et d’animation dans le navigateur ;
- une conversion déterministe vers les formats réels des écrans ;
- des appareils embarqués qui s’enregistrent, téléchargent, vérifient et acquittent les œuvres ;
- des signatures Ed25519 et des hashes SHA-256 ;
- un protocole de candidat, vote, quorum et bloc ;
- une visualisation publique des artistes, œuvres, appareils et événements du réseau ;
- des expériences autour des capteurs et de la preuve de mesure.

Proof of Draw n’est pas, à ce stade, une blockchain publique, autonome ou décentralisée. Le serveur coordonne encore le réseau et Redis conserve son état opérationnel et la chaîne. La recherche porte précisément sur ce qui peut être vérifié, calculé, affiché ou archivé par les appareils eux-mêmes.

## État du projet — 15 octobre 2026

> Faits courants, sources et limites : [`lib/projectStatus.ts`](lib/projectStatus.ts) (source unique, testée) · [`/llms.txt`](https://proof-of-draw.vercel.app/llms.txt) · [`docs/ETAT_PUBLIC_ET_SOURCES_IA_2026_10_15.md`](docs/ETAT_PUBLIC_ET_SOURCES_IA_2026_10_15.md).

Le dépôt évolue par petits lots audités, compilés sur l’hôte, puis validés par des canaris matériels. Une fonctionnalité présente dans le code n’est pas automatiquement considérée comme validée sur toutes les cartes.

**Le vote v2 réel est opérationnel.** Les appareils recalculent le contenu brut du candidat et trois métriques entières, décident d’un verdict objectif puis signent leur vote en Ed25519 ; le serveur vérifie réellement les signatures et compare hash et métriques à ses propres valeurs. Des blocs réels ont été minés par quorum multi-appareils : **#100, #101, #103 et #104** (le #104 compte 2 votes v2, 0 vote v1 et 0 rejet ; le #101 comptait encore un vote v1 d’un ancien appareil, avant le correctif qui les refuse). Preuves : [`docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md`](docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md) et [`docs/mesures/TFT28_ACK_BLOC104_2026_10_15/`](docs/mesures/TFT28_ACK_BLOC104_2026_10_15/).

Un appareil dont le firmware ne sait pas voter en v2 **continue de recevoir les œuvres**, mais ne reçoit jamais de demande de validation, ne vote pas et ne compte pas dans le quorum.

### Chemins validés matériellement

| Installation | Réception et affichage | ACK | Vote v2 observé sur la carte |
|---|---:|---:|---:|
| UNO R4 WiFi + e-ink 2,9″ BWR | oui | oui | oui (#100, #101, #103) |
| UNO R4 WiFi + TFT 2,8″ tactile + SD | image fixe et animation | oui (l’ACK décide du succès local, validé le 15/10/2026) | oui (#100, #103, #104) |
| ESP8266 + e-ink 2,9″ BWR | oui | oui | oui (#101, #104) |
| ESP8266 multiscreen e-ink 2,7″ + OLED | oui | oui | oui (#103) |
| UNO R4 WiFi + DHT22 | mesure et envoi validés | n/a | n/a |

**Qualifications matérielles restantes** (code de vote compilé, vote jamais observé sur la carte ; ce n’est pas une absence de consensus) : ESP8266 e-ink 2,7″ seul, ESP8266 TFT 1,8″, UNO R4 e-ink 2,7″ seul, UNO R4 e-ink 2,7″ + OLED, UNO R4 TFT 1,8″. Les animations suivent le même parcours qu’un dessin mais sont encore votées en v1 : leur validation par calcul n’est pas active. L’OTA n’est ni généralisée ni validée sur la flotte. *Proof-of-Display Duration* est une piste de recherche, pas une fonctionnalité disponible.

### Ce qui fonctionne dans l’application

- atelier de dessin avec historique et replay déterministe ;
- atelier d’animation et génération de clips ;
- galerie d’œuvres, galerie d’animations et profils d’artistes ;
- appairage et gestion des appareils ;
- envoi d’une œuvre vers un écran particulier ;
- carte du réseau, activité et écrans en direct ;
- pipeline candidat → validation → bloc → diffusion ;
- réception de mesures environnementales et visualisation ;
- conversion vers plusieurs profils e-ink, OLED et TFT ;
- budget et limitation des accès Redis ;
- protections HMAC, rate limiting et listes de blocage.

## Fonctionnement

```text
Artiste
  │
  │ dessin ou animation
  ▼
Application Next.js
  │
  │ conversion déterministe + candidat
  ▼
Coordination Vercel / Redis
  │                         ▲
  │ metadata, payload       │ vote signé, observation, ACK
  ▼                         │
Pool d’appareils ESP8266 / UNO R4 WiFi
  │
  │ rendu vérifié
  ▼
Écrans e-ink / OLED / TFT et archives SD
```

Le trafic est initié par les appareils vers le serveur : le serveur n’essaie jamais de joindre une adresse IP locale. Cette architecture évite l’ancien modèle de commande directe et les risques de SSRF associés.

### Cycle d’une œuvre

1. L’artiste dessine ou anime dans l’application.
2. Le moteur produit une représentation rejouable et des buffers adaptés au profil d’écran.
3. Le serveur publie un candidat pour les appareils éligibles.
4. Les firmwares compatibles peuvent récupérer ses métadonnées, calculer leurs observations et signer un résultat.
5. Lorsque la politique de quorum est satisfaite, un bloc est finalisé.
6. Chaque écran récupère son payload binaire, le rend, puis envoie un ACK uniquement après succès.

Le vote v2 est opérationnel en production (voir « État du projet ») ; ce qui reste porte sur la qualification de familles d’appareils supplémentaires et sur des garanties plus fortes (éligibilité par profil, reçus signés conservés dans le bloc, identités).

## Architecture technique

| Couche | Technologies et rôle |
|---|---|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| API | Route Handlers Next.js déployables sur Vercel |
| État | Upstash Redis : appareils, pools, candidats, votes, blocs, frames, locks et TTL |
| Firmware | Arduino C++ pour ESP8266 et Arduino UNO R4 WiFi |
| Crypto | Ed25519 pour l’identité et les signatures, SHA-256 pour les contenus et blocs |
| Affichage | e-ink BWR/BW, OLED SSD1306, TFT ST7735/ILI9341, stockage microSD selon la cible |
| Tests | `node:test`, harnais C++ extraits du firmware, tests de mutation et compilations Arduino |

### Routes principales

| Route | Rôle |
|---|---|
| `POST /api/register` | enregistrement idempotent et appairage d’un appareil |
| `GET /api/pull` | état léger : bloc, frame et candidat éventuel |
| `GET /api/pull-frame` | payload binaire adapté au profil d’écran |
| `GET /api/validate-candidate` | métadonnées nécessaires au contrôle d’un candidat |
| `POST /api/validation-result` | résultat signé, quorum et finalisation éventuelle |
| `POST /api/ack-frame` | confirmation d’un affichage réussi |
| `POST /api/send-to-screen` | envoi personnel vers un écran précis |
| `GET /api/block-clip` | clip d’animation associé à un bloc |
| `POST /api/sensor` | ingestion de mesures issues des appareils |

Le dépôt contient davantage de routes pour les artistes, galeries, appareils, animations, preuves, transferts et outils de diagnostic.

## Arborescence

```text
app/                  interface web et routes API Next.js
lib/                  consensus, chaîne, rendu, sécurité et accès Redis
consensus-pod/        noyau partagé et harnais hôte
arduino_uno_r4/       firmwares Arduino UNO R4 WiFi
esp8266/              firmwares ESP8266
docs/                 architecture, audits, protocoles et mesures
tests/                tests TypeScript, structurels et harnais C++
scripts/              outils de compilation, inventaire et analyse
public/               ressources statiques de l’application
```

## Profils matériels

| Profil | Format | Taille logique | État général |
|---|---|---:|---|
| e-ink 2,9″ BWR | noir, blanc, rouge | 296 × 128 | affichage et vote v2 validés sur ESP8266 et UNO R4 |
| e-ink 2,7″ BW | monochrome | 264 × 176 | multiscreen ESP8266 + OLED validé (dont le vote v2) ; ESP8266 seul et R4 à qualifier |
| OLED 0,96″ | monochrome | 128 × 64 | écran auxiliaire et animation testés avec l’e-ink 2,7″ |
| TFT 1,8″ | couleur | 160 × 128 | firmware présent, qualification matérielle du vote restante |
| TFT 2,8″ tactile + SD | RGB565 | 240 × 320 | image, cache SD, animation, ACK et vote v2 validés sur la carte |
| DHT22 sur UNO R4 | température / humidité | — | acquisition matérielle validée |

Consulter [`docs/COMPATIBILITE_ECRANS.md`](docs/COMPATIBILITE_ECRANS.md) pour les brochages et contraintes connues. Les verdicts matériels récents sont intégrés dans `main` ; les documents datés conservent l’historique des canaris.

## Démarrage local

### Prérequis

- Node.js 20 LTS ou plus récent ;
- npm ;
- une instance Redis compatible avec l’API REST Upstash pour exécuter les parcours réseau ;
- Arduino IDE ou `arduino-cli` uniquement si vous compilez les firmwares.

### Application web

```bash
git clone https://github.com/Rescoe/proof-of-draw.git
cd proof-of-draw
npm ci
```

Créer ensuite `.env.local` sans jamais le commiter :

```dotenv
KV_REST_API_URL=
KV_REST_API_TOKEN=
SESSION_SECRET=
INTERNAL_API_SECRET=
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

Puis lancer :

```bash
npm run dev
```

L’application est disponible sur [http://localhost:3000](http://localhost:3000).

### Vérifications

```bash
npm test
npx tsc --noEmit
npx eslint .
npm run build
```

Certains harnais firmware nécessitent également un compilateur C++ récent et les bibliothèques Arduino indiquées par leurs lots de documentation.

## Compiler un firmware

1. Choisir le dossier correspondant exactement à la carte et à l’écran.
2. Copier `secrets.h.example` en `secrets.h` dans ce même dossier.
3. Renseigner le Wi-Fi et l’URL du serveur dans la copie locale.
4. Installer le cœur Arduino et les bibliothèques documentés pour la cible.
5. Compiler le **dossier du sketch tel quel** : le générateur de prototypes Arduino fait partie de la chaîne à vérifier.
6. Ne jamais commiter `secrets.h`, un binaire de canari ou des identifiants de production.

Exemple de point de départ validé sur `main` :

```text
arduino_uno_r4/pod_uno_r4_eink29/
```

Les drapeaux `POD_RENDER_V1` et `POD_CANARY` restent désactivés dans les sources commitées. Les protocoles de canari décrivent explicitement quand et comment les activer dans une copie locale.

## Contraintes embarquées importantes

Les microcontrôleurs visés ont peu de RAM et les bibliothèques TLS, JSON, crypto, SD et graphiques ont parfois des pics importants. Le projet applique notamment :

- des piles dédiées et mesurées pour Ed25519, le réseau, certains appels Wi-Fi et les travaux JSON sur UNO R4 ;
- une lecture TLS bornée sur les chemins sensibles ;
- des gardes, filigranes et marges minimales contrôlées par les canaris ;
- la fermeture du client TLS avant les allocations ou rendus volumineux ;
- un comportement fermé : pas d’ACK, de vote ou de succès annoncé après une lecture incomplète ou une erreur mémoire ;
- des téléchargements en flux vers la SD ou l’écran lorsque le payload ne tient pas raisonnablement en RAM ;
- des tests de mutation pour vérifier que les garde-fous ne sont pas accidentellement supprimés.

Ces protections sont spécifiques aux chemins et aux cibles. Une réussite sur un firmware ne valide pas automatiquement les autres.

## Sécurité et modèle de confiance

> Proof-of-Draw fournit une preuve applicative et cryptographique orchestrée par le serveur et les appareils. Les votes v2 sont réellement signés en Ed25519 et vérifiés côté serveur. Les clés sont toutefois stockées dans l’EEPROM ou la flash et ne sont pas protégées par un secure element. La chaîne est liée par hashes et stockée dans l’infrastructure Proof-of-Draw ; elle n’est pas encore une blockchain publique autonome. L’ACK constitue une preuve applicative de traitement par le firmware, pas une preuve optique indépendante des pixels.

- sessions web signées par HMAC ;
- identités d’appareils et signatures Ed25519 vérifiées par le serveur (mode strict) ;
- hashes SHA-256 des rendus et blocs ;
- rate limiting et blocage des abus dans Redis ;
- TTL sur les états temporaires ;
- aucune connexion initiée par le serveur vers une IP locale ;
- résultats de vote classés afin d’éviter un second envoi lorsque le premier a peut-être atteint le serveur ;
- ACK envoyé uniquement après un chemin d’affichage considéré comme réussi.

Limites connues : pas de signature matérielle inviolable, pas de preuve optique, vote compté par appareil (pas par profil), auteur autorisé à voter sur son propre dessin, votes signés complets non conservés dans le bloc, connexions TLS des cartes sans authentification du serveur, OTA non généralisée. Le projet est expérimental et n’a pas fait l’objet d’un audit de sécurité indépendant complet. Ne l’utilisez pas comme infrastructure critique ou comme preuve juridique sans analyse adaptée.

## Documentation de recherche

Quelques points d’entrée :

- [Architecture du moteur de dessin](docs/ARCHITECTURE_DESSIN.md)
- [Plan de validation du consensus](docs/PLAN_DE_TRAVAIL_CONSENSUS_FINAL_2026_10_06.md)
- [Compatibilité des écrans](docs/COMPATIBILITE_ECRANS.md)
- [Pipeline des animations](docs/ANIMATIONS_PIPELINE.md)
- [Faisabilité des animations](docs/ANIMATIONS_FAISABILITE_ESP_ET_COULEUR.md)
- [Capteur DHT22 sur UNO R4](docs/CAPTEUR_TEMPERATURE_R4_DHT22.md)
- [Verdict du client SSL borné sur R4 e-ink 2,9″](docs/CANARY_R4_EINK29_BOUNDED_SSL_FIX1_VERDICT_2026_10_11.md)
- [État public et sources IA (15/10/2026)](docs/ETAT_PUBLIC_ET_SOURCES_IA_2026_10_15.md) — document de référence de l’état courant
- [Synthèse du vote réel et de la production directe (14/10/2026)](docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md)
- [Reste à faire](docs/RESTE_A_FAIRE_2026_10_14.md)
- [Journal de validation réelle — historique du chantier](docs/CHANTIER_VALIDATION_REELLE.md)

Les documents datés conservent l’historique de la recherche. Ils peuvent décrire une étape dépassée ; les verdicts les plus récents, `lib/projectStatus.ts` et le code de `main` priment.

## Contribuer

Le projet est en phase de recherche active. Avant de proposer un changement :

1. ouvrir une issue décrivant la carte, l’écran et le chemin concerné ;
2. isoler un seul lot fonctionnel par branche ;
3. conserver les invariants réseau, mémoire et sécurité ;
4. fournir tests, compilation et mesures proportionnés au risque ;
5. distinguer clairement « compilé », « testé sur l’hôte » et « validé matériellement ».

Les contributions ne doivent contenir aucun secret, dump privé, clé, `.env`, `secrets.h` ou binaire configuré.

## Licence et réutilisation

**Aucune licence logicielle n’est actuellement accordée par ce dépôt.** Le code est visible publiquement pour documenter la recherche et permettre son examen, mais cette visibilité ne constitue pas une autorisation générale de copier, modifier, distribuer ou exploiter commercialement le projet.

Sauf mention contraire applicable à un composant tiers, tous les droits sur le code et les contenus propres à Proof of Draw sont réservés. Le régime juridique des œuvres soumises au réseau n’est pas encore fixé (aucun consentement CC0 explicite n’est recueilli par le parcours de soumission actuel) : décision à prendre avant toute affirmation publique. Pour une expérimentation, une contribution, une intégration ou une licence commerciale, ouvrez une issue afin de discuter du périmètre et des conditions.

Les dépendances et bibliothèques tierces conservent leurs licences respectives.

## Avertissement

Proof of Draw combine logiciel web, cryptographie expérimentale, firmwares et matériel physique. Les canaris peuvent volontairement arrêter une carte lorsqu’une marge de sécurité est franchie. Sauvegardez vos données, vérifiez le firmware correspondant exactement à votre matériel et ne flashez pas un build expérimental sans lire son protocole.

---

Proof of Draw est autant une œuvre en construction qu’un laboratoire : le réseau, ses écrans et ses mesures deviennent une partie visible du processus artistique.
