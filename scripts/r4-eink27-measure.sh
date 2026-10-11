#!/bin/bash
# scripts/r4-eink27-measure.sh — LOT8B2B3-R4-EINK27-PROPAGATION-FIX1 : tous les rapports de pile STATIQUES d'un firmware UNO R4 à partir de son ELF.
#   scripts/r4-eink27-measure.sh <fichier.elf> [arm-none-eabi-objdump]
# Sortie standard : chaînes de la pile principale (1 024 o), transactions réseau, appels au module Wi-Fi, Ed25519, pile de travail JSON (pull / register / validate), tailles de section.
# Analyse STATIQUE seulement (elle ne remplace pas la mesure sur la carte) ; le seuil impératif est 128 o de marge, l'objectif 256 o.
set -e
ELF=$1; OBJDUMP=${2:-arm-none-eabi-objdump}; SIZE=${OBJDUMP/objdump/size}
HERE=$(cd "$(dirname "$0")" && pwd)
DIS=$(mktemp); trap 'rm -f "$DIS"' EXIT
$OBJDUMP -d --no-show-raw-insn "$ELF" > "$DIS"
echo "##### sections"; $SIZE -A "$ELF" | grep -E "^\.(text|data|bss|code_in_ram|noinit)|^Total" || true
echo "##### chaînes de la pile principale"; node "$HERE/r4-eink27-chains.js" "$DIS"
echo "##### transactions réseau (pile dédiée 2 048 o)"; node "$HERE/net-stack-report.js" "$DIS"
echo "##### module Wi-Fi (pile dédiée 1 536 o)"; node "$HERE/wifi-stack-report.js" "$DIS" | grep -E "^  wifi|=> pire|^=> "
echo "##### Ed25519"; node "$HERE/ed25519-stack-report.js" "$DIS" | grep -E "^hal_entry|PILE DÉDIÉE"
for root in pullParseWork registerParseWork validateParseWork; do
  echo "##### pile de travail JSON : $root (imbrication 8)"; node "$HERE/pull-work-stack-report.js" "$DIS" 8 $root | grep -E "^# racine|limite d'imbrication|budget"
done
