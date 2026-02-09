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

- 🎭 **Live2D 交互** - 高质量 Live2D 模型渲染与动画控制
- 💬 **智能大脑** - 与后端 AI Agent 通信，实现自然语言交互
- 🌐 **跨平台** - 一套代码支持 Windows, macOS 和 Linux
- 🪟 **窗口自适应** - Live2D 模型自动适应窗口大小变化，支持自由调整尺寸
- 📌 **系统托盘** - 支持最小化到托盘，快速切换显示/隐藏
- ⚙️ **图形化设置** - 友好的设置界面，实时预览配置效果
- 💭 **对话界面** - 完整的对话窗口，支持文本、语音、视频输入（部分开发中）
- 🎨 **现代UI** - 基于 Lucide Icons 的专业图标系统，分区布局设计，操作直观流畅
- 👁️ **UI切换模式** - 支持完整UI和纯模型两种显示模式，双击模型或点击按钮即可切换

---

## 🛠️ 快速运行

```bash
# 1. 安装依赖
npm install

# 2. 编译代码
npm run compile

# 3. 启动应用
npm run dev
```

---

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request！

**注意**: 本项目文档结构已固定。后续任何更新请仅在 `README.md` 或 `docs/` 目录下的三个核心文档（`API.md`, `USAGE.md`, `DEVELOPMENT.md`）中进行修改，**严禁新增文档文件**。

---

## 📄 许可证

[APGL-3.0 许可证](LICENSE)
