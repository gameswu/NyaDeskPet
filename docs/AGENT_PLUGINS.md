# 内置 Agent 插件开发指南

本文档介绍如何为 NyaDeskPet 的内置 Agent 开发插件。与普通的前端插件（扩展 UI 和 Electron 进程功能）不同，**Agent 插件**直接扩展 LLM（大语言模型）的能力，使其能够调用自定义工具（Tools）完成各种复杂任务。

## 架构概述

Agent 插件运行在 Electron 的 **主进程** 中，基于 `AgentPlugin` 基类开发。它允许你：

1. **注册工具 (Tools)**：通过 `Function Calling` 机制供 LLM 调用
2. **管理生命周期**：包含加载、激活、停用、卸载等钩子
3. **持久化数据**：拥有独立的配置存储和数据目录
4. **访问上下文**：使用日志、配置管理等基础设施

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
  "entry": "main.js"
}
```

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
