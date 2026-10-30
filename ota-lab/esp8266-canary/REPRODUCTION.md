# Reconstruire un firmware ESP8266 depuis un clone neuf (BWR / multibwr / TFT / multiscreen)

Ce dossier ne contient que les **outils génériques** et les **pins publics** nécessaires à la reconstruction. Tout le reste de l'ancien laboratoire (banc série, captures, scripts de canari matériel, journaux, binaires, sauvegardes de flash, clés) reste hors de Git.

## Ce qu'un clone neuf peut reconstruire
`tools/build-bwr.mjs` (avec `canary/build.mjs` et `../esp8266-ota2/tools/{configure,lib}.mjs`) compile le sketch suivi `esp8266/esp_eink_2.9BWR` (ou `--target ms27` pour `esp_eink_2.7BW_OLED`) dans `canary-builds/` (ignoré par Git), sans jamais copier `secrets.h` (sauf `--migrate`, build local dont le binaire contient le Wi-Fi : ne jamais partager), écrit un pin public `*-BUILD-PIN.json`, et refuse un binaire qui contiendrait le SSID.

## Prérequis sur le PC
- Node ≥ 22.13 (`.nvmrc`), `npm ci` à la racine (le script n'utilise que Node).
- `arduino-cli` + cœur `esp8266:esp8266` 3.1.2 et les bibliothèques du sketch : variable `ARDUINO_CLI`, sinon l'IDE Arduino 2.x (installation par utilisateur Windows), sinon `arduino-cli` du PATH.
- **Clés PUBLIQUES de publication** `~/.pod-ota-release/release-a.public.pem` et `release-b.public.pem` (ou, à défaut, l'en-tête public suivi `pod_ota_keys.h` du sketch est conservé, avec un avertissement). **Les clés privées ne servent qu'à signer (`scripts/ota-release-sign.ts`) et ne sont jamais dans Git.**

## Commande exacte du profil multibwr-2.1 (pin : `docs/mesures/MULTIBWR_2026_10_29/MULTIBWR-2.1-BUILD-PIN.json`)
```bash
node ota-lab/esp8266-canary/tools/build-bwr.mjs --ota --seq 16 --version multibwr-2.1 \
  --sensor --oled --display --chunk --define POD_OLED_ANIM=1 --define POD_MULTI_OLED=1
```
Options sans sketch modifié : `--define NOM=VALEUR` (répétable, gardées par `#ifndef` dans le sketch), `--src <dossier>` (autre arbre), `--ballast N` (banc seulement). Comparer la taille, la RAM statique et le SHA-256 affichés au pin.

## Limites honnêtes
- La reproductibilité bit à bit dépend de la version du cœur et des bibliothèques ; un écart de SHA avec le pin à versions identiques est à signaler, pas à ignorer.
- Les pins `BWR-*`/`MS27-*`/`PORTAL-*` sont des faits de builds passés ; ils ne garantissent pas que le sketch actuel les reproduit (le sketch a évolué).
- Les scripts de canari matériel (`run-*`, `serial-*`, `audit`, `final-verify`…) ne sont pas dans `main`.
