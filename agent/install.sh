#!/usr/bin/env bash
set -euo pipefail
umask 077
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
[[ -f /etc/os-release ]] || exit 1
# shellcheck disable=SC1091
source /etc/os-release
case "$ID" in
  debian) dpkg --compare-versions "$VERSION_ID" ge 12 || { echo '需要 Debian 12 及以上。'; exit 1; } ;;
  ubuntu) dpkg --compare-versions "$VERSION_ID" ge 22.04 || { echo '需要 Ubuntu 22.04 及以上。'; exit 1; } ;;
  *) echo '首版安装脚本仅支持 Debian / Ubuntu。' >&2; exit 1 ;;
esac
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo '仅提供 amd64 / arm64 程序。' >&2; exit 1 ;; esac
if [[ -z "$binary_path" ]]; then
  for candidate in "$PWD/lightprobe-agent-linux-$arch" "$script_dir/lightprobe-agent-linux-$arch" "$script_dir/../bin/lightprobe-agent-linux-$arch"; do
    if [[ -f "$candidate" ]]; then binary_path="$candidate"; break; fi
  done
fi
[[ -f "$binary_path" ]] || { echo "找不到 lightprobe-agent-linux-$arch，请从安装包 bin 目录上传。" >&2; exit 1; }
install -d -m 0755 /opt/lightprobe
# Avoid replacing a running executable in place.
install -m 0755 "$binary_path" /opt/lightprobe/agent.new
mv -f /opt/lightprobe/agent.new /opt/lightprobe/agent
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y vnstat python3 ca-certificates iproute2 tzdata
zone=$(/opt/lightprobe/agent --config "$config_path" --print-timezone)
[[ "$zone" =~ ^[A-Za-z0-9_+/-]+$ && -f "/usr/share/zoneinfo/$zone" ]] || { echo '主控统计时区无效。' >&2; exit 1; }
system_zone=$(timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || true)
previous_zone="$system_zone"
override=/etc/systemd/system/vnstat.service.d/lightprobe-timezone.conf
if [[ -f "$override" ]]; then previous_zone=$(sed -n 's/^Environment=TZ=//p' "$override" | head -n1); fi
if [[ -f /etc/vnstat.conf ]] && grep -qE '^UseUTC[[:space:]]+1([[:space:]]|$)' /etc/vnstat.conf; then previous_zone=UTC; fi
history_start=$(TZ="$zone" date +%F)
if [[ "$previous_zone" != "$zone" ]]; then
  history_start=$(TZ="$zone" date -d tomorrow +%F)
  echo "vnStat 统计时区将改为 $zone（不修改全局系统时区）。为避免混合旧时区数据，从 $history_start 开始接收日流量。"
fi
install -d -m 0755 /etc/systemd/system/vnstat.service.d
printf '[Service]\nEnvironment=TZ=%s\n' "$zone" > "$override"
# Preserve history_start when reinstalling with the same node credentials.
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
  if grep -qE '^UseUTC[[:space:]]' /etc/vnstat.conf; then
    sed -i 's/^UseUTC[[:space:]].*/UseUTC 0/' /etc/vnstat.conf
  else
    printf '\nUseUTC 0\n' >> /etc/vnstat.conf
  fi
fi
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
