# API Reference

NyaDeskPet communicates between frontend and backend via WebSocket. This page lists all message types and their formats.

## Table of Contents
- [API Reference](#api-reference)
  - [Table of Contents](#table-of-contents)
  - [Connection](#connection)
  - [Frontend → Backend Messages](#frontend--backend-messages)
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
  - [Backend → Frontend Messages](#backend--frontend-messages)
    - [dialogue](#dialogue)
    - [dialogue\_stream\_start / chunk / end](#dialogue_stream_start--chunk--end)
    - [live2d](#live2d)
    - [sync\_command](#sync_command)
    - [audio\_stream\_start / chunk / end](#audio_stream_start--chunk--end)
    - [tool\_confirm](#tool_confirm)
    - [plugin\_invoke](#plugin_invoke)
    - [commands\_register](#commands_register)
    - [command\_response](#command_response)
    - [system](#system)
    - [tool\_status](#tool_status)
  - [Response Priority System](#response-priority-system)
  - [Message Priority](#message-priority)
  - [Message Persistence](#message-persistence)
  - [Frontend Plugin Protocol](#frontend-plugin-protocol)

---

## Connection

- Default address: `ws://localhost:8765`
- Protocol: JSON text frames
- Every message must include a `type` field

---

## Frontend → Backend Messages

### user_input

Text message sent by the user.

```json
{
  "type": "user_input",
  "text": "Hello",
  "timestamp": 1700000000000,
  "attachment": {
    "type": "image",
    "data": "base64...",
    "source": "camera"
  }
}
```

- `attachment`: Optional, multimodal attachment (e.g. camera capture)

### model_info

Automatically sent after model loading completes, containing full model parameter information.

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

User clicks a model touch region.

```json
{
  "type": "tap_event",
  "hitArea": "head",
  "position": { "x": 0.5, "y": 0.3 }
}
```

### character_info

Character persona information.

```json
{
  "type": "character_info",
  "useCustom": true,
  "name": "Neko",
  "personality": "A cheerful and cute cat girl"
}
```

### file_upload

File upload (Base64 encoded, 100MB limit).

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

Frontend plugin response forwarding.

```json
{
  "type": "plugin_response",
  "callId": "call-123",
  "pluginId": "terminal-plugin",
  "content": { "type": "text", "data": "Command executed successfully" },
  "success": true
}
```

### plugin_status

List of connected frontend plugins.

```json
{
  "type": "plugin_status",
  "plugins": [
    { "id": "terminal-plugin", "name": "Terminal Control", "connected": true }
  ]
}
```

### tool_confirm_response

User's response to a tool call confirmation request.

```json
{
  "type": "tool_confirm_response",
  "callId": "call-456",
  "approved": true,
  "remember": false
}
```

- `remember`: Optional, whether to remember this approval decision

### command_execute

Execute a slash command.

```json
{
  "type": "command_execute",
  "command": "info",
  "args": {}
}
```

### plugin_message

Message actively sent by a frontend plugin.

```json
{
  "type": "plugin_message",
  "pluginId": "terminal-plugin",
  "pluginName": "Terminal Control",
  "content": "Task completion notification",
  "timestamp": 1700000000000
}
```

---

## Backend → Frontend Messages

### dialogue

Complete conversation reply.

```json
{
  "type": "dialogue",
  "text": "Hello! Nice to meet you~",
  "reasoningContent": "Reasoning chain content (optional)",
  "attachment": {
    "type": "image",
    "data": "base64..."
  }
}
```

- `reasoningContent`: Optional, thinking/reasoning process in non-streaming mode
- `attachment`: Optional attachment

### dialogue_stream_start / chunk / end

Three-phase streaming dialogue.

```json
{ "type": "dialogue_stream_start" }
```
```json
{ "type": "dialogue_stream_chunk", "text": "Hello" }
```
```json
{ "type": "dialogue_stream_end" }
```

### live2d

Live2D model control instructions.

**Trigger motion:**
```json
{
  "type": "live2d",
  "action": "motion",
  "group": "Idle",
  "index": 0
}
```

**Switch expression:**
```json
{
  "type": "live2d",
  "action": "expression",
  "expressionIndex": 1
}
```

**Set parameter (single):**
```json
{
  "type": "live2d",
  "action": "parameter",
  "parameterId": "ParamEyeLOpen",
  "value": 0
}
```

**Set parameters (batch):**
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

Composite command — execute multiple actions simultaneously.

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

Streaming audio playback (with timeline).

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

**Timeline timing format:**

| Value | Corresponding Position |
|-------|----------------------|
| `"start"` | 0% |
| `"early"` | 15% |
| `"middle"` | 50% |
| `"late"` | 85% |
| `"end"` | 98% |
| Number 0-100 | Exact percentage |

### tool_confirm

Tool call confirmation request (only for tools from frontend plugins).

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

Invoke a frontend plugin to perform an operation.

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

Register slash commands (triggered by Agent plugins).

```json
{
  "type": "commands_register",
  "commands": [
    {
      "name": "info",
      "description": "View system information",
      "params": []
    }
  ]
}
```

### command_response

Slash command execution result (backend → frontend).

```json
{
  "type": "command_response",
  "data": {
    "command": "info",
    "success": true,
    "text": "Command result text",
    "error": null
  }
}
```

### system

System-level notification message.

```json
{
  "type": "system",
  "data": { "message": "System message content" }
}
```

### tool_status

Status notification after each tool execution in the tool loop.

```json
{
  "type": "tool_status",
  "data": {
    "iteration": 1,
    "calls": [{ "name": "search_web", "id": "call_abc" }],
    "results": [{ "id": "call_abc", "success": true }]
  }
}
```

---

## Response Priority System

Backend response messages can carry priority information:

- `responseId`: All messages from the same reply share the same ID
- `priority`: Higher value = higher priority; high-priority responses can interrupt low-priority streaming output

---

## Message Priority

| Priority | Message Types |
|----------|--------------|
| High | `user_input`, `command_execute` |
| Medium | `tap_event`, `file_upload`, `plugin_message` |
| Low | `model_info`, `character_info`, `plugin_status` |

High-priority messages will interrupt in-progress low-priority streaming output.

---

## Message Persistence

The following message types are written to session history (SQLite):

- `user_input`
- `tap_event`
- `file_upload`
- `command_execute`
- `plugin_message`
- Backend dialogue replies

Control messages (`model_info`, `live2d`, `audio_stream_*`, etc.) are not persisted.

---

## Frontend Plugin Protocol

Frontend plugins communicate via independent WebSocket connections. Protocol flow:

```
Connect → getMetadata handshake → getConfig configuration
        → permission_request permission request
        → action operation request/response
        → setLocale language switch
```

For detailed information, see [Frontend Plugin Development](FrontendPluginDevelopment.md).