#!/bin/bash
cd /home/user/proof-of-draw
B=firmware-backups/2026-10-12_avant-propagation-8b2b3
for sk in eink27 eink27_oled; do
  d=/tmp/claude-0/base/pod_uno_r4_$sk; rm -rf $d; mkdir -p $d
  cp arduino_uno_r4/pod_uno_r4_$sk/*.h arduino_uno_r4/pod_uno_r4_$sk/*.cpp $d/ ; rm -f $d/pod_ssl_bounded.h
  cp $B/pod_uno_r4_$sk/pod_uno_r4_$sk.ino $d/
done
run() { /tmp/claude-0/build.sh "$@"; }
G=-std=gnu++14
job() { c=$1; grp=$2
 if [ $grp = a ]; then
  run $c /tmp/claude-0/base/pod_uno_r4_eink27 base27_${c}_off $G
  run $c /tmp/claude-0/base/pod_uno_r4_eink27 base27_${c}_on $G -DPOD_RENDER_V1=1
  run $c arduino_uno_r4/pod_uno_r4_eink27 s27_${c}_off $G
  run $c arduino_uno_r4/pod_uno_r4_eink27 s27_${c}_on $G -DPOD_RENDER_V1=1
  run $c arduino_uno_r4/pod_uno_r4_eink27 s27_${c}_can $G -DPOD_RENDER_V1=1 -DPOD_CANARY=1
 else
  run $c /tmp/claude-0/base/pod_uno_r4_eink27_oled base27o_${c}_off $G
  run $c /tmp/claude-0/base/pod_uno_r4_eink27_oled base27o_${c}_on $G -DPOD_RENDER_V1=1
  run $c arduino_uno_r4/pod_uno_r4_eink27_oled s27o_${c}_off $G
  run $c arduino_uno_r4/pod_uno_r4_eink27_oled s27o_${c}_on $G -DPOD_RENDER_V1=1
  run $c arduino_uno_r4/pod_uno_r4_eink27_oled s27o_${c}_can $G -DPOD_RENDER_V1=1 -DPOD_CANARY=1
  run $c arduino_uno_r4/pod_uno_r4_eink29 c29_${c}_off $G
  run $c arduino_uno_r4/pod_uno_r4_eink29 c29_${c}_can $G -DPOD_RENDER_V1=1 -DPOD_CANARY=1
 fi; }
job 1.5.3 a & job 1.5.3 b & job 1.6.0 a & job 1.6.0 b &
wait
echo DONE
