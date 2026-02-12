# 内置 Agent 插件开发指南

本文档介绍如何为 NyaDeskPet 的内置 Agent 开发插件。与普通的前端插件（扩展 UI 和 Electron 进程功能）不同，**Agent 插件**直接扩展 LLM（大语言模型）的能力，使其能够调用自定义工具（Tools）完成各种复杂任务。

## 架构概述

Agent 插件运行在 Electron 的 **主进程** 中，基于 `AgentPlugin` 基类开发。它允许你：

1. **注册工具 (Tools)**：通过 `Function Calling` 机制供 LLM 调用
2. **管理生命周期**：包含加载、激活、停用、卸载等钩子
3. **持久化数据**：拥有独立的配置存储和数据目录
4. **访问上下文**：使用日志、配置管理等基础设施
5. **拦截消息处理（Handler 插件）**：通过 `handlerPlugin: true` 标记，可拦截 `user_input`、`tap_event` 等核心消息处理流程

### 插件类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **普通插件** | 注册工具供 LLM 调用 | 天气查询、文件操作 |
| **Handler 插件** | 拦截并替换消息处理核心逻辑 | `core-agent`（内置） |

### 内置 Core Agent 插件

项目采用 **多插件组合架构**，将桌宠 Agent 核心能力拆分为 5 个独立的纯 JS 插件（位于 `agent-plugins/`）：

| 插件名 | 类型 | 说明 |
|--------|------|------|
| `personality` | 普通插件 | 人格系统 — 构建结构化系统提示词，整合默认人格、用户人格、Live2D 模型能力 |
| `memory` | 普通插件 | 记忆管理 — 会话分离的上下文管理，支持自动压缩汇总 |
| `protocol-adapter` | 普通插件 | 协议适配 — 将 LLM 回复中的 XML 标签解析为前端 `dialogue`/`live2d`/`sync_command` 格式 |
| `plugin-tool-bridge` | 普通插件 | 插件工具桥接 — 将前端插件能力转换为 Function Calling 工具供 LLM 调用 |
| `core-agent` | Handler 插件 | 核心协调器 — 组合上述 4 个插件，处理用户输入、触碰事件等核心流程 |

所有 5 个插件均设置了 `autoActivate: true`，会在应用启动时自动激活。`core-agent` 声明了对其他 4 个插件的 `dependencies` 依赖，系统会通过拓扑排序确保依赖先于依赖者激活。

---

## 快速开始

### 1. 目录结构

所有插件存放在 app 根目录下的 `agent-plugins/` 文件夹中。每个插件一个独立目录：

```
agent-plugins/
  my-weather-plugin/        # 插件目录
    ├── metadata.json       # [必须] 插件元信息
    ├── main.js             # [必须] 插件入口文件（支持 TypeScript 编译后的 JS）
    └── _conf_schema.json   # [可选] 配置对应的 UI 表单结构
```

### 2. metadata.json

```json
{
  "name": "my-weather-plugin",
  "author": "NyaDev",
  "desc": "为 Agent 提供天气查询能力",
  "version": "1.0.0",
  "repo": "https://github.com/nyadeskpet/weather-plugin",
  "entry": "main.js",
  "autoActivate": true,
  "dependencies": []
}
```

| 字段 | 必须 | 说明 |
|------|------|------|
| `name` | ✅ | 插件唯一名称 |
| `author` | ✅ | 作者 |
| `desc` | ✅ | 描述 |
| `version` | ✅ | 版本号 |
| `repo` | ❌ | 仓库地址 |
| `entry` | ❌ | 入口文件（默认 `main.js`） |
| `handlerPlugin` | ❌ | 是否为 Handler 插件（默认 `false`） |
| `autoActivate` | ❌ | 是否在加载后自动激活（默认 `false`） |
| `dependencies` | ❌ | 依赖的插件名称列表，系统会按拓扑排序确保依赖先激活 |

### 3. main.js (开发示例)

插件必须导出一个继承自 `AgentPlugin` 的默认类。

由于项目通过 `require` 动态加载插件，建议使用 JavaScript 开发，或者使用 TypeScript 编译为 CommonJS 模块。

```javascript
const { AgentPlugin } = require('../../dist/agent/agent-plugin'); // 引用基类（视实际路径而定）
// 或者并在开发环境使用 TypeScript 编译

module.exports = class WeatherPlugin extends AgentPlugin {
  
  // 插件初始化
  async initialize() {
    this.ctx.logger.info('天气插件正在初始化...');

    // 注册工具
    this.ctx.registerTool({
      name: 'get_current_weather',
      description: '查询指定城市的当前天气情况',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，例如：北京、Shanghai'
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: '温度单位'
          }
        },
        required: ['city']
      }
    }, this.handleGetWeather.bind(this));
  }

  // 工具处理函数
  async handleGetWeather(args) {
    const city = args.city;
    const unit = args.unit || 'celsius';
    
    this.ctx.logger.info(`查询天气: ${city}, 单位: ${unit}`);
    
    // 模拟 API 调用
    // 实际开发中可以使用 axios / fetch 请求真实接口
    const temp = Math.floor(Math.random() * 30);
    const condition = ['晴朗', '多云', '下雨'][Math.floor(Math.random() * 3)];
    
    return {
      content: `当前${city}的天气是${condition}，温度为 ${temp}摄氏度。`,
      success: true
    };
  }

  // 插件销毁
  async terminate() {
    this.ctx.logger.info('天气插件已停止');
  }
}
```

---

## 插件 API 参考

### AgentPlugin 基类

所有插件必须继承此类。

```typescript
abstract class AgentPlugin {
  protected ctx: AgentPluginContext; // 插件上下文
  
  async initialize(): Promise<void>; // 激活时调用
  async terminate(): Promise<void>;  // 停用/卸载时调用
}
```

### AgentPluginContext 上下文

`this.ctx` 提供了插件所需的各种能力：

| 方法 | 说明 |
|------|------|
| `registerTool(schema, handler)` | 注册一个供 LLM 调用的工具 |
| `unregisterTool(toolName)` | 注销指定名称的工具 |
| `logger.info(msg)` | 打印 info 日志（带插件名前缀） |
| `logger.warn(msg)` | 打印 warning 日志 |
| `logger.error(msg)` | 打印 error 日志 |
| `getConfig()` | 获取插件当前的配置对象 |
| `saveConfig(config)` | 保存配置对象并持久化到磁盘 |
| `getDataPath()` | 获取插件专属的数据存储目录路径 |
| `getProviders()` | 获取所有 Provider 实例摘要列表 |
| `getPrimaryProviderId()` | 获取主 LLM 的 instanceId |
| `callProvider(instanceId, request)` | 调用指定 Provider 进行 LLM 对话 |
| `getSessions()` | 获取会话管理器（Handler 插件专用） |
| `getModelInfo()` | 获取当前 Live2D 模型信息（Handler 插件专用） |
| `getCharacterInfo()` | 获取当前角色人设信息（Handler 插件专用） |
| `synthesizeAndStream(text, ctx)` | 使用主 TTS 合成并推流到前端（Handler 插件专用） |
| `hasTTS()` | 是否有可用的 TTS Provider（Handler 插件专用） |
| `getPluginInvokeSender()` | 获取前端插件调用发送器（Handler 插件专用） |
| `isToolCallingEnabled()` | 工具系统是否启用（Handler 插件专用） |
| `getOpenAITools()` | 获取 OpenAI 格式工具列表（Handler 插件专用） |
| `hasEnabledTools()` | 是否有已注册工具（Handler 插件专用） |
| `getPluginInstance(name)` | 获取其他已激活插件的实例（用于插件间服务调用） |
| `executeWithToolLoop(request, ctx)` | 执行含工具循环的 LLM 调用（自动处理 tool_calls → 执行 → 继续） |

#### 调用多 LLM Provider

插件可以通过上下文访问系统中配置的所有 LLM Provider 实例，从而实现多模型协同工作：

```javascript
async someMethod() {
  // 列出所有可用的 Provider
  const providers = this.ctx.getProviders();
  // 返回: [{ instanceId, providerId, displayName, status, isPrimary }, ...]

  // 调用主 LLM（使用 'primary' 快捷方式）
  const mainResponse = await this.ctx.callProvider('primary', {
    messages: [{ role: 'user', content: '你好' }],
    systemPrompt: '你是一个助手',
  });
  this.ctx.logger.info(`主 LLM 回复: ${mainResponse.text}`);

  // 调用指定 Provider 实例
  const secondaryProvider = providers.find(p => !p.isPrimary && p.status === 'active');
  if (secondaryProvider) {
    const response = await this.ctx.callProvider(secondaryProvider.instanceId, {
      messages: [{ role: 'user', content: '请总结以下内容...' }],
      maxTokens: 500,
    });
  }
}
```

> **注意**：`callProvider()` 在 Provider 未初始化时会自动尝试初始化。如果初始化失败会抛出异常，请用 try-catch 处理。

### 工具定义 (ToolSchema)

完全遵循 OpenAI 的 Function Calling 格式：

```typescript
interface ToolSchema {
  name: string;        // 工具名（需唯一，建议蛇形命名）
  description: string; // 工具功能的清晰描述（对 LLM 非常重要）
  parameters: {        // JSON Schema 格式参数定义
    type: 'object';
    properties: { ... };
    required: string[];
  };
}
```

### 工具处理函数 (ToolHandler)

```typescript
type ToolHandler = (args: Record<string, any>) => Promise<ToolResult>;

interface ToolResult {
  content: string;           // 返回给 LLM 的文本结果
  success: boolean;          // 执行是否成功
  data?: Record<string, any>; // 可选的结构化数据
}

// 简写：如果只返回字符串，框架会自动封装为 ToolResult
```

---

## 配置系统

Agent 插件支持零代码生成 UI 配置面板。只需提供 schema 文件，前端会自动生成配置表单。

### _conf_schema.json 规范

```json
{
  "apiKey": {
    "type": "string",
    "description": "天气服务 API Key",
    "default": ""
  },
  "defaultCity": {
    "type": "string",
    "description": "默认查询城市",
    "default": "Beijing"
  },
  "refreshInterval": {
    "type": "number",
    "description": "自动刷新间隔 (分钟)",
    "default": 30
  },
  "enableAlerts": {
    "type": "boolean",
    "description": "开启天气预警通知",
    "default": true
  },
  "provider": {
    "type": "select",
    "description": "数据源提供商",
    "default": "openweathermap",
    "options": [
      { "value": "openweathermap", "label": "OpenWeatherMap" },
      { "value": "qweather", "label": "和风天气" }
    ]
  }
}
```

### 使用配置

在代码中通过 `this.ctx.getConfig()` 读取：

```javascript
async initialize() {
  const config = this.ctx.getConfig();
  this.apiKey = config.apiKey;
  
  if (!this.apiKey) {
    this.ctx.logger.warn("未设置 API Key，插件可能无法正常工作");
  }
}
```

用户修改配置后，插件可通过监听机制（如有需要可自行实现轮询或在对应操作时实时读取）响应变化。

---

## 数据存储

插件的所有数据应存储在 `this.ctx.getDataPath()` 返回的目录中，而不是插件源码目录。由于安全策略，源码目录在打包后可能是只读的。

- **配置**: `config.json` (由框架自动管理)
- **数据**: `data/` (插件自由使用)

---

## TypeScript 开发建议

推荐使用 TypeScript 开发插件。可以创建一个简单的 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

编译后将 `dist/main.js` 作为入口文件。

## 常见问题

### Q: 插件如何打日志？
A: 使用 `this.ctx.logger.info()` 等方法。日志会自动带上 `[Plugin:你的插件名]` 前缀，并记录到应用主日志文件中。

### Q: 如何调试？
A: 可以在开发模式下启动应用 (`npm run dev`)，插件的日志会输出到终端。你也可以在 `initialize` 中添加断点（使用 VS Code 附加到主进程调试）。

### Q: 插件可以引用 Electron 模块吗？
A: 可以。因为插件运行在主进程中，你可以使用 `require('electron')` 访问 `app`, `BrowserWindow` 等 API，但通过 Agent 接口操作更为推荐和安全。

### Q: 如何实现插件间通信？
A: 使用 `this.ctx.getPluginInstance('目标插件名')` 获取其他已激活插件的实例，然后直接调用其公开方法。注意：目标插件必须已经激活，可通过 `dependencies` 字段确保依赖顺序。

---

## 自动激活与依赖管理

### 自动激活

在 `metadata.json` 中设置 `autoActivate: true`，插件将在应用启动时自动激活，无需用户手动操作。

### 依赖声明

通过 `dependencies` 数组声明依赖的其他插件。系统使用**拓扑排序**确保依赖插件在当前插件之前激活：

```json
{
  "name": "core-agent",
  "autoActivate": true,
  "dependencies": ["personality", "memory", "protocol-adapter", "plugin-tool-bridge"]
}
```

如果存在循环依赖，系统会检测并记录警告，跳过相关插件的自动激活。

---

## 插件间服务调用

插件可以通过 `ctx.getPluginInstance()` 获取其他已激活插件的实例，直接调用其公开方法，实现服务化协作。

### 示例：core-agent 如何使用 personality 插件

```javascript
class CoreAgentPlugin extends AgentPlugin {
  personality = null;
  memory = null;

  async initialize() {
    // 获取依赖插件实例
    this.personality = this.ctx.getPluginInstance('personality');
    this.memory = this.ctx.getPluginInstance('memory');

    if (!this.personality || !this.memory) {
      throw new Error('缺少必要的依赖插件');
    }
  }

  async onUserInput(mctx) {
    // 使用 personality 插件构建系统提示词
    const systemPrompt = this.personality.buildSystemPrompt();

    // 使用 memory 插件获取上下文消息
    const messages = this.memory.buildContextMessages(
      mctx.sessionId,
      this.ctx.getSessions(),
      this.ctx.getPrimaryProviderId()
    );

    // 调用 LLM
    const response = await this.ctx.executeWithToolLoop({
      messages,
      systemPrompt,
      sessionId: mctx.sessionId
    }, mctx);

    return true;
  }
}
```

### executeWithToolLoop

`ctx.executeWithToolLoop(request, mctx)` 封装了完整的工具循环逻辑：

1. 发送请求到主 LLM
2. 如果 LLM 返回 `tool_calls` → 执行工具 → 将结果追加到消息 → 回到步骤 1
3. 如果 LLM 返回文本 → 结束循环，返回最终响应

最大迭代次数为 10，超过后自动终止并返回提示。

---

## 前端插件状态同步

当前端插件通过 WebSocket 连接或断开时，`PluginConnector` 会自动发送 `plugin_status` 消息到后端 Agent，通知当前已连接的前端插件列表。

后端 `AgentHandler` 收到后，会调用 handler 插件的 `registerConnectedPlugins()` 方法，`core-agent` 会将其传递给 `plugin-tool-bridge` 插件，将前端插件能力注册为 Function Calling 工具。

```
前端 PluginConnector → plugin_status → AgentHandler → core-agent → plugin-tool-bridge → 注册工具
```

---

## Handler 插件开发

Handler 插件是一种特殊的 Agent 插件，它可以拦截并替换 `AgentHandler` 的核心消息处理逻辑（如 `user_input`、`tap_event`）。

### 标记为 Handler 插件

在 `metadata.json` 中设置 `handlerPlugin: true`：

```json
{
  "name": "my-custom-agent",
  "author": "NyaDev",
  "desc": "自定义 Agent 行为",
  "version": "1.0.0",
  "entry": "main.js",
  "handlerPlugin": true
}
```

### 消息处理钩子

Handler 插件可以实现以下钩子方法，返回 `true` 表示已处理（handler 跳过默认逻辑），返回 `false` 则 handler 继续执行默认逻辑：

```javascript
class MyAgent extends AgentPlugin {
  // 处理用户文本输入
  async onUserInput(mctx) {
    const text = mctx.message.text;
    // 自定义处理逻辑...
    mctx.addReply({ type: 'dialogue', data: { text: '回复', duration: 3000 } });
    return true; // 已处理
  }

  // 处理触碰事件
  async onTapEvent(mctx) {
    const hitArea = mctx.message.data?.hitArea;
    // 自定义反应...
    return true;
  }

  // 处理模型信息更新
  onModelInfo(mctx) {
    const modelInfo = mctx.message.data;
    // 同步模型能力信息...
    return true;
  }

  // 处理角色信息更新
  onCharacterInfo(mctx) {
    const characterInfo = mctx.message.data;
    // 同步角色人设...
    return true;
  }
}
```

### MessageContext

钩子方法接收 `MessageContext` 对象，提供消息处理所需的操作：

| 属性/方法 | 说明 |
|-----------|------|
| `message` | 原始消息对象（含 `type`, `text`, `data`） |
| `sessionId` | 当前会话 ID |
| `addReply(msg)` | 添加回复到缓冲（Respond 阶段统一发送） |
| `send(msg)` | 立即发送消息（用于流式场景如 TTS） |
| `ws` | WebSocket 连接引用 |

### 注意事项

- 同一时间只能有一个 Handler 插件处于激活状态
- Handler 插件的钩子优先于 handler 默认逻辑执行
- 如果 Handler 插件的钩子返回 `false`，handler 会执行默认逻辑作为回退
- 内置 `core-agent` 插件是默认的 Handler 插件，提供完整的桌宠 Agent 能力
