#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run this isolated installer test as root.' >&2; exit 1; }
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/mock" "$scratch/source/server" "$scratch/source/web" "$scratch/source/agent"
for file in compose.yaml Dockerfile package.json .dockerignore server/main.mjs server/store.mjs server/brand.mjs web/index.html web/app.js web/style.css web/firefly.svg agent/main.go agent/go.mod agent/install.sh agent/bootstrap.sh; do
  printf 'fixture\n' > "$scratch/source/$file"
done
printf '#!/usr/bin/env bash\nprintf "setup\\n" >> "$TEST_TRACE"\n' > "$scratch/source/setup.sh"
printf '#!/usr/bin/env bash\nprintf "update\\n" >> "$TEST_TRACE"\n' > "$scratch/source/update.sh"
tar -czf "$scratch/source.tar.gz" -C "$scratch" source
cat > "$scratch/mock/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
url=''
output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -w|--proto|--proto-redir|--tlsv1.2|--connect-timeout|--max-time)
      if [[ "$1" == --tlsv1.2 ]]; then shift; else shift 2; fi
      ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
[[ -n "$url" ]] || { echo 'Mock curl received no URL.' >&2; exit 2; }
if [[ "$url" == */releases/latest ]]; then
  [[ "$TEST_RELEASE" != network-error ]] || exit 7
  printf '%s' "$TEST_RELEASE"
else
  printf '%s\n' "$url" >> "$TEST_TRACE"
  cp "$TEST_ARCHIVE" "$output"
fi
MOCK
cat > "$scratch/mock/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *version* ]]; then exit 0; fi
if [[ "$*" == *'ps -aq'* ]]; then exit 0; fi
echo 'Unexpected Docker mutation in installer fixture test.' >&2
exit 1
MOCK
chmod +x "$scratch/mock/curl" "$scratch/mock/docker"
export PATH="$scratch/mock:$PATH"
export TEST_ARCHIVE="$scratch/source.tar.gz" TEST_TRACE="$scratch/trace"

export TEST_RELEASE='200 https://github.com/thepigeonstar/FireflyProbe/releases/tag/v9.8.7'
bash "$project/install-master.sh" --dir "$scratch/latest"
grep -q '/refs/tags/v9.8.7' "$TEST_TRACE"
grep -q '^setup$' "$TEST_TRACE"

: > "$TEST_TRACE"
export TEST_RELEASE='200 https://github.com/thepigeonstar/FireflyProbe/releases'
bash "$project/install-master.sh" --dir "$scratch/branch"
grep -q '/refs/heads/main' "$TEST_TRACE"

: > "$TEST_TRACE"
printf 'KEEP_THIS_PASSWORD\n' > "$scratch/branch/.env"
bash "$project/install-master.sh" --dir "$scratch/branch"
grep -q '^update$' "$TEST_TRACE"
grep -q '^KEEP_THIS_PASSWORD$' "$scratch/branch/.env"

: > "$TEST_TRACE"
export TEST_RELEASE='network-error'
if bash "$project/install-master.sh" --dir "$scratch/network-error"; then echo 'Network failure must not install.' >&2; exit 1; fi
[[ ! -e "$scratch/network-error" ]]

# An incomplete repository must be rejected before changing an existing installation.
mkdir -p "$scratch/incomplete/source"
printf 'bad\n' > "$scratch/incomplete/source/compose.yaml"
tar -czf "$scratch/incomplete.tar.gz" -C "$scratch/incomplete" source
export TEST_ARCHIVE="$scratch/incomplete.tar.gz" TEST_RELEASE='404 missing'
printf 'original\n' > "$scratch/branch/compose.yaml"
if bash "$project/install-master.sh" --dir "$scratch/branch"; then echo 'Incomplete archive must fail.' >&2; exit 1; fi
grep -q '^original$' "$scratch/branch/compose.yaml"
grep -q '^KEEP_THIS_PASSWORD$' "$scratch/branch/.env"
echo 'Installer fixtures passed: latest, main fallback, automatic update, network failure, incomplete repository.'
