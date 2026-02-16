# Change Log

## Table of Contents
- [Change Log](#change-log)
  - [Table of Contents](#table-of-contents)
  - [1.0.1 - 2026.02.17](#101---20260217)
    - [✨ Features](#-features)
    - [🐛 Bug Fixes](#-bug-fixes)
    - [🔧 Changes](#-changes)
  - [1.0.0 - 2026.02.15](#100---20260215)

## 1.0.1 - 2026.02.17
### ✨ Features
- Added ASR model selection functionality, allowing users to choose different speech recognition models in the settings panel
- Microphone icon appears grayed out in the dialogue UI when ASR model is unavailable, with error prompts provided
- Added application help documentation, accessible via the settings panel
- Frontend plugins now include document read/write tools, enabling plugins to read and write document content
- Built-in Agent now supports [Agent Skills](https://claudecn.com/docs/agent-skills/), providing skill registration, invocation, and management capabilities

### 🐛 Bug Fixes
- Fixed resource packaging path issues

### 🔧 Changes
- Updated command logic in the built-in Agent info plugin
- Refactored the built-in Agent bridge plugin to dynamically parse frontend plugin-registered tools, supporting more complex use cases
- Improved styling and interaction of the tool approval window with collapsible details for lengthy information
- Enhanced content and styling of project links, donation support, and help documentation cards

## 1.0.0 - 2026.02.15
🎉 **Official Release** of NyaDeskPet 1.0.0 — Open source and free, with support for Windows/macOS/Linux