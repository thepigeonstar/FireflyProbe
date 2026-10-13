# v0.2.12

- 主控默认安装目录改为 `/root/FireflyProbe`。
- 固定命令继续自动区分安装和更新。原 `/root/lightprobe` 主控仍在原目录更新，保留原 Compose 项目及数据卷，不自动搬迁。
- 新增 `uninstall-master.sh`：自动识别新旧目录，也支持 `--dir`。停止主控后导出完整数据（包括数据库、密钥和配置），再移除容器与网络，保留安装目录及 Docker 数据卷。
- 卸载失败时不会强制删除数据；不删除 Docker、其他项目或采集端。独立 HTTPS 模式下，主控配套 Caddy 一并停止。
