# 配置后端 Agent

后端 Agent 是 NyaDeskPet 的"大脑"，负责理解你说的话并生成回复。本页介绍如何配置 LLM（大语言模型）供应商、TTS（语音合成）供应商，以及工具和 MCP 服务。

## 目录
- [配置后端 Agent](#配置后端-agent)
  - [目录](#目录)
  - [连接设置](#连接设置)
  - [打开 Agent 面板](#打开-agent-面板)
  - [配置 LLM 供应商](#配置-llm-供应商)
    - [支持的供应商](#支持的供应商)
    - [添加供应商实例](#添加供应商实例)
    - [设置主供应商](#设置主供应商)
  - [配置 TTS 供应商](#配置-tts-供应商)
    - [支持的 TTS 供应商](#支持的-tts-供应商)
    - [添加 TTS 供应商](#添加-tts-供应商)
  - [工具管理](#工具管理)
    - [查看已注册工具](#查看已注册工具)
    - [启用 / 禁用工具](#启用--禁用工具)
  - [MCP 服务器管理](#mcp-服务器管理)
    - [添加 MCP 服务器](#添加-mcp-服务器)
  - [角色人设](#角色人设)
  - [下一步](#下一步)

---

## 连接设置

<div align="center">
    <img src="./images/agent-connection.png" alt="连接设置" width="300"/>
</div>

在 **设置 → 连接** 标签页中，你可以配置：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| 后端模式 | 内置 Agent 或自定义后端 | 内置 Agent |
| Agent 端口 | 内置 Agent 的 WebSocket 端口 | 8765 |
| 自动连接 | 启动时自动连接后端 | 开启 |
| 音量 | TTS 播放音量 | 80% |

> [!TIP]
> 大多数情况下保持默认的「内置 Agent」模式即可。如果你有自己的后端服务，可以切换为「自定义」模式并填写地址。

---

## 打开 Agent 面板

点击顶栏的 **Agent 按钮**，即可打开 Agent 管理面板。面板分为以下区域：

- **LLM 供应商管理**：配置 AI 模型
- **TTS 供应商管理**：配置语音合成
- **工具管理**：管理 AI 可调用的工具
- **MCP 服务器管理**：管理 MCP 协议工具源

---

## 配置 LLM 供应商

LLM 供应商是提供 AI 对话能力的服务。你需要至少配置一个 LLM 供应商，角色才能进行对话。

### 支持的供应商

| 供应商 | 说明 |
|--------|------|
| OpenAI | GPT 系列模型 |
| Anthropic | Claude 系列模型 |
| Google Gemini | Gemini 系列模型 |
| DeepSeek | DeepSeek 系列模型 |
| OpenRouter | 多模型聚合平台 |
| SiliconFlow | 硅基流动 |
| DashScope | 阿里通义千问 |
| 智谱 AI | GLM 系列模型 |
| 火山引擎 | 字节跳动 AI 平台 |
| Groq | 高速推理平台 |
| Mistral AI | Mistral 系列模型 |
| xAI | Grok 系列模型 |

### 添加供应商实例

<div align="center">
    <img src="./images/agent-add-llm.png" alt="添加 LLM 供应商" width="300"/>
</div>

1. 在 Agent 面板中找到 **LLM 供应商** 区域
2. 从下拉列表中选择一个供应商类型
3. 点击 **添加** 按钮
4. 在弹出的配置表单中填写：
   - **API Key**：从供应商官网获取的密钥
   - **模型名称**：要使用的模型（如 `gpt-4o`、`deepseek-chat`）
   - **Base URL**（可选）：自定义 API 地址，适用于代理或私有部署
   - 其他供应商特定选项

<div align="center">
    <img src="./images/agent-llm-form.png" alt="LLM 配置表单" width="300"/>
</div>

1. 点击 **保存** 完成配置

### 设置主供应商

配置多个供应商时，你需要选择一个作为 **主供应商**（Primary）。主供应商是角色默认使用的 AI 模型：

- 点击供应商实例卡片上的 **设为主供应商** 按钮
- 主供应商会显示特殊标识

> [!TIP]
> 你可以添加多个相同类型但配置不同的供应商实例（例如不同模型的 OpenAI 实例），通过 Agent 插件灵活调用。

---

## 配置 TTS 供应商

TTS（Text-to-Speech）供应商让角色能"说话"。配置后，角色的回复不仅会显示为文字，还会以语音朗读并同步口型动画。

### 支持的 TTS 供应商

| 供应商 | 说明 | 特点 |
|--------|------|------|
| Fish Audio | 高质量语音合成 | 音质优良，需要 API Key |
| Edge TTS | 微软 Edge 语音 | 免费，无需 API Key |
| OpenAI TTS | OpenAI 语音合成 | 需要 OpenAI API Key |
| ElevenLabs | ElevenLabs 语音 | 高度逼真，需要 API Key |

### 添加 TTS 供应商

<div align="center">
    <img src="./images/agent-add-tts.png" alt="配置 TTS 供应商" width="300"/>
</div>

1. 在 Agent 面板中找到 **TTS 供应商** 区域
2. 选择供应商类型并添加
3. 填写 API Key 和语音参数（如音色、语速等）
4. 设置为主 TTS 供应商

> [!TIP]
> 
> 不配置 TTS 也不影响正常对话，角色会以纯文字方式回复。想快速体验语音？试试免费的 **Edge TTS**。

---

## 工具管理

工具让 AI 具备"动手"能力——不只是回答问题，还能执行实际操作（如搜索网页、调用插件功能等）。

<div align="center">
    <img src="./images/agent-tools.png" alt="工具管理" width="300"/>
</div>

### 查看已注册工具

工具来自三个来源：
- **function**：Agent 插件注册的内置工具
- **mcp**：MCP 服务器提供的外部工具
- **plugin**：前端插件桥接的工具

### 启用 / 禁用工具

每个工具都有一个开关，你可以按需启用或禁用。禁用的工具不会出现在 AI 的可用列表中。

> [!WARNING]
> 来自前端插件的工具在执行前需要你确认，详见 [权限审批](Permissions.md)。

---

## MCP 服务器管理

[MCP（Model Context Protocol）](https://modelcontextprotocol.io) 是一种标准协议，允许 AI 连接外部工具服务器。NyaDeskPet 支持接入 MCP 服务器，自动发现并注册工具。

<div align="center">
    <img src="./images/agent-mcp.png" alt="MCP 管理" width="300"/>
</div>

### 添加 MCP 服务器

1. 在 Agent 面板中找到 **MCP 服务器** 区域
2. 点击 **添加** 按钮
3. 选择传输方式：
   - **stdio**：本地命令行工具（需填写命令和参数）
   - **SSE**：远程 HTTP 服务器（需填写 URL）
4. 填写服务器配置并保存

连接成功后，MCP 服务器提供的工具会自动出现在工具列表中。

---

## 角色人设

<div align="center">
    <img src="./images/agent-character.png" alt="角色人设配置" width="300"/>
</div>

在 **设置 → 角色** 标签页中，你可以自定义角色的性格：

1. 启用 **自定义角色** 开关
2. 填写 **角色名称**
3. 在 **人设描述** 中描述你希望角色拥有的性格特征

人设描述会被发送给 AI 作为系统提示词的一部分，影响角色的说话风格和行为方式。

---

## 下一步

- 想更换角色模型？查看 [Live2D 模型配置](ModelConfig.md)
- 想启用语音输入？查看 [ASR 配置](ASRConfig.md)
- 准备好了？开始 [对话](Conversation.md) 吧！
