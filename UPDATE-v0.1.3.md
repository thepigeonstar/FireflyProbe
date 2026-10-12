# Firefly Probe v0.1.3 更新

- GitHub 仓库固定为 thepigeonstar/FireflyProbe，支持一键安装、更新主控。
- 后台支持自定义名称、英文名称、Logo 和浏览器图标。默认萤火 / Firefly Probe；Telegram 通知使用保存的名称。
- 保留一键接入服务器、Token 保存后显示和页面布局调整。

## 现有主控

优先使用 README 的 GitHub 更新命令（仓库 v0.1.3 标签发布后可用）。
手动方式：将 FireflyProbe-v0.1.3-update.zip 上传主控 /root，运行：

```bash
unzip -o /root/FireflyProbe-v0.1.3-update.zip -d /root/lightprobe
cd /root/lightprobe
bash update.sh
```

解压到原安装目录。更新后浏览器 Ctrl+F5，在“通知与设置”修改名称与图标并保存。已有采集端不需要因改名重装。
