/**
 * Edge TTS Provider
 * 基于 Microsoft Edge Read Aloud 的免费 TTS 服务
 * 
 * 特性：
 * - 完全免费，无需 API Key
 * - 高质量 Neural 语音
 * - 支持多语言（中文、英文、日语等 400+ 音色）
 * - 支持语速、音调、音量调节
 * - 通过 node-edge-tts 库实现
 * - 支持代理
 * 
 * 依赖：node-edge-tts（MIT 协议）
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { EdgeTTS } from 'node-edge-tts';
import type { ProviderConfig, ProviderMetadata } from '../provider';
import {
  TTSProvider,
  type TTSRequest,
  type TTSResponse,
  type VoiceInfo,
  registerTTSProvider
} from '../tts-provider';
import { logger } from '../../logger';

// ==================== Edge TTS Provider 实现 ====================

export class EdgeTTSProvider extends TTSProvider {
  /** node-edge-tts 实例（每次合成时重新创建以适配不同参数） */
  private voice: string = 'zh-CN-XiaoyiNeural';
  private lang: string = 'zh-CN';
  private outputFormat: string = 'audio-24khz-48kbitrate-mono-mp3';
  private rate: string = 'default';
  private pitch: string = 'default';
  private volume: string = 'default';
  private proxy: string | undefined;
  private timeout: number = 30000;

  constructor(config: ProviderConfig) {
    super(config);
  }

  getMetadata(): ProviderMetadata {
    return EDGE_TTS_METADATA;
  }

  /**
   * 初始化，读取配置
   */
  async initialize(): Promise<void> {
    this.voice = this.getConfigValue('voice', 'zh-CN-XiaoyiNeural');
    this.lang = this.getConfigValue('lang', 'zh-CN');
    this.outputFormat = this.getConfigValue('outputFormat', 'audio-24khz-48kbitrate-mono-mp3');
    this.rate = this.getConfigValue('rate', 'default');
    this.pitch = this.getConfigValue('pitch', 'default');
    this.volume = this.getConfigValue('volume', 'default');
    this.proxy = this.getConfigValue<string | undefined>('proxy', undefined);
    this.timeout = this.getConfigValue('timeout', 30) * 1000;

    this.initialized = true;
    logger.info(`[EdgeTTSProvider] 初始化完成，语音: ${this.voice}, 语言: ${this.lang}`);
  }

  /**
   * 创建 EdgeTTS 实例（每次合成时创建新实例）
   */
  private createTTSInstance(): EdgeTTS {
    return new EdgeTTS({
      voice: this.voice,
      lang: this.lang,
      outputFormat: this.outputFormat,
      rate: this.rate,
      pitch: this.pitch,
      volume: this.volume,
      proxy: this.proxy,
      timeout: this.timeout,
      saveSubtitles: false,
    });
  }

  /**
   * 生成临时文件路径
   */
  private getTempFilePath(): string {
    const id = randomBytes(8).toString('hex');
    return join(tmpdir(), `edge-tts-${id}.mp3`);
  }

  /**
   * 完整合成音频
   * 使用 node-edge-tts 的 ttsPromise 写入临时文件，然后读取为 Buffer
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const tts = this.createTTSInstance();
    const tempPath = this.getTempFilePath();

    try {
      logger.info(`[EdgeTTSProvider] 开始合成，文本长度: ${request.text.length}`);
      await tts.ttsPromise(request.text, tempPath);

      // 读取临时文件为 Buffer
      const audioBuffer = await readFile(tempPath);

      // 删除临时文件
      await unlink(tempPath).catch(() => { /* 忽略删除失败 */ });

      logger.info(`[EdgeTTSProvider] 合成完成，音频大小: ${audioBuffer.length} bytes`);

      return {
        audio: audioBuffer,
        mimeType: this.getMimeType('mp3'),
      };
    } catch (error: any) {
      // 清理临时文件
      await unlink(tempPath).catch(() => { /* 忽略 */ });
      const msg = error.message || String(error);
      logger.error(`[EdgeTTSProvider] 合成失败: ${msg}`);
      throw new Error(`Edge TTS 合成失败: ${msg}`);
    }
  }

  /**
   * 流式合成音频
   * Edge TTS 本身通过 WebSocket 分块传输，node-edge-tts 内部已处理
   * 这里使用 synthesize 后一次性 yield（Edge TTS 延迟本身很低）
   */
  async *synthesizeStream(request: TTSRequest): AsyncGenerator<Buffer> {
    // Edge TTS 的延迟本身很低（通常 < 1s），直接用完整合成 + 一次性返回
    // node-edge-tts 没有暴露流式 API，内部 WebSocket 分块被合并到文件
    const response = await this.synthesize(request);
    yield response.audio;
  }

  /**
   * 获取可用音色列表
   * Edge TTS 支持 400+ 音色，这里返回常用的中文和英文音色
   * 完整列表参考：https://learn.microsoft.com/azure/ai-services/speech-service/language-support
   */
  async getVoices(): Promise<VoiceInfo[]> {
    return EDGE_TTS_VOICES;
  }

  /**
   * 测试连接
   * 尝试合成一段很短的文字来验证服务可用性
   */
  async test(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      const tts = this.createTTSInstance();
      const tempPath = this.getTempFilePath();

      try {
        await tts.ttsPromise('test', tempPath);
        await unlink(tempPath).catch(() => { /* 忽略 */ });
        return { success: true };
      } catch (error: any) {
        await unlink(tempPath).catch(() => { /* 忽略 */ });
        return { success: false, error: error.message || String(error) };
      }
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 销毁
   */
  async terminate(): Promise<void> {
    this.initialized = false;
  }
}

// ==================== 常用 Edge TTS 音色列表 ====================

const EDGE_TTS_VOICES: VoiceInfo[] = [
  // 中文（普通话）
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女）', language: 'zh-CN', description: '温暖、活泼的女声' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊（女）', language: 'zh-CN', description: '亲切的女声' },
  { id: 'zh-CN-YunjianNeural', name: '云健（男）', language: 'zh-CN', description: '阳光的男声' },
  { id: 'zh-CN-YunxiNeural', name: '云希（男）', language: 'zh-CN', description: '沉稳的男声' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏（男）', language: 'zh-CN', description: '少年感的男声' },
  { id: 'zh-CN-YunyangNeural', name: '云扬（男）', language: 'zh-CN', description: '专业播报男声' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北（女·东北话）', language: 'zh-CN', description: '东北方言女声' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', name: '晓妮（女·陕西话）', language: 'zh-CN', description: '陕西方言女声' },

  // 中文（台湾）
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻（女）', language: 'zh-TW', description: '台湾女声' },
  { id: 'zh-TW-YunJheNeural', name: '雲哲（男）', language: 'zh-TW', description: '台湾男声' },

  // 中文（粤语）
  { id: 'zh-HK-HiuGaaiNeural', name: '曉佳（女）', language: 'zh-HK', description: '粤语女声' },
  { id: 'zh-HK-WanLungNeural', name: '雲龍（男）', language: 'zh-HK', description: '粤语男声' },

  // 英文（美国）
  { id: 'en-US-AriaNeural', name: 'Aria (Female)', language: 'en-US', description: 'Friendly female voice' },
  { id: 'en-US-JennyNeural', name: 'Jenny (Female)', language: 'en-US', description: 'Warm female voice' },
  { id: 'en-US-GuyNeural', name: 'Guy (Male)', language: 'en-US', description: 'Casual male voice' },
  { id: 'en-US-DavisNeural', name: 'Davis (Male)', language: 'en-US', description: 'Confident male voice' },

  // 英文（英国）
  { id: 'en-GB-SoniaNeural', name: 'Sonia (Female)', language: 'en-GB', description: 'British female voice' },
  { id: 'en-GB-RyanNeural', name: 'Ryan (Male)', language: 'en-GB', description: 'British male voice' },

  // 日语
  { id: 'ja-JP-NanamiNeural', name: 'Nanami（女）', language: 'ja-JP', description: '日语女声' },
  { id: 'ja-JP-KeitaNeural', name: 'Keita（男）', language: 'ja-JP', description: '日语男声' },

  // 韩语
  { id: 'ko-KR-SunHiNeural', name: 'SunHi（女）', language: 'ko-KR', description: '韩语女声' },
  { id: 'ko-KR-InJoonNeural', name: 'InJoon（男）', language: 'ko-KR', description: '韩语男声' },

  // 法语
  { id: 'fr-FR-DeniseNeural', name: 'Denise (Female)', language: 'fr-FR', description: 'French female voice' },
  { id: 'fr-FR-HenriNeural', name: 'Henri (Male)', language: 'fr-FR', description: 'French male voice' },

  // 德语
  { id: 'de-DE-KatjaNeural', name: 'Katja (Female)', language: 'de-DE', description: 'German female voice' },
  { id: 'de-DE-ConradNeural', name: 'Conrad (Male)', language: 'de-DE', description: 'German male voice' },

  // 西班牙语
  { id: 'es-ES-ElviraNeural', name: 'Elvira (Female)', language: 'es-ES', description: 'Spanish female voice' },
  { id: 'es-ES-AlvaroNeural', name: 'Alvaro (Male)', language: 'es-ES', description: 'Spanish male voice' },

  // 俄语
  { id: 'ru-RU-SvetlanaNeural', name: 'Svetlana (Female)', language: 'ru-RU', description: 'Russian female voice' },
  { id: 'ru-RU-DmitryNeural', name: 'Dmitry (Male)', language: 'ru-RU', description: 'Russian male voice' },
];

// ==================== Provider 元信息 ====================

export const EDGE_TTS_METADATA: ProviderMetadata = {
  id: 'edge-tts',
  name: 'Edge TTS',
  description: '基于 Microsoft Edge Read Aloud 的免费 TTS 服务，无需 API Key，支持 400+ 高质量 Neural 音色，多语言',
  configSchema: [
    {
      key: 'voice',
      label: '音色',
      type: 'select',
      required: false,
      default: 'zh-CN-XiaoyiNeural',
      options: EDGE_TTS_VOICES.map(v => ({
        value: v.id,
        label: `${v.name} [${v.language}]`
      })),
      description: '选择语音音色。也可以直接输入音色 ID（参考 https://learn.microsoft.com/azure/ai-services/speech-service/language-support）'
    },
    {
      key: 'lang',
      label: '语言',
      type: 'string',
      required: false,
      default: 'zh-CN',
      placeholder: 'zh-CN',
      description: '语言代码，通常与音色匹配自动选择。如 zh-CN、en-US、ja-JP'
    },
    {
      key: 'rate',
      label: '语速',
      type: 'string',
      required: false,
      default: 'default',
      placeholder: 'default 或 +20% 或 -10%',
      description: '语速调节。使用 default 表示默认，或 +/-百分比（如 +20%、-10%）'
    },
    {
      key: 'pitch',
      label: '音调',
      type: 'string',
      required: false,
      default: 'default',
      placeholder: 'default 或 +5% 或 -10%',
      description: '音调调节。使用 default 表示默认，或 +/-百分比'
    },
    {
      key: 'volume',
      label: '音量',
      type: 'string',
      required: false,
      default: 'default',
      placeholder: 'default 或 -50%',
      description: '音量调节。使用 default 表示默认，或 +/-百分比'
    },
    {
      key: 'timeout',
      label: '超时时间（秒）',
      type: 'number',
      required: false,
      default: 30,
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

registerTTSProvider(EDGE_TTS_METADATA, (config) => new EdgeTTSProvider(config));
