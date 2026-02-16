# NyaDeskPet

<div align="center">
  <img src="../images/logo.png" alt="NyaDeskPet Logo" width="320"/>
  <p>Cross-platform desktop pet application powered by Live2D + AI Agent</p>
</div>

---

A fully open-source, modular desktop pet framework with Live2D interaction and a built-in AI Agent. Ready to use out of the box, yet highly customizable. Contributions of plugins, models, and features are welcome!

## Features

### 🎭 AI-Driven Live2D Model

- Transparent borderless window — the pet blends naturally into your desktop
- AI-driven expressions and motions for rich, lively interactions
- Touch reaction system with per-region enable/disable controls
- TTS-driven lip sync & streaming audio playback

<details>
<summary>More demos</summary>
<div align="center">
  <img src="../images/demo-live2d-1.png" alt="Demo 1" width="320"/>
</div>
</details>

### 🤖 Built-in AI Agent

<div align="center">
  <table>
    <tr>
      <td align="center">Multiple mainstream model providers</td>
      <td align="center">Function tools & MCP management</td>
      <td align="center">Plugin architecture</td>
      <td align="center">Custom command management</td>
    </tr>
    <tr>
      <td align="center"><img src="../images/demo-agent-1.png" alt="Agent Demo 1" width="300"/></td>
      <td align="center"><img src="../images/demo-agent-2.png" alt="Agent Demo 2" width="300"/></td>
      <td align="center"><img src="../images/demo-agent-3.png" alt="Agent Demo 3" width="300"/></td>
      <td align="center"><img src="../images/demo-agent-4.png" alt="Agent Demo 4" width="300"/></td>
    </tr>
  </table>
</div>

### 🧩 Plugin System

<div align="center">
  <table>
    <tr>
      <td align="center">Full plugin management</td>
      <td align="center">Plugin authentication</td>
    </tr>
    <tr>
      <td align="center"><img src="../images/demo-plugin-1.png" alt="Plugin Demo 1" width="300"/></td>
      <td align="center"><img src="../images/demo-plugin-2.png" alt="Plugin Demo 2" width="300"/></td>
    </tr>
  </table>
</div>

<details>
<summary>Results of the demos above</summary>
<div align="center">
  <img src="../images/demo-plugin-3.png" alt="Plugin Result Demo" width="300"/>
  <img src="../images/demo-plugin-4.png" alt="Plugin Result Demo 2" width="300"/>
</div>
</details>

## Quick Start

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Development launch
npm run dev:mac
npm run dev:linux
npm run dev:win

# Build
npm run build:mac
npm run build:linux
npm run build:win
```

## Architecture

### Decoupled Architecture

The frontend and backend Agent are fully decoupled via WebSocket. The frontend handles only display and interaction, while the backend runs an independent Agent server. Any WebSocket client can connect.

<div align="center">
  <img src="../images/arch.png" alt="Architecture Diagram" width="600"/>
</div>

### Built-in Agent Architecture

The built-in Agent core uses a Pipeline-driven design. Message processing is divided into multiple stages (think, tool call, respond, etc.), with each stage supporting multiple Handler plugins for flexible Agent behavior customization.

<div align="center">
  <img src="../images/agent-arch.png" alt="Agent Architecture Diagram" width="600"/>
</div>

## Support

If you like this project, please give it a Star ⭐! For any questions or suggestions, feel free to submit an Issue or Pull Request.

Or 💗[Sponsor me](https://afdian.com/a/gameswu)💗

## License

MIT License
