#!/bin/bash
set -u
D=/home/monitor
IMG=mcr.microsoft.com/playwright:v1.49.0-jammy
mkdir -p "$D/data/logs"
LOG="$D/data/logs/host-$(date +%F).log"
{
  echo "=== daily $(date -Is) ==="
  docker run --rm --shm-size=1g -v "$D":/work -w /work "$IMG" \
    bash -lc '[ -d node_modules ] || npm ci --omit=dev; node run.js daily'
  RC=$?
  echo "exit=$RC"
  if [ $RC -ne 0 ]; then touch "$D/data/logs/FAILED-$(date +%F)"; fi
  # 发布:仅当产物存在才覆盖(渲染失败不白屏)
  if [ -s "$D/out/competitor-monitor.html" ]; then
    cp -f "$D/out/competitor-monitor.html" /usr/share/nginx/html/
    mkdir -p /usr/share/nginx/html/monitor_data
    cp -f "$D"/out/monitor_data/*.json /usr/share/nginx/html/monitor_data/
    echo "published"
  fi
} >>"$LOG" 2>&1
