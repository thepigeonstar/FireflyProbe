# Firefly Probe v0.2.0 验证记录

日期：2026-10-12。Windows 本机验证，没有连接或修改用户 VPS。

- Node 主控测试 28 项通过：旧版认证与流量回归，v1 数据库迁移及备份、费用摊分和汇率缓存、分组特殊名称、批量原子性、公开字段白名单、持续告警与到期、维护、趋势范围、完整备份和事务恢复、恢复后旧会话失效。
- 更新前备份工具在运行中的 WAL 数据库上验证成功，并验证指定保留份数。
- Chrome 桌面/移动端检查通过：年付 45 USD 用测试汇率折算月均、费用页、批量维护、三种趋势及时间切换、名称图标、公开访客页、备份下载与页面上传恢复、重新登录，无页面脚本错误或水平溢出。
- 浏览器下载检查验证生成的 Blob 和文件名，未验证操作系统真实保存对话框。截图标明演示数据，费用截图汇率为测试值。
- Go 测试、go vet 通过，Linux amd64/arm64 二进制已重新构建为 0.2.0 并更新 SHA256SUMS。
- ShellCheck 对部署、更新、采集端安装和安装器测试脚本静态检查通过。
- 已读取官方 Frankfurter 文档并实际验证 CNY 基准的 USD/EUR/GBP/JPY/HKD/KRW 数据响应。
- 本机没有 Linux Docker 环境；新版容器和 Bash 安装测试需由上传后的 GitHub CI 检查。旧版提交 27b0a68 的全套 CI 曾通过，这不代表本次新版本 CI 已通过。

以下为此前版本的验证记录：

# GitHub 仓库检查与 CI 测试修正

日期：2026-10-12。检查远端 main 提交 dc7aa0e59eb1194a3ace7a97954b72fcdec20a7e。

- 43 个项目文件及全部目录已上传，包括 .github、两种架构的采集程序、源码和固定安装入口。没有发现实际 .env、SQLite 数据库或节点配置文件。
- Actions 38222310810：Node 主控测试、Go 测试/vet、Bash 语法及 ShellCheck 通过；安装器隔离测试失败，Docker 构建被跳过。
- 隔离测试的 mock curl 错误地将最后一个参数视为 URL，而真实下载命令最后一个参数是 -o 的输出路径。已改成逐个解析 URL 和输出参数，本机 ShellCheck 通过。
- 修正尚需上传并由 GitHub Linux CI 重新验证；当前不能将 Docker 构建或完整安装流程标为通过。

# 固定安装入口补充验证

日期：2026-10-12。

- 公开仓库已上传根目录文件，但缺少 agent/bin/server/web/tests/tools/.github；尚无远端 CI 记录及正式 Release。
- 实测 GitHub 在无正式 Release 时把 /releases/latest 重定向到 /releases，返回 HTTP 200；安装器已支持该情况，也支持 404。
- 修改后的安装、更新脚本及新增 Linux 隔离测试脚本通过 ShellCheck 静态检查。
- GitHub 工作流加入隔离测试：最新正式标签、main 回退、自动更新并保留 .env、网络失败、源文件缺失时不覆盖旧文件。该 Linux 测试尚未在当前 Windows 环境运行，待目录完整上传后由 CI 验证。
- 程序本体版本仍为 0.1.3；本次只修改安装器、更新验证、CI 和说明。

# Firefly Probe v0.1.3 验证记录

日期：2026-10-12。Windows 本机验证，未连接或修改 VPS。

- Node 主控测试 17 项通过，新增品牌字段、PNG/JPEG/WebP 图片限制、品牌公开读取不含账号密钥、管理员修改权限、通知名称与重启持久化。
- Chrome 浏览器检查通过：上传 Logo、自定义名称保存和刷新、favicon 跟随 Logo、恢复默认图标，以及旧版监控、接入命令和通知界面的回归。
- ShellCheck 对五个部署脚本静态检查通过。当前环境没有 Docker/Linux，主控容器构建和新增安装流程需在 GitHub CI 或 Linux 上验证。
- 目标公开仓库已创建，但本机 GitHub 登录凭据访问被运行环境拒绝，自动推送未成功。尚未创建远端 v0.1.3 标签，也没有远端 CI 结果；发布包可由用户在仓库网页上传。以下为此前版本验证记录。

# LightProbe 0.1.2 验证记录

日期：2026-10-12。本次在 Windows 本机验证，未连接或修改 VPS。

- Node 测试 15 项通过，包含新增安装文件下载、两种架构 ELF 文件与 SHA256 校验、拒绝下载配置/任意文件，及原有认证和监控回归。
- Chrome 浏览器验证通过：创建节点生成命令、备用配置下载、1920/390 像素布局、Telegram Token 持久显示、无标题尾点、无页面脚本错误。截图使用虚构节点和测试密钥。
- Windows 原生 ShellCheck v0.11.0 对全部五个脚本完成静态检查，无 error/warning。Git Bash 在当前 Windows 沙箱无法启动，未运行 bash -n 或实际 Linux 安装。GitHub Check 工作流已加入 bash -n、ShellCheck 和 Docker 构建，但尚未在 GitHub 运行。
- GitHub 仓库尚未创建，下载标签归档和主控一键安装尚未端到端验证。请仓库发布后先在测试机器检查；采集端一键安装也需先接入一台测试机。
- 用户此前确认旧版本的真实节点在线、Telegram 测试及离线/恢复告警正常；这不代表新增安装路径已验证。

以下为此前 v0.1.1 验证记录：

# LightProbe 0.1.1 验证记录

日期：2026-10-11。测试环境：Windows，本机 Node.js 24.21.0、Go 1.27.1。没有连接或修改用户 VPS。

## 已通过

- 主控接口与存储测试 14 项：登录、未授权请求、CSRF、无效密钥、密钥轮换、禁用节点、节点删除。
- 重复日流量补报不重复累加、网卡固定、无效采样拒绝、时区不一致拒收日历史。
- 月底/闰年/跨年账单边界、统计时区跨日、四种计费方向。
- 管理员设置接口返回已保存的 Telegram Token，总览不含 Token，未登录不能读取；额度告警去重、离线/恢复通知入队与去重。
- 主控重启后的设置、日流量和分钟趋势保留；旧管理会话失效。
- Go 采集端四组测试：计数器归零、网速差分、CPU guest 不重复计入、内存与网卡解析、vnStat 日流量解析与起点过滤。
- `go vet ./...`、主控和页面 JavaScript 语法检查。
- Linux amd64 / arm64 采集端交叉编译成功。
- 主控 `setup.sh` 通过 Tree-sitter Bash 静态语法解析；节点安装脚本中的 heredoc 与系统命令仍需真实 Linux 执行验证。
- 浏览器验证：管理员登录、搜索、分组、节点创建/编辑、配置 JSON 导出生成、历史图表、通知设置、测试通知入队、接入指南。
- 桌面 1440px / 手机 390px 布局验证；手机无横向溢出；页面没有 JavaScript 运行错误或 CSP 错误。预览截图中的数据为演示数据。
- v0.1.1：浏览器验证 Token 保存、刷新、切换页面后的回显，设置页标题“通知与设置”无末尾点，1920px 桌面设置面板宽度超过页面 90%，390px 手机设置页无横向溢出。

## 50 台持续上报模拟

本机客户端与主控在**同一 Node.js 进程**。50 个模拟节点每 5 秒集中上报一次，同时查询后台列表，持续约 60 秒。

| 项目 | 结果 |
|---|---:|
| 上报请求 | 650 |
| 上报失败 | 0 |
| 上报延迟中位数 | 25.35 ms |
| 上报延迟 P95 | 31.23 ms |
| 列表查询延迟 P95 | 3.21 ms |
| 客户端 + 主控合计 CPU 时间 | 0.782 秒 |
| 客户端 + 主控进程 RSS | 84.40 MiB |

这个短期功能/负载检查不包含真实 Linux 采集、HTTPS 代理、Telegram 网络请求或大量历史数据，不是生产容量承诺。长期运行、50 台节点真实资源用量应在 VPS 上观察。

## 尚需用户测试机验证

- Docker 镜像构建、Compose、Caddy HTTPS：本机无 Docker，尚未执行部署。
- Debian 12/13、Ubuntu 22.04 及以上安装、systemd、真实 /proc、文件系统和 vnStat 时区/落盘行为。
- Telegram 实际送达：没有用户 Bot Token，测试只检查队列、去重和配置验证。
- 主控/节点长时间断网、跨日、月底、重启、故障恢复与长时间运行。
- Shell 安装脚本实际执行：本机 Git Bash 被 Windows 沙箱拒绝，未执行 `bash -n` 或安装。
- 浏览器实际文件下载落盘：本机系统浏览器下载触发沙箱内崩溃，因此验证了导出 Blob 与下载文件名生成，没有验证操作系统实际保存文件。

建议按 README 先接入一台测试机，核对 `vnstat` 日流量和服务器实际状态，再逐步扩展到全部机器。


## v0.2.1 验证

Node 35 项通过；包含真实本地 SSH2 协议、指纹确认、凭据加密绑定、密码错误和部署失败、日志脱敏。Chrome 覆盖服务器列表、SSH 配置和模拟部署 UI、费用和待接入跳转、上下行小字、移除批量界面及桌面/手机布局；原有品牌、Telegram 设置、趋势、公开页面、备份恢复继续通过。ShellCheck 通过。真实远程 Linux 安装及 Docker 构建未在 Windows 本地执行，需 GitHub CI 与服务器验证。详细变化见 UPDATE-v0.2.1.md。


## v0.2.2 验证

38 项 Node 测试通过。通知目标按五类独立筛选；空日报范围不会产生空消息；范围变更撤销未发送消息；配置校验和独立保存通过。Chrome 覆盖拆分页面、底部设置导航、服务器选择保存/刷新、公开入口及桌面/手机布局，原 SSH 配置、备份恢复、品牌与趋势继续验证。Docker/Linux 检查交由 GitHub CI。

公开页移除管理员入口，增加服务器/总网速24小时二级页面与匿名历史接口。验证按节点均值再汇总、隐藏与停用过滤、公开网速关闭后404、后台汇总认证；Chrome 测试匿名跳转、明细、直接刷新与手机布局。


## v0.2.3 验证

38 项 Node 测试通过。公开接口不返回分钟明细数组，后台明细需认证，历史范围/汇总/隐藏过滤继续通过。Chrome 验证通知范围二级页面保存持久化、导航位置、服务器卡片点击与明细、公开仅曲线、深浅背景和减少动态效果、登录后停止动画及桌面/手机布局。服务器安装和 Docker 需 GitHub CI 验证。


## v0.2.4 验证

41 项 Node 测试通过：访问路径/账号修改/会话撤销/重启持久化/备份恢复保留当前凭据/恢复工具；原 SSH、采集、通知、公开历史与费用继续通过。Chrome 验证默认与自定义公开/管理路径、文案与英文名、深色切换持久化、账号密码变更后登录及原流程/桌面手机布局。更新检查跟随本机公开路径并使用 HTML build 标记；Linux/Docker 检查待 GitHub CI。


## v0.2.6 验证

42 项 Node 测试通过：备份删除认证/CSRF/快照和路径限制、保留份数、通知最近5条但队列保留。Chrome 检查列表版本与更新命令、最右侧删除确认、备份分页删除、设置内指南、公开仅系统深浅色，以及原账号/路径/通知/历史和手机布局。SSH 更新已核对现有 upgrade 流程，真实 Linux/Docker 部署交由服务器与 GitHub CI。

## v0.2.6

44 项 Node 测试与 Chrome 新增界面检查通过：嵌套指南、SSH 提示、拖拽排序、国旗、运行时间、四列卡片、公开图表与手机布局。国家识别测试注入模拟查询，不依赖外部服务可用性；安装及 Docker 检查由 GitHub CI 执行。

## v0.2.7

47 项 Node 测试通过。Chrome 验证真实 SSH 草稿登录不保存资料、手动国旗、公开/总览自定义标题、公开时间隐藏、主页路径、插件示例加载与清理、手机布局。ShellCheck 通过。Wiki 发布仅脚本语法验证，远端需先初始化首页。Docker 与 Linux 安装流程需 GitHub CI 验证。

## v0.2.8

50 项 Node 测试、插件/远程备份浏览器测试、隔离 Docker 自动安装分支测试及 ShellCheck 通过。远程传输测试使用注入的模拟 rclone；加密、文件校验、跨主控恢复及凭据重加密为真实操作。没有真实 Google OAuth 授权，不声称云盘端已连通。

## v0.2.9

51 项 Node 测试与浏览器检查通过。覆盖指南/文档入口、Token 导入鉴权与凭据保护、旧配置导入保留。Windows 授权助手实际下载、校验 SHA256 与运行版本检查通过，Google 交互登录未执行。

## v0.2.10

Browser verifies editable country codes/names/auto and settings plugin navigation. Password rotation test verifies old and new backups only decrypt with their creation-time password.

## v0.2.11

55 Node tests and Chrome browser checks pass: daily/monthly aggregation, administrator-only history, retention validation, upload-before-prune, cleanup failures, and settings persistence. Remote cleanup uses mocked rclone; no real Google Drive files were deleted. Reporter uninstaller passes shell syntax and ShellCheck; not executed on a real VPS.

## v0.2.12

57 Node tests pass. Lifecycle fixtures verify new/legacy/default/explicit directories and uninstall stop/export/remove ordering. Backup-export failure prevents container removal. ShellCheck passes for install/uninstall scripts. Real VPS uninstall was not executed.

## v0.2.13

63 Node tests pass, including trusted proxy chains, separate visitor limits, gradual account delays, Telegram migration/masking/clearing and encrypted cross-VPS restore. Plugin tests cover capability checks, CSRF, sanitized monitoring, one-use approvals tied to request/session, revocation and code-update invalidation. Chrome confirms opaque iframe isolation from parent/cookies/storage/direct fetch, blocked settings access, rejected and accepted mutations, and desktop/mobile install-button separation. History and country-navigation browser regressions pass. ShellCheck passes. No real production SSH deployments or Google uploads performed for this release.

## v0.2.14

66 Node tests pass. Agent shell fixtures verify both Debian 11/12/13 entry points, rejection messages, credential-safe stage diagnostics, and conditional UseUTC configuration for vnStat 2.6. Go tests and vet pass, including a synthetic daily-byte fixture checked against upstream vnStat v2.6 src/dbjson.c. ShellCheck and bash syntax checks pass. This Windows workspace did not execute a real Debian 11 apt/systemd install; VPS first-report validation remains necessary. Agent binary source and version are unchanged.

## v0.2.15

69 Node tests pass. Tests cover Alpine POSIX launcher dependency preparation, stable release checks, safe argument handling, SSH hostname/IDN normalization and fingerprint revocation. Real SSH protocol tests pass with the portable sh command. Chrome verifies hostname entry, portable installation command, button layout and existing plugin security. ShellCheck and syntax checks pass; Alpine HTTP fixture compiles. A real Alpine 3.22 apk/OpenRC install/first-report/reinstall test is added to GitHub CI, but cannot be executed in this Windows workspace; do not treat it as already passed. Agent binary/version remain unchanged.

Installer hotfix: UTF-8 Python input/output is forced even when SSH inherits PYTHONIOENCODING=latin-1. Debian 11 apt failures retain exit 100 and explain retired backports without changing repositories. Six installer regression tests pass. No actual VPS deployment was performed.

## v0.2.16

System release metadata is parsed without executing os-release, reported by agent 0.2.1, validated and persisted by the master. Tests cover Debian/Ubuntu/Alpine release strings, restart persistence, public visibility and node deletion. Static amd64/arm64 binaries and SHA256SUMS are rebuilt.

Validation: all 72 Node tests pass; Go tests and vet pass. Chrome verifies system labels on overview, server list and public cards with no page errors. No real VPS deployment was performed.

## v0.2.17

74 Node tests pass. Tests cover forwarding input validation, IPv6 formatting, fixed official GOST SHA256, POSIX shell syntax, authenticated/CSRF-protected routes, SSH fingerprint prerequisites, protocol/port collisions, real SSH protocol transport with simulated remote shell results, secret redaction, task failure, stop/remove and preventing node deletion while rules remain. Chrome validates the default-off independent public system permission, rule creation/deletion, generated TCP+UDP addresses and page navigation. GOST shell integration test syntax and ShellCheck pass. Windows security software blocked the downloaded official GOST executable; it was not run or bypassed. Real Linux GOST TCP/UDP loopback integration is added to GitHub CI and has NOT yet run here. No real VPS deployment was performed; systemd/OpenRC forwarding services still require Linux CI/VPS validation. Agent remains 0.2.1.

GOST download hotfix: GitHub run 38530192131 passed Node/Go, Docker and Alpine tests, but GOST checksum failed. Reproduced curl without -L returning a zero-byte file. Both CI and remote installer now follow HTTPS-only redirects (-fsSL, --proto-redir =https). Corrected curl downloaded 17,733,052 bytes with SHA256 676fb7f78d267b6ae73df719c0c7f2b565dde7147da935cfafbc1e1da558b6d5, matching the official GitHub release asset digest. Forwarding regression tests, shell syntax and ShellCheck pass. CI retains real TCP/UDP tests and logs GOST failures; the next remote CI run remains pending upload.

## v0.2.18

76 Node tests pass; Go tests and vet pass. Tests cover monthly byte deltas, duplicate samples, rule/node ownership, process epochs, counter resets, error recovery, Shanghai month boundaries and bounded two-agent update queues with skips. Chrome verifies server A/B rule filtering, empty 80/443 port hints, friendly live log dialogs, green/red status, monthly history, the legacy agent system hint and batch UI results. Linux amd64/arm64 agent 0.2.2 binaries and checksums are rebuilt. Existing CI run 38531272164 passed real GOST TCP/UDP tests and Alpine installation; the new GOST Metrics byte-counter CI test is not yet run locally. No real VPS modifications were performed.

## v0.2.19

All 77 Node tests pass. Daily tests cover Shanghai midnight, duplicate samples, preserving pre-upgrade monthly totals, identifying unassigned historic bytes, valid month queries and node/rule ownership. Chrome verifies separate address/traffic columns, removal of the monthly prefix, a month selector and daily traffic history, alongside existing rule filters, logs, health and bulk update UI. Agent remains 0.2.2 and binaries are unchanged. Historical daily detail cannot be reconstructed from previous monthly-only records.
