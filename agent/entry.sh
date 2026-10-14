#!/bin/sh
# Portable launcher: Alpine's default shell does not include Bash.
set -eu
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
umask 077
[ "$(id -u)" -eq 0 ] || { echo '请使用 root 安装采集端。' >&2; exit 1; }
server=''
secret=''
upgrade=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) server="${2:?缺少主控地址}"; shift 2 ;;
    --token) secret="${2:?缺少节点密钥}"; shift 2 ;;
    --upgrade) upgrade=true; shift ;;
    *) echo '用法：sh install-agent.sh --server https://主控域名 --token 节点密钥 [--upgrade]' >&2; exit 2 ;;
  esac
done
[ -f /etc/os-release ] || { echo '无法识别操作系统。' >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
case "$ID" in
  alpine)
    case "$VERSION_ID" in ''|*[!0-9.]*) echo '需要稳定版 Alpine 3.20 及以上。' >&2; exit 1 ;; esac
    [ "$(apk version -t "$VERSION_ID" 3.20)" != '<' ] || { echo '需要 Alpine 3.20 及以上。' >&2; exit 1; }
    apk add --no-cache bash curl ca-certificates python3
    ;;
  debian|ubuntu)
    if ! command -v bash >/dev/null || ! command -v curl >/dev/null || ! command -v python3 >/dev/null; then
      apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y bash curl ca-certificates python3
    fi
    ;;
  *) echo '支持 Debian 11+、Ubuntu 22.04+、Alpine 3.20+。' >&2; exit 1 ;;
esac
if [ "$upgrade" = true ] && [ -z "$server" ]; then
  [ -f /etc/lightprobe-agent.json ] || { echo '未找到现有采集端配置，请先接入服务器。' >&2; exit 1; }
  server=$(python3 -c 'import json; print(json.load(open("/etc/lightprobe-agent.json"))["server"])')
fi
printf '%s\n' "$server" | grep -Eq '^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$' || { echo '需要有效的 HTTPS 主控地址。' >&2; exit 1; }
server=${server%/}
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
echo '正在通过 HTTPS 从主控下载安装脚本（连接失败会有限重试）…'
if curl --proto '=https' --tlsv1.2 --http1.1 --retry 3 --retry-all-errors --retry-delay 2 --retry-max-time 180 -fsS --connect-timeout 15 --max-time 60 "$server/downloads/bootstrap.sh" -o "$temporary/bootstrap.sh"; then
  :
else
  status=$?
  echo '下载安装脚本失败：请检查受控服务器到主控的 HTTPS 网络、DNS、代理和防火墙；尚未进入采集端安装。' >&2
  exit "$status"
fi
set -- --server "$server"
[ -z "$secret" ] || set -- "$@" --token "$secret"
[ "$upgrade" != true ] || set -- "$@" --upgrade
bash "$temporary/bootstrap.sh" "$@"
