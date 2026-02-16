# 内置 Agent 管理

Agent 插件是运行在主进程中的扩展模块，负责增强 AI 的推理和工具能力。NyaDeskPet 内置了 10 个 Agent 插件，它们协同工作来实现角色的核心功能。

## 目录
- [内置 Agent 管理](#内置-agent-管理)
  - [目录](#目录)
  - [打开 Agent 插件管理](#打开-agent-插件管理)
  - [内置插件说明](#内置插件说明)
    - [核心 Handler 插件](#核心-handler-插件)
    - [普通插件](#普通插件)
  - [插件协作机制](#插件协作机制)
  - [激活和停用插件](#激活和停用插件)
  - [插件配置](#插件配置)
  - [插件依赖](#插件依赖)
  - [安装第三方 Agent 插件](#安装第三方-agent-插件)
  - [下一步](#下一步)

---

## 打开 Agent 插件管理

<div align="center">
    <img src="./images/agent-mgmt-panel.png" alt="核心插件" width="300"/>
</div>

1. 点击底栏的 **Agent 按钮**
2. 在 Agent 面板中找到 **Agent 插件** 区域
3. 你可以看到所有已安装的 Agent 插件及其状态

---

## 内置插件说明

NyaDeskPet 的 10 个内置 Agent 插件分为两类：

### 核心 Handler 插件

| 插件 | 类型 | 说明 |
|------|------|------|
| **core-agent** | Handler 插件 | 核心协调器，组合调用其他核心插件来完成对话处理 |

Handler 插件可以 **完全接管** 消息处理流程。`core-agent` 是默认的 Handler，它协调下面的普通插件来实现完整的对话功能。

### 普通插件

| 插件 | 说明 |
|------|------|
| **personality** | 人格系统——构建结构化的系统提示词，定义角色性格 |
| **memory** | 记忆管理——会话分离上下文、自动压缩长对话 |
| **protocol-adapter** | 协议适配——将纯文本 + 动作转换为前端可渲染的消息格式 |
| **expression-generator** | 表情生成器——用独立 LLM 将对话文本转化为 Live2D 控制指令 |
| **plugin-tool-bridge** | 插件桥接——将前端插件的能力注册为 Function Calling 工具 |
| **info** | 信息查看——提供 `/info` 斜杠指令，查看系统状态 |
| **web-tools** | 网页工具——提供 `fetch_url` 和 `search_web` 工具 |
| **input-collector** | 输入收集——抖动收集连续输入，避免消息碎片化 |
| **image-transcriber** | 图片转述——将上传的图片转述为文字描述 |

---

## 插件协作机制

当你发送一条消息时，插件的协作流程大致如下：

<div align="center">
    <img src="./images/agent-mgmt-flow.png" alt="插件协作流程" width="400"/>
</div>

---

## 激活和停用插件

每个插件都可以单独激活或停用：

- **激活**：插件参与消息处理
- **停用**：插件不参与处理，其注册的工具和指令也不可用

> [!WARNING]
> 停用核心插件（如 `core-agent`）会导致 AI 无法正常响应对话。除非你知道自己在做什么，否则建议保持所有内置插件处于激活状态。

---

## 插件配置

<div align="center">
    <img src="./images/agent-mgmt-config.png" alt="插件配置" width="300"/>
</div>

部分 Agent 插件支持配置。点击插件卡片上的 **配置** 按钮可以修改参数。

例如，`expression-generator` 插件可以配置使用哪个 LLM 实例来生成表情指令，使你可以为表情生成使用不同于主对话的模型。

---

## 插件依赖

Agent 插件之间可能存在依赖关系。应用在加载插件时会自动进行 **拓扑排序**，确保被依赖的插件先于依赖方加载。

例如，`core-agent` 依赖 `personality`、`memory`、`protocol-adapter` 等插件，这些插件会先于 `core-agent` 初始化。

---

## 安装第三方 Agent 插件

除了内置插件，你还可以安装第三方 Agent 插件：

1. 将插件文件夹放入应用的 `agent-plugins/` 目录
2. 重启应用
3. 新插件会自动出现在 Agent 插件列表中

插件的目录结构：

```
agent-plugins/my-plugin/
├── metadata.json    ← 插件元数据
├── main.js          ← 入口文件（CommonJS）
└── _conf_schema.json ← 配置模板（可选）
```

开发者可查看 [Agent 插件开发](AgentPluginDevelopment.md) 了解详细开发指南。

---

## 下一步

- 想要开发自己的插件？查看 [开发者指南](DEVELOPMENT.md)
- 遇到问题？查看 [常见问题](FAQ.md)
