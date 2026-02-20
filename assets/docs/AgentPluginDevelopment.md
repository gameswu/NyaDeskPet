# Agent 插件开发

Agent 插件运行在 Electron 主进程中，可以注册工具、指令，或完全接管消息处理流程。

## 目录
- [Agent 插件开发](#agent-插件开发)
  - [目录](#目录)
  - [插件类型](#插件类型)
  - [目录结构](#目录结构)
  - [metadata.json](#metadatajson)
  - [基础插件](#基础插件)
    - [继承 AgentPlugin](#继承-agentplugin)
    - [注册工具](#注册工具)
    - [注册斜杠指令](#注册斜杠指令)
  - [Handler 插件](#handler-插件)
    - [声明为 Handler](#声明为-handler)
    - [实现消息钩子](#实现消息钩子)
  - [插件上下文 (this.ctx)](#插件上下文-thisctx)
    - [通用能力](#通用能力)
    - [Provider 操作](#provider-操作)
    - [多模态能力](#多模态能力)
    - [Skills 技能系统](#skills-技能系统)
    - [Handler 专用](#handler-专用)
  - [MessageContext](#messagecontext)
  - [工具循环](#工具循环)
  - [配置系统](#配置系统)
    - [\_conf\_schema.json](#_conf_schemajson)
    - [读写配置](#读写配置)
  - [日志](#日志)
  - [依赖管理](#依赖管理)
  - [完整示例](#完整示例)

---

## 插件类型

| 类型 | 说明 | 使用场景 |
|------|------|---------|
| 普通插件 | 注册工具和指令供 LLM 调用 | 大多数扩展需求 |
| Handler 插件 | 拦截核心消息处理流程 | 自定义对话流程、替换核心逻辑 |

---

## 目录结构

```
agent-plugins/my-plugin/
├── metadata.json        ← 必须：插件元数据
├── main.js              ← 必须：入口文件（CommonJS）
└── _conf_schema.json    ← 可选：配置模板
```

---

## metadata.json

```json
{
  "name": "my-plugin",
  "author": "Your Name",
  "desc": "插件功能描述",
  "version": "1.0.0",
  "repo": "https://github.com/...",
  "entry": "main.js",
  "handlerPlugin": false,
  "autoActivate": true,
  "dependencies": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 插件名称（唯一标识） |
| `author` | string | | 作者 |
| `desc` | string | | 描述 |
| `version` | string | | 版本号 |
| `repo` | string | | 仓库地址 |
| `entry` | string | | 入口文件，默认 `main.js` |
| `handlerPlugin` | boolean | | 是否为 Handler 插件 |
| `autoActivate` | boolean | | 加载后自动激活 |
| `dependencies` | string[] | | 依赖的其他插件名 |

---

## 基础插件

### 继承 AgentPlugin

```javascript
const { AgentPlugin } = require('../_base');

class MyPlugin extends AgentPlugin {
  async initialize() {
    // 插件初始化，注册工具和指令
  }

  async terminate() {
    // 插件卸载时清理资源
  }
}

module.exports = MyPlugin;
```

### 注册工具

```javascript
async initialize() {
  this.ctx.registerTool({
    name: 'my_tool',
    description: '工具功能描述',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '查询内容' },
        limit: { type: 'number', description: '最大结果数' }
      },
      required: ['query']
    }
  }, async (args) => {
    // args 即为 LLM 传入的参数
    const result = await doSomething(args.query, args.limit);
    return {
      content: result,    // 文本结果
      success: true,      // 是否成功
      // images: [...],   // 可选：图片数据
      // data: {...}       // 可选：结构化数据
    };
  });
}
```

工具参数使用 JSON Schema 格式定义。注册后，工具会自动出现在 AI 的可用工具列表中。

### 注册斜杠指令

```javascript
async initialize() {
  this.ctx.registerCommand({
    name: 'hello',
    description: '打个招呼',
    params: [
      {
        name: 'name',
        description: '名字',
        type: 'string',
        required: false
      }
    ]
  }, async (args, msgCtx) => {
    const name = args.name || '世界';
    msgCtx.addReply({
      type: 'dialogue',
      text: `你好, ${name}!`
    });
  });
}
```

---

## Handler 插件

Handler 插件可以完全接管消息处理，优先级高于默认 Handler。

### 声明为 Handler

在 `metadata.json` 中设置：

```json
{
  "handlerPlugin": true
}
```

### 实现消息钩子

```javascript
class MyHandler extends AgentPlugin {
  // 用户文本消息
  async onUserInput(text, msgCtx) {
    // 返回 true 表示已处理，阻止后续 Handler
    msgCtx.addReply({
      type: 'dialogue',
      text: `你说的是: ${text}`
    });
    return true;
  }

  // 触碰事件
  async onTapEvent(hitArea, position, msgCtx) {
    return false; // 返回 false 交给默认 Handler 处理
  }

  // 文件上传
  async onFileUpload(fileData, msgCtx) {
    return false;
  }

  // 插件消息
  async onPluginMessage(pluginId, content, msgCtx) {
    return false;
  }

  // 模型信息更新
  async onModelInfo(modelInfo, msgCtx) {
    return false;
  }

  // 角色信息更新
  async onCharacterInfo(characterInfo, msgCtx) {
    return false;
  }
}
```

---

## 插件上下文 (this.ctx)

### 通用能力

| 方法 | 说明 |
|------|------|
| `registerTool(schema, handler)` | 注册 FC 工具 |
| `unregisterTool(name)` | 注销工具 |
| `registerCommand(def, handler)` | 注册斜杠指令 |
| `logger` | 日志对象（`.debug()` / `.info()` / `.warn()` / `.error()`） |
| `getConfig()` | 读取插件配置 |
| `saveConfig(config)` | 保存插件配置 |
| `getDataPath()` | 获取插件数据目录 |
| `getPluginInstance(name)` | 获取其他插件实例 |

### Provider 操作

| 方法 | 说明 |
|------|------|
| `getProviders()` | 获取所有 LLM Provider 信息 |
| `getPrimaryProviderId()` | 获取主 Provider 实例 ID |
| `callProvider(instanceId, request)` | 调用指定 Provider 进行 LLM 推理 |
| `getProviderConfig(instanceId)` | 获取 Provider 配置详情（返回 `PluginProviderConfig`） |

`PluginProviderConfig` 类型：

```typescript
interface PluginProviderConfig {
  instanceId: string;
  providerId: string;
  displayName: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
```

### 多模态能力

| 方法 | 说明 |
|------|------|
| `getPrimaryCapabilities()` | 获取主 LLM 的多模态能力声明 |
| `buildMultimodalMessage(role, text, content?)` | 构建带附件的聊天消息 |
| `toDataUrl(content)` | 将 `MultimodalContent` 转为 Data URL |
| `fromDataUrl(dataUrl, fileName?)` | 从 Data URL 解析为 `MultimodalContent` |
| `isContentSupported(content)` | 检查主 Provider 是否支持指定内容类型 |

### Skills 技能系统

| 方法 | 说明 |
|------|------|
| `registerSkill(schema, handler)` | 注册技能 |
| `unregisterSkill(name)` | 注销技能 |
| `invokeSkill(name, params, ctx)` | 调用技能 |
| `listSkills()` | 列出所有已注册技能 |

### Handler 专用

以下方法仅在 Handler 插件中可用：

| 方法 | 说明 |
|------|------|
| `getSessions()` | 获取 SessionManager |
| `getModelInfo()` | 获取当前模型信息 |
| `getCharacterInfo()` | 获取角色人设 |
| `synthesizeAndStream(text, ws)` | TTS 合成并流式发送 |
| `hasTTS()` | 是否有可用 TTS |
| `getPluginInvokeSender()` | 获取插件调用发送器 |
| `isToolCallingEnabled()` | 是否启用工具调用 |
| `getOpenAITools()` | 获取 OpenAI 格式工具列表 |
| `hasEnabledTools()` | 是否有已启用工具 |
| `executeWithToolLoop(request, msgCtx, options)` | 执行工具循环 |

---

## MessageContext

消息处理上下文，用于向前端发送回复。

```javascript
// 添加回复（在 RespondStage 批量发送）
msgCtx.addReply({
  type: 'dialogue',
  text: '回复内容'
});

// 立即发送（绕过批量发送）
msgCtx.send({
  type: 'live2d',
  action: 'expression',
  expressionIndex: 1
});

// 获取消息和会话信息
msgCtx.message;    // 原始消息
msgCtx.sessionId;  // 当前会话 ID
msgCtx.ws;         // WebSocket 连接
```

---

## 工具循环

Handler 插件可以使用 `executeWithToolLoop()` 实现 AI → 工具调用 → AI 的循环推理：

```javascript
async onUserInput(text, msgCtx) {
  const request = {
    messages: [{ role: 'user', content: text }],
    systemPrompt: '你是一个助手...',
    tools: this.ctx.getOpenAITools()
  };

  await this.ctx.executeWithToolLoop(request, msgCtx, {
    maxIterations: 10,      // 最大迭代次数
    streamResponse: true    // 流式输出
  });

  return true;
}
```

---

## 配置系统

### _conf_schema.json

```json
{
  "greeting": {
    "type": "string",
    "description": "默认问候语",
    "default": "你好！"
  },
  "maxResults": {
    "type": "number",
    "description": "最大结果数",
    "default": 10
  },
  "enabled": {
    "type": "boolean",
    "description": "是否启用",
    "default": true
  },
  "mode": {
    "type": "select",
    "description": "工作模式",
    "default": "auto",
    "options": ["auto", "manual", "disabled"]
  }
}
```

### 读写配置

```javascript
const config = this.ctx.getConfig();
console.log(config.greeting);  // "你好！"

this.ctx.saveConfig({ ...config, maxResults: 20 });
```

---

## 日志

使用 `this.ctx.logger` 记录日志：

```javascript
this.ctx.logger.debug('调试信息');
this.ctx.logger.info('一般信息');
this.ctx.logger.warn('警告');
this.ctx.logger.error('错误');
```

> [!WARNING]
> 不要使用 `console.log`，应始终使用 `logger`。

---

## 依赖管理

在 `metadata.json` 中声明依赖：

```json
{
  "dependencies": ["personality", "memory"]
}
```

- 被依赖的插件会先于当前插件初始化
- 可通过 `this.ctx.getPluginInstance('personality')` 获取依赖插件实例

---

## 完整示例

一个提供天气查询工具的 Agent 插件：

```javascript
const { AgentPlugin } = require('../_base');

class WeatherPlugin extends AgentPlugin {
  async initialize() {
    // 注册工具
    this.ctx.registerTool({
      name: 'get_weather',
      description: '查询指定城市的天气',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名称' }
        },
        required: ['city']
      }
    }, async (args) => {
      try {
        const weather = await this.fetchWeather(args.city);
        return { content: weather, success: true };
      } catch (e) {
        return { content: `查询失败: ${e.message}`, success: false };
      }
    });

    // 注册指令
    this.ctx.registerCommand({
      name: 'weather',
      description: '快速查看天气',
      params: [{ name: 'city', type: 'string', required: true }]
    }, async (args, msgCtx) => {
      const weather = await this.fetchWeather(args.city);
      msgCtx.addReply({ type: 'dialogue', text: weather });
    });

    this.ctx.logger.info('天气插件已加载');
  }

  async fetchWeather(city) {
    // 实际天气查询逻辑
    return `${city}：晴，25°C`;
  }

  async terminate() {
    this.ctx.unregisterTool('get_weather');
  }
}

module.exports = WeatherPlugin;
```
