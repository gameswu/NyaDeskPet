/**
 * 智谱 AI（Zhipu）Provider
 * 基于 OpenAI 兼容 API，预配置智谱 AI 平台参数
 * 
 * 支持模型：
 * - glm-4-plus：GLM-4 增强版，适合复杂任务
 * - glm-4-flash：GLM-4 极速版，免费使用
 * - glm-4-long：GLM-4 长文本版，支持 1M 上下文
 * - glm-4v-plus：GLM-4 视觉增强版，支持图片理解
 * 
 * 特性：
 * - 完全兼容 OpenAI Chat Completions API
 * - 支持 Function Calling、Vision（glm-4v 系列）、流式输出
 * - GLM-4-Flash 免费使用
 * - 国内访问无需代理
 * 
 * API 文档：https://open.bigmodel.cn/dev/howuse/glm-4
 * 获取 API Key：https://open.bigmodel.cn/usercenter/apikeys
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== Zhipu Provider 实现 ====================

/**
 * Zhipu Provider
 * 继承 OpenAI Provider，预设智谱 AI 平台的 Base URL
 */
export class ZhipuProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      config.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
    }
    if (!config.model) {
      config.model = 'glm-4-flash';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return ZHIPU_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const ZHIPU_METADATA: ProviderMetadata = {
  id: 'zhipu',
  name: '智谱 AI（GLM）',
  description: '智谱 AI 开放平台，GLM-4 系列模型，glm-4-flash 免费使用，支持 Vision 和 Function Calling，国内直连',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'your_api_key',
      description: '从智谱 AI 开放平台获取的 API 密钥（https://open.bigmodel.cn/usercenter/apikeys）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://open.bigmodel.cn/api/paas/v4',
      description: '智谱 AI API 地址，通常无需修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'glm-4-flash',
      placeholder: 'glm-4-flash',
      description: '填写模型 ID，如 glm-4-flash、glm-4-plus、glm-4-long、glm-4v-plus'
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

registerProvider(ZHIPU_METADATA, (config) => new ZhipuProvider(config));
