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
    "duration": 5000
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
