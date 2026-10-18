#!/usr/bin/env bash
set -Eeuo pipefail
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
umask 077
migration_backup=''
backup_ready=false
migration_started=false
old_active=false
old_enabled=false
new_active=false
new_enabled=false
backup_agent_file() { [[ ! -f "$1" ]] || cp -p "$1" "$migration_backup/$2"; }
restore_agent_file() {
  if [[ -f "$migration_backup/$2" ]]; then
    install -d -m 0755 "$(dirname "$1")"
    cp -p "$migration_backup/$2" "$1.rollback"
    mv -f "$1.rollback" "$1"
  else
    rm -f "$1"
  fi
}
rollback_agent_migration() {
  [[ -n "$migration_backup" && "$backup_ready" == true ]] || return 0
  set +e
  echo '安装未完成，正在恢复更新前的采集端。' >&2
  if [[ "$migration_started" == true ]]; then
    if [[ "$ID" == alpine ]]; then
      rc-service firefly-probe-agent stop >/dev/null 2>&1
      rc-update del firefly-probe-agent default >/dev/null 2>&1
    else
      systemctl disable --now firefly-probe-agent >/dev/null 2>&1
    fi
  fi
  restore_agent_file /etc/firefly-probe-agent.json new-config
  restore_agent_file /opt/firefly-probe/agent new-binary
  restore_agent_file /etc/systemd/system/firefly-probe-agent.service new-systemd
  restore_agent_file /etc/init.d/firefly-probe-agent new-openrc
  restore_agent_file /etc/lightprobe-agent.json old-config
  restore_agent_file /opt/lightprobe/agent old-binary
  restore_agent_file /etc/systemd/system/lightprobe-agent.service old-systemd
  restore_agent_file /etc/init.d/lightprobe-agent old-openrc
  if [[ "$migration_started" == true ]]; then
    if [[ "$ID" == alpine ]]; then
      [[ "$old_enabled" != true ]] || rc-update add lightprobe-agent default
      [[ "$old_active" != true ]] || rc-service lightprobe-agent restart
      [[ "$new_enabled" != true ]] || rc-update add firefly-probe-agent default
      [[ "$new_active" != true ]] || rc-service firefly-probe-agent restart
    else
      systemctl daemon-reload
      [[ "$old_enabled" != true ]] || systemctl enable lightprobe-agent
      [[ "$old_active" != true ]] || systemctl restart lightprobe-agent
      [[ "$new_enabled" != true ]] || systemctl enable firefly-probe-agent
      [[ "$new_active" != true ]] || systemctl restart firefly-probe-agent
    fi
  fi
  echo "已尝试恢复原采集端；备份目录：$migration_backup。请核对服务状态。" >&2
}
prepare_agent_migration() {
  install -d -m 0700 /var/backups/firefly-probe
  migration_backup=$(mktemp -d /var/backups/firefly-probe/agent-XXXXXXXX)
  chmod 0700 "$migration_backup"
  backup_agent_file /etc/firefly-probe-agent.json new-config
  backup_agent_file /opt/firefly-probe/agent new-binary
  backup_agent_file /etc/systemd/system/firefly-probe-agent.service new-systemd
  backup_agent_file /etc/init.d/firefly-probe-agent new-openrc
  backup_agent_file /etc/lightprobe-agent.json old-config
  backup_agent_file /opt/lightprobe/agent old-binary
  backup_agent_file /etc/systemd/system/lightprobe-agent.service old-systemd
  backup_agent_file /etc/init.d/lightprobe-agent old-openrc
  if [[ "$ID" == alpine ]]; then
    if [[ -f /etc/init.d/lightprobe-agent ]] && rc-service lightprobe-agent status >/dev/null 2>&1; then old_active=true; fi
    [[ ! -e /etc/runlevels/default/lightprobe-agent ]] || old_enabled=true
    if [[ -f /etc/init.d/firefly-probe-agent ]] && rc-service firefly-probe-agent status >/dev/null 2>&1; then new_active=true; fi
    [[ ! -e /etc/runlevels/default/firefly-probe-agent ]] || new_enabled=true
  else
    if systemctl is-active --quiet lightprobe-agent; then old_active=true; fi
    if systemctl is-enabled --quiet lightprobe-agent; then old_enabled=true; fi
    if systemctl is-active --quiet firefly-probe-agent; then new_active=true; fi
    if systemctl is-enabled --quiet firefly-probe-agent; then new_enabled=true; fi
  fi
  backup_ready=true
  echo "采集端更新前备份：$migration_backup"
}

phase='初始化'
report_install_error() {
  local status=$?
  printf '采集端安装失败：%s（行 %s，退出码 %s）\n' "$phase" "${BASH_LINENO[0]}" "$status" >&2
  trap - ERR
  rollback_agent_migration
  exit "$status"
}
trap report_install_error ERR
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
config_path="$PWD/firefly-probe-agent.json"
[[ -f "$config_path" || ! -f "$PWD/lightprobe-agent.json" ]] || config_path="$PWD/lightprobe-agent.json"
binary_path=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) config_path="${2:?缺少配置路径}"; shift 2 ;;
    --binary) binary_path="${2:?缺少程序路径}"; shift 2 ;;
    *) echo '用法：sudo bash install.sh [--config 配置路径] [--binary 程序路径]' >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo '请使用 sudo 或 root 运行。' >&2; exit 1; }
[[ -f "$config_path" ]] || { echo '找不到 firefly-probe-agent.json（兼容旧 lightprobe-agent.json），请先在后台创建节点并下载配置。' >&2; exit 1; }
phase='检查系统版本'
[[ -f /etc/os-release ]] || { echo '无法读取 /etc/os-release，不能识别系统。' >&2; exit 1; }
# shellcheck disable=SC1091
source /etc/os-release
case "$ID" in
  debian) dpkg --compare-versions "$VERSION_ID" ge 11 || { echo "当前 Debian ${VERSION_ID}，需要 Debian 11 及以上。" >&2; exit 1; } ;;
  ubuntu) dpkg --compare-versions "$VERSION_ID" ge 22.04 || { echo '需要 Ubuntu 22.04 及以上。'; exit 1; } ;;
  alpine) [[ "$VERSION_ID" =~ ^[0-9]+\.[0-9]+([.][0-9]+)?$ && "$(apk version -t "$VERSION_ID" 3.20)" != '<' ]] || { echo '需要稳定版 Alpine 3.20 及以上。' >&2; exit 1; } ;;
  *) echo '支持 Debian / Ubuntu / Alpine。' >&2; exit 1 ;;
esac
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo '仅提供 amd64 / arm64 程序。' >&2; exit 1 ;; esac
if [[ -z "$binary_path" ]]; then
  for candidate in "$PWD/firefly-probe-agent-linux-$arch" "$script_dir/firefly-probe-agent-linux-$arch" "$script_dir/../bin/firefly-probe-agent-linux-$arch" "$PWD/lightprobe-agent-linux-$arch" "$script_dir/lightprobe-agent-linux-$arch" "$script_dir/../bin/lightprobe-agent-linux-$arch"; do
    if [[ -f "$candidate" ]]; then binary_path="$candidate"; break; fi
  done
fi
[[ -f "$binary_path" ]] || { echo "找不到 firefly-probe-agent-linux-${arch}，请从安装包 bin 目录上传。" >&2; exit 1; }
phase='备份现有采集端'
prepare_agent_migration
phase='安装采集程序'
install -d -m 0755 /opt/firefly-probe
install -m 0755 "$binary_path" /opt/firefly-probe/agent.new
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
  # Install missing dependencies without coupling agent deployment to OS upgrades.
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-upgrade vnstat python3 ca-certificates iproute2 tzdata
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
zone=$(/opt/firefly-probe/agent.new --config "$config_path" --print-timezone)
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
  echo "vnStat 统计时区将改为 ${zone}（不修改全局系统时区）。为避免混合旧时区数据，从 ${history_start} 开始接收日流量。"
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
old_path = '/etc/firefly-probe-agent.json'
installed = []
for path in (old_path, '/etc/lightprobe-agent.json'):
    if os.path.isfile(path):
        with open(path, encoding='utf-8-sig') as f: installed.append(json.load(f))
if len(installed) == 2 and any(installed[0].get(k) != installed[1].get(k) for k in ('server', 'token')):
    raise SystemExit('新旧采集端配置属于不同节点，请先核对，未停止原服务。')
for old in installed:
    if old.get('token') == cfg['token'] and old.get('server') == cfg['server']:
        cfg = {**old, **cfg}
        if old.get('vnstat_timezone') == zone: start = old.get('history_start', start)
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
phase='迁移并启动 FireflyProbe 服务'
migration_started=true
if [[ "$ID" == alpine ]]; then
  if [[ -f /etc/init.d/lightprobe-agent ]]; then
    if rc-service lightprobe-agent status >/dev/null 2>&1; then rc-service lightprobe-agent stop; fi
    if [[ -e /etc/runlevels/default/lightprobe-agent ]]; then rc-update del lightprobe-agent default; fi
  fi
else
  if systemctl cat lightprobe-agent.service >/dev/null 2>&1; then systemctl disable --now lightprobe-agent; fi
fi
mv -f /opt/firefly-probe/agent.new /opt/firefly-probe/agent
if [[ "$ID" == alpine ]]; then
  [[ -x /sbin/openrc-run && -f /etc/init.d/vnstatd ]] || { echo '需要正常运行 OpenRC 的 Alpine 服务器。' >&2; exit 1; }
  # Alpine runs vnstatd as vnstat:vnstat; --add may have created SQLite as root.
  chown vnstat:vnstat /var/lib/vnstat
  find /var/lib/vnstat -maxdepth 1 -type f -name 'vnstat.db*' -exec chown vnstat:vnstat {} +
  cat > /etc/init.d/firefly-probe-agent <<'OPENRC'
#!/sbin/openrc-run
description="FireflyProbe monitoring agent"
command="/opt/firefly-probe/agent"
command_args="--config /etc/firefly-probe-agent.json"
command_user="root"
supervisor="supervise-daemon"
respawn_delay=10
respawn_max=0
output_log="/var/log/firefly-probe-agent.log"
error_log="/var/log/firefly-probe-agent.log"
depend() { need net; after vnstatd; }
start_pre() {
  umask 077
  checkpath -f -m 0600 -o root:root /var/log/firefly-probe-agent.log
}
OPENRC
  chmod 0755 /etc/init.d/firefly-probe-agent
  rc-update add vnstatd default
  rc-service vnstatd restart
  rc-update add firefly-probe-agent default
  rc-service firefly-probe-agent restart
  rc-service firefly-probe-agent status
  echo '采集端已安装。检查：rc-service firefly-probe-agent status；日志：tail -n 50 /var/log/firefly-probe-agent.log'
else
cat > /etc/systemd/system/firefly-probe-agent.service <<'UNIT'
[Unit]
Description=FireflyProbe server monitoring agent
After=network-online.target vnstat.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/firefly-probe/agent --config /etc/firefly-probe-agent.json
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
systemctl enable firefly-probe-agent
systemctl restart firefly-probe-agent
systemctl is-active --quiet firefly-probe-agent
echo 'FireflyProbe 采集端已安装。检查：systemctl status firefly-probe-agent --no-pager'
echo '日志：journalctl -u firefly-probe-agent -n 50 --no-pager'
fi

# Commit migration only after the new service is confirmed running.
rm -f /etc/systemd/system/lightprobe-agent.service /etc/init.d/lightprobe-agent
rm -f /etc/lightprobe-agent.json /opt/lightprobe/agent
if [[ "$ID" != alpine ]]; then systemctl daemon-reload; fi
echo 'FireflyProbe 采集端迁移完成；保留节点身份、vnStat 和主控历史。'
migration_backup=''
