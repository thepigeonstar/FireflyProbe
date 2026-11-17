#!/bin/sh
# One-time dependency installation; no persistent APT changes.
set -eu
umask 077
[ "$(id -u)" -eq 0 ] || { echo "请以 root 执行。" >&2; exit 1; }
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

firefly_apt_install vnstat python3 ca-certificates iproute2 tzdata
echo "依赖已安装，请回萤火后台重试一键安装/更新。"
