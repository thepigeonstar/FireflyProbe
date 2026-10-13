# 插件开发

当前插件接口版本为 1：管理员后台页面扩展。插件可以读取节点、调用已存在的后台 API、显示操作结果。当前不提供上传插件、在线市场、后端任务钩子或受控端扩展。

## 插件文件

把插件单个 ES module 放到 `web/plugins/`。必须导出 `mount(context)`，可以返回清理函数。离开插件或切换插件时调用清理函数，停止定时器、监听与请求。模块在点击“打开插件”后加载，仅登录管理员能获取代码。

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

`container` 是当前插件容器；`getNodes()` 返回当前后台节点数据的副本；`api('/api/...', options)` 返回 JSON，自动带登录 Cookie 与 CSRF，非成功响应抛出异常。写请求的 body 使用 `JSON.stringify(data)`；`notify(text)` 显示提示。

数据每次读取为当前后台缓存。要实时数据可调用 `await api('/api/nodes')`，避免高频轮询，退出时停止任务。可用 API 示例：GET /api/nodes、GET /api/costs、GET /api/nodes/:id/network-history。写操作必须按具体接口校验参数，对删除等操作提供明确确认。

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

插件代码与管理员后台拥有相同浏览器权限，仅安装自己审核过的源码。当前没有隔离沙箱；插件不能通过普通页面上传。不要把 SSH 密码、采集密钥或会话传给第三方。显示服务器名称等输入应使用 textContent，避免直接拼接 HTML。

当前模块应为单文件：依赖需提前打包，宿主不暴露任意本地文件或相对模块导入。只修改插件容器，不依赖后台私有 DOM；需要资源时在模块内构建。

实现转发等后端功能时，需要单独开发受控的服务器 API：沿用认证、CSRF、参数校验、节点权限、任务并发限制、SSH 指纹验证与日志脱敏，不可直接开放任意命令执行。当前 mount 接口不提供自动 SSH 执行或采集端插件注入。

## 发布 Wiki

这些文档位于源码 `docs/wiki`，与 GitHub Wiki 是两个仓库。先在 GitHub Wiki 创建首页，然后执行随发布包提供的“发布Wiki.ps1”脚本（工作区 outputs 目录），或项目内 tools/publish-wiki.ps1。GitHub 官方说明：https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages
