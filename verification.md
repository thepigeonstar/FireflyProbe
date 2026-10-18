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
