# 萤火 · Firefly Probe

轻量服务器监控工具，适合管理约 10–50 台 Linux VPS，独立部署。

- 实时网速、系统资源、运行时间、在线状态与 24 小时趋势。
- 日/月/账单周期流量、额度与到期提醒、在线自动续期、Telegram 通知。
- 多币种服务器费用，统一计算人民币月均支出。
- SSH 安装/更新采集端、拖拽排序、自动/手动国旗。
- 公开只读页面、卡片/列表切换、自定义名称/图标/标题/入口、本地及 Google Drive 加密备份。
- 插件上传、更新、卸载与开发文档。

## 安装与更新

主控准备 curl、tar，以 root 执行；脚本检测 Docker/Compose，缺少时自动安装：

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/main/install-master.sh | bash'
```

支持 Debian 12/13、Ubuntu 22.04/24.04/26.04，amd64/arm64。已有 Docker 与 Compose 使用现有版本，缺少 Docker 从官方 stable 仓库安装最新稳定版；只有 Compose 缺少时校验并补装官方插件。

同一命令自动区分安装/更新。默认目录 `/root/FireflyProbe`，旧 `/root/lightprobe` 安装自动在原目录更新；更新前备份，保留已有配置与数据。新安装按提示配置域名和 HTTPS；已有 Nginx 时反向代理到本机 8080。

域名首页默认公开页，管理员默认入口 `/admin`。在服务器列表添加节点后，复制安装命令到节点执行；也可配置 SSH，由主控安装或更新。采集端支持 Debian 11/12/13、Ubuntu 22.04+、Alpine 3.20+，amd64/arm64。SSH 地址可填 IP 或域名，端口独立填写。

## 文档

- [部署、恢复与排查](docs/Deployment.md)
- [Google Drive 授权与远程恢复](docs/Remote-Backup.md)
- [生产安全配置](docs/Security.md)
- [示例插件包](examples/my-summary.ffplugin.json) · [服务器工具箱](examples/server-toolbox.ffplugin.json)
- [插件开发](docs/wiki/Plugin-Development.md) · [GitHub Wiki](https://github.com/thepigeonstar/FireflyProbe/wiki)
- [更新记录](CHANGELOG.md) · [验证记录](verification.md)

主控：Node.js 24、SQLite、Docker。采集端：FireflyProbe 0.2.4，Go、systemd / OpenRC、vnStat。

卸载主控（保留配置与数据）：

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/main/uninstall-master.sh | bash'
```

服务器列表和监控卡片可显示操作系统及版本（需采集端 0.2.1 或以上）。

支持 SSH 管理 GOST TCP/UDP 明文转发，详见 [转发指南](docs/Forwarding.md)。公开页系统版本需管理员单独开启展示。

旧 LightProbe 采集端可通过“服务器列表 → 全部更新采集端”迁移为 FireflyProbe，保留配置与流量历史；需要已配置 SSH。详见部署文档。
