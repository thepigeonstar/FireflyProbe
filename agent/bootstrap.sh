#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
phase='初始化'
# Do not log BASH_COMMAND: it can contain a node token or credentials.
report_install_error() {
  local status=$?
  printf '采集端安装失败：%s（行 %s，退出码 %s）\n' "$phase" "${BASH_LINENO[0]}" "$status" >&2
  exit "$status"
}
trap report_install_error ERR
server=''
secret=''
upgrade=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) server="${2:?缺少主控地址}"; shift 2 ;;
    --token) secret="${2:?缺少节点密钥}"; shift 2 ;;
    --upgrade) upgrade=true; shift ;;
    *) echo '用法：bash bootstrap.sh --server https://主控域名 --token 节点密钥' >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo '请切换到 root 后执行安装命令。' >&2; exit 1; }
if [[ "$upgrade" == true ]]; then
  [[ -f /etc/lightprobe-agent.json ]] || { echo '未找到现有采集端配置，请先接入服务器。' >&2; exit 1; }
  mapfile -t existing < <(python3 -c 'import json; c=json.load(open("/etc/lightprobe-agent.json")); print(c["server"]); print(c["token"])')
  [[ ${#existing[@]} -eq 2 ]] || { echo '无法读取采集端配置。' >&2; exit 1; }
  if [[ -n "$server" && "${server%/}" != "${existing[0]%/}" ]]; then
    echo '该服务器已接入其他主控，请先核对 /etc/lightprobe-agent.json，避免覆盖现有监控。' >&2; exit 1
  fi
  server=${server:-${existing[0]}}; secret=${secret:-${existing[1]}}
fi
[[ "$server" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$ && "$secret" =~ ^[a-f0-9]{64}$ ]] || { echo '需要有效的 HTTPS 主控地址和节点密钥。' >&2; exit 1; }
server=${server%/}
phase='检查系统版本'
[[ -f /etc/os-release ]] || { echo '无法读取 /etc/os-release，不能识别系统。' >&2; exit 1; }
source /etc/os-release
case "$ID" in
  debian) dpkg --compare-versions "$VERSION_ID" ge 11 || { echo "当前 Debian $VERSION_ID，需要 Debian 11 及以上。" >&2; exit 1; } ;;
  ubuntu) dpkg --compare-versions "$VERSION_ID" ge 22.04 || { echo "当前 Ubuntu $VERSION_ID，需要 Ubuntu 22.04 及以上。" >&2; exit 1; } ;;
  *) echo '仅支持 Debian 11+ / Ubuntu 22.04+。' >&2; exit 1 ;;
esac
echo "系统检查通过：${PRETTY_NAME:-$ID $VERSION_ID}"
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo '仅支持 amd64 / arm64。' >&2; exit 1 ;; esac
command -v curl >/dev/null || { echo '请先执行 apt-get update && apt-get install -y curl ca-certificates。' >&2; exit 1; }
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
phase='下载安装脚本和采集程序'
curl --proto '=https' --tlsv1.2 --fail --show-error --silent --connect-timeout 15 --max-time 60 "$server/downloads/install.sh" -o "$temporary/install.sh"
curl --proto '=https' --tlsv1.2 --fail --show-error --silent --connect-timeout 15 --max-time 300 "$server/downloads/lightprobe-agent-linux-$arch" -o "$temporary/lightprobe-agent-linux-$arch"
curl --proto '=https' --tlsv1.2 --fail --show-error --silent --connect-timeout 15 --max-time 30 "$server/downloads/SHA256SUMS" -o "$temporary/SHA256SUMS"
phase='校验采集程序'
checksum=$(awk -v name="lightprobe-agent-linux-$arch" '$2 == name {print $1}' "$temporary/SHA256SUMS")
[[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || { echo '采集程序校验信息无效。' >&2; exit 1; }
printf '%s  %s\n' "$checksum" "$temporary/lightprobe-agent-linux-$arch" | sha256sum -c -
# Validate credentials before installing packages or changing a running agent.
phase='验证主控连接和节点密钥'
printf 'header = "Authorization: Bearer %s"\n' "$secret" > "$temporary/curl.conf"
curl --config "$temporary/curl.conf" --proto '=https' --tlsv1.2 --fail --show-error --silent --connect-timeout 15 --max-time 30 "$server/api/agent/config" -o "$temporary/remote.json"
printf '{"server":"%s","token":"%s","disk_path":"/"}\n' "$server" "$secret" > "$temporary/lightprobe-agent.json"
if [[ "$upgrade" == true ]]; then
  python3 - "$temporary/lightprobe-agent.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: supplied = json.load(f)
with open('/etc/lightprobe-agent.json') as f: existing = json.load(f)
existing.update(server=supplied['server'], token=supplied['token'])
with open(sys.argv[1], 'w') as f: json.dump(existing, f)
PY
fi
unset secret
phase='安装并启动采集端'
bash "$temporary/install.sh" --config "$temporary/lightprobe-agent.json" --binary "$temporary/lightprobe-agent-linux-$arch"
