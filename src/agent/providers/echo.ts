/**
 * Echo Provider — 内置回显
 * 用于框架测试和无 LLM 时的兜底
 */

import {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ProviderConfig,
  ProviderMetadata,
  registerProvider
} from '../provider';

// ==================== Echo Provider 元信息 ====================

export const ECHO_METADATA: ProviderMetadata = {
  id: 'echo',
  name: 'Echo (内置)',
  description: '回显输入消息，不调用任何 AI 服务。用于测试或无 LLM 时的兜底。',
  configSchema: []
};

// ==================== Echo Provider 实现 ====================

/**
 * Echo Provider
 * 简单地回显用户最后一条消息，不调用任何外部服务
 */
export class EchoProvider extends LLMProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return ECHO_METADATA;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const lastUserMessage = request.messages
      .filter(m => m.role === 'user')
      .pop();

    return {
      text: lastUserMessage?.content
        ? `[Echo] ${lastUserMessage.content}`
        : '[Echo] 没有收到消息',
      model: 'echo',
      finishReason: 'stop'
    };
  }

  // Echo Provider 不需要初始化
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  // Echo Provider 测试始终成功
  async test(): Promise<{ success: boolean; error?: string; model?: string }> {
    return { success: true, model: 'echo' };
  }
}

// ==================== 自动注册 ====================

registerProvider(ECHO_METADATA, (config) => new EchoProvider(config));
