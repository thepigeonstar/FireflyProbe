#!/usr/bin/env bash
set -Eeuo pipefail
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
umask 077
phase='初始化'
report_install_error() {
  local status=$?
  printf '采集端安装失败：%s（行 %s，退出码 %s）\n' "$phase" "${BASH_LINENO[0]}" "$status" >&2
  exit "$status"
}
trap report_install_error ERR
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
config_path="$PWD/lightprobe-agent.json"
binary_path=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) config_path="${2:?缺少配置路径}"; shift 2 ;;
    --binary) binary_path="${2:?缺少程序路径}"; shift 2 ;;
    *) echo '用法：sudo bash install.sh [--config 配置路径] [--binary 程序路径]' >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo '请使用 sudo 或 root 运行。' >&2; exit 1; }
[[ -f "$config_path" ]] || { echo '找不到 lightprobe-agent.json，请先在后台创建节点并下载配置。' >&2; exit 1; }
phase='检查系统版本'
[[ -f /etc/os-release ]] || { echo '无法读取 /etc/os-release，不能识别系统。' >&2; exit 1; }
# shellcheck disable=SC1091
source /etc/os-release
case "$ID" in
  debian) dpkg --compare-versions "$VERSION_ID" ge 11 || { echo "当前 Debian $VERSION_ID，需要 Debian 11 及以上。" >&2; exit 1; } ;;
  ubuntu) dpkg --compare-versions "$VERSION_ID" ge 22.04 || { echo '需要 Ubuntu 22.04 及以上。'; exit 1; } ;;
  alpine) [[ "$VERSION_ID" =~ ^[0-9]+\.[0-9]+([.][0-9]+)?$ && "$(apk version -t "$VERSION_ID" 3.20)" != '<' ]] || { echo '需要稳定版 Alpine 3.20 及以上。' >&2; exit 1; } ;;
  *) echo '支持 Debian / Ubuntu / Alpine。' >&2; exit 1 ;;
esac
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo '仅提供 amd64 / arm64 程序。' >&2; exit 1 ;; esac
if [[ -z "$binary_path" ]]; then
  for candidate in "$PWD/lightprobe-agent-linux-$arch" "$script_dir/lightprobe-agent-linux-$arch" "$script_dir/../bin/lightprobe-agent-linux-$arch"; do
    if [[ -f "$candidate" ]]; then binary_path="$candidate"; break; fi
  done
fi
[[ -f "$binary_path" ]] || { echo "找不到 lightprobe-agent-linux-$arch，请从安装包 bin 目录上传。" >&2; exit 1; }
phase='安装采集程序'
install -d -m 0755 /opt/lightprobe
# Avoid replacing a running executable in place.
install -m 0755 "$binary_path" /opt/lightprobe/agent.new
mv -f /opt/lightprobe/agent.new /opt/lightprobe/agent
phase='安装 vnStat 和系统依赖'
if [[ "$ID" == alpine ]]; then
  release=${VERSION_ID%.*}; [[ "$VERSION_ID" != *.*.* ]] && release=$VERSION_ID
  repository="https://dl-cdn.alpinelinux.org/alpine/v$release/community"
  if ! grep -qE "^[^#]+/v${release//./\.}/community/?([[:space:]]|$)" /etc/apk/repositories; then
    printf '\n%s\n' "$repository" >> /etc/apk/repositories
  fi
  apk add --no-cache bash vnstat vnstat-openrc python3 ca-certificates iproute2 tzdata coreutils
else
  if apt-get update; then
    :
  else
    status=$?
    echo '软件源刷新失败，请先修复上方报错的软件源，再重试安装。' >&2
    if [[ "$ID" == debian && "$VERSION_ID" == 11 ]]; then
      echo '若 bullseye-backports 返回 404：该源已退役，请备份并禁用对应 backports 条目；保留 bullseye、bullseye-updates 和 bullseye-security。' >&2
    fi
    exit "$status"
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y vnstat python3 ca-certificates iproute2 tzdata
fi
phase='检查 vnStat 版本和配置选项'
vnstat_version=$(vnstat --version | awk '$1 == "vnStat" && $2 ~ /^[0-9]+\.[0-9]+/ {print $2; exit}')
if [[ ! "$vnstat_version" =~ ^[0-9]+\.[0-9]+([.][0-9]+)?$ ]] || [[ "$(printf '2.6\n%s\n' "$vnstat_version" | sort -V | head -n1)" != 2.6 ]]; then
  echo '采集端需要 vnStat 2.6 及以上，请检查软件包版本。' >&2
  exit 1
fi
supports_utc=false
if vnstat --showconfig 2>/dev/null | grep -qE '^UseUTC[[:space:]]'; then supports_utc=true; fi
phase='读取主控时区配置'
zone=$(/opt/lightprobe/agent --config "$config_path" --print-timezone)
[[ "$zone" =~ ^[A-Za-z0-9_+/-]+$ && -f "/usr/share/zoneinfo/$zone" ]] || { echo '主控统计时区无效。' >&2; exit 1; }
system_zone=$(timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || readlink -f /etc/localtime 2>/dev/null || true)
system_zone=${system_zone#/usr/share/zoneinfo/}
previous_zone="$system_zone"
override=/etc/systemd/system/vnstat.service.d/lightprobe-timezone.conf
if [[ "$ID" == alpine ]]; then override=/etc/conf.d/vnstatd; fi
if [[ -f "$override" ]]; then previous_zone=$(sed -n 's/^Environment=TZ=//p' "$override" | head -n1); fi
if [[ "$ID" == alpine && -f "$override" ]]; then
  previous_zone=$(sed -n 's/^export TZ=//p' "$override" | head -n1)
  previous_zone=${previous_zone:-$system_zone}
fi
if [[ -f /etc/vnstat.conf ]] && grep -qE '^UseUTC[[:space:]]+1([[:space:]]|$)' /etc/vnstat.conf; then previous_zone=UTC; fi
history_start=$(TZ="$zone" date +%F)
if [[ "$previous_zone" != "$zone" ]]; then
  history_start=$(TZ="$zone" date -d tomorrow +%F)
  echo "vnStat 统计时区将改为 $zone（不修改全局系统时区）。为避免混合旧时区数据，从 $history_start 开始接收日流量。"
fi
if [[ "$ID" == alpine ]]; then
  install -d -m 0755 /etc/conf.d
  if [[ -f "$override" ]]; then
    [[ -f "$override.lightprobe-backup" ]] || cp -p "$override" "$override.lightprobe-backup"
    sed -i '/^export TZ=/d' "$override"
  fi
  printf '\nexport TZ=%s\n' "$zone" >> "$override"
else
  install -d -m 0755 /etc/systemd/system/vnstat.service.d
  printf '[Service]\nEnvironment=TZ=%s\n' "$zone" > "$override"
fi
# Preserve history_start when reinstalling with the same node credentials.
phase='配置网卡和流量历史'
python3 - "$config_path" "$zone" "$history_start" <<'PY'
import json, os, sys, urllib.request, subprocess, re
source, zone, start = sys.argv[1:]
with open(source, encoding='utf-8-sig') as f: cfg = json.load(f)
request = urllib.request.Request(cfg['server'].rstrip('/') + '/api/agent/config', headers={'Authorization': 'Bearer ' + cfg['token']})
try:
    with urllib.request.urlopen(request, timeout=15) as response: remote = json.load(response)
except Exception:
    raise SystemExit('无法获取主控配置，请检查 HTTPS、节点密钥和启用状态。')
iface = remote.get('interface', '')
if not iface:
    for command in (['ip', 'route', 'show', 'default'], ['ip', '-6', 'route', 'show', 'default']):
        parts = subprocess.check_output(command, text=True).split()
        if 'dev' in parts: iface = parts[parts.index('dev') + 1]; break
if not re.fullmatch(r'[a-zA-Z0-9_.:@-]{1,40}', iface): raise SystemExit('未找到网卡，请在后台手动指定。')
subprocess.run(['vnstat', '--add', '-i', iface], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
old_path = '/etc/lightprobe-agent.json'
if os.path.isfile(old_path):
    with open(old_path) as f: old = json.load(f)
    if old.get('token') == cfg['token'] and old.get('server') == cfg['server'] and old.get('vnstat_timezone') == zone:
        start = old.get('history_start', start)
cfg.update(vnstat_timezone=zone, history_start=start)
temporary = old_path + '.new'
with open(temporary, 'w') as f: json.dump(cfg, f, indent=2)
os.chmod(temporary, 0o600)
os.replace(temporary, old_path)
print('统计网卡：' + iface + '；日流量起始日期：' + start)
PY
# Retain at least 730 daily buckets locally so outages can be backfilled.
if [[ -f /etc/vnstat.conf ]]; then
  cp -n /etc/vnstat.conf /etc/vnstat.conf.lightprobe-backup || true
  if grep -qE '^DailyDays[[:space:]]' /etc/vnstat.conf; then
    sed -i 's/^DailyDays[[:space:]].*/DailyDays 730/' /etc/vnstat.conf
  else
    printf '\nDailyDays 730\n' >> /etc/vnstat.conf
  fi
  # vnStat 2.6 uses local daemon time and has no UseUTC configuration option.
  if [[ "$supports_utc" == true ]]; then
    if grep -qE '^UseUTC[[:space:]]' /etc/vnstat.conf; then
      sed -i 's/^UseUTC[[:space:]].*/UseUTC 0/' /etc/vnstat.conf
    else
      printf '\nUseUTC 0\n' >> /etc/vnstat.conf
    fi
  fi
fi
phase='配置并启动系统服务'
if [[ "$ID" == alpine ]]; then
  [[ -x /sbin/openrc-run && -f /etc/init.d/vnstatd ]] || { echo '需要正常运行 OpenRC 的 Alpine 服务器。' >&2; exit 1; }
  # Alpine runs vnstatd as vnstat:vnstat; --add may have created SQLite as root.
  chown vnstat:vnstat /var/lib/vnstat
  find /var/lib/vnstat -maxdepth 1 -type f -name 'vnstat.db*' -exec chown vnstat:vnstat {} +
  cat > /etc/init.d/lightprobe-agent <<'OPENRC'
#!/sbin/openrc-run
description="Firefly Probe monitoring agent"
command="/opt/lightprobe/agent"
command_args="--config /etc/lightprobe-agent.json"
command_user="root"
supervisor="supervise-daemon"
respawn_delay=10
respawn_max=0
output_log="/var/log/lightprobe-agent.log"
error_log="/var/log/lightprobe-agent.log"
depend() { need net; after vnstatd; }
start_pre() {
  umask 077
  checkpath -f -m 0600 -o root:root /var/log/lightprobe-agent.log
}
OPENRC
  chmod 0755 /etc/init.d/lightprobe-agent
  rc-update add vnstatd default
  rc-service vnstatd restart
  rc-update add lightprobe-agent default
  rc-service lightprobe-agent restart
  rc-service lightprobe-agent status
  echo '采集端已安装。检查：rc-service lightprobe-agent status；日志：tail -n 50 /var/log/lightprobe-agent.log'
else
cat > /etc/systemd/system/lightprobe-agent.service <<'UNIT'
[Unit]
Description=LightProbe server monitoring agent
After=network-online.target vnstat.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/lightprobe/agent --config /etc/lightprobe-agent.json
Restart=always
RestartSec=10
User=root
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
CapabilityBoundingSet=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
MemoryMax=96M
TasksMax=32
CPUQuota=10%

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now vnstat
systemctl restart vnstat
systemctl enable lightprobe-agent
systemctl restart lightprobe-agent
echo 'LightProbe 采集端已安装。检查：systemctl status lightprobe-agent --no-pager'
echo '日志：journalctl -u lightprobe-agent -n 50 --no-pager'
fi
