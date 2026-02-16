# Agent Plugin Development

Agent plugins run in the Electron main process and can register tools, commands, or fully take over the message processing flow.

## Table of Contents
- [Agent Plugin Development](#agent-plugin-development)
  - [Table of Contents](#table-of-contents)
  - [Plugin Types](#plugin-types)
  - [Directory Structure](#directory-structure)
  - [metadata.json](#metadatajson)
  - [Basic Plugin](#basic-plugin)
    - [Extend AgentPlugin](#extend-agentplugin)
    - [Register Tools](#register-tools)
    - [Register Slash Commands](#register-slash-commands)
  - [Handler Plugin](#handler-plugin)
    - [Declare as Handler](#declare-as-handler)
    - [Implement Message Hooks](#implement-message-hooks)
  - [Plugin Context (this.ctx)](#plugin-context-thisctx)
    - [General Capabilities](#general-capabilities)
    - [Provider Operations](#provider-operations)
    - [Handler-Only](#handler-only)
  - [MessageContext](#messagecontext)
  - [Tool Loop](#tool-loop)
  - [Configuration System](#configuration-system)
    - [\_conf\_schema.json](#_conf_schemajson)
    - [Read and Write Config](#read-and-write-config)
  - [Logging](#logging)
  - [Dependency Management](#dependency-management)
  - [Complete Example](#complete-example)

---

## Plugin Types

| Type | Description | Use Case |
|------|-------------|----------|
| Regular Plugin | Register tools and commands for LLM to call | Most extension needs |
| Handler Plugin | Intercept core message processing flow | Custom conversation flow, replace core logic |

---

## Directory Structure

```
agent-plugins/my-plugin/
├── metadata.json        ← Required: Plugin metadata
├── main.js              ← Required: Entry file (CommonJS)
└── _conf_schema.json    ← Optional: Configuration template
```

---

## metadata.json

```json
{
  "name": "my-plugin",
  "author": "Your Name",
  "desc": "Plugin description",
  "version": "1.0.0",
  "repo": "https://github.com/...",
  "entry": "main.js",
  "handlerPlugin": false,
  "autoActivate": true,
  "dependencies": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Plugin name (unique identifier) |
| `author` | string | | Author |
| `desc` | string | | Description |
| `version` | string | | Version number |
| `repo` | string | | Repository URL |
| `entry` | string | | Entry file, defaults to `main.js` |
| `handlerPlugin` | boolean | | Whether this is a Handler plugin |
| `autoActivate` | boolean | | Auto-activate after loading |
| `dependencies` | string[] | | Names of other plugins this depends on |

---

## Basic Plugin

### Extend AgentPlugin

```javascript
const { AgentPlugin } = require('../_base');

class MyPlugin extends AgentPlugin {
  async initialize() {
    // Plugin initialization — register tools and commands
  }

  async terminate() {
    // Clean up resources when plugin is unloaded
  }
}

module.exports = MyPlugin;
```

### Register Tools

```javascript
async initialize() {
  this.ctx.registerTool({
    name: 'my_tool',
    description: 'Tool description',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query content' },
        limit: { type: 'number', description: 'Maximum results' }
      },
      required: ['query']
    }
  }, async (args) => {
    // args are the parameters passed by the LLM
    const result = await doSomething(args.query, args.limit);
    return {
      content: result,    // Text result
      success: true,      // Whether successful
      // images: [...],   // Optional: image data
      // data: {...}       // Optional: structured data
    };
  });
}
```

Tool parameters are defined using JSON Schema format. After registration, the tool automatically appears in the AI's available tool list.

### Register Slash Commands

```javascript
async initialize() {
  this.ctx.registerCommand({
    name: 'hello',
    description: 'Say hello',
    params: [
      {
        name: 'name',
        description: 'Name',
        type: 'string',
        required: false
      }
    ]
  }, async (args, msgCtx) => {
    const name = args.name || 'World';
    msgCtx.addReply({
      type: 'dialogue',
      text: `Hello, ${name}!`
    });
  });
}
```

---

## Handler Plugin

Handler plugins can fully take over message processing, with higher priority than the default Handler.

### Declare as Handler

Set in `metadata.json`:

```json
{
  "handlerPlugin": true
}
```

### Implement Message Hooks

```javascript
class MyHandler extends AgentPlugin {
  // User text message
  async onUserInput(text, msgCtx) {
    // Return true to indicate handled, preventing subsequent Handlers
    msgCtx.addReply({
      type: 'dialogue',
      text: `You said: ${text}`
    });
    return true;
  }

  // Touch event
  async onTapEvent(hitArea, position, msgCtx) {
    return false; // Return false to pass to default Handler
  }

  // File upload
  async onFileUpload(fileData, msgCtx) {
    return false;
  }

  // Plugin message
  async onPluginMessage(pluginId, content, msgCtx) {
    return false;
  }

  // Model info update
  async onModelInfo(modelInfo, msgCtx) {
    return false;
  }

  // Character info update
  async onCharacterInfo(characterInfo, msgCtx) {
    return false;
  }
}
```

---

## Plugin Context (this.ctx)

### General Capabilities

| Method | Description |
|--------|-------------|
| `registerTool(schema, handler)` | Register an FC tool |
| `unregisterTool(name)` | Unregister a tool |
| `registerCommand(def, handler)` | Register a slash command |
| `logger` | Logger object (`.debug()` / `.info()` / `.warn()` / `.error()`) |
| `getConfig()` | Read plugin configuration |
| `saveConfig(config)` | Save plugin configuration |
| `getDataPath()` | Get plugin data directory |
| `getPluginInstance(name)` | Get another plugin instance |

### Provider Operations

| Method | Description |
|--------|-------------|
| `getProviders()` | Get all LLM Provider info |
| `getPrimaryProviderId()` | Get primary Provider instance ID |
| `callProvider(instanceId, request)` | Call a specific Provider for LLM inference |

### Handler-Only

The following methods are only available in Handler plugins:

| Method | Description |
|--------|-------------|
| `getSessions()` | Get SessionManager |
| `getModelInfo()` | Get current model info |
| `getCharacterInfo()` | Get character persona |
| `synthesizeAndStream(text, ws)` | TTS synthesis and streaming send |
| `hasTTS()` | Whether TTS is available |
| `getPluginInvokeSender()` | Get plugin invoke sender |
| `isToolCallingEnabled()` | Whether tool calling is enabled |
| `getOpenAITools()` | Get OpenAI-format tool list |
| `hasEnabledTools()` | Whether there are enabled tools |
| `executeWithToolLoop(request, msgCtx, options)` | Execute tool loop |

---

## MessageContext

Message processing context for sending replies to the frontend.

```javascript
// Add reply (batch-sent in RespondStage)
msgCtx.addReply({
  type: 'dialogue',
  text: 'Reply content'
});

// Send immediately (bypasses batch sending)
msgCtx.send({
  type: 'live2d',
  action: 'expression',
  expressionIndex: 1
});

// Get message and session info
msgCtx.message;    // Original message
msgCtx.sessionId;  // Current session ID
msgCtx.ws;         // WebSocket connection
```

---

## Tool Loop

Handler plugins can use `executeWithToolLoop()` to implement AI → tool call → AI loop reasoning:

```javascript
async onUserInput(text, msgCtx) {
  const request = {
    messages: [{ role: 'user', content: text }],
    systemPrompt: 'You are an assistant...',
    tools: this.ctx.getOpenAITools()
  };

  await this.ctx.executeWithToolLoop(request, msgCtx, {
    maxIterations: 10,      // Maximum iterations
    streamResponse: true    // Streaming output
  });

  return true;
}
```

---

## Configuration System

### _conf_schema.json

```json
{
  "greeting": {
    "type": "string",
    "description": "Default greeting",
    "default": "Hello!"
  },
  "maxResults": {
    "type": "number",
    "description": "Maximum results",
    "default": 10
  },
  "enabled": {
    "type": "boolean",
    "description": "Whether enabled",
    "default": true
  },
  "mode": {
    "type": "select",
    "description": "Operating mode",
    "default": "auto",
    "options": ["auto", "manual", "disabled"]
  }
}
```

### Read and Write Config

```javascript
const config = this.ctx.getConfig();
console.log(config.greeting);  // "Hello!"

this.ctx.saveConfig({ ...config, maxResults: 20 });
```

---

## Logging

Use `this.ctx.logger` for logging:

```javascript
this.ctx.logger.debug('Debug message');
this.ctx.logger.info('Info message');
this.ctx.logger.warn('Warning');
this.ctx.logger.error('Error');
```

> [!WARNING]
> Do not use `console.log` — always use `logger`.

---

## Dependency Management

Declare dependencies in `metadata.json`:

```json
{
  "dependencies": ["personality", "memory"]
}
```

- Dependent plugins are initialized before the current plugin
- Use `this.ctx.getPluginInstance('personality')` to get dependent plugin instances

---

## Complete Example

An Agent plugin that provides a weather query tool:

```javascript
const { AgentPlugin } = require('../_base');

class WeatherPlugin extends AgentPlugin {
  async initialize() {
    // Register tool
    this.ctx.registerTool({
      name: 'get_weather',
      description: 'Query weather for a specified city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' }
        },
        required: ['city']
      }
    }, async (args) => {
      try {
        const weather = await this.fetchWeather(args.city);
        return { content: weather, success: true };
      } catch (e) {
        return { content: `Query failed: ${e.message}`, success: false };
      }
    });

    // Register command
    this.ctx.registerCommand({
      name: 'weather',
      description: 'Quick weather check',
      params: [{ name: 'city', type: 'string', required: true }]
    }, async (args, msgCtx) => {
      const weather = await this.fetchWeather(args.city);
      msgCtx.addReply({ type: 'dialogue', text: weather });
    });

    this.ctx.logger.info('Weather plugin loaded');
  }

  async fetchWeather(city) {
    // Actual weather query logic
    return `${city}: Sunny, 25°C`;
  }

  async terminate() {
    this.ctx.unregisterTool('get_weather');
  }
}

module.exports = WeatherPlugin;
```