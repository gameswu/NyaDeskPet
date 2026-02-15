/**
 * 火山引擎（Volcengine）Provider — 豆包大模型
 * 基于 OpenAI 兼容 API，预配置火山引擎方舟平台参数
 * 
 * 特性：
 * - 完全兼容 OpenAI Chat Completions API
 * - 支持 Function Calling、Vision、流式输出
 * - 需要在方舟平台创建「推理接入点」后使用其 Endpoint ID 作为模型参数
 * - 国内访问无需代理
 * 
 * 注意：
 * - 火山引擎使用「推理接入点 ID」（Endpoint ID）作为模型名，而非标准模型名
 * - 用户需先在方舟控制台创建接入点：https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint
 * - API Key 在「API Key 管理」中获取
 * 
 * API 文档：https://www.volcengine.com/docs/82379/1298454
 * 控制台：https://console.volcengine.com/ark
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== Volcengine Provider 实现 ====================

/**
 * Volcengine Provider
 * 继承 OpenAI Provider，预设火山引擎方舟平台的 Base URL
 */
export class VolcengineProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      config.baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return VOLCENGINE_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const VOLCENGINE_METADATA: ProviderMetadata = {
  id: 'volcengine',
  name: '火山引擎（豆包）',
  description: '火山引擎方舟平台，豆包大模型（Doubao），使用推理接入点 ID 访问，支持 Function Calling 和 Vision，国内直连',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'your_api_key',
      description: '从火山引擎方舟平台获取的 API 密钥（https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://ark.cn-beijing.volces.com/api/v3',
      description: '火山引擎方舟 API 地址，通常无需修改'
    },
    {
      key: 'model',
      label: '推理接入点 ID',
      type: 'string',
      required: true,
      placeholder: 'ep-20240901xxxxx-xxxxx',
      description: '在方舟控制台创建的推理接入点 ID（Endpoint ID），非模型名称。创建地址：https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint'
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
      description: 'HTTP/HTTPS 代理（国内一般无需使用）'
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

registerProvider(VOLCENGINE_METADATA, (config) => new VolcengineProvider(config));
