# GitHub 上传和固定安装命令

目标仓库：https://github.com/thepigeonstar/FireflyProbe。

## 现在要补传什么

2026-10-12 检查到仓库只有根目录文件，尚未上传项目子目录，也没有 GitHub Actions 检查记录或正式 Release。

解压 FireflyProbe-latest.zip，进入里面的 FireflyProbe 文件夹。
在仓库网页 Add file → Upload files，把里面的文件和**文件夹**一起拖进上传区域，再 Commit changes。
文件选择窗口通常只选中根目录文件，请使用拖拽方式把以下目录也上传：

- agent
- bin
- server
- web
- tests
- tools
- .github

不要直接上传 ZIP，也不要在仓库根目录多套一层 FireflyProbe 文件夹。不要上传服务器上的 .env、data 或 lightprobe-agent.json。
上传后到 Actions 查看 Check。检查通过后即可安装。

## 固定命令

主控需要已安装 Docker Engine、Compose 插件、curl、tar，以 root 执行：

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/main/install-master.sh | bash'
```

新机器安装，现有 /root/lightprobe 主控自动更新；命令不写版本号，之后不用改。
安装时需要域名：80/443 空闲选择方式 1 自动 HTTPS；已有 Nginx 选择方式 2，并将 HTTPS 反向代理到本机 8080。

## 后续如何发布

当前无正式 Release 时，安装器使用 main 分支。
以后上传更新、检查通过后，在 Releases 创建正式版本，例如 v0.1.4，不要选 prerelease。安装器就会自动使用最新正式 Release。
不需要修改用户的安装命令，也不需要在脚本里修改默认版本号。
已有正式 Release 后，仅修改 main 不会替换正式 Release，需发布新版才能让默认安装器选中它。

## 接入服务器

在主控后台添加服务器，复制安装命令，在对应服务器 root 终端执行即可。每台机器使用各自命令。

参考：[GitHub 上传文件](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)、[GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。
