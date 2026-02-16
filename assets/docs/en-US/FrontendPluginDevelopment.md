# Frontend Plugin Development

Frontend plugins run as independent processes and communicate with NyaDeskPet via WebSocket. Any programming language is supported.

## Table of Contents
- [Frontend Plugin Development](#frontend-plugin-development)
  - [Table of Contents](#table-of-contents)
  - [Directory Structure](#directory-structure)
  - [metadata.json](#metadatajson)
  - [Communication Protocol](#communication-protocol)
    - [1. Handshake (getMetadata)](#1-handshake-getmetadata)
    - [2. Configuration Request (getConfig)](#2-configuration-request-getconfig)
    - [3. Permission Request](#3-permission-request)
    - [4. Action Execution](#4-action-execution)
    - [5. Language Switch](#5-language-switch)
  - [Response Content Types](#response-content-types)
    - [text](#text)
    - [image](#image)
    - [file](#file)
    - [data](#data)
    - [mixed](#mixed)
  - [Permission System](#permission-system)
    - [Danger Levels](#danger-levels)
    - [Permission Request Flow](#permission-request-flow)
  - [Configuration System](#configuration-system)
    - [config.json](#configjson)
  - [Sending Messages Proactively](#sending-messages-proactively)
  - [Python Example](#python-example)
  - [Debugging Tips](#debugging-tips)
  - [More Resources](#more-resources)

---

## Directory Structure

```
plugins/my-plugin/
├── metadata.json         ← Required: Plugin metadata
├── config.json           ← Optional: Config definition (auto-generates config UI)
├── main.py               ← Main program
└── requirements.txt      ← Dependencies
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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique plugin identifier |
| `name` | string | ✅ | Display name |
| `version` | string | ✅ | Version number |
| `url` | string | ✅ | WebSocket address (port `0` means auto-assign) |
| `command` | object | ✅ | Launch command by platform |
| `workingDirectory` | string | | Working directory (relative to plugin directory) |
| `autoStart` | boolean | | Auto-run on app startup |
| `permissions` | array | | Permission declaration list |
| `i18n` | object | | Multilingual support |

---

## Communication Protocol

Frontend plugins communicate using WebSocket JSON protocol. After connection is established, handshake in the following order:

### 1. Handshake (getMetadata)

NyaDeskPet sends:
```json
{ "type": "getMetadata" }
```

Plugin responds:
```json
{
  "type": "metadata",
  "name": "My Plugin",
  "version": "1.0.0",
  "capabilities": ["read_data", "process"]
}
```

### 2. Configuration Request (getConfig)

NyaDeskPet sends:
```json
{ "type": "getConfig" }
```

Plugin responds:
```json
{
  "type": "plugin_config",
  "config": {
    "api_key": { "type": "string", "description": "API Key", "default": "" },
    "max_items": { "type": "int", "description": "Maximum items", "default": 100 }
  }
}
```

### 3. Permission Request

Plugin actively requests permission:
```json
{
  "type": "permission_request",
  "permissionId": "my-plugin.read",
  "action": "View file list"
}
```

NyaDeskPet responds:
```json
{
  "type": "permission_response",
  "permissionId": "my-plugin.read",
  "granted": true
}
```

### 4. Action Execution

NyaDeskPet sends an action request:
```json
{
  "type": "action",
  "callId": "call-123",
  "action": "read_data",
  "params": { "path": "/some/file" }
}
```

Plugin responds:
```json
{
  "type": "plugin_response",
  "callId": "call-123",
  "content": {
    "type": "text",
    "data": "File content..."
  },
  "success": true
}
```

### 5. Language Switch

NyaDeskPet sends:
```json
{
  "type": "setLocale",
  "locale": "en-US"
}
```

---

## Response Content Types

### text

```json
{
  "type": "text",
  "format": "plain",
  "data": "Plain text content"
}
```

`format` options: `plain`, `markdown`, `html`

### image

```json
{
  "type": "image",
  "format": "png",
  "data": "base64...",
  "alt": "Image description"
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
    { "type": "text", "data": "Description text" },
    { "type": "image", "format": "png", "data": "base64..." }
  ]
}
```

---

## Permission System

Every plugin permission must be declared in the `permissions` field of `metadata.json`.

### Danger Levels

| Level | Confirmation Policy |
|-------|-------------------|
| `safe` | Auto-allow |
| `low` | First-time confirmation, can remember |
| `medium` | First-time confirmation, can remember |
| `high` | Every-time confirmation |
| `critical` | Every-time confirmation + emphasized warning |

### Permission Request Flow

```python
# Request permission
ws.send(json.dumps({
    "type": "permission_request",
    "permissionId": "my-plugin.write",
    "action": "Write configuration file"
}))

# Wait for response
response = json.loads(ws.recv())
if response.get("granted"):
    # Authorized — proceed with operation
    pass
else:
    # Denied
    pass
```

---

## Configuration System

### config.json

Configuration definitions support 9 types:

| Type | Description | Example |
|------|-------------|---------|
| `string` | Single-line text | API Key |
| `text` | Multi-line text | Descriptions, templates |
| `int` | Integer | Port number |
| `float` | Float | Threshold |
| `bool` | Boolean | Toggle |
| `object` | Nested object | Complex config |
| `list` | List | Multiple values |
| `dict` | Dictionary | Key-value pairs |
| `template_list` | Template list | List with predefined structure |

```json
{
  "api_key": {
    "type": "string",
    "description": "API Key",
    "default": ""
  },
  "port": {
    "type": "int",
    "description": "Port number",
    "default": 8080
  },
  "verbose": {
    "type": "bool",
    "description": "Verbose logging",
    "default": false
  },
  "tags": {
    "type": "list",
    "description": "Tag list",
    "default": [],
    "items": { "type": "string" }
  }
}
```

NyaDeskPet automatically generates a configuration UI panel based on the config definition.

---

## Sending Messages Proactively

Plugins can proactively send messages to the conversation:

```python
ws.send(json.dumps({
    "type": "plugin_message",
    "content": "Task completed!",
    "timestamp": int(time.time() * 1000)
}))
```

`plugin_message` will automatically have `pluginId` and `pluginName` appended, and is persisted to session history.

---

## Python Example

Complete Python frontend plugin example:

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
        # Actual business logic
        return f"Executed {action} successfully"

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
            await asyncio.Future()  # Run forever

if __name__ == "__main__":
    plugin = MyPlugin()
    asyncio.run(plugin.run())
```

---

## Debugging Tips

- Use `print()` to output to the terminal (plugin process stdout can be viewed via logs)
- Check WebSocket connection status
- Enable logging in NyaDeskPet settings to view plugin communication details
- Run the plugin process standalone and test with a WebSocket client tool

---

## More Resources

- [API Reference](API.md) — Complete message protocol
- [Permissions](Permissions.md) — Permission system details
- [Enable Built-in Plugins](BuiltInPlugins.md) — Built-in plugin usage