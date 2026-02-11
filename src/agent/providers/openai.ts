/**
 * OpenAI 兼容 Provider
 * 支持 OpenAI API 及所有兼容接口（如 Azure OpenAI, Moonshot, DeepSeek, Groq 等）
 * 
 * 参考 AstrBot 的 ProviderOpenAIOfficial 设计
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
  ProviderMetadata,
  ChatMessage,
  TokenUsage,
  ToolCallInfo,
  ToolDefinitionSchema,
  registerProvider
} from '../provider';
import { logger } from '../../logger';

// ==================== OpenAI API 类型 ====================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  /** 工具调用列表（assistant 角色） */
  tool_calls?: OpenAIToolCall[];
  /** 工具调用 ID（tool 角色） */
  tool_call_id?: string;
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  /** Function Calling: 可用工具列表 */
  tools?: ToolDefinitionSchema[];
  /** Function Calling: 工具选择策略 */
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}

/** OpenAI 工具调用格式 */
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChoice {
  index: number;
  message?: {
    role: string;
    content: string | null;
    reasoning_content?: string; // DeepSeek-R1 等模型的思维链
    tool_calls?: OpenAIToolCall[];
  };
  delta?: {
    role?: string;
    content?: string | null;
    reasoning_content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finish_reason?: string;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

// ==================== OpenAI Provider 实现 ====================

/**
 * OpenAI 兼容 Provider
 * 支持标准 OpenAI Chat Completions API
 */
export class OpenAIProvider extends LLMProvider {
  private client: AxiosInstance | null = null;
  private cachedModels: string[] = [];

  constructor(config: ProviderConfig) {
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return OPENAI_METADATA;
  }

  /**
   * 初始化 HTTP 客户端
   */
  async initialize(): Promise<void> {
    const baseURL = this.getConfigValue('baseUrl', 'https://api.openai.com/v1');
    const timeout = this.getConfigValue('timeout', 60) * 1000; // 转换为毫秒
    const proxy = this.getConfigValue<string | undefined>('proxy', undefined);
    
    const axiosConfig: AxiosRequestConfig = {
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    // 配置代理
    if (proxy) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
      logger.info(`[OpenAIProvider] 使用代理: ${proxy}`);
    }

    this.client = axios.create(axiosConfig);
    
    // 添加请求拦截器，注入 API Key
    this.client.interceptors.request.use((config) => {
      const apiKey = this.config.apiKey;
      if (apiKey) {
        config.headers.Authorization = `Bearer ${apiKey}`;
      }
      return config;
    });

    this.initialized = true;
    logger.info(`[OpenAIProvider] 初始化完成，baseURL: ${baseURL}`);
  }

  /**
   * 销毁客户端
   */
  async terminate(): Promise<void> {
    this.client = null;
    this.initialized = false;
    logger.info('[OpenAIProvider] 已销毁');
  }

  /**
   * 确保客户端已初始化
   */
  private ensureClient(): AxiosInstance {
    if (!this.client) {
      throw new Error('OpenAI Provider 未初始化，请先调用 initialize()');
    }
    return this.client;
  }

  /**
   * 转换内部消息格式为 OpenAI 格式
   */
  private convertMessages(messages: ChatMessage[], systemPrompt?: string): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    // 添加系统提示词（如果有）
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      // 工具结果消息（role=tool）
      if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId
        });
        continue;
      }

      // 助手消息带 tool_calls
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
            }
          }))
        });
        continue;
      }

      if (msg.attachment?.type === 'image') {
        // 多模态消息（Vision）
        const parts: OpenAIContentPart[] = [
          { type: 'text', text: msg.content }
        ];

        if (msg.attachment.data) {
          // Base64 图片
          const mimeType = msg.attachment.mimeType || 'image/png';
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${msg.attachment.data}`,
              detail: 'auto'
            }
          });
        } else if (msg.attachment.url) {
          // URL 图片
          parts.push({
            type: 'image_url',
            image_url: {
              url: msg.attachment.url,
              detail: 'auto'
            }
          });
        }

        result.push({ role: msg.role, content: parts });
      } else {
        // 普通文本消息
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }

  /**
   * 转换 OpenAI Usage 为内部格式
   */
  private convertUsage(usage?: OpenAIUsage): TokenUsage | undefined {
    if (!usage) return undefined;
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    };
  }

  /**
   * 普通聊天请求
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const client = this.ensureClient();
    const model = request.model || this.modelName;

    const requestBody: OpenAIRequestBody = {
      model,
      messages: this.convertMessages(request.messages, request.systemPrompt),
      stream: false
    };

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      requestBody.max_tokens = request.maxTokens;
    }

    // Function Calling: 添加工具定义
    if (request.tools && request.tools.length > 0) {
      requestBody.tools = request.tools;
      if (request.toolChoice) {
        requestBody.tool_choice = request.toolChoice;
      }
    }

    try {
      logger.debug(`[OpenAIProvider] 发送请求: model=${model}`);
      
      const response = await client.post<OpenAIResponse>('/chat/completions', requestBody);
      const data = response.data;
      const choice = data.choices[0];

      // 解析 tool_calls
      let toolCalls: ToolCallInfo[] | undefined;
      if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
        toolCalls = choice.message.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments
        }));
      }

      return {
        text: choice.message?.content || '',
        usage: this.convertUsage(data.usage),
        model: data.model,
        finishReason: choice.finish_reason || undefined,
        reasoningContent: choice.message?.reasoning_content,
        toolCalls
      };
    } catch (error) {
      this.handleApiError(error);
      throw error; // 重新抛出
    }
  }

  /**
   * 流式聊天请求
   */
  async *chatStream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const client = this.ensureClient();
    const model = request.model || this.modelName;

    const requestBody: OpenAIRequestBody = {
      model,
      messages: this.convertMessages(request.messages, request.systemPrompt),
      stream: true
    };

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      requestBody.max_tokens = request.maxTokens;
    }

    // Function Calling: 添加工具定义
    if (request.tools && request.tools.length > 0) {
      requestBody.tools = request.tools;
      if (request.toolChoice) {
        requestBody.tool_choice = request.toolChoice;
      }
    }

    try {
      logger.debug(`[OpenAIProvider] 发送流式请求: model=${model}`);

      const response = await client.post('/chat/completions', requestBody, {
        responseType: 'stream'
      });

      const stream = response.data;
      let buffer = '';

      for await (const chunk of stream) {
        buffer += chunk.toString();
        
        // 处理 SSE 格式
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留未完成的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          
          const data = trimmed.slice(6); // 移除 "data: " 前缀
          if (data === '[DONE]') {
            yield { delta: '', done: true };
            return;
          }

          try {
            const parsed: OpenAIResponse = JSON.parse(data);
            const choice = parsed.choices[0];
            
            if (choice?.delta) {
              const delta = choice.delta.content || '';
              const reasoningDelta = choice.delta.reasoning_content;
              
              // 流式工具调用增量
              let toolCallDeltas: LLMStreamChunk['toolCallDeltas'];
              if (choice.delta.tool_calls) {
                toolCallDeltas = choice.delta.tool_calls.map(tc => ({
                  index: tc.index,
                  id: tc.id,
                  name: tc.function?.name,
                  arguments: tc.function?.arguments
                }));
              }

              yield {
                delta,
                done: false,
                reasoningDelta,
                finishReason: choice.finish_reason || undefined,
                toolCallDeltas
              };
            }

            // 最后一个 chunk 可能包含 usage
            if (parsed.usage) {
              yield {
                delta: '',
                done: true,
                usage: this.convertUsage(parsed.usage)
              };
              return;
            }
          } catch {
            // 忽略解析错误，继续处理
          }
        }
      }

      // 流结束
      yield { delta: '', done: true };
    } catch (error) {
      this.handleApiError(error);
      throw error;
    }
  }

  /**
   * 获取可用模型列表
   * 严格从 API 返回模型列表，不使用硬编码兜底
   */
  async getModels(): Promise<string[]> {
    // 如果有缓存，直接返回
    if (this.cachedModels.length > 0) {
      return this.cachedModels;
    }

    const client = this.ensureClient();
    const response = await client.get<OpenAIModelsResponse>('/models');
    
    // 返回所有模型 ID，按字母排序
    this.cachedModels = response.data.data
      .map(m => m.id)
      .sort();

    logger.info(`[OpenAIProvider] 获取到 ${this.cachedModels.length} 个模型`);
    return this.cachedModels;
  }

  /**
   * 测试连接
   */
  async test(): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // 尝试获取模型列表来验证 API Key
      const models = await this.getModels();
      
      if (models.length === 0) {
        return { success: false, error: 'API 返回的模型列表为空' };
      }

      // 使用配置的模型或第一个可用模型
      const testModel = this.modelName || models[0];
      
      return { 
        success: true, 
        model: testModel
      };
    } catch (error) {
      return { 
        success: false, 
        error: (error as Error).message 
      };
    }
  }

  /**
   * 处理 API 错误
   */
  private handleApiError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: { message?: string; type?: string } }>;
      
      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data;
        const message = data?.error?.message || axiosError.message;
        
        if (status === 401) {
          logger.error('[OpenAIProvider] API Key 无效或已过期');
          throw new Error('API Key 无效或已过期');
        } else if (status === 429) {
          logger.error('[OpenAIProvider] 请求频率过高或配额已用尽');
          throw new Error('请求频率过高或配额已用尽');
        } else if (status === 500 || status === 502 || status === 503) {
          logger.error(`[OpenAIProvider] 服务器错误: ${status}`);
          throw new Error(`OpenAI 服务暂时不可用 (${status})`);
        } else {
          logger.error(`[OpenAIProvider] API 错误: ${status} - ${message}`);
          throw new Error(message);
        }
      } else if (axiosError.code === 'ECONNABORTED') {
        logger.error('[OpenAIProvider] 请求超时');
        throw new Error('请求超时，请检查网络连接或增加超时时间');
      } else if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED') {
        logger.error('[OpenAIProvider] 无法连接到 API 服务器');
        throw new Error('无法连接到 API 服务器，请检查网络或代理设置');
      }
    }
    
    logger.error(`[OpenAIProvider] 未知错误: ${(error as Error).message}`);
  }
}

// ==================== Provider 元信息 ====================

export const OPENAI_METADATA: ProviderMetadata = {
  id: 'openai',
  name: 'OpenAI / 兼容 API',
  description: '支持 OpenAI API 及所有兼容接口（如 DeepSeek, Moonshot, Groq, 硅基流动等）',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-...',
      description: '从 OpenAI 或兼容服务商获取的 API 密钥'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.openai.com/v1',
      placeholder: 'https://api.openai.com/v1',
      description: '兼容 API 地址（如 https://api.deepseek.com/v1）'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'gpt-4o-mini',
      placeholder: 'gpt-4o-mini',
      description: '要使用的模型名称'
    },
    {
      key: 'timeout',
      label: '超时时间（秒）',
      type: 'number',
      required: false,
      default: 60,
      description: '请求超时时间'
    },
    {
      key: 'proxy',
      label: '代理地址',
      type: 'string',
      required: false,
      placeholder: 'http://127.0.0.1:7890',
      description: 'HTTP/HTTPS 代理（如需翻墙访问）'
    }
  ]
};

// ==================== 自动注册 ====================

registerProvider(OPENAI_METADATA, (config) => new OpenAIProvider(config));
