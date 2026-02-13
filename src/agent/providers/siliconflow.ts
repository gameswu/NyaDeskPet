/**
 * SiliconFlow（硅基流动）Provider
 * 基于 OpenAI 兼容 API，预配置 SiliconFlow 平台参数
 * 
 * 支持模型：
 * - DeepSeek 系列：DeepSeek-V3、DeepSeek-R1 等
 * - Qwen 系列：Qwen2.5、Qwen3 等
 * - GLM 系列：GLM-4 等
 * - 更多模型请查看 SiliconFlow 平台
 * 
 * 特性：
 * - OpenAI 兼容 API，完美复用 OpenAI Provider 逻辑
 * - 支持 Function Calling / Tool Use
 * - 支持 Stream 流式输出
 * - 多个免费模型可用
 * - 支持通过 /v1/models?type=text&sub_type=chat 筛选对话模型
 * 
 * API 文档：https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== SiliconFlow Provider 实现 ====================

/**
 * SiliconFlow Provider
 * 继承 OpenAI Provider，预设 SiliconFlow 平台的 Base URL
 */
export class SiliconFlowProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    // 如果用户未设置 baseUrl，使用 SiliconFlow 默认地址
    if (!config.baseUrl) {
      config.baseUrl = 'https://api.siliconflow.cn/v1';
    }
    // 如果用户未设置模型，使用 Qwen2.5-7B-Instruct（免费模型）
    if (!config.model) {
      config.model = 'Qwen/Qwen2.5-7B-Instruct';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return SILICONFLOW_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const SILICONFLOW_METADATA: ProviderMetadata = {
  id: 'siliconflow',
  name: 'SiliconFlow',
  description: '硅基流动一站式云服务平台，集合 DeepSeek、Qwen、GLM 等顶尖大模型，部分模型免费使用，支持 Function Calling',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-...',
      description: '从 SiliconFlow 平台获取的 API 密钥（https://cloud.siliconflow.cn/account/ak）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.siliconflow.cn/v1',
      placeholder: 'https://api.siliconflow.cn/v1',
      description: 'SiliconFlow API 地址，通常无需修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'select',
      required: false,
      default: 'Qwen/Qwen2.5-7B-Instruct',
      options: [
        { value: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen2.5-7B-Instruct（免费）' },
        { value: 'Qwen/Qwen3-8B', label: 'Qwen3-8B' },
        { value: 'Qwen/Qwen3-32B', label: 'Qwen3-32B' },
        { value: 'Pro/zai-org/GLM-4.7', label: 'GLM-4.7（Pro）' },
        { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
        { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1' },
        { value: 'Pro/deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3（Pro）' },
        { value: 'Pro/deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1（Pro）' }
      ],
      description: '选择模型。支持自定义输入模型 ID，完整列表见 https://cloud.siliconflow.cn/models'
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

registerProvider(SILICONFLOW_METADATA, (config) => new SiliconFlowProvider(config));
