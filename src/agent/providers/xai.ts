/**
 * xAI（Grok）Provider
 * 基于 OpenAI 兼容 API，预配置 xAI 平台参数
 * 
 * 支持模型：
 * - grok-3：xAI 旗舰模型，强大的推理能力
 * - grok-3-mini：xAI 轻量模型，平衡性能与速度
 * - grok-2：上一代旗舰模型
 * 
 * 特性：
 * - 完全兼容 OpenAI Chat Completions API
 * - 支持 Function Calling、Vision、流式输出
 * - 实时信息获取能力
 * - 支持长上下文
 * 
 * API 文档：https://docs.x.ai/api
 * 获取 API Key：https://console.x.ai/
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== xAI Provider 实现 ====================

/**
 * xAI Provider
 * 继承 OpenAI Provider，预设 xAI 平台的 Base URL
 */
export class XAIProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      config.baseUrl = 'https://api.x.ai/v1';
    }
    if (!config.model) {
      config.model = 'grok-3-mini';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return XAI_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const XAI_METADATA: ProviderMetadata = {
  id: 'xai',
  name: 'xAI（Grok）',
  description: 'xAI 官方 API，Grok 系列模型，强大的推理和实时信息获取能力，支持 Vision 和 Function Calling',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'xai-...',
      description: '从 xAI 控制台获取的 API 密钥（https://console.x.ai/）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.x.ai/v1',
      description: 'xAI API 地址，通常无需修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'grok-3-mini',
      placeholder: 'grok-3-mini',
      description: '填写模型 ID，如 grok-3、grok-3-mini、grok-2'
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

registerProvider(XAI_METADATA, (config) => new XAIProvider(config));
