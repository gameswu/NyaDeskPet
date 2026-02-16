# 插件开发

NyaDeskPet 提供两种插件机制，适用于不同的扩展场景。

## 目录
- [插件开发](#插件开发)
  - [目录](#目录)
  - [插件类型对比](#插件类型对比)
  - [如何选择](#如何选择)
  - [快速开始](#快速开始)
    - [Agent 插件](#agent-插件)
    - [前端插件](#前端插件)
  - [更多资源](#更多资源)

---

## 插件类型对比

| 特性 | Agent 插件 | 前端插件 |
|------|-----------|---------|
| 运行位置 | 主进程内 | 独立进程 |
| 语言 | JavaScript（CommonJS） | 任意语言 |
| 通信方式 | 直接函数调用 | WebSocket |
| 能力 | 注册工具、指令、拦截消息 | 终端/文件/UI 操作 |
| 安全模型 | 与主进程同权限 | 沙箱 + 权限审批 |
| 适用场景 | 扩展 AI 推理和工具能力 | 扩展系统操作能力 |

---

## 如何选择

**选择 Agent 插件**，如果你想：
- 注册新的 Function Calling 工具供 AI 使用
- 注册斜杠指令
- 修改 AI 的系统提示词或消息处理流程
- 拦截并自定义消息处理（Handler 插件）

**选择前端插件**，如果你想：
- 执行系统操作（终端命令、文件读写）
- 进行 UI 自动化（鼠标键盘模拟）
- 使用非 JavaScript 语言开发
- 需要运行在隔离的进程中

---

## 快速开始

### Agent 插件

最小目录结构：

```
agent-plugins/my-plugin/
├── metadata.json     ← 插件元数据
└── main.js           ← 入口（CommonJS）
```

```json
// metadata.json
{
  "name": "my-plugin",
  "author": "Your Name",
  "desc": "插件描述",
  "version": "1.0.0"
}
```

```javascript
// main.js
const { AgentPlugin } = require('../_base');

class MyPlugin extends AgentPlugin {
  async initialize() {
    this.ctx.registerTool({
      name: 'my_tool',
      description: '工具描述',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: '输入内容' }
        },
        required: ['input']
      }
    }, async (args) => {
      return { content: `处理结果: ${args.input}`, success: true };
    });
  }
}

module.exports = MyPlugin;
```

详细指南：**[Agent 插件开发](AgentPluginDevelopment.md)**

---

### 前端插件

最小目录结构：

```
plugins/my-plugin/
├── metadata.json     ← 插件元数据
└── main.py           ← 主程序
```

```json
// metadata.json
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
  "permissions": []
}
```

详细指南：**[前端插件开发](FrontendPluginDevelopment.md)**

---

## 更多资源

- [API 参考](API.md) — 消息协议完整规范
- [开发者指南](DEVELOPMENT.md) — 项目架构和开发流程
