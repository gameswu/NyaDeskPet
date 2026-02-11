/**
 * ASR 服务（主进程）
 * 使用 Sherpa-ONNX 进行语音识别
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from './logger';

// Sherpa-ONNX 类型定义
interface SherpaConfig {
  modelPath: string;
  tokensPath: string;
  provider: string;
  numThreads: number;
}

interface RecognitionResult {
  text: string;
  confidence?: number;
}

class ASRService {
  private recognizer: any = null;
  private isInitialized: boolean = false;
  private modelConfig: SherpaConfig;

  constructor() {
    // 获取应用根目录路径
    const appPath = app.getAppPath();
    
    // 打包后，资源文件可能在 resources/app.asar 或 resources/app 中
    // app.getAppPath() 会返回正确的路径
    const modelBasePath = path.join(appPath, 'models', 'asr', 'sense-voice-small');
    
    this.modelConfig = {
      modelPath: path.join(modelBasePath, 'model.int8.onnx'),
      tokensPath: path.join(modelBasePath, 'tokens.txt'),
      provider: 'cpu',
      numThreads: 4
    };
  }

  /**
   * 初始化 ASR 识别器
   */
  public async initialize(): Promise<boolean> {
    try {
      logger.info('[ASR] 开始初始化...');
      
      // 检查模型文件是否存在
      if (!fs.existsSync(this.modelConfig.modelPath)) {
        logger.error('[ASR] 模型文件不存在:', this.modelConfig.modelPath);
        logger.error('[ASR] 请确保模型文件已正确放置在 models/asr/sense-voice-small/ 目录');
        return false;
      }
      
      if (!fs.existsSync(this.modelConfig.tokensPath)) {
        logger.error('[ASR] Tokens 文件不存在:', this.modelConfig.tokensPath);
        return false;
      }

      // 直接加载 sherpa-onnx-node 包（让 Node.js 自动从 node_modules 解析）
      let sherpa;
      try {
        sherpa = require('sherpa-onnx-node');
      } catch (loadError) {
        logger.error('[ASR] 加载 sherpa-onnx-node 模块失败:', loadError);
        logger.error('[ASR] 请确保 sherpa-onnx-node 已正确安装');
        return false;
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
        }
      };

      // 创建识别器实例
      this.recognizer = new sherpa.OfflineRecognizer(config);
      this.isInitialized = true;
      logger.info('[ASR] 初始化成功');
      return true;
    } catch (error) {
      logger.error('[ASR] 初始化失败:', error);
      return false;
    }
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
