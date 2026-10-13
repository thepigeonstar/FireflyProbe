# 插件开发

当前插件接口版本为 1：管理员后台页面扩展。插件隔离运行，可以按管理员授权读取节点、流量、费用，管理服务器资料，发送通知以及安装/更新采集端。支持在后台上传单文件 JSON 插件包、覆盖更新与卸载；当前不提供在线市场、后端任务钩子或受控端扩展。

## 插件文件

把插件单个 ES module 放到 `web/plugins/`。必须导出 `mount(context)`，可以返回清理函数。离开插件或切换插件时调用清理函数，停止定时器、监听与请求。模块在点击“打开插件”后加载，仅登录管理员能获取代码；执行位置是不同源的隔离 iframe，不能访问宿主 DOM、Cookie 或浏览器存储。

```javascript
export function mount({ container, getNodes, api, notify }) {
  const title = document.createElement('h2');
  title.textContent = '服务器统计';
  container.append(title);
  const count = document.createElement('p');
  count.textContent = getNodes().length + ' 台服务器';
  container.append(count);
  return () => container.replaceChildren();
}
```

`container` 是隔离页面里的插件容器。`getNodes()` 返回打开时的脱敏监控副本（需要 monitor.read），不含 SSH、密码、Token 或后台设置。`api(path, options)` 通过宿主桥接已授权的接口，Cookie、CSRF 和确认凭证由宿主保管，不交给插件。写请求的 body 使用 JSON.stringify(data)，写操作由宿主显示确认，非成功响应抛出异常。notify(text) 显示提示。

数据每次读取为当前后台缓存。要实时数据可调用 `await api('/api/nodes')`，避免高频轮询，退出时停止任务。可用 API 示例：GET /api/nodes、GET /api/costs、GET /api/nodes/:id/network-history。写操作需要对应权限和宿主确认，不能通过自定义请求头绕过授权。

## 注册与启用

编辑 `web/plugins/registry.json`（默认 []）：

```json
[
  {
    "id": "group-summary",
    "name": "服务器分组统计",
    "description": "按分组显示服务器数量",
    "version": "1.0.0",
    "entry": "example.js"
  }
]
```

上例直接启用随附示例 `web/plugins/example.js`。id 为小写字母开头，可含数字和连字符，最多 40 字符；名称最多 60，描述 240，版本 32 字符。entry 是插件目录内 .js 文件，不能使用 ..、绝对路径或指向目录外的符号链接。最多 30 个插件，每个模块最多 512 KiB。

上传完整代码，重建主控 `docker compose up --build -d --force-recreate lightprobe`，然后 Ctrl+F5 刷新。左侧“插件”显示注册项目。停用时删除对应注册项并重建。仓库安装/更新会复制随包注册表；长期定制请在自己的仓库维护插件改动。

## 约束与后续扩展

插件使用 sandbox=allow-scripts 的隔离 iframe，不开启 allow-same-origin；配合 CSP 限制直接 fetch、资源加载、表单和子窗口。后端检查每项权限，写操作额外需要短期、一次性、绑定会话与请求内容的确认凭证。仍需审核来源：授予插件的数据可能被插件处理或展示，沙箱不保证抵御耗尽浏览器资源的代码。显示输入使用 textContent。

当前模块应为单文件：依赖需提前打包，宿主不暴露任意本地文件或相对模块导入。只修改隔离页面中的插件容器，不依赖后台 DOM；不支持远程模块或任意网络请求。离开插件页面时销毁 iframe。

实现转发等后端功能时，需要单独开发受控的服务器 API：沿用认证、CSRF、参数校验、节点权限、任务并发限制、SSH 指纹验证与日志脱敏，不可直接开放任意命令执行。ssh.deploy 仅提供已有的测试/安装/更新接口，不提供任意 SSH 命令或采集端代码注入。

## 制作可上传插件包

写好单文件模块后，在项目目录执行（需要 Node.js）：

```bash
node tools/package-plugin.mjs --id my-summary --name "我的统计插件" --entry web/plugins/example.js --out my-summary.ffplugin.json
```

后台“插件”选择生成的 .ffplugin.json，点“上传并安装”，再点“打开插件”测试。包最多 192 KiB，source 代码最多 128 KiB，最多 30 个插件。包格式：

```json
{
  "format": "firefly-plugin",
  "api_version": 1,
  "manifest": {"id": "my-summary", "name": "我的统计插件", "description": "分组统计", "version": "1.0.0"},
  "source": "export function mount({container}) { container.textContent = 'Hello'; }"
}
```

上传插件存入数据库，更新主控和备份恢复时保留，不需修改项目目录。同 ID 更新须明确确认覆盖；修改后的代码会按新 revision 加载，避免模块缓存仍显示旧代码。可卸载上传插件；内置注册表插件需在源码停用。备份中的插件在恢复时会校验格式和 ID。

当前格式为 Firefly 插件包；Komari 的插件 JSON/ZIP 接口不同，不能直接上传，需要按 mount 接口移植。随发布提供示例包，可用于先测试上传功能。

## 管理员授权与接口范围

在 manifest 中声明 permissions 数组；旧包没有声明时按 monitor.read 处理。管理员在插件卡片的“管理员授权”中勾选并保存。新增权限不会自动授予；更新代码或权限声明后，额外权限失效。签发的写操作确认凭证不能复用，且绑定当前会话、插件版本和请求内容。

| 权限 | 可用接口 |
| --- | --- |
| monitor.read | GET /api/nodes，仅脱敏监控数据 |
| traffic.read | GET /api/traffic/history、/api/network/history、/api/nodes/:id/history、/api/nodes/:id/network-history |
| costs.read | GET /api/costs |
| nodes.manage | POST /api/nodes，PUT 或 DELETE /api/nodes/:id；禁止 SSH 凭据、采集密钥和账号字段 |
| notifications.send | POST /api/notifications/send，body 为 {message:"消息"}，最多 3000 字符 |
| ssh.deploy | POST /api/nodes/:id/ssh/probe、trust、test、deploy；沿用后台指纹验证与并发限制 |

插件请求每分钟最多 60 次，同时最多 4 个桥接请求。SSH 和服务器管理需宿主确认；插件拿不到 Cookie、CSRF 或确认凭证。创建服务器返回 ID，不返回采集密钥。节点接入密钥请在后台管理。

```bash
node tools/package-plugin.mjs --id server-toolbox --name "服务器工具箱" --entry web/plugins/server-toolbox.js --out server-toolbox.ffplugin.json --permissions monitor.read,traffic.read,costs.read,nodes.manage,notifications.send,ssh.deploy
```

随包提供 examples/server-toolbox.ffplugin.json，可刷新监控、查流量与费用、修改名称、发送通知和安装/更新采集端。SSH 操作前先在服务器列表配置连接并确认指纹。授权不提供任意命令执行，也不提供账号、Token、备份或网盘接口。

转发等新功能应由主控实现明确的任务 API，再增加专门权限供插件调用。前端插件只负责界面，不携带 root 凭据，不直接生成或执行任意 SSH 命令。

## 发布 Wiki（独立仓库）

这些文档位于源码 `docs/wiki`，与 GitHub Wiki 是两个仓库。先在 GitHub Wiki 创建首页，然后执行随发布包提供的“发布Wiki.ps1”脚本（工作区 outputs 目录），或项目内 tools/publish-wiki.ps1。GitHub 官方说明：https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages

[下载示例包（源码仓库）](https://github.com/thepigeonstar/FireflyProbe/blob/main/examples/my-summary.ffplugin.json)。
