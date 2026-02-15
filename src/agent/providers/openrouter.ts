/**
 * OpenRouter Provider
 * 基于 OpenAI 兼容 API，通过 OpenRouter 统一网关访问数百种 AI 模型
 * 
 * 特性：
 * - 单一 API 访问 400+ 模型（OpenAI、Anthropic、Google、Meta 等）
 * - 自动故障转移和最优路由
 * - 多模态支持（图片、PDF、音频、视频，取决于底层模型）
 * - Function Calling 支持（取决于底层模型）
 * - 思维链（reasoning_content）支持（取决于底层模型）
 * 
 * API 文档：https://openrouter.ai/docs/quickstart
 * 模型列表：https://openrouter.ai/models
 */

import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  ProviderConfig,
  ProviderMetadata,
  registerProvider,
  PROVIDER_CAPABILITY_FIELDS
} from '../provider';
import { OpenAIProvider } from './openai';
import { logger } from '../../logger';

// ==================== OpenRouter 模型信息 ====================

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string | null;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

// ==================== OpenRouter Provider 实现 ====================

/**
 * OpenRouter Provider
 * 继承 OpenAI Provider，预设 OpenRouter 平台参数并添加特定 Header
 */
export class OpenRouterProvider extends OpenAIProvider {
  /** 缓存的模型详细信息 */
  private openRouterModels: OpenRouterModel[] = [];

  constructor(config: ProviderConfig) {
    // 强制使用 OpenRouter 的 Base URL
    config.baseUrl = 'https://openrouter.ai/api/v1';
    // 如果用户未设置模型，使用一个性价比高的默认模型
    if (!config.model) {
      config.model = 'openai/gpt-4o-mini';
    }
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return OPENROUTER_METADATA;
  }

  /**
   * 初始化 HTTP 客户端（覆盖父类以注入 OpenRouter 特定 Header）
   */
  async initialize(): Promise<void> {
    const baseURL = 'https://openrouter.ai/api/v1';
    const timeout = this.getConfigValue('timeout', 60) * 1000;
    const proxy = this.getConfigValue<string | undefined>('proxy', undefined);

    const axiosConfig: AxiosRequestConfig = {
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        // OpenRouter 可选 Header，用于应用在排行榜上显示
        'HTTP-Referer': 'https://github.com/NyaDeskPet',
        'X-Title': 'NyaDeskPet',
      }
    };

    // 配置代理
    if (proxy) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
      logger.info(`[OpenRouterProvider] 使用代理: ${proxy}`);
    }

    // 直接创建 axios 客户端（不调用 super.initialize()，因为需要自定义 header）
    this.client = axios.create(axiosConfig);

    // 添加请求拦截器，注入 API Key
    this.client.interceptors.request.use((config) => {
      const apiKey = this.config.apiKey;
      if (apiKey) {
        config.headers.Authorization = `Bearer ${apiKey}`;
      }
      return config;
    });

    this.initialized = true;
    logger.info(`[OpenRouterProvider] 初始化完成，baseURL: ${baseURL}`);
  }

  /**
   * 获取可用模型列表（覆盖父类以获取 OpenRouter 丰富的模型信息）
   */
  async getModels(): Promise<string[]> {
    // 如果有缓存，直接返回
    if (this.openRouterModels.length > 0) {
      return this.openRouterModels.map(m => m.id);
    }

    const client = this.ensureClient();

    try {
      const response = await client.get<OpenRouterModelsResponse>('/models');
      this.openRouterModels = response.data.data || [];

      // 按 id 排序
      this.openRouterModels.sort((a, b) => a.id.localeCompare(b.id));

      logger.info(`[OpenRouterProvider] 获取到 ${this.openRouterModels.length} 个模型`);
      return this.openRouterModels.map(m => m.id);
    } catch (error) {
      logger.error(`[OpenRouterProvider] 获取模型列表失败: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 获取指定模型的详细信息
   */
  getModelInfo(modelId: string): OpenRouterModel | undefined {
    return this.openRouterModels.find(m => m.id === modelId);
  }

  /**
   * 查询模型是否支持特定输入模态
   */
  modelSupportsModality(modelId: string, modality: string): boolean {
    const model = this.getModelInfo(modelId);
    return model?.architecture?.input_modalities?.includes(modality) ?? false;
  }

  /**
   * 查询模型是否支持 Function Calling
   */
  modelSupportsTools(modelId: string): boolean {
    const model = this.getModelInfo(modelId);
    return model?.supported_parameters?.includes('tools') ?? false;
  }

  /**
   * 测试连接（覆盖父类，使用模型列表 API 测试）
   */
  async test(): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const models = await this.getModels();

      if (models.length === 0) {
        return { success: false, error: 'OpenRouter 返回的模型列表为空' };
      }

      // 验证用户选择的模型是否可用
      const currentModel = this.getModel();
      const modelExists = models.includes(currentModel);

      return {
        success: true,
        model: modelExists ? currentModel : `${currentModel} (${models.length} 个模型可用)`
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}

// ==================== Provider 元信息 ====================

export const OPENROUTER_METADATA: ProviderMetadata = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: '通过 OpenRouter 统一网关访问 400+ AI 模型（OpenAI、Claude、Gemini、Llama 等），自动故障转移，支持多模态和 Function Calling',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-or-v1-...',
      description: '从 OpenRouter 获取的 API 密钥（https://openrouter.ai/keys）'
    },
    {
      key: 'model',
      label: '模型',
      type: 'string',
      required: false,
      default: 'openai/gpt-4o-mini',
      placeholder: 'openai/gpt-4o-mini',
      description: '模型 ID，格式为 provider/model（如 anthropic/claude-sonnet-4、google/gemini-2.5-flash）。完整列表见 https://openrouter.ai/models'
    },
    {
      key: 'timeout',
      label: '超时时间（秒）',
      type: 'number',
      required: false,
      default: 120,
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
    },
    ...PROVIDER_CAPABILITY_FIELDS
  ]
};

// ==================== 自动注册 ====================

registerProvider(OPENROUTER_METADATA, (config) => new OpenRouterProvider(config));
