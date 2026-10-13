# 生产安全配置

## 代理与登录

登录限流按真实访客 IP 计数，每个 IP 五分钟最多 15 次。账号失败跨 IP 累计后增加验证延迟，正确登录清除账号延迟，不硬锁整个账号。

只有连接来自可信代理，才使用 X-Forwarded-For；从右往左检查代理链，不直接采信链首。默认自动识别本机回环、当前 Docker 网关及同 Compose 网络的配套 Caddy，不信任整个私网。非默认 Docker 网段、额外代理和多层代理需要配置 TRUSTED_PROXIES，为逗号分隔的精确 IP 或 CIDR。设置后覆盖自动识别，勿填写 0.0.0.0/0 或 ::/0。

已有 Nginx 的单层代理建议覆盖客户端自带的头：

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

CDN 或多层代理应先在代理层配置可信来源，再传递真实地址，不直接信任来自公网的 X-Real-IP、CF-Connecting-IP 或伪造转发头。保持 8080 仅绑定 127.0.0.1；修改 .env 后重建主控容器。

## Telegram 凭据

已有明文 Token 自动迁移到独立的加密记录；设置接口和插件均不回显。通知页留空保留，填新值替换，勾选清除删除。密钥在数据卷中的 ssh-secret.key，与 SSH/网盘凭据使用不同的加密上下文。

旧备份及旧数据库 WAL 副本可能仍有历史明文，升级不会重写旧备份。不能保证仅升级就消除所有历史副本；若旧备份泄露，应撤销旧 Bot Token。数据库和密钥同时被盗时，加密不能阻止凭据被解密。跨 VPS 恢复推荐 .ffbackup，迁移后会重新加密 Token。

## 插件授权

默认只允许监控读取；其余权限由管理员逐项授予。插件代码或权限声明更新后，额外授权失效，需要重新授权。修改资料、删除、发送通知、SSH 操作均由宿主确认并签发一次性确认凭证。

禁止插件读取账号、密码、Token、备份和网盘配置；禁止任意 SSH 命令执行。部署使用服务器列表中管理员已配置并确认指纹的连接。iframe 隔离防止读取宿主页面和会话，权限边界仍由后端校验。请审核插件代码；浏览器资源消耗和已授权数据的使用仍需信任作者。

参考：[MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)、[Caddy 转发头规则](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
