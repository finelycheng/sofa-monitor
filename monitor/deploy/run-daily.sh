#!/bin/bash
set -u
D=/home/monitor
IMG=mcr.microsoft.com/playwright:v1.49.0-jammy
REMOTE=root@106.55.199.206
mkdir -p "$D/data/logs"
LOG="$D/data/logs/host-$(date +%F).log"
{
  echo "=== daily $(date -Is) ==="
  # xvfb-run 在该镜像+主机组合上必现卡死(Xvfb 起来后命令永不执行,4/4 复现),改手动 Xvfb+DISPLAY;
  # shm 512m:宿主机仅 961Mi 内存,1g shm 上限有 OOM 风险(headed 探针实测 512m 足够)
  docker run --rm --shm-size=512m -e MONITOR_HEADED=1 -v "$D":/work -w /work "$IMG" \
    bash -lc '[ -d node_modules ] || npm ci --omit=dev; Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 & sleep 2; DISPLAY=:99 node run.js daily'
  RC=$?
  echo "exit=$RC"
  if [ $RC -ne 0 ]; then touch "$D/data/logs/FAILED-$(date +%F)"; fi
  # 发布:仅当产物存在才推送(渲染失败不白屏);scp 到展示主机,失败重试一次
  if [ -s "$D/out/competitor-monitor.html" ]; then
    scp -o StrictHostKeyChecking=no "$D/out/competitor-monitor.html" "$REMOTE":/usr/share/nginx/html/ \
      || { sleep 5; scp -o StrictHostKeyChecking=no "$D/out/competitor-monitor.html" "$REMOTE":/usr/share/nginx/html/; }
    scp -o StrictHostKeyChecking=no "$D"/out/monitor_data/*.json "$REMOTE":/usr/share/nginx/html/monitor_data/ \
      || { sleep 5; scp -o StrictHostKeyChecking=no "$D"/out/monitor_data/*.json "$REMOTE":/usr/share/nginx/html/monitor_data/; }
    echo "published"
  fi
} >>"$LOG" 2>&1
