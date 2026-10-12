# Firefly Probe v0.2.0

本次包含服务器费用、备份恢复、批量管理、资源与到期告警、流量预测、趋势图、采集端更新提示和公开页面。

## 1. 同步到 GitHub

在电脑的 Windows PowerShell 运行 `上传到GitHub.ps1`，使用已经准备好的完整项目文件夹。检查仓库 Actions 的 Check 全部通过。
当前环境无法读取 Windows 保存的 GitHub 登录凭据，所以需要你在自己的 PowerShell 中完成同步。

## 2. 更新主控

主控服务器以 root 执行原来的固定命令：

```bash
bash -o pipefail -c 'curl --proto "=https" --tlsv1.2 -fsS https://raw.githubusercontent.com/thepigeonstar/FireflyProbe/main/install-master.sh | bash'
```

脚本检测原 `/root/lightprobe`，保存更新前备份后更新。数据库从 v1 迁移到 v2 时另存迁移前快照。
默认优先正式 Release；如果你的仓库已有旧的正式 Release，先发布 v0.2.0 正式版，再运行固定命令。没有 Release 时使用 main。

也可上传 `FireflyProbe-v0.2.0-update.zip` 并执行：

```bash
unzip -o /root/FireflyProbe-v0.2.0-update.zip -d /root/lightprobe
cd /root/lightprobe
bash update.sh
```

更新后 Ctrl+F5 刷新。

## 3. 设置服务器费用

在服务器“配置”填写付款金额、币种、付款周期。
例如金额 45、币种 USD、周期年付，月均原币为 45 ÷ 12 = 3.75 美元，再按有效 USD/CNY 参考汇率换算成人民币。
“费用统计”显示全部服务器的人民币月均、年均折算及分组费用。
“计入固定费用”独立于监控开关；暂停监控不代表停止付费。

## 4. 新功能位置

- 总览：选择服务器后批量修改分组、排序、额度、结算日、到期、监控、告警、维护和公开状态。
- 服务器详情：1 小时、24 小时、7 天网速与 CPU/内存趋势；采集端版本、更新命令与诊断命令。
- 通知与设置：资源阈值、持续时间、到期提醒、跨午夜静默时段、自动备份与公开页面。
- 备份与恢复：下载一致的 SQLite 备份、选择备份恢复；恢复前自动备份，成功后重新登录。
- 公开页面：默认关闭。只显示勾选公开的节点与允许的指标，访问 `/public`。

旧采集端继续上报现有指标。想升级采集端，在详情复制更新命令，到对应服务器以 root 执行；沿用本地配置，不必重新生成密钥。
