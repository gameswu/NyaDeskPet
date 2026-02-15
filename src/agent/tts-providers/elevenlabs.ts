/**
 * ElevenLabs TTS Provider
 * 通过 ElevenLabs API 进行高质量语音合成
 * 
 * 特性：
 * - 业界领先的 AI 语音质量
 * - 支持 29+ 语言
 * - 丰富的预制音色 + 音色克隆
 * - 流式音频传输
 * - 多种模型可选（多语言 v2、Turbo v2.5 等）
 * - 支持语速和稳定性调节
 * 
 * API 文档：https://elevenlabs.io/docs/api-reference/text-to-speech
 * 获取 API Key：https://elevenlabs.io/app/settings/api-keys
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

// ==================== ElevenLabs 类型 ====================

/** ElevenLabs TTS 请求体 */
interface ElevenLabsTTSRequestBody {
  text: string;
  model_id: string;
  voice_settings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
}

/** ElevenLabs 音色响应 */
interface ElevenLabsVoiceResponse {
  voices: ElevenLabsVoice[];
}

/** ElevenLabs 单个音色 */
interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  description?: string | null;
  preview_url?: string | null;
  category?: string;
  labels?: Record<string, string>;
}

// ==================== ElevenLabs Provider 实现 ====================

export class ElevenLabsProvider extends TTSProvider {
  private client: AxiosInstance | null = null;
  private cachedVoices: VoiceInfo[] = [];

  constructor(config: ProviderConfig) {
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return ELEVENLABS_METADATA;
  }

  /**
   * 初始化 HTTP 客户端
   */
  async initialize(): Promise<void> {
    const baseURL = 'https://api.elevenlabs.io';
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
      logger.info(`[ElevenLabsProvider] 使用代理: ${proxy}`);
    }

    this.client = axios.create(axiosConfig);

    // 添加请求拦截器，注入 API Key（使用 xi-api-key 头）
    this.client.interceptors.request.use((config) => {
      const apiKey = this.config.apiKey;
      if (apiKey) {
        config.headers['xi-api-key'] = apiKey;
      }
      return config;
    });

    this.initialized = true;
    logger.info('[ElevenLabsProvider] 初始化完成');
  }

  private ensureClient(): AxiosInstance {
    if (!this.client) {
      throw new Error('ElevenLabs Provider 未初始化，请先调用 initialize()');
    }
    return this.client;
  }

  /**
   * 完整合成音频
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const client = this.ensureClient();
    const voiceId = request.voiceId || this.getConfigValue('voiceId', 'JBFqnCBsd6RMkjVDRZzb');
    const model = this.getConfigValue('model', 'eleven_multilingual_v2');
    const format = request.format || this.getConfigValue<string>('format', 'mp3');
    const stability = this.getConfigValue<number>('stability', 0.5);
    const similarityBoost = this.getConfigValue<number>('similarityBoost', 0.75);

    const body: ElevenLabsTTSRequestBody = {
      text: request.text,
      model_id: model,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
      }
    };

    try {
      const response = await client.post(
        `/v1/text-to-speech/${voiceId}`,
        body,
        {
          responseType: 'arraybuffer',
          params: {
            output_format: this.getOutputFormat(format)
          }
        }
      );

      return {
        audio: Buffer.from(response.data),
        mimeType: this.getMimeType(format)
      };
    } catch (error: any) {
      const msg = error.response?.data
        ? Buffer.from(error.response.data).toString('utf-8')
        : error.message;
      logger.error(`[ElevenLabsProvider] 合成失败: ${msg}`);
      throw new Error(`ElevenLabs TTS 合成失败: ${msg}`);
    }
  }

  /**
   * 流式合成音频
   */
  async *synthesizeStream(request: TTSRequest): AsyncGenerator<Buffer> {
    const client = this.ensureClient();
    const voiceId = request.voiceId || this.getConfigValue('voiceId', 'JBFqnCBsd6RMkjVDRZzb');
    const model = this.getConfigValue('model', 'eleven_multilingual_v2');
    const format = request.format || this.getConfigValue<string>('format', 'mp3');
    const stability = this.getConfigValue<number>('stability', 0.5);
    const similarityBoost = this.getConfigValue<number>('similarityBoost', 0.75);

    const body: ElevenLabsTTSRequestBody = {
      text: request.text,
      model_id: model,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
      }
    };

    try {
      const response = await client.post(
        `/v1/text-to-speech/${voiceId}/stream`,
        body,
        {
          responseType: 'stream',
          params: {
            output_format: this.getOutputFormat(format)
          }
        }
      );

      const stream = response.data as NodeJS.ReadableStream;
      for await (const chunk of stream) {
        yield Buffer.from(chunk);
      }
    } catch (error: any) {
      const msg = error.message || String(error);
      logger.error(`[ElevenLabsProvider] 流式合成失败: ${msg}`);
      throw new Error(`ElevenLabs TTS 流式合成失败: ${msg}`);
    }
  }

  /**
   * 获取可用音色列表
   */
  async getVoices(): Promise<VoiceInfo[]> {
    if (this.cachedVoices.length > 0) {
      return this.cachedVoices;
    }

    const client = this.ensureClient();

    try {
      const response = await client.get<ElevenLabsVoiceResponse>('/v1/voices');
      const voices = response.data.voices || [];

      this.cachedVoices = voices.map(v => ({
        id: v.voice_id,
        name: v.name,
        description: v.description || undefined,
        previewUrl: v.preview_url || undefined,
        language: v.labels?.language
      }));

      logger.info(`[ElevenLabsProvider] 获取到 ${this.cachedVoices.length} 个音色`);
      return this.cachedVoices;
    } catch (error) {
      logger.error(`[ElevenLabsProvider] 获取音色列表失败: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 转换格式为 ElevenLabs 的 output_format 参数
   */
  private getOutputFormat(format?: string): string {
    const formatMap: Record<string, string> = {
      'mp3': 'mp3_44100_128',
      'pcm': 'pcm_44100',
      'opus': 'opus_48000',
    };
    return formatMap[format || 'mp3'] || 'mp3_44100_128';
  }

  /**
   * 测试连接
   */
  async test(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // 通过获取音色列表来验证 API Key
      const client = this.ensureClient();
      await client.get('/v1/voices');
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
    this.cachedVoices = [];
    this.initialized = false;
  }
}

// ==================== Provider 元信息 ====================

export const ELEVENLABS_METADATA: ProviderMetadata = {
  id: 'elevenlabs',
  name: 'ElevenLabs',
  description: '业界领先的 AI 语音合成服务，支持 29+ 语言，音色克隆，多种模型，超高音质，流式传输',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'your_api_key',
      description: '从 ElevenLabs 获取的 API 密钥（https://elevenlabs.io/app/settings/api-keys）'
    },
    {
      key: 'voiceId',
      label: '音色 ID',
      type: 'string',
      required: false,
      default: 'JBFqnCBsd6RMkjVDRZzb',
      placeholder: 'JBFqnCBsd6RMkjVDRZzb',
      description: '音色 ID，可从 https://elevenlabs.io/voice-library 获取。默认为 George'
    },
    {
      key: 'model',
      label: 'TTS 模型',
      type: 'string',
      required: false,
      default: 'eleven_multilingual_v2',
      placeholder: 'eleven_multilingual_v2',
      description: '填写模型 ID，如 eleven_multilingual_v2、eleven_flash_v2_5、eleven_flash_v2、eleven_monolingual_v1'
    },
    {
      key: 'format',
      label: '音频格式',
      type: 'select',
      required: false,
      default: 'mp3',
      options: [
        { label: 'MP3', value: 'mp3' },
        { label: 'PCM', value: 'pcm' },
        { label: 'Opus', value: 'opus' }
      ],
      description: '输出音频格式'
    },
    {
      key: 'stability',
      label: '稳定性',
      type: 'number',
      required: false,
      default: 0.5,
      description: '语音稳定性，范围 0.0 - 1.0。越高越稳定，越低越有表现力'
    },
    {
      key: 'similarityBoost',
      label: '相似度增强',
      type: 'number',
      required: false,
      default: 0.75,
      description: '音色相似度增强，范围 0.0 - 1.0。越高越接近原始音色'
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

registerTTSProvider(ELEVENLABS_METADATA, (config) => new ElevenLabsProvider(config));
