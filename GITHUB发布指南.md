# 发布到 GitHub，以及一键部署

这份包可以直接作为仓库内容。目标公开仓库：https://github.com/thepigeonstar/FireflyProbe，仓库已创建。自动上传未成功，下一步从第 2 步上传开始。

## 1. 创建仓库

登录 GitHub，点击右上角 `+` → `New repository`。

- Repository name：`FireflyProbe`
- 选择 Public（一键下载按公开仓库设计）
- 点击 Create repository

首次公开的是程序源码和预编译采集程序。不要上传 VPS 上的 `.env`、`data` 目录或 `lightprobe-agent.json`。发布包没有这些文件，`.gitignore` 也已排除它们。

## 2. 上传项目内容

解压 `FireflyProbe-v0.1.3.zip`，进入里面的 `FireflyProbe` 文件夹。

在仓库网页点击 `uploading an existing file`，或 `Add file` → `Upload files`。
把 `FireflyProbe` 文件夹**里面的全部文件和目录**拖进去。不要上传 ZIP 文件，也不要把外层 FireflyProbe 文件夹整体作为额外的一层。

仓库根目录应直接看到 `Dockerfile`、`compose.yaml`、`install-master.sh`、`server`、`web`、`agent`、`bin`。
也应包含 `.github/workflows/check.yml`、`.gitignore`、`.dockerignore`、`.gitattributes`。

点击 Commit changes 后，到 Actions 页面查看 Check 检查结果。

## 3. 创建版本标签

仓库右侧 Releases → Create a new release。
选择 Create new tag，填写 `v0.1.3`，目标选择 `main`，发布版本。
这一步让一键部署下载固定版本，避免主分支修改影响已发布的安装命令。

## 4. 一键安装主控

新主控需先有 Docker Engine、Compose 插件、curl 和 tar，并准备好域名。
以 root 执行：

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/v0.1.3/install-master.sh | bash -s -- --repo thepigeonstar/FireflyProbe'
```

默认安装到 `/root/lightprobe`。脚本询问域名和部署方式：

- `1`：自动配置 Caddy HTTPS，要求 80/443 空闲。
- `2`：使用已有 Nginx/反向代理；主控监听本机 8080，HTTPS 和证书由现有反向代理提供。

你当前已有 Nginx 的机器选择 `2`。域名指向、证书和已有 Nginx 配置仍需要按现有环境准备。
脚本不安装 Docker，不覆盖非空目录，也不会改动现有 Nginx。

## 5. 当前主控如何更新

你当前已运行的主控，不要重新初始化。
仓库发布后，在原安装目录对应的机器，以 root 运行：

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/v0.1.3/install-master.sh | bash -s -- --repo thepigeonstar/FireflyProbe --update --dir /root/lightprobe'
```

更新会保留原 `.env` 和 Docker 数据卷，重新构建并启动主控。更新期间页面和上报会短暂中断。
若原来使用自定义 Compose 项目名，请按 README 手动更新，保持原项目名和数据卷。
后续版本发布新的标签后，把命令里的两处版本号都换成新版本。

## 6. 一键接入服务器

主控更新到 v0.1.3 后，在后台添加服务器，点击“复制安装命令”，到对应服务器 root 终端执行。
命令自动从你的主控下载程序，识别架构，校验 SHA256，并安装 vnStat 和 systemd 服务。
不需要从 GitHub 下载，也不需要手动传配置文件。
如果服务器没有 curl，先执行 `apt-get update && apt-get install -y curl ca-certificates`。

每台服务器使用各自命令；命令包含节点密钥，不要公开。
已经接入的服务器继续使用现有采集端，无需重装。

操作参考：[GitHub 上传文件](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)、[创建 Release 和标签](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。
