# État actuel canonique de Proof of Draw

**Révision : 29/10/2026**
**Référence Git examinée : `origin/main` à `ed441d8`**
**Objet : point d'entrée unique pour reprendre le projet sans historique de conversation**

## 1. Ordre de confiance documentaire

En cas de contradiction, utiliser cet ordre :

1. code et tests de `origin/main` ;
2. ce document ;
3. `TAXONOMIE_FAMILLES_COMPOSITIONS_MATERIELLES.md` ;
4. `MATRICE_COMPATIBILITE_MATERIELLE.md` comme registre cumulatif des profils et preuves, en tenant compte de son avertissement de lecture ;
5. rapport daté explicitement cité par la matrice ;
6. autres notes datées, considérées comme historiques jusqu'à confirmation.

Une branche, un worktree, un build local ou un manifeste publié ne prouvent pas à eux seuls qu'une fonction a tourné sur le matériel.

## 2. Le projet en dix lignes

Proof of Draw est un réseau artistique reliant un studio web, un serveur Next.js/Redis et des appareils physiques ESP8266 ou UNO R4 WiFi. Un dessin ou une animation devient un candidat. Les appareils capables de voter récupèrent le contenu, le recalculent selon leur protocole, signent leur verdict, puis le serveur applique le quorum et crée un bloc. Le contenu validé est converti et distribué aux écrans compatibles ; l'affichage est confirmé par un ACK. Les appareils sont toujours clients du serveur : le serveur ne contacte aucune IP locale. Le réseau gère plusieurs écrans e-ink, OLED et TFT, ainsi que des mesures environnementales. L'OTA signée existe sur ESP8266 et un client R4 avancé est en qualification. PoD n'est pas une blockchain autonome : Redis et le serveur coordonnent encore l'état et la chaîne. Le dépôt est un projet de recherche actif ; les niveaux « compilé », « hôte », « carte », « vote réel » et « OTA » doivent toujours être distingués.

## 3. Architecture stable

```text
Navigateur
  -> studio déterministe de dessin / animation
  -> candidat Redis
  -> appareils : register + pull + candidat + vote signé
  -> quorum et bloc canonique
  -> conversion / frame par écran
  -> appareils : pull-frame / clip
  -> rendu physique
  -> ACK et journal réseau
```

- Application : Next.js 16, React 19, TypeScript strict.
- État opérationnel : Upstash Redis, sans base relationnelle.
- Appareils : ESP8266 et UNO R4 WiFi ; futur Linux/Raspberry Pi encore non spécifié.
- Identité : appareil, clé publique, association à un artiste.
- Sécurité : HMAC/routes internes, signatures, rate limits, listes de blocage, TLS selon client, releases OTA signées.
- Source de vérité du dessin : `lib/drawEngine`; encodage écran centralisé dans `lib/canvasToScreen.ts`.

## 4. Votes et quorum

- Le serveur invite les appareils capables de voter, indépendamment de l'écran du candidat.
- La règle produit est « tous les validateurs capables votent tous les dessins ».
- Les votes statiques v2 recalculent hash et métriques puis signent le verdict.
- Le quorum historique est `ceil(poolSize × 0,51)`, minimum 1.
- Le candidat conserve désormais un résumé de l'électorat ; l'exclusion pour manque est bornée et un vote réhabilite l'appareil.
- Un appareil possède une seule identité et une seule voix, même s'il a plusieurs écrans.
- Les capteurs seuls ne votent pas actuellement. Un futur validateur sans écran devra déclarer une capacité explicitement autorisée.
- Le vote d'animation complet, recalculant chaque image, n'est pas généralisé. Le vote v1 d'animation reste transitoire et ne prouve pas le contenu du clip.

## 5. Taxonomie matérielle

La définition canonique est dans `TAXONOMIE_FAMILLES_COMPOSITIONS_MATERIELLES.md` :

- un écran physique : **mono-écran** ;
- deux écrans physiques ou plus : **multiscreen** ;
- ajouter seulement un capteur ne change pas la famille ;
- famille fonctionnelle, plateforme, profil matériel et cible OTA sont distincts ;
- une famille mutualise les briques, mais une release OTA cible le profil exact.

Le montage de Claude2, `dev_T46HBXG1`, est donc fonctionnellement un multiscreen ESP8266 + e-ink 2,9″ BWR + OLED + DHT22. Le code publié à `ed441d8` emploie encore le modèle transitoire BWR + capacité `anim-oled`; sa migration vers deux écrans réseau réels est un chantier actif non encore intégré à `main`.

## 6. État matériel synthétique

Les détails et les preuves sont dans la matrice. Cette table évite de reprendre une ancienne note comme vérité courante.

| Composition | État le plus solide au 29/10/2026 |
|---|---|
| ESP8266 + TFT 1,8″ | vote, frame, ACK, portail et premier OTA Internet observés ; ancien montage matériel désormais remplacé par la station R4 |
| ESP8266 + e-ink 2,9″ BWR | vote, affichage, ACK, portail et OTA Internet observés |
| ESP8266 + e-ink 2,7″ BW | compilation/hôte ; preuve matérielle plus limitée |
| ESP8266 + e-ink 2,7″ BW + OLED | multiscreen historique : affichages, ACK, vote et OTA observés ; marge mémoire OTA très faible |
| ESP8266 + e-ink 2,9″ BWR + OLED + DHT22 | BWR, capteur et OTA ont des preuves matérielles ; OLED d'animation installé sous modèle transitoire ; release 2.14 publiée pour corriger le bus I²C, résultat matériel final à indexer ; migration multiscreen active |
| R4 + e-ink 2,9″ BWR | affichage, ACK, vote et portail observés |
| R4 + TFT 2,8″ tactile + SD | image, animation, ACK et vote observés |
| R4 + TFT 1,8″ + DHT22 + SGP40 + SD | station réelle : capteurs, SD, réseau et votes observés ; matrice/rapport récent à consulter pour l'affichage et l'OTA exacts |
| R4 + e-ink 2,7″ + OLED | profil multiscreen présent ; niveau matériel à confirmer dans la matrice |
| R4 + DHT22 sans écran | mesures envoyées ; pas de vote |

## 7. OTA — formulation exacte

### ESP8266

L'OTA Internet signée est matériellement prouvée sur au moins trois profils : TFT 1,8″, e-ink 2,9″ BWR et multiscreen e-ink 2,7″ + OLED. Chaque nouvelle composition et chaque release gardent toutefois leur propre canari, notamment à cause de la fragmentation du tas et des profils de flash.

`dev_T46HBXG1` a reçu plusieurs releases ciblées jusqu'au modèle BWR + OLED. La présence d'un manifeste dans `ota-releases` prouve sa publication, pas son installation. La réussite matérielle de chaque séquence doit être reliée à un rapport ou journal.

### UNO R4 WiFi

Le dépôt contient un client OTA R4, la vérification de manifeste, le staging, la relecture de flash et des canaris matériels. Le porteur rapporte deux essais OTA Internet réussis sur R4, suivis du portail, de la reconnexion, de la réception et du vote. Cette information doit être conservée, mais les commits, releases et journaux exacts doivent encore être rassemblés dans la matrice pour passer de « rapporté par le porteur » à une preuve canonique reproductible. Les anciennes phrases « aucune OTA R4 Internet » ne doivent donc plus être présentées comme une vérité définitive ; elles décrivent un état antérieur ou une preuve incomplètement indexée.

## 8. Application web et UX

Les jalons UX 1 à 5 sont dans `main` : navigation responsive, accueil recomposé, choix Dessiner/Animer selon capacités, matrice mobile, panneau de mesures partagé, dialogues accessibles et tests Playwright séparés.

Limites connues : Chromium principalement, pas d'audit complet lecteur d'écran/contraste, styles encore hétérogènes sur certaines pages, snapshot réseau non borné pour un réseau de très grande taille.

## 9. Travaux actifs au 29/10/2026

1. Migration de Claude2 vers un vrai profil multiscreen BWR + OLED + DHT22 : firmware `multibwr-2.1` compilé et testé sur l'hôte, release de migration signée (`eink29bwr-2.15-ota16`) **non publiée** ; branche `claude/multibwr-migration` ; bloqué avant le canari par un GO matériel explicite (`docs/LOT_MULTIBWR_MIGRATION_2026_10_29.md`).
2. Consolidation de la matrice et de la taxonomie dans l'application.
3. Indexation des preuves OTA R4 Internet rapportées par le porteur.
4. Vote d'animation complet et activation progressive par famille.
5. Scalabilité du snapshot réseau et maîtrise des quotas Redis.
6. Nettoyage Git/documentaire pour travailler depuis plusieurs ordinateurs.

## 10. Raccourcis interdits

- Une note disant « compilé seulement » peut avoir été dépassée par un canari ultérieur.
- Une branche non fusionnée n'est pas automatiquement une fonctionnalité manquante.
- Une release présente dans Git n'est pas une preuve d'installation.
- Une brique validée ne valide pas automatiquement une nouvelle composition.
- Aucun secret, dump de flash, Wi-Fi, clé privée ou cookie ne doit entrer dans Git.

## 11. Reprise rapide

```text
git fetch --all --prune
git status
git switch main
git pull --ff-only
```

Si le checkout est sale ou divergent, ne pas le réinitialiser. Créer un worktree ou une branche propre depuis `origin/main`, puis inventorier le travail local. Lire ensuite `AGENTS.md`, ce document, la taxonomie et la matrice.
