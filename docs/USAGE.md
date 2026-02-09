# 使用指南

本文档介绍如何安装、配置和使用 NyaDeskPet。

## 📦 安装

### 前置要求
- Node.js 16.0 或更高版本
- npm 或 yarn 包管理器

### 安装依赖

```bash
npm install
```

---

## 🚀 运行

### 编译 TypeScript

在运行前，需要先编译 TypeScript 代码：

```bash
npm run compile
```

### 开发模式

```bash
npm run dev
```

开发模式特性：
- 自动打开开发者工具
- 窗口可调整大小
- 显示在任务栏
- 适合调试和开发

### 生产模式

```bash
npm start
```

生产模式特性：
- 无边框透明窗口
- 窗口置顶显示
- 无任务栏图标

### 自动编译（监听模式）

打开两个终端进行开发：

```bash
# 终端 1：监听并自动编译
npm run watch

# 终端 2：运行应用
npm run dev
```

---

## 📦 打包

### Windows

```bash
npm run build:win
```

生成文件位于 `dist/NyaDeskPet-win32-x64/`

### macOS

```bash
npm run build:mac
```

生成文件位于 `dist/NyaDeskPet-darwin-x64/`

### Linux

```bash
npm run build:linux
```

生成文件位于 `dist/NyaDeskPet-linux-x64/`

---

## ⚙️ 配置

### 图形化设置（推荐）

NyaDeskPet 现在提供了图形化设置界面，可以方便地修改所有配置：

1. **打开设置面板**
   - 点击窗口右上角的 ⚙️ 按钮
   - 或在控制台输入 `window.app.showSettings()`

2. **可配置项**
   - **Live2D 模型路径** - 模型配置文件的相对路径
   - **后端 HTTP 地址** - 后端服务器的 HTTP API 地址
   - **WebSocket 地址** - WebSocket 连接地址
   - **自动连接** - 启动时是否自动连接后端
   - **音量** - 语音播放音量 (0-100%)

3. **保存设置**
   - 修改后点击"保存设置"按钮
   - 部分设置需要重新加载应用才能生效
   - 设置自动保存到浏览器 localStorage

4. **恢复默认**
   - 点击"恢复默认"按钮可重置所有设置

### 手动配置（高级）

如果需要手动编辑配置文件，可以编辑 [renderer/js/settings-manager.ts](renderer/js/settings-manager.ts) 中的 `defaultSettings`：

```typescript
private defaultSettings: AppSettings = {
  modelPath: 'models/default/model3.json',
  backendUrl: 'http://localhost:8000',
  wsUrl: 'ws://localhost:8000/ws',
  autoConnect: true,
  volume: 0.8
};
```

### 后端服务器配置（已废弃）

> ⚠️ 注意：直接编辑 `renderer.ts` 中的 `APP_CONFIG` 的方式已被图形化设置替代。

### Live2D 模型配置

您可以通过两种方式配置 Live2D 模型：

**方式 1: 使用设置面板（推荐）**
1. 点击窗口右上角的 ⚙️ 按钮打开设置
2. 在"Live2D 模型"部分修改模型路径
3. 保存并重新加载应用

**方式 2: 手动放置模型文件**

1. 将 Live2D 模型文件夹放入 `models/` 目录
2. 模型结构示例：

```
models/
└── your-model/
    ├── model3.json          # 模型配置
    ├── *.moc3               # 模型数据
    ├── *.physics3.json      # 物理配置
    ├── motions/             # 动作文件
    ├── expressions/         # 表情文件
    └── textures/            # 纹理图片
```

3. 修改 `APP_CONFIG.modelPath` 为模型路径

### 应用图标配置

将图标文件放入 `assets/` 目录：

- **icon.ico** - Windows 图标（推荐 16×16 到 256×256）
- **icon.icns** - macOS 图标（推荐 16×16 到 1024×1024）
- **icon.png** - Linux 图标（推荐 512×512 或 1024×1024）

可使用在线工具生成：https://www.icoconverter.com/

---

## 🎮 使用说明

**获取 Live2D 模型**：
- 官方示例：https://www.live2d.com/download/sample-data/
- 需符合 Live2D Cubism 4.0+ 规范

---

## 🎮 使用说明
2. **模型加载** - 应用启动后自动加载配置的 Live2D 模型
3. **拖拽移动** - 鼠标拖拽窗口可以移动位置
4. **点击交互** - 点击宠物可以触发交互
5. **对话显示** - 底部会显示宠物的对话内容
---

## 🔐 安全系统

### 首次登录

1. 应用启动时会检查授权状态
2. 未授权时显示登录界面
3. 输入用户名和密码
4. 后端验证并返回授权令牌和会话密钥
5. 生成设备指纹绑定当前设备

### 示对话
window.app.showDialogue('测试对话', 3000);

// 播放动作
window.app.playMotion('TapBody', 0);

// 设置表情
window.app.setExpression('smile');

// 查看应用状态
window.app.getState();
```

### 安全系统调试

```typescript
// 查看授权状态
window.authManager.getAuthStatus();

// 手动登出
window.authManager.logout();

// 查看缓存模型
await window.modelCacheManager.getAllModelIds();

// 获取缓存大小
await window.modelCacheManager.getCacheSize();

// 清除缓存
await window.modelCacheManager.clearCache();
```

### 查看日志

打开开发者工具（F12），查看 Console 标签页的日志输出。

---

## ❓ 常见问题

### 登录失败

**问题**: 点击登录后提示"登录失败"

**解决方案**:
1. 检查后端服务器是否运行
2. 确认 `backendUrl` 配置正确
3. 检查用户名和密码是否正确
4. 查看浏览器控制台错误信息

### 模型加载失败

**问题**: 登录成功但模型无法加载

**解决方案**:
1. 检查后端模型 API 是否正常
2. 查看控制台的错误信息
3. 检查网络连接
4. 尝试清除缓存后重新加载

### 窗口无法拖拽

**问题**: 鼠标无法拖拽窗口
方案**:
```typescript
// 在浏览器控制台执行
await window.modelCacheManager.clearCache();
```

或手动清除浏览器数据：
1. 打开开发者工具
2. Application → Storage → Clear site data

---

## 🔄 更新

### 更新应用

```bash
# 拉取最新代码
git pull

# 安装依赖（如有新依赖）
npm install

# 重新编译
npm 动清除旧缓存并下载新模型

---

**注意**: 所有使用相关的说明都在本文档中，请勿创建新的使用文档。
模型无法加载或显示

**解决方案**:
1. 检查模型文件路径是否正确
2. 确认模型文件完整且格式正确
3. 查看控制台的错误信息
4. 尝试使用官方示例模型测试

### 后端连接失败

**问题**: 无法连接到后端服务器