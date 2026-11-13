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

Node 35 项通过；包含真实本地 SSH2 协议、指纹确认、凭据加密绑定、密码错误和部署失败、日志脱敏。Chrome 覆盖服务器列表、SSH 配置和模拟部署 UI、费用和待接入跳转、上下行小字、移除批量界面及桌面/手机布局；原有品牌、Telegram 设置、趋势、公开页面、备份恢复继续通过。ShellCheck 通过。真实远程 Linux 安装及 Docker 构建未在 Windows 本地执行，需 GitHub CI 与服务器验证。详细变化见 CHANGELOG.md。


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

## v0.2.20

All 78 Node tests pass. Rule ordering requires admin authentication/CSRF and validates a complete, unique rule list belonging to the selected node, persists atomically and survives master restart. Chrome performs actual drag/drop, verifies the navigation order, notification location inside Settings and at least 8px between Settings and Plugins. PowerShell uploader parses successfully; a local Git fixture verifies removal/staging only of tracked root UPDATE-v*.md notes with unrelated files preserved. Versioned notes are consolidated, with links and installer/package references updated to CHANGELOG.md. Agent remains 0.2.2. No remote push or VPS update was performed.

## v0.2.21

79 Node tests pass. Edit tests validate conflicting ports, immutable node ownership, blocking concurrent edits, POSIX deployment/rollback syntax, retaining config/history on failure, callback completion independent of list polling, atomic success/reset, preserving sort and other rules, and rejecting stale samples from the previous service identity. Chrome exercises the edit dialog through real local SSH transport with simulated shell completion, confirms new settings, zero monthly totals and empty history. Real remote systemd/OpenRC rollback execution was not run locally; tests verify command generation and state handling. Agent remains 0.2.2.

Installer locale hotfix: braced variables adjacent to Chinese punctuation in timezone migration and OS/binary diagnostics. Real Bash execution of the timezone message passes with nounset in C and C.UTF-8 locales; five installer regression tests, syntax and ShellCheck pass. No uninstall or data reset is required.

## v0.2.22

80 Node tests pass. Sequential queue tests assert only one running deployment, live logs, advancing after failure and final failed-node identification. Forwarding tests cover installed-state persistence and resume without downloader/config regeneration. Chrome verifies installation/update labels, stop-to-resume toggling, the automatic batch dialog, failure summary/names and existing edit/history/order/navigation. Shell syntax/ShellCheck pass. Alpine entry tests cover successful setup and curl exit 35 preserving the error, never executing an incomplete script and keeping tokens out of diagnostics. Downloads now use HTTP/1.1 and bounded curl retries without relaxing TLS. The canceled overview status filter is absent; original app.js is preserved. Actual Alpine network reset root cause remains unverified. Agent binaries/version remain 0.2.2.

## v0.2.23（2026-10-14）

- Node 测试 82 项通过，新增所有服务器转发日汇总、上海时区跨日和夏令时结束日历日期验证。
- 今日、昨日只统计对应日记录，停止规则保留已采集流量；旧月数据不冒充日流量。
- 主控版本 0.2.23，采集端保持 0.2.2，本次无须更新采集端。
- Chrome 实测图标、悬停提示、删除最右、服务运行文案、全服务器日汇总及切换服务器不改变汇总；安装/更新、启动/停止、日志、编辑与每日历史回归通过，无页面脚本错误。未连接生产服务器。

## v0.2.24（2026-10-14）

- Node 测试 86 项通过：新增转发队列逐条执行、失败后继续、范围与跳过、忙时等待与停止；告警持久去重、恢复、范围和维护；转发 API 认证、CSRF、输入校验与公开隔离。
- Chrome 通过真实本机 SSH 协议模拟服务验证工作台四项统计、服务器与规则筛选、拖拽、新增弹窗、编辑后清零、每日历史、一键安装 / 更新成功 / 失败 / 跳过、失败规则与日志、告警配置保存。桌面、深色和 390px 手机布局通过，无页面脚本错误与整页横向溢出。
- 主控 0.2.24，采集端不变 0.2.2；只需更新主控。
- 测试使用演示机器和模拟 SSH 安装结果，未连接或修改生产 VPS。既有真实 GOST 转发测试仍由上传后的 Linux CI 执行，本次不声明生产网络与 Google Drive 验证通过。
## v0.2.25（2026-10-14）

- Node 测试 87 项通过，新增跨多个目标服务器复制、端口协议冲突跳过、重复复制不重复创建、源历史保留、草稿零流量及修改不执行 SSH、身份 / CSRF 与来源 / 目标校验。
- Chrome 验证关闭按钮位于弹窗右上角；16 台演示服务器列表限定高度、滚动和收起 / 展开，并在轮询后保留状态与滚动位置。
- Chrome 验证复制规则结果、未配置 SSH 目标可保存草稿、修改只保存配置，复制和草稿修改期间没有新增 SSH 执行；原有部署、失败明细、编辑清零、流量历史、深色与手机布局回归通过。
- 主控 0.2.25，采集端仍为 0.2.2。未连接或修改生产服务器，上传后仍需等待 GitHub CI。
## v0.2.26（2026-10-14）

- Node 测试 89 项通过，新增公开名称默认隐藏、日本 / 美国 / 未知地区、名称授权立即失效缓存、管理员保留名称、旧数据库迁移默认关闭与输入校验。
- Chrome 验证服务器配置勾选项保存与重新打开；公开卡片和 24 小时详情默认只显示日本，勾选后显示真实名称，取消后立即隐藏。无页面脚本错误。
- 已有服务器升级后名称授权默认关闭；只需更新主控，采集端保持 0.2.2。未连接生产服务器，上传后仍需等待 GitHub CI。
## v0.2.27（2026-10-17）

- Node 测试 94 项通过：分组新增 / 改名 / 删除 / 移入、未分组、独立于原节点分组；多规则网卡汇总去重、停用节点范围、历史查询；同进程计数回退防重复与新进程接续；日报上传 / 下载 / 所选范围尾部总计。
- API 验证权限与 CSRF、分组限定批量范围、顶部总计和监控总览相同、选定服务器历史，以及日报总计仅包含本次服务器选择范围。
- Chrome 实测分组管理 / 筛选，所选服务器 3 GiB 与全部转发服务器 8 GiB 独立变化，15 / 90 天历史与流量核对；滚动、收起、复制草稿、编辑清零、批量进度及深色 / 手机布局回归通过。
- 已查阅官方 GOST 服务统计、Metrics 与 v3.3.0 模块信息。顶部现采用 vnStat 统计网卡口径；规则保持 GOST 应用字节，两者不做固定倍数换算，历史已保存计数不追溯修写。
- 主控 0.2.27，采集端 0.2.2 不变。本机验证使用模拟 SSH 与演示数据，没有访问或修改用户 VPS；实际用户差值仍需结合服务器、时段及采样状态核对，上传后等待 GitHub CI。
## v0.2.28（2026-10-17）

- Node 测试 94 项通过：转发历史改为汇总当前规则 GOST 日记录，包含已停止规则，排除网卡日记录与已删除规则，服务器与日期范围校验保留。
- Chrome 使用故意不同的网卡数据与 GOST 数据，验证所选服务器 3 GiB、全部规则 8 GiB 的卡片和历史一致，不受 200 GiB 网卡数据影响；15 / 30 / 60 / 90 天改为下拉选择，期间合计正确。
- Chrome 验证分组列表的独立编辑 / 删除按钮、当前分组自动加载、改名保存、删除保留所有服务器及规则；原有滚动、复制、部署进度、编辑清零、历史、深色 / 手机布局回归通过。
- 主控 0.2.28，采集端 0.2.2 无变化。本机仅使用演示数据和模拟 SSH，没有连接用户 VPS；上传后仍需等待 GitHub CI。
## v0.2.29 · 2026-10-18

- 99 项 Node 测试通过，包括默认续期、在线与跨日条件、关闭/停用/离线跳过、季付年付周期、月底与闰年日期锚点、逾期补算、重复执行幂等、旧提醒取消、参数校验，以及诊断接口鉴权/CSRF/固定脚本/SSH 指纹与日志脱敏。
- 6 项 Python 诊断测试通过：本机 HTTP Metrics、读取上限、禁止重定向、解析格式差异、采样时重启、有限并发、增量范围、额外与缺失清单；通过 Python Software Foundation 签名的 Python 3.13.7 临时运行时执行，未修改系统 Python。
- Chrome 实测默认勾选、开关和三个月周期保存并重新打开、在线上报后日期延长及续期记录；模拟 SSH 的诊断完成日志与重新查看，未重复执行，无浏览器脚本错误。截图为本地测试数据。
- 未连接或修改生产 VPS；真实 GOST 与网卡全天差额尚未定位，需要升级后提供实机只读诊断结果。未宣称已修复流量计数。当前机器没有 Linux Docker 环境，安装及真实 GOST Linux 集成测试交由上传后的 CI；采集端版本及二进制仍为 0.2.2。

## v0.2.30 · 2026-10-18

- 101 项 Node 测试通过。新增手动续费测试覆盖未来 3 天边界、用户示例日期、逾期与无日期、月/季/年付款周期、月底锚点、长期逾期仅延长一次、旧提醒取消、保留自动续期开关、登录 / CSRF、重复提交与周期变化冲突。
- Chrome 验证临期数量入口、跳转筛选、按钮紧随部署操作、确认窗口预览 / 取消 / 提交、季付和年付日期延长、续费后数量和列表更新、非临期和无日期不显示、窗口内日期变更冲突提示、手机窗口宽度，无页面脚本错误。
- 仅本机模拟数据，未连接或修改用户 VPS，未推送 GitHub；主控更新为 0.2.30，采集端和二进制保持 0.2.2，无采集端或 Linux 安装器改动。

## v0.2.31 · 2026-10-18

- 102 项 Node 测试通过。新增测试确认月 / 季 / 年 / 自定义付款周期用于自动续期，旧独立周期即使不同也不影响结果；接口以季付节点上报验证日期延长，关闭开关行为不变。
- Chrome 验证仅保留默认勾选的“自动续期”，紧邻启用采集选项之前，独立周期输入不存在；取消保存后重新打开、付款周期为季付时在线续期 3 个月、上次续期记录、诊断日志窗口均通过，无脚本错误。
- 同步开发源与发布目录并准备包，未推送远端、未操作 VPS；采集端仍为 0.2.2。本地交接文档 outputs/项目交接.md 不含凭据，供新账户读取项目状态。

## v0.2.32 · 2026-10-18

- 仅调整表单勾选位置和版本 / 文档，自动续期计算逻辑与 v0.2.31 一致，沿用此前通过的 102 项 Node 测试。
- Chrome 确认默认勾选的“自动续期”紧邻“计入固定费用”之前，独立周期输入不存在，保存 / 重新打开、付款周期驱动续期和诊断日志窗口回归通过，无脚本错误。
- 用户首次实机诊断：17 条清单全部对应本主控、有效配对 15 条，两条无字节计数；30 秒 GOST 14.790 MiB，网卡 34.021–34.060 MiB，TCP 重传段 3224，新增处理错误 34。重传与协议开销是线索，未证明此前全天差额原因或统计无遗漏。

## v0.2.33 · 2026-10-18

- 105 项 Node 测试通过，包括新旧二进制 URL / 哈希校验、SSH 部署、队列更新以及迁移失败恢复。Debian / Alpine 服务操作在临时目录夹具中模拟；Windows 夹具不模拟 POSIX 文件权限，真实权限依靠 Linux CI。
- Python 实际执行安装器配置阶段，验证同节点身份、history_start 和附加字段保留，新旧身份冲突不覆盖；旧服务及配置的失败恢复经过测试。
- Go 测试及 go vet 通过；新增实际 HTTP 测试确认 FireflyProbe User-Agent 和节点认证保持不变。Linux amd64 / arm64 二进制构建为 0.2.3，更新 SHA256SUMS 并包含旧名称校验别名。
- ShellCheck warning 级和 Bash 语法检查通过；Alpine Docker CI 增加从旧服务迁移、旧文件移除和历史保留验证。本机没有 Linux Docker 环境，真实 OpenRC / systemd 环境安装需上传后由 CI / 实机验证，未操作用户 VPS。
- Chrome 验证新旧版本提示、指南服务名称和下载配置文件名，以及原有续期表单、诊断窗口回归。仍需用户执行全部采集端更新，不能把主控版本更新等同于机器已迁移。

## v0.2.34 · 2026-10-18

- Chrome 实测后台 / 公开页卡片和列表切换、独立偏好、刷新和轮询保持、搜索与分组、详情 / 配置入口、公开历史导航。
- 验证公开名称默认隐藏、私有节点不出现、系统版本权限、关闭网速 / 资源 / 流量权限后列和历史链接移除、关闭公开展示后清空旧列表；列表只使用公开 API 数据。
- 桌面、系统深色模式、390px 手机表格横向滚动检查通过，无页面水平溢出；禁止 localStorage 仍能切换，无浏览器脚本错误。
- 105 项 Node 回归测试通过。只更改主控前端和静态文件白名单，采集端 / 安装器 / 统计算法不变，采集端保持 0.2.3。未推送 GitHub 或操作用户 VPS。

## v0.2.35 · 2026-10-18

- Chrome 以两台异常、一台正常、一台无规则服务器验证：异常卡片 / 预警入口同步筛选左侧和规则表，清除旧分组与搜索、单台选择、全部异常入口、3 秒轮询保持、恢复后移除、全部标签恢复；分组下直接选异常时范围保持。
- 验证公开列表无最后上报列，切换按钮在网速区域下方、服务器区域上方，桌面与 390px 手机间距不超过 16px；历史导航及显示偏好沿用原逻辑。
- 无登录浏览器实测私有节点详情 404、管理员节点列表 401、允许的公开详情 200 且没有分钟明细、关闭网速公开后详情 404；UUID 链接未新增权限。
- 105 项 Node 回归测试通过，公开历史及名称权限回归通过；无浏览器脚本错误。仅主控界面改动，采集端保持 0.2.3，未推送 GitHub 或操作 VPS。

## v0.2.36 · 2026-10-18

- 105 项 Node 回归测试通过；公开名称权限测试增加 group_name 缺省及管理员保留分组断言。
- Chrome 验证公开卡片无分组元素、列表无入口 / 落地 / 直连文字，公开 API 不含分组字段；后台卡片仍显示分组并可正常筛选，无脚本错误。
- 仅主控公开字段与界面调整，采集端仍为 0.2.3；未推送 GitHub 或操作 VPS。

## v0.2.37 · 2026-10-20

- 107 项 Node 测试通过，包括排序持久化、成员与历史保留、非法参数和并发冲突，以及认证与 CSRF 检查。
- Chrome 验证真实拖拽、上下方向键、下拉框同步、当前选择和未保存表单保留、刷新与轮询保持顺序；并发新增分组触发冲突后刷新；分组编辑删除正常，无页面脚本错误。
- 本地验证和打包，未推送 GitHub、未操作生产服务器；未在真实 Linux 环境重新安装。

## v0.2.38 · 2026-10-22

- 109 项 Node 测试通过：新增采样失败原因、基线保留、同进程累计补计去重、进程重启处理、完整规则排序与并发顺序保护，保留其他节点及流量历史。
- Go 测试通过：大于旧 256 KiB 的真实指标集合 / HTTP 响应、标签空格和时间戳、无效计数、读取中断、16 MiB 体积与单行长度限制、HTTP 失败和采样期间重启检测。
- Chrome 验证真实跨页拖放（前页到后页、后页到前页、末页不足十条）、方向键跨页与焦点、刷新轮询保持、搜索禁用拖拽、采样异常详情。6 项 Python 只读诊断测试通过。
- Linux amd64 / arm64 采集端交叉构建并更新 SHA256SUMS。仅本地测试与打包，未上传 GitHub、未连接生产 VPS；不能声称已修正生产历史或实测完成真实 Linux 安装。

## v0.2.39 · 2026-10-22

- 采集端更新进度窗口复用已有 dialog-heading 布局，标题居左、关闭按钮居右。Chrome 验证桌面与手机布局、按钮关闭和重新打开。
- 仅主控界面调整，采集端仍为 0.2.4；未操作生产服务器或上传远端。

## v0.2.40 · 2026-10-24

- 110 项 Node 测试通过。新增每日排名接口认证、主控时区、自选日期范围、真实零与无样本区分、停用节点排除测试。
- Chrome 验证每日排序、日期切换、查看全部、额度排名和服务器详情；完成提示经窗口 / 列表关闭后轮询与刷新仍隐藏，新批次显示，运行队列关闭窗口不取消；验证移动端无横向溢出及汇率说明。
- 排名只读且仅管理员可用；本地测试与打包，未上传远端或操作生产。采集端无需更新，仍 0.2.4。

## v0.2.41 · 2026-10-24

- Chrome 验证排名在总览隐藏、标题右侧入口、二级页返回与其他侧栏导航、筛选和展开状态保留、服务器详情、手机布局。沿用排名 / 更新提示关闭 / 汇率说明浏览器回归通过。
- 仅管理员界面导航调整，服务端排名算法不变；未连接生产服务器或上传远端，采集端仍 0.2.4。

## v0.2.42 · 2026-10-25

- 113 项 Node 测试通过：原功能回归，新增引擎脚本 / 校验下载 / 最终样本协议 / shell 语法、版本门槛、任务互斥、迁移保留历史、最终差额补计、拒收旧采集端混合计数、API 身份与 CSRF。
- Go 测试与 vet 通过；共享清单同地址只读取一次，按服务标识分离两条规则，拒绝跨规则名称，保留旧独立清单兼容。Linux amd64 / arm64 0.2.5 二进制和 SHA256SUMS 已重建。
- 6 项共享控制器 Python 测试通过：迁移、单条启停 / 编辑隔离、失败恢复旧进程、失败编辑恢复、归属检查、按服务最终采样、失败回退恢复共享、只读状态检查。6 项原诊断 Python 测试通过。
- Chrome 验证服务器选择、每台独立模式、切换和回退状态轮询、日志脱敏呈现、前置条件与断流提示、移动端和关闭。界面使用模拟任务，未连接真实 VPS。
- tests/forward-engine-real.test.py 已接入官方 Linux GOST 的 CI 检查，验证真实迁移、单进程 TCP / UDP、分服务计数、保留其他规则长连接、冲突编辑回退和回退独立；当前 Windows 环境未执行该 Linux 集成检查，需上传后以 GitHub Check 结果为准。systemd / OpenRC 的真实服务迁移未在本机运行，不声称已在生产验证。

## v0.2.43 · 2026-10-26

- 113 项 Node 测试通过，现有认证、部署与转发统计回归无失败。新增界面未改变远端部署或采集协议，采集端保持 0.2.5。
- work/browser-0243.mjs Chrome 检查通过：左侧模式标签、所有转发服务器列表与数量、共享 / 独立 / 未部署 / 切换中 / 失败区分、按钮状态、快速选择时慢响应不覆盖新服务器、切换后自动刷新、关闭重开、深色与手机宽度、长列表滚动。任务响应使用模拟数据，未连接生产 VPS。

## v0.2.44 · 2026-10-29

- 119 项 Node 测试通过。新增 6 项中转检查：独立 / 共享两步顺序、确认前保留入口和历史、确认后沿用入口历史清零、禁止重复提交、失败 / 中断 / 放弃不自动修改 A、端口 / 同节点 / 本机地址 / 并发配置保护、复用 B 只读检查、入口失败保留 B 和旧配置、任务持久化、路径关系变更提示，以及 API 登录 / CSRF / 输入验证。
- work/browser-0244.mjs Chrome 检查通过：经中转按钮、B 地址填充、A/B/C 路径预览、手动两步确认、关闭后继续、分步日志、完成后的规则注记、移动端和深色模式。SSH 任务响应为模拟，未连接生产 VPS；未在本机执行真实跨三台服务器的网络验证。
- 采集端保持 0.2.5；通过现有主控 SSH 和独立 / 共享引擎操作，无新增代理协议或远端组件。

## v0.2.45 · 2026-10-30

- 120 项 Node 测试通过。新统一入口用例覆盖采集端门槛、旧机器迁移、新增复用、失败保留模式、最终删除释放节点、丢失回调通过轮询完成；原转发 API、历史、批量、中转测试已适配统一部署。
- 9 项 Python 控制器测试通过，新增自动迁移后操作 / 复用、迁移失败不执行下一步、新机器首次安装 / 删除最后规则 / 换节点重新初始化。真实 GOST Linux CI 测试改为从统一入口迁移，并检查最后规则删除后零进程；本机未执行真实 Linux 系统服务迁移。
- work/browser-0245.mjs Chrome 通过：引擎按钮及模式标签移除，中转两步预览 / 日志 / 关闭续接、完成注记、手机和深色。SSH 响应模拟，未连接生产 VPS。采集端仍 0.2.5。

## v0.2.46 · 2026-10-30

- 界面文案调整，Chrome 检查导航、面包屑、流量排名返回、设置标题标签与转发页面；不改功能、存储字段或采集端版本。

## 独立 TCP 诊断脚本 · 2026-10-31

- work/test-network-script.py 在 Windows PowerShell 5 中验证真实 TCP 接受 / 拒绝、逗号端口参数、嵌入 Python 真实本机连接、远端 SSH 模拟返回和失败分类、输入拒绝、超时对照结论与 JSON 报告。测试无生产连接。
- 工具 network-diagnose.ps1 与 docs/Network-Diagnostics.md；主控仍 v0.2.46，采集端仍 0.2.5。未新增面板监测或告警。

## v0.2.47 · 2026-11-02

- 126 项 Node 测试通过。新增同机换址真实 SSH 协议检查：固定原 host key、不同主机 / 错密码 / 不同节点拒绝、身份校验成功后保留密钥 / 规则 / 历史、验证中部署和并发修改互斥、核验期间配置变化拒绝覆盖、CSRF 和输入校验。真实 Python 固定只读代码验证引擎归属优先与旧采集配置兼容，未连接生产。
- work/browser-0247.mjs Chrome 验证配置表单选项显示 / 重置、布尔值与新地址提交、保存成功提示、新建节点隐藏选项、手机和深色显示。保存响应模拟，SSH 协议与身份逻辑由后端测试验证。采集端仍 0.2.5。

## v0.2.48 · 2026-11-02

- 127 项 Node 测试通过：新指纹确认后经真实 SSH 协议测试签发证明，验证会话 / 地址 / 密码绑定、一次消费与两分钟过期、错误节点身份拒绝、保存前不修改指纹；实际 Python 检查新指纹分支要求原 Token，即使引擎 owner 匹配也不能跳过。
- work/browser-0248.mjs Chrome 验证勾选、测试确认提示、证明提交、字段修改重新测试、保存提示、关闭 / 新建重置、短说明与移动 / 深色显示。界面响应模拟，后端协议及 Python 逻辑单独验证；未连接生产。

## v0.2.49 · 2026-11-02

- 128 项 Node 测试通过。新增超时 / 超长行 / 中断分别提示、失败保留基线与恢复补差额检查。Go test ./...、go vet ./... 通过。新增超过 16 MiB 的共享指标、同服务隔离、无效尾部拒收、慢响应超过旧两秒限时、实际截止时间不接受部分结果、后台轮询不阻塞且不重叠、标签边界与时间戳格式检查。
- 同一 Windows 本机生成约14MB共享指标基准：旧版解析约274ms，新版约17ms；机器为Ryzen 7 7800X3D，仅反映本机对照，不代表故障VPS耗时。未连接生产，不声称现场已恢复。
- Linux amd64 / arm64 0.2.6 二进制与新旧文件名 SHA256SUMS 已重建。新后台采集仅替换统计轮询，不改GOST配置、服务、原始计数或数据库基线。

## v0.2.50 · 2026-11-03

- 132 项 Node 测试通过。中转新增覆盖：旧独立 / 共享入口更换 B→D、沿用原 C、同一 B 换端口、取消回 A→C、再次添加 / 复用、旧 B 规则与历史保留、失败不覆盖原路径、旧 B 离线或已删时恢复、重复请求 / 等待确认冲突及新接口认证 / CSRF。
- Chrome 页面检查通过：已完成任务可重新设置、选择新中转预览原落地、两步提交及进度轮询、取消中转显示直连与入口日志、完成后重新调整、手机窄屏 / 深色布局。SSH 返回通过模拟接口提供；后端使用真实 SQLite 与部署任务回调测试。截图 outputs/更换中转-v0.2.50.png 只含测试数据。
- 本次仅主控 / 页面变更，采集端保持 0.2.6，未修改 GOST 远端执行器。未连接生产 VPS、未推送 GitHub，也未在本机执行 Linux GOST / systemd / OpenRC 测试；仍需上传后等待 GitHub Check 通过并在实际链路确认。

## v0.2.51 · 2026-11-07

- Python 共享引擎控制器 12 项测试通过，新增真实本地 HTTP 服务返回超过 16 MiB 的 Metrics，确认成功读取末尾计数、输出最终快照并停止目标规则，其他规则的清单不变、共享进程不停止。
- 超限、超长行、声明 Content-Length 截断、无效计数、缺少标记均拒绝部分快照并保持规则 / 状态 / 清单不变；截止时间与采样清单变化检查通过。超限拒绝路径使用缩小阈值验证，并断言正式阈值为 64 MiB。
- 132 项 Node 测试通过。仅修改主控下发的 Python 控制器及发布元数据；采集端仍为 0.2.6。未连接生产或推送 GitHub，本地未运行真实 Linux GOST / systemd / OpenRC，仍需 GitHub Check 与线上重试确认。

## v0.2.52 · 2026-11-09

- Python 共享引擎 16 项测试通过。本地 HTTP 服务改为在没有服务时返回真实的 count:0/list:null，覆盖全部停止后检查状态、幂等清理、逐条重新安装 / 更新；最终四个协议服务均存在。
- 覆盖空列表 / 数组格式、异常格式 / 数量不符 / 重复名称拒绝，以及从空列表首次安装失败后的恢复，确认保留原 HTTPError 而非被清理过程 TypeError 覆盖。异常位置与 HTTP 状态可读，凭据样本不回显。
- 132 项 Node 测试通过（包括下发脚本 shell 语法）。本地没有生产 VPS 访问，未推送 GitHub，未运行 Linux 真实 GOST / systemd / OpenRC。需上传后等待 CI 通过，再在线重试确认是否存在其他原始失败原因。

## v0.2.53 · 2026-11-09

- 134 项 Node 测试通过。新增批量删除选中范围、串行任务 / 互斥、草稿无 SSH、失败与跳过保留、未知 / 重复 / 跨范围 ID 拒绝，以及新操作的认证 / CSRF、真实 SQLite 草稿删除与服务器节点保留。
- Chrome 使用本地真实主控 API / SQLite 通过默认不选、全选 / 清空、仅选中删除、完成进度、未选规则保留、安装窗口标题切回、手机窄屏 / 深色布局；实际只删除测试草稿，无生产 SSH。work/browser-0253.mjs，测试截图 outputs/批量删除-v0.2.53.png。
- 远端删除沿用已有单条删除控制器，未改 GOST Python 执行器或采集端（仍 0.2.6）。未推送 GitHub、未连接生产；Linux 真实服务删除仍需 CI 和用户实际确认。

### v0.2.53 检查脚本补丁 · 2026-11-09

- GitHub Check #63（run 42579119083 / commit 0fb6017）在 Run bash tests/gost-forwarding.test.sh 失败，退出码 22。其余此前步骤通过；未登录下载日志接口返回 403，未获原请求具体 HTTP 状态。
- 脚本唯一下载使用 curl -f，结合退出码定位下载 HTTP 错误。当前从官方 URL 下载成功，SHA256 为 676fb7f78d267b6ae73df719c0c7f2b565dde7147da935cfafbc1e1da558b6d5，与固定校验值相符。不能据此声称过去一定是 503 / 429。
- 增加 curl 4 次重试、3 秒间隔、180 秒重试预算、单次最多 120 秒，保留 HTTPS / SHA 校验；打印最终 HTTP 状态，仍失败保留原 curl 退出码，不跳过后续测试。Bash 语法检查与本地下载路径测试通过：模拟失败 22 保持非零且不运行测试；使用真实官方下载包验证 SHA 后到达两个测试入口，Python/GOST 执行在该路径测试中用替身，仅验证调用控制。
- 应用代码及版本号不变，仍主控 0.2.53 / 采集端 0.2.6；不重复运行无关应用测试。Linux 真实转发仍需用户重新上传后由 GitHub 执行，尚未确认远端 Check 成功。

### v0.2.53 官方 API 下载与缓存补丁 · 2026-11-09

- 用户提供 Check #64 完整日志，官方浏览器下载 URL 重试五次均 HTTP 504，确认非测试断言失败。新增 tests/download-gost.sh，固定官方 release asset ID 536443639 与原 SHA256；优先 GitHub Assets API，workflow Token 不可用时尝试公共 API，最终备用官方直链，每条路径保留重试、HTTPS限制和 SHA 校验。
- 工作流缓存 runner.temp/firefly-gost，以版本 / 架构 / 完整 SHA 为固定键；每次使用缓存前重新校验。损坏缓存重新下载；两条官方路径均失败或内容校验不符则阻止转发测试，不当作通过。临时认证头放在权限受限文件中，完成 / 失败均删除，不输出原始认证值；没有使用第三方镜像。
- 本地实际运行下载辅助脚本，官方 API HTTP 200 且 SHA256 正确。下载分支检查覆盖 API 成功、HTTP失败 / 错误内容后切备用、全部失败、缓存离线复用 / 损坏重下及临时认证文件清理。HTTP 分支用替身，SHA使用真实官方下载包；不代表 Linux GOST 转发已跑过。两份 Bash 脚本语法通过，工作流将两脚本加入 ShellCheck。
- 应用仍 v0.2.53 / 采集端 0.2.6，未更改业务代码，未推送。需用户重新上传触发 CI；尚未确认 GitHub 网络环境下载或 Linux 实际转发通过。

## v0.2.54 · 2026-11-09

- 20 项 Python 引擎测试通过：新增重装空机器 / 旧共享部署记录无 ensure_shared 标志时重新初始化、仅安装目标规则、其他旧规则不自动启动、随后逐条恢复、空远端检查 / 停止 / 删除不启动服务，以及部分配置 / 正在运行的服务拒绝覆盖、初始化失败可重试。旧迁移、所有者保护、快照保护测试保持通过。
- 135 项 Node 测试通过；重装标记使其他规则停止，当前目标成功后运行，已有日流量保留。之后对新增初始化标记的完成处理做同范围测试，再次通过。
- Linux 真实 GOST 用例新增全部删除后的空远端、主控保留旧部署信息、重新安装一个规则并验证仅一个活动规则；本机无法执行 Linux 二进制，该项由 GitHub CI 确认。未连接生产、未推送，不能声称现场恢复。

## v0.2.55 · 2026-11-13

- 137 项 Node 测试通过。新增真实 HTTP / SQLite 验证：普通删除仍拦截转发规则、本地删除必须管理员认证 / CSRF / 明确确认、失效节点无 SSH 可清理、本机规则及候选编辑历史清理、关联任务 / 分组 / 告警记录清理、其他节点和转发历史保留、重复删除返回404。事务故意失败时回滚，通知选择仅移除指定节点。
- Chrome 本地真实 API 检查通过：默认不勾选、普通删除拦截提示、取消后重开默认复位、明确本地删除、其他节点保留、手机窄屏 / 深色布局、无页面异常。工作脚本 work/browser-0255.mjs，截图 outputs/失效服务器删除-v0.2.55.png。
- 首轮全量测试遇到现有 ssh2 随机生成主机密钥解析失败；同一 SSH 用例单独重跑通过、全量再次运行通过，未改该依赖或测试。采集端仍0.2.6，无远端控制器变更；未连接生产或推送GitHub。

## v0.2.56 · 2026-11-13

- 142 项 Node 测试通过（work/test-0256-final.log）。新增真实 SQLite / 模拟 SSH 测试覆盖计费口径、阈值边界、统计有效性、停止失败重试、重启持久化、跨周期不自动恢复、仅恢复自动停止规则、正在安装的规则收敛、恢复期间再次超额、API认证 / CSRF / 输入验证；agent config 仅返回自身网卡当天基线。
- 安装器迁移测试通过，验证首日基线承接主控当天数据、重装不重置、旧身份冲突拒绝和失败回滚。Go test ./... / go vet ./... 通过：首日增量去重、持久化重载、上海跨日、重启 / 计数重置、身份和溢出拒绝。
- amd64 / arm64 Linux 静态采集端 0.2.7 已构建并更新 SHA256SUMS。Bash 语法、ShellCheck 及 Chrome 真实本地主控 API / SQLite 界面验证通过，包含配置保存、手动恢复、状态刷新、手机 / 深色；截图 outputs/流量暂停-v0.2.56.png，工作脚本 work/browser-0256.mjs。
- 本机 Windows 无 Docker / systemd / OpenRC，Linux 真实停止与 Alpine 安装仍需 GitHub CI；Alpine 集成用例现要求首个有效上海当天样本。浏览器恢复使用无远端规则测试状态，不连接生产。未上传 GitHub；原永久命令的 Release 查询失败未在此版本修改。

## v0.2.57 · 2026-11-13

- 142 项 Node 测试通过。Python 转发引擎24项测试通过：新增日志级别 / 输出 / 容量保留策略、旧引擎单次升级、所有活动规则快照与停止状态保留、同一操作内快照时间单调、重复操作不重启、无效指标 / 未知服务 / 节点身份不匹配拒绝，以及启动失败恢复旧配置后重试。
- 升级最终快照只读取一次 Metrics，完整校验全部清单和有界流式响应后再重启，不为每条规则重复下载指标，也不保留完整大响应。正常转发安装仍沿用既有 SSH 归属核验 / 串行队列 / 最终样本入库。
- Linux 真实 GOST 测试增加旧日志策略升级、进程PID仅首次改变、warn/error专用文件、实际失败连接日志和1 MB测试限额触发轮转，继续验证TCP / UDP与计数及规则隔离。本机尝试官方Windows测试包时被安全软件拦截，未绕过或关闭防护，未运行该二进制；实际GOST轮转仍需GitHub Linux CI确认。本机未连接生产 / 推送GitHub。

- 最终全量Node再次142项通过（work/test-0257-final.log）；work/check-0257.mjs记录Python24项引擎 + 6项诊断及8项Node转发相关检查通过。Chrome本地真实主控验证单条更新确认、批量安装说明及编辑窗口均提示首次日志保护的同机中断；未提交部署，未连接生产，工作脚本work/browser-0257.mjs。

## v0.2.58 · 2026-11-13

- 全量146项Node测试通过（work/test-0258-final.log）。原密码/指纹/同机换址测试保留并通过；新增tests/ssh-key.test.mjs真实SSH服务验证OpenSSH Ed25519、RSA PEM及加密RSA私钥，含签名验证、禁止密码回退、草稿认证/CSRF、加密绑定、留空保留、错误私钥/公钥/错误口令拒绝、切换方式清理、指纹不符拒绝、日志私钥/口令脱敏、采集/转发任务、密钥批量门槛、换址证明绑定认证内容、主控重启和加密备份跨主控恢复后再次真实登录。
- Chrome本地真实API/SQLite验证：选择认证方式、文件读取、加密保存、重新打开不回显、留空保留、手机/深色无溢出，无页面异常。工作脚本work/browser-0258.mjs；截图outputs/SSH密钥-v0.2.58.png使用重新打开的空私钥框，不展示测试私钥或口令。浏览器未连接远端，真实SSH测试仅本地测试服务。
- 采集端仍0.2.7，无Go或Linux服务部署逻辑变更。未连接生产或推送GitHub，生产服务器的实际SSH算法/authorized_keys/sudo权限仍需实际测试。此前真实GOST轮转仍待Linux CI，不把本次SSH协议测试等同于Linux安装测试。

- 最终146项全量通过，新增清除私钥后仍可不配置SSH继续编辑节点的回归用例。连接参数在创建Client及占用连接槽位前解析，格式或解密错误不占用SSH连接名额；随后真实SSH/密码/换址18项检查通过。

## v0.2.59 · 2026-11-13

- 148项Node全量测试通过（work/test-0259.log），新增tests/forward-limit-badge.test.mjs验证状态优先级、关闭后保留暂停、停止/恢复失败分别标识、停止任务未完成不显示已暂停、已关闭且恢复后隐藏、使用计费口径、状态损坏不阻断摘要、摘要读取不调SSH/不写状态/不递归调用snapshot。
- 本地真实HTTP / SQLite验证管理员节点及转发列表摘要一致且无原始任务日志，公开API及插件读取不增加保护配置，未经登录不能读取管理列表。
- Chrome真实本地API验证六种状态在仪表盘卡片/列表、服务器列表、转发侧栏均可见，悬停850 / 900 GiB按仅上传口径、点击定位正确服务器、绿色在线状态保留、键盘Enter、无历史点击穿透/嵌套button、保存后立即更新、关闭后仍显示暂停、公开页无标签、手机/深色无溢出且无页面异常。work/browser-0259.mjs，截图outputs/流量保护标识-v0.2.59.png。
- 未修改自动暂停/恢复执行逻辑、GOST、采集端或系统服务，仅添加后台只读状态摘要及入口；采集端仍0.2.7。浏览器使用本地测试状态，未连接生产SSH或推送GitHub。
