/**
 * Google Gemini Provider
 * 通过 Gemini API 的 OpenAI 兼容模式访问 Gemini 系列模型
 * 
 * 支持模型：
 * - gemini-2.5-flash：高性价比多模态模型，支持思考、Vision、Function Calling
 * - gemini-2.5-pro：旗舰推理模型，适合复杂任务
 * - gemini-2.0-flash：快速推理，支持多模态
 * 
 * 特性：
 * - 完整的 OpenAI Chat Completions API 兼容
 * - 流式输出、Function Calling、Vision
 * - 免费额度慷慨（Flash 模型）
 * - 思考/推理模式支持
 * 
 * API 文档：https://ai.google.dev/gemini-api/docs/openai
 * 获取 API Key：https://aistudio.google.com/apikey
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== Gemini Provider 实现 ====================

/**
 * Google Gemini Provider
 * 继承 OpenAI Provider，使用 Gemini 的 OpenAI 兼容端点
 */
export class GeminiProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    // 强制使用 Gemini OpenAI 兼容端点
    if (!config.baseUrl) {
      config.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    }
    if (!config.model) {
      config.model = 'gemini-2.5-flash';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return GEMINI_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const GEMINI_METADATA: ProviderMetadata = {
  id: 'gemini',
  name: 'Google Gemini',
  description: 'Google Gemini 系列模型，支持多模态理解与生成、Function Calling、思考推理，免费额度慷慨',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'AIza...',
      description: '从 Google AI Studio 获取的 API 密钥（https://aistudio.google.com/apikey）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      description: 'Gemini OpenAI 兼容端点，通常无需修改。如需代理可修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'gemini-2.5-flash',
      placeholder: 'gemini-2.5-flash',
      description: '填写模型 ID，如 gemini-2.5-flash、gemini-2.5-pro、gemini-2.0-flash'
    },
    {
      key: 'timeout',
      label: '超时时间（秒）',
      type: 'number',
      required: false,
      default: 60,
      description: '请求超时时间，推理模型建议适当增大'
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

registerProvider(GEMINI_METADATA, (config) => new GeminiProvider(config));
