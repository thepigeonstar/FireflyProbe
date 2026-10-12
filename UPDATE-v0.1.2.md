# v0.1.2 更新

新增后台生成并复制采集端一键安装命令；程序由你的主控提供下载，自动识别架构并校验。
新增 GitHub 主控安装与更新脚本。去掉总览和接入指南标题末尾的点。
保留 v0.1.1 的 Telegram Token 保存后显示和设置页面宽度修复。

## 你的现有主控

将 `LightProbe-v0.1.2-update.zip` 上传到主控 `/root`，执行：

```bash
unzip -o /root/LightProbe-v0.1.2-update.zip -d /root/lightprobe
cd /root/lightprobe
bash update.sh
```

请解压到原安装目录。无需修改 `.env`，无需停止或删除数据卷。
看到 v0.1.2 验证成功后，浏览器按 Ctrl+F5。

先新建一个测试节点，复制命令，到对应 Debian/Ubuntu 服务器以 root 执行。
检查 `systemctl status lightprobe-agent --no-pager`，然后确认后台在线。
已有节点无需重装。此次更新会重新构建主控，期间页面和上报会短暂中断。

## 准备 GitHub

完整发布包 `LightProbe-v0.1.2.zip` 包含项目与发布指南。
按 `GITHUB发布指南.md` 创建公开仓库和 v0.1.2 标签，之后即可从 GitHub 一条命令安装或更新主控。
只上传发布包里的项目文件，不要上传服务器上的账号配置或数据库。
