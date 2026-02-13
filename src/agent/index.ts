/**
 * Agent 模块入口
 * 导出所有公共 API
 */

// Provider 基础层（类型定义、基类、注册表）
export {
  LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type LLMStreamChunk,
  type ChatMessage,
  type TokenUsage,
  type ProviderConfig,
  type ProviderMetadata,
  type ProviderConfigField,
  type ToolCallInfo,
  type ToolDefinitionSchema,
  type ToolChoiceOption,
  providerRegistry,
  registerProvider
} from './provider';

// TTS Provider 基础层
export {
  TTSProvider,
  type TTSRequest,
  type TTSResponse,
  type VoiceInfo,
  ttsProviderRegistry,
  registerTTSProvider
} from './tts-provider';

// 内置 Provider 实现（导入时自动注册）
export {
  OpenAIProvider,
  OPENAI_METADATA
} from './providers';

// 内置 TTS Provider 实现（导入时自动注册）
export {
  FishAudioProvider,
  FISH_AUDIO_METADATA
} from './tts-providers';

// Pipeline 层
export {
  Stage,
  Pipeline,
  PreProcessStage,
  ProcessStage,
  RespondStage
} from './pipeline';

// Context 层
export {
  PipelineContext,
  SessionManager,
  type IncomingMessage,
  type OutgoingMessage,
  type Sendable
} from './context';

// Handler 层
export {
  AgentHandler,
  type ModelInfo,
  type CharacterInfo,
  type TapEventData,
  type ProviderInstanceConfig,
  type ProviderInstanceInfo,
  type TTSProviderInstanceConfig,
  type TTSProviderInstanceInfo
} from './handler';

// 插件系统
export {
  AgentPlugin,
  AgentPluginManager,
  agentPluginManager,
  type AgentPluginMetadata,
  type AgentPluginContext,
  type AgentPluginInfo,
  type PluginProviderInfo,
  type ProviderAccessor,
  type HandlerAccessor,
  type MessageContext,
  type PluginInvokeSender
} from './agent-plugin';

// 数据库层
export {
  AgentDatabase,
  agentDb,
  type ConversationRecord,
  type MessageRecord,
  type MessageType,
  type ToolDefinitionRecord
} from './database';

// 工具系统
export {
  ToolManager,
  toolManager,
  type ToolSchema,
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
  type ToolHandler,
  type OpenAIToolFormat
} from './tools';

// MCP 客户端
export {
  MCPManager,
  mcpManager,
  type MCPServerConfig,
  type MCPServerStatus
} from './mcp-client';

// 指令系统
export {
  commandRegistry,
  type CommandDefinition,
  type CommandParam,
  type CommandHandler,
  type CommandExecuteData,
  type CommandResponseData,
  type CommandsRegisterData
} from './commands';
