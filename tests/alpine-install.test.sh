#!/usr/bin/env bash
# Real apk/OpenRC/static-agent integration, run only in isolated CI containers.
set -euo pipefail
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
(cd "$project/agent" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$scratch/agent" .)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$scratch/master-fixture" "$project/tests/helpers/alpine-master-fixture.go"
cp "$project/agent/install.sh" "$scratch/install.sh"
printf '{"server":"http://127.0.0.1:18080","token":"%064d","disk_path":"/"}\n' 0 > "$scratch/config.json"
docker run --rm -v "$scratch:/fixture" alpine:3.22 sh -eu -c '
  apk add --no-cache bash openrc
  mkdir -p /run/openrc
  touch /run/openrc/softlevel
  # Docker owns networking; provide the existing network to OpenRC without touching it.
  printf "#!/sbin/openrc-run\ndepend() { provide net; }\nstart() { return 0; }\n" > /etc/init.d/fixture-net
  chmod 755 /etc/init.d/fixture-net
  rc-service fixture-net start
  /fixture/master-fixture /fixture/report.json &
  # Simulate an existing LightProbe installation with the same node identity.
  mkdir -p /opt/lightprobe
  cp /fixture/agent /opt/lightprobe/agent
  python3 --version >/dev/null 2>&1 || apk add --no-cache python3
  python3 -c "import json; p=json.load(open(\"/fixture/config.json\")); p.update(vnstat_timezone=\"Asia/Shanghai\", history_start=\"2026-01-01\", custom=\"preserved\"); json.dump(p,open(\"/etc/lightprobe-agent.json\",\"w\"))"
  printf "#!/sbin/openrc-run\ncommand=\"/opt/lightprobe/agent\"\ncommand_args=\"--config /etc/lightprobe-agent.json\"\nsupervisor=\"supervise-daemon\"\n" > /etc/init.d/lightprobe-agent
  chmod 755 /etc/init.d/lightprobe-agent
  rc-update add lightprobe-agent default
  rc-service lightprobe-agent start
  bash /fixture/install.sh --config /fixture/config.json --binary /fixture/agent
  rc-service firefly-probe-agent status
  grep -q "export TZ=Asia/Shanghai" /etc/conf.d/vnstatd
  test -f /etc/runlevels/default/firefly-probe-agent
  test ! -f /etc/init.d/lightprobe-agent
  test ! -e /etc/runlevels/default/lightprobe-agent
  test ! -f /etc/lightprobe-agent.json
  test ! -f /opt/lightprobe/agent
  python3 -c "import json; c=json.load(open(\"/etc/firefly-probe-agent.json\")); assert c[\"history_start\"]==\"2026-01-01\" and c[\"custom\"]==\"preserved\""
  for attempt in $(seq 1 30); do
    if test -s /fixture/report.json; then break; fi
    sleep 1
  done
  test -s /fixture/report.json
  before=$(sha256sum /etc/firefly-probe-agent.json | cut -d " " -f 1)
  bash /fixture/install.sh --config /fixture/config.json --binary /fixture/agent
  after=$(sha256sum /etc/firefly-probe-agent.json | cut -d " " -f 1)
  test "$before" = "$after"
  rc-service firefly-probe-agent stop
  rc-service vnstatd stop
  echo "Alpine legacy migration, preserved history/identity, first report and reinstall passed."
'
