/**
 * Fish Audio TTS Provider
 * 通过 Fish Audio API 将文本转换为自然语音
 * 
 * 特性：
 * - 支持 400+ 预制音色和自定义克隆音色
 * - 流式音频传输，低延迟
 * - 多种音频格式（MP3、WAV、PCM、Opus）
 * - 情感标记支持（(happy)、(sad)、(whispering) 等）
 * - 语速和音量调节
 * - 多种 TTS 模型可选（s1、speech-1.6、speech-1.5）
 * 
 * API 文档：https://docs.fish.audio/developer-guide/core-features/text-to-speech
 * 音色库：https://fish.audio/discovery
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

// ==================== Fish Audio 类型 ====================

/** Fish Audio 模型列表响应 */
interface FishAudioModelResponse {
  total: number;
  items: FishAudioModel[];
}

/** Fish Audio 音色模型 */
interface FishAudioModel {
  _id: string;
  title: string;
  description?: string;
  cover_image?: string;
  type?: string;
  tags?: string[];
  languages?: string[];
  samples?: Array<{
    url?: string;
    text?: string;
  }>;
  created_at?: string;
  task_count?: number;
}

/** Fish Audio TTS 请求体 */
interface FishAudioTTSRequestBody {
  text: string;
  reference_id?: string;
  format?: 'mp3' | 'wav' | 'pcm' | 'opus';
  mp3_bitrate?: 64 | 128 | 192;
  chunk_length?: number;
  normalize?: boolean;
  latency?: 'low' | 'normal' | 'balanced';
  temperature?: number;
  top_p?: number;
  prosody?: {
    speed?: number;
    volume?: number;
  };
}

// ==================== Fish Audio Provider 实现 ====================

export class FishAudioProvider extends TTSProvider {
  private client: AxiosInstance | null = null;
  private cachedVoices: VoiceInfo[] = [];

  constructor(config: ProviderConfig) {
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return FISH_AUDIO_METADATA;
  }

  /**
   * 初始化 HTTP 客户端
   */
  async initialize(): Promise<void> {
    const baseURL = 'https://api.fish.audio';
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
      logger.info(`[FishAudioProvider] 使用代理: ${proxy}`);
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
    logger.info('[FishAudioProvider] 初始化完成');
  }

  /**
   * 确保客户端已初始化
   */
  private ensureClient(): AxiosInstance {
    if (!this.client) {
      throw new Error('FishAudio Provider 未初始化，请先调用 initialize()');
    }
    return this.client;
  }

  /**
   * 完整合成音频
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const client = this.ensureClient();
    const voiceId = request.voiceId || this.getConfigValue<string>('voiceId', '');
    const format = request.format || this.getConfigValue<string>('format', 'mp3') as TTSRequest['format'];
    const model = this.getConfigValue<string>('model', 's1');
    const latency = this.getConfigValue<string>('latency', 'normal');

    const body: FishAudioTTSRequestBody = {
      text: request.text,
      format: format || 'mp3',
      chunk_length: this.getConfigValue('chunkLength', 200),
      normalize: true,
      latency: latency as 'low' | 'normal' | 'balanced',
      temperature: this.getConfigValue('temperature', 0.7),
      top_p: this.getConfigValue('topP', 0.7),
    };

    // 设置音色
    if (voiceId) {
      body.reference_id = voiceId;
    }

    // 语速和音量
    const speed = request.speed || this.getConfigValue<number | undefined>('speed', undefined);
    const volume = request.volume || this.getConfigValue<number | undefined>('volume', undefined);
    if (speed !== undefined || volume !== undefined) {
      body.prosody = {};
      if (speed !== undefined) body.prosody.speed = speed;
      if (volume !== undefined) body.prosody.volume = volume;
    }

    try {
      const response = await client.post('/v1/tts', body, {
        responseType: 'arraybuffer',
        headers: {
          'model': model,
        }
      });

      return {
        audio: Buffer.from(response.data),
        mimeType: this.getMimeType(format),
      };
    } catch (error: any) {
      const msg = error.response?.data
        ? Buffer.from(error.response.data).toString('utf-8')
        : error.message;
      logger.error(`[FishAudioProvider] 合成失败: ${msg}`);
      throw new Error(`Fish Audio TTS 合成失败: ${msg}`);
    }
  }

  /**
   * 流式合成音频
   * Fish Audio API 本身返回流式响应，这里利用 axios 的 stream 方式
   */
  async *synthesizeStream(request: TTSRequest): AsyncGenerator<Buffer> {
    const client = this.ensureClient();
    const voiceId = request.voiceId || this.getConfigValue<string>('voiceId', '');
    const format = request.format || this.getConfigValue<string>('format', 'mp3') as TTSRequest['format'];
    const model = this.getConfigValue<string>('model', 's1');
    const latency = this.getConfigValue<string>('latency', 'normal');

    const body: FishAudioTTSRequestBody = {
      text: request.text,
      format: format || 'mp3',
      chunk_length: this.getConfigValue('chunkLength', 200),
      normalize: true,
      latency: latency as 'low' | 'normal' | 'balanced',
      temperature: this.getConfigValue('temperature', 0.7),
      top_p: this.getConfigValue('topP', 0.7),
    };

    if (voiceId) {
      body.reference_id = voiceId;
    }

    const speed = request.speed || this.getConfigValue<number | undefined>('speed', undefined);
    const volume = request.volume || this.getConfigValue<number | undefined>('volume', undefined);
    if (speed !== undefined || volume !== undefined) {
      body.prosody = {};
      if (speed !== undefined) body.prosody.speed = speed;
      if (volume !== undefined) body.prosody.volume = volume;
    }

    try {
      const response = await client.post('/v1/tts', body, {
        responseType: 'stream',
        headers: {
          'model': model,
        }
      });

      const stream = response.data as NodeJS.ReadableStream;

      for await (const chunk of stream) {
        yield Buffer.from(chunk);
      }
    } catch (error: any) {
      const msg = error.message || String(error);
      logger.error(`[FishAudioProvider] 流式合成失败: ${msg}`);
      throw new Error(`Fish Audio TTS 流式合成失败: ${msg}`);
    }
  }

  /**
   * 获取可用音色列表
   * 查询用户自己的音色 + 平台热门音色
   */
  async getVoices(): Promise<VoiceInfo[]> {
    if (this.cachedVoices.length > 0) {
      return this.cachedVoices;
    }

    const client = this.ensureClient();
    const voices: VoiceInfo[] = [];

    try {
      // 先获取用户自己的音色
      const selfResponse = await client.get<FishAudioModelResponse>('/model', {
        params: {
          page_size: 100,
          page_number: 1,
          self: true,
          sort_by: 'created_at'
        }
      });

      if (selfResponse.data.items) {
        for (const model of selfResponse.data.items) {
          voices.push(this.modelToVoiceInfo(model, true));
        }
      }

      // 再获取平台热门音色
      const publicResponse = await client.get<FishAudioModelResponse>('/model', {
        params: {
          page_size: 50,
          page_number: 1,
          sort_by: 'task_count'
        }
      });

      if (publicResponse.data.items) {
        for (const model of publicResponse.data.items) {
          // 避免重复
          if (!voices.some(v => v.id === model._id)) {
            voices.push(this.modelToVoiceInfo(model, false));
          }
        }
      }

      this.cachedVoices = voices;
      logger.info(`[FishAudioProvider] 获取到 ${voices.length} 个音色`);
      return voices;
    } catch (error) {
      logger.error(`[FishAudioProvider] 获取音色列表失败: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 将 Fish Audio 模型转为 VoiceInfo
   */
  private modelToVoiceInfo(model: FishAudioModel, isSelf: boolean): VoiceInfo {
    return {
      id: model._id,
      name: `${model.title}${isSelf ? ' ⭐' : ''}`,
      description: model.description || undefined,
      previewUrl: model.samples?.[0]?.url,
      language: model.languages?.join(', '),
    };
  }

  /**
   * 测试连接
   */
  async test(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const client = this.ensureClient();

      // 通过模型列表 API 验证 API Key
      await client.get<FishAudioModelResponse>('/model', {
        params: {
          page_size: 1,
          page_number: 1,
          self: true
        }
      });

      return { success: true };
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401) {
        return { success: false, error: 'API Key 无效' };
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * 销毁
   */
  async terminate(): Promise<void> {
    this.client = null;
    this.cachedVoices = [];
    this.initialized = false;
  }
}

// ==================== Provider 元信息 ====================

export const FISH_AUDIO_METADATA: ProviderMetadata = {
  id: 'fish-audio',
  name: 'Fish Audio',
  description: '高质量 AI 语音合成服务，支持 400+ 预制音色和自定义音色克隆，流式传输，情感标记，多语言',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'your_api_key',
      description: '从 Fish Audio 获取的 API 密钥（https://fish.audio/account/api-keys）'
    },
    {
      key: 'voiceId',
      label: '音色 ID',
      type: 'string',
      required: false,
      placeholder: '802e3bc2b27e49c2995d23ef70e6ac89',
      description: '音色模型 ID，可从 https://fish.audio/discovery 获取。留空使用默认音色'
    },
    {
      key: 'model',
      label: 'TTS 模型',
      type: 'select',
      required: false,
      default: 's1',
      options: [
        { label: 'S1', value: 's1' },
        { label: 'Speech 1.6', value: 'speech-1.6' },
        { label: 'Speech 1.5', value: 'speech-1.5' }
      ],
      description: 'TTS 引擎模型版本'
    },
    {
      key: 'format',
      label: '音频格式',
      type: 'select',
      required: false,
      default: 'mp3',
      options: [
        { label: 'MP3', value: 'mp3' },
        { label: 'WAV', value: 'wav' },
        { label: 'Opus', value: 'opus' },
        { label: 'PCM', value: 'pcm' }
      ],
      description: '输出音频格式'
    },
    {
      key: 'latency',
      label: '延迟模式',
      type: 'select',
      required: false,
      default: 'normal',
      options: [
        { label: '标准', value: 'normal' },
        { label: '均衡', value: 'balanced' }
      ],
      description: '延迟与质量的权衡'
    },
    {
      key: 'speed',
      label: '语速',
      type: 'number',
      required: false,
      default: 1.0,
      description: '语速调节，范围 0.5 - 2.0'
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
      description: 'HTTP/HTTPS 代理（如需使用）'
    }
  ]
};

// ==================== 自动注册 ====================

registerTTSProvider(FISH_AUDIO_METADATA, (config) => new FishAudioProvider(config));
