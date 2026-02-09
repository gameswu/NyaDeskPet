/**
 * 音频播放器
 * 负责播放语音和音效
 */

import type { AudioPlayer as IAudioPlayer } from '../types/global';

class AudioPlayer implements IAudioPlayer {
  public audioContext: AudioContext | null;
  public currentAudio: HTMLAudioElement | null;
  public isPlaying: boolean;
  public volume: number;
  private analyser: AnalyserNode | null;
  private dataArray: Uint8Array | null;
  private lipSyncInterval: number | null;

  constructor() {
    this.audioContext = null;
    this.currentAudio = null;
    this.isPlaying = false;
    this.volume = 0.8;
    this.analyser = null;
    this.dataArray = null;
    this.lipSyncInterval = null;
    this.initAudioContext();
  }

  /**
   * 初始化音频上下文
   */
  public initAudioContext(): void {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();
      console.log('音频上下文初始化成功');
    } catch (error) {
      console.error('音频上下文初始化失败:', error);
    }
  }

  /**
   * 播放音频
   * @param source - 音频源（URL 或 base64）
   */
  public async playAudio(source: string): Promise<boolean> {
    try {
      // 停止当前播放
      this.stop();

      // 创建新的音频元素
      this.currentAudio = new Audio();
      this.currentAudio.volume = this.volume;
      this.currentAudio.crossOrigin = 'anonymous'; // 允许跨域音频分析

      // 判断是 URL 还是 base64
      if (source.startsWith('data:audio')) {
        this.currentAudio.src = source;
      } else if (source.startsWith('http://') || source.startsWith('https://')) {
        this.currentAudio.src = source;
      } else {
        // 假设是 base64
        this.currentAudio.src = `data:audio/mp3;base64,${source}`;
      }

      // 设置音频分析器用于口型同步
      this.setupLipSync();

      // 监听事件
      this.currentAudio.onplay = () => {
        this.isPlaying = true;
        this.startLipSync();
        console.log('音频开始播放');
      };

      this.currentAudio.onended = () => {
        this.isPlaying = false;
        this.stopLipSync();
        console.log('音频播放结束');
      };

      this.currentAudio.onerror = (error: Event | string) => {
        this.isPlaying = false;
        this.stopLipSync();
        console.error('音频播放错误:', error);
      };

      // 播放
      await this.currentAudio.play();
      return true;
    } catch (error) {
      console.error('播放音频失败:', error);
      this.isPlaying = false;
      return false;
    }
  }

  /**
   * 播放本地文件
   * @param filePath - 本地文件路径
   */
  public async playLocalFile(filePath: string): Promise<boolean> {
    return await this.playAudio(filePath);
  }

  /**
   * 暂停播放
   */
  public pause(): void {
    if (this.currentAudio && this.isPlaying) {
      this.currentAudio.pause();
      this.isPlaying = false;
    }
  }

  /**
   * 恢复播放
   */
  public resume(): void {
    if (this.currentAudio && !this.isPlaying) {
      this.currentAudio.play();
      this.isPlaying = true;
    }
  }

  /**
   * 停止播放
   */
  public stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
      this.isPlaying = false;
    }
  }

  /**
   * 设置音量
   * @param volume - 音量（0-1）
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio) {
      this.currentAudio.volume = this.volume;
    }
  }

  /**
   * 设置音频分析器用于口型同步
   */
  private setupLipSync(): void {
    if (!this.audioContext || !this.currentAudio) return;
    
    try {
      // 创建分析器节点
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength) as any;
      
      // 连接音频源到分析器
      const source = this.audioContext.createMediaElementSource(this.currentAudio);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      
      console.log('口型同步分析器已设置');
    } catch (error) {
      console.warn('设置口型同步失败:', error);
    }
  }

  /**
   * 开始口型同步
   */
  private startLipSync(): void {
    if (!this.analyser || !this.dataArray) return;
    
    // 清除旧的定时器
    if (this.lipSyncInterval) {
      clearInterval(this.lipSyncInterval);
    }
    
    // 每帧更新口型
    this.lipSyncInterval = window.setInterval(() => {
      if (!this.analyser || !this.dataArray) return;
      
      // 获取音频频率数据
      this.analyser.getByteFrequencyData(this.dataArray as any);
      
      // 计算平均音量
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        sum += this.dataArray[i];
      }
      const average = sum / this.dataArray.length;
      
      // 转换为 0-1 的值（0-255 -> 0-1）
      const lipValue = Math.min(average / 128, 1.0);
      
      // 更新 Live2D 模型的口型
      if (window.live2dManager) {
        window.live2dManager.setLipSync(lipValue);
      }
    }, 1000 / 30); // 30 FPS
  }

  /**
   * 停止口型同步
   */
  private stopLipSync(): void {
    if (this.lipSyncInterval) {
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
    }
    
    // 重置口型
    if (window.live2dManager) {
      window.live2dManager.stopLipSync();
    }
  }

  /**
   * 获取当前播放状态
   */
  public getStatus(): {
    isPlaying: boolean;
    volume: number;
    currentTime: number;
    duration: number;
  } {
    return {
      isPlaying: this.isPlaying,
      volume: this.volume,
      currentTime: this.currentAudio ? this.currentAudio.currentTime : 0,
      duration: this.currentAudio ? this.currentAudio.duration : 0
    };
  }
}

// 导出全局实例
window.audioPlayer = new AudioPlayer();
