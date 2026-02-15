/**
 * Mistral AI Provider
 * 基于 OpenAI 兼容 API，预配置 Mistral AI 平台参数
 * 
 * 支持模型：
 * - mistral-large-latest：旗舰模型，适合复杂推理和多步任务
 * - mistral-small-latest：轻量模型，平衡性能与成本
 * - open-mistral-nemo：开源模型，12B 参数
 * - codestral-latest：代码专用模型
 * - pixtral-large-latest：多模态模型，支持图片理解
 * 
 * 特性：
 * - 完全兼容 OpenAI Chat Completions API
 * - 支持 Function Calling、Vision（Pixtral 系列）、流式输出
 * - JSON Mode 支持
 * - 欧洲公司，注重数据安全
 * 
 * API 文档：https://docs.mistral.ai/api/
 * 获取 API Key：https://console.mistral.ai/api-keys/
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== Mistral Provider 实现 ====================

/**
 * Mistral Provider
 * 继承 OpenAI Provider，预设 Mistral AI 平台的 Base URL
 */
export class MistralProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      config.baseUrl = 'https://api.mistral.ai/v1';
    }
    if (!config.model) {
      config.model = 'mistral-small-latest';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return MISTRAL_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const MISTRAL_METADATA: ProviderMetadata = {
  id: 'mistral',
  name: 'Mistral AI',
  description: 'Mistral AI 官方 API，支持 Mistral Large/Small、Codestral 代码模型、Pixtral 多模态模型，欧洲公司注重数据安全',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'your_api_key',
      description: '从 Mistral AI 控制台获取的 API 密钥（https://console.mistral.ai/api-keys/）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.mistral.ai/v1',
      description: 'Mistral AI API 地址，通常无需修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'mistral-small-latest',
      placeholder: 'mistral-small-latest',
      description: '填写模型 ID，如 mistral-small-latest、mistral-large-latest、codestral-latest'
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

registerProvider(MISTRAL_METADATA, (config) => new MistralProvider(config));
