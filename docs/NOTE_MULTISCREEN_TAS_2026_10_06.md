# Multiscreen ESP8266 : « le device n'arrive pas à s'enregistrer » — le tas, une fois de plus (06/10/2026)

> Ce problème est déjà arrivé (avril, puis lors de l'ajout des animations OLED) **sans être documenté**. Cette note existe pour que la prochaine fois on le reconnaisse en 2 minutes.

## Symptôme (Serial 115200)
```
[WIFI] IP: 192.168.1.11
[HEAP] après WiFi: 30336 bytes            ← la ligne qui compte
[HTTP POST] /api/register → -1            ← connexion TLS impossible
[REGISTER] Echec HTTP
[HTTP POST] https://proof-of-draw.vercel.app/api/register
--------------- CUT HERE FOR EXCEPTION DECODER ---------------
Exception (29): epc1=0x4000df64 … excvaddr=0x00000000     ← écriture à l'adresse 0 : un malloc a renvoyé NULL (BearSSL)
```
Le Wi-Fi fonctionne (IP obtenue), les clés sont chargées, **seul le TLS échoue**. Un `-1` sur `/api/register` + une exception 29 juste après = **manque de mémoire**, pas un problème de serveur, de clé ou de Wi-Fi.

## Cause
L'ESP8266 a **80 Ko de RAM au total**. Tout octet *statique* (`.bss`, `.data`, **chaînes littérales non PROGMEM**) est un octet de **tas en moins**. BearSSL (TLS) a besoin d'environ **35 Ko de tas** juste après le Wi-Fi pour ouvrir une connexion (tampon de réception de 16,7 Ko d'un seul bloc + contextes).

| Version du multiscreen | RAM statique | Tas après Wi-Fi | TLS |
|---|---|---|---|
| 2.2 (avant le 06/10, tampons `malloc`) | 39 420 o | ≈ 38 Ko *(déduit)* | ✅ |
| 2.3 (tampons « statiques » pour éviter la fragmentation) | 46 460 o | — | — |
| 2.4 (+ vote v2) | 47 160 o | **30 336 o** *(mesuré)* | ❌ `-1` puis exception 29 |
| **2.5 (cette correction)** | **35 200 o** | ≈ 42 Ko *(estimé)* | à confirmer sur la carte |

Le piège : la v2.3 avait remplacé des `malloc`/`free` (fragmentation du tas) par des **tampons statiques** de 5 808 + 1 024 octets. La fragmentation était réelle (c'est le problème d'avril), mais « statique » **n'est pas gratuit** : on a seulement déplacé les octets du tas vers la RAM statique, en les réservant **en permanence**, et le tas a fini trop petit.
La v2.4 y a ajouté le vote v2 (+ ≈ 700 o) sans que personne ne regarde le chiffre de RAM statique du rapport de compilation.

## Correction (multiscreen-2.5, TFT 1,8" tft18-2.4)
1. **Plus de gros tampon statique.** L'image e-ink (5 808 o) est écrite dans la **flash** (LittleFS, morceaux de 256 o) pendant le TLS ; **une fois le TLS fermé**, le tampon est alloué (`malloc`), rempli depuis le fichier, utilisé puis libéré **avant l'ACK**. Sans système de fichiers : ancien chemin (malloc avant le TLS). L'OLED (1 Ko) reste un petit `malloc` avant le TLS.
2. **Messages `Serial` en mémoire flash** : `Serial.println(F("…"))`, `Serial.printf_P(PSTR("…"), …)`. Sur ESP8266 les chaînes littérales vivent en RAM sauf si on le demande : **≈ 6 Ko récupérés** (multiscreen : RODATA 11 108 ➜ 5 580 o). Fait aussi dans `esp8266/_shared/pod_anim_esp.h` et `pod_bench_esp.h` (copies synchronisées par `scripts/sync-bench-header.js`).
3. **Diagnostic** : le tas libre et le plus gros bloc sont journalisés **avant chaque requête TLS** (`[MEM] avant TLS: libre=… plus gros bloc=…`). Seuil du redémarrage de secours relevé de 20 000 à 32 000 o (à 29,9 Ko le TLS plantait : 20 000 n'aurait jamais déclenché).
4. Le vote v2 alloue son petit tampon (OLED 1 024 o / e-ink 2,9″ 4 736 o) **avant** le TLS et le libère aussitôt.

## Règles à retenir (copiées dans `CLAUDE.md`)
- **Regarder « Variables and constants in RAM (global, static) » à chaque compilation d'un firmware ESP8266 qui fait du TLS** : viser **≤ 40 000 o** ; au-delà de ≈ 43 000 o, risque réel.
- **Un tampon statique n'est pas gratuit** : il réduit le tas d'autant, en permanence. Un gros tampon (> 2 Ko) ne doit être ni statique ni vivant pendant le TLS : flash (LittleFS) ou `malloc` **après** la fermeture du TLS.
- **Messages `Serial` : `F()` / `PSTR()`** (un message de 60 o = 60 o de RAM sinon).
- Après tout changement de firmware : relever `[HEAP] après WiFi` au Serial. **Valeurs de référence : ≈ 38 Ko = fonctionne ; 30 Ko = TLS impossible.**

## Comment mesurer (sans carte)
```bash
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2:eesz=4M2M <dossier>            # lire « Variables and constants in RAM »
xtensa-lx106-elf-nm --size-sort -S -C <fichier.elf> | awk '$3 ~ /^[BbDdRr]$/'        # gros symboles statiques (.bss/.data/.rodata)
```
`tests/espStaticRam.test.ts` échoue si un gros tampon statique ou un message `Serial` en RAM réapparaît dans le multiscreen / TFT 1,8″.

## À vérifier sur la carte (non testé au moment de l'écriture)
- `[HEAP] après WiFi` ≥ ≈ 38 000 (attendu ≈ 42 000) ; `[HTTP POST] /api/register → 200`.
- Une œuvre e-ink : `[FETCHFRAME-E27] lu=5808 expected=5808 (via flash)` puis l'image ; une œuvre OLED ; une animation OLED (clip en flash) **suivie d'une œuvre e-ink** (le cas d'origine « l'animation bloque l'e-ink »).
- Un vote v2 : `[VALIDATE2] … verdict=accept`, `Vote OK`.
- Si `[HEAP] après WiFi` reste < 38 000 : pistes suivantes — `ArduinoJson` 2 048 ➜ 1 024 dans `doPull`, `EEPROM_SIZE` (1 540 o de tas), chaînes restantes en RAM (`strings` du .elf), test de `setBufferSizes()` (dépend du support MFLN de Vercel : non vérifié).
