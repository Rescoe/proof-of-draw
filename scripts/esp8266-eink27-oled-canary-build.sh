#!/bin/bash
# scripts/esp8266-eink27-oled-canary-build.sh — LOT8B2C-27 : construit EN LOCAL les deux binaires du canari ESP8266 + e-ink 2,7″ BW + OLED.
#   scripts/esp8266-eink27-oled-canary-build.sh <chemin/vers/secrets.h> [dossier-de-sortie]      (sortie par défaut : canary-builds/)
# Produit  <sortie>/stable/*.bin  (POD_RENDER_V1=0 : retour arrière, firmware d'avant)
#          <sortie>/canary/*.bin  (POD_RENDER_V1=1 POD_CANARY=1 : canari SANS VOTE)
# Les .bin EMBARQUENT secrets.h (Wi-Fi) : la sortie doit rester dans un dossier ignoré par git (canary-builds/ l'est). Ce script ne lit pas secrets.h : il le COPIE seulement dans un dossier temporaire.
# Prérequis : arduino-cli (ou celui de l'IDE Arduino 2.x), cœur esp8266 3.1.2, bibliothèques du firmware (Adafruit SSD1306/GFX, ArduinoJson, QRCode…). NE FLASHE RIEN.
set -e
SECRETS=$1; OUT=${2:-canary-builds}
[ -f "$SECRETS" ] || { echo "usage: $0 <secrets.h> [sortie]"; exit 1; }
CLI=${ARDUINO_CLI:-arduino-cli}
command -v "$CLI" >/dev/null 2>&1 || CLI="$LOCALAPPDATA/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
HERE=$(cd "$(dirname "$0")/.." && pwd); SK=$HERE/esp8266/esp_eink_2.7BW_OLED
case "$OUT" in canary-builds*|*/canary-builds*) ;; *) echo "refus : la sortie doit être sous un dossier 'canary-builds' (ignoré par git)"; exit 1;; esac
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
build() { # <nom> <flags>
  local N=$1 FL=$2 W=$TMP/$1/esp_eink_2.7BW_OLED
  mkdir -p "$W" "$HERE/$OUT/$N"; cp "$SK"/* "$W"/; cp "$SECRETS" "$W/secrets.h"
  "$CLI" compile --fqbn esp8266:esp8266:nodemcuv2 --warnings all --build-property "compiler.cpp.extra_flags=$FL" \
    --build-path "$TMP/$N/build" --output-dir "$HERE/$OUT/$N" "$W" > "$TMP/$N.log" 2>&1 || { tail -20 "$TMP/$N.log"; echo "ECHEC $N"; exit 1; }
  sed 's/\x1b\[[0-9;]*m//g' "$TMP/$N.log" | grep -E "Variables and constants in RAM|Code in flash" | sed "s/^\. /[$N] /"
}
build stable ""
build canary "-DPOD_RENDER_V1=1 -DPOD_CANARY=1"
echo "OK -> $OUT/stable et $OUT/canary (flasher le .bin avec l'outil habituel ; en cas de doute, reflasher stable)."
