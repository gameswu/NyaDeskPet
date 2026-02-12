/**
 * TTS Provider 抽象层
 * 与 LLM Provider 平行的 TTS 接入框架
 * 
 * 设计原则：
 * - 策略模式：统一接口，多种实现（Fish Audio / Edge TTS / OpenAI TTS 等）
 * - 注册表模式：通过 registerTTSProvider() 声明式注册
 * - 流式支持：同时支持流式和完整音频生成
 * - 生命周期：initialize() → synthesize/synthesizeStream → terminate()
 * - 配置分离：TTSProviderConfig（实例配置）与元信息（ProviderMetadata 复用）
 * 
 * 扩展指南：
 * 1. 继承 TTSProvider 基类
 * 2. 实现 synthesize() 和/或 synthesizeStream() 方法
 * 3. 调用 registerTTSProvider() 注册
 * 4. 在设置中选择并配置即可使用
 */

import { logger } from '../logger';
import type { ProviderConfig, ProviderMetadata } from './provider';

// ==================== TTS 核心类型定义 ====================

/** TTS 合成请求 */
export interface TTSRequest {
  /** 要合成的文本 */
  text: string;
  /** 音色 / 声音模型 ID */
  voiceId?: string;
  /** 输出格式 */
  format?: 'mp3' | 'wav' | 'pcm' | 'opus';
  /** 语速（0.5 - 2.0） */
  speed?: number;
  /** 音量调节（-20 到 20） */
  volume?: number;
}

/** TTS 合成结果 */
export interface TTSResponse {
  /** 音频数据 */
  audio: Buffer;
  /** MIME 类型（如 'audio/mpeg'） */
  mimeType: string;
  /** 音频时长（毫秒，如可获取） */
  duration?: number;
}

/** 音色信息 */
export interface VoiceInfo {
  /** 音色 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 预览音频 URL */
  previewUrl?: string;
  /** 语言 */
  language?: string;
}

// ==================== TTS Provider 基类 ====================

/**
 * TTS Provider 抽象基类
 * 所有 TTS 接入方必须继承此类并实现核心方法
 * 
 * 生命周期：constructor → initialize → synthesize/synthesizeStream → terminate
 */
export abstract class TTSProvider {
  protected config: ProviderConfig;
  /** 是否已初始化 */
  protected initialized: boolean = false;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /** 获取 Provider 元信息 */
  abstract getMetadata(): ProviderMetadata;

  /**
   * 完整合成（返回完整音频数据）
   * @returns 完整的 TTS 响应
   */
  abstract synthesize(request: TTSRequest): Promise<TTSResponse>;

  /**
   * 流式合成（逐块返回音频数据）
   * 默认回退到完整合成
   * @returns 异步迭代器，逐块返回音频数据（Buffer 块）
   */
  async *synthesizeStream(request: TTSRequest): AsyncGenerator<Buffer> {
    // 默认实现：调用完整合成然后一次性返回
    const response = await this.synthesize(request);
    yield response.audio;
  }

  /**
   * 获取合成音频的 MIME 类型
   */
  getMimeType(format?: string): string {
    const mimeMap: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'pcm': 'audio/pcm',
      'opus': 'audio/opus'
    };
    return mimeMap[format || 'mp3'] || 'audio/mpeg';
  }

  /**
   * 初始化 Provider
   * 用于延迟初始化 HTTP 客户端、验证配置等
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * 销毁 Provider
   * 用于清理 HTTP 客户端、关闭连接等
   */
  async terminate(): Promise<void> {
    this.initialized = false;
  }

  /** 测试连接是否正常 */
  async test(): Promise<{ success: boolean; error?: string }> {
    try {
      // 默认实现：尝试获取音色列表
      await this.getVoices();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 获取可用音色列表
   * 子类应覆盖以动态获取
   */
  async getVoices(): Promise<VoiceInfo[]> {
    return [];
  }

  /** 更新配置 */
  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 获取当前配置 */
  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  /** 获取配置值，带默认值 */
  protected getConfigValue<T>(key: string, defaultValue: T): T {
    const val = this.config[key];
    return (val !== undefined && val !== null && val !== '') ? val as T : defaultValue;
  }
}

// ==================== TTS Provider 注册表 ====================

/** TTS Provider 工厂函数类型 */
type TTSProviderFactory = (config: ProviderConfig) => TTSProvider;

interface TTSProviderRegistryEntry {
  metadata: ProviderMetadata;
  factory: TTSProviderFactory;
}

/**
 * TTS Provider 注册表（单例）
 */
class TTSProviderRegistry {
  private entries: Map<string, TTSProviderRegistryEntry> = new Map();

  /** 注册一个 TTS Provider */
  register(metadata: ProviderMetadata, factory: TTSProviderFactory): void {
    if (this.entries.has(metadata.id)) {
      logger.warn(`[TTSProviderRegistry] TTS Provider "${metadata.id}" 已存在，将被覆盖`);
    }
    this.entries.set(metadata.id, { metadata, factory });
    logger.info(`[TTSProviderRegistry] 已注册 TTS Provider: ${metadata.id} (${metadata.name})`);
  }

  /** 注销一个 TTS Provider */
  unregister(id: string): void {
    this.entries.delete(id);
  }

  /** 创建 TTS Provider 实例 */
  create(id: string, config: ProviderConfig): TTSProvider | null {
    const entry = this.entries.get(id);
    if (!entry) {
      logger.error(`[TTSProviderRegistry] 未找到 TTS Provider: ${id}`);
      return null;
    }
    return entry.factory(config);
  }

  /** 获取所有已注册的 TTS Provider 元信息 */
  getAll(): ProviderMetadata[] {
    return Array.from(this.entries.values()).map(e => e.metadata);
  }

  /** 获取指定 TTS Provider 的元信息 */
  get(id: string): ProviderMetadata | undefined {
    return this.entries.get(id)?.metadata;
  }

  /** 是否已注册 */
  has(id: string): boolean {
    return this.entries.has(id);
  }
}

/** 全局 TTS Provider 注册表实例 */
export const ttsProviderRegistry = new TTSProviderRegistry();

/**
 * 注册 TTS Provider 的便捷函数
 * 
 * @example
 * ```ts
 * registerTTSProvider(
 *   { id: 'fish-audio', name: 'Fish Audio', description: '...', configSchema: [...] },
 *   (config) => new FishAudioProvider(config)
 * );
 * ```
 */
export function registerTTSProvider(metadata: ProviderMetadata, factory: TTSProviderFactory): void {
  ttsProviderRegistry.register(metadata, factory);
}
