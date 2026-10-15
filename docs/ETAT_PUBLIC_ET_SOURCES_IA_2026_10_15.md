# État public du projet et sources lisibles par les moteurs et les IA — 15/10/2026

Lot documentaire isolé (branche `claude/documentation-ai-seo-current-state-2026-10-15`, basée sur `main` à `f6f648e`, déployé). **Aucun firmware, aucun flash, aucune modification Redis / Neon / vote / quorum / polling.** Objectif : que ce qu'un visiteur, un moteur de recherche ou une IA lit sur le projet corresponde à ce qui est réellement déployé.

## 1. Source de vérité

`lib/projectStatus.ts` (module pur, typé) contient les faits courants : date de vérification, blocs de preuve, familles validées et à qualifier, description du vote, limites, formulation canonique du modèle de confiance, pages publiques. Il est relu par :
- `/llms.txt` (`lib/llmsTxt.ts`) ;
- la métadonnée globale et le JSON-LD (`app/layout.tsx`), `robots.txt` et `sitemap.xml` ;
- la page Apprendre (`SynthesisPath.tsx` : blocs, limites, modèle de confiance).

Le README, `AGENTS.md`, `CLAUDE.md` et la feuille de route (`roadmap.ts`) restent rédigés à la main (lisibilité) mais sont **gardés par `tests/publicState.test.ts`**, qui refuse les anciennes affirmations et vérifie la cohérence avec la source. **Pour changer un fait public : modifier `lib/projectStatus.ts`, citer la preuve datée dans `docs/`, relancer les tests.**

## 2. Faits canoniques inscrits (tous avec preuve)

| Fait | Preuve |
|---|---|
| Le vote v2 réel est opérationnel : les appareils recalculent hash et métriques entières, signent en Ed25519 ; le serveur vérifie la signature (mode strict) | `docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md` |
| Blocs réels minés par quorum multi-appareils : #100, #101, #103, #104 | idem + `docs/mesures/TFT28_ACK_BLOC104_2026_10_15/` |
| #104 : 2 votes v2, 0 vote v1, 0 rejet (TFT 2,8″ + ESP8266 e-ink 2,9″) | `docs/mesures/TFT28_ACK_BLOC104_2026_10_15/bloc_104.json` |
| #101 comptait encore **un vote v1** d'un ancien appareil (avant le correctif qui les refuse) | synthèse du 14/10/2026 § 1 |
| Validateurs v2 observés sur la carte : UNO R4 e-ink 2,9″, UNO R4 TFT 2,8″, ESP8266 e-ink 2,9″, ESP8266 multiscreen | blocs #100, #101, #103, #104 |
| Un appareil incapable de voter reçoit les œuvres, mais jamais `pendingValidation`, ne vote pas, ne compte pas dans le quorum | `docs/LOT_REJECTED_ARCHIVE_FIX1_ET_AUDIT_RECEPTION_2026_10_15.md` § 4 |
| L'ACK du TFT 2,8″ décide du succès local ; firmware validé sur la carte | canari du 15/10/2026 |
| Cinq familles attendent leur qualification matérielle | `docs/RESTE_A_FAIRE_2026_10_14.md` (C1) |
| Animations : encore votées en v1 | `app/learn/components/SynthesisPath.tsx` (« Affichage dynamique ≠ validation dynamique ») ; `pod-anim-v3` inactif |
| OTA non généralisée ; Proof-of-Display Duration = piste de recherche | feuille de route |

## 3. Contradictions supprimées

| # | Contradiction | Correction |
|---|---|---|
| 1 | `AGENTS.md` daté du 16/05/2026, Ed25519 réelle en « V2 — Roadmap » | statut courant en tête ; sections datées marquées historiques ; Ed25519 listée comme livrée ; consigne « ne pas déployer sans autorisation explicite » |
| 2 | README : « tout vote réel matériel reste à valider » (résumé anglais, § Cycle d'une œuvre, § État) | remplacé par l'état courant, blocs #100–#104 |
| 3 | Table README « vote non validé » partout | colonne « Vote v2 observé sur la carte » ; qualifications restantes listées |
| 4 | `SynthesisPath` : « les votes anciens (écho) sont encore comptés » ; « un appareil non appairé peut encore voter » | N1 : votes v1 refusés depuis le 14/10/2026 ; l'appairage est exigé ; limites réelles conservées (vote par appareil, auteur votant) |
| 5 | `roadmap.ts` : non-votants « reçoivent » seulement s'ils votent | « reçoivent les œuvres, jamais de demande de validation, ne comptent pas dans le quorum » |
| 6 | Ligne TFT 2,8″ : « validé » et « reste à reprendre » ; ligne « Écrans » : « à essayer pour le vote » | notes réécrites (#100, #103, #104, ACK validé) |
| 7 | Pile Ed25519 R4 et réseau TLS R4 « en cours / micro-canari à faire » | passées à `done` avec la preuve (canaris, votes réels) |
| 8 | Licence : page Apprendre « MIT » et « CC0 » vs README « aucune licence, droits réservés » ; ZIP de firmware « Licence : MIT » | alignées sur le README (voir § 5) |
| 9 | Table des firmwares de la page Apprendre : « Testé en réel » pour des familles dont le vote n'a jamais été observé | colonne d'état = vote observé / à qualifier |
| 10 | Profil d'installation R4 e-ink 2,9″ « doit être validé sur une carte physique » | `testedOnHardware: true` |
| 11 | `CLAUDE.md` : « le vote v2 des ESP8266 et R4 e-ink n'a jamais tourné sur la carte » | mis à jour ; bandeau « sections datées = historiques » |

Documents datés conservés intacts : tous les `docs/` historiques ; trois (`CHANTIER_VALIDATION_REELLE`, `REPRISE_2026_10_06…`, `PLAN_DE_TRAVAIL_CONSENSUS_FINAL…`) portent désormais un bandeau « DOCUMENT HISTORIQUE » renvoyant à cet état, sans autre modification.

## 4. Limites encore affichées publiquement
Chaîne centralisée (pas une blockchain publique) · clés en EEPROM/flash sans secure element · ACK = preuve applicative, pas optique · vote par appareil, auteur votant · votes signés complets non conservés dans le bloc · animations votées en v1 · OTA non généralisée · cinq familles à qualifier · Proof-of-Display Duration = recherche · droits du code réservés, régime des œuvres à décider.

## 5. Licence — décision à prendre
Aligné sur le README : **aucune licence logicielle générale accordée, droits réservés**. La page Apprendre annonçait MIT (code) et CC0 (œuvres) ; le dépôt ne contient ni fichier de licence ni mention MIT ailleurs, et la route de téléchargement des firmwares disait « MIT — code libre » : corrigées.
**Œuvres (CC0)** : le parcours de soumission (`/draw`, `POST /api/draw`, `submit-candidate`) ne recueille **aucun consentement explicite** à CC0 ; seule la page Apprendre et un texte du ZIP de firmware l'affirmaient. L'affirmation catégorique est retirée. **Décision à prendre par le porteur** : (a) ajouter une case de consentement explicite lors de l'envoi puis annoncer le régime choisi ; (b) ne rien annoncer ; (c) licence ouverte pour le code. Aucun nouveau régime juridique n'est créé par ce lot.

## 6. Surfaces d'indexation
| URL | Contenu |
|---|---|
| `https://proof-of-draw.vercel.app/robots.txt` | accueil et pages publiques autorisés ; `/api/`, `/profile`, `/my-devices`, `/bench`, `/draw-lab`, `/onboard` exclus ; sitemap déclaré. **Pas une barrière de sécurité** (les API ont leurs propres contrôles) |
| `https://proof-of-draw.vercel.app/sitemap.xml` | `/`, `/learn`, `/network`, `/gallery`, `/artists`, `/draw`, `/animer`, `/gallery-ana` (statique : aucune requête Redis, pas de page d'artiste ni de bloc individuel) |
| `https://proof-of-draw.vercel.app/llms.txt` | description, état vérifié daté, vote v2, blocs, matériel validé / à qualifier, modèle de confiance, limites, licence, liens canoniques. **Convention de lisibilité, pas un standard obligatoire ; aucune garantie de comportement des IA** |

Métadonnées : `metadataBase`, description réelle, OpenGraph, Twitter (`summary`), `robots`, `manifest`, canoniques par page (accueil, Apprendre, galeries), auteur = dépôt `Rescoe` (établi par l'URL du dépôt). JSON-LD sobre : `WebSite` + `SoftwareSourceCode` (dépôt, langages) — **aucun prix, organisation ni licence**. Manifeste : « Proof-of-Draw », ESP8266 + UNO R4, e-ink/OLED/TFT ; l'icône reste `logo.png` (48 × 56) : aucune nouvelle image créée.

## 7. Vérifications (voir le commit)
Tests ciblés (`publicState`, `lot0sWording`, `learnRoadmap`, `learnInstallProfiles`), `tsc --noEmit`, ESLint sur les fichiers touchés, `git diff --check`, `next build` avec la méthode locale documentée. **Pas** de suite C++ complète, aucun flash.
