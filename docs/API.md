# API 接口规范

本文档定义 NyaDeskPet 前后端通信协议和 WebSocket 消息格式。

## 通信协议

### 消息格式

所有消息采用 JSON 格式，包含 `type` 和 `data` 字段。

### 前端 → 后端消息

**用户输入**
```json
{
  "type": "user_input",
  "text": "用户输入的文本",
  "timestamp": 1234567890
}
```

**模型信息**

模型加载完成后自动发送，包含模型所有可用的控制参数：
```json
{
  "type": "model_info",
  "data": {
    "available": true,
    "modelPath": "models/nya/nya.model3.json",
    "dimensions": {
      "width": 2048,
      "height": 2048
    },
    "motions": {
      "TapBody": {
        "count": 8,
        "files": ["mtn_01.motion3.json", "mtn_02.motion3.json", ...]
      },
      "TapHead": {
        "count": 3,
        "files": [...]
      }
    },
    "expressions": ["happy", "angry", "sad", "surprised"],
    "hitAreas": ["Head", "Body", "Mouth"],
    "availableParameters": [
      {
        "id": "ParamEyeLOpen",
        "value": 1.0,
        "min": 0.0,
        "max": 1.0,
        "default": 1.0
      },
      {
        "id": "ParamMouthOpenY",
        "value": 0.0,
        "min": 0.0,
        "max": 1.0,
        "default": 0.0
      },
      {
        "id": "ParamAngleX",
        "value": 0.0,
        "min": -30.0,
        "max": 30.0,
        "default": 0.0
      }
    ],
    "parameters": {
      "canScale": true,
      "currentScale": 1.5,
      "userScale": 1.0,
      "baseScale": 1.5
    }
  }
}
```

**触碰事件**

用户点击模型时发送，包含触碰部位和坐标：
```json
{
  "type": "tap_event",
  "data": {
    "hitArea": "Head",
    "position": { "x": 100, "y": 150 },
    "timestamp": 1234567890
  }
}
```

**触碰事件说明**：
- `hitArea`: 触碰的部位名称（如 "Head"、"Body"、"Mouth"），未命中时为 "unknown"
- `position`: 触碰的像素坐标
- 前端仅发送触碰信息，具体的反应（动作、表情、消息）由后端 Agent 决定并通过 `sync_command` 返回
- 可通过设置面板配置哪些部位启用触摸反应，配置按模型持久化存储

**角色信息**

连接成功后自动发送，包含用户自定义的角色设定：
```json
{
  "type": "character_info",
  "data": {
    "useCustom": true,
    "name": "小喵",
    "personality": "活泼开朗，喜欢卖萌，说话带有“喵~”的口癖..."
  }
}
```

**角色信息说明**：
- 用户在设置中启用自定义角色后，连接时自动发送
- `useCustom`: 是否启用自定义，为 `false` 时使用后端默认配置
- `name`: 桌宠名称
- `personality`: 人设描述，后端可根据此调整 AI 对话风格

**文件上传**

用户上传文件时发送，包含文件的完整信息：
```json
{
  "type": "file_upload",
  "data": {
    "fileName": "example.jpg",
    "fileType": "image/jpeg",
    "fileSize": 102400,
    "fileData": "base64_encoded_file_content",
    "timestamp": 1234567890
  }
}
```

**文件上传说明**：
- `fileName`: 文件名称（包含扩展名）
- `fileType`: MIME类型（如 image/jpeg、application/pdf）
- `fileSize`: 文件大小（字节）
- `fileData`: Base64编码的文件内容
- `timestamp`: 上传时间戳
- 前端限制：支持100MB以内的文件上传
- 后端应根据fileType判断文件类型并进行相应处理
- 建议：对于大文件，后端应考虑异步处理以避免超时
**插件响应转发**

前端将插件的响应转发给后端 Agent：
```json
{
  "type": "plugin_response",
  "data": {
    "pluginId": "terminal",
    "requestId": "uuid-here",
    "success": true,
    "action": "execute",
    "result": {
      "type": "text",
      "content": {
        "output": "命令执行结果",
        "exitCode": 0
      }
    },
    "error": null,
    "timestamp": 1234567890
  }
}
```

**插件响应转发说明**：
- `pluginId`: 响应来源的插件 ID
- `requestId`: 对应的请求 ID，用于匹配请求和响应
- `success`: 操作是否成功
- `action`: 执行的操作类型
- `result`: 操作结果数据（支持富内容类型）
- `error`: 错误信息（成功时为 null）
- 前端接收到插件响应后，自动转发给后端 Agent
- Agent 可根据 requestId 关联之前发出的请求

**富内容类型支持**：

插件可以返回多种类型的内容，通过 `result.type` 字段标识：

1. **文本类型** (`"text"`)：
```json
{
  "result": {
    "type": "text",
    "content": {
      "text": "纯文本内容",
      "format": "plain"  // 可选: "plain", "markdown", "html"
    }
  }
}
```

2. **图片类型** (`"image"`)：
```json
{
  "result": {
    "type": "image",
    "content": {
      "data": "base64_encoded_image_data",
      "format": "png",  // "png", "jpeg", "gif", "webp"
      "width": 1920,
      "height": 1080,
      "filename": "screenshot.png"  // 可选
    }
  }
}
```

3. **文件类型** (`"file"`)：
```json
{
  "result": {
    "type": "file",
    "content": {
      "filename": "report.pdf",
      "size": 102400,
      "mimeType": "application/pdf",
      "data": "base64_encoded_file_data",  // Base64编码的文件内容
      "path": "/path/to/file"  // 或本地文件路径（仅限本地插件）
    }
  }
}
```

4. **结构化数据** (`"data"`)：
```json
{
  "result": {
    "type": "data",
    "content": {
      "key1": "value1",
      "key2": 123,
      "nested": { "data": "here" }
    }
  }
}
```

5. **多内容混合** (`"mixed"`)：
```json
{
  "result": {
    "type": "mixed",
    "content": [
      {
        "type": "text",
        "content": { "text": "命令执行完成" }
      },
      {
        "type": "image",
        "content": { "data": "base64...", "format": "png" }
      }
    ]
  }
}
```

**规范要求**：
- 所有插件响应必须严格遵循上述格式，`result` 必须包含 `type` 字段
- 前端不会自动包装响应格式，请插件开发者确保返回标准格式
- 不符合规范的响应将被视为错误

**错误响应**：

当操作失败时，插件应返回错误响应：
```json
{
  "type": "plugin_response",
  "data": {
    "pluginId": "terminal",
    "requestId": "uuid-here",
    "success": false,
    "action": "execute",
    "error": "命令执行失败：权限不足",
    "timestamp": 1234567890
  }
}
```

错误响应说明：
- `success` 必须为 `false`
- `error` 包含错误信息字符串
- 不包含 `result` 字段
- 可选字段如 `errorKey`（用于国际化）、`requiredPermission`（权限相关错误）

### 后端 → 前端消息

**对话消息**
```json
{
  "type": "dialogue",
  "data": {
    "text": "宠物回复的文本",
    "duration": 5000,
    "attachment": {
      "type": "image",
      "url": "图片的URL或base64",
      "name": "图片名称.png"
    }
  }
}
```

**流式音频传输**

音频采用分片传输方式，支持边接收边播放：

开始传输：
```json
{
  "type": "audio_stream_start",
  "data": {
    "mimeType": "audio/mpeg",
    "totalDuration": 5000,
    "text": "同步显示的文字",
    "timeline": [
      {
        "timing": "start",
        "action": "expression",
        "expressionId": "happy"
      },
      {
        "timing": 25,
        "action": "motion",
        "group": "TapHead",
        "index": 0
      },
      {
        "timing": "middle",
        "action": "parameter",
        "parameters": [
          {"id": "ParamMouthOpenY", "value": 0.8, "blend": 0.5}
        ]
      }
    ]
  }
}
```

传输音频分片（可多次发送）：
```json
{
  "type": "audio_chunk",
  "data": {
    "chunk": "base64_encoded_audio_data",
    "sequence": 0
  }
}
```

结束流：
```json
{
  "type": "audio_stream_end",
  "data": {
    "complete": true
  }
}
```

**时间轴系统**

`timing` 支持两种格式：
- **语义标记**：`"start"` (0%)、`"early"` (15%)、`"middle"` (50%)、`"late"` (85%)、`"end"` (98%)
- **百分比数值**：0-100 的数字，表示音频进度百分比

前端根据 `totalDuration` 自动计算具体触发时间。

**插件调用请求**

后端 Agent 请求前端调用插件功能：
```json
{
  "type": "plugin_invoke",
  "data": {
    "requestId": "uuid-here",
    "pluginId": "terminal",
    "action": "execute",
    "params": {
      "command": "ls -la",
      "cwd": "/home/user"
    },
    "timeout": 30000
  }
}
```

**插件调用说明**：
- `requestId`: 唯一请求 ID，用于匹配响应
- `pluginId`: 目标插件的 ID
- `action`: 要执行的操作
- `params`: 操作参数（根据插件和操作类型而定）
- `timeout`: 超时时间（毫秒），可选
- 前端收到后会调用对应插件，并将结果通过 `plugin_response` 返回
- 如果插件未启动或未连接，前端返回错误响应
- 如果操作超时，前端返回超时错误

**插件调用流程**：
1. Agent 发送 `plugin_invoke` 消息
2. 前端检查插件状态并调用
3. 插件处理请求并返回结果
4. 前端将结果通过 `plugin_response` 转发给 Agent
5. Agent 接收响应并继续处理

**Live2D 控制**

动作控制：
```json
{
  "type": "live2d",
  "data": {
    "command": "motion",
    "group": "TapBody",
    "index": 0,
    "priority": 2
  }
}
```

表情控制：
```json
{
  "type": "live2d",
  "data": {
    "command": "expression",
    "expressionId": "smile"
  }
}
```

参数直接控制：

单个参数设置：
```json
{
  "type": "live2d",
  "data": {
    "command": "parameter",
    "parameterId": "ParamEyeLOpen",
    "value": 0.5,
    "weight": 1.0
  }
}
```

批量参数设置：
```json
{
  "type": "live2d",
  "data": {
    "command": "parameter",
    "parameters": [
      {
        "id": "ParamEyeLOpen",
        "value": 0.5,
        "blend": 0.3
      },
      {
        "id": "ParamMouthOpenY",
        "value": 0.8,
        "blend": 0.5
      },
      {
        "id": "ParamAngleX",
        "value": 10.0,
        "blend": 1.0
      }
    ]
  }
}
```

**参数控制说明**：
- `parameterId` / `id`: 参数标识符（从 `model_info` 消息的 `availableParameters` 字段获取）
- `value`: 目标值（范围由参数的 min/max 定义）
- `weight` / `blend`: 混合权重（0-1），用于平滑过渡
- 常见参数：
  - `ParamEyeLOpen`、`ParamEyeROpen`: 左右眼开合度 (0-1)
  - `ParamMouthOpenY`: 嘴巴张开度 (0-1)
  - `ParamAngleX`、`ParamAngleY`、`ParamAngleZ`: 头部旋转角度 (-30 ~ 30)
  - `ParamEyeBallX`、`ParamEyeBallY`: 眼珠位置 (-1 ~ 1)
  - `ParamBrowLY`、`ParamBrowRY`: 眉毛高度 (-1 ~ 1)
- 优势：不依赖预设文件，Agent 可自由组合创造任意表情，与预设系统完全兼容

**组合指令**
```json
{
  "type": "sync_command",
  "data": {
    "actions": [
      {
        "type": "expression",
        "expressionId": "happy",
        "waitComplete": false
      },
      {
        "type": "motion",
        "group": "TapHead",
        "index": 0,
        "waitComplete": false
      },
      {
        "type": "dialogue",
        "text": "好开心呀~",
        "duration": 3000,
        "waitComplete": false
      }
    ]
  }
}
```

**组合指令说明**：
- `actions`: 动作数组，按顺序执行
- `type`: `motion`（动作）、`expression`（表情）、`dialogue`（文字）
- `waitComplete`: 是否等待当前动作完成
- `duration`: 动作持续时间（毫秒）

## 错误处理

所有错误应返回统一格式：

```json
{
  "success": false,
  "error": "错误描述信息",
  "code": "ERROR_CODE"
}
```

### 常见错误码

| 错误码 | HTTP 状态码 | 说明 |
|-------|------------|------|
| `CONNECTION_FAILED` | 500 | 连接失败 |
| `INVALID_REQUEST` | 400 | 请求格式错误 |
| `RATE_LIMIT` | 429 | 请求过于频繁 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

## WebSocket 连接

### 连接地址

```
ws://backend-url/ws
```

### 服务器推送

**模型更新通知**
```json
{
  "type": "model_update",
  "modelId": "default-model",
  "hash": "new-hash..."
}
```

前端收到 `model_update` 消息后，应清除对应模型缓存并重新下载。

### 插件 → 前端消息

**请求配置**：
```json
{
  "action": "getConfig",
  "pluginId": "terminal"
}
```

**配置响应**：
```json
{
  "type": "plugin_config",
  "config": {
    "commandTimeout": 30,
    "maxSessionCount": 5,
    "defaultShell": "/bin/bash"
  }
}
```

**权限请求**：
```json
{
  "type": "permission_request",
  "requestId": "uuid-here",
  "permissionId": "terminal.execute",
  "operation": "execute_command",
  "details": {
    "command": "rm -rf /"
  }
}
```

**权限响应**：
```json
{
  "type": "permission_response",
  "requestId": "uuid-here",
  "granted": true
}
```

**插件响应（包含权限信息）**：
```json
{
  "type": "plugin_response",
  "success": true,
  "action": "execute",
  "data": { ... },
  "locale": "zh-CN",
  "requiredPermission": "terminal.execute"
}
```

**字段说明**：
- `requiredPermission`: 该操作需要的权限 ID，用于前端记录和管理
- 失败时如果是权限被拒绝，`success` 为 `false`，`errorKey` 为 `"error.permission_denied"`

### 前端 → 插件消息

**请求配置**：
前端接收到插件的 `getConfig` 请求后，返回对应的配置数据。

**权限确认**：
前端接收到插件的 `permission_request` 后，显示确认对话框，用户确认后返回 `permission_response`。

## 配置和权限流程

### 配置同步流程

```
插件启动
  ↓
发送 getConfig 请求
  ↓
前端读取配置文件 (userData/plugins/{id}/config.json)
  ↓
返回 plugin_config 消息
  ↓
插件应用配置
```

### 权限审批流程

```
插件准备执行操作
  ↓
检查是否需要权限
  ↓
发送 permission_request
  ↓
前端检查权限记录
  ↓
（如需）显示确认对话框
  ↓
返回 permission_response
  ↓
插件根据结果执行或拒绝操作
```

## 外置插件协议

NyaDeskPet 支持通过 WebSocket 连接外置插件（如终端控制、UI自动化等）。

### 插件架构

**设计原则**：
- 插件独立运行，作为独立进程
- 前端主动连接插件的 WebSocket 服务
- 通过元信息文件（`metadata.json`）配置插件

**元信息配置**（`plugins/*/metadata.json`）：
```json
{
  "id": "terminal",
  "name": "terminal",
  "version": "1.0.0",
  "url": "ws://localhost:8765",
  "autoStart": false,
  "command": {
    "darwin": ["venv/bin/python3", "main.py"],
    "win32": ["venv\\Scripts\\python.exe", "main.py"],
    "linux": ["venv/bin/python3", "main.py"]
  },
  "workingDirectory": "plugins/terminal-plugin",
  "i18n": {
    "zh-CN": {
      "displayName": "终端控制",
      "description": "执行系统命令、管理Shell会话"
    }
  }
}
```

**字段说明**：
- `command`: 插件启动命令数组，按平台区分
- `workingDirectory`: 插件工作目录（相对于应用根目录）
- `autoStart`: 是否随应用自动启动
- `url`: WebSocket 连接地址

**启动流程**：
1. 用户在插件管理面板点击「启动」
2. 前端通过 IPC 请求主进程启动插件进程
3. 主进程使用 `child_process.spawn` 执行 `command` 中的命令
4. 等待 3 秒后前端尝试连接 `url` 指定的 WebSocket
5. 连接成功后插件状态变为「已连接」

### 插件连接

**地址**: 插件独立运行，前端主动连接
- 终端插件: `ws://localhost:8765`
- UI自动化插件: `ws://localhost:8766`

### 连接握手

前端连接后，应主动发送 `getMetadata` 请求获取插件信息。

**前端 → 插件**:
```json
{
  "action": "getMetadata",
  "locale": "zh-CN"
}
```

**插件 → 前端**:
```json
{
  "type": "metadata",
  "plugin": "terminal",
  "locale": "zh-CN",
  "defaultLocale": "en-US",
  "metadata": {
    "name": "terminal",
    "version": "1.0.0",
    "displayName": "终端控制插件",
    "description": "执行终端命令、管理Shell会话",
    "author": "NyaDeskPet",
    "type": "external",
    "permissions": ["terminal.execute", "terminal.session"],
    "capabilities": ["execute", "createSession", "getSessions"]
  }
}
```

**字段说明**：
- `locale`: 当前返回的语言（zh-CN 或 en-US），与请求的语言一致
- `defaultLocale`: 插件的默认语言，当请求的语言不支持时自动回退到此语言
- `metadata.displayName`: 使用请求语言的插件名称（单一语言）
- `metadata.description`: 使用请求语言的描述（单一语言）

**语言回退机制**：
- 前端请求 `zh-CN` → 插件内部使用 `zh-cn` → 返回中文元数据
- 前端请求 `en-US` → 插件内部使用 `en` → 返回英文元数据
- 前端请求不支持的语言（如 `ja`）→ 插件回退到 `defaultLocale` → 返回英文元数据

### 语言切换

前端可以动态切换插件语言：

**请求**:
```json
{
  "action": "setLocale",
  "params": {
    "locale": "en-US"
  }
}
```

**响应**:
```json
{
  "type": "plugin_response",
  "success": true,
  "locale": "en-US",
  "metadata": {
    "displayName": "Terminal Plugin",
    "description": "Execute terminal commands and manage shell sessions"
  }
}
```

### 错误消息国际化

所有错误响应包含 `errorKey` 用于前端本地化：

```json
{
  "type": "plugin_response",
  "success": false,
  "error": "命令参数是必需的",
  "errorKey": "error.command_required",
  "locale": "zh-CN"
}
```

前端可以根据 `errorKey` 显示自己的本地化文本，或直接使用 `error` 字段。

### 语言代码映射

| 前端语言 | 插件语言 | 说明 |
|---------|---------|------|
| zh-CN | zh-cn | 简体中文 |
| en-US | en | English |

插件收到不支持的语言代码时，返回 `defaultLocale` 指定的语言。

## 安全建议

1. **HTTPS**: 生产环境必须使用 HTTPS
2. **速率限制**: 对关键接口实施速率限制
3. **IP 白名单**: 可选，限制特定 IP 访问
4. **日志审计**: 记录所有请求
5. **CORS 配置**: 正确配置跨域资源共享
6. **请求验证**: 验证 Content-Type 和请求大小
7. **超时设置**: 设置合理的请求超时时间

## 实现参考

### Python (FastAPI)
```python
from fastapi import FastAPI, WebSocket

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    # 实现消息处理逻辑
    pass
```

### Node.js (Express + ws)

```javascript
const express = require('express');
const WebSocket = require('ws');

const app = express();
const wss = new WebSocket.Server({ port: 8000 });

wss.on('connection', (ws) => {
  // 实现消息处理逻辑
});
```
