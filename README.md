# NyaDeskPet

<div align="center">
  <img src="logo.png" alt="NyaDeskPet Logo" width="320"/>
  <p>一个基于 Live2D 和 AI Agent 的桌面宠物应用</p>
</div>

---

## 📖 项目文档

为了保持结构清晰，项目详细信息已拆分为以下文档：

- 🚀 **[快速开始 & 使用指南](docs/USAGE.md)**
  安装环境、运行程序、打包发布、配置模型和常见问题。

- 📡 **[API 接口规范](docs/API.md)**
  WebSocket 通信协议、后端 API 定义及其安全实现。

- 💻 **[开发与架构指南](docs/DEVELOPMENT.md)**
  项目结构、核心模块设计、安全系统逻辑及技术栈说明。

---

## ✨ 特性概览

- 🎭 **Live2D 交互** - 高质量 Live2D 模型渲染与动画控制，支持鼠标滚轮缩放、视线跟随与口型同步
- 🌐 **多语言支持** - 内置中英文国际化，可根据系统语言自动切换或手动设置
- 🌙 **主题系统** - 深色/浅色模式切换，完美适配不同使用场景
- 💬 **侧边栏对话** - 现代化的侧边栏聊天界面，支持对话历史记录与沉浸式体验
- ⚙️ **分组设置面板** - 标签页式设置界面，包含模型、连接、角色、显示和关于等配置
- 🎨 **角色自定义** - 支持自定义桌宠名称和人设，让 AI 对话更具个性
- 🤖 **智能交互** - 与后端 AI Agent 通信，实现自然语言交互与智能决策
- 🌐 **跨平台支持** - 一套代码支持 Windows、macOS 和 Linux
- 📐 **窗口自适应** - Live2D 模型自动适应窗口大小变化，支持自由调整尺寸
- 📥 **动态系统托盘** - 支持最小化到托盘，菜单按钮根据状态智能切换
- 🎨 **现代化 UI** - 基于 Lucide Icons 的专业图标系统，分区布局设计，操作直观流畅
- 👁️ **UI 切换模式** - 支持完整 UI 和纯模型两种显示模式，双击模型或点击按钮即可切换
- 🗣️ **实时口型同步** - 音频播放时自动进行口型动画，让对话更加生动自然
- 🎙️ **本地语音识别** - 基于 Sherpa-ONNX 的离线 ASR，支持中英日韩粤五种语言
- 📷 **视频输入支持** - 集成摄像头捕获，支持视觉多模态交互
- 🧩 **插件系统** - 支持外置插件扩展功能，内置终端控制和 UI 自动化插件
- ⚙️ **插件配置** - 图形化插件配置界面，支持多种配置类型（文本、数字、开关等）
- 🔒 **权限管理** - 5 级危险度权限审批系统，危险操作需用户确认

---

## 🛠️ 快速运行

### 环境准备

```bash
# 1. 安装依赖
npm install

# 2. 编译 TypeScript 代码
npm run compile
```

### 启动应用

```bash
# 开发模式（根据操作系统选择）
npm run dev:mac     # macOS
npm run dev:linux   # Linux
npm run dev:win     # Windows
npm run dev         # 通用命令

# 生产模式
npm start
```

### 开发辅助工具

```bash
# 检查国际化文件一致性
npm run check-i18n

# 自动迁移 console 调用到 logger 系统（预览模式）
npm run migrate-logger:preview

# 自动迁移 console 调用到 logger 系统（实际执行）
npm run migrate-logger

# 更新版本号（详见开发文档）
npm run version
```

---

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request！

**注意**: 本项目文档结构已固定。后续任何更新请仅在 `README.md` 或 `docs/` 目录下的三个核心文档（`API.md`, `USAGE.md`, `DEVELOPMENT.md`）中进行修改，**严禁新增文档文件**。

---

## 📄 许可证

[MIT License](LICENSE)
