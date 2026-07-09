#!/bin/bash
set -u
D=/home/monitor
IMG=mcr.microsoft.com/playwright:v1.49.0-jammy
REMOTE=root@106.55.199.206
mkdir -p "$D/data/logs"
LOG="$D/data/logs/host-$(date +%F).log"
{
  echo "=== weekly $(date -Is) ==="
  # 同 run-daily.sh:xvfb-run 必现卡死,手动 Xvfb;shm 512m 防 OOM
  docker run --rm --shm-size=512m -e MONITOR_HEADED=1 -v "$D":/work -w /work "$IMG" \
    bash -lc '[ -d node_modules ] || npm ci --omit=dev; Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 2; DISPLAY=:99 node run.js weekly'
  RC=$?
  echo "exit=$RC"
  if [ -s "$D/out/monitor_data/series.json" ]; then
    scp -o StrictHostKeyChecking=no "$D"/out/monitor_data/*.json "$REMOTE":/usr/share/nginx/html/monitor_data/ \
      || { sleep 5; scp -o StrictHostKeyChecking=no "$D"/out/monitor_data/*.json "$REMOTE":/usr/share/nginx/html/monitor_data/; }
    echo "published"
  fi
} >>"$LOG" 2>&1
