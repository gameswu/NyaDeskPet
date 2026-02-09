# NyaDeskPet - Electron + Live2D 桌面宠物项目

## 项目文档
**主文档**: README.md
**核心文档库**:
- `docs/API.md`: API 接口规范与安全通信协议。
- `docs/USAGE.md`: 用户指南、安装说明、打包与故障排除。
- `docs/DEVELOPMENT.md`: 架构设计、核心逻辑、安全系统深度解析。

**文档原则**: 严禁在 `docs/` 目录下创建任何新文档文件。所有新的更新、说明或协议变更必须在上述三个现有文档（或 README.md）中进行修改和扩展。

## 项目概述
跨平台桌面宠物应用，使用 Electron + Live2D + TypeScript，与后端 Agent 服务器通信。

## 技术栈
- **前端框架**: Electron 28.0
- **开发语言**: TypeScript 5.3
- **渲染引擎**: PixiJS 7.3
- **Live2D**: Cubism SDK for Web
- **通信**: WebSocket + HTTP (Axios)
- **加密**: Web Crypto API (AES-GCM-256)
- **缓存**: IndexedDB

## 架构设计
- **主进程**: Electron (src/main.ts → dist/main.js)
- **预加载**: 安全的 IPC 桥接 (src/preload.ts → dist/preload.js)
- **渲染进程**: 
  - Live2D 管理器 (renderer/js/live2d-manager.ts)
  - 后端通信客户端 (renderer/js/backend-client.ts)
  - 对话管理器 (renderer/js/dialogue-manager.ts)
  - 音频播放器 (renderer/js/audio-player.ts)
  - 设置管理器 (renderer/js/settings-manager.ts)
  - 主协调脚本 (renderer/js/renderer.ts)
- **类型定义**: renderer/types/global.d.ts

## 快速开始
```bash
npm install              # 安装依赖
npm run compile          # 编译 TypeScript
npm run dev              # 开发模式运行
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
  │   ├── audio-player.ts/js        - 音频播放器
  │   └── renderer.ts/js            - 主协调脚本
  ├── types/      - 全局类型定义
  ├── index.html  - 主页面
  └── styles.css  - 样式
docs/             - 项目文档
  ├── API.md      - 接口协议规范
  ├── USAGE.md    - 安装和使用说明
  └── DEVELOPMENT.md - 开发细节说明
models/           - Live2D 模型文件
assets/           - 资源文件
```

## 安全系统架构
- **授权流程**: 用户登录 → 获取令牌 + 会话密钥 → 设备绑定
- **模型加密**: AES-GCM-256 加密，每个模型独立 IV
- **分片传输**: 大文件分片下载，支持进度追踪
- *型定义统一在 renderer/types/global.d.ts 中维护
