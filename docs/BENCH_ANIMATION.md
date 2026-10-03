# Banc d'essai d'animation — TFT 2.8" tactile (v1, preuve de concept)

Statut : **code complet et testé sur PC (codeur, lecteur firmware, API) — PAS encore essayé sur la carte.** Page : `/bench` (lien « 🧪 Banc d'essai »
sur la carte de l'appareil dans Mon profil). Firmware : `r4tft28-2.1`.

## Le principe

On dessine une animation **128×64 en 1 bit** (comme sur l'OLED) ; elle est envoyée sous forme de **différences** entre images, et le firmware
ne repeint que les octets modifiés, agrandie **×1,875** au centre du 240×320 (même rendu que les dessins OLED envoyés sur cet écran).
L'écran garde lui-même l'image N-1 ; la R4 ne tient qu'une copie 1 Ko de l'image courante. **L'appareil renvoie ses mesures** (vitesse réelle).

```
App /bench  →  POST /api/bench/send  (le serveur ENCODE + plafonne)  →  Redis (clip ≤ 9 Ko, 1 h)
Écran       ←  /api/pull (toutes les 60 s) : { benchMode:true }  →  poll /api/bench/poll toutes les 3 s (30 min max)
            →  GET /api/bench/clip  (TLS fermé ensuite)  →  validation complète (CRC, structure, retour à l'image 0)
            →  lecture locale, horloge absolue, un toucher interrompt  →  POST /api/bench/result (mesures)
            →  œuvre remise en place depuis la carte SD si elle est présente
```

## Utilisation

1. Ouvrir `/bench`, choisir le TFT 2.8" et **Activer le mode banc d'essai** (l'écran le lit à son prochain contrôle : jusqu'à 1 min, puis « écran connecté »).
2. Dessiner (crayon, gomme, ligne, onion skin, délai par image, boucles, couleurs) ou charger un **modèle** : balle, vague, bruit léger, texte défilant,
   **plein écran clignotant (pire cas)** — c'est lui qui donne la limite de vitesse : baisser le délai jusqu'à voir des « images en retard ».
3. **Envoyer au TFT 2.8"** ; les **mesures** apparaissent sous le bouton (images/s réelles, temps de travail par image, retard max, débit de téléchargement, tas libre).

## Format de clip « PBC1 » (`lib/bench/clip.ts` ⇄ `arduino_uno_r4/pod_uno_r4/pod_bench.h`)

En-tête 20 o (`PBC1`, version, 128×64, N images ≤ 64, boucles ≤ 100, couleurs RGB565 allumé/éteint, nb de transitions, taille du corps) · image 0 entière
(1024 o) · N transitions « (délai ×10 ms, runs d'octets modifiés) » dont la dernière **ramène à l'image 0** · CRC32. Les petits trous (≤ 3 octets) sont fondus
dans le run voisin. **Plafond appareil : 9 216 octets** (le clip vit dans le tas de la R4 pendant la lecture) ; durée totale ≤ 120 s ; 20 ms ≤ délai ≤ 2,55 s.
Un octet source = 8 pixels = **exactement 15 pixels** à l'écran (×15/8) : pas de trou ni de chevauchement.

## Vérifié sans matériel

- `tests/benchClip.test.ts` : aller-retour codeur/décodeur (N = 1…64), différences minimales (1 octet changé ≈ 7 o), runs, pire cas refusé, clips altérés refusés, bornes.
- `tests/podBenchR4.test.ts` : `pod_bench.h` compilé avec g++ ; pour **chaque image affichée** l'écran 240×320 = l'agrandissement de l'image attendue (boucles, retour à l'image 0,
  couleurs), aucune fenêtre débordante, seuls les octets modifiés sont repeints ; **validation différentielle** sur ~2 100 clips mutés (CRC re-signé) : le firmware accepte et refuse
  exactement comme le décodeur TS.
- API testée en local : poll (verrou 2 s), clip absent, mesures bornées/refusées, envoi / mode / statut refusés sans session.

## À me rapporter après le premier essai

```
[BENCH] mode banc d'essai ACTIVÉ par l'app …
[BENCH] reçu en … ms — N images x L boucle(s)
[BENCH] lecture terminée : … images en … ms (prévu …) — travail moy … us, max … us, retards …
```
et la carte « Mesures » de la page. Questions auxquelles ça répond : **débit réel du Wi-Fi** (Ko/s), **temps de peinture par octet modifié**, **images/s maximales**
(pire cas = plein écran clignotant), **marge de tas** pendant la lecture.

## Ajouts du 03/10 (retour du premier essai)

- **Diagnostic « rien n'arrive »** : la page affiche maintenant la **version du firmware enregistrée** de l'écran et **alerte en rouge** si elle est < r4tft28-2.1
  (une 2.0 ignore le mode banc d'essai : aucun contrôle rapide, aucun téléchargement — c'est exactement ce qui s'était passé : la base disait `r4tft28-2.0`).
- **Journal du banc d'essai** (page `/bench`, 30 lignes / 24 h, `bench:log:{deviceId}`) : mode activé, clip envoyé, écran connecté (premier contrôle rapide), clip téléchargé, lecture terminée.
- **Export** : GIF animé ×4 aux couleurs de l'écran (`lib/bench/gif.ts`, vérifié par un décodeur LZW indépendant) ; projet `.json` (export + import).
- **Galerie « Animations »** (`/gallery-anim`, lien dans le menu) : les animations **faites à la main** y sont enregistrées (à l'envoi ou via « 💾 Galerie seule »), jamais les modèles de test
  (balle, vague, bruit… : un modèle chargé n'est « fait à la main » qu'une fois modifié). Dédoublonnage par empreinte du clip, 200 au plus. Chaque carte rejoue l'animation, exporte le GIF
  ou la rouvre dans le banc d'essai. Les dernières animations apparaissent aussi dans le **journal global** de l'accueil (étiquette `ANIM`).

## Éditeur d'animation (refonte du 03/10)

- **Annuler / rétablir** (↶ ↷, Ctrl+Z, Ctrl+Maj+Z / Ctrl+Y) : 100 pas. Un trait = un pas ; ajouter / supprimer / déplacer une image, charger un modèle, importer, générer un mouvement = un pas chacun.
  Annuler ramène aussi sur l'image modifiée et restaure l'état « fait à la main / modèle de test ». Réducteur pur : `lib/bench/history.ts`.
- **Outils** : crayon (P), gomme (E, ou clic droit), ligne (L), rectangle (R), ellipse (O) — contour ou plein —, remplissage (G) ; pinceau 1–8 px, carré ou rond ([ ]).
- **Aides** : onion skin précédente (orange) et suivante (bleu), grille d'octets (8 px = l'unité de coût d'une différence), coût en octets de chaque image, coordonnées sous le curseur.
- **Images** : ＋ ⎘ ✕, reculer / avancer dans la timeline, ← → pour naviguer, espace pour lire ; **inverser le sens**, **aller-retour**.
- **Transformer** : inverser, effacer, miroir, retourner, décaler (1–16 px, bouclé). **Mouvement** : génère N images en décalant l'image courante de (dx, dy) à chaque image.
- Les primitives (`lib/bench/draw.ts`) sont **pures** (copie sur écriture : l'historique ne copie que des références) et testées : `tests/benchDraw.test.ts`, `tests/benchHistory.test.ts`.

## Passer le banc d'essai « en réel » : faisabilité

| Niveau | Contenu | État |
|---|---|---|
| A. Traçabilité | journal par appareil (fait) + événements dans le journal global (fait) | ✅ |
| B. Galerie | enregistrement, rejeu, GIF, réouverture (fait) | ✅ |
| C. Chaîne complète | l'animation devient un **bloc** : candidat → validation par quorum (signatures Ed25519) → bloc miné → diffusion | à décider |

Pour C il faut : un nouveau type de charge utile « animation » dans les frames et les blocs (aujourd'hui une image fixe par écran) ; une **définition du score Proof-of-Draw d'une animation**
(rejeu des traits sur plusieurs images, variation entre images, durée) ; le vote des appareils qui ne savent pas l'afficher (e-ink : ils valideraient sur la 1re image) ; la diffusion par un
**pointeur dans /api/pull** (comme scene-v1) plutôt que par le poll rapide ; l'affichage dans l'explorateur de blocs. Charge réelle : ≈ 1 à 2 jours, surtout la définition du score
et la compatibilité des écrans qui n'animent pas. Recommandation : **valider d'abord l'écran physique** (ce banc), puis faire C en réutilisant le format PBC1 et le lecteur déjà testés.

## Limites connues / suite possible

- 1 bit, 128×64 seulement ; clip ≤ 9 Ko en RAM. Avec la carte SD : clips plus gros, lus depuis la carte (pas fait).
- Pas de flux en direct : le clip est téléchargé en entier, puis joué (c'est le plus robuste sur Vercel + Wi-Fi R4).
- Le mode banc d'essai accélère les contrôles (3 s pendant 31 min max) ; l'appareil le découvre via le pull normal (≤ 60 s).
- Évolutions : couleur (palette 4/16 couleurs), plus grande résolution native, rendu par bandes d'un manifeste scene-v1 (contrat à étendre avec ANA/GPT), compression des runs.
