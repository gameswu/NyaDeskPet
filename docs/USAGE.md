# 使用指南

本文档介绍 NyaDeskPet 的安装、配置和使用方法。

## 安装与运行

### 环境要求

- Node.js 16+
- npm
- FFmpeg（语音识别需要，用于音频格式转换）

### 安装

```bash
npm install
```

### 编译

```bash
npm run compile
```

### 启动

```bash
# 开发模式（按平台选择）
npm run dev:mac
npm run dev:linux
npm run dev:win

# 生产模式
npm start
```

| 模式 | 特点 |
|------|------|
| 开发模式 | 窗口可调整大小、显示在任务栏、适合调试 |
| 生产模式 | 无边框透明窗口、置顶显示、系统托盘、关闭时隐藏到托盘 |

### 打包

```bash
npm run build:win     # → dist/NyaDeskPet-win32-x64/
npm run build:mac     # → dist/NyaDeskPet-darwin-x64/
npm run build:linux   # → dist/NyaDeskPet-linux-x64/
```

## 基础操作

### 窗口控制

| 操作 | 方式 |
|------|------|
| 移动窗口 | 拖拽顶栏 |
| 缩放模型 | 鼠标滚轮（0.3x ~ 3.0x） |
| 最小化 | 顶栏 `━` 按钮 |
| 关闭/隐藏 | 顶栏 `✕` 按钮（生产模式隐藏到托盘） |
| 彻底退出 | 托盘菜单 → 退出 |
| 打开设置 | 顶栏 ⚙️ 按钮 |
| 插件管理 | 顶栏 🧩 按钮 |
| 打开对话 | 底栏 💬 按钮 |

### 显示模式

| 模式 | 说明 | 切换方式 |
|------|------|---------|
| 完整 UI | 顶栏 + 底栏 + 模型 | 默认 |
| 纯模型 | 仅显示 Live2D 模型 | 双击模型 / 右下角眼睛图标 / 托盘菜单 |

### 触碰交互

点击模型不同部位（Head / Body / Mouth 等）触发触碰事件，具体反应由后端 Agent 决定。

- 在 设置 → 模型 → 触碰反应配置 中可启用/禁用特定部位
- 每个模型有独立的触碰配置，自动持久化

### 视线跟随

模型眼睛和头部自动跟随鼠标移动，可在 设置 → 显示 中开关。

### 系统托盘

生产模式下提供托盘支持：

- **托盘菜单**：显示/隐藏宠物、UI 切换、对话开关、置顶、设置、插件管理、退出
- **双击托盘图标**：快速显示/隐藏窗口
- 菜单文字根据当前状态动态更新

自定义托盘图标：
- macOS：`assets/tray-icon-mac.png`（16×16 / 32×32，黑白单色）
- Windows / Linux：tray-icon.png（16×16 / 32×32）

## 对话系统

### 侧边栏聊天

1. 点击 💬 按钮打开侧边栏
2. 输入框输入文本，回车发送
3. 支持多会话管理：点击 ➕ 新建对话，点击列表切换历史对话
4. 支持斜杠指令：输入 `/` 触发自动补全
5. 字幕模式：设置中开启后，聊天窗口关闭时底部浮现最近对话

### 口型同步

Agent 返回语音时，模型自动进行口型动画。基于音频频率实时分析，30 FPS 更新。

### 文件上传

在对话输入框中可上传文件（限 100MB），支持图片等多种格式。

## 设置

点击顶栏 ⚙️ 打开设置面板，分为以下标签页：

### 模型

- Live2D 模型文件路径
- 触碰反应配置（按部位启用/禁用）

### 连接

- 内置 Agent 服务器（默认开启）
- 外部后端地址（HTTP / WebSocket）
- 自动连接开关
- 音频音量
- 麦克风设置：背景模式、音量阈值、自动发送

### 角色

- 自定义桌宠名称
- 人设描述（影响 AI 对话风格）
- 启用/禁用自定义角色

### 显示

- 语言（中文 / 英文）
- 主题（浅色 / 深色 / 跟随系统）
- 对话字幕开关
- 视线跟随开关

### 关于

- 版本信息
- 更新检查
- GitHub 更新源配置

> 部分设置（主题、语言）立即生效；网络地址等需保存后重新连接。点击「恢复默认」可重置所有设置。

## 内置 Agent 服务器

NyaDeskPet 内置了完整的 AI Agent 服务器，无需外部后端即可使用。

### LLM Provider 配置

在设置中添加和管理 LLM Provider 实例：

| Provider | 说明 |
|----------|------|
| OpenAI | OpenAI 兼容 API |
| DeepSeek | DeepSeek API |
| OpenRouter | OpenRouter 多模型网关 |
| SiliconFlow | 硅基流动 API |

每个 Provider 实例需配置 API Key、模型名称等。支持同时配置多个实例，指定一个为主 Provider。

### TTS 配置

| Provider | 说明 |
|----------|------|
| Fish Audio | Fish Audio TTS API |
| Edge TTS | 微软 Edge TTS（免费） |

### 工具系统

- 内置工具由 Agent 插件注册（如 `fetch_url`、`search_web`）
- MCP 工具通过连接外部 MCP 服务器获取
- 可在设置中启用/禁用单个工具
- 插件来源的工具调用需用户确认

## 语音识别

### 安装 FFmpeg

- **macOS**：`brew install ffmpeg`
- **Ubuntu/Debian**：`sudo apt install ffmpeg`
- **Windows**：从 [ffmpeg.org](https://ffmpeg.org/download.html) 下载并添加到 PATH

### 下载 ASR 模型

模型：Sherpa-ONNX Sense-Voice-Small（中英日韩粤，约 200MB）

```bash
pip install huggingface-hub
huggingface-cli download csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17 \
  --local-dir models/asr/sense-voice-small
```

需要以下文件在 `models/asr/sense-voice-small/` 目录下：
- `model.onnx`
- `tokens.txt`

### 使用

1. 点击输入框旁 🎤 按钮开始录音
2. 说话（音量需高于阈值）
3. 静音 1.5 秒后自动停止并识别
4. 结果自动发送或填充到输入框

启动日志中 `[ASR] 初始化成功` 表示正常工作。

## 插件管理

### 操作

1. 点击顶栏 🧩 或托盘菜单打开面板
2. 「启动」→ 启动插件进程
3. 「连接」→ 建立 WebSocket 连接
4. 「⚙️」→ 打开插件配置
5. 「🔒」→ 查看/撤销权限记录

### 内置插件

| 插件 | 功能 | 权限 |
|------|------|------|
| 终端控制 | 执行命令、管理 Shell 会话 | `terminal.execute`, `terminal.session` |
| UI 自动化 | 鼠标键盘模拟、截图 | `ui-automation.mouse`, `ui-automation.keyboard`, `ui-automation.screen` |

插件配置和权限说明详见 [前端插件开发指南](PLUGINS.md)。

## Live2D 模型配置

### 使用设置面板（推荐）

设置 → 模型 → 修改模型路径 → 保存并重新加载

### 手动放置

```
models/your-model/
  ├── *.model3.json     # 模型配置（设置中填写此路径）
  ├── *.moc3            # 模型数据
  ├── *.physics3.json   # 物理配置
  ├── motions/          # 动作文件
  ├── expressions/      # 表情文件
  └── textures/         # 纹理
```

## 应用图标

将图标文件放入 `assets/` 目录：

| 文件 | 平台 | 推荐尺寸 |
|------|------|---------|
| `icon.ico` | Windows | 16×16 ~ 256×256 |
| `icon.icns` | macOS | 16×16 ~ 1024×1024 |
| `icon.png` | Linux | 512×512 或 1024×1024 |

## 常见问题

### 模型无法加载

- 检查模型文件路径是否正确
- 确认模型文件完整（.moc3 + .model3.json + textures）
- 查看开发者工具控制台错误信息

### 连接失败

- 确认内置 Agent 服务器已启用，或外部后端已启动
- 检查设置中的地址是否正确
- 查看控制台网络错误

### 语音识别不工作

- 确认 FFmpeg 已安装：`ffmpeg -version`
- 确认模型文件存在：`models/asr/sense-voice-small/model.onnx`
- 查看启动日志中的 ASR 初始化信息
- 确认麦克风权限已授予
- 尝试调高音量阈值

### 窗口无法移动

仅顶栏区域支持拖拽移动，模型区域不响应拖拽。

## 更新

```bash
git pull
npm install
npm run compile
```