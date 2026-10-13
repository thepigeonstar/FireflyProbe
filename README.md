# 萤火 · Firefly Probe

轻量服务器监控工具，适合管理约 10–50 台 Linux VPS，独立部署。

- 实时网速、系统资源、运行时间、在线状态与 24 小时趋势。
- 日/月/账单周期流量、额度与到期提醒、Telegram 通知。
- 多币种服务器费用，统一计算人民币月均支出。
- SSH 安装/更新采集端、拖拽排序、自动/手动国旗。
- 公开只读页面、自定义名称/图标/标题/入口、本地及 Google Drive 加密备份。
- 插件上传、更新、卸载与开发文档。

## 安装与更新

主控准备 curl、tar，以 root 执行；脚本检测 Docker/Compose，缺少时自动安装：

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/main/install-master.sh | bash'
```

支持 Debian 12/13、Ubuntu 22.04/24.04/26.04，amd64/arm64。已有 Docker 与 Compose 使用现有版本，缺少 Docker 从官方 stable 仓库安装最新稳定版；只有 Compose 缺少时校验并补装官方插件。

同一命令自动区分安装/更新。默认目录 `/root/lightprobe`，更新前备份，保留已有配置与数据。新安装按提示配置域名和 HTTPS；已有 Nginx 时反向代理到本机 8080。

域名首页默认公开页，管理员默认入口 `/admin`。在服务器列表添加节点后，复制安装命令到节点执行；也可配置 SSH，由主控安装或更新。支持 Debian 12/13、Ubuntu 22.04+，amd64/arm64。

## 文档

- [部署、恢复与排查](docs/Deployment.md)
- [Google Drive 授权与远程恢复](docs/Remote-Backup.md)
- [示例插件包](examples/my-summary.ffplugin.json)
- [插件开发](docs/wiki/Plugin-Development.md) · [GitHub Wiki](https://github.com/thepigeonstar/FireflyProbe/wiki)
- [本次更新](UPDATE-v0.2.9.md) · [验证记录](verification.md)

主控：Node.js 24、SQLite、Docker。采集端：Go、systemd、vnStat。
