# 渲染进程与其他模块

本文档介绍 NyaDeskPet 渲染进程的各个模块，以及 ASR 服务、版本管理、平台优化等其他开发相关内容。

## 目录
- [渲染进程与其他模块](#渲染进程与其他模块)
  - [目录](#目录)
  - [渲染进程模块](#渲染进程模块)
    - [Live2D 管理器](#live2d-管理器)
    - [后端通信客户端](#后端通信客户端)
    - [音频播放器](#音频播放器)
    - [对话管理器](#对话管理器)
    - [设置管理器](#设置管理器)
    - [插件系统](#插件系统)
    - [国际化系统](#国际化系统)
    - [主题管理器](#主题管理器)
    - [摄像头管理器](#摄像头管理器)
    - [麦克风管理器](#麦克风管理器)
    - [响应优先级控制](#响应优先级控制)
  - [ASR 服务](#asr-服务)
  - [版本管理](#版本管理)
  - [开发辅助脚本](#开发辅助脚本)
  - [平台优化](#平台优化)
    - [Windows GPU 渲染](#windows-gpu-渲染)
  - [技术栈](#技术栈)
  - [添加新模块](#添加新模块)

---

## 渲染进程模块

### Live2D 管理器

- 模型加载、动作/表情/参数控制
- **参数映射表**（`param-map.json`）：从模型目录读取语义别名映射，构建 LLM 友好的模型信息
- **参数动画系统**：三阶段生命周期（过渡 → 保持 → 淡出释放），自动计算过渡时长
  - 过渡时长根据 `|Δvalue| / paramRange` 线性映射到 200~900ms
  - 保持 2000ms 后通过 500ms 权重衰减平滑交还 SDK 控制
  - 所有参数动画通过 `beforeModelUpdate` 事件钩子每帧持久注入
- 视线跟随（鼠标坐标 → 模型坐标映射，参数动画期间自动抑制）
- 滚轮缩放（0.3x ~ 3.0x）
- 触碰系统（可按模型独立配置各部位的启用/禁用）
- 口型同步（Web Audio API AnalyserNode，30 FPS 更新 `ParamMouthOpenY`）
- 模型加载后自动发送 `model_info` 消息（含映射信息）

### 后端通信客户端

- WebSocket 实时通信 + HTTP 回退
- 自动重连机制
- 流式对话文本积累与 UI 同步
- 插件调用转发（`plugin_invoke` → PluginConnector → `plugin_response`）

### 音频播放器

- MSE (MediaSource Extensions) 流式播放
- 三段式音频传输：`audio_stream_start` → `audio_chunk` × N → `audio_stream_end`
- 时间轴系统：按进度百分比触发动作/表情/参数
- 口型同步：实时频率分析驱动嘴巴参数

### 对话管理器

- 对话气泡显示与自动隐藏
- 字幕模式（聊天窗口关闭时底部浮现）

### 设置管理器

- localStorage 持久化
- 配置项：模型路径、后端 URL、自动连接、音量、角色自定义等
- 与设置面板双向绑定
- 角色自定义（名称 + 人设）连接时自动发送

### 插件系统

- **PluginConnector**：扫描 plugins 目录元数据，管理插件进程启停和 WebSocket 连接
- **PluginUI**：插件管理面板卡片渲染
- **PluginConfigManager / PluginConfigUI**：配置读写 + 动态表单渲染（9 种配置类型：string / text / int / float / bool / object / list / dict / template_list）
- **PluginPermissionManager**：5 级危险度权限审批，权限记录持久化

前端插件文件结构：
```
plugins/terminal-plugin/
  ├── metadata.json     # 元信息（id, url, command, permissions, i18n）
  ├── config.json       # 配置 Schema
  ├── main.py           # 插件主程序
  └── requirements.txt  # 依赖
```

### 国际化系统

- `data-i18n` 属性自动绑定
- `window.i18nManager.t(key)` 代码调用
- 语言包：zh-CN.json、`en-US.json`
- 自动检测系统语言，支持手动切换

### 主题管理器

- 三种模式：`light` / `dark` / `system`
- 通过 `body` 类名 + CSS 变量实现切换

### 摄像头管理器

- 延迟初始化，仅使用时请求权限
- 设备枚举与选择
- 实时预览窗口（240px）
- 发送消息时自动捕获画面为 Base64

### 麦克风管理器

- 延迟初始化
- 实时音量检测 + 静音检测（1.5s 自动停录）
- MediaRecorder API 录制 WebM
- ASR 集成（IPC 调用主进程 Sherpa-ONNX）
- 背景模式支持

### 响应优先级控制

- 高优先级消息可中断低优先级的流式输出
- 确保用户输入始终得到及时响应

---

## ASR 服务

主进程中的离线语音识别：

- **模型**：Sherpa-ONNX Sense-Voice-Small（中英日韩粤）
- **流程**：Base64 音频 → FFmpeg 转 16kHz WAV → PCM Float32 → 识别
- **IPC**：`asr-initialize` / `asr-is-ready` / `asr-recognize`
- **模型路径**：`models/asr/sense-voice-small/model.onnx` + `tokens.txt`

---

## 版本管理

```bash
npm run version release 1.0.0   # 正式版 → v1.0.0
npm run version beta 1.0.0      # 开发版 → v1.0.0-beta-YYMMDDHHMM
npm run version hotfix 1.0.0    # 热修复 → v1.0.0-hotfix-YYMMDDHHMM
npm run version patch           # 补丁 +1
npm run version minor           # 次版本 +1
npm run version major           # 主版本 +1
```

自动更新 package.json 版本号并创建 version.json。

---

## 开发辅助脚本

| 命令 | 说明 |
|------|------|
| `npm run check-i18n` | 校验 zh-CN / en-US 键一致性 |
| `npm run migrate-logger:preview` | 预览 console → logger 迁移 |
| `npm run migrate-logger` | 执行迁移（排除 logger.ts 自身） |
| `npm run version` | 生成 version.json（版本号 + 构建时间） |
| `npm run check-live2d` | 校验 models/ 下 Live2D 模型的 param-map.json 映射完整性 |

---

## 平台优化

### Windows GPU 渲染

Windows + NVIDIA 显卡可能出现 GPU 兼容性问题，已实施的优化：

- 主进程：禁用 GPU 沙箱、使用 ANGLE/D3D11、限制显存 2GB
- PixiJS：`powerPreference: 'high-performance'`、`preserveDrawingBuffer: false`
- 帧率限制：Windows 平台 60 FPS

如仍有问题，可在 `app.whenReady()` 前调用 `app.disableHardwareAcceleration()` 完全禁用硬件加速。

---

## 技术栈

| 组件 | 版本/技术 |
|------|----------|
| Electron | 28.0 |
| TypeScript | 5.3 |
| PixiJS | 7.3 |
| Live2D | Cubism SDK for Web |
| SQLite | better-sqlite3 |
| ASR | Sherpa-ONNX v1.6 |
| 图标 | Lucide Icons |
| 音频转换 | FFmpeg（系统依赖） |

---

## 添加新模块

1. js 创建 `.ts` 文件
2. global.d.ts 定义接口和 `Window` 扩展
3. index.html 引入编译后的 `.js`
4. `renderer.ts` 初始化逻辑中启动
