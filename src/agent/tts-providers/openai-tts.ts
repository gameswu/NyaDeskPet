/**
 * OpenAI TTS Provider
 * 通过 OpenAI 或兼容 API 的 /v1/audio/speech 端点进行语音合成
 * 
 * 特性：
 * - 6 种预制音色：alloy、echo、fable、onyx、nova、shimmer
 * - 2 种模型：tts-1（低延迟）、tts-1-hd（高质量）
 * - 支持 MP3、Opus、AAC、FLAC、WAV、PCM 格式
 * - 语速调节（0.25 - 4.0）
 * - 兼容所有 OpenAI TTS 兼容 API
 * 
 * API 文档：https://platform.openai.com/docs/api-reference/audio/createSpeech
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ProviderConfig, ProviderMetadata } from '../provider';
import {
  TTSProvider,
  type TTSRequest,
  type TTSResponse,
  type VoiceInfo,
  registerTTSProvider
} from '../tts-provider';
import { logger } from '../../logger';

// ==================== OpenAI TTS 类型 ====================

/** OpenAI TTS 请求体 */
interface OpenAITTSRequestBody {
  model: string;
  input: string;
  voice: string;
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  speed?: number;
}

/** 预制音色列表 */
const OPENAI_TTS_VOICES: VoiceInfo[] = [
  { id: 'alloy', name: 'Alloy', description: '中性、平衡的声音' },
  { id: 'echo', name: 'Echo', description: '温暖、清晰的男声' },
  { id: 'fable', name: 'Fable', description: '富有表现力的英式口音' },
  { id: 'onyx', name: 'Onyx', description: '深沉、有力的男声' },
  { id: 'nova', name: 'Nova', description: '友好、自然的女声' },
  { id: 'shimmer', name: 'Shimmer', description: '明亮、活泼的女声' }
];

// ==================== OpenAI TTS Provider 实现 ====================

export class OpenAITTSProvider extends TTSProvider {
  private client: AxiosInstance | null = null;

  constructor(config: ProviderConfig) {
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return OPENAI_TTS_METADATA;
  }

  /**
   * 初始化 HTTP 客户端
   */
  async initialize(): Promise<void> {
    const baseURL = this.getConfigValue('baseUrl', 'https://api.openai.com/v1');
    const timeout = this.getConfigValue('timeout', 60) * 1000;
    const proxy = this.getConfigValue<string | undefined>('proxy', undefined);

    const axiosConfig: AxiosRequestConfig = {
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (proxy) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
      logger.info(`[OpenAITTSProvider] 使用代理: ${proxy}`);
    }

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
    logger.info(`[OpenAITTSProvider] 初始化完成，baseURL: ${baseURL}`);
  }

  private ensureClient(): AxiosInstance {
    if (!this.client) {
      throw new Error('OpenAI TTS Provider 未初始化，请先调用 initialize()');
    }
    return this.client;
  }

  /**
   * 完整合成音频
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const client = this.ensureClient();
    const voice = request.voiceId || this.getConfigValue('voiceId', 'alloy');
    const model = this.getConfigValue('model', 'tts-1');
    const format = request.format || this.getConfigValue<string>('format', 'mp3');
    const speed = request.speed || this.getConfigValue<number | undefined>('speed', undefined);

    const body: OpenAITTSRequestBody = {
      model,
      input: request.text,
      voice,
    };

    if (format) {
      body.response_format = format as OpenAITTSRequestBody['response_format'];
    }
    if (speed !== undefined) {
      body.speed = speed;
    }

    try {
      const response = await client.post('/audio/speech', body, {
        responseType: 'arraybuffer'
      });

      return {
        audio: Buffer.from(response.data),
        mimeType: this.getMimeType(format)
      };
    } catch (error: any) {
      const msg = error.response?.data
        ? Buffer.from(error.response.data).toString('utf-8')
        : error.message;
      logger.error(`[OpenAITTSProvider] 合成失败: ${msg}`);
      throw new Error(`OpenAI TTS 合成失败: ${msg}`);
    }
  }

  /**
   * 流式合成音频
   */
  async *synthesizeStream(request: TTSRequest): AsyncGenerator<Buffer> {
    const client = this.ensureClient();
    const voice = request.voiceId || this.getConfigValue('voiceId', 'alloy');
    const model = this.getConfigValue('model', 'tts-1');
    const format = request.format || this.getConfigValue<string>('format', 'mp3');
    const speed = request.speed || this.getConfigValue<number | undefined>('speed', undefined);

    const body: OpenAITTSRequestBody = {
      model,
      input: request.text,
      voice,
    };

    if (format) {
      body.response_format = format as OpenAITTSRequestBody['response_format'];
    }
    if (speed !== undefined) {
      body.speed = speed;
    }

    try {
      const response = await client.post('/audio/speech', body, {
        responseType: 'stream'
      });

      const stream = response.data as NodeJS.ReadableStream;
      for await (const chunk of stream) {
        yield Buffer.from(chunk);
      }
    } catch (error: any) {
      const msg = error.message || String(error);
      logger.error(`[OpenAITTSProvider] 流式合成失败: ${msg}`);
      throw new Error(`OpenAI TTS 流式合成失败: ${msg}`);
    }
  }

  /**
   * 获取可用音色列表
   */
  async getVoices(): Promise<VoiceInfo[]> {
    return OPENAI_TTS_VOICES;
  }

  /**
   * 获取 MIME 类型（覆盖父类，支持更多格式）
   */
  getMimeType(format?: string): string {
    const mimeMap: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'opus': 'audio/opus',
      'aac': 'audio/aac',
      'flac': 'audio/flac',
      'wav': 'audio/wav',
      'pcm': 'audio/pcm'
    };
    return mimeMap[format || 'mp3'] || 'audio/mpeg';
  }

  /**
   * 测试连接
   */
  async test(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // 发送一个简短的测试合成请求
      await this.synthesize({ text: 'test', voiceId: 'alloy' });
      return { success: true };
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401) {
        return { success: false, error: 'API Key 无效' };
      }
      return { success: false, error: error.message };
    }
  }

  async terminate(): Promise<void> {
    this.client = null;
    this.initialized = false;
  }
}

// ==================== Provider 元信息 ====================

export const OPENAI_TTS_METADATA: ProviderMetadata = {
  id: 'openai-tts',
  name: 'OpenAI TTS',
  description: 'OpenAI 语音合成 API，6 种预制音色，支持高质量（tts-1-hd）和低延迟（tts-1）模式，多种音频格式，兼容 OpenAI TTS API 的其他服务也可使用',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-...',
      description: '从 OpenAI 或兼容服务商获取的 API 密钥'
    },
    {
      key: 'baseUrl',
      label: 'API Base URL',
      type: 'string',
      required: false,
      default: 'https://api.openai.com/v1',
      placeholder: 'https://api.openai.com/v1',
      description: 'API 地址。兼容服务可修改此地址'
    },
    {
      key: 'voiceId',
      label: '音色',
      type: 'select',
      required: false,
      default: 'alloy',
      options: [
        { label: 'Alloy（中性平衡）', value: 'alloy' },
        { label: 'Echo（温暖男声）', value: 'echo' },
        { label: 'Fable（英式口音）', value: 'fable' },
        { label: 'Onyx（深沉男声）', value: 'onyx' },
        { label: 'Nova（友好女声）', value: 'nova' },
        { label: 'Shimmer（活泼女声）', value: 'shimmer' }
      ],
      description: '选择音色。支持自定义输入音色 ID'
    },
    {
      key: 'model',
      label: 'TTS 模型',
      type: 'string',
      required: false,
      default: 'tts-1',
      placeholder: 'tts-1',
      description: '填写模型 ID，如 tts-1（低延迟）、tts-1-hd（高音质）'
    },
    {
      key: 'format',
      label: '音频格式',
      type: 'select',
      required: false,
      default: 'mp3',
      options: [
        { label: 'MP3', value: 'mp3' },
        { label: 'Opus', value: 'opus' },
        { label: 'AAC', value: 'aac' },
        { label: 'FLAC', value: 'flac' },
        { label: 'WAV', value: 'wav' },
        { label: 'PCM', value: 'pcm' }
      ],
      description: '输出音频格式'
    },
    {
      key: 'speed',
      label: '语速',
      type: 'number',
      required: false,
      default: 1.0,
      description: '语速调节，范围 0.25 - 4.0'
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
    }
  ]
};

// ==================== 自动注册 ====================

registerTTSProvider(OPENAI_TTS_METADATA, (config) => new OpenAITTSProvider(config));
