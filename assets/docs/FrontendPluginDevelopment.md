# 前端插件开发

前端插件以独立进程运行，通过 WebSocket 与 NyaDeskPet 通信。支持任意编程语言。

## 目录
- [前端插件开发](#前端插件开发)
  - [目录](#目录)
  - [目录结构](#目录结构)
  - [metadata.json](#metadatajson)
  - [通信协议](#通信协议)
    - [1. 握手（getMetadata）](#1-握手getmetadata)
    - [2. 配置请求（getConfig）](#2-配置请求getconfig)
    - [3. 权限申请](#3-权限申请)
    - [4. 操作执行](#4-操作执行)
    - [5. 语言切换](#5-语言切换)
  - [响应内容类型](#响应内容类型)
    - [text](#text)
    - [image](#image)
    - [file](#file)
    - [data](#data)
    - [mixed](#mixed)
  - [权限系统](#权限系统)
    - [危险等级](#危险等级)
    - [权限请求流程](#权限请求流程)
  - [配置系统](#配置系统)
    - [config.json](#configjson)
  - [主动发送消息](#主动发送消息)
  - [Python 示例](#python-示例)
  - [调试技巧](#调试技巧)
  - [更多资源](#更多资源)

---

## 目录结构

```
plugins/my-plugin/
├── metadata.json         ← 必须：插件元数据
├── config.json           ← 可选：配置定义（自动生成配置 UI）
├── main.py               ← 主程序
└── requirements.txt      ← 依赖列表
```

---

## metadata.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "url": "ws://localhost:0",
  "command": {
    "darwin": "python3 main.py",
    "win32": "python main.py",
    "linux": "python3 main.py"
  },
  "workingDirectory": ".",
  "autoStart": false,
  "permissions": [
    {
      "id": "my-plugin.read",
      "dangerLevel": "low",
      "i18n": {
        "zh-CN": { "name": "读取数据", "description": "允许插件读取数据" },
        "en-US": { "name": "Read Data", "description": "Allow plugin to read data" }
      }
    }
  ],
  "i18n": {
    "zh-CN": { "name": "我的插件", "description": "插件描述" },
    "en-US": { "name": "My Plugin", "description": "Plugin description" }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 插件唯一标识 |
| `name` | string | ✅ | 显示名称 |
| `version` | string | ✅ | 版本号 |
| `url` | string | ✅ | WebSocket 地址（`0` 端口表示自动分配） |
| `command` | object | ✅ | 按平台的启动命令 |
| `workingDirectory` | string | | 工作目录（相对于插件目录） |
| `autoStart` | boolean | | 应用启动时自动运行 |
| `permissions` | array | | 权限声明列表 |
| `i18n` | object | | 多语言支持 |

---

## 通信协议

前端插件使用 WebSocket JSON 协议通信。连接建立后，按以下顺序握手：

### 1. 握手（getMetadata）

NyaDeskPet 发送：
```json
{ "type": "getMetadata" }
```

插件响应：
```json
{
  "type": "metadata",
  "name": "My Plugin",
  "version": "1.0.0",
  "capabilities": ["read_data", "process"]
}
```

插件也可以发送连接确认消息（可选）：
```json
{ "type": "connected", "message": "Plugin ready" }
```

### 2. 配置请求（getConfig）

NyaDeskPet 发送：
```json
{ "type": "getConfig" }
```

插件响应：
```json
{
  "type": "plugin_config",
  "config": {
    "api_key": { "type": "string", "description": "API 密钥", "default": "" },
    "max_items": { "type": "int", "description": "最大条目数", "default": 100 }
  }
}
```

### 3. 权限申请

插件主动请求权限：
```json
{
  "type": "permission_request",
  "permissionId": "my-plugin.read",
  "action": "查看文件列表"
}
```

NyaDeskPet 回复：
```json
{
  "type": "permission_response",
  "permissionId": "my-plugin.read",
  "granted": true
}
```

### 4. 操作执行

NyaDeskPet 发送操作请求：
```json
{
  "type": "action",
  "callId": "call-123",
  "action": "read_data",
  "params": { "path": "/some/file" }
}
```

插件响应：
```json
{
  "type": "plugin_response",
  "callId": "call-123",
  "content": {
    "type": "text",
    "data": "文件内容..."
  },
  "success": true
}
```

### 5. 语言切换

NyaDeskPet 发送：
```json
{
  "type": "setLocale",
  "locale": "en-US"
}
```

---

## 响应内容类型

### text

```json
{
  "type": "text",
  "format": "plain",
  "data": "纯文本内容"
}
```

`format` 可选值：`plain`、`markdown`、`html`

### image

```json
{
  "type": "image",
  "format": "png",
  "data": "base64...",
  "alt": "图片描述"
}
```

### file

```json
{
  "type": "file",
  "path": "/path/to/file",
  "name": "output.txt"
}
```

### data

```json
{
  "type": "data",
  "data": { "key": "value", "count": 42 }
}
```

### mixed

```json
{
  "type": "mixed",
  "items": [
    { "type": "text", "data": "说明文字" },
    { "type": "image", "format": "png", "data": "base64..." }
  ]
}
```

---

## 权限系统

插件的每个权限必须在 `metadata.json` 的 `permissions` 中声明。

### 危险等级

| 等级 | 确认策略 |
|------|---------|
| `safe` | 自动允许 |
| `low` | 首次确认，可记住 |
| `medium` | 首次确认，可记住 |
| `high` | 每次确认 |
| `critical` | 每次确认 + 强调警告 |

### 权限请求流程

```python
# 请求权限
ws.send(json.dumps({
    "type": "permission_request",
    "permissionId": "my-plugin.write",
    "action": "写入配置文件"
}))

# 等待响应
response = json.loads(ws.recv())
if response.get("granted"):
    # 已授权，执行操作
    pass
else:
    # 被拒绝
    pass
```

---

## 配置系统

### config.json

配置定义支持 9 种类型：

| 类型 | 说明 | 示例 |
|------|------|------|
| `string` | 单行文本 | API Key |
| `text` | 多行文本 | 描述、模板 |
| `int` | 整数 | 端口号 |
| `float` | 浮点数 | 阈值 |
| `bool` | 布尔值 | 开关 |
| `object` | 嵌套对象 | 复杂配置 |
| `list` | 列表 | 多个值 |
| `dict` | 字典 | 键值对 |
| `template_list` | 模板列表 | 预定义结构的列表 |

```json
{
  "api_key": {
    "type": "string",
    "description": "API 密钥",
    "default": ""
  },
  "port": {
    "type": "int",
    "description": "端口号",
    "default": 8080
  },
  "verbose": {
    "type": "bool",
    "description": "详细日志",
    "default": false
  },
  "tags": {
    "type": "list",
    "description": "标签列表",
    "default": [],
    "items": { "type": "string" }
  }
}
```

NyaDeskPet 会根据配置定义自动生成配置 UI 面板。

---

## 主动发送消息

插件可以主动向对话发送消息：

```python
ws.send(json.dumps({
    "type": "plugin_message",
    "content": "任务已完成！",
    "timestamp": int(time.time() * 1000)
}))
```

`plugin_message` 会自动补充 `pluginId` 和 `pluginName`，并持久化到会话历史。

---

## Python 示例

完整的 Python 前端插件示例：

```python
import asyncio
import json
import websockets

class MyPlugin:
    def __init__(self):
        self.ws = None

    async def handle_message(self, message):
        data = json.loads(message)
        msg_type = data.get("type")

        if msg_type == "getMetadata":
            return {
                "type": "metadata",
                "name": "My Plugin",
                "version": "1.0.0",
                "capabilities": ["my_action"]
            }

        elif msg_type == "getConfig":
            return {
                "type": "plugin_config",
                "config": {}
            }

        elif msg_type == "action":
            call_id = data.get("callId")
            action = data.get("action")
            params = data.get("params", {})

            result = await self.execute_action(action, params)
            return {
                "type": "plugin_response",
                "callId": call_id,
                "content": {"type": "text", "data": result},
                "success": True
            }

        elif msg_type == "setLocale":
            self.locale = data.get("locale", "zh-CN")
            return None

    async def execute_action(self, action, params):
        # 实际业务逻辑
        return f"执行 {action} 完成"

    async def run(self, port=0):
        plugin = self

        async def handler(websocket):
            plugin.ws = websocket
            async for message in websocket:
                response = await plugin.handle_message(message)
                if response:
                    await websocket.send(json.dumps(response))

        async with websockets.serve(handler, "localhost", port) as server:
            actual_port = server.sockets[0].getsockname()[1]
            print(f"Plugin running on port {actual_port}")
            await asyncio.Future()  # 永久运行

if __name__ == "__main__":
    plugin = MyPlugin()
    asyncio.run(plugin.run())
```

---

## 调试技巧

- 使用 `print()` 输出到终端（插件进程的 stdout 可通过日志查看）
- 检查 WebSocket 连接状态
- 在 NyaDeskPet 设置中启用日志，查看插件通信详情
- 单独运行插件进程，使用 WebSocket 客户端工具测试

---

## 更多资源

- [API 参考](API.md) — 完整消息协议
- [权限审批](Permissions.md) — 权限系统详解
- [启用内置插件](BuiltInPlugins.md) — 内置插件使用
