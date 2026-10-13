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
  bash /fixture/install.sh --config /fixture/config.json --binary /fixture/agent
  rc-service lightprobe-agent status
  grep -q "export TZ=Asia/Shanghai" /etc/conf.d/vnstatd
  test -f /etc/runlevels/default/lightprobe-agent
  for attempt in $(seq 1 30); do
    if test -s /fixture/report.json; then break; fi
    sleep 1
  done
  test -s /fixture/report.json
  before=$(sha256sum /etc/lightprobe-agent.json | cut -d " " -f 1)
  bash /fixture/install.sh --config /fixture/config.json --binary /fixture/agent
  after=$(sha256sum /etc/lightprobe-agent.json | cut -d " " -f 1)
  test "$before" = "$after"
  rc-service lightprobe-agent stop
  rc-service vnstatd stop
  echo "Alpine apk/OpenRC install, first report and reinstall passed."
'
