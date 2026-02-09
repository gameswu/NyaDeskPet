# API 接口文档

本文档包含 NyaDeskPet 的所有 API 接口规范，包括前后端通信协议。

## 📡 前后端通信协议

### WebSocket 消息格式

#### 从前端发送到后端

**用户输入消息**：
```json
{
  "type": "user_input",
  "text": "用户输入的文本",
  "timestamp": 1234567890
}
```

**模型信息（模型加载后自动发送）**：
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
    "parameters": {
      "canScale": true,
      "currentScale": 1.5,
      "userScale": 1.0,
      "baseScale": 1.5
    }
  }
}
```

**触碰事件**：
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

**说明**：
- `hitArea`: 触碰的部位名称（如 "Head", "Body", "Mouth" 等），未命中时为 "unknown"
- `position`: 触碰的像素坐标
- 前端仅发送触碰信息，**具体的反应（动作、表情、消息）由后端Agent决定并通过 `sync_command` 返回**
- 前端可通过设置面板的可视化配置控制哪些部位启用触摸反应，配置自动按模型持久化存储

**角色信息（连接时自动发送）**：
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

**说明**：
- 用户在设置中启用自定义角色后，前端会在 WebSocket 连接成功后自动发送此消息
- `useCustom`: 是否启用自定义，为 `false` 时使用后端默认配置
- `name`: 桌宠名称
- `personality`: 人设描述，后端可根据此调整 AI 对话风格

**交互事件**：
```json
{
  "type": "interaction",
  "action": "tap",
  "position": { "x": 100, "y": 150 }
}
```

#### 从后端发送到前端

**对话消息**：
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

**语音消息**：
```json
{
  "type": "voice",
  "data": {
    "url": "音频文件URL",
    "base64": "base64编码的音频"
  }
}
```

**Live2D 动作控制**：
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

**Live2D 表情控制**：
```json
{
  "type": "live2d",
  "data": {
    "command": "expression",
    "expressionId": "smile"
  }
}
```

**同步组合指令（支持文字、音频、动作、表情同步）**：
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
        "priority": 3,
        "waitComplete": false
      },
      {
        "type": "dialogue",
        "text": "好开心呀~",
        "duration": 3000,
        "waitComplete": false
      },
      {
        "type": "audio",
        "url": "https://example.com/voice.mp3",
        "waitComplete": true,
        "duration": 3000
      }
    ]
  }
}
```

**同步指令说明**：
- `actions`: 动作数组，按顺序执行
- `type`: 动作类型 - `motion`（动作）、`expression`（表情）、`dialogue`（对话文字）、`audio`（音频）
- `waitComplete`: 是否等待当前动作完成后再执行下一个
- `duration`: 动作持续时间（毫秒）

**使用场景示例**：
1. **同时播放语音和动作**：设置 `waitComplete: false`，让动作、表情、对话同时开始
2. **顺序播放**：设置 `waitComplete: true`，等待上一个动作完成（如等音频播放完）再执行下一个
3. **精确同步**：通过 `duration` 控制每个动作的持续时间，确保时序一致

---

## ⚠️ 错误响应规范

所有错误应返回统一格式:

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

---

## 🌐 WebSocket 连接（可选）

如果需要实时推送模型更新或其他通知。

### 连接

```
ws://backend-url/ws?token=<auth-token>
```

### 服务器推送消息

**模型更新通知**：
```json
{
  "type": "model_update",
  "modelId": "default-model",
  "hash": "new-hash..."
}
```

前端收到 `model_update` 消息后，应清除对应模型的缓存并重新下载。

---

## 🛡️ 安全建议

1. **HTTPS**: 所有 API 必须通过 HTTPS 访问
2. **速率限制**: 对登录接口实施速率限制，防止暴力破解
3. **IP 白名单**: 可选，限制特定 IP 范围访问
4. **日志审计**: 记录所有授权和模型下载请求
5. **密钥轮换**: 定期更换模型加密密钥
6. **令牌撤销**: 支持主动撤销已发放的令牌
7. **CORS 配置**: 正确配置跨域资源共享策略
8. **Content-Type 验证**: 验证请求的 Content-Type
9. **请求大小限制**: 限制请求体的最大大小
10. **超时设置**: 设置合理的请求超时时间

---

## 📝 实现参考

### Python (FastAPI)
```python
from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer

app = FastAPI()
security = HTTPBearer()

@app.post("/api/auth/login")
async def login(credentials: LoginRequest):
    # 实现登录逻辑
    pass

@app.get("/api/models/{model_id}/metadata")
async def get_model_metadata(
    model_id: str,
    token: str = Depends(security)
):
    # 实现元数据获取逻辑
    pass
```

### Node.js (Express)
```javascript
const express = require('express');
const app = express();

app.post('/api/auth/login', async (req, res) => {
  // 实现登录逻辑
});

app.get('/api/models/:modelId/metadata', authenticate, async (req, res) => {
  // 实现元数据获取逻辑
});
```

---

**注意**: 本文档包含所有 API 接口规范，新增或修改 API 时请更新此文档。
