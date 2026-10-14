#!/bin/bash
# scripts/prepare-local-canary-tft28.sh — LOT8B2E V4-FIX2 : prépare une COPIE LOCALE du canari d'AFFICHAGE du TFT 2,8" (POD_CANARY=1, POD_RENDER_V1=1, POD_VOTE_CANARY=0, POD_VOTE_V1=0).
# Sortie : canary-builds/tft28-display-canary/pod_uno_r4/ (dossier IGNORÉ par git). N'écrit, ne lit et ne copie JAMAIS secrets.h ni pod_vote_pins.h : copier SOI-MÊME son secrets.h dans ce dossier.
# Le sketch du dépôt n'est PAS modifié (flags à 0).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/arduino_uno_r4/pod_uno_r4"
OUT="$ROOT/canary-builds/tft28-display-canary/pod_uno_r4"
git -C "$ROOT" check-ignore -q canary-builds/x || { echo "ECHEC : canary-builds/ n'est pas ignoré par git"; exit 1; }
for f in POD_CANARY POD_RENDER_V1 POD_VOTE_V1 POD_VOTE_CANARY; do
  grep -qE "^#define $f 0\s*$" "$SRC/pod_uno_r4.ino" || { echo "ECHEC : $f n'est pas à 0 dans le dépôt"; exit 1; }
done
rm -rf "$OUT"; mkdir -p "$OUT"
for f in "$SRC"/*; do
  b="$(basename "$f")"
  case "$b" in secrets.h|pod_vote_pins.h|host) continue;; esac
  [ -f "$f" ] && cp "$f" "$OUT/"
done
sed -i -E 's/^#define POD_CANARY 0(\s*)$/#define POD_CANARY 1\1/; s/^#define POD_RENDER_V1 0(\s*)$/#define POD_RENDER_V1 1\1/' "$OUT/pod_uno_r4.ino"
grep -qE '^#define POD_CANARY 1' "$OUT/pod_uno_r4.ino" && grep -qE '^#define POD_RENDER_V1 1' "$OUT/pod_uno_r4.ino" && grep -qE '^#define POD_VOTE_CANARY 0' "$OUT/pod_uno_r4.ino" && grep -qE '^#define POD_VOTE_V1 0' "$OUT/pod_uno_r4.ino" || { echo "ECHEC : drapeaux inattendus dans la copie"; exit 1; }
echo "Copie prête : $OUT"
echo "  POD_CANARY=1  POD_RENDER_V1=1  POD_VOTE_V1=0  POD_VOTE_CANARY=0 (canari d'affichage, AUCUN vote)"
echo "A FAIRE PAR VOUS : copier votre secrets.h dans ce dossier (le script n'y touche pas), puis ouvrir pod_uno_r4.ino dans l'IDE (ou arduino-cli compile) ; ne rien flasher avant l'audit."
