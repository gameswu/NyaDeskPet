# Change Log

## Table of Contents
- [Change Log](#change-log)
  - [Table of Contents](#table-of-contents)
  - [1.0.2 - 2026.02.20](#102---20260220)
    - [✨ Features](#-features)
    - [🐛 Bug Fixes](#-bug-fixes)
    - [🔧 Changes](#-changes)
  - [1.0.1 - 2026.02.17](#101---20260217)
    - [✨ Features](#-features-1)
    - [🐛 Bug Fixes](#-bug-fixes-1)
    - [🔧 Changes](#-changes-1)
  - [1.0.0 - 2026.02.15](#100---20260215)

## 1.0.2 - 2026.02.20
### ✨ Features
- Update checker now provides a changelog preview when a new version is found, helping users understand the changes
- Frontend supports image/file reply rendering, with built-in Agent protocol adaptation
- Built-in Agent adds Planning plugin for LLM-based task planning, supporting multi-step task decomposition, execution, and Sub-Agent creation/management
- Built-in Agent adds Scheduler plugin for time-based task scheduling, supporting one-time and recurring tasks, with Planning plugin integration
- Built-in Agent adds Image Generation plugin for LLM-based image generation, supporting multiple image generation models with a unified interface
- Built-in Agent Provider module adds provider config retrieval interface for plugins to access detailed provider instance configuration
- Built-in Agent Provider module supports multimodal content (images/files) processing and delivery with a unified interface for plugins

### 🐛 Bug Fixes
- Fixed the issue where voice input was not displayed after automatic sending

### 🔧 Changes
- Merged personality settings and reply format rules in the built-in Agent Personality plugin into a single personality setting exposed to users, with a long text editor for easier editing
- All long text input fields now use VSCode's Monaco Editor component for better editing experience and syntax highlighting
- Unified configuration format between built-in Agent plugins and frontend plugins

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