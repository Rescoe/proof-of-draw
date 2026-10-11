#!/bin/bash
# scripts/esp8266-eink29-measure.sh — LOT8B2C : mesures de COMPILATION d'un build ESP8266 e-ink 2,9″ (cœur esp8266 3.1.2, xtensa-lx106-elf-gcc 10.3).
#   scripts/esp8266-eink29-measure.sh <dossier-du-build-arduino-cli> <fichier-compile.log> [xtensa-lx106-elf-objdump]
# Sortie : RAM statique, flash, IRAM ; avertissements du projet NORMALISÉS (sans numéros de ligne) ; cadres de pile statiques (-fstack-usage) des fonctions du chemin frame/rendu ; désassemblage normalisé (hachage).
# ANALYSE STATIQUE : ne remplace pas la mesure sur la carte (le canari imprime le tas, le plus grand bloc, la pile « cont » et les temps réels).
BUILD=$1; LOG=$2; OD=${3:-xtensa-lx106-elf-objdump}
sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -E "Variables and constants in RAM|Instruction RAM|Code in flash" | sed 's/^\. //'
echo "--- avertissements du projet (normalisés : sans chemin ni numéro de ligne)"
sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep "warning:" | grep -v "pragma mark" | sed -E 's|^.*/([^/:]+):[0-9]+(:[0-9]+)?: warning:|\1: warning:|' | sort | uniq -c
echo "--- cadres de pile statiques (octets)"
for f in "$BUILD"/sketch/*.su; do
  awk -F'\t' '{ n=$1; sub(/^.*[0-9]+:[0-9]+:/, "", n); print $2, n }' "$f"
done | grep -E "doFetchFrame\(|podRender|canary|doPull|doRegister|doValidate\(|ackFrame|clearDisplayWhite|initDisplayForRefresh|DisplayStream|loop|setup|EinkRenderer|FrameHasher" | sort -rn | head -24
echo "--- désassemblage normalisé (empreinte)"
ELF=$(ls "$BUILD"/../bin/*.elf 2>/dev/null | head -1)
[ -n "$ELF" ] && $OD -d "$ELF" | sed -E '1,3d; s/^[0-9a-f]+ <(.*)>:/FN \1/; s/^\s+[0-9a-f]+:\s+([0-9a-f]{2} ){2,3}\s*/  /; s/0x[0-9a-f]{6,8}/X/g; s/[0-9a-f]{8} <([^>]*)>/<\1>/g' | sha256sum | cut -c1-16
