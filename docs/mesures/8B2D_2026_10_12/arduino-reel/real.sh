#!/bin/bash
# usage: real.sh <core 1.5.3|1.6.0> <sketch dir> <tag> [flags...]  — VRAI pipeline arduino-cli : le dossier du sketch est compilé tel quel (générateur de prototypes inclus), sans enveloppe
CORE=$1; SK=$2; TAG=$3; shift 3
SB=/tmp/claude-0/sb$CORE; mkdir -p $SB/hardware/local; ln -sfn /tmp/claude-0/core/r$CORE $SB/hardware/local/renesas_uno; ln -sfn /tmp/claude-0/sb/libraries $SB/libraries
mkdir -p /tmp/claude-0/cfg$CORE; printf 'directories:\n  user: %s\n  data: /tmp/claude-0/cfg%s/data\n' $SB $CORE > /tmp/claude-0/cfg$CORE/arduino-cli.yaml
OUT=/tmp/claude-0/real/$TAG; rm -rf $OUT; mkdir -p $OUT/s; N=$(basename $SK); cp -r $SK $OUT/s/$N; [ -f $OUT/s/$N/secrets.h ] || cp $SK/secrets.h.example $OUT/s/$N/secrets.h
CMD=(/tmp/claude-0/cli/arduino-cli compile --config-dir /tmp/claude-0/cfg$CORE --fqbn local:renesas_uno:unor4wifi --libraries $SB/libraries --build-property "build.compiler_path=/usr/bin/" --build-property runtime.tools.ctags.path=/tmp/claude-0/ct3 --build-path $OUT/build --warnings all --output-dir $OUT/bin $OUT/s/$N)
[ -n "$*" ] && CMD+=(--build-property "compiler.cpp.extra_flags=$*")
echo "\$ ${CMD[*]}" > $OUT/compile.log; "${CMD[@]}" >> $OUT/compile.log 2>&1 && echo OK $TAG || { echo FAIL $TAG; grep -E "error" $OUT/compile.log | head -8; }
