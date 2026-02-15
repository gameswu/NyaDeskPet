/**
 * Anthropic（Claude）Provider
 * 使用 Anthropic Messages API 原生格式，非 OpenAI 兼容
 * 
 * 支持模型：
 * - claude-sonnet-4-20250514：Claude Sonnet 4，平衡性能与成本（推荐）
 * - claude-opus-4-20250514：Claude Opus 4，旗舰推理模型
 * - claude-haiku-3-5-20241022：Claude Haiku 3.5，极速轻量模型
 * 
 * 与 OpenAI API 的关键差异：
 * - 认证：使用 x-api-key 头（非 Bearer Token）
 * - 系统提示词：单独的 system 字段（非 messages 数组中的 system 角色）
 * - 消息角色：仅 user/assistant（工具结果以 user 角色 + tool_result 内容块发送）
 * - 工具定义：{ name, description, input_schema }（非 { type: "function", function: {...} }）
 * - 响应格式：content 为块数组 [{type:"text",...}, {type:"tool_use",...}]
 * - 用量字段：input_tokens / output_tokens（非 prompt_tokens / completion_tokens）
 * - 停止原因：stop_reason（非 finish_reason），end_turn / tool_use / max_tokens
 * - 流式事件：message_start → content_block_start → content_block_delta → content_block_stop → message_delta → message_stop
 * 
 * API 文档：https://docs.anthropic.com/en/api/messages
 * 获取 API Key：https://console.anthropic.com/settings/keys
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
  ToolCallInfo,
  ToolDefinitionSchema,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { logger } from '../../logger';

// ==================== Anthropic API 类型 ====================

/** Anthropic 消息内容块 */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] };

/** Anthropic 消息 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/** Anthropic 工具定义 */
interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Anthropic 请求体 */
interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

/** Anthropic 响应 */
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/** Anthropic 流式事件 */
interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: {
    output_tokens: number;
  };
}

// ==================== Anthropic Provider 实现 ====================

/**
 * Anthropic Provider
 * 使用 Anthropic Messages API 原生格式
 */
export class AnthropicProvider extends LLMProvider {
  private client: AxiosInstance | null = null;

  constructor(config: ProviderConfig) {
    super(config);
    if (!config.model) {
      this.modelName = 'claude-sonnet-4-20250514';
      config.model = this.modelName;
    }
  }

  getMetadata(): ProviderMetadata {
    return ANTHROPIC_METADATA;
  }

  /**
   * 初始化 HTTP 客户端
   */
  async initialize(): Promise<void> {
    const baseURL = this.getConfigValue('baseUrl', 'https://api.anthropic.com');
    const timeout = this.getConfigValue('timeout', 120) * 1000;
    const proxy = this.getConfigValue<string | undefined>('proxy', undefined);

    const axiosConfig: AxiosRequestConfig = {
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      }
    };

    if (proxy) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
      logger.info(`[AnthropicProvider] 使用代理: ${proxy}`);
    }

    this.client = axios.create(axiosConfig);

    // 添加请求拦截器，注入 API Key（使用 x-api-key 头）
    this.client.interceptors.request.use((config) => {
      const apiKey = this.config.apiKey;
      if (apiKey) {
        config.headers['x-api-key'] = apiKey;
      }
      return config;
    });

    this.initialized = true;
    logger.info(`[AnthropicProvider] 初始化完成，baseURL: ${baseURL}`);
  }

  async terminate(): Promise<void> {
    this.client = null;
    this.initialized = false;
    logger.info('[AnthropicProvider] 已销毁');
  }

  private ensureClient(): AxiosInstance {
    if (!this.client) {
      throw new Error('Anthropic Provider 未初始化，请先调用 initialize()');
    }
    return this.client;
  }

  /**
   * 转换内部消息格式为 Anthropic 格式
   * Anthropic 仅支持 user/assistant 角色，系统提示词单独传递
   */
  private convertMessages(messages: ChatMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic 不在 messages 中使用 system 角色，已通过 system 字段传递
        continue;
      }

      if (msg.role === 'tool') {
        // 工具结果转为 user 角色 + tool_result 内容块
        const toolResultContent: AnthropicContentBlock[] = [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId || '',
            content: msg.content
          }
        ];

        // 如果有图片，将图片嵌入 tool_result 的 content 中
        if (msg.images && msg.images.length > 0) {
          const innerContent: AnthropicContentBlock[] = [
            { type: 'text', text: msg.content }
          ];
          for (const img of msg.images) {
            innerContent.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.mimeType,
                data: img.data
              }
            });
          }
          toolResultContent[0] = {
            type: 'tool_result',
            tool_use_id: msg.toolCallId || '',
            content: innerContent
          };
        }

        // Anthropic 要求 tool_result 必须紧跟在 assistant（tool_use）之后，以 user 角色发送
        // 如果上一条也是 user（多个工具结果），则合并到同一条 user 消息中
        const lastMsg = result[result.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as AnthropicContentBlock[]).push(...toolResultContent);
        } else {
          result.push({ role: 'user', content: toolResultContent });
        }
        continue;
      }

      if (msg.role === 'assistant') {
        const blocks: AnthropicContentBlock[] = [];

        // 文本内容
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }

        // 工具调用转为 tool_use 内容块
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            let input: Record<string, unknown>;
            if (typeof tc.arguments === 'string') {
              try {
                input = JSON.parse(tc.arguments);
              } catch {
                input = { raw: tc.arguments };
              }
            } else {
              input = tc.arguments;
            }
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input
            });
          }
        }

        if (blocks.length > 0) {
          result.push({ role: 'assistant', content: blocks });
        } else {
          result.push({ role: 'assistant', content: msg.content || '' });
        }
        continue;
      }

      // user 消息
      if (msg.attachment?.type === 'image') {
        // 多模态消息（Vision）
        const blocks: AnthropicContentBlock[] = [
          { type: 'text', text: msg.content }
        ];

        if (msg.attachment.data) {
          blocks.unshift({
            type: 'image',
            source: {
              type: 'base64',
              media_type: msg.attachment.mimeType || 'image/png',
              data: msg.attachment.data
            }
          });
        }

        result.push({ role: 'user', content: blocks });
      } else {
        result.push({ role: 'user', content: msg.content });
      }
    }

    return result;
  }

  /**
   * 转换 OpenAI 格式的工具定义为 Anthropic 格式
   */
  private convertTools(tools: ToolDefinitionSchema[]): AnthropicToolDefinition[] {
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }));
  }

  /**
   * 转换 Anthropic 停止原因为内部格式
   */
  private convertStopReason(stopReason: string | null): string | undefined {
    if (!stopReason) return undefined;
    switch (stopReason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_calls';
      case 'max_tokens': return 'length';
      case 'stop_sequence': return 'stop';
      default: return stopReason;
    }
  }

  /**
   * 从 Anthropic 响应中提取文本和工具调用
   */
  private parseResponseContent(content: AnthropicContentBlock[]): {
    text: string;
    toolCalls?: ToolCallInfo[];
  } {
    let text = '';
    const toolCalls: ToolCallInfo[] = [];

    for (const block of content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        });
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }

  /**
   * 普通聊天请求
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const client = this.ensureClient();
    const model = request.model || this.modelName;

    const requestBody: AnthropicRequestBody = {
      model,
      messages: this.convertMessages(request.messages),
      max_tokens: request.maxTokens || 4096,
      stream: false
    };

    // 系统提示词（Anthropic 使用独立的 system 字段）
    if (request.systemPrompt) {
      requestBody.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    // Function Calling
    if (request.tools && request.tools.length > 0) {
      requestBody.tools = this.convertTools(request.tools);
      if (request.toolChoice) {
        requestBody.tool_choice = this.convertToolChoice(request.toolChoice);
      }
    }

    try {
      logger.debug(`[AnthropicProvider] 发送请求: model=${model}`);

      const response = await client.post<AnthropicResponse>('/v1/messages', requestBody);
      const data = response.data;
      const { text, toolCalls } = this.parseResponseContent(data.content);

      return {
        text,
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens
        },
        model: data.model,
        finishReason: this.convertStopReason(data.stop_reason),
        toolCalls
      };
    } catch (error) {
      this.handleApiError(error);
      throw error;
    }
  }

  /**
   * 转换工具选择策略
   */
  private convertToolChoice(choice: LLMRequest['toolChoice']): AnthropicRequestBody['tool_choice'] {
    if (!choice) return undefined;
    if (choice === 'auto') return { type: 'auto' };
    if (choice === 'required') return { type: 'any' };
    if (choice === 'none') return undefined; // Anthropic 不支持 none，直接不传 tools
    if (typeof choice === 'object' && choice.type === 'function') {
      return { type: 'tool', name: choice.function.name };
    }
    return { type: 'auto' };
  }

  /**
   * 流式聊天请求
   * Anthropic 使用自己的 SSE 事件格式：
   * - message_start: 消息开始，包含初始 usage
   * - content_block_start: 内容块开始（text 或 tool_use）
   * - content_block_delta: 内容块增量
   * - content_block_stop: 内容块结束
   * - message_delta: 消息级别增量（stop_reason, usage）
   * - message_stop: 消息结束
   */
  async *chatStream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const client = this.ensureClient();
    const model = request.model || this.modelName;

    const requestBody: AnthropicRequestBody = {
      model,
      messages: this.convertMessages(request.messages),
      max_tokens: request.maxTokens || 4096,
      stream: true
    };

    if (request.systemPrompt) {
      requestBody.system = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      requestBody.tools = this.convertTools(request.tools);
      if (request.toolChoice) {
        requestBody.tool_choice = this.convertToolChoice(request.toolChoice);
      }
    }

    try {
      logger.debug(`[AnthropicProvider] 发送流式请求: model=${model}`);

      const response = await client.post('/v1/messages', requestBody, {
        responseType: 'stream'
      });

      const stream = response.data;
      let buffer = '';
      let inputTokens = 0;
      let outputTokens = 0;

      // 追踪当前内容块的状态
      const activeToolCalls: Map<number, { id: string; name: string; jsonAccumulator: string }> = new Map();

      for await (const chunk of stream) {
        buffer += chunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          // 解析 SSE 事件
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);

            try {
              const event: AnthropicStreamEvent = JSON.parse(data);

              switch (event.type) {
                case 'message_start': {
                  // 记录初始 usage
                  if (event.message?.usage) {
                    inputTokens = event.message.usage.input_tokens;
                  }
                  break;
                }

                case 'content_block_start': {
                  if (event.content_block?.type === 'tool_use' && event.index !== undefined) {
                    const block = event.content_block as { type: 'tool_use'; id: string; name: string };
                    activeToolCalls.set(event.index, {
                      id: block.id,
                      name: block.name,
                      jsonAccumulator: ''
                    });
                    // 发送工具调用开始信号
                    yield {
                      delta: '',
                      done: false,
                      toolCallDeltas: [{
                        index: event.index,
                        id: block.id,
                        name: block.name,
                        arguments: ''
                      }]
                    };
                  }
                  break;
                }

                case 'content_block_delta': {
                  if (event.delta?.type === 'text_delta' && event.delta.text) {
                    yield {
                      delta: event.delta.text,
                      done: false
                    };
                  } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json && event.index !== undefined) {
                    const tc = activeToolCalls.get(event.index);
                    if (tc) {
                      tc.jsonAccumulator += event.delta.partial_json;
                      yield {
                        delta: '',
                        done: false,
                        toolCallDeltas: [{
                          index: event.index,
                          arguments: event.delta.partial_json
                        }]
                      };
                    }
                  }
                  break;
                }

                case 'content_block_stop': {
                  // 内容块结束，无需特殊处理
                  break;
                }

                case 'message_delta': {
                  // 消息级别增量，包含 stop_reason 和 output_tokens
                  if (event.usage) {
                    outputTokens = event.usage.output_tokens;
                  }
                  if (event.delta?.stop_reason) {
                    const finishReason = this.convertStopReason(event.delta.stop_reason);
                    yield {
                      delta: '',
                      done: false,
                      finishReason
                    };
                  }
                  break;
                }

                case 'message_stop': {
                  // 消息结束
                  yield {
                    delta: '',
                    done: true,
                    usage: {
                      promptTokens: inputTokens,
                      completionTokens: outputTokens,
                      totalTokens: inputTokens + outputTokens
                    }
                  };
                  return;
                }
              }
            } catch {
              // 忽略解析错误，继续处理
            }
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
   */
  async getModels(): Promise<string[]> {
    // Anthropic 没有 /models 端点，返回硬编码列表
    return [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-3-5-20241022',
    ];
  }

  /**
   * 测试连接
   */
  async test(): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // 发送一个简短的测试请求
      const response = await this.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 10
      });

      return { success: true, model: response.model };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 处理 API 错误
   */
  private handleApiError(error: unknown): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: { type?: string; message?: string } }>;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data;
        const message = data?.error?.message || axiosError.message;
        const errorType = data?.error?.type || '';

        if (status === 401) {
          logger.error('[AnthropicProvider] API Key 无效');
          throw new Error('Anthropic API Key 无效或已过期');
        } else if (status === 429) {
          logger.error('[AnthropicProvider] 请求频率过高或配额已用尽');
          throw new Error('请求频率过高或配额已用尽');
        } else if (status === 529) {
          // Anthropic 特有：API 过载
          logger.error('[AnthropicProvider] API 过载');
          throw new Error('Anthropic API 暂时过载，请稍后重试');
        } else if (status >= 500) {
          logger.error(`[AnthropicProvider] 服务器错误: ${status}`);
          throw new Error(`Anthropic 服务暂时不可用 (${status})`);
        } else {
          logger.error(`[AnthropicProvider] API 错误: ${status} [${errorType}] - ${message}`);
          throw new Error(message);
        }
      } else if (axiosError.code === 'ECONNABORTED') {
        logger.error('[AnthropicProvider] 请求超时');
        throw new Error('请求超时，请检查网络连接或增加超时时间');
      } else if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED') {
        logger.error('[AnthropicProvider] 无法连接到 API 服务器');
        throw new Error('无法连接到 Anthropic API 服务器，请检查网络或代理设置');
      }
    }

    logger.error(`[AnthropicProvider] 未知错误: ${(error as Error).message}`);
  }
}

// ==================== Provider 元信息 ====================

export const ANTHROPIC_METADATA: ProviderMetadata = {
  id: 'anthropic',
  name: 'Anthropic（Claude）',
  description: 'Anthropic 官方 API，Claude Sonnet/Opus/Haiku 系列模型，业界领先的推理和代码能力，支持 Vision 和 Function Calling',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-ant-...',
      description: '从 Anthropic 控制台获取的 API 密钥（https://console.anthropic.com/settings/keys）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.anthropic.com',
      description: 'Anthropic API 地址。如需代理可修改此地址'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'claude-sonnet-4-20250514',
      placeholder: 'claude-sonnet-4-20250514',
      description: '填写模型 ID，如 claude-sonnet-4-20250514、claude-opus-4-20250514、claude-haiku-3-5-20241022'
    },
    {
      key: 'timeout',
      label: '超时时间（秒）',
      type: 'number',
      required: false,
      default: 120,
      description: '请求超时时间，Opus 模型建议适当增大'
    },
    {
      key: 'proxy',
      label: '代理地址',
      type: 'string',
      required: false,
      placeholder: 'http://127.0.0.1:7890',
      description: 'HTTP/HTTPS 代理（如需翻墙访问）'
    },
    {
      key: 'stream',
      label: '流式输出',
      type: 'boolean',
      required: false,
      default: false,
      description: '启用后 LLM 回复将逐字流式显示，提升响应速度体验'
    },
    ...PROVIDER_CAPABILITY_FIELDS
  ]
};

// ==================== 自动注册 ====================

registerProvider(ANTHROPIC_METADATA, (config) => new AnthropicProvider(config));
