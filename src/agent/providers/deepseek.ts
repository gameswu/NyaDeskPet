/**
 * DeepSeek Provider
 * 基于 OpenAI 兼容 API，预配置 DeepSeek 平台参数
 * 
 * 支持模型：
 * - deepseek-chat：DeepSeek-V3.2 非思考模式，128K 上下文
 * - deepseek-reasoner：DeepSeek-V3.2 思考模式，128K 上下文（含 reasoning_content）
 * 
 * API 文档：https://api-docs.deepseek.com/zh-cn/
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== DeepSeek Provider 实现 ====================

/**
 * DeepSeek Provider
 * 继承 OpenAI Provider，预设 DeepSeek 平台的 Base URL
 */
export class DeepSeekProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    // 如果用户未设置 baseUrl，使用 DeepSeek 默认地址
    if (!config.baseUrl) {
      config.baseUrl = 'https://api.deepseek.com';
    }
    // 如果用户未设置模型，使用 deepseek-chat
    if (!config.model) {
      config.model = 'deepseek-chat';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return DEEPSEEK_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const DEEPSEEK_METADATA: ProviderMetadata = {
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek 官方 API，支持 deepseek-chat 和 deepseek-reasoner 模型，128K 上下文，支持 Function Calling',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-...',
      description: '从 DeepSeek 平台获取的 API 密钥（https://platform.deepseek.com）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.deepseek.com',
      placeholder: 'https://api.deepseek.com',
      description: 'DeepSeek API 地址，通常无需修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'select',
      required: false,
      default: 'deepseek-chat',
      options: [
        { value: 'deepseek-chat', label: 'deepseek-chat' },
        { value: 'deepseek-reasoner', label: 'deepseek-reasoner' }
      ],
      description: 'deepseek-chat 适合通用对话，deepseek-reasoner 适合复杂推理任务'
    },
    {
      key: 'timeout',
      label: '超时时间（秒）',
      type: 'number',
      required: false,
      default: 60,
      description: '请求超时时间，reasoner 模型建议适当增大'
    },
    {
      key: 'proxy',
      label: '代理地址',
      type: 'string',
      required: false,
      placeholder: 'http://127.0.0.1:7890',
      description: 'HTTP/HTTPS 代理（如需使用）'
    },
    {
      key: 'stream',
      label: '流式输出',
      type: 'boolean',
      required: false,
      default: false,
      description: '启用后 LLM 回复将逐字流式显示，提升响应速度体验'
    }
  ]
};

// ==================== 自动注册 ====================

registerProvider(DEEPSEEK_METADATA, (config) => new DeepSeekProvider(config));
