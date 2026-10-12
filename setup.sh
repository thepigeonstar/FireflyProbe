#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo '请先安装 Docker Engine 和 Docker Compose 插件，再运行本脚本。' >&2
  exit 1
fi
if [[ -f .env ]]; then
  echo '已有 .env，保留现有账号与配置。更新部署请按 README 操作。' >&2
  exit 1
fi
read -r -p '请输入指向这台主控的子域名（不含 https://）：' domain < /dev/tty
if [[ ! "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ || "$domain" != *.* || "$domain" == *..* ]]; then
  echo '域名格式无效。' >&2; exit 1
fi
password=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
umask 077
printf 'ADMIN_USER=admin\nADMIN_PASSWORD=%s\nPUBLIC_URL=https://%s\nDOMAIN=%s\nCOOKIE_SECURE=true\nTIMEZONE=Asia/Shanghai\n' "$password" "$domain" "$domain" > .env
echo '部署方式：1 = 自动 HTTPS（80/443 空闲）；2 = 使用已有 Nginx/反向代理。'
read -r -p '请选择 [1/2]：' mode < /dev/tty
case "$mode" in
  1) compose_args=(-f compose.yaml -f compose.https.yaml) ;;
  2) compose_args=(-f compose.yaml) ;;
  *) echo '请选择 1 或 2；.env 已保留，按 README 手动启动。' >&2; exit 1 ;;
esac
echo '正在构建并启动主控。'
if ! docker compose "${compose_args[@]}" up --build -d; then
  echo '部署失败，.env 已保存。排查后运行 README 中的启动命令；不要重新生成密码。' >&2; exit 1
fi
printf '\n管理地址：https://%s\n账号：admin\n初始密码：%s\n请保存密码，不要将 .env 发给他人。\n' "$domain" "$password"
if [[ "$mode" == 1 ]]; then
  echo '证书申请可能需要等待。检查：docker compose -f compose.yaml -f compose.https.yaml logs --tail=50'
else
  echo '请在现有反向代理中将该域名的 HTTPS 转发至 http://127.0.0.1:8080，并配置证书。'
fi
