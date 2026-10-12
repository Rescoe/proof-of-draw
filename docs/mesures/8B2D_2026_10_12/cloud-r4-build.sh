#!/bin/bash
# usage: build.sh <core> <sketch dir> <tag> [extra flags...]
CORE=$1; SK=$2; TAG=$3; shift 3
SB=/tmp/claude-0/sb$CORE
mkdir -p $SB/hardware/local
ln -sfn /tmp/claude-0/core/r$CORE $SB/hardware/local/renesas_uno
ln -sfn /tmp/claude-0/sb/libraries $SB/libraries
mkdir -p /tmp/claude-0/cfg$CORE; printf 'directories:\n  user: %s\n  data: /tmp/claude-0/cfg%s/data\n' $SB $CORE > /tmp/claude-0/cfg$CORE/arduino-cli.yaml
OUT=/tmp/claude-0/out/$TAG
rm -rf $OUT; mkdir -p $OUT/src
N=$(basename $SK)
cp $SK/*.h $SK/*.cpp $OUT/src/ 2>/dev/null
cp $SK/$N.ino $OUT/src/body.h
printf '#include "body.h"\n' > $OUT/src/src.ino
mkdir -p $OUT/s && mv $OUT/src $OUT/s/src
[ -f $SK/secrets.h ] || cp $SK/secrets.h.example $OUT/s/src/secrets.h 2>/dev/null
/tmp/claude-0/cli/arduino-cli compile --config-dir /tmp/claude-0/cfg$CORE --fqbn local:renesas_uno:unor4wifi --libraries $SB/libraries --build-property "build.compiler_path=/usr/bin/" --build-property runtime.tools.ctags.path=/tmp/claude-0/ct --build-path $OUT/build --warnings all --build-property "compiler.cpp.extra_flags=-fstack-usage $*" --build-property "compiler.c.extra_flags=-fstack-usage" --output-dir $OUT/bin $OUT/s/src > $OUT/compile.log 2>&1 && echo OK $TAG || { echo FAIL $TAG; grep -E "error" $OUT/compile.log | grep -v "Error initializing" | head -15; }
