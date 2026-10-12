#!/usr/bin/env bash
set -euo pipefail
umask 077
repo='thepigeonstar/FireflyProbe'
ref='v0.1.3'
target='/root/lightprobe'
update=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="${2:?缺少 GitHub 用户名/仓库名}"; shift 2 ;;
    --ref) ref="${2:?缺少版本号}"; shift 2 ;;
    --dir) target="${2:?缺少安装目录}"; shift 2 ;;
    --update) update=true; shift ;;
    *) echo '用法：bash install-master.sh --repo 用户名/仓库名 [--ref v0.1.3] [--dir /root/lightprobe] [--update]' >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo '请以 root 运行。' >&2; exit 1; }
[[ "$repo" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ && "$ref" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo '仓库或版本格式无效。' >&2; exit 1; }
[[ "$target" == /* && "$target" != / ]] || { echo '请指定独立的绝对安装目录。' >&2; exit 1; }
for program in curl tar docker; do command -v "$program" >/dev/null || { echo "请先安装 $program（Docker 还需要 Compose 插件）。" >&2; exit 1; }; done
docker compose version >/dev/null
if [[ "$update" == true ]]; then
  [[ -f "$target/.env" && -f "$target/compose.yaml" ]] || { echo '更新需指定原安装目录。' >&2; exit 1; }
elif [[ -d "$target" ]] && [[ -n "$(ls -A -- "$target")" ]]; then
  echo '目录已有文件。更新请使用 --update；新装请使用空目录。' >&2; exit 1
fi
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fSL --connect-timeout 15 --max-time 300 "https://codeload.github.com/$repo/tar.gz/refs/tags/$ref" -o "$temporary/source.tar.gz"
mkdir "$temporary/source"
tar -xzf "$temporary/source.tar.gz" --strip-components=1 -C "$temporary/source"
[[ -f "$temporary/source/compose.yaml" && -f "$temporary/source/setup.sh" ]] || { echo '仓库发布目录不正确，请将项目文件放在仓库根目录。' >&2; exit 1; }
if [[ "$update" == true ]]; then
  expected_project=$(basename "$target")
  container=$(cd "$target" && docker compose ps -aq lightprobe)
  if [[ -n "$container" ]]; then
    active_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container")
    [[ "$active_project" == "$expected_project" ]] || { echo '检测到自定义 Compose 项目名，请按 README 手动更新，保留原项目名。' >&2; exit 1; }
  fi
fi
mkdir -p -- "$target"
# Copy a fixed list. Never copy .env, data, credentials, or change the Compose project name.
for item in agent bin server web tools tests package.json Dockerfile compose.yaml compose.https.yaml Caddyfile setup.sh update.sh install-master.sh README.md verification.md GITHUB发布指南.md UPDATE-v0.1.3.md 开始部署.md .dockerignore; do
  [[ -e "$temporary/source/$item" ]] && cp -a -- "$temporary/source/$item" "$target/"
done
cd -- "$target"
if [[ "$update" == true ]]; then bash update.sh; else bash setup.sh; fi
