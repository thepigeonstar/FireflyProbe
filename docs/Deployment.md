## 1. 部署主控（域名 + 自动 HTTPS）

先确认：主控有 Docker Engine 和 `docker compose` 插件；域名的 A/AAAA 记录指向主控；TCP 80/443 未被其他程序占用，并在防火墙和云安全组放行。若服务器没有可用 IPv6，不要配置 AAAA 记录。

把整个安装包上传到主控并解压。进入包含 `compose.yaml` 的 `lightprobe` 目录：

```bash
bash setup.sh
```

脚本询问域名和部署方式，自动生成初始管理员密码，写入权限为 600 的 `.env`，构建并启动主控。选择方式 1 启动 Caddy；方式 2 配合已有反向代理。首次构建需要下载官方 Go、Node、Caddy 镜像。保存脚本输出的账号和密码，然后打开 `https://你的域名`。

默认统计时区为 `Asia/Shanghai`。如要用 UTC，在首次启动前手动创建 `.env` 并设置 `TIMEZONE=UTC`。统计时区首次保存设置后固定，不能在后台直接改，避免混合日流量。

如果初始化已经创建了 `.env`，重复启动或升级用：

```bash
docker compose -f compose.yaml -f compose.https.yaml up --build -d
docker compose -f compose.yaml -f compose.https.yaml ps
docker compose -f compose.yaml -f compose.https.yaml logs --tail=100
```

`setup.sh` 不会覆盖已有 `.env`。构建或证书申请失败时，保留该文件再排查。

## 2. 已有 Nginx / Caddy / 宝塔反向代理

如果 80/443 已被现有代理占用，**只启动主控**，不要启动随附 Caddy：

```bash
cp .env.example .env
chmod 600 .env
nano .env
docker compose up --build -d
```

把 `.env` 中的占位密码换成至少 12 位的随机密码，修改 `DOMAIN` 和 `PUBLIC_URL`。配置现有代理：HTTPS 域名 → `http://127.0.0.1:8080`。保留 `COOKIE_SECURE=true`。

Nginx 的站点配置中可使用：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 128k;
}
```

TLS 证书在现有代理中配置。若代理本身在另一个 Docker 容器，不能直接使用它自己的 127.0.0.1；需要让两个服务加入同一个 Docker 网络，通过服务名连接。主控默认 8080 仅绑定宿主机 loopback，节点应使用 HTTPS 域名，不需要对外开放 8080。

## 3. 接入第一台服务器

1. 登录后台 → 添加服务器。
2. 填名称、分组、额度、结算日；额度单位是 **GiB（1024³ 字节）**，0 表示不设额度。服务商使用十进制 GB/TB 时，请先转换。
3. 网卡留空自动使用默认路由网卡；有多网卡或特殊路由时手动填写 `eth0`、`ens3` 等。
4. 创建后点击“复制安装命令”，到对应服务器的 root 终端粘贴执行。命令只显示一次，遗失后可在“详情”里重新生成密钥。
5. 命令自动从主控下载脚本、对应架构的程序和校验文件，验证节点密钥后安装。无需手动上传文件。服务器须有 curl 和 CA 证书；缺少时先运行 `apt-get update && apt-get install -y curl ca-certificates`。

手动方式仍保留：展开“手动下载配置（备用）”，将配置与 `agent/install.sh`、对应架构的 `bin/lightprobe-agent-linux-*` 上传到同一目录，再执行 `sudo bash install.sh`。

采集端安装脚本支持 Debian 11/12/13 与 Ubuntu 22.04 及以上的发行版检查路径，要求 systemd、apt 和可访问的主控 HTTPS。真实发行版安装仍应先在你的测试机验证。

脚本会安装 vnStat、Python 3（仅用于安装配置）、CA 证书及基础工具；将采集程序放在 `/opt/lightprobe/agent`，配置写入 `/etc/lightprobe-agent.json`（权限 600）；配置 vnStat 的服务时区并重启 vnStat，设置本地日历史保留 730 天，然后启用 `lightprobe-agent.service`。

不会执行远程命令，不需要给节点开放新的入站端口。当前采集服务以 root 运行并启用 systemd 限制；没有命令下发接口，程序不自动更新。

### 首次流量与时区

- 首次安装默认只接收安装日期起的日流量，不导入早于安装日期的历史。统计的是整天，不是“安装时刻起”的差值。
- 如果原 vnStat 时区和主控不同，为避免当日桶混合两种时区，从**次日**开始接收日流量。实时网速和系统状态可以立即显示。
- 重新安装相同节点、相同密钥且时区不变时保留原历史起点。轮换密钥后重新安装会更新历史起点，但主控已有历史不删除。
- vnStat 初始建库、落盘存在延迟，首次日流量不一定马上出现。页面显示未同步提示，不把“没有数据”当成已采集的零流量。
- 本地 vnStat 中保留的数据能在主控恢复后补报，但补报范围最多是后台设置的日历史保留天数。无法恢复采集前或本地已删除的数据。
- 安装脚本添加 `/etc/systemd/system/vnstat.service.d/lightprobe-timezone.conf`，不修改全局系统时区。程序支持 UseUTC 时将其设为 0；vnStat 2.6 不写入该选项。让服务使用指定的 TZ（选择 UTC 主控时 TZ 本身就是 UTC）。会备份首次修改前的 `/etc/vnstat.conf` 为 `.lightprobe-backup`。

### 检查采集端

```bash
systemctl status lightprobe-agent --no-pager
journalctl -u lightprobe-agent -n 50 --no-pager
vnstat -i eth0 --json d 2
sudo /opt/lightprobe/agent --config /etc/lightprobe-agent.json --check
```

最后一条仅在本地输出采集值，不提交数据、不输出密钥。首个网速采样为 0，第二次开始按计数器差值计算。

## 4. 数据口径和性能设计

- 上传/下载以服务器网卡 TX/RX 方向为准，网速是字节/秒，页面显示 KiB/s、MiB/s；不是主动测速，也不是某个用户的代理业务用量。
- 每台机器仅统计指定的一张网卡；网卡流量包括经过该网卡的系统更新、备份等。服务商计费可能另有口径，本工具不保证与账单完全相等。
- 首次上报后把自动选择的网卡写回节点配置。已有日历史后更换统计网卡请新建节点，避免重复累计；接口也会阻止直接切换。
- 日流量按“节点 + 网卡 + 日期”幂等更新，重复补报不重复相加。vnStat 的历史值下降时保留主控原值并提示异常，避免静默少算。
- 账单日 29–31 在短月份按月底处理。账单周期是开始日包含、下个结算日不包含。到期日仅显示，不自动停止节点或业务。
- 最新状态在主控内存中，分钟趋势按分钟写入 SQLite。主控意外崩溃可能丢失最后约一分钟的实时趋势/最后上报记录；日流量可以由 vnStat 再同步。
- 默认 5 秒上报、45 秒无有效上报判离线，日流量约 5 分钟同步；全局上报间隔在后台可改为 3–60 秒。
- 默认日历史 180 天、分钟趋势 7 天，清理任务每小时执行一次。详情页面显示最近 24 小时趋势及最近 180 个日桶。
- SQLite WAL，主控只有一个服务实例；不要横向启动多个主控写同一数据卷。
- 50 台 × 5 秒间隔 ≈ 10 次上报请求/秒。这个值是请求量计算，真实 VPS 的资源与延迟需要现场测量。

Compose 默认主控内存上限 384 MB、CPU 上限 0.75 核，Caddy 内存上限 128 MB；这不是实际资源需求或已验证容量保证。部署后观察 `docker stats`，不要在资源已满的主机上直接接入全部节点。

## 5. Telegram 通知

在“通知”填写 Bot Token、Chat ID，保存后发送测试通知。Token 加密保存在数据库中，接口不回显。留空保留原 Token，填写新值可替换；勾选“清除已保存 Token”可删除。旧版 Token 在首次启动时自动迁移；跨 VPS 恢复推荐加密 .ffbackup，以恢复加密凭据。

启用日报后按主控统计时区，在指定时间汇总昨日流量和当前账单周期用量。每个日期只入队一次；多节点按消息大小分块发送。首次开启时若已过发送时间，当天会立即入队。

额度告警按“节点 + 周期 + 额度 + 计费方向 + 阈值”去重；修改额度或计费方向后可能重新发告警。流量有同步错误、时区不一致或超过 15 分钟未同步时暂停额度告警。

通知异步发送，失败退避重试，最多 12 次；后台可查看发送状态。Telegram 在请求已经送达但响应丢失时，重试可能产生重复消息，无法保证外部通知严格只送一次。主控需能访问 `api.telegram.org`。

Bot Token 保存在 SQLite 配置中。备份含有通知凭据；数据库上报密钥只存哈希。主控重启后管理登录会话失效，需要重新登录。

## 6. 备份、升级、恢复

先备份再升级。下面的方法短暂停止主控，复制整个数据目录，避免单独复制 SQLite 主文件丢失 WAL 数据：

```bash
mkdir -p backups
docker compose stop lightprobe
docker compose cp lightprobe:/app/data ./backups/data
cp .env ./backups/env
chmod -R go-rwx backups
docker compose start lightprobe
```

恢复到已初始化的数据卷时，停止服务，先保留当前数据备份，再复制备份目录的内容回 `/app/data`；确保文件属于容器内 `node` 用户（UID 1000）。不要在运行时用旧数据库覆盖新数据库。

升级主控：保留 `.env` 与命名数据卷，替换源码，重新构建。使用内置 HTTPS 的部署运行双 compose 启动命令。**不要执行 `docker compose down -v`，该命令会删除数据卷。**

升级采集端：用新的节点接入命令重新安装，或者上传新二进制和配置运行安装脚本。安装脚本使用临时文件替换程序，随后重启服务。

修改管理员密码：编辑 `.env` 的 `ADMIN_PASSWORD`，然后重新创建主控容器。重启会使之前的登录会话失效。

## 7. 卸载节点采集端

先在主控停用或删除对应节点，再执行：

```bash
sudo systemctl disable --now lightprobe-agent
sudo rm -f /etc/systemd/system/lightprobe-agent.service
sudo rm -f /etc/lightprobe-agent.json /opt/lightprobe/agent
sudo systemctl daemon-reload
```

保留 vnStat 及其数据库，不删除历史。如果不再使用 vnStat 的 LightProbe 时区配置，移除 `/etc/systemd/system/vnstat.service.d/lightprobe-timezone.conf` 后 `systemctl daemon-reload` 并重启 vnStat。改回时区也会影响当日桶，应记录该变更。

## 8. 开发与验证

Node.js 24：

```bash
npm test
```

Go 1.23 及以上：

```bash
cd agent
go test ./...
```

Windows 重建 Linux amd64/arm64：`powershell -File tools/build-agent.ps1`。

本地试运行需设置 `ADMIN_PASSWORD`（至少 12 位），默认监听 127.0.0.1:8080：`node server/main.mjs`。局部 HTTP 调试时使用 `COOKIE_SECURE=false`；远程采集端强制 HTTPS。

检查范围与尚未验证项见 `verification.md`。本版本没有公开访客页、远程终端、远程命令、自动升级、多管理员、多网卡合并、主动延迟测速或跨主控高可用。

## 目录

```
server/       主控、SQLite 存储、接口与通知队列
web/          中文后台，无外部 CDN
agent/        Go 采集端、systemd 安装脚本
bin/          Linux amd64 / arm64 预编译采集程序
tests/        主控接口与账单周期测试
tools/        采集端编译工具
compose.yaml  独立主控
compose.https.yaml + Caddyfile  可选自动 HTTPS
setup.sh      主控初始化
```

基础组件参考：[Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)、[vnStat 官方手册](https://humdi.net/vnstat/man/vnstat.html)。

本次调整见 [UPDATE-v0.2.6.md](../UPDATE-v0.2.6.md)。国家识别使用 [country.is](https://github.com/lineofflight/country)，国旗为随包提供的 flag-icons SVG。

## 主控默认目录与卸载

新安装默认 `/root/FireflyProbe`，已有 `/root/lightprobe` 安装继续在原目录更新，不需要移动目录或更换数据卷。固定安装命令仍然兼容安装与更新，更新前备份。

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/main/uninstall-master.sh | bash'
```

卸载保留安装目录、配置与数据卷。卸载前完整数据副本位于安装目录的 `uninstall-backups`，包含数据库、SSH 密钥及配置；请妥善保存。使用自定义安装目录时在管道末端加 `bash -s -- --dir /你的目录`。卸载主控不会卸载服务器采集端；采集端配置需在迁移后按实际主控域名调整。

Debian 11 采集端使用官方 vnStat 2.6 包，支持所需 JSON 日流量与 DailyDays 保留设置。参考：[Debian 11 vnStat 手册](https://manpages.debian.org/bullseye/vnstat/vnstat.1.en.html)。兼容性分支及解析已验证，实机安装仍需核对日志与首次上报；本次未扩大主控 Docker 自动安装的系统范围。
