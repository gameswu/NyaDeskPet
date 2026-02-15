/**
 * Groq Provider
 * 基于 OpenAI 兼容 API，预配置 Groq 推理平台参数
 * 
 * 支持模型：
 * - llama-3.3-70b-versatile：Meta Llama 3.3 70B，高性能通用模型
 * - llama-3.1-8b-instant：Meta Llama 3.1 8B，极速推理
 * - deepseek-r1-distill-llama-70b：DeepSeek R1 蒸馏模型，支持推理
 * - qwen-qwq-32b：阿里 QwQ 32B 推理模型
 * - gemma2-9b-it：Google Gemma 2 9B
 * 
 * 特性：
 * - 完全兼容 OpenAI Chat Completions API
 * - 超快推理速度（LPU 推理引擎）
 * - 免费额度可用
 * - 支持 Function Calling、Vision（部分模型）、流式输出
 * 
 * API 文档：https://console.groq.com/docs/api-reference#chat
 * 获取 API Key：https://console.groq.com/keys
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== Groq Provider 实现 ====================

/**
 * Groq Provider
 * 继承 OpenAI Provider，预设 Groq 平台的 Base URL
 */
export class GroqProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      config.baseUrl = 'https://api.groq.com/openai/v1';
    }
    if (!config.model) {
      config.model = 'llama-3.3-70b-versatile';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return GROQ_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const GROQ_METADATA: ProviderMetadata = {
  id: 'groq',
  name: 'Groq',
  description: 'Groq 超快 LPU 推理平台，支持 Llama、DeepSeek、Qwen、Gemma 等开源模型，有免费额度，推理速度极快',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'gsk_...',
      description: '从 Groq 控制台获取的 API 密钥（https://console.groq.com/keys）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.groq.com/openai/v1',
      description: 'Groq API 地址，通常无需修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'llama-3.3-70b-versatile',
      placeholder: 'llama-3.3-70b-versatile',
      description: '填写模型 ID，如 llama-3.3-70b-versatile、llama-3.1-8b-instant。完整列表见 https://console.groq.com/docs/models'
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

registerProvider(GROQ_METADATA, (config) => new GroqProvider(config));
