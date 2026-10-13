# Google Drive 远程备份与灾难恢复

远程备份在主控先加密再上传 Google Drive，文件扩展名 .ffbackup。包含一致 SQLite 快照（服务器、流量、通知、费用、上传插件、加密网盘授权配置）和用于恢复 SSH 凭据的密钥材料。文件使用 AES-256-GCM，密码经随机盐 scrypt 派生，修改或损坏文件会使认证失败。

## 简单授权（推荐 Windows 电脑）

1. 后台设置 → Google Drive 远程备份 → 点击“获取授权（电脑）”。
2. 复制弹窗里的命令，在你自己的 Windows PowerShell 中执行。不要在 VPS 执行。
3. 助手自动从 rclone 官方网站下载 Windows 客户端并校验 SHA256，然后打开 Google 授权页面。选择账号并授权，页面显示 rclone 客户端，权限为访问 rclone 创建的文件。
4. 完成后授权结果自动复制到剪贴板；回后台粘贴到“授权结果”，点击“保存授权结果”。不需要手动创建 Client ID/Secret，不需要配置文件。
5. 选择 gdrive、设置备份目录、独立加密密码和时间间隔，保存，再点击立即备份验证。

助手会识别 Windows 系统中的本地 HTTP 代理。Clash 用户如未启用系统代理，可在命令末尾加 `-Proxy http://127.0.0.1:6348`（使用自己的实际端口）。不用修改电脑的全局代理或环境变量。授权结果只粘贴到自己的后台，导入后清空剪贴板。

当前助手支持 64 位 Windows；其他系统或已有配置文件按下面的方法导入。

## 已有 rclone.conf 或其他系统

后台展开“已有 rclone.conf 配置文件”，选择 .conf 并点击导入。没有文件时：

1. 从 https://rclone.org/downloads/ 下载 Windows 版，解压，进入 rclone.exe 所在目录。
2. PowerShell 执行：

```powershell
.\rclone.exe config --config .\firefly-drive.conf
```

3. 选 n 新建 remote，名称 gdrive；Storage 输入 drive（或选择 Google Drive 的编号），client_id 与 client_secret 留空使用 rclone 默认，scope 可选 drive.file（只访问 rclone 创建的文件，适合新建备份目录）。root_folder_id 留空；高级设置 n；使用浏览器授权 y。在浏览器选择你的 Google 账号并授权；Shared Drive 按实际情况选择，一般个人网盘选 n；确认保存，最后 q 退出。
4. 管理后台 → 设置 → Google Drive 远程备份，选择刚生成的 firefly-drive.conf，点“导入授权配置”。配置只能包含 Google Drive OAuth 网盘；暂不接受其他后端、服务账号文件或自定义可执行配置。
5. 选择 gdrive、填写网盘内目录 FireflyProbe，设置 12–256 字符的独立加密密码，选择间隔（默认 24 小时），勾选定时备份并保存。
6. 点击“立即备份到网盘”，等待最近备份成功，再在 Google Drive 确认 FireflyProbe 目录出现 .ffbackup 文件。第一次请保留一个文件，并在另一台测试主控验证恢复。

授权文件含访问/刷新 Token，只导入你自己的后台，不上传 GitHub 或公开分享。主控把配置加密存入数据库，不回显 Token；每次上传在私有临时文件中交给 rclone 使用，完成后删除，成功后持久化刷新后的授权。

加密密码必须保存到 VPS 之外（例如密码管理器）；没有密码无法恢复网盘备份。不要只把密码保存在主控 VPS。Google 账号授权需要本人完成，不能由安装脚本代替。

## 为什么不是网站按钮直接跳 Google

每个自行部署的域名要使用网站直接 OAuth 回调，都需要站点自己的 Google OAuth 客户端和预先登记的 HTTPS 回调地址。rclone 的默认客户端使用桌面 localhost 回调，不能直接替换成自己的站点域名。因此当前采用电脑辅助授权；可在注册自己的 Google OAuth 应用后另行开发网页授权。

## 定时与保留

后台每分钟检查是否到期。首次启用将在下一次检查时开始，失败一小时后重试（间隔为 1 小时则同样一小时）。同一时间最多一个远程任务，上传失败保留本地快照；远端文件不会自动删除，旧文件在网盘管理。主控镜像包含 rclone，无需在宿主机另装。

“成功”表示加密文件已经上传，未完成或失败不显示成功。真实连通性取决于主控能访问 Google、授权有效及网盘空间。现有本地 SQLite 备份继续可用，但跨 VPS 恢复推荐 .ffbackup，以恢复 SSH 凭据和授权配置。

## VPS 故障后恢复

1. 在新 VPS 安装主控，设置自己的管理员账号和 HTTPS。
2. 登录 Google Drive，把需要的 .ffbackup 文件下载到电脑。
3. 新主控设置 → 备份与恢复，选择文件，在“加密备份密码”填写当时的密码，点击恢复。
4. 系统验证密码、文件完整性、数据库结构后，先备份当前数据，再恢复。当前管理员账号密码保留；其余设置、节点及统计恢复。SSH 凭据、采集端安装密钥、网盘授权按新主控的密钥重新加密。恢复后重新登录；自定义管理路径也会随备份恢复。
5. 若主控域名没有改变，节点继续上报；若更换域名，修改 PUBLIC_URL、DNS/HTTPS 和采集端配置的 server 地址并重启节点服务。确认恢复后的网盘授权状态，再手动做一次远程备份。

旧的本地 SQLite 文件仍可恢复；若是在不同 VPS，旧加密 SSH 凭据还需原 ssh-secret.key 或重新填写密码。恢复 .ffbackup 不需手动迁移该密钥。

官方说明：[rclone Google Drive](https://rclone.org/drive/)、[在桌面授权并复制配置](https://rclone.org/remote_setup/)。
