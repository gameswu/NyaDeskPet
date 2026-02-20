# Renderer & Other Modules

This document covers the renderer process modules of NyaDeskPet, as well as other development-related topics including ASR service, version management, and platform optimization.

## Table of Contents
- [Renderer \& Other Modules](#renderer--other-modules)
  - [Table of Contents](#table-of-contents)
  - [Renderer Modules](#renderer-modules)
    - [Live2D Manager](#live2d-manager)
    - [Backend Communication Client](#backend-communication-client)
    - [Audio Player](#audio-player)
    - [Dialogue Manager](#dialogue-manager)
    - [Settings Manager](#settings-manager)
    - [Plugin System](#plugin-system)
    - [Internationalization System](#internationalization-system)
    - [Theme Manager](#theme-manager)
    - [Camera Manager](#camera-manager)
    - [Microphone Manager](#microphone-manager)
    - [Response Priority Control](#response-priority-control)
  - [ASR Service](#asr-service)
  - [Version Management](#version-management)
  - [Development Scripts](#development-scripts)
  - [Platform Optimization](#platform-optimization)
    - [Windows GPU Rendering](#windows-gpu-rendering)
  - [Tech Stack](#tech-stack)
  - [Adding New Modules](#adding-new-modules)

---

## Renderer Modules

### Live2D Manager

- Model loading, motion/expression/parameter control
- **Parameter mapping table** (`param-map.json`): Reads semantic alias mappings from model directory, builds LLM-friendly model info
- **Parameter animation system**: Three-phase lifecycle (transition → hold → fade-out release), auto-calculates transition duration
  - Transition duration linearly mapped from `|Δvalue| / paramRange` to 200~900ms
  - Holds for 2000ms then smoothly hands back SDK control via 500ms weight decay
  - All parameter animations persistently injected each frame via `beforeModelUpdate` event hook
- Gaze tracking (mouse coordinates → model coordinate mapping, auto-suppressed during parameter animation)
- Scroll wheel zoom (0.3x ~ 3.0x)
- Touch system (per-model configurable enable/disable for each hit area)
- Lip sync (Web Audio API AnalyserNode, 30 FPS update of `ParamMouthOpenY`)
- Auto-sends `model_info` message after model load (including mapping info)

### Backend Communication Client

- WebSocket real-time communication + HTTP fallback
- Auto-reconnect mechanism
- Streaming dialogue text accumulation and UI sync
- Plugin call forwarding (`plugin_invoke` → PluginConnector → `plugin_response`)

### Audio Player

- MSE (MediaSource Extensions) streaming playback
- Three-phase audio transport: `audio_stream_start` → `audio_chunk` × N → `audio_stream_end`
- Timeline system: Triggers motions/expressions/parameters at progress percentages
- Lip sync: Real-time frequency analysis driving mouth parameters

### Dialogue Manager

- Dialogue bubble display and auto-hide
- Subtitle mode (bottom overlay when chat window is closed)

### Settings Manager

- localStorage persistence
- Configuration items: model path, backend URL, auto-connect, volume, character customization, etc.
- Two-way binding with settings panel
- Character customization (name + persona) auto-sent on connection

### Plugin System

- **PluginConnector**: Scans plugins directory metadata, manages plugin process start/stop and WebSocket connections
- **PluginUI**: Plugin management panel card rendering
- **PluginConfigManager / PluginConfigUI**: Config read/write + dynamic form rendering (9 config types: string / text / int / float / bool / object / list / dict / template_list)
- **PluginPermissionManager**: 5-level danger rating permission approval, permission records persisted

Frontend plugin file structure:
```
plugins/terminal-plugin/
  ├── metadata.json     # Metadata (id, url, command, permissions, i18n)
  ├── config.json       # Config Schema
  ├── main.py           # Plugin main program
  └── requirements.txt  # Dependencies
```

### Internationalization System

- `data-i18n` attribute auto-binding
- `window.i18nManager.t(key)` code invocation
- Language packs: `zh-CN.json`, `en-US.json`
- Auto-detects system language, supports manual switching

### Theme Manager

- Three modes: `light` / `dark` / `system`
- Switches via `body` class name + CSS variables

### Camera Manager

- Lazy initialization, only requests permission when used
- Device enumeration and selection
- Real-time preview window (240px)
- Auto-captures frame as Base64 when sending messages

### Microphone Manager

- Lazy initialization
- Real-time volume detection + silence detection (1.5s auto-stop recording)
- MediaRecorder API records WebM
- ASR integration (IPC call to main process Sherpa-ONNX)
- Background mode support

### Response Priority Control

- High-priority messages can interrupt low-priority streaming output
- Ensures user input always receives timely response

---

## ASR Service

Offline speech recognition in the main process:

- **Model**: Sherpa-ONNX Sense-Voice-Small (Chinese, English, Japanese, Korean, Cantonese)
- **Pipeline**: Base64 audio → FFmpeg convert to 16kHz WAV → PCM Float32 → Recognition
- **IPC**: `asr-initialize` / `asr-is-ready` / `asr-recognize`
- **Model path**: `models/asr/sense-voice-small/model.onnx` + `tokens.txt`

---

## Version Management

```bash
npm run version release 1.0.0   # Release → v1.0.0
npm run version beta 1.0.0      # Dev build → v1.0.0-beta-YYMMDDHHMM
npm run version hotfix 1.0.0    # Hotfix → v1.0.0-hotfix-YYMMDDHHMM
npm run version patch           # Patch +1
npm run version minor           # Minor +1
npm run version major           # Major +1
```

Automatically updates package.json version and creates version.json.

---

## Development Scripts

| Command | Description |
|---------|-------------|
| `npm run check-i18n` | Validates zh-CN / en-US key consistency |
| `npm run migrate-logger:preview` | Preview console → logger migration |
| `npm run migrate-logger` | Execute migration (excludes logger.ts itself) |
| `npm run version` | Generate version.json (version + build time) |
| `npm run check-live2d` | Validate param-map.json mapping completeness for Live2D models in models/ |

---

## Platform Optimization

### Windows GPU Rendering

Windows + NVIDIA GPUs may encounter GPU compatibility issues. Implemented optimizations:

- Main process: Disable GPU sandbox, use ANGLE/D3D11, limit VRAM to 2GB
- PixiJS: `powerPreference: 'high-performance'`, `preserveDrawingBuffer: false`
- Frame rate limit: 60 FPS on Windows

If issues persist, call `app.disableHardwareAcceleration()` before `app.whenReady()` to completely disable hardware acceleration.

---

## Tech Stack

| Component | Version/Technology |
|-----------|-------------------|
| Electron | 28.0 |
| TypeScript | 5.3 |
| PixiJS | 7.3 |
| Live2D | Cubism SDK for Web |
| SQLite | better-sqlite3 |
| ASR | Sherpa-ONNX v1.6 |
| Icons | Lucide Icons |
| Audio Conversion | FFmpeg (system dependency) |

---

## Adding New Modules

1. Create `.ts` file in js directory
2. Define interfaces and `Window` extensions in global.d.ts
3. Include compiled `.js` in index.html
4. Initialize in `renderer.ts` startup logic
