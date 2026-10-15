# Ce qu'il reste à faire — état au 14/10/2026 (fin de journée)

> **Mise à jour du 15/10/2026 (état courant : `docs/ETAT_PUBLIC_ET_SOURCES_IA_2026_10_15.md`).** Déployés sur `main` (`f6f648e`) : réception maintenue (le point B1 ci-dessous est **abandonné** : la réception est maintenue pour tous), archive des rejets `REJECTED-CANDIDATE-ARCHIVE-1` + `FIX1` (B4 **fait**), `TFT28-ACK-STATE-FIX1` validé sur la carte (C2 **fait**, aucun nouveau flash requis), preuves du bloc #104. Reste à observer en production : `docs/VERIFICATIONS_POST_DEPLOIEMENT_REJETS_RECEPTION_2026_10_15.md`. Pas de reset global : fork en cas d'évolution incompatible.

Contexte : le vote réel v2 est en production (blocs #100, #101, #103). Ce document liste **tout ce qui reste**, classé par ordre de priorité conseillé, avec pour chaque point l'effort estimé (S = quelques heures, M = une demi-journée à une journée, L = plusieurs jours), et si cela demande un reflash. Les références (`docs/…`) sont dans le dépôt.

## A. À faire en premier (court, utile)
| # | Sujet | Pourquoi | Effort | Reflash |
|---|---|---|---|---|
| A1 | **Rejouer la suite de tests complète sur `main`** (+ harnais C++ et `learnRoadmap`) | elle n'a pas été rejouée depuis la fusion (choix du 14/10 pour aller vite) ; il faut le constat final | S (tourne en tâche de fond, ≈ 25 min) | non |
| A2 | **Vérifier dans Vercel** : `STRICT_SIGNATURE=true`, `MIN_V2_APPROVALS=1`, pas de `VOTE_ONLY_NETWORK=false` | non lisible depuis le dépôt ; le comportement observé (#103) est cohérent mais pas prouvé | S | non |
| A3 | **Classer les appareils inconnus** vus dans les pools : `dev_1Z175056`, `dev_VIRBQRV1` (TFT 1,8″), `dev_WZ0U0514`, `dev_YIALM6LG`, `dev_0HWXIKJM`, `dev_3XLCW1KO`, `dev_7GUJIOCM`, `dev_HF615EF9`, `dev_V0VR30AY`, `dev_9MN414IJ`, `dev_R8Q69GOH` (OLED), `dev_T46HBXG1` (ami, firmware `2.0`) | tous sont désormais **coupés** (rien reçu, aucun vote) ; à reflasher (si à vous) ou à laisser | S | oui, pour ceux à reflasher |
| A4 | **Récupérer l'accès de l'ami** : lire `pairCode` de `device:dev_T46HBXG1` dans Upstash, lui faire ouvrir `/onboard?code=…` dans son vrai navigateur (pas Snapchat) | son profil est retrouvé sans rien perdre ; son appareil restera coupé tant qu'il n'est pas reflashé | S | oui (pour qu'il revote) |
| A5 | **Décider du fichier** `docs/VISION_LONG_TERME_OEUVRE_RESEAU_APRES_FXHASH_2026_10_13.md` (non suivi, préexistant) | à commiter ou à garder hors dépôt ; je n'y ai pas touché | S | non |

## B. Petits lots serveur/app (optionnels, ordre libre)
| # | Lot proposé | Ce que ça apporte | Effort |
|---|---|---|---|
| B1 | **Diffuser les blocs seulement aux appareils capables** | aujourd'hui chaque bloc écrit ≈ 13 `SET` de frames (dont ≈ 9 pour des appareils exclus, ≈ 205 Ko pour un TFT 2,8″) : économie de commandes et de volume Upstash | S |
| B2 | **`/api/register` rafraîchit aussi `lastPing`** | après un Reset, un appareil redevient votant tout de suite au lieu d'attendre jusqu'à ≈ 10 min ; à revalider avec le quorum (GPT l'a classé non bloquant) | S |
| B3 | **Suivi en direct du candidat** dans l'app (votes reçus / quorum / appareils en attente) | voir un vote avancer sans lire Redis | M |
| B4 | **Archive des candidats refusés** (`REJECTED-CANDIDATE-ARCHIVE-1`) | l'onglet « Rejetés » lit `rejected:draws`, que **personne n'écrit** : un candidat refusé disparaît | M |
| B5 | **Rythme de réveil** (`PULL_DORMANT_SEC`, 900 s) | les ESP8266 ne voient un candidat qu'après 5 – 15 min ; passer à 300 s ≈ ×3 de commandes de repos : décision de budget Redis | S (une variable) |
| B6 | Corriger l'export `FIRMWARE_VARIANTS` dans `app/api/esp-firmware/route.ts` | `next build --webpack` échoue sur ce fichier (existait avant ; la build par défaut passe) | S |

## C. Firmware (demandent un reflash)
| # | Sujet | Détail | Effort |
|---|---|---|---|
| C1 | **Essayer le vote des familles « autorisées mais jamais vues »** | la liste `VOTE_V2_FIRMWARE` autorise aussi `eink27bw` (ESP8266 e-ink 2,7″ seul), `tft18` (ESP8266 TFT 1,8″), `r4eink27`, `r4multiscreen`, `r4tft18` : leur vote n'a **jamais** tourné sur la carte. Les essayer, ou les retirer de la liste en attendant | M |
| C2 | **`TFT28-ACK-STATE-FIX1`** (TFT 2,8″) | l'ACK d'une image est ignoré en production : écran « affiché » localement alors que le serveur ne l'a pas enregistré | M |
| C3 | **TFT 2,8″ : ≈ 4 min pour afficher le bloc #101** | cause non étudiée (journal série du TFT à lire) | S – M |
| C4 | ESP 2,9″ BWR : `e-Paper busy TIMEOUT` ×3 au rafraîchissement | l'image s'affiche malgré tout ; attente BUSY du pilote | S |
| C5 | Frame personnelle des appareils **multi-écrans** | réannoncée après un Reset (pas d'historique d'ACK par écran) ; accepté par GPT, amélioration possible | M |
| C6 | **Intégrer la branche des gestes tactiles** (`claude/r4-tft28-touch-gestures-8b2e`) | conflits attendus avec `pod_uno_r4.ino` (le firmware TFT a beaucoup changé) : à rebaser dans un lot propre | M – L |
| C7 | **Intégrer le R4 e-ink 2,7″** (`claude/hopeful-noether-ndz9ud`, client TLS borné) | ce n'est pas l'un des 4 appareils actuels | M |

## D. Dépôt et organisation
- **Dossiers de travail (worktrees)** : 6 existent encore dans `C:\Users\thibf\Documents\ChatGPT\ANA\worktrees\` (`esp27-oled-canary`, `touch-gestures`, `vote-audit`, `docs-etat`, `readme`, `local-resume`). Je ne les ai pas supprimés (leurs `node_modules` sont liés entre eux ; suppression sans risque à faire à la main, ou par un lot dédié). `local-resume` sert encore d'outillage (TypeScript) pour les contrôles locaux.
- **Branches locales restantes** : `codex/archive-nifty-hamilton-2026-10-12` et `codex/cloud-handoff-pullframe-fix1` (contiennent des commits locaux absents de GitHub : non supprimées).
- **GitHub** : il ne reste que `main` et 4 branches non fusionnées (`docs-etat`, `hopeful-noether`, `touch-gestures`, `codex/local-snapshot`). Toutes les anciennes branches ont leur sommet conservé par une étiquette `archive/2026-10-14/<nom>`.
- **`CLAUDE.md`** est très long (historique de tous les lots) : à condenser dans un lot de documentation.
- **Reset global des données** (annoncé avant l'exploitation réelle) : à préparer (quoi remettre à zéro : chaîne, appareils, profils, mesures ; quoi garder) ; rien n'a été préparé.
- **Phrase de bascule** : « réactiver les tests isolés » rend obligatoire le backend Preview (toute l'infrastructure est conservée).

## E. Chantier de fond (roadmap « Apprendre »)
Éligibilité des votants et comité (aujourd'hui éteints : l'auteur peut voter pour son propre candidat, tous vos appareils partagent un seul profil) ; reçus signés conservés dans le bloc ; noyau portable `consensusPoD` sur les appareils ; animations calculées (`pod-anim-v3`) ; rendu de référence et signature de rendu ; OTA ; explorateur public de blocs (PoDScan) ; compatibilité firmware *attestée* (aujourd'hui seulement déclarée).

## Ordre conseillé
A1 → A2 → A3/A4 (en parallèle) → B1 + B2 (un seul lot serveur, auditable) → C1 (décider quelles familles garder) → C2/C3 → B4 → le reste selon vos priorités.

## Constat final de la suite de tests complète sur `main` (14/10/2026, tête `d70e7ea`)
983 tests, **980 réussis, 3 échecs** : les 2 échecs **préexistants** `boundedSsl` (cœurs Renesas 1.5.3 et 1.6.0, présents avant tout ce travail) et 1 test de garde (`lot0sWording`) qui exigeait encore « TFT 2,8″ = non testé » — corrigé le jour même pour exiger à la place la preuve du 14/10/2026 (blocs #100 et #103) ; `lot0sWording` et `learnRoadmap` : 15/15 ensuite, `tsc` propre. C'est la première suite complète rejouée depuis la fusion de toutes les branches.
