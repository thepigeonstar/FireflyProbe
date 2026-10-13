#!/usr/bin/env bash
set -euo pipefail
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d "$project/.docker-test.XXXXXXXX")
[[ "$scratch" == "$project"/.docker-test.* && -d "$scratch" ]] || { echo 'Invalid fixture path.' >&2; exit 1; }
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/mock" "$scratch/files"
test_path="$scratch/mock"
case "$(uname -s)" in MINGW*|MSYS*) test_path="$scratch/mock:/usr/bin" ;; esac
export TEST_MOCK="$scratch/mock" TEST_TRACE="$scratch/trace" TEST_COMPOSE_FLAG="$scratch/compose"
for command in bash cat cp grep head install sha256sum; do
  ln -s "$(command -v "$command")" "$scratch/mock/$command"
done
rm "$scratch/mock/install"
cat > "$scratch/mock/docker-template" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == 'compose version' ]]; then [[ -f "$TEST_COMPOSE_FLAG" ]]; else exit 0; fi
MOCK
cat > "$scratch/mock/apt-get" <<'MOCK'
#!/usr/bin/env bash
printf 'apt %s\n' "$*" >> "$TEST_TRACE"
if [[ "$*" == *docker-ce* ]]; then cp "$TEST_MOCK/docker-template" "$TEST_MOCK/docker"; : > "$TEST_COMPOSE_FLAG"; fi
MOCK
cat > "$scratch/mock/dpkg" <<'MOCK'
#!/usr/bin/env bash
printf 'amd64\n'
MOCK
cat > "$scratch/mock/dpkg-query" <<'MOCK'
#!/usr/bin/env bash
exit 1
MOCK
cat > "$scratch/mock/curl" <<'MOCK'
#!/usr/bin/env bash
url='' output=''
while [[ $# -gt 0 ]]; do case "$1" in https://*) url=$1; shift;; -o) output=$2; shift 2;; --tlsv1.2|-fsSL) shift;; *) shift 2;; esac; done
printf 'curl %s\n' "$url" >> "$TEST_TRACE"
case "$url" in *.sha256) if [[ "${TEST_BAD_HASH:-}" == true ]]; then printf '%064d\n' 0 > "$output"; else printf 'fixture-compose' | sha256sum > "$output"; fi;; */gpg) printf 'fixture-key' > "$output";; *) printf 'fixture-compose' > "$output";; esac
MOCK
cat > "$scratch/mock/install" <<'MOCK'
#!/usr/bin/env bash
printf 'install %s\n' "$*" >> "$TEST_TRACE"
if [[ "$*" == *cli-plugins/docker-compose ]]; then : > "$TEST_COMPOSE_FLAG"; fi
MOCK
cat > "$scratch/mock/systemctl" <<'MOCK'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> "$TEST_TRACE"
MOCK
chmod +x "$scratch/mock/"*
printf 'set -euo pipefail\ntemporary=%q\n' "$scratch/files" > "$scratch/runner"
printf 'ID=debian\nVERSION_ID=12\nVERSION_CODENAME=bookworm\n' > "$scratch/os-release"
sed -n '/^ensure_docker() {/,/^}/p' "$project/install-master.sh" | sed "s|/etc/os-release|$scratch/os-release|g" >> "$scratch/runner"
printf '\nensure_docker\n' >> "$scratch/runner"

# The restricted PATH cannot accidentally invoke the host's Docker, apt or systemctl.
cp "$scratch/mock/docker-template" "$scratch/mock/docker"
: > "$TEST_TRACE"; : > "$TEST_COMPOSE_FLAG"
PATH="$test_path" bash "$scratch/runner"
[[ ! -s "$TEST_TRACE" ]]

rm "$TEST_COMPOSE_FLAG"; : > "$TEST_TRACE"
PATH="$test_path" bash "$scratch/runner"
grep -q 'cli-plugins/docker-compose' "$TEST_TRACE"
if grep -q '^apt ' "$TEST_TRACE"; then echo 'Existing Docker must not be replaced.' >&2; exit 1; fi

rm "$TEST_COMPOSE_FLAG"; : > "$TEST_TRACE"
if TEST_BAD_HASH=true PATH="$test_path" bash "$scratch/runner"; then echo 'Bad checksum must fail.' >&2; exit 1; fi
[[ ! -f "$TEST_COMPOSE_FLAG" ]]

rm "$scratch/mock/docker"; : > "$TEST_TRACE"
PATH="$test_path" bash "$scratch/runner"
grep -q 'Components: stable' "$scratch/files/docker.sources"
grep -q '^apt install -y docker-ce docker-ce-cli containerd.io' "$TEST_TRACE"
grep -q '^systemctl enable --now docker' "$TEST_TRACE"
echo 'Docker bootstrap fixtures passed: reuse, Compose only, checksum failure, official stable install.'
