/**
 * ASR 服务（主进程）
 * 使用 Sherpa-ONNX 进行语音识别，支持多模型切换
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from './logger';

// ==================== 类型定义 ====================

/** Sherpa-ONNX 模型配置 */
interface SherpaConfig {
  modelPath: string;
  tokensPath: string;
  provider: string;
  numThreads: number;
}

/** 语音识别结果 */
interface RecognitionResult {
  text: string;
  confidence?: number;
}

/** 可用 ASR 模型信息 */
export interface ASRModelInfo {
  /** 模型目录名 */
  name: string;
  /** 模型文件路径 */
  modelFile: string;
  /** tokens 文件路径 */
  tokensFile: string;
  /** 模型文件大小（字节） */
  size: number;
}

/** ASR 默认模型名 */
const DEFAULT_MODEL_NAME = 'sense-voice-small';

// ==================== ASRService ====================

class ASRService {
  private recognizer: any = null;
  private isInitialized: boolean = false;
  private modelConfig: SherpaConfig | null = null;
  /** 当前加载的模型名 */
  private currentModelName: string = '';
  /** 初始化错误信息（供前端显示） */
  private lastError: string = '';

  /**
   * 获取 models/asr 的物理路径（asarUnpack 兼容）
   */
  private getModelsBasePath(): string {
    return path.join(
      app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
      'models', 'asr'
    );
  }

  /**
   * 扫描可用的 ASR 模型
   * 遍历 models/asr/ 下的子目录，查找包含 *.onnx + tokens.txt 的目录
   */
  public getAvailableModels(): ASRModelInfo[] {
    const basePath = this.getModelsBasePath();
    const models: ASRModelInfo[] = [];

    if (!fs.existsSync(basePath)) {
      logger.warn('[ASR] 模型目录不存在:', basePath);
      return models;
    }

    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(basePath, entry.name);
        const tokensFile = path.join(dirPath, 'tokens.txt');

        // 查找 .onnx 模型文件（优先 int8，其次任意 onnx）
        const files = fs.readdirSync(dirPath);
        const onnxFiles = files.filter(f => f.endsWith('.onnx'));
        if (onnxFiles.length === 0 || !fs.existsSync(tokensFile)) continue;

        // 优先选择 int8 量化模型
        const modelFile = onnxFiles.find(f => f.includes('int8')) || onnxFiles[0];
        const modelFilePath = path.join(dirPath, modelFile);

        let size = 0;
        try {
          size = fs.statSync(modelFilePath).size;
        } catch { /* ignore */ }

        models.push({
          name: entry.name,
          modelFile: modelFilePath,
          tokensFile,
          size,
        });
      }
    } catch (error) {
      logger.error('[ASR] 扫描模型目录失败:', error);
    }

    return models;
  }

  /**
   * 初始化 ASR 识别器
   * @param modelName 模型名（目录名），不传则使用默认模型
   */
  public async initialize(modelName?: string): Promise<boolean> {
    const targetModel = modelName || DEFAULT_MODEL_NAME;
    this.lastError = '';

    try {
      logger.info(`[ASR] 开始初始化，模型: ${targetModel}`);

      // 查找模型
      const models = this.getAvailableModels();
      const model = models.find(m => m.name === targetModel);

      if (!model) {
        this.lastError = `ASR 模型不存在: ${targetModel}`;
        logger.error(`[ASR] ${this.lastError}`);
        logger.error('[ASR] 可用模型:', models.map(m => m.name).join(', ') || '无');
        return false;
      }

      // 配置
      this.modelConfig = {
        modelPath: model.modelFile,
        tokensPath: model.tokensFile,
        provider: 'cpu',
        numThreads: 4,
      };

      // 加载 sherpa-onnx-node
      let sherpa;
      try {
        sherpa = require('sherpa-onnx-node');
      } catch (loadError) {
        this.lastError = 'sherpa-onnx-node 模块加载失败，请确保已正确安装';
        logger.error(`[ASR] ${this.lastError}: ${loadError}`);
        return false;
      }

      // 销毁旧识别器
      if (this.recognizer) {
        this.recognizer = null;
        this.isInitialized = false;
      }

      // 创建识别器配置
      const config = {
        'featConfig': {
          'sampleRate': 16000,
          'featureDim': 80,
        },
        'modelConfig': {
          'senseVoice': {
            'model': this.modelConfig.modelPath,
            'useInverseTextNormalization': 1,
          },
          'tokens': this.modelConfig.tokensPath,
          'numThreads': this.modelConfig.numThreads,
          'provider': this.modelConfig.provider,
          'debug': 0,
        },
      };

      // 创建识别器实例
      this.recognizer = new sherpa.OfflineRecognizer(config);
      this.isInitialized = true;
      this.currentModelName = targetModel;
      logger.info(`[ASR] 初始化成功，当前模型: ${targetModel}`);
      return true;
    } catch (error) {
      this.lastError = `初始化失败: ${(error as Error).message}`;
      logger.error('[ASR]', this.lastError);
      return false;
    }
  }

  /**
   * 切换 ASR 模型（重新初始化）
   */
  public async switchModel(modelName: string): Promise<boolean> {
    logger.info(`[ASR] 切换模型: ${this.currentModelName} → ${modelName}`);
    this.destroy();
    return this.initialize(modelName);
  }

  /**
   * 识别音频数据
   * @param audioBuffer 音频 Buffer（16kHz, 16-bit PCM）
   * @returns 识别结果
   */
  public async recognize(audioBuffer: Buffer): Promise<RecognitionResult | null> {
    if (!this.isInitialized || !this.recognizer) {
      logger.error('[ASR] 识别器未初始化');
      return null;
    }

    try {
      // 将 Buffer 转换为 Float32Array
      const samples = this.bufferToFloat32Array(audioBuffer);
      
      if (samples.length === 0) {
        logger.warn('[ASR] 音频数据为空');
        return { text: '', confidence: 0 };
      }

      // 创建音频流
      const stream = this.recognizer.createStream();
      
      // 接受音频样本
      stream.acceptWaveform({
        sampleRate: 16000,
        samples: samples
      });

      // 解码
      this.recognizer.decode(stream);
      
      // 获取结果
      const result = this.recognizer.getResult(stream);

      if (result && result.text) {
        return {
          text: result.text.trim(),
          confidence: 1.0
        };
      }

      return { text: '', confidence: 0 };
    } catch (error) {
      logger.error('[ASR] 识别失败:', error);
      return null;
    }
  }

  /**
   * 识别音频文件
   * @param audioFilePath 音频文件路径
   * @returns 识别结果
   */
  public async recognizeFile(audioFilePath: string): Promise<RecognitionResult | null> {
    try {
      // 读取音频文件
      const audioBuffer = fs.readFileSync(audioFilePath);
      return await this.recognize(audioBuffer);
    } catch (error) {
      logger.error('[ASR] 识别文件失败:', error);
      return null;
    }
  }

  /**
   * 将 Buffer 转换为 Float32Array
   */
  private bufferToFloat32Array(buffer: Buffer): Float32Array {
    // 假设输入是 16-bit PCM
    const int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    const float32Array = new Float32Array(int16Array.length);
    
    for (let i = 0; i < int16Array.length; i++) {
      // 归一化到 [-1, 1]
      float32Array[i] = int16Array[i] / 32768.0;
    }
    
    return float32Array;
  }

  /**
   * 检查是否已初始化
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * 获取当前加载的模型名
   */
  public getCurrentModel(): string {
    return this.currentModelName;
  }

  /**
   * 获取最近一次初始化错误
   */
  public getLastError(): string {
    return this.lastError;
  }

  /**
   * 销毁识别器
   */
  public destroy(): void {
    if (this.recognizer) {
      this.recognizer = null;
    }
    this.isInitialized = false;
  }
}

// 创建全局单例
const asrService = new ASRService();

export default asrService;
