# Clôture TEMPORAIRE — BWR + OLED, animations du réseau (28/10/2026)

Chantier suspendu en attente d'un fait : **la carte du cousin (`dev_T46HBXG1`, ESP8266 + e-ink 2,9″ BWR + OLED + DHT22) est figée depuis 21:31:25 le 27/10/2026** et n'a pas encore été débranchée / rebranchée. Ce document dit où l'on en est, ce qui est prouvé, ce qui ne l'est pas, et comment reprendre. Détail technique des changements : `docs/LOT_BWR_OLED_ANIMATIONS_2026_10_29.md` (§ 7 à 9).

## 1. État en une page

| Sujet | État |
|---|---|
| Firmware de la carte | `eink29bwr-2.13`, séquence OTA 14 (installée par OTA Internet le 27/10/2026 soir) : **la mise à jour a réussi** |
| Ce que la carte déclare | UN écran (`eink29bwr`) + capacité `anim-oled`. Elle ne déclare PAS l'OLED comme écran (cible souhaitée par le porteur : voir § 5) |
| Dernier signe de vie | 21:31:25 : téléchargement en 4 morceaux (200) de l'affiche du bloc #124. Ensuite : aucun ACK, aucun pull, aucun relevé DHT22 |
| Cause du silence | **INCONNUE** (blocage firmware pendant ou après l'affichage e-ink, ou coupure de courant / Wi-Fi). Aucune trace série |
| Animation chez les autres | Bloc #124 « Zombimouche_v2 » (animation) minée 21:29, jouée et acquittée par le TFT 2,8″, la station TFT 1,8″ et le multiscreen (OLED) |
| Vote des animations | v1 (écho signé), **décision du porteur : on garde v1 jusqu'au lot 8** (3 votes v1, 0 v2 sur #124) |
| Serveur | Poussé sur `main` (`bf570e0`, `3efe67b`), aucun firmware, aucune release OTA nouvelle |

## 2. Ce qui a été fait (serveur et interface, tout poussé)

1. **Remix / reprise d'une animation = l'animation entière.** Avant : « Reprendre ce dessin » d'un rejet d'animation chargeait l'affiche (une image) dans le studio de dessin → ZombieMouche_V5 est devenue un dessin fixe. Maintenant : `/animer?resume={rejet}` ou `?remix={bloc}` rouvre toutes les images, délais et couleurs, en copie modifiable (`lib/anim/seedClip.ts`, `/api/rejected-image?clip=1`, `kind: "animation"` dans les entrées d'archive des rejets, bouton sur la page d'un bloc d'animation, renvoi depuis le studio de dessin).
2. **Livraison de l'animation par pointeur seul.** Plus aucune frame n'est écrite pour un e-ink (il garde son image). Une carte BWR à OLED déclaré reçoit le pointeur du clip dans `/api/pull` tant que le dernier bloc est cette animation et qu'aucune frame fixe n'est en attente (`animPullMeta(…, chainHead)`, 0 commande Redis de plus).
3. **Constellation / vue réseau.** Un écran qui joue une animation montre sa boucle (clip rejoué, CDN, 0 commande Redis par vignette : `app/network/AnimLoop.tsx`). L'OLED des BWR en ligne apparaît comme second écran (pseudo-écran `oled096aux`, hors pools) et comme jouant le dernier bloc d'animation. **Annoncé, pas confirmé** : le firmware 2.13 ne renvoie aucun accusé de lecture.
4. **Formulaire d'envoi d'animation** : « Écran d'origine (signe l'œuvre) » ; l'animation validée va à TOUS les écrans dynamiques capables (inchangé côté serveur).

## 3. Ce qui est prouvé / non prouvé

Prouvé (Redis, lecture seule) : version 2.13 installée ; chemin serveur correct (pointeur et frame bien parvenus à la carte à 21:31:19) ; trois écrans dynamiques ont acquitté l'animation.
**Non prouvé** : tout ce que fait réellement le firmware 2.13 avec un vrai OLED (téléchargement du clip avec le tas réel, validation en flux, lecture en boucle, reprise après redémarrage) ; la cause du gel. Le code est testé sur l'hôte (18 mutants) et compilé, jamais observé sur un OLED réel.

## 4. Pour reprendre (quand le cousin aura débranché / rebranché)

La sonde `scripts/_watch_t46.ts` (lecture seule, locale, non commitée) suit le journal serveur de la carte, son ping et sa frame en attente. Même sans capture au moment du redémarrage, relire :
- `devlog:dev_T46HBXG1` (Redis, 25 dernières entrées) : un `pull` après 21:31 prouve le redémarrage ; `ack`, `image`, `capteur` disent jusqu'où elle va ;
- la fiche `device:dev_T46HBXG1` (`lastPing`, `firmware`) ;
- l'absence de `frame:dev_T46HBXG1:eink29bwr` (la frame de #124 a expiré : le redémarrage ne repasse plus par le rafraîchissement e-ink).

Lecture des résultats :
- **tire + télécharge le clip + OLED en boucle (la constellation l'annonce déjà)** : le chemin 2.13 fonctionne ; le portage double écran devient une amélioration, non une urgence ;
- **tire mais ne joue pas / se fige de nouveau** : défaut du firmware 2.13 → branchement série obligatoire, puis portage double écran (§ 5) ;
- **ne tire plus du tout** : coupure d'alimentation ou de Wi-Fi côté cousin avant toute conclusion firmware.

## 5. Suite décidée en principe, NON commencée

**BWR + OLED comme le 2.7BW + OLED** (concept « famille multiscreen »), à la demande du porteur : la carte déclare elle-même `["eink29bwr","oled096"]` ; l'OLED a sa pool, ses dessins `oled096`, son ACK et reçoit les animations par le chemin normal. Il faut : porter la logique double écran de `esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino` dans `esp_eink_2.9BWR` (frame par écran, frame OLED de 1 024 o, ACK avec `screen=`, écran capteur au repos), autoriser la famille `eink29bwr` dans `ANIM_POINTER_FIRMWARE` pour `oled096`, retirer `anim-oled`, l'écran fantôme et le pointeur par la tête de chaîne. **Contrainte : la mémoire du BWR** (deux plans de 4 736 o + TLS, déjà un plantage OOM le 24/10, `docs/PLAN_*` « récupérer 3 Ko de RAM »). **Pas d'OTA à distance sans GO du porteur, et pas avant une mesure sur un vrai OLED** (le banc `dev_MN67OG7R` n'en a pas ; le porteur n'a pas de banc avec OLED). Une carte figée ne reçoit pas d'OTA.

## 6. Question ouverte (produit)

Les écrans dynamiques qui reçoivent les animations reçoivent AUSSI les œuvres fixes : (1) celles de leur propre type via la pool native ; (2) celles des autres types, converties, car `acceptsConvertedScreens` vaut « tous les écrans » par défaut (réglage par écran, `lib/deviceStore.ts`). Souhait du porteur : un réglage par écran « afficher aussi les œuvres fixes », **désactivé par défaut pour tous**. Non implémenté ; changerait le comportement de tous les écrans existants (station TFT 1,8″, TFT 2,8″, multiscreen) — voir la réponse dans la conversation pour les options.
