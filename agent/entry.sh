#!/bin/sh
# Portable launcher: Alpine's default shell does not include Bash.
set -eu
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
umask 077
firefly_apt_install() (
  set -eu
  apt_scratch=$(mktemp -d) || exit "$?"
  trap 'rm -rf -- "$apt_scratch"' 0
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # Read first; never run apt-get with a partial configuration snapshot.
  apt-config dump > "$apt_scratch/original.conf" || exit "$?"
  awk '
    BEGIN { print "#clear DPkg::Pre-Install-Pkgs;" }
    {
      key = tolower($1)
      value = $0
      sub(/^[^ \t]+[ \t]+/, "", value)
      if (key ~ /^binary::apt-get::dpkg::pre-install-pkgs(::|$)/ && value != "\"\";") {
        print "自定义 apt-get 安装前钩子需手动核对，未执行安装。" > "/dev/stderr"
        exit 42
      }
      if (key !~ /^dpkg::pre-install-pkgs(::|$)/) next
      if (value == "\"/usr/bin/apt-listchanges --apt || test $? -lt 10\";" ||
          value == "\"/usr/bin/apt-listchanges --apt\";") next
      if (index(value, "apt-listchanges")) {
        print "非标准 apt-listchanges 钩子需手动核对，未执行安装。" > "/dev/stderr"
        exit 42
      }
      print
    }
  ' "$apt_scratch/original.conf" > "$apt_scratch/install.conf" || exit "$?"
  echo '安装缺失依赖（仅本次跳过标准 apt-listchanges 钩子，保留其他安装检查）…'
  if DEBIAN_FRONTEND=noninteractive APT_LISTCHANGES_FRONTEND=none \
    apt-get -c "$apt_scratch/install.conf" install -y --no-upgrade "$@"; then
    exit 0
  else
    exit "$?"
  fi
)

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
      firefly_apt_install bash curl ca-certificates python3
    fi
    ;;
  *) echo '支持 Debian 11+、Ubuntu 22.04+、Alpine 3.20+。' >&2; exit 1 ;;
esac
existing_path=/etc/firefly-probe-agent.json
[ -f "$existing_path" ] || existing_path=/etc/lightprobe-agent.json
if [ "$upgrade" = true ] && [ -z "$server" ]; then
  [ -f "$existing_path" ] || { echo '未找到现有采集端配置，请先接入服务器。' >&2; exit 1; }
  server=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["server"])' "$existing_path")
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
