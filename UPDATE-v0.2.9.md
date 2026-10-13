# Firefly Probe v0.2.9

- “接入指南”统一改名“指南”，保留服务器接入步骤。
- 插件开发文档入口从插件页面移至指南，使用源码文档链接；指南同时提供 Google Drive 授权/恢复文档。
- Google Drive 增加“获取授权（电脑）”：复制一次 PowerShell 命令，Windows 助手下载并校验官方 rclone，打开 Google 登录，授权结果自动复制，再粘贴保存。支持系统本地代理或显式 -Proxy；不要求自建 Google OAuth 客户端。原 .conf 文件导入保留在折叠区域。
- 新增 Token 导入接口，需管理员认证/CSRF，验证 JSON 与刷新 Token，加密存储，不回显凭据；导入后清空输入。

验证：51 项 Node 测试与浏览器检查通过；授权助手 PowerShell 语法通过，真实官方下载、SHA256 校验与可执行版本验证通过。没有实际登录用户 Google 账号；Google 授权与实际网盘写入需用户完成。直接网页 OAuth 仍需站点自己的 Client ID/Secret 与 HTTPS 回调登记。

上传并等待 Check 通过后，运行原固定更新命令，Ctrl+F5 刷新。授权助手命令在 Windows 电脑执行，非 VPS。
