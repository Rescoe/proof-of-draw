# Marge mémoire des ESP8266 pendant le TLS : le plantage OOM du BWR, l'historique, les pistes et les corrections (24/10/2026)

Statut : **diagnostic établi par mesures sur carte** (journal série du BWR `dev_MN67OG7R`, sonde TLS du 24/10) ; correctifs : **F()/PSTR en flash flashé et vérifié au démarrage**, **frame par morceaux écrite, compilée, NON encore essayée de bout en bout** (le serveur doit être déployé d'abord).

## 1. Le problème observé
Sur un BWR `eink29bwr-2.7` (DHT22 + température gravée), le téléchargement de la frame du bloc #116 a **planté 4 fois sur 5** : `Unhandled C++ exception: OOM`, redémarrage (`rst cause:2`), nouvelle tentative au pull suivant. La cinquième tentative a réussi. Conséquences constatées :
- un dessin voté et miné (bloc #116) qui n'apparaît pas sur la carte pendant plus de 20 minutes ;
- un `register` serveur toutes les 45 à 50 s (une ligne par redémarrage) sur `dev_MN67OG7R`, très probablement aussi `dev_T46HBXG1` et `dev_KAD6PKC4` ;
- la carte du copain affiche et acquitte, mais par chance : même exposition.
Le défaut est **préexistant** : le téléchargement fonctionnait par chance quand la marge était un peu plus grande.

## 2. Pourquoi « avant, ça passait »
Pendant le TLS (BearSSL) l ESP8266 réserve un **tampon de réception de 16 Ko** (le serveur refuse toute taille de fragment plus petite : MFLN refusé, mesuré le 24/10) : ≈ **29,4 Ko de tas** pour la connexion. Les deux plans de l'image (2 × 4 736 o) sont alloués AVANT le TLS. Il reste donc très peu : **tas minimal mesuré ≈ 4,0 Ko** (canari 8B2C du 12/10, déjà à la limite) ; sur la sonde, 9,8 Ko avec 29 Ko de RAM statique.

Chaque fonctionnalité a mangé de la marge (RAM statique du BWR, mesurée par compilation) :
| Version | RAM statique | Variation |
|---|---|---|
| avant le portail (commit `47b9b1e`) | 34 792 o | référence |
| `2.3` + portail Wi-Fi | 35 444 o | + 652 |
| `2.4` + client OTA | 36 996 o | + 1 552 |
| + DHT22 | 37 204 o | + 208 |
| + OLED d'état | 37 692 o | + 488 (et ≈ 1 Ko de tas pour le tampon de l'OLED) |
| DHT22 + OLED | 37 996 o | |
| **`2.8` : textes du journal en flash** | **34 408 o** | **− 2 836** |
Le tas libre après le Wi-Fi vaut 80 192 − RAM statique − le tas du système : 41,4 Ko avant le correctif, **44,3 Ko** après.

Le défaut apparaît quand la fragmentation du tas dépasse la marge : `new` de BearSSL lève `bad_alloc`, non rattrapée sur ce cœur : panique et redémarrage. Au même niveau de tas global, une tentative réussit et la suivante plante.

## 3. Ce qui a été mesuré (sonde `tlsprobe`, 24/10, banc `dev_MN67OG7R`)
Serveur sans MFLN. Ponction de tas par la connexion TLS selon le tampon de réception :
| Tampon rx | Ponction | Réponse de 4 096 o | Plage de 1 Ko |
|---|---|---|---|
| 16 384 (actuel) | 29,4 Ko | passe | passe |
| 8 192 | 21,6 Ko | passe | passe |
| 4 096 | **18,3 Ko** | passe | passe |
| 3 072 | 17,7 Ko | passe | passe |
| 2 048 | 15,5 Ko | **échec** (`ssl=6`, record trop grand) | passe |
| 1 024 | 12,9 Ko | **échec** | passe |
Une réponse plus grosse que le tampon est refusée ; une réponse courte passe avec un petit tampon. **Cas réel** (deux plans alloués avant, 4 requêtes de 1 Ko, une session TLS chacune) : tas minimal pendant le téléchargement **9,8 Ko (rx 16 Ko) → 22,1 Ko (rx 4 Ko) → 24,2 Ko (rx 2 Ko)**, 4 morceaux en 5,7 s. Transposé au BWR (5 Ko de RAM statique de plus que la sonde) : **≈ 17 Ko de marge au lieu de ≈ 4,6 Ko**.

## 4. Les corrections
1. **Textes du journal série en flash** (`F()` / `PSTR()`) : − 2,8 Ko de RAM statique. Fait, flashé sur `dev_MN67OG7R` (`eink29bwr-2.8`), démarrage vérifié (tas après Wi-Fi 44 256 o). Branche `claude/bwr-chaines-en-flash`.
2. **Frame par morceaux** (piste la plus solide, ≈ +12 Ko de marge) :
   - serveur : `GET /api/pull-frame?deviceId=…&fmt=bin&off=<début>&len=<≤ 4096>` renvoie le morceau (`lib/frameSlice.ts`, test `tests/frameSlice.test.ts`) ; **sans paramètres la réponse reste complète** (firmwares déployés inchangés). Branche `claude/frame-par-morceaux`. **À déployer avant d'essayer le firmware.**
   - firmware BWR : option `POD_FRAME_CHUNK` (0 par défaut) : 4 morceaux de 2 368 o (un morceau ne traverse jamais la frontière noir / rouge), un tampon TLS de réception de 4 096 o, une session par morceau ; **repli automatique** sur le téléchargement d'un seul tenant si le serveur répond une réponse complète. Compilé : `eink29bwr-2.9` avec DHT22 + température gravée + morceaux : RAM statique 34 424 o ; avec l'OLED en plus : 35 216 o. **Jamais essayé de bout en bout (serveur non déployé).**

## 5. Pistes complémentaires (non faites)
- **Textes restants** : il reste ≈ 2,5 Ko de littéraux en RAM (`.rodata` : 5,6 Ko après la correction 1) dans les concaténations (`"..." + x`), les URL et les constructions de JSON : les passer en `PSTR`/`String(F(...))` : encore ≈ 2 Ko.
- **Vote** : la lecture du candidat (`/api/candidate-frame`) charge aussi un corps de 9,5 Ko et un tampon TLS de 16 Ko : même mécanisme de morceaux à ajouter côté serveur et firmware.
- **TFT 1,8″** : même conversion en flash (≈ 3,9 Ko de chaînes mesurées en RAM) ; frame de 40 960 o ⇒ 10 morceaux de 4 Ko (tampon 6 Ko).
- **OTA** : le téléchargement de l'image (≈ 530 Ko, un seul flux) garde un tampon de 16 Ko ; des plages de 3 à 4 Ko (route `/firmware/...` à étendre, téléchargeur propre) rendraient l'OTA possible avec l'OLED. Plus long (≈ 4 minutes), plus de travail, à évaluer.
- **Catalogue** : `.bss` (27 Ko) est surtout du système (lwIP, WiFi) ; l'option « lwIP sans fonctions » du menu Arduino pourrait gagner de la place mais ne se règle pas depuis le code : non retenue.
- **Garde** : refuser de créer une session TLS si le plus grand bloc libre est insuffisant (au lieu de planter) : transforme le redémarrage en simple nouvel essai ; n'aide pas si la marge reste insuffisante.
- **Vue d'ensemble** : redémarrages fréquents d'un appareil (plus de N `register` en 10 min) à signaler dans le profil ; piste serveur seule, aucun firmware.

## 6. Mini plan de rappel (à reprendre au retour)
1. Fusionner `claude/frame-par-morceaux` (serveur) puis `claude/bwr-chaines-en-flash` et la branche firmware « par morceaux » ; vérifier que Vercel est « Ready ».
2. Banc `dev_MN67OG7R` : flasher `eink29bwr-2.9` (chunk), envoyer un dessin « Afficher sur mon écran », vérifier plusieurs téléchargements de suite (plus de `Unhandled C++ exception`), le tas minimal, l'ACK, la température gravée.
3. Banc : flasher la variante avec OLED (`--oled --chunk`) et vérifier que le téléchargement tient.
4. Carte du copain (`dev_T46HBXG1`) : release `eink29bwr-2.8` ou `2.9` ciblée (séquence 9), `ota:kill` ouvert pendant la fenêtre.
5. TFT 1,8″ : conversion en flash + morceaux + DHT22, image allégée (besoin d'un redémarrage sur place pour lever le refus de la carte).
6. Vote : frame candidate par morceaux.
7. Avertissement « redémarrages fréquents » dans le profil.
8. Mettre à jour la matrice à chaque étape (version, preuve, décision).
