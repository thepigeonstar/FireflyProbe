#!/bin/sh
# Remove only the helper installed by TrafficReporter v1.1.9 helper/install.sh.
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo 'Run this script as root (sudo).' >&2
  exit 1
fi
systemctl disable --now vnstat-reporter.timer 2>/dev/null || true
systemctl stop vnstat-reporter.service 2>/dev/null || true
rm -f /etc/systemd/system/vnstat-reporter.timer /etc/systemd/system/vnstat-reporter.service /etc/vnstat-reporter.json
rm -f /usr/local/lib/vnstat-reporter/vnstat_reporter.py
# Remove the empty helper folder only; preserve any unrelated files.
if [ -d /usr/local/lib/vnstat-reporter ]; then
  rmdir /usr/local/lib/vnstat-reporter 2>/dev/null || true
fi
systemctl daemon-reload
systemctl reset-failed vnstat-reporter.service 2>/dev/null || true
echo 'Traffic Reporter removed. vnStat, traffic history, and Firefly Probe are preserved.'
