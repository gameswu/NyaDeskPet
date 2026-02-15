/**
 * DashScope（阿里云百炼）Provider
 * 基于 OpenAI 兼容 API，预配置阿里云 DashScope 平台参数
 * 
 * 支持模型：
 * - qwen-plus：通义千问增强版，平衡能力与效率
 * - qwen-turbo：通义千问极速版，低延迟高吞吐
 * - qwen-max：通义千问旗舰版，最强推理能力
 * - qwen-long：通义千问长文本版，支持超长上下文
 * - qwq-plus：通义千问推理版，支持深度思考
 * 
 * 特性：
 * - 完全兼容 OpenAI Chat Completions API
 * - 支持 Function Calling、Vision、流式输出
 * - 通义千问全系列模型
 * - 国内访问无需代理
 * 
 * API 文档：https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope
 * 获取 API Key：https://bailian.console.aliyun.com/#/key-manage
 */

import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';

// ==================== DashScope Provider 实现 ====================

/**
 * DashScope Provider
 * 继承 OpenAI Provider，预设阿里云百炼平台的 Base URL
 */
export class DashScopeProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      config.baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    }
    if (!config.model) {
      config.model = 'qwen-plus';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return DASHSCOPE_METADATA;
  }
}

// ==================== Provider 元信息 ====================

export const DASHSCOPE_METADATA: ProviderMetadata = {
  id: 'dashscope',
  name: 'DashScope（阿里云百炼）',
  description: '阿里云百炼平台，通义千问全系列模型（Qwen），支持 Vision、Function Calling、深度思考，国内直连',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-...',
      description: '从阿里云百炼平台获取的 API 密钥（https://bailian.console.aliyun.com/#/key-manage）'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      description: 'DashScope OpenAI 兼容端点，通常无需修改'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'qwen-plus',
      placeholder: 'qwen-plus',
      description: '填写模型 ID，如 qwen-plus、qwen-turbo、qwen-max、qwen-long、qwq-plus'
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

registerProvider(DASHSCOPE_METADATA, (config) => new DashScopeProvider(config));
