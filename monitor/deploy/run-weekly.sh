#!/bin/bash
set -u
D=/home/monitor
IMG=mcr.microsoft.com/playwright:v1.49.0-jammy
LOG="$D/data/logs/host-$(date +%F).log"
{
  echo "=== weekly $(date -Is) ==="
  docker run --rm --shm-size=1g -v "$D":/work -w /work "$IMG" \
    bash -lc 'node run.js weekly'
  [ -s "$D/out/monitor_data/series.json" ] && cp -f "$D"/out/monitor_data/*.json /usr/share/nginx/html/monitor_data/
} >>"$LOG" 2>&1
