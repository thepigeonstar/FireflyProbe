#!/usr/bin/env bash
# Exercise actual APT configuration merging and hooks in an isolated Debian container.
set -euo pipefail
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
docker run --rm -i -v "$project:/source:ro" debian:trixie-slim sh -s <<'SH'
set -eu
scratch=$(mktemp -d)
chmod 755 "$scratch"
sed -n '/^firefly_apt_install() (/,/^)/p' /source/agent/entry.sh > "$scratch/helper.sh"
. "$scratch/helper.sh"
mkdir -p "$scratch/pkg/DEBIAN"
printf 'Package: firefly-apt-fixture\nVersion: 1.0\nArchitecture: all\nMaintainer: Fixture <fixture@example.invalid>\nDescription: isolated hook test\n' > "$scratch/pkg/DEBIAN/control"
dpkg-deb --build "$scratch/pkg" "$scratch/fixture.deb"
chmod 644 "$scratch/fixture.deb"
cat > /usr/bin/apt-listchanges <<'HOOK'
#!/bin/sh
cat > /dev/null
echo INVOKED > /tmp/listchanges-invoked
exit 139
HOOK
chmod 755 /usr/bin/apt-listchanges
printf 'DPkg::Pre-Install-Pkgs {"/usr/bin/apt-listchanges --apt || test $? -lt 10";};\n' > /etc/apt/apt.conf.d/20listchanges
cat > /usr/local/bin/fixture-required <<'HOOK'
#!/bin/sh
cat > /dev/null
echo RETAINED > /tmp/required-invoked
if [ -f /tmp/force-hook-failure ]; then exit 17; fi
HOOK
chmod 755 /usr/local/bin/fixture-required
printf 'DPkg::Pre-Install-Pkgs::required "/usr/local/bin/fixture-required";\nDPkg::Pre-Invoke {"touch /tmp/pre-invoke-retained";};\n' > /etc/apt/apt.conf.d/21required
apt-config dump > "$scratch/before"
# Control: none does not rescue a hook that crashes before handling the variable.
if DEBIAN_FRONTEND=noninteractive APT_LISTCHANGES_FRONTEND=none apt-get install -y "$scratch/fixture.deb"; then
  echo 'Expected crashing hook to block installation' >&2; exit 1
fi
test -f /tmp/listchanges-invoked
rm /tmp/listchanges-invoked
firefly_apt_install "$scratch/fixture.deb"
test ! -e /tmp/listchanges-invoked
test -f /tmp/required-invoked
test -f /tmp/pre-invoke-retained
test "$(dpkg-query -W -f='${Status}' firefly-apt-fixture)" = 'install ok installed'
apt-config dump > "$scratch/after"
cmp "$scratch/before" "$scratch/after"
# An already-installed package is a no-op with --no-upgrade, even with --reinstall.
# Use a fresh package for the negative test so APT actually reaches the hooks.
sed 's/^Package: firefly-apt-fixture$/Package: firefly-apt-failure-fixture/' "$scratch/pkg/DEBIAN/control" > "$scratch/pkg/DEBIAN/control.new"
mv "$scratch/pkg/DEBIAN/control.new" "$scratch/pkg/DEBIAN/control"
dpkg-deb --build "$scratch/pkg" "$scratch/failure.deb"
chmod 644 "$scratch/failure.deb"
rm /tmp/required-invoked
# A genuine failure in another hook must still stop APT and preserve status 100.
touch /tmp/force-hook-failure
if firefly_apt_install "$scratch/failure.deb"; then
  echo 'Expected required hook failure to stop APT' >&2; exit 1
else
  status=$?
  test "$status" -eq 100
fi
test -f /tmp/required-invoked
if dpkg-query -W -f='${Status}' firefly-apt-failure-fixture 2>/dev/null; then
  echo 'The failing hook must prevent package installation' >&2; exit 1
fi
test ! -e /tmp/listchanges-invoked
apt-config dump > "$scratch/after-failure"
cmp "$scratch/before" "$scratch/after-failure"
echo 'Real APT: crashing hook excluded; other hooks and failures preserved; persistent configuration unchanged.'
SH
