#!/bin/bash
# usage: esp_build.sh <dossier sketch> <tag> [flags...]   (ESP8266 core 3.1.2, xtensa gcc 10.3)
SK=$1; TAG=$2; shift 2
OUT=/tmp/claude-0/outesp/$TAG; rm -rf $OUT; mkdir -p $OUT
N=$(basename $SK)
mkdir -p $OUT/s/$N; cp $SK/* $OUT/s/$N/ 2>/dev/null
[ -f $OUT/s/$N/secrets.h ] || cp $SK/secrets.h.example $OUT/s/$N/secrets.h 2>/dev/null
FL="$*"
/tmp/claude-0/cli/arduino-cli compile --config-dir /tmp/claude-0/cfgesp --fqbn esp8266com:esp8266:nodemcuv2 --libraries /tmp/claude-0/sbesp/libraries --build-property runtime.tools.ctags.path=/tmp/claude-0/ct3 --build-path $OUT/build --warnings all --build-property "compiler.cpp.extra_flags=-fstack-usage $FL" --build-property "compiler.c.extra_flags=-fstack-usage" --output-dir $OUT/bin $OUT/s/$N > $OUT/compile.log 2>&1 && echo OK $TAG || { echo FAIL $TAG; grep -E "error|Error" $OUT/compile.log | grep -v "Error init" | head -12; }
