/**
 * LLM Provider 抽象层
 * 参考 AstrBot 的 Provider 架构，提供统一的 LLM 接入接口
 * 
 * 设计原则：
 * - 策略模式：统一接口，多种实现（OpenAI / Anthropic / Ollama 等）
 * - 注册表模式：通过 registerProvider() 声明式注册，无需修改核心代码
 * - 流式支持：同时支持普通请求和流式响应
 * - 生命周期：initialize() → chat/chatStream → terminate()
 * - 配置分离：ProviderConfig（实例配置）与 ProviderSettings（全局设置）
 * 
 * 扩展指南：
 * 1. 继承 LLMProvider 基类
 * 2. 实现 chat() 和/或 chatStream() 方法
 * 3. 调用 registerProvider() 注册
 * 4. 在设置中选择并配置即可使用
 */

import { logger } from '../logger';

// ==================== 核心类型定义 ====================

/** LLM 请求参数（参考 AstrBot 的 ProviderRequest） */
export interface LLMRequest {
  /** 用户消息 */
  messages: ChatMessage[];
  /** 系统提示词（可选，会自动添加到消息头部） */
  systemPrompt?: string;
  /** 温度参数 */
  temperature?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 关联的会话 ID */
  sessionId?: string;
  /** 指定模型（覆盖默认） */
  model?: string;
  /** 可用工具列表（Function Calling） */
  tools?: ToolDefinitionSchema[];
  /** 工具选择策略 */
  toolChoice?: ToolChoiceOption;
}

/** 聊天消息中的图片附件（工具结果多模态） */
export interface ChatMessageImage {
  /** Base64 编码的图片数据 */
  data: string;
  /** MIME 类型（如 image/png、image/jpeg） */
  mimeType: string;
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** 附件（如图片的 base64） */
  attachment?: {
    type: 'image' | 'file';
    data?: string;
    url?: string;
    mimeType?: string;
    fileName?: string;
  };
  /** 图片列表（工具结果多模态，role=tool 时使用） */
  images?: ChatMessageImage[];
  /** 思维链/推理内容（DeepSeek thinking mode 等） */
  reasoningContent?: string;
  /** 工具调用列表（role=assistant 时，模型请求调用工具） */
  toolCalls?: ToolCallInfo[];
  /** 工具调用 ID（role=tool 时，标识这是哪个调用的结果） */
  toolCallId?: string;
  /** 工具名称（role=tool 时，标识这是哪个工具的结果） */
  toolName?: string;
  /** 标记为斜杠指令消息（不参与 LLM 上下文） */
  isCommand?: boolean;
}

/** 工具调用信息（LLM 返回的） */
export interface ToolCallInfo {
  /** 调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 调用参数（JSON 字符串或已解析的对象） */
  arguments: string | Record<string, unknown>;
}

/** 工具定义（发送给 LLM 的 JSON Schema） */
export interface ToolDefinitionSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 工具选择策略 */
export type ToolChoiceOption = 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };

/** Token 用量信息（参考 AstrBot 的 TokenUsage） */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** LLM 响应（参考 AstrBot 的 LLMResponse） */
export interface LLMResponse {
  /** 回复文本 */
  text: string;
  /** token 用量信息 */
  usage?: TokenUsage;
  /** 模型名称 */
  model?: string;
  /** 完成原因（'stop' | 'tool_calls' | 'length' 等） */
  finishReason?: string;
  /** 思维链/推理内容（支持 o1、DeepSeek-R1 等模型） */
  reasoningContent?: string;
  /** 工具调用列表（finishReason='tool_calls' 时） */
  toolCalls?: ToolCallInfo[];
}

/** 流式响应的增量块 */
export interface LLMStreamChunk {
  /** 增量文本 */
  delta: string;
  /** 是否为最后一块 */
  done: boolean;
  /** 完成时的 usage（仅最后一块包含） */
  usage?: TokenUsage;
  /** 思维链增量（如有） */
  reasoningDelta?: string;
  /** 完成原因（最后一块可能包含） */
  finishReason?: string;
  /** 工具调用增量（流式 Function Calling） */
  toolCallDeltas?: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  }>;
}

/** Provider 配置（通用，参考 AstrBot 的 provider_config 字典） */
export interface ProviderConfig {
  /** Provider 唯一 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** API 密钥 */
  apiKey?: string;
  /** API 基础 URL */
  baseUrl?: string;
  /** 使用的模型名称 */
  model?: string;
  /** 请求超时（秒） */
  timeout?: number;
  /** 代理地址（如 http://127.0.0.1:7890） */
  proxy?: string;
  /** 额外配置 */
  [key: string]: unknown;
}

/** Provider 元信息（注册时使用，参考 AstrBot 的 ProviderMetaData） */
export interface ProviderMetadata {
  /** 唯一标识符 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 配置 schema，用于生成 UI */
  configSchema: ProviderConfigField[];
}

/** 配置字段描述（用于动态生成设置 UI） */
export interface ProviderConfigField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'number' | 'select' | 'boolean';
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

// ==================== Provider 基类 ====================

/**
 * LLM Provider 抽象基类
 * 参考 AstrBot 的 Provider / AbstractProvider 设计
 * 所有 LLM 接入方必须继承此类并实现核心方法
 * 
 * 生命周期：constructor → initialize → chat/chatStream → terminate
 */
export abstract class LLMProvider {
  protected config: ProviderConfig;
  /** 当前模型名 */
  protected modelName: string = '';
  /** 是否已初始化 */
  protected initialized: boolean = false;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.modelName = config.model || '';
  }

  /** 获取 Provider 元信息 */
  abstract getMetadata(): ProviderMetadata;

  /** 
   * 普通聊天请求（参考 AstrBot 的 text_chat）
   * @returns 完整的 LLM 响应
   */
  abstract chat(request: LLMRequest): Promise<LLMResponse>;

  /**
   * 流式聊天请求（参考 AstrBot 的 text_chat_stream）
   * 默认回退到普通 chat
   * @returns 异步迭代器，逐块返回响应
   */
  async *chatStream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    // 默认实现：调用普通 chat 然后一次性返回
    const response = await this.chat(request);
    yield {
      delta: response.text,
      done: true,
      usage: response.usage
    };
  }

  /**
   * 初始化 Provider（可选，参考 AstrBot 的 HasInitialize）
   * 用于延迟初始化 HTTP 客户端、验证配置等
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * 销毁 Provider（可选，参考 AstrBot 的 terminate）
   * 用于清理 HTTP 客户端、关闭连接等
   */
  async terminate(): Promise<void> {
    this.initialized = false;
  }

  /** 测试连接是否正常（参考 AstrBot 的 test） */
  async test(): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      const resp = await this.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10
      });
      return { success: true, model: resp.model };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 获取可用模型列表（参考 AstrBot 的 get_models）
   * 默认返回空数组，子类可覆盖以动态获取
   */
  async getModels(): Promise<string[]> {
    return this.modelName ? [this.modelName] : [];
  }

  /** 设置模型（参考 AstrBot 的 set_model） */
  setModel(model: string): void {
    this.modelName = model;
    this.config.model = model;
  }

  /** 获取当前模型名（参考 AstrBot 的 get_model） */
  getModel(): string {
    return this.modelName;
  }

  /** 更新配置 */
  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.model !== undefined) {
      this.modelName = config.model;
    }
  }

  /** 获取当前配置 */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  /** 获取配置值，带默认值 */
  protected getConfigValue<T>(key: string, defaultValue: T): T {
    const val = this.config[key];
    return (val !== undefined && val !== null && val !== '') ? val as T : defaultValue;
  }
}

// ==================== Provider 注册表 ====================

/** Provider 工厂函数类型 */
type ProviderFactory = (config: ProviderConfig) => LLMProvider;

interface ProviderRegistryEntry {
  metadata: ProviderMetadata;
  factory: ProviderFactory;
}

/**
 * Provider 注册表（单例）
 * 参考 AstrBot 的 provider_cls_map + ProviderManager 设计
 */
class ProviderRegistry {
  private entries: Map<string, ProviderRegistryEntry> = new Map();

  /** 注册一个 Provider */
  register(metadata: ProviderMetadata, factory: ProviderFactory): void {
    if (this.entries.has(metadata.id)) {
      logger.warn(`[ProviderRegistry] Provider "${metadata.id}" 已存在，将被覆盖`);
    }
    this.entries.set(metadata.id, { metadata, factory });
    logger.info(`[ProviderRegistry] 已注册 Provider: ${metadata.id} (${metadata.name})`);
  }

  /** 注销一个 Provider */
  unregister(id: string): void {
    this.entries.delete(id);
  }

  /** 创建 Provider 实例 */
  create(id: string, config: ProviderConfig): LLMProvider | null {
    const entry = this.entries.get(id);
    if (!entry) {
      logger.error(`[ProviderRegistry] 未找到 Provider: ${id}`);
      return null;
    }
    return entry.factory(config);
  }

  /** 获取所有已注册的 Provider 元信息 */
  getAll(): ProviderMetadata[] {
    return Array.from(this.entries.values()).map(e => e.metadata);
  }

  /** 获取指定 Provider 的元信息 */
  get(id: string): ProviderMetadata | undefined {
    return this.entries.get(id)?.metadata;
  }

  /** 是否已注册 */
  has(id: string): boolean {
    return this.entries.has(id);
  }
}

/** 全局 Provider 注册表实例 */
export const providerRegistry = new ProviderRegistry();

/**
 * 通用 Provider 能力声明字段
 * 所有 Provider 的 configSchema 末尾应展开此数组，让用户声明模型支持的能力
 */
export const PROVIDER_CAPABILITY_FIELDS: ProviderConfigField[] = [
  {
    key: 'supportsText',
    label: '文字',
    type: 'boolean',
    required: false,
    default: true,
    description: '模型支持文字输入/输出'
  },
  {
    key: 'supportsVision',
    label: '图片',
    type: 'boolean',
    required: false,
    default: false,
    description: '模型支持图片输入（Vision）'
  },
  {
    key: 'supportsFile',
    label: '文件',
    type: 'boolean',
    required: false,
    default: false,
    description: '模型支持文件输入（如 PDF、文档等）'
  },
  {
    key: 'supportsToolCalling',
    label: '工具调用',
    type: 'boolean',
    required: false,
    default: true,
    description: '模型支持 Function Calling / Tool Use'
  }
];

/**
 * 注册 Provider 的便捷函数
 * 
 * @example
 * ```ts
 * registerProvider(
 *   { id: 'openai', name: 'OpenAI', description: 'OpenAI API', configSchema: [...] },
 *   (config) => new OpenAIProvider(config)
 * );
 * ```
 */
export function registerProvider(metadata: ProviderMetadata, factory: ProviderFactory): void {
  providerRegistry.register(metadata, factory);
}
