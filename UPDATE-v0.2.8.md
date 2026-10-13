# Firefly Probe v0.2.8

- 固定安装脚本检测已有 Docker 与 Compose，直接复用。缺少 Docker 时，从官方 stable apt 仓库安装当时最新稳定版并启动；只缺 Compose 时安装官方校验过的插件，不更新 Engine。不卸载已有冲突的容器运行环境。支持 Debian 12/13、Ubuntu 22.04/24.04/26.04，amd64/arm64。
- 插件页面增加上传、覆盖更新与卸载。插件包 .ffplugin.json，包 192 KiB / 源码 128 KiB 上限，最多 30 项；存入数据库，升级与备份保留。接口仍为 1，登录管理员点开才执行，具备后台页面权限，不提供隔离沙箱。工具 package-plugin.mjs、示例包及 Wiki 文档已补充。
- 访问入口提示原本动态使用 location.origin + 设置路径，无固定部署域名。真正更换域名仍需同步 PUBLIC_URL、DNS/HTTPS 和节点 server 地址。
- Google Drive 远程备份：导入本人 OAuth 配置、选择目录、独立加密密码、定时间隔、立即上传与状态；失败重试。AES-256-GCM + 随机盐 scrypt 的 .ffbackup 包含数据库、上传插件、SSH/采集端凭据恢复所需密钥材料，网盘授权加密存储。错误密码/文件损坏不修改当前数据；跨 VPS 恢复重新加密凭据，保留当前管理员账号。网盘文件不自动删除，密码需存到 VPS 之外。详见 docs/Remote-Backup.md。
- 旧 TrafficReporter 可共存；其 vnstat-reporter.timer 上报 Komari，与 lightprobe-agent.service 独立。Firefly 需自己的采集端、配置和密钥；迁移后可停用旧 timer，保留 vnstat 服务与数据库。旧 Komari 主控历史不自动迁移。

验证：50 项 Node 测试通过，覆盖上传鉴权/CSRF/覆盖/持久化/卸载，网盘配置校验/凭据不回显，模拟上传与失败/重试/停用，真实加密和跨 VPS 恢复、错误密码/损坏文件不改变当前数据。Chrome 覆盖插件包上传更新（缓存刷新）/卸载、Google 配置导入、密码隐藏、上传状态、设置布局和动态域名提示。Docker 安装分支通过隔离命令测试（复用、仅 Compose、错误校验、新装官方仓库），ShellCheck 通过。真实 apt 安装、Docker 构建须 GitHub CI/服务器验证；Google 实际上传须本人授权后测试。

上传完整项目，等待 Check 通过，再执行原固定命令更新主控，Ctrl+F5 刷新。
