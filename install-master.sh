#!/usr/bin/env bash
set -euo pipefail
umask 077
repo='thepigeonstar/FireflyProbe'
ref=''
target='/root/FireflyProbe'
target_explicit=false
update=auto
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="${2:?缺少 GitHub 用户名/仓库名}"; shift 2 ;;
    --ref) ref="${2:?缺少版本号}"; shift 2 ;;
    --dir) target="${2:?缺少安装目录}"; target_explicit=true; shift 2 ;;
    --update) update=true; shift ;;
    *) echo '用法：bash install-master.sh [--repo 用户名/仓库名] [--ref 指定标签或main] [--dir /root/FireflyProbe] [--update]' >&2; exit 2 ;;
  esac
done
select_install_target() {
  local preferred=$1 legacy=$2 explicit=$3
  if [[ "$explicit" == false && ! ( -f "$preferred/.env" && -f "$preferred/compose.yaml" ) && -f "$legacy/.env" && -f "$legacy/compose.yaml" ]]; then
    printf '%s\n' "$legacy"
  else
    printf '%s\n' "$preferred"
  fi
}
target=$(select_install_target "$target" /root/lightprobe "$target_explicit")
[[ $EUID -eq 0 ]] || { echo '请以 root 运行。' >&2; exit 1; }
[[ "$repo" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || { echo '仓库格式无效。' >&2; exit 1; }
[[ -z "$ref" || "$ref" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo '版本格式无效。' >&2; exit 1; }
[[ "$target" == /* && "$target" != / ]] || { echo '请指定独立的绝对安装目录。' >&2; exit 1; }
for program in curl tar; do command -v "$program" >/dev/null || { echo "请先安装 $program。" >&2; exit 1; }; done

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
ensure_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    echo '检测到 Docker 和 Compose，将使用现有版本。'
    return
  fi
  [[ -f /etc/os-release ]] || { echo '无法识别系统，请先手动安装 Docker。' >&2; exit 1; }
  # shellcheck disable=SC1091
  . /etc/os-release
  case "$ID:${VERSION_ID:-}" in
    debian:12|debian:13|ubuntu:22.04|ubuntu:24.04|ubuntu:26.04) ;;
    *) echo '自动安装 Docker 支持 Debian 12/13、Ubuntu 22.04/24.04/26.04；其他系统请手动安装。' >&2; exit 1 ;;
  esac
  [[ "${VERSION_CODENAME:-}" =~ ^[a-z]+$ ]] || { echo '系统代号无效。' >&2; exit 1; }
  local architecture repository_file key_file
  architecture=$(dpkg --print-architecture)
  [[ "$architecture" == amd64 || "$architecture" == arm64 ]] || { echo '自动部署支持 amd64/arm64。' >&2; exit 1; }
  if command -v docker >/dev/null; then
    local compose_arch compose_file expected_checksum
    compose_arch=x86_64
    [[ "$architecture" != arm64 ]] || compose_arch=aarch64
    compose_file="docker-compose-linux-$compose_arch"
    echo 'Docker 已存在，仅安装缺少的 Compose 插件，不更新 Docker Engine。'
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 180 "https://github.com/docker/compose/releases/latest/download/$compose_file" -o "$temporary/$compose_file"
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 60 "https://github.com/docker/compose/releases/latest/download/$compose_file.sha256" -o "$temporary/compose.sha256"
    expected_checksum=$(head -c 64 "$temporary/compose.sha256")
    [[ "$expected_checksum" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Compose 校验文件无效。' >&2; exit 1; }
    printf '%s  %s\n' "$expected_checksum" "$temporary/$compose_file" | sha256sum -c -
    install -D -m 0755 "$temporary/$compose_file" /usr/local/lib/docker/cli-plugins/docker-compose
    docker compose version
    return
  fi
  if ! command -v docker >/dev/null; then
    # Never remove a pre-existing container runtime to force installation.
    for package in docker.io docker-ce docker-ce-cli containerd runc podman-docker; do
      if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
        echo "检测到已有 $package，请先修复现有 Docker 安装，脚本不会卸载运行环境。" >&2; exit 1
      fi
    done
  fi
  apt-get update
  apt-get install -y ca-certificates curl
  key_file="$temporary/docker.asc"
  repository_file="$temporary/docker.sources"
  curl --proto '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 90 "https://download.docker.com/linux/$ID/gpg" -o "$key_file"
  install -m 0755 -d /etc/apt/keyrings
  install -m 0644 "$key_file" /etc/apt/keyrings/firefly-docker.asc
  printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/firefly-docker.asc\n' "$ID" "$VERSION_CODENAME" "$architecture" > "$repository_file"
  install -m 0644 "$repository_file" /etc/apt/sources.list.d/firefly-docker.sources
  apt-get update
  if command -v docker >/dev/null; then
    echo 'Docker 已存在，仅补装 Compose 插件。'
    apt-get install -y --no-upgrade docker-compose-plugin
  else
    echo '正在从 Docker 官方 stable 仓库安装最新稳定版。'
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
  fi
  docker --version
  docker compose version
}

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
if grep -q "from './ssh.mjs'" "$temporary/source/server/main.mjs"; then
  for required in package-lock.json server/ssh.mjs web/management.js web/management.css; do
    [[ -f "$temporary/source/$required" ]] || { echo "仓库缺少 $required，请上传完整新版项目。" >&2; exit 1; }
  done
fi
if grep -q "from './notification-targets.mjs'" "$temporary/source/server/main.mjs"; then
  [[ -f "$temporary/source/server/notification-targets.mjs" ]] || { echo '仓库缺少 server/notification-targets.mjs，请上传完整项目。' >&2; exit 1; }
fi
if grep -q "from './network-chart.mjs'" "$temporary/source/server/main.mjs"; then
  for required in server/network-chart.mjs web/background.js web/background.css; do
    [[ -f "$temporary/source/$required" ]] || { echo "仓库缺少 $required，请上传完整项目。" >&2; exit 1; }
  done
fi
if grep -q "from './account.mjs'" "$temporary/source/server/main.mjs"; then
  for required in server/account.mjs tools/recover-admin.mjs web/theme.js web/theme.css; do
    [[ -f "$temporary/source/$required" ]] || { echo "仓库缺少 $required，请上传完整项目。" >&2; exit 1; }
  done
fi
if grep -Fq "readdirSync(join(staticDir,'flags'))" "$temporary/source/server/main.mjs"; then
  [[ -f "$temporary/source/web/flags/us.svg" ]] || { echo '仓库缺少本地国旗图片，请上传完整 web/flags 目录。' >&2; exit 1; }
fi
if grep -q "from './plugins.mjs'" "$temporary/source/server/main.mjs"; then
  for required in server/plugins.mjs web/plugin-host.js web/plugins/registry.json; do
    [[ -f "$temporary/source/$required" ]] || { echo "仓库缺少 $required，请上传完整项目。" >&2; exit 1; }
  done
fi
if grep -q "from './traffic-history.mjs'" "$temporary/source/server/main.mjs"; then
  for required in server/traffic-history.mjs web/traffic-history.js; do
    [[ -f "$temporary/source/$required" ]] || { echo "Repository missing $required" >&2; exit 1; }
  done
fi
if grep -q "from './remote-backup.mjs'" "$temporary/source/server/main.mjs"; then
  for required in server/remote-backup.mjs server/backup-archive.mjs web/remote-backup.js; do
    [[ -f "$temporary/source/$required" ]] || { echo "仓库缺少 $required，请上传完整项目。" >&2; exit 1; }
  done
fi
if grep -Fq '/downloads/google-auth.ps1' "$temporary/source/server/main.mjs"; then
  [[ -f "$temporary/source/tools/google-auth.ps1" ]] || { echo '仓库缺少 Google 授权助手，请上传完整项目。' >&2; exit 1; }
fi
if grep -q "from './login-security.mjs'" "$temporary/source/server/main.mjs"; then
  for required in server/login-security.mjs server/telegram-secret.mjs server/plugin-access.mjs server/plugin-frame.mjs; do
    [[ -f "$temporary/source/$required" ]] || { echo "Repository missing $required" >&2; exit 1; }
  done
fi
if grep -Fq "../agent/entry.sh" "$temporary/source/server/main.mjs"; then
  [[ -f "$temporary/source/agent/entry.sh" ]] || { echo 'Repository missing agent/entry.sh' >&2; exit 1; }
fi
if [[ "$update" == true ]]; then
  expected_project=$(basename "$target" | tr '[:upper:]' '[:lower:]')
  container=$(cd "$target" && docker compose ps -aq lightprobe)
  if [[ -n "$container" ]]; then
    active_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container")
    [[ "$active_project" == "$expected_project" ]] || { echo '检测到自定义 Compose 项目名，请按 README 手动更新，保留原项目名。' >&2; exit 1; }
  fi
fi
ensure_docker
mkdir -p -- "$target"
# Copy a fixed list. Never copy .env, data, credentials, or change the Compose project name.
for item in agent bin server web tools tests docs examples package.json package-lock.json Dockerfile compose.yaml compose.https.yaml Caddyfile setup.sh update.sh install-master.sh uninstall-master.sh README.md verification.md 功能与费用说明.md UPDATE-v0.2.0.md UPDATE-v0.2.1.md UPDATE-v0.2.2.md UPDATE-v0.2.3.md UPDATE-v0.2.4.md UPDATE-v0.2.5.md UPDATE-v0.2.6.md UPDATE-v0.2.7.md UPDATE-v0.2.8.md UPDATE-v0.2.9.md UPDATE-v0.2.10.md UPDATE-v0.2.11.md UPDATE-v0.2.12.md UPDATE-v0.2.13.md UPDATE-v0.2.14.md UPDATE-v0.2.15.md UPDATE-v0.2.16.md UPDATE-v0.2.17.md UPDATE-v0.2.18.md UPDATE-v0.2.19.md 固定安装命令.md GITHUB发布指南.md 开始部署.md .dockerignore; do
  [[ -e "$temporary/source/$item" ]] && cp -a -- "$temporary/source/$item" "$target/"
done
cd -- "$target"
if [[ "$update" == true ]]; then bash update.sh; else bash setup.sh; fi
