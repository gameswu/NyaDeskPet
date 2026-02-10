# NyaDeskPet - Electron + Live2D 桌面宠物项目

## 项目文档

**主文档**：README.md

**核心文档库**：
- `docs/API.md`：API 接口规范与通信协议
- `docs/USAGE.md`：用户指南、安装说明、打包与故障排除
- `docs/DEVELOPMENT.md`：架构设计、核心逻辑深度解析

**文档原则**：严禁在 `docs/` 目录下创建新文档。所有更新必须在上述三个现有文档（或 README.md）中进行修改和扩展。

## 项目概述

跨平台桌面宠物应用，使用 Electron + Live2D + TypeScript，通过 WebSocket 与后端 Agent 服务器实时通信。

## 技术栈

- **前端框架**：Electron 28.0
- **开发语言**：TypeScript 5.3
- **渲染引擎**：PixiJS 7.3
- **Live2D**：Cubism SDK for Web
- **通信**：WebSocket（实时通信）
- **音频**：MediaSource Extensions（MSE 流式播放）
- **语音识别**：Sherpa-ONNX（本地 ASR）

## 架构设计

### 主要进程

- **主进程**：Electron（src/main.ts → dist/main.js）
- **预加载**：安全的 IPC 桥接（src/preload.ts → dist/preload.js）

### 渲染进程模块

- **Live2D 管理器**（renderer/js/live2d-manager.ts）
  - 模型渲染、动作、表情、参数控制
  - 视线跟随、触碰交互
  
- **后端通信客户端**（renderer/js/backend-client.ts）
  - WebSocket 消息处理
  - HTTP 请求处理
  
- **对话管理器**（renderer/js/dialogue-manager.ts）
  - 文字对话显示
  - 对话历史记录
  
- **音频播放器**（renderer/js/audio-player.ts）
  - 流式音频播放
  - 时间轴同步
  - 口型同步
  
- **设置管理器**（renderer/js/settings-manager.ts）
  - 配置持久化
  - 设置验证
  
- **主协调脚本**（renderer/js/renderer.ts）
  - 初始化与事件协调

### 类型定义

- `renderer/types/global.d.ts`：全局接口和类型定义

## 核心特性

### Live2D 控制系统

**预设系统**：
- 动作（motion）：需模型文件预定义的动画序列
- 表情（expression）：需模型文件预定义的表情状态

**参数直接控制**：
- Agent 可通过 `setParameter()` 直接控制任意参数
- 支持控制眼睛、嘴巴、头部旋转、眉毛等
- 不依赖预设文件，可自由组合创造表情

**交互功能**：
- 视线跟随：鼠标移动时模型眼睛自动跟随，可在设置中开关
- 触碰反应：点击模型的 hitArea 触发事件，由后端 Agent 决定反应
- 滚轮缩放：支持 0.3x - 3.0x 的缩放范围

### 流式音频系统

**MSE 流式播放**：
- 使用 MediaSource Extensions
- 边接收边播放，减少延迟

**分片传输**：
- `audio_stream_start`：开始传输
- 多个 `audio_chunk`（Base64）：音频数据分片
- `audio_stream_end`：结束传输

**口型同步**：
- 实时分析音频频率
- 自动更新模型嘴巴参数
- 30 FPS 更新频率

**时间轴同步**：
- 支持在音频播放过程中触发动作/表情/参数变化
- 语义标记：`start`（0%）、`early`（15%）、`middle`（50%）、`late`（85%）、`end`（98%）
- 百分比：0-100 数字，精确控制触发时机

### 本地语音识别

**引擎**：Sherpa-ONNX（纯本地，无需联网）

**流程**：
1. 用户语音输入
2. 本地转文字
3. 通过 WebSocket 发送给后端 Agent

**隐私保护**：
- 语音数据不上传
- 完全本地处理

## 快速开始

```bash
npm install              # 安装依赖
npm run compile          # 编译 TypeScript
npm run dev:mac          # macOS 开发模式
npm run dev:linux        # Linux 开发模式
npm run dev:win          # Windows 开发模式
```

## 文件结构

```
src/              - TypeScript 源码（主进程）
dist/             - 编译输出（主进程）
renderer/
  ├── js/         - TypeScript 源码和编译输出（渲染进程）
  │   ├── settings-manager.ts/js    - 设置管理器
  │   ├── live2d-manager.ts/js      - Live2D 管理器
  │   ├── backend-client.ts/js      - 后端通信客户端
  │   ├── dialogue-manager.ts/js    - 对话管理器
  │   ├── audio-player.ts/js        - 流式音频播放器
  │   └── renderer.ts/js            - 主协调脚本
  ├── types/      - 全局类型定义
  ├── index.html  - 主页面
  └── styles.css  - 样式
docs/             - 项目文档
  ├── API.md      - WebSocket 消息协议规范
  ├── USAGE.md    - 用户使用说明
  └── DEVELOPMENT.md - 开发详细说明
models/           - Live2D 模型文件
assets/           - 资源文件
```

## 消息协议

### 前端 → 后端

- **user_input**：用户文字/语音输入
- **model_info**：模型加载后自动发送可用参数、动作、表情列表
- **tap_event**：模型触碰事件（hitArea + 坐标）
- **character_info**：角色人设信息（用户自定义）

### 后端 → 前端

- **dialogue**：文字对话
- **audio_stream_start/chunk/end**：流式音频传输
- **live2d**：动作/表情/参数控制
- **sync_command**：组合指令（同时执行多个动作）

**详细协议**：见 [docs/API.md](../docs/API.md)

## 开发注意事项

### 类型定义
- 类型定义统一在 `renderer/types/global.d.ts` 中维护
- 新增接口需同步更新类型定义

### 编译
- 所有 TypeScript 文件需编译后才能运行
- 修改主进程代码（src/）需重启 Electron
- 修改渲染进程代码（renderer/js/）可热重载

### 消息处理
- 新增消息类型需同步更新 `BackendMessage` 类型定义
- 在 `backend-client.ts` 的 `handleMessage` 方法中添加处理逻辑

### 视线跟随实现
- 使用 `pixi-live2d-display` 库的 `focus()` 方法
- `focus(x, y)` 接受世界空间的像素坐标
- 鼠标坐标计算：`cursorPos - windowPos - rect.offset`
- 关闭视线跟随时，通过 `focusController.focus(0, 0, true)` 重置

### 设备管理
- 摄像头和麦克风采用延迟初始化
- 避免应用启动时立即请求权限
- 只在用户主动使用时才连接设备
