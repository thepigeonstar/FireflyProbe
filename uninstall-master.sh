#!/usr/bin/env bash
set -euo pipefail
umask 077
target=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) target="${2:?缺少安装目录}"; shift 2 ;;
    *) echo '用法：bash uninstall-master.sh [--dir /root/FireflyProbe]' >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo '请以 root 运行。' >&2; exit 1; }
if [[ -z "$target" ]]; then
  for candidate in /root/FireflyProbe /root/lightprobe; do
    if [[ -f "$candidate/.env" && -f "$candidate/compose.yaml" ]]; then target=$candidate; break; fi
  done
fi
[[ "$target" == /* && "$target" != / && -f "$target/.env" && -f "$target/compose.yaml" ]] || { echo '未找到萤火主控，请用 --dir 指定原安装目录。' >&2; exit 1; }
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo '需要已有 Docker 和 Compose 才能卸载容器。' >&2; exit 1
fi
cd -- "$target"
compose_args=(-f compose.yaml)
[[ ! -f compose.https.yaml ]] || compose_args+=(-f compose.https.yaml)
container=$(docker compose "${compose_args[@]}" ps -aq lightprobe)
# Stop before exporting SQLite/WAL and encryption keys as a consistent set.
docker compose "${compose_args[@]}" stop
if [[ -n "$container" ]]; then
  backup="$target/uninstall-backups/backup-$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p -- "$backup"
  cp -- .env "$backup/.env"
  cp -- compose.yaml "$backup/compose.yaml"
  docker compose "${compose_args[@]}" cp lightprobe:/app/data "$backup/data"
  echo "卸载前完整数据备份：$backup"
fi
# Intentionally omit --volumes and global prune: retain data, TLS and other projects.
docker compose "${compose_args[@]}" down
echo "萤火主控容器已卸载。安装目录、配置和 Docker 数据卷保留：$target"
echo 'Docker、其他项目及服务器采集端保持不变。'
