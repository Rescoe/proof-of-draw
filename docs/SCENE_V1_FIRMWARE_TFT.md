# scene-v1 — firmware TFT 1.8" (phase 2)

Statut : **code écrit, compilé pour l'ESP8266, vérifié sur PC contre le moteur de référence — PAS encore testé sur le matériel.**
Firmware : `esp8266/esp_tft1.8/esp_tft1.8.ino` (version `tft18-2.0`) + `esp8266/esp_tft1.8/ana_scene_v1.h`.
Contrat : `docs/SCENE_V1_MOTEUR.md` (variantes, paquet `ANAS`, livraison).

## Ce que fait le firmware

```
register   → déclare sceneCapability {sceneV1:true, maxPackageBytes:4096, maxEntities:24, maxFps:2, dirtyRectangles:true}
pull       → kind:"scene" + scene{artifactId, bytes, hash, tickRate, fps, durationTicks, loopCount, playMs}   (sinon image fixe, comme avant)
téléchargement  GET /api/pull-frame?kind=scene&artifactId=…&fmt=bin   → paquet ANAS (≤ 4 Ko), malloc(bytes) puis free
vérification    Content-Length = bytes annoncés · CRC32 · toutes les règles du contrat · profil tft18 · 8 octets de hash = ceux de /api/pull
FERMETURE TLS   (le client HTTPS vit dans fetchScenePackage) — plus aucune requête jusqu'à la fin de la lecture
lecture         malloc(10 240 o) tampon image 4 bits → tick 0 plein écran, puis seulement le rectangle sale de chaque tick
fin             free · burnTFTCartel() sur la dernière frame · POST /api/ack-frame {mode:"scene"}
```

- **Cadence** : `min(tickRate, 2)` FPS, **aucun tick sauté** (une scène à 5 ticks/s joue 2,5× plus lentement). Échéancier absolu : pas de dérive cumulée.
- **Rendu** : le firmware re-rend toujours la frame entière en RAM (une passe, ~1 000 à 25 000 pixels tracés) puis ne retransmet au TFT que le **rectangle sale**
  (union des boîtes des seules entités dont le décalage change entre deux ticks — identique octet pour octet à `dirtyRectBetween` du moteur TypeScript).
- **ACK après la lecture** (contrat §6) : si l'appareil redémarre en cours de route, la frame est encore en attente et l'animation reprend.

## Mémoire (ESP8266, ~47 Ko de tas après WiFi)

| Poste | Taille | Quand |
|---|---|---|
| Paquet ANAS | ≤ 4 096 o (`malloc`) | du téléchargement à la fin de la lecture ; alloué **avant** le TLS (petit), jamais pendant la lecture d'une autre scène |
| Tampon image 4 bits/pixel | 10 240 o (`malloc`) | **uniquement pendant la lecture, TLS fermé** (règle du projet : jamais un gros buffer avec BearSSL) |
| Ligne RGB565 | 256 o (pile) | pendant l'envoi |
| Table sinus Q15 | 512 o | permanent |
| Flash | +11 Ko vs `tft18-1.0` | compilé : `.text` 39 267 → 50 525 o |

Si `malloc` échoue (tas fragmenté) : repli **image fixe**, sans erreur ; le Serial indique `SCENE-NOMEM` avec `heap` et `maxBlock`.

## Politique d'échec

| Cas | Comportement |
|---|---|
| pas de pointeur exploitable, `404` (le serveur n'a pas de scène pour nous), tampon impossible | image fixe (`doFetchFrame`), sans bruit |
| paquet tronqué, `Content-Length` ≠ annoncé, CRC/règle invalide, hash ≠ celui de `/api/pull` | **on garde l'affichage, aucun ACK**, nouvel essai au pull suivant |
| 2 échecs de paquet pour le même `frameId` | image fixe |
| coupure WiFi **après** vérification | l'animation se joue en entier (aucune requête pendant la lecture) |

## Mesures à faire sur le matériel (ce que je ne peux pas faire)

À la fin de chaque lecture le Serial (115200) affiche :

```
[SCENE] lecture: 50 ticks × 3 boucle(s), 2 FPS (scène 5, écran max 2), 500ms/frame
[SCENE] terminé: 150 frames en 75012ms (cible 75000ms) — rendu moy/max … us, envoi TFT moy/max … us, pixels poussés …, dépassements N, tas min …
```

À me rapporter pour **valider 2 FPS** puis décider du passage à 4 FPS (contrat : seulement après mesure) :
1. `envoi TFT max` et `rendu max` < 500 ms (tranche à 2 FPS) ; `dépassements` = 0 ;
2. `tas min` et `[SCENE-PLAY-START] heap / maxBlock` : le `malloc(10 240)` passe-t-il toujours ? ;
3. `pixels poussés` vs « plein écran » : le gain des rectangles sales en conditions réelles ;
4. aucun reset watchdog sur une scène de 50 ticks × 3 boucles (≈ 75 s) ;
5. visuellement : l'écran final = l'aperçu de la galerie (onglet **Scène** du détail d'œuvre) ; pas de décalage de 1-2 px (le module utilise `INITR_BLACKTAB`).
Pour tester 4 FPS : `SCENE_MAX_FPS 4` **et** ajouter la classe `f4` à `SCENE_CAPABILITY_CLASSES.tft18` côté serveur (`lib/scene/delivery.ts`).

## Procédure de test de bout en bout

1. Flasher `esp_tft1.8.ino` (le dossier du sketch contient `ana_scene_v1.h`) ; renseigner `WIFI_SSID` / `WIFI_PASSWORD`.
2. Au boot, le Serial doit afficher `[BOOT] … v2.0 (scene-v1)` puis un register réussi (la capacité est enregistrée avec l'appareil).
3. Côté ANA, rétro-compiler une œuvre générative depuis l'admin (ex. Neon Pulse Canvas) pour qu'elle ait une scène ; activer « œuvres ANA » sur l'ESP.
4. Au pull suivant : `[PULL] … kind scene` → `[SCENE] reçu N/N octets` → lecture → `[ACK] … OK`.
5. « Mon profil → Affichage en direct (debug) » : `Nature … · scène animée jouée` pour l'écran TFT.

## Vérifié sans matériel (`npm test`, `tests/sceneV1Firmware.test.ts`)

Le MÊME `ana_scene_v1.h` est compilé avec g++ et comparé au moteur TypeScript :
frames TFT et OLED de **tous les ticks** de 6 scènes identiques octet pour octet ; hashes des golden vectors reproduits ; rectangles sales identiques ;
lecture complète « frame entière puis uniquement les rectangles » = frames de référence (2 boucles) ; paquet tronqué à chaque longueur / octet modifié refusé ;
**validation différentielle** : sur ~2 700 paquets mutés (CRC re-signé) le firmware accepte et refuse exactement comme le parseur TypeScript.
Le fichier est aussi cross-compilé avec `xtensa-lx106-elf-g++ -Werror` et le sketch complet compile contre le cœur ESP8266 3.1.2.

## Pas fait

- **Phase 1 (OLED)** : non commencée. `ana_scene_v1.h` est déjà prêt pour l'OLED (profil 1, `toOledBuffer` testée) ; il restera à l'intégrer au firmware `esp_eink_2.7BW_OLED` (copie identique du header, vérifiable par le test).
- Test matériel TFT, mesure des temps réels, benchmark 4 FPS.
- Lecture « en boucle infinie » : les boucles sont bornées (≤ 3) puis l'écran garde la dernière frame (contrat).
