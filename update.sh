#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ -f compose.yaml && -f .env ]] || { echo '请先把更新包解压到原 lightprobe 目录，保留原 .env。' >&2; exit 1; }
docker compose up --build -d --force-recreate lightprobe
for ((attempt=0; attempt<15; attempt++)); do
  if page_html=$(curl -fsS http://127.0.0.1:8080/ 2>/dev/null); then
    if [[ "$page_html" == *'data-build="0.1.3"'* ]]; then
      echo '已验证：运行中的主控页面是 Firefly Probe v0.1.3。浏览器按 Ctrl+F5 刷新。'
      exit 0
    fi
  fi
  sleep 2
done
echo '尚未检测到 v0.1.3，请查看主控日志：' >&2
docker compose logs --tail=30 lightprobe
exit 1
