/**
 * 麦克风管理器
 * 负责麦克风设备的枚举、选择、录音和语音识别（预留接口）
 */

import type { MicrophoneManager as IMicrophoneManager } from '../types/global';

class MicrophoneManager implements IMicrophoneManager {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private devices: MediaDeviceInfo[] = [];
  private currentDeviceId: string | null = null;
  private isRecording: boolean = false;
  private isListening: boolean = false;
  
  // 音量检测相关
  private volumeThreshold: number = 30; // 音量阈值 (0-100)
  private silenceTimeout: number = 1500; // 静音超时时间（毫秒）
  private silenceTimer: number | null = null;
  private isSpeaking: boolean = false;
  private recordedChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  
  // ASR 相关（预留）
  // @ts-ignore - 预留给未来的 ASR 实现
  private asrCallback: ((text: string) => void) | null = null;
  private backgroundModeEnabled: boolean = false;

  constructor() {
    // 初始化不做任何操作，等待显式调用 initialize
  }

  /**
   * 初始化麦克风管理器
   * 注意：不在这里枚举设备，只在真正需要使用时才请求权限
   */
  public async initialize(): Promise<void> {
    window.logger.info('麦克风管理器初始化（延迟加载设备）');
    // 不在初始化时枚举设备，避免过早请求权限
    
    // 从设置中加载配置
    if (window.settingsManager) {
      const settings = window.settingsManager.getSettings();
      this.volumeThreshold = settings.micVolumeThreshold || 30;
      this.backgroundModeEnabled = settings.micBackgroundMode || false;
    }
  }

  /**
   * 枚举所有麦克风设备
   * 只在用户主动使用麦克风功能时调用
   */
  public async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    try {
      // 不预先请求权限，只枚举设备（可能获取不到设备标签，但避免过早弹出权限请求）
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.devices = devices.filter(device => device.kind === 'audioinput');
      
      window.logger.info(`发现 ${this.devices.length} 个麦克风设备:`, this.devices);
      
      return this.devices;
    } catch (error) {
      window.logger.error('枚举麦克风设备失败:', error);
      return [];
    }
  }

  /**
   * 获取可用的麦克风设备列表
   */
  public getDevices(): MediaDeviceInfo[] {
    return this.devices;
  }

  /**
   * 启动麦克风监听
   */
  public async startListening(deviceId?: string): Promise<void> {
    try {
      if (this.stream) {
        this.stopListening();
      }

      // 首次启动时重新枚举设备（获取权限后可以拿到设备标签）
      if (this.devices.length === 0) {
        await this.enumerateDevices();
      }

      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentDeviceId = deviceId || null;
      this.isListening = true;

      // 创建音频上下文和分析器
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      const source = this.audioContext.createMediaStreamSource(this.stream);
      source.connect(this.analyser);

      // 开始音量检测循环
      this.startVolumeDetection();

      window.logger.info('麦克风监听已启动:', deviceId || '默认设备');
    } catch (error) {
      window.logger.error('启动麦克风监听失败:', error);
      this.isListening = false;
      throw error;
    }
  }

  /**
   * 停止麦克风监听
   */
  public stopListening(): void {
    this.isListening = false;
    
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.isSpeaking = false;
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    window.logger.info('麦克风监听已停止');
  }

  /**
   * 音量检测循环
   */
  private startVolumeDetection(): void {
    if (!this.analyser || !this.isListening) {
      return;
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    
    const detectVolume = () => {
      if (!this.isListening || !this.analyser) {
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);
      
      // 计算平均音量
      const sum = dataArray.reduce((a, b) => a + b, 0);
      const average = sum / dataArray.length;
      const volume = (average / 255) * 100;

      // 检测说话状态
      if (volume > this.volumeThreshold) {
        if (!this.isSpeaking) {
          this.onSpeechStart();
        }
        this.isSpeaking = true;
        
        // 重置静音计时器
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
        }
        this.silenceTimer = window.setTimeout(() => {
          this.onSpeechEnd();
        }, this.silenceTimeout);
      }

      requestAnimationFrame(detectVolume);
    };

    detectVolume();
  }

  /**
   * 开始说话回调
   */
  private onSpeechStart(): void {
    window.logger.info('检测到说话开始');
    this.startRecording();
  }

  /**
   * 结束说话回调
   */
  private onSpeechEnd(): void {
    window.logger.info('检测到说话结束');
    this.isSpeaking = false;
    this.stopRecording();
  }

  /**
   * 开始录音
   */
  private startRecording(): void {
    if (!this.stream || this.isRecording) {
      return;
    }

    try {
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream);
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.processRecording();
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      window.logger.info('开始录音');
    } catch (error) {
      window.logger.error('启动录音失败:', error);
    }
  }

  /**
   * 停止录音
   */
  private stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      window.logger.info('停止录音');
    }
  }

  /**
   * 处理录音数据（将来集成 ASR）
   */
  private async processRecording(): Promise<void> {
    if (this.recordedChunks.length === 0) {
      return;
    }

    const audioBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
    window.logger.info('录音完成，大小:', audioBlob.size, 'bytes');

    // 调用 ASR 识别
    const recognizedText = await this.performASR(audioBlob);
    if (recognizedText && this.asrCallback) {
      this.asrCallback(recognizedText);
    }
  }

  /**
   * 执行语音识别（使用 Sherpa-ONNX）
   * @param audioBlob 音频数据
   * @returns 识别的文本
   */
  private async performASR(audioBlob: Blob): Promise<string | null> {
    try {
      // 将 Blob 转换为 Base64（使用浏览器 API）
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // 使用 btoa 将二进制数据转换为 Base64
      let binary = '';
      const len = uint8Array.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64Audio = btoa(binary);
      
      // 调用主进程的 ASR 服务
      const result = await (window as any).electronAPI.asrRecognize(base64Audio);
      
      if (result.success && result.text) {
        return result.text;
      } else {
        window.logger.error('[MicrophoneManager] ASR 识别失败:', result.error);
        return null;
      }
    } catch (error) {
      window.logger.error('[MicrophoneManager] ASR 识别异常:', error);
      return null;
    }
  }

  /**
   * 设置 ASR 回调函数
   */
  public setASRCallback(callback: (text: string) => void): void {
    this.asrCallback = callback;
  }

  /**
   * 设置音量阈值
   */
  public setVolumeThreshold(threshold: number): void {
    this.volumeThreshold = Math.max(0, Math.min(100, threshold));
    window.logger.info('音量阈值已设置为:', this.volumeThreshold);
  }

  /**
   * 获取音量阈值
   */
  public getVolumeThreshold(): number {
    return this.volumeThreshold;
  }

  /**
   * 设置背景模式
   */
  public setBackgroundMode(enabled: boolean): void {
    this.backgroundModeEnabled = enabled;
    window.logger.info('背景模式已', enabled ? '启用' : '禁用');
  }

  /**
   * 获取背景模式状态
   */
  public isBackgroundModeEnabled(): boolean {
    return this.backgroundModeEnabled;
  }

  /**
   * 切换麦克风设备
   */
  public async switchDevice(deviceId: string): Promise<void> {
    const wasListening = this.isListening;
    if (wasListening) {
      this.stopListening();
      await this.startListening(deviceId);
    }
    this.currentDeviceId = deviceId;
  }

  /**
   * 获取当前设备ID
   */
  public getCurrentDeviceId(): string | null {
    return this.currentDeviceId;
  }

  /**
   * 检查是否正在监听
   */
  public isActive(): boolean {
    return this.isListening;
  }

  /**
   * 销毁麦克风管理器
   */
  public destroy(): void {
    this.stopListening();
    this.devices = [];
    this.asrCallback = null;
  }
}

// 创建全局实例
const microphoneManager = new MicrophoneManager();
window.microphoneManager = microphoneManager;

export default microphoneManager;
