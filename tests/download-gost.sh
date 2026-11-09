#!/usr/bin/env bash
set -euo pipefail
umask 077
archive=${1:?Usage: download-gost.sh archive-path}
expected=676fb7f78d267b6ae73df719c0c7f2b565dde7147da935cfafbc1e1da558b6d5
verify() { printf '%s  %s\n' "$expected" "$1" | sha256sum -c -; }
if [[ -f "$archive" ]] && verify "$archive"; then
  echo 'Using SHA256-verified GOST archive cache.'
  exit 0
fi
mkdir -p -- "$(dirname -- "$archive")"
partial="$archive.part.$$"
headers="$archive.headers.$$"
trap 'rm -f -- "$partial" "$headers"' EXIT
printf '%s\n' 'Accept: application/octet-stream' 'X-GitHub-Api-Version: 2022-11-28' > "$headers"
if [[ -n "${GITHUB_TOKEN:-}" ]]; then printf 'Authorization: Bearer %s\n' "$GITHUB_TOKEN" >> "$headers"; fi
common=(--proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 2 --retry-delay 3 --retry-max-time 90 --retry-connrefused --connect-timeout 15 --max-time 90)
asset_url="https://api.github.com/repos/go-gost/gost/releases/assets/536443639?firefly_run=${GITHUB_RUN_ID:-local}&time=$(date +%s)"
# Pinned official release asset, checked against the same pinned SHA as the browser URL.
echo 'Downloading official GOST archive through GitHub Release Assets API...'
if curl "${common[@]}" -H "@$headers" \
  --write-out 'GOST API download HTTP status: %{http_code}\n' \
  "$asset_url" -o "$partial" && verify "$partial"; then
  mv -f -- "$partial" "$archive"
  exit 0
fi
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo 'Retrying public asset API without workflow authentication...'
  printf '%s\n' 'Accept: application/octet-stream' 'X-GitHub-Api-Version: 2022-11-28' > "$headers"
  if curl "${common[@]}" -H "@$headers" --write-out 'GOST public API HTTP status: %{http_code}\n' "$asset_url" -o "$partial" && verify "$partial"; then
    mv -f -- "$partial" "$archive"
    exit 0
  fi
fi
echo 'Official asset API download or checksum failed; trying official release URL...'
rm -f -- "$partial"
if curl "${common[@]}" --write-out 'GOST release download HTTP status: %{http_code}\n' \
  https://github.com/go-gost/gost/releases/download/v3.3.0/gost_3.3.0_linux_amd64.tar.gz -o "$partial" && verify "$partial"; then
  mv -f -- "$partial" "$archive"
  exit 0
fi
echo 'Both official GOST download paths failed or returned an invalid checksum. Forwarding tests have NOT passed.' >&2
exit 1
