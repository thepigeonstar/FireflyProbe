#!/usr/bin/env bash
set -euo pipefail
umask 077
repo='thepigeonstar/FireflyProbe'
ref=''
target='/root/lightprobe'
update=auto
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="${2:?缺少 GitHub 用户名/仓库名}"; shift 2 ;;
    --ref) ref="${2:?缺少版本号}"; shift 2 ;;
    --dir) target="${2:?缺少安装目录}"; shift 2 ;;
    --update) update=true; shift ;;
    *) echo '用法：bash install-master.sh [--repo 用户名/仓库名] [--ref 指定标签或main] [--dir /root/lightprobe] [--update]' >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo '请以 root 运行。' >&2; exit 1; }
[[ "$repo" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || { echo '仓库格式无效。' >&2; exit 1; }
[[ -z "$ref" || "$ref" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo '版本格式无效。' >&2; exit 1; }
[[ "$target" == /* && "$target" != / ]] || { echo '请指定独立的绝对安装目录。' >&2; exit 1; }
for program in curl tar docker; do command -v "$program" >/dev/null || { echo "请先安装 $program（Docker 还需要 Compose 插件）。" >&2; exit 1; }; done
docker compose version >/dev/null
if [[ "$update" == auto ]]; then
  if [[ -f "$target/.env" && -f "$target/compose.yaml" ]]; then
    update=true
    echo '检测到已有主控，将更新程序并保留原配置和数据卷。'
  else
    update=false
  fi
fi
if [[ "$update" == true ]]; then
  [[ -f "$target/.env" && -f "$target/compose.yaml" ]] || { echo '更新需指定原安装目录。' >&2; exit 1; }
elif [[ -d "$target" ]] && [[ -n "$(ls -A -- "$target")" ]]; then
  echo '目录已有文件。更新请使用 --update；新装请使用空目录。' >&2; exit 1
fi
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
kind=tags
if [[ -z "$ref" ]]; then
  # GitHub redirects this URL to the latest published, non-prerelease release.
  # No JSON parser or host Node.js installation is needed.
  if ! release_info=$(curl --proto '=https' --proto-redir '=https' --tlsv1.2 -sSL --connect-timeout 15 --max-time 60 -o /dev/null -w '%{http_code} %{url_effective}' "https://github.com/$repo/releases/latest"); then
    echo '无法查询最新版本，请检查 GitHub 网络连接后重试。' >&2; exit 1
  fi
  case "$release_info" in
    "200 https://github.com/$repo/releases/tag/"*)
      ref=${release_info#"200 https://github.com/$repo/releases/tag/"}
      [[ "$ref" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo '最新版本标签格式不支持。' >&2; exit 1; }
      ;;
    "200 https://github.com/$repo/releases"|"200 https://github.com/$repo/releases/"|"404 "*)
      ref=main; kind=heads; echo '尚无正式 Release，将下载 main 分支。'
      ;;
    *) echo '最新版本查询失败，未更改安装文件。' >&2; exit 1 ;;
  esac
elif [[ "$ref" == main ]]; then
  kind=heads
fi
echo "正在下载 $repo：$ref"
curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fSL --connect-timeout 15 --max-time 300 "https://codeload.github.com/$repo/tar.gz/refs/$kind/$ref" -o "$temporary/source.tar.gz"
mkdir "$temporary/source"
tar -xzf "$temporary/source.tar.gz" --strip-components=1 -C "$temporary/source"
for required in compose.yaml setup.sh update.sh Dockerfile package.json server/main.mjs server/store.mjs server/brand.mjs web/index.html web/app.js web/style.css web/firefly.svg agent/main.go agent/go.mod agent/install.sh agent/bootstrap.sh; do
  [[ -f "$temporary/source/$required" ]] || { echo "仓库缺少 $required，请上传完整项目的文件和文件夹。" >&2; exit 1; }
done
if grep -q "from './costs.mjs'" "$temporary/source/server/main.mjs"; then
  for required in server/costs.mjs server/alarms.mjs server/backups.mjs web/features.js web/features.css web/public.html web/public.js; do
    [[ -f "$temporary/source/$required" ]] || { echo "仓库缺少 $required，请上传完整新版项目。" >&2; exit 1; }
  done
fi
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
for item in agent bin server web tools tests package.json Dockerfile compose.yaml compose.https.yaml Caddyfile setup.sh update.sh install-master.sh README.md verification.md 功能与费用说明.md UPDATE-v0.2.0.md GITHUB发布指南.md 开始部署.md .dockerignore; do
  [[ -e "$temporary/source/$item" ]] && cp -a -- "$temporary/source/$item" "$target/"
done
cd -- "$target"
if [[ "$update" == true ]]; then bash update.sh; else bash setup.sh; fi
