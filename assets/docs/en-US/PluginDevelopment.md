# Plugin Development

NyaDeskPet provides two plugin mechanisms for different extension scenarios.

## Table of Contents
- [Plugin Development](#plugin-development)
  - [Table of Contents](#table-of-contents)
  - [Plugin Type Comparison](#plugin-type-comparison)
  - [How to Choose](#how-to-choose)
  - [Quick Start](#quick-start)
    - [Agent Plugin](#agent-plugin)
    - [Frontend Plugin](#frontend-plugin)
  - [More Resources](#more-resources)

---

## Plugin Type Comparison

| Feature | Agent Plugin | Frontend Plugin |
|---------|-------------|----------------|
| Runtime Location | Inside main process | Independent process |
| Language | JavaScript (CommonJS) | Any language |
| Communication | Direct function calls | WebSocket |
| Capabilities | Register tools, commands, intercept messages | Terminal/file/UI operations |
| Security Model | Same privileges as main process | Sandbox + permission approval |
| Use Case | Extend AI reasoning and tool capabilities | Extend system operation capabilities |

---

## How to Choose

**Choose Agent Plugin** if you want to:
- Register new Function Calling tools for AI to use
- Register slash commands
- Modify the AI's system prompt or message processing flow
- Intercept and customize message handling (Handler plugin)

**Choose Frontend Plugin** if you want to:
- Perform system operations (terminal commands, file read/write)
- Do UI automation (mouse/keyboard simulation)
- Develop in a non-JavaScript language
- Run in an isolated process

---

## Quick Start

### Agent Plugin

Minimal directory structure:

```
agent-plugins/my-plugin/
├── metadata.json     ← Plugin metadata
└── main.js           ← Entry file (CommonJS)
```

```json
// metadata.json
{
  "name": "my-plugin",
  "author": "Your Name",
  "desc": "Plugin description",
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
      description: 'Tool description',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input content' }
        },
        required: ['input']
      }
    }, async (args) => {
      return { content: `Result: ${args.input}`, success: true };
    });
  }
}

module.exports = MyPlugin;
```

Detailed guide: **[Agent Plugin Development](AgentPluginDevelopment.md)**

---

### Frontend Plugin

Minimal directory structure:

```
plugins/my-plugin/
├── metadata.json     ← Plugin metadata
└── main.py           ← Main program
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

Detailed guide: **[Frontend Plugin Development](FrontendPluginDevelopment.md)**

---

## More Resources

- [API Reference](API.md) — Complete message protocol specification
- [Developer Guide](DEVELOPMENT.md) — Project architecture and development workflow