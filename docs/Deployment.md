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

手动方式仍保留：展开“手动下载配置（备用）”，将配置与 `agent/install.sh`、对应架构的 `bin/firefly-probe-agent-linux-*` 上传到同一目录，再执行 `sudo bash install.sh`。

采集端支持 Debian 11/12/13、Ubuntu 22.04+（systemd/apt）和 Alpine 3.20+ 稳定版（OpenRC/apk），要求可访问主控 HTTPS。真实发行版安装仍应先在你的测试机验证。

脚本会安装 vnStat、Python 3（仅用于安装配置）、CA 证书及基础工具；将采集程序放在 `/opt/firefly-probe/agent`，配置写入 `/etc/firefly-probe-agent.json`（权限 600）；配置 vnStat 的服务时区并重启 vnStat，设置本地日历史保留 730 天，然后启用 `firefly-probe-agent.service`。

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
systemctl status firefly-probe-agent --no-pager
journalctl -u firefly-probe-agent -n 50 --no-pager
vnstat -i eth0 --json d 2
sudo /opt/firefly-probe/agent --config /etc/firefly-probe-agent.json --check
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
sudo systemctl disable --now firefly-probe-agent
sudo rm -f /etc/systemd/system/firefly-probe-agent.service
sudo rm -f /etc/firefly-probe-agent.json /opt/firefly-probe/agent
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

本次调整见 [v0.2.6 更新记录](../CHANGELOG.md#v026)。国家识别使用 [country.is](https://github.com/lineofflight/country)，国旗为随包提供的 flag-icons SVG。

## 主控默认目录与卸载

新安装默认 `/root/FireflyProbe`，已有 `/root/lightprobe` 安装继续在原目录更新，不需要移动目录或更换数据卷。固定安装命令仍然兼容安装与更新，更新前备份。

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/main/uninstall-master.sh | bash'
```

卸载保留安装目录、配置与数据卷。卸载前完整数据副本位于安装目录的 `uninstall-backups`，包含数据库、SSH 密钥及配置；请妥善保存。使用自定义安装目录时在管道末端加 `bash -s -- --dir /你的目录`。卸载主控不会卸载服务器采集端；采集端配置需在迁移后按实际主控域名调整。

Debian 11 采集端使用官方 vnStat 2.6 包，支持所需 JSON 日流量与 DailyDays 保留设置。参考：[Debian 11 vnStat 手册](https://manpages.debian.org/bullseye/vnstat/vnstat.1.en.html)。兼容性分支及解析已验证，实机安装仍需核对日志与首次上报；本次未扩大主控 Docker 自动安装的系统范围。

## Alpine 采集端与 SSH 域名

Alpine 使用后台生成的通用安装命令，入口为 sh，会自动准备 Bash、curl、Python 和证书。安装使用 apk 安装 vnstat、vnstat-openrc、iproute2、tzdata 和 coreutils；若缺少 community 仓库，仅补齐与当前稳定发行版本一致的官方仓库。不开启 edge。

统计时区写入 /etc/conf.d/vnstatd 的 export TZ；不修改全局系统时区，不删除 vnStat 数据。服务为 /etc/init.d/firefly-probe-agent，使用 OpenRC 开机自启和异常重启。需要真实运行 OpenRC 的 Alpine VPS，普通 Alpine Docker 容器不属于生产安装范围。

```sh
rc-service firefly-probe-agent status
tail -n 50 /var/log/firefly-probe-agent.log
rc-service vnstatd status
```

Alpine 日志为 root 私有文件，生产环境可按自己的日志保留策略加入轮转。OpenRC 服务未提供 systemd 相同的 CPU/内存和文件系统沙箱限制，请结合 VPS 资源限制部署。主控 Docker 自动安装范围保持不变，本次只扩展采集端。

SSH 配置的地址可填写 IPv4、IPv6 或域名，例如 nathkt1.bytevirt.net。只填主机名，不带 https://、路径或 :端口；NAT 映射端口单独填写。更换域名或端口后需要重新确认指纹。支持国际域名并规范为 ASCII；实际解析和连接发生在主控。

[Alpine OpenRC 官方说明](https://wiki.alpinelinux.org/wiki/OpenRC)、[Alpine vnstatd 服务脚本](https://github.com/alpinelinux/aports/blob/3.22-stable/community/vnstat/vnstatd.initd)。

## 全部更新采集端

服务器列表的“全部更新采集端”依次逐台更新，使用已保存密码和确认的 SSH 指纹。未接入、停用或缺少 SSH 配置的服务器会跳过并显示原因；单台失败不影响剩余队列。可展开查看各台结果。主控重启会中断队列，需核对状态后重新提交。已有采集端使用原配置，异主控保护继续生效。更新短暂重启采集端，不重启服务器或 GOST。

## 更新进度窗口

v0.2.22 改为一次更新一台，前一台结束后继续下一台；失败不会阻断队列。点击“全部更新采集端”自动打开实时进度弹窗，运行中的服务器展开显示部署日志。完成后汇总成功、失败、跳过，并列出失败机器。关闭窗口不取消更新，可点击“查看更新进度”重新打开。

下载安装采用 HTTP/1.1 和有限重试，始终保留 HTTPS 证书校验。curl 35 Connection reset 表示 HTTPS 连接失败，重试不能解决持续的 DNS、代理、防火墙或主控 TLS 配置问题。

## 公开页服务器名称

服务器列表 → 配置 → 勾选“公开页显示服务器名称”。默认不勾选，包括升级前已有节点；公开卡片、公开网速详情与接口仅显示国家名称，优先使用手动国家 / 国旗，未识别时显示未知地区。勾选后才公开后台设置的名称，管理员页面不受影响。节点是否公开仍由“在公开页面展示本节点”独立控制。

## 日报收发明细

Telegram 日报每台服务器显示昨日上传、下载与两者合计，周期流量仍按节点计费方向统计。最后的昨日总计仅汇总本次日报服务器选择范围，不包含未选中或停用服务器。数据未同步或异常时会提醒合计可能不完整；多段日报只在最后一段附总计。

## 在线自动续期（v0.2.32）

在“服务器列表 → 配置”底部，“计入固定费用”上方勾选“自动续期”。新建节点默认勾选，已有开关状态保留。续期统一跟随付款周期：月付延长 1 个月、季付 3 个月、年付 12 个月，自定义按对应月数；不再有独立续期周期。旧独立周期不生效。自动续期不改变费用配置，也不向服务商付款。

按主控统计时区判断日期：例如到期日为 2026-10-18，当天收到新的在线上报后，记录延长为 2026-11-18。离线、未接入、停用、无到期日或取消勾选的节点不延长；跨日之前的旧上报不能触发。短月份保留原日期锚点，例如 1 月 31 日 → 2 月 28 日 → 3 月 31 日。若到期已久后恢复在线，会按原周期补算到未来到期日，不是从恢复日期重算。

配置中显示上次自动续期时间及原到期日。续期后取消旧到期日仍待发送的提醒，未来到期提醒按新日期计算。不需要自动延长的机器请取消勾选；机器在线仅代表仍能上报，无法确认商家是否扣款或是否处于宽限期。

## 临期筛选与手动续费（v0.2.30）

监控总览“在线服务器”卡片下方，待接入数量右侧显示“临期服务器”。点击进入服务器列表，自动选择“临期 / 已到期”，也可在列表状态下拉框直接选择。范围包括已到期、今日到期及未来 3 个自然日内到期的全部服务器，在线、离线、待接入和停用均可查看；无到期日不计入。日期按主控统计时区计算。

例如今天为 2026-10-18，到期日 2026-10-16、2026-10-20、2026-10-21 会显示“已续费”，2026-10-22 不显示。按钮在“一键安装/更新”右侧，不依赖 SSH。点击后在窗口核对原到期日、付款周期和新日期，确认已向服务商续费后再提交。

按“服务器配置 → 付款周期”延长一次：月付 +1 个月、季付 +3 个月、年付 +12 个月，自定义按对应月数；与自动续期共用付款周期。由原到期日延长，保留月底锚点；若长期逾期，加一个周期后仍过期，将继续出现在列表中。确认后更新统计和列表，取消旧到期日尚未发出的提醒，不修改流量、费用或自动续期开关，不代为付款。

窗口打开后若日期或周期已被修改（包括自动续期），提交会提示重新确认；重复提交同一个日期不会多延长一次。若希望所有续费都由你手动确认，请在服务器配置取消勾选“自动续期”；仍开启自动续期的节点会继续沿用自动规则，自动延长后按新日期决定是否出现在临期列表。

## LightProbe 采集端迁移为 FireflyProbe（v0.2.33）

主控更新后，进入“服务器列表 → 全部更新采集端”，按队列逐台迁移到采集端 0.2.3；也可单台“一键安装/更新”。没有 SSH 配置的节点，在其 SSH 终端执行该节点“复制更新命令”提供的命令。仅更新主控不会主动修改受控机器。

新服务名是 firefly-probe-agent，程序 /opt/firefly-probe/agent，配置 /etc/firefly-probe-agent.json，Alpine 日志 /var/log/firefly-probe-agent.log。显示名称为 FireflyProbe，默认配置与 HTTP User-Agent 同时改名。新旧下载 URL 和 SHA256 名称都兼容。

安装器优先读取新配置，兼容 /etc/lightprobe-agent.json。保留同节点的密钥、磁盘路径、history_start、vnStat 时区和附加配置，不删除 vnStat 数据库或主控历史。安装前备份保存在 /var/backups/firefly-probe/agent-*，目录仅 root 可读。新旧配置若属于不同节点则拒绝覆盖；新服务失败时尝试从备份恢复原配置、程序和服务并明确报错。

新服务确认运行后移除旧 lightprobe-agent 服务及旧程序 / 配置，只保留备份。GOST 服务及其统计标识不改变，不重启 GOST。vnStat 仍按已有安装流程重启，但不清空其数据；旧时区 drop-in 文件名保留兼容，以免因改名触发时区历史变化。主控 SQLite 和 Compose 的历史 lightprobe 名称不迁移，避免影响现有数据卷。

检查版本和运行状态：

```bash
/opt/firefly-probe/agent --version
systemctl status firefly-probe-agent --no-pager
journalctl -u firefly-probe-agent -n 50 --no-pager
```

Alpine 使用 rc-service firefly-probe-agent status，以及 tail -n 50 /var/log/firefly-probe-agent.log。服务运行仍需以后台收到 0.2.3 的新上报确认最终接入成功；没有 SSH 的服务器不会由主控自动升级。

## 卡片与列表显示（v0.2.34）

后台“监控总览 → 服务器”区域右侧，在搜索 / 分组旁点击“卡片”或“列表”。列表每行一台服务器，数据随原有轮询刷新，搜索、分组及服务器排序与卡片一致。点击服务器名称、行内空白或“详情”查看最近 24 小时网络；“配置”仍打开该服务器配置。

公开页标题右侧也有独立切换。默认卡片；后台和公开页分别在当前浏览器记住偏好，刷新 / 再次打开后沿用，不会改变其他访客的选择。本地存储被浏览器禁止时，当前页面仍可切换但不保证刷新记忆。

公开列表继续执行名称 / 系统版本 / 网速资源 / 流量的公开权限，隐藏后台专有的 SSH、费用、额度及到期等字段。未允许网速公开时不提供历史链接；进入 24 小时历史页不显示布局切换。手机可在表格区域横向滑动，不改变页面整体宽度。

仅更新主控即可使用，采集端仍为 0.2.3。

## 公开页布局与转发异常联动（v0.2.35）

公开页的卡片 / 列表切换位于总网速区域下方、服务器区域上方，间距约 12px。列表不再显示最后上报列；卡片保持原样。浏览器悬停显示 /servers/UUID 是公开网络详情链接，不包含 SSH 密码或采集密钥。公开页、网速公开权限和节点公开开关仍在服务端检查；管理员接口单独认证，不能仅凭 UUID 修改节点。

转发页面点击“异常规则”卡片或故障预警中的“查看异常”，自动清除原来的分组和搜索，展开左侧异常服务器列表，仅显示至少有一条当前异常规则的服务器。全部入口显示“全部异常服务器”及数量。点击单台服务器后，右侧仅显示该机异常规则；仍可在左侧切换其他异常服务器。直接点击规则状态“异常”时，保留当前分组作为范围。

切换规则状态为“全部”会恢复该分组的服务器列表。异常状态持续随原有 3 秒轮询更新；选中服务器恢复后从异常列表移除，并显示剩余异常服务器。筛选动作不会执行 SSH 或修改转发规则。

## 公开页隐藏分组（v0.2.36）

公开页卡片和列表均不显示服务器分组，例如入口、落地、直连；公开接口也不再返回 group_name。后台监控总览、分组筛选和服务器配置保留分组。此调整不更改服务器名称，公开名称仍由原展示开关决定。仅需更新主控。

## 转发服务器分组排序（v0.2.37）

打开转发页服务器区域的“分组”，在“转发服务器分组”窗口拖动左侧手柄调整顺序，松开后自动保存。手柄获得焦点后也可以用上下方向键调整。分组目录和左侧分组下拉框同步，刷新后保留；“全部分组”和“未分组”保持固定位置。排序不改变分组成员、转发规则和流量历史。仅需更新主控，采集端仍为 0.2.3。

## 跨页排序与大 Metrics 采集修复（v0.2.38 / 采集端 0.2.4）

转发页选择一台服务器，切到“全部”并清空规则搜索后，拖动规则手柄到“上一页”或“下一页”按钮松开，即移到上一页末尾或下一页开头并自动保存；翻页区保持可见。手柄获得焦点后，上下方向键也能跨页排序。不会修改配置或流量历史。

旧采集端对每条规则的 Metrics 响应只读 256 KiB；客户端标签增多后响应会超限，导致整条规则采样不可用、面板偏少。本次改为流式解析（每响应 16 MiB、每行 64 KiB 安全上限），支持标签空格和可选时间戳；遇到读取中断或进程切换拒绝部分样本。点“转发统计不完整 · 查看原因”可查看失败规则。

更新顺序：先执行永久命令更新主控，再到服务器列表点击全部更新采集端（需 SSH）或逐台执行节点对应的更新命令。确认采集端版本 0.2.4 后等约 30–60 秒采样；保留原 GOST 规则，不编辑、不删除、不重新部署。更新采集端不会重启 GOST。原进程还保留的累计计数可补计差额；跨日缺失无法精确拆回各日，恢复时会按收到样本的日期入账，已重启丢失的计数无法还原。因此恢复当天数字可能含此前漏采增量，不能当作精确当天用量。

2026-10-22 用户诊断中两条规则超过旧上限，18 / 18 有效配对；30 秒 GOST 959868 B、网卡 2224032–2228172 B。这证明旧读取上限造成漏采，但不能还原或证明当天 4.33 GiB 对 105.1 GiB 的全部差额。GOST 业务字节与网卡收发总量口径不同，不使用固定倍数校正。
