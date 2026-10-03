# Animations : faisabilité sur ESP8266 (OLED, TFT 1.8") et essai « plus grand, en couleurs »

Rédigé le 03/10/2026. **Les chiffres de temps ci-dessous sont des estimations de conception, pas des mesures** : sur le matériel, seul le TFT 2.8" (UNO R4 WiFi) a été mesuré
(travail moyen 2,5 à 14 ms par image, voir `BENCH_ANIMATION.md`). Les écrans ESP8266 sont à mesurer demain avec le banc d'essai : c'est précisément son rôle.

## 1. Ce qui est déjà fait (03/10/2026, compilé, jamais essayé sur la carte)

| Écran | Firmware | Ce qui est joué | Statut |
|---|---|---|---|
| TFT 2.8" (UNO R4) | `r4tft28-2.3` | clip 128×64 agrandi ×1,875 | **validé sur le matériel** |
| TFT 1.8" (ESP8266) | `esp_tft1.8` v2.1 | clip 128×64 en 1:1 au centre du 128×160 (y = 48) | ⚠ écrit, compilé, **non testé** |
| OLED 0,96" (ESP8266, e-ink 2.7" + OLED) | `esp_eink_2.7BW_OLED` v2.1 | clip 128×64 en 1:1 (`drawBitmap` + `display()`) | ⚠ écrit, compilé, **non testé** |

Le lecteur (`pod_bench.h`) est **commun** et testé sur PC contre le décodeur TypeScript, avec de faux écrans : après chaque image affichée, l'écran simulé (128×160 pour le TFT 1.8",
bitmap 128×64 pour l'OLED) est comparé à l'image attendue (aucun pixel hors fenêtre, aucune fenêtre à moitié remplie, une transaction par image, boucles et retour à l'image 0).
Ce qui n'est **pas** couvert par ces tests : le réseau (TLS BearSSL), la mémoire réelle de l'ESP8266, le temps réel de l'écran, le bus I2C / SPI logiciel.

## 2. Analyse de faisabilité — ESP8266

### 2.1 OLED SSD1306 128×64 (I2C)
- **Format** : celui du clip. Une ligne = 16 octets, bit 7 = pixel de gauche : c'est exactement le format `Adafruit_GFX::drawBitmap`. Aucune conversion.
- **Coût d'une image** : `display()` envoie les **1 024 octets en entier** à chaque appel (la bibliothèque ne sait pas faire de mise à jour partielle) :
  ≈ 25 à 40 ms à 400 kHz, ≈ 100 ms à 100 kHz (réglage par défaut du firmware, d'où `Wire.setClock(400000)` pendant la lecture).
  **Plafond estimé : ≈ 25–30 images/s à 400 kHz.** Au-delà : écrire soi-même des fenêtres de pages/colonnes (commandes `0x21`/`0x22`) pour ne rafraîchir que ce qui change — non fait.
- **Mémoire** : clip (≤ 9 Ko) + copie de l'image courante (1 Ko) + l'artwork déjà gardé par le firmware (1 Ko). Le firmware libère l'artwork autour de chaque connexion TLS pour éviter
  la fragmentation ; le banc d'essai vérifie le plus gros bloc libre (≥ 17 Ko) avant de commencer.
- **Particularités** : le ticker (texte défilant) est suspendu pendant la lecture puis repris ; l'artwork est remis à l'écran à la fin ; la bascule SPI → I2C (e-ink ↔ OLED) est refaite comme `displayOLED()`.
- **Verdict** : **faisable**, risque faible côté format et affichage ; les inconnues sont la vitesse I2C réelle de la bibliothèque `Wire` de l'ESP8266 (logicielle) et la mémoire.

### 2.2 TFT 1.8" ST7735 128×64 → zone du 128×160
- **Affichage** : 1 pixel du clip = 1 pixel écran, zone 128×64 posée à y = 48 (centrée). Seuls les octets modifiés sont repeints (même principe que le TFT 2.8").
- **Coût** : le firmware pilote ce TFT en **SPI logiciel** (bit-banging, parce que le bus est partagé avec la carte SD). Estimation : ≈ 3 à 5 µs par octet, soit ≈ 6 à 10 µs par pixel.
  Repeindre toute la zone (8 192 pixels) ≈ 50 à 80 ms (**≈ 12–20 images/s en pire cas**) ; une animation qui ne change que quelques octets par image va beaucoup plus vite.
- **Conséquence** : le TFT 1.8" est le plus lent des trois. Si la mesure est mauvaise, le levier est le SPI matériel (le bus est partagé avec la SD : il faudrait commuter comme le fait déjà le firmware pour la SD).
- **Mémoire** : confortable (aucun tampon plein écran : lignes de 128 pixels).
- **Fin de lecture** : l'image fixe précédente n'est **pas** gardée en mémoire (40 Ko) : l'écran affiche « Banc d'essai terminé » jusqu'à la prochaine image. Amélioration possible : restaurer depuis la carte SD (comme le R4).
- **Verdict** : **faisable** ; vitesse à mesurer.

### 2.3 Ce que l'ESP8266 a de mieux que le R4
80 Ko de RAM (≈ 40 Ko de tas libre après démarrage, contre ≈ 15 Ko sur le R4), pile 4 Ko, pas de limite de 1 Ko de pile pour Ed25519. Un clip plus gros ou des images en couleurs y entrent plus facilement.

## 3. L'essai « plus grand, en couleurs » (à faire en prochaine session)

### 3.1 Pourquoi pas tout de suite
Le format actuel (PBC1) est **strictement 128×64 en 1 bit** ; l'éditeur, le codeur, le lecteur, l'export GIF et les tests en dépendent. Passer à la couleur et à une plus grande taille est un **nouveau format**
(« PBC2 »), pas un réglage. Il vaut mieux le concevoir avec les contraintes mémoire en main plutôt que de le coder à l'aveugle en fin de session.
L'avis donné au porteur : **le format OLED est validé** (cadence tenue à 10 et 16,7 images/s sur le TFT 2.8", marge confirmée, boucle sans fin) ; il n'y a pas besoin de pousser plus loin ces tests pour ouvrir l'atelier d'animation.

### 3.2 Contraintes de mémoire (le vrai plafond)
| Carte | Tas libre au repos | Part utilisable pour clip + image courante | Conséquence |
|---|---|---|---|
| UNO R4 WiFi | ≈ 15 Ko (pile principale de 1 Ko) | ≈ 11–12 Ko | image courante ≤ ≈ 4,8 Ko, clip ≤ ≈ 7 Ko |
| ESP8266 | ≈ 40 Ko (TLS : 16 Ko contigus) | ≈ 20 Ko | image courante ≤ ≈ 10 Ko possible |

Avec une carte **SD** (R4 : pas encore flashée), le clip pourrait vivre sur la carte et l'image courante rester la seule contrainte RAM.

### 3.3 Proposition de format PBC2 (à valider avant de coder)
- En-tête étendu : `PBC2`, version, **largeur, hauteur** (en pixels), **bits par pixel (1, 2 ou 4)**, **facteur d'agrandissement entier (1, 2, 3, 4)**, **palette de 2/4/16 couleurs RGB565**, images, boucles, CRC32.
- Corps identique à PBC1 : image 0 brute (ou **compressée par plages** : le pixel-art s'y prête très bien) puis différences en plages d'octets ; la dernière transition ramène à l'image 0.
- Image courante en RAM : `largeur × hauteur × bpp / 8`. Combinaisons raisonnables (agrandissement entier, donc pas de ×15/8) :

| Cible | Définition source | bpp | Octets / image | Rendu | Tient sur |
|---|---|---|---|---|---|
| TFT 2.8" plein écran | 120×160 | 2 (4 couleurs) | 4 800 | ×2 → 240×320 | R4 (juste), ESP |
| TFT 2.8" large | 120×80 | 4 (16 couleurs) | 4 800 | ×2 → 240×160 | R4 (juste), ESP |
| TFT 2.8" 1:1 | 240×160 | 1 | 4 800 | 1:1 | R4 (juste), ESP |
| TFT 1.8" plein écran | 128×160 | 2 | 5 120 | 1:1 | ESP |
| OLED | 128×64 | 1 | 1 024 | 1:1 | tous (= PBC1) |

- **Éditeur** : palette (2/4/16 couleurs), pinceau couleur, remplissage couleur, aperçu fidèle ; l'export GIF utilise la palette telle quelle.
- **Lecteur** : même boucle (`playWith`), un `Renderer` couleur qui lit `bpp` bits par pixel et repeint les plages modifiées (fenêtre = octets × `8/bpp` × facteur de large, facteur de haut).
- **Tests** : mêmes tests différentiels que PBC1 (décodeur TS ↔ lecteur C++ sur des milliers de clips mutés ; écran simulé comparé image par image).
- **Effort estimé** : 1 à 2 sessions (format + éditeur couleur + lecteur + tests), puis un relevé sur le matériel.

### 3.4 Premier essai à faire sur le matériel (sans attendre PBC2)
Le TFT 2.8" a déjà de la marge (2,5 ms de travail par image pour 60 ms de délai) : **tester la limite de vitesse** avec le modèle « plein écran clignotant » (délai 20 ms) donne tout de suite la capacité de chaque écran, y compris les deux ESP8266 demain.

## 4. Décisions proposées
1. **Ouvrir l'atelier d'animation** (fait : `/animer`) — qualité OLED 128×64 noir et blanc.
2. **Mesurer demain** TFT 1.8" et OLED avec le banc d'essai ; consigner les mesures dans `BENCH_ANIMATION.md`.
3. **Ne pas** écrire PBC2 avant d'avoir ces mesures (elles fixent la taille d'image réaliste sur ESP8266).
4. Ports R4 de l'OLED et du TFT 1.8" : voir `PLAN_ANIMATIONS_ET_PORTS_R4.md` (même démarche que le port e-ink 2.9" BWR).
