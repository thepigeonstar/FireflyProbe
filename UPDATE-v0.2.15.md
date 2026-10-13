# v0.2.15

- 采集端新增 Alpine 3.20+（稳定版，amd64/arm64）支持，使用 apk、vnstatd 和 OpenRC。
- 通用安装入口使用 sh，可自动准备 Bash、curl、Python 和证书；复制安装/更新命令与 SSH 部署均兼容默认没有 Bash 的 Alpine。
- SSH 地址支持 IPv4、IPv6、域名及国际域名，端口独立填写；保留主机指纹核验，地址变化撤销旧指纹。
- Alpine 按相同发行版本补齐 community 仓库以安装 vnStat，不混入 edge。保持统计时区和原 vnStat 数据；OpenRC 提供开机自启、异常退出重启与私有日志。
- Debian/Ubuntu 保留 systemd 流程。主控 Docker 自动安装系统范围未扩大。
- 新增 Alpine 实际 apk/OpenRC 安装、首次上报和重新安装的隔离容器 CI 检查。本地 Windows 无法执行该容器检查，上传后须等待 GitHub Check 通过。
