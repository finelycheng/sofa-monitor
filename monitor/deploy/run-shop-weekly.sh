#!/bin/bash
set -u
D=/home/monitor; IMG=mcr.microsoft.com/playwright:v1.49.0-jammy; REMOTE=root@106.55.199.206
[ -f "$D/.env" ] && set -a && . "$D/.env" && set +a
mkdir -p "$D/data/logs"
LOG="$D/data/logs/shop-host-$(date +%F).log"
{
  echo "=== shop-weekly $(date -Is) ==="
  # weekly 重(每产品50评论+DeepSeek画像),外层 timeout 150min 兜底
  timeout 9000 docker run --rm --shm-size=512m -e MONITOR_HEADED=1 -e DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" -v "$D":/work -w /work "$IMG" \
    bash -lc '[ -d node_modules ] || npm ci --omit=dev; Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 2; DISPLAY=:99 node shop-run.js shop-weekly'
  RC=$?; echo "exit=$RC"; [ $RC -ne 0 ] && touch "$D/data/logs/FAILED-shopweekly-$(date +%F)"
  if [ -s "$D/out/shop-profiles.html" ]; then
    scp -o StrictHostKeyChecking=no "$D/out/shop-profiles.html" "$REMOTE":/usr/share/nginx/html/ || { sleep 5; scp -o StrictHostKeyChecking=no "$D/out/shop-profiles.html" "$REMOTE":/usr/share/nginx/html/; }
    ssh -o StrictHostKeyChecking=no "$REMOTE" 'mkdir -p /usr/share/nginx/html/shop_data/reviews'
    if scp -r -o StrictHostKeyChecking=no "$D"/out/shop_data/* "$REMOTE":/usr/share/nginx/html/shop_data/; then echo published;
    else sleep 5; scp -r -o StrictHostKeyChecking=no "$D"/out/shop_data/* "$REMOTE":/usr/share/nginx/html/shop_data/ && echo published || touch "$D/data/logs/FAILED-shop-publish-$(date +%F)"; fi
  fi
} >>"$LOG" 2>&1
