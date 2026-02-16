# 使用指南

本文档介绍 NyaDeskPet 的安装、配置和日常使用方法。

## 目录
- [使用指南](#使用指南)
  - [目录](#目录)
  - [安装](#安装)
  - [基础操作](#基础操作)
    - [窗口控制](#窗口控制)
    - [顶栏与底栏](#顶栏与底栏)
    - [显示模式](#显示模式)
    - [触碰交互](#触碰交互)
    - [视线跟随](#视线跟随)
    - [系统托盘](#系统托盘)
  - [对话与聊天](#对话与聊天)
    - [侧边栏聊天](#侧边栏聊天)
    - [斜杠指令](#斜杠指令)
    - [文件与图片上传](#文件与图片上传)
    - [摄像头](#摄像头)
    - [口型同步](#口型同步)
  - [设置](#设置)
    - [模型](#模型)
    - [连接](#连接)
    - [角色](#角色)
    - [显示](#显示)
    - [日志](#日志)
    - [关于](#关于)
  - [内置 Agent 服务器](#内置-agent-服务器)
    - [LLM Provider](#llm-provider)
    - [TTS Provider](#tts-provider)
    - [工具系统](#工具系统)
    - [Agent 插件](#agent-插件)
  - [语音识别](#语音识别)
    - [安装 FFmpeg](#安装-ffmpeg)
    - [下载 ASR 模型](#下载-asr-模型)
    - [使用](#使用)
  - [前端插件](#前端插件)
    - [操作](#操作)
    - [内置前端插件](#内置前端插件)
  - [Live2D 模型配置](#live2d-模型配置)
    - [使用设置面板（推荐）](#使用设置面板推荐)
    - [手动放置](#手动放置)
    - [参数映射表（param-map.json）](#参数映射表param-mapjson)
      - [格式](#格式)
      - [字段说明](#字段说明)
      - [工作原理](#工作原理)
  - [常见问题](#常见问题)
    - [模型无法加载](#模型无法加载)
    - [连接失败](#连接失败)
    - [语音识别不工作](#语音识别不工作)
    - [窗口无法移动](#窗口无法移动)
    - [AI 不回复或回复异常](#ai-不回复或回复异常)
  - [更新](#更新)

## 安装

1. 从 [GitHub Releases](https://github.com/gameswu/NyaDeskPet/releases) 下载适合您操作系统的安装包
2. 参考[开发者指南](DEVELOPMENT.md)中的打包分发部分，了解如何从源代码构建应用
3. 运行安装包并按照提示完成安装

## 基础操作

### 窗口控制

| 操作 | 方式 |
|------|------|
| 移动窗口 | 拖拽顶栏 |
| 缩放模型 | 鼠标滚轮（0.3x ~ 3.0x） |
| 最小化 | 顶栏 `━` 按钮 |
| 关闭/隐藏 | 顶栏 `✕` 按钮（生产模式隐藏到托盘） |
| 彻底退出 | 托盘菜单 → 退出 |

### 顶栏与底栏

| 按钮 | 功能 |
|------|------|
| ⚙️ 设置 | 打开设置面板 |
| 🤖 Agent | 打开 Agent 管理面板（内置模式可见） |
| 🧩 插件 | 打开插件管理面板 |
| 💬 对话 | 打开侧边栏聊天窗口 |
| 👁️ UI 切换 | 切换完整 UI / 纯模型模式 |

### 显示模式

| 模式 | 说明 | 切换方式 |
|------|------|---------|
| 完整 UI | 顶栏 + 底栏 + 模型 | 默认 |
| 纯模型 | 仅显示 Live2D 模型 | 双击模型 / 底栏眼睛图标 / 托盘菜单 |

### 触碰交互

点击模型不同部位（Head / Body / Mouth 等）触发触碰事件，具体反应由后端 Agent 决定。

- 设置 → 模型 → 触碰反应配置：可按部位启用/禁用
- 每个模型有独立的触碰配置，自动持久化

### 视线跟随

模型眼睛和头部自动跟随鼠标移动，可在 设置 → 显示 中开关。

### 系统托盘

生产模式下提供托盘支持：

- **托盘菜单**：显示/隐藏宠物、UI 切换、对话开关、置顶、设置、插件管理、退出
- **双击托盘图标**：快速显示/隐藏窗口
- 菜单文字根据当前状态动态更新

自定义托盘图标：

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS | `assets/tray-icon-mac.png` | 16×16 / 32×32，黑白单色 |
| Windows / Linux | tray-icon.png | 16×16 / 32×32 |

## 对话与聊天

### 侧边栏聊天

1. 点击底栏 💬 按钮打开侧边栏
2. 输入框输入文本，回车发送
3. 支持多会话管理：点击 ➕ 新建对话，点击列表切换历史对话
4. 字幕模式：设置中开启后，聊天窗口关闭时底部浮现最近对话

### 斜杠指令

在对话输入框中输入 `/` 触发自动补全，选择指令后自动填充参数。指令由 Agent 插件注册，开箱即用的指令包括 `/info` 等。

指令管理：Agent 面板 → 指令标签页，可查看所有已注册指令、启用/禁用指令，以及开关「从 LLM 上下文中过滤指令消息」。

### 文件与图片上传

在对话输入框中可上传文件（限 100MB），支持图片等格式。上传的图片将发送给 LLM 进行多模态理解。

### 摄像头

点击输入区域的摄像头按钮可截取摄像头画面发送。首次使用时请求权限，延迟初始化。

### 口型同步

Agent 返回语音时，模型自动进行口型动画。基于音频频率实时分析，30 FPS 更新。

## 设置

点击顶栏 ⚙️ 打开设置面板，包含以下标签页：

### 模型

- Live2D 模型文件路径（选择 `.model3.json` 文件）
- 触碰反应配置（按部位启用/禁用）

### 连接

- 后端模式：内置 Agent / 自定义后端
- 内置 Agent 端口（默认 8765）
- 外部后端地址（HTTP / WebSocket）
- 自动连接开关
- 音频音量
- 麦克风设置：背景工作模式、音量阈值、识别后自动发送

### 角色

- 启用/禁用自定义角色
- 桌宠名称
- 人设描述（影响 AI 对话风格）

### 显示

- 语言（中文 / 英文）
- 主题（浅色 / 深色 / 跟随系统）
- 对话字幕开关
- 视线跟随开关
- 开机自启动

### 日志

- 日志开关
- 日志等级（debug / info / warn / error / critical）
- 日志保留天数
- 日志文件管理（刷新列表 / 打开目录 / 删除全部）

### 关于

- 版本信息
- 检查更新（支持正式版、beta、hotfix 版本比较）
- GitHub 更新源配置

> 主题、语言等设置立即生效；网络地址等需保存后重新连接。点击「恢复默认」可重置所有设置。

## 内置 Agent 服务器

NyaDeskPet 内置了完整的 AI Agent 服务器，无需外部后端即可使用。通过顶栏 🤖 按钮打开 Agent 管理面板。

### LLM Provider

支持以下 LLM Provider（可同时配置多个实例，指定一个为主 Provider）：

| Provider | 说明 |
|----------|------|
| OpenAI | OpenAI API 及所有兼容接口 |
| Anthropic | Claude Sonnet / Opus / Haiku 系列 |
| Google Gemini | 多模态，有免费额度 |
| DeepSeek | DeepSeek API，支持深度思考 |
| OpenRouter | 统一网关，400+ 模型 |
| SiliconFlow | 硅基流动，部分模型免费 |
| DashScope | 阿里云百炼，通义千问全系列，国内直连 |
| 智谱 AI | GLM-4 系列，glm-4-flash 免费，国内直连 |
| 火山引擎 | 豆包大模型，国内直连 |
| Groq | 超快 LPU 推理，有免费额度 |
| Mistral AI | Mistral Large / Small / Codestral |
| xAI | Grok 系列 |

每个实例需配置 API Key 和模型名称。在 Agent 面板 → 概览 → LLM Provider 区域添加和管理。

### TTS Provider

| Provider | 说明 |
|----------|------|
| Fish Audio | 400+ 预制音色，音色克隆，流式传输 |
| Edge TTS | 免费，400+ Neural 音色 |
| OpenAI TTS | 6 种预制音色，tts-1 / tts-1-hd |
| ElevenLabs | 29+ 语言，音色克隆，高音质 |

在 Agent 面板 → 概览 → TTS Provider 区域添加和管理。

### 工具系统

Agent 面板 → 工具标签页管理所有工具：

- **Function 工具**：由 Agent 插件注册（如 `fetch_url`、`search_web`），可逐个启用/禁用
- **MCP 工具**：通过连接外部 MCP 服务器获取，支持 stdio 和 SSE 两种传输方式
- 来自前端插件的工具调用需用户确认

### Agent 插件

Agent 面板 → 插件标签页管理内置 Agent 插件：

| 插件 | 功能 |
|------|------|
| core-agent | 核心协调器，编排以下核心插件 |
| personality | 人格系统，构建结构化系统提示词 |
| memory | 记忆管理，会话分离 + 自动压缩 |
| protocol-adapter | 协议适配，纯文本 + 动作 → 前端消息格式 |
| expression-generator | 表情生成器，LLM 驱动 Live2D 控制指令 |
| plugin-tool-bridge | 前端插件能力 → FC 工具桥接 |
| info | `/info` 斜杠指令 |
| web-tools | `fetch_url` + `search_web` 工具 |
| input-collector | 输入抖动收集，合并快速连续输入 |
| image-transcriber | 图片转述，主 LLM 不支持图片时使用视觉 Provider |

插件支持激活、停用、重载、配置编辑。详见 Agent 插件开发指南。

## 语音识别

### 安装 FFmpeg

| 平台 | 命令 |
|------|------|
| macOS | `brew install ffmpeg` |
| Ubuntu / Debian | `sudo apt install ffmpeg` |
| Windows | 从 [ffmpeg.org](https://ffmpeg.org/download.html) 下载并添加到 PATH |

### 下载 ASR 模型

模型：Sherpa-ONNX Sense-Voice-Small（中英日韩粤，约 200MB）

```bash
pip install huggingface-hub
huggingface-cli download csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17 \
  --local-dir models/asr/sense-voice-small
```

需要以下文件在 sense-voice-small 目录下：

- `model.onnx`
- `tokens.txt`

### 使用

1. 点击输入框旁 🎤 按钮开始录音
2. 说话（音量需高于阈值）
3. 静音 1.5 秒后自动停止并识别
4. 结果自动发送或填充到输入框（取决于设置）

启动日志中 `[ASR] 初始化成功` 表示正常工作。

## 前端插件

### 操作

1. 点击顶栏 🧩 或托盘菜单打开插件面板
2. 「启动」→ 启动插件进程
3. 「连接」→ 建立 WebSocket 连接
4. 「⚙️」→ 打开插件配置
5. 「🔒」→ 查看/撤销权限记录

### 内置前端插件

| 插件 | 功能 | 权限 |
|------|------|------|
| 终端控制 | 执行命令、管理 Shell 会话 | `terminal.execute`, `terminal.session` |
| UI 自动化 | 鼠标键盘模拟、截图 | `ui-automation.mouse`, `ui-automation.keyboard`, `ui-automation.screen` |
| 文件编辑器 | 读取、创建、编辑文件，目录列表 | `file.read`, `file.write`, `file.edit` |

前端插件为独立进程（Python 等语言），通过 WebSocket 通信。详见 前端插件开发指南。

## Live2D 模型配置

### 使用设置面板（推荐）

设置 → 模型 → 修改模型路径 → 保存并重新加载

### 手动放置

将模型文件放置在 live2d 下：

```
models/live2d/your-model/
  ├── *.model3.json     # 模型配置（设置中填写此路径）
  ├── *.moc3            # 模型数据
  ├── *.physics3.json   # 物理配置
  ├── param-map.json    # [可选] 参数映射表
  ├── motions/          # 动作文件
  ├── expressions/      # 表情文件
  └── textures/         # 纹理（或内联到 model3.json）
```

### 参数映射表（param-map.json）

Live2D 模型通常包含数十甚至上百个参数（如 `ParamAngleX`、`Param3` 等），直接暴露给 AI 存在两个问题：

1. **语义不明**：参数 ID 是技术命名，AI 难以理解其含义
2. **数量过多**：大量无关参数浪费 AI 的上下文窗口

参数映射表通过为重要参数提供语义别名和描述来解决这两个问题。

#### 格式

```json
{
  "version": 1,
  "parameters": [
    {
      "id": "ParamAngleZ",
      "alias": "head_tilt",
      "description": "头部左右倾斜歪头，负值向右歪，正值向左歪"
    }
  ],
  "expressions": [
    {
      "id": "exp_01",
      "alias": "joy",
      "description": "开心/愉快"
    }
  ],
  "motions": [
    {
      "group": "Idle",
      "index": 0,
      "alias": "idle",
      "description": "待机呼吸摇摆"
    }
  ]
}
```

#### 字段说明

| 字段 | 说明 |
|------|------|
| `version` | 固定为 `1` |
| `parameters[].id` | Live2D 原始参数 ID（必须与模型匹配） |
| `parameters[].alias` | AI 使用的语义别名（如 `head_tilt`、`left_eye_open`） |
| `parameters[].description` | 参数功能描述（AI 据此理解如何使用） |
| `expressions[].id` | 表情文件 ID |
| `expressions[].alias` | 表情语义别名 |
| `motions[].group` | 动作组名（对应 model3.json 中的 Motions 组名） |
| `motions[].index` | 动作在组内的索引（从 0 开始） |
| `motions[].alias` | 动作语义别名 |

#### 工作原理

- 前端加载模型时自动读取同目录下的 `param-map.json`
- 参数的 min/max/default 范围从模型自动读取，无需手动填写
- AI 仅看到映射表中遴选的参数和别名，降低幻觉概率
- 不提供映射表时，AI 照常使用全量原始参数 ID

> 内置 mao_pro_zh 模型已配备映射表（param-map.json），可作为参考模板。

## 常见问题

### 模型无法加载

- 检查模型文件路径是否正确（需指向 `.model3.json` 文件）
- 确认模型文件完整（.moc3 + .model3.json + textures）
- 查看开发者工具控制台错误信息

### 连接失败

- 确认内置 Agent 服务器已启动（Agent 面板查看状态）
- 检查端口是否被占用；修改端口后会自动重启服务器
- 若使用自定义后端，检查 HTTP / WebSocket 地址是否正确
- 查看控制台网络错误

### 语音识别不工作

- 确认 FFmpeg 已安装：`ffmpeg -version`
- 确认模型文件存在：`models/asr/sense-voice-small/model.onnx`
- 查看启动日志中的 ASR 初始化信息
- 确认麦克风权限已授予
- 尝试调整音量阈值

### 窗口无法移动

仅顶栏区域支持拖拽移动，模型区域不响应拖拽。

### AI 不回复或回复异常

- 确认已在 Agent 面板添加并启用至少一个 LLM Provider
- 确认已设置为主 Provider
- 检查 API Key 是否正确（可使用测试按钮验证）

## 更新

```bash
git pull
npm install
npm run compile
```

应用内也可通过 设置 → 关于 → 检查更新 进行更新检查，支持配置 GitHub 更新源地址。
