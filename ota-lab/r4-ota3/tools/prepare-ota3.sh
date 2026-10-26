#!/usr/bin/env bash
# tools/prepare-ota3.sh — prépare l'essai OTA-3 (UNO R4 WiFi) : compile la sonde en builds A et B, fabrique les fichiers .ota de laboratoire à partir de B (et to-a.ota à partir de A).
# NE TÉLÉVERSE RIEN, NE LANCE AUCUN SERVEUR, n'ouvre aucun port série. Usage (Git Bash, depuis la racine du dépôt) : bash ota-lab/r4-ota3/tools/prepare-ota3.sh
# Les .bin et .ota contiennent le Wi-Fi de secrets.h : ils restent dans artifacts/ (ignoré par git) et ne sont servis que sur le réseau local.
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$LAB/../.." && pwd)"
CLI="${ARDUINO_CLI:-/c/Users/thibf/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe}"
FQBN=arduino:renesas_uno:unor4wifi
SK="$LAB/sketch/ota3_r4_probe"; OUT="$LAB/artifacts"
command -v node >/dev/null || { echo "node introuvable"; exit 2; }
[ -f "$SK/secrets.h" ] || { if [ -f "$ROOT/arduino_uno_r4/pod_uno_r4/secrets.h" ]; then cp "$ROOT/arduino_uno_r4/pod_uno_r4/secrets.h" "$SK/secrets.h"; echo "secrets.h copié depuis le firmware R4 TFT 2,8″ (ignoré par git)"; else echo "secrets.h absent : copier $SK/secrets.example.h en secrets.h et renseigner le Wi-Fi 2,4 GHz"; exit 2; fi; }
node "$ROOT/scripts/sync-bench-header.js" >/dev/null   # podNetStack.h du dossier = original
mkdir -p "$OUT/build/A" "$OUT/build/B" "$OUT/serve"
"$CLI" compile --fqbn $FQBN --warnings all --output-dir "$OUT/build/A" "$SK" > "$OUT/build/A.log" 2>&1
"$CLI" compile --fqbn $FQBN --warnings all --build-property "compiler.cpp.extra_flags=-DOTA3_IS_B=1" --output-dir "$OUT/build/B" "$SK" > "$OUT/build/B.log" 2>&1
for v in A B; do sed 's/\x1b\[[0-9;]*m//g' "$OUT/build/$v.log" | grep -E "Le croquis utilise|Les variables globales" | sed "s/^/[$v] /"; done
if grep -E "ota-lab/.*(warning|error)" "$OUT/build/A.log" "$OUT/build/B.log" | sed 's/\x1b\[[0-9;]*m//g' | grep -q .; then echo "AVERTISSEMENT dans le code de la sonde : voir artifacts/build/*.log"; fi
# binaire à téléverser avec l'IDE : « Croquis > Exporter le binaire compilé » n'est pas nécessaire — l'IDE compile le dossier sketch/ota3_r4_probe (build A par défaut).
node "$LAB/tools/make-ota.mjs" --b "$OUT/build/B/ota3_r4_probe.ino.bin" --a "$OUT/build/A/ota3_r4_probe.ino.bin" --out "$OUT/serve"
echo
echo "PRÊT. Rien n'a été téléversé. Étapes suivantes : ota-lab/r4-ota3/README.md § 5 (procédure)."
echo "  1) serveur : node ota-lab/r4-ota3/tools/serve-r4.mjs        (dans une fenêtre dédiée ; Ctrl+C pour l'arrêter)"
echo "  2) IP du PC : ipconfig  (adresse IPv4 du Wi-Fi)"
# Cas qui FONT PLANTER le module (essais du 16/10/2026) : mis à l'écart, le serveur répondra 404 (-14, sans danger). Voir docs/OTA3_ESSAI1_ECHEC_ET_CORRECTIFS_2026_10_16.md § 8.
mkdir -p "$OUT/serve-danger"; for c in badmagic badpayload; do [ -f "$OUT/serve/$c.ota" ] && mv -f "$OUT/serve/$c.ota" "$OUT/serve-danger/$c.ota"; done
echo "badmagic et badpayload mis de côté (artifacts/serve-danger) : badmagic plante le module d après le code (jamais observé proprement), badpayload n a jamais été servi à un module propre."
node "$LAB/tools/print-expect.mjs" "$OUT/serve/cases.json"
