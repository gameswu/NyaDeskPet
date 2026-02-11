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

// 内置 Provider 实现（导入时自动注册）
export {
  EchoProvider,
  ECHO_METADATA,
  OpenAIProvider,
  OPENAI_METADATA
} from './providers';

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
  type OutgoingMessage
} from './context';

// Handler 层
export {
  AgentHandler,
  type ModelInfo,
  type CharacterInfo,
  type TapEventData
} from './handler';

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
