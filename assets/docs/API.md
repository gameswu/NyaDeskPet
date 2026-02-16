# API 参考

NyaDeskPet 前后端通过 WebSocket 通信。本页列出所有消息类型及其格式。

## 目录
- [API 参考](#api-参考)
  - [目录](#目录)
  - [连接](#连接)
  - [前端 → 后端消息](#前端--后端消息)
    - [user\_input](#user_input)
    - [model\_info](#model_info)
    - [tap\_event](#tap_event)
    - [character\_info](#character_info)
    - [file\_upload](#file_upload)
    - [plugin\_response](#plugin_response)
    - [plugin\_status](#plugin_status)
    - [tool\_confirm\_response](#tool_confirm_response)
    - [command\_execute](#command_execute)
    - [plugin\_message](#plugin_message)
  - [后端 → 前端消息](#后端--前端消息)
    - [dialogue](#dialogue)
    - [dialogue\_stream\_start / chunk / end](#dialogue_stream_start--chunk--end)
    - [live2d](#live2d)
    - [sync\_command](#sync_command)
    - [audio\_stream\_start / chunk / end](#audio_stream_start--chunk--end)
    - [tool\_confirm](#tool_confirm)
    - [plugin\_invoke](#plugin_invoke)
    - [commands\_register](#commands_register)
  - [消息优先级](#消息优先级)
  - [消息持久化](#消息持久化)
  - [前端插件协议](#前端插件协议)

---

## 连接

- 默认地址：`ws://localhost:8765`
- 协议：JSON 文本帧
- 每条消息必须包含 `type` 字段

---

## 前端 → 后端消息

### user_input

用户发送的文本消息。

```json
{
  "type": "user_input",
  "text": "你好",
  "timestamp": 1700000000000
}
```

### model_info

模型加载完成后自动发送，包含模型完整参数信息。

```json
{
  "type": "model_info",
  "modelInfo": {
    "parameters": [...],
    "expressions": [...],
    "motions": {...},
    "paramMap": {...}
  }
}
```

### tap_event

用户点击模型触碰区域。

```json
{
  "type": "tap_event",
  "hitArea": "head",
  "position": { "x": 0.5, "y": 0.3 }
}
```

### character_info

角色人设信息。

```json
{
  "type": "character_info",
  "useCustom": true,
  "name": "小喵",
  "personality": "活泼可爱的猫娘"
}
```

### file_upload

文件上传（Base64 编码，限制 100MB）。

```json
{
  "type": "file_upload",
  "fileName": "photo.png",
  "fileType": "image/png",
  "fileSize": 102400,
  "data": "base64..."
}
```

### plugin_response

前端插件的响应转发。

```json
{
  "type": "plugin_response",
  "callId": "call-123",
  "pluginId": "terminal-plugin",
  "content": { "type": "text", "data": "命令执行成功" },
  "success": true
}
```

### plugin_status

已连接前端插件列表。

```json
{
  "type": "plugin_status",
  "plugins": [
    { "id": "terminal-plugin", "name": "终端控制", "connected": true }
  ]
}
```

### tool_confirm_response

用户对工具调用确认请求的回复。

```json
{
  "type": "tool_confirm_response",
  "callId": "call-456",
  "approved": true
}
```

### command_execute

执行斜杠指令。

```json
{
  "type": "command_execute",
  "command": "info",
  "args": {}
}
```

### plugin_message

前端插件主动发送的消息。

```json
{
  "type": "plugin_message",
  "pluginId": "terminal-plugin",
  "pluginName": "终端控制",
  "content": "任务完成通知",
  "timestamp": 1700000000000
}
```

---

## 后端 → 前端消息

### dialogue

完整的对话回复。

```json
{
  "type": "dialogue",
  "text": "你好呀！很高兴见到你~",
  "attachment": {
    "type": "image",
    "data": "base64..."
  }
}
```

### dialogue_stream_start / chunk / end

流式对话三段式。

```json
{ "type": "dialogue_stream_start" }
```
```json
{ "type": "dialogue_stream_chunk", "text": "你好" }
```
```json
{ "type": "dialogue_stream_end" }
```

### live2d

Live2D 模型控制指令。

**触发动作：**
```json
{
  "type": "live2d",
  "action": "motion",
  "group": "Idle",
  "index": 0
}
```

**切换表情：**
```json
{
  "type": "live2d",
  "action": "expression",
  "expressionIndex": 1
}
```

**设置参数（单个）：**
```json
{
  "type": "live2d",
  "action": "parameter",
  "parameterId": "ParamEyeLOpen",
  "value": 0
}
```

**设置参数（批量）：**
```json
{
  "type": "live2d",
  "action": "parameter_batch",
  "parameters": [
    { "id": "ParamEyeLOpen", "value": 0 },
    { "id": "ParamEyeROpen", "value": 0 }
  ]
}
```

### sync_command

组合指令，同时执行多个动作。

```json
{
  "type": "sync_command",
  "commands": [
    { "type": "live2d", "action": "expression", "expressionIndex": 1 },
    { "type": "live2d", "action": "motion", "group": "TapBody", "index": 0 }
  ]
}
```

### audio_stream_start / chunk / end

流式音频播放（含时间轴）。

```json
{
  "type": "audio_stream_start",
  "format": "mp3",
  "timeline": [
    { "timing": "start", "commands": [...] },
    { "timing": "middle", "commands": [...] }
  ]
}
```
```json
{
  "type": "audio_stream_chunk",
  "data": "base64..."
}
```
```json
{
  "type": "audio_stream_end"
}
```

**时间轴 timing 格式：**

| 值 | 对应时间位置 |
|----|------------|
| `"start"` | 0% |
| `"early"` | 15% |
| `"middle"` | 50% |
| `"late"` | 85% |
| `"end"` | 98% |
| 数字 0-100 | 精确百分比 |

### tool_confirm

工具调用确认请求（仅来自前端插件的工具）。

```json
{
  "type": "tool_confirm",
  "callId": "call-789",
  "toolName": "execute_command",
  "arguments": { "command": "ls -la" },
  "source": "plugin"
}
```

### plugin_invoke

调用前端插件执行操作。

```json
{
  "type": "plugin_invoke",
  "callId": "call-101",
  "pluginId": "terminal-plugin",
  "action": "execute_command",
  "params": { "command": "ls" }
}
```

### commands_register

注册斜杠指令（由 Agent 插件触发）。

```json
{
  "type": "commands_register",
  "commands": [
    {
      "name": "info",
      "description": "查看系统信息",
      "params": []
    }
  ]
}
```

---

## 消息优先级

| 优先级 | 消息类型 |
|--------|---------|
| 高 | `user_input`、`command_execute` |
| 中 | `tap_event`、`file_upload`、`plugin_message` |
| 低 | `model_info`、`character_info`、`plugin_status` |

高优先级消息会中断正在处理的低优先级流式输出。

---

## 消息持久化

以下消息类型会被写入会话历史（SQLite）：

- `user_input`
- `tap_event`
- `file_upload`
- `command_execute`
- `plugin_message`
- 后端的对话回复

控制类消息（`model_info`、`live2d`、`audio_stream_*` 等）不持久化。

---

## 前端插件协议

前端插件通过独立 WebSocket 连接通信，协议流程：

```
连接 → getMetadata 握手 → getConfig 配置
     → permission_request 权限申请
     → action 操作请求/响应
     → setLocale 语言切换
```

详细信息参见 [前端插件开发](FrontendPluginDevelopment.md)。
