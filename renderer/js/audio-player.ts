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
  
  // 流式音频相关
  private mediaSource: MediaSource | null;
  private sourceBuffer: SourceBuffer | null;
  private audioQueue: Uint8Array[];
  private isStreamMode: boolean;
  private timelineCallbacks: Array<{trigger: number, callback: () => void}>;
  private timelineTimers: number[];

  constructor() {
    this.audioContext = null;
    this.currentAudio = null;
    this.isPlaying = false;
    this.volume = 0.8;
    this.analyser = null;
    this.dataArray = null;
    this.lipSyncInterval = null;
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.audioQueue = [];
    this.isStreamMode = false;
    this.timelineCallbacks = [];
    this.timelineTimers = [];
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
   * 暂停播放
   */
  public pause(): void {
    if (this.currentAudio && this.isPlaying) {
      this.currentAudio.pause();
      this.isPlaying = false;
    }
  }

  /**
   * 停止播放
   */
  public stop(): void {
    this.clearTimeline();
    this.stopLipSync();
    
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    
    if (this.mediaSource) {
      if (this.mediaSource.readyState === 'open') {
        this.mediaSource.endOfStream();
      }
      this.mediaSource = null;
      this.sourceBuffer = null;
    }
    
    this.audioQueue = [];
    this.isStreamMode = false;
    this.isPlaying = false;
    
    console.log('音频播放已停止');
  }

  /**
   * 恢复播放
   */
  public resume(): void {
    if (this.currentAudio && !this.isPlaying) {
      this.currentAudio.play().catch(error => {
        console.error('恢复播放失败:', error);
      });
      this.isPlaying = true;
    }
  }

  /**
   * 设置音量
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.currentAudio) {
      this.currentAudio.volume = this.volume;
    }
    console.log('音量已设置为:', this.volume);
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

  /**
   * 开始流式音频播放
   * @param mimeType - MIME类型（如 audio/mpeg）
   */
  public startStreamingAudio(mimeType: string = 'audio/mpeg'): void {
    this.stop();
    this.clearTimeline();
    
    this.isStreamMode = true;
    this.audioQueue = [];
    
    // 创建 MediaSource
    this.mediaSource = new MediaSource();
    this.currentAudio = new Audio();
    this.currentAudio.volume = this.volume;
    this.currentAudio.src = URL.createObjectURL(this.mediaSource);
    
    // 监听 MediaSource 事件
    this.mediaSource.addEventListener('sourceopen', () => {
      if (!this.mediaSource) return;
      
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
        
        this.sourceBuffer.addEventListener('updateend', () => {
          this.processQueue();
        });
        
        console.log('[AudioPlayer] 流式播放器就绪');
      } catch (error) {
        console.error('[AudioPlayer] 创建 SourceBuffer 失败:', error);
      }
    });
    
    // 监听播放事件
    this.currentAudio.onplay = () => {
      this.isPlaying = true;
      this.startLipSync();
      console.log('[AudioPlayer] 流式音频开始播放');
    };
    
    this.currentAudio.onended = () => {
      this.isPlaying = false;
      this.stopLipSync();
      this.clearTimeline();
      console.log('[AudioPlayer] 流式音频播放结束');
    };
    
    this.currentAudio.onerror = (error) => {
      console.error('[AudioPlayer] 流式音频错误:', error);
      this.isPlaying = false;
      this.stopLipSync();
    };
  }

  /**
   * 追加音频块
   * @param chunk - 音频数据块
   */
  public appendAudioChunk(chunk: Uint8Array): void {
    if (!this.isStreamMode) {
      console.warn('[AudioPlayer] 未在流式模式下');
      return;
    }
    
    this.audioQueue.push(chunk);
    
    // 如果还没开始播放，且队列中有足够的数据，尝试开始播放
    if (!this.isPlaying && this.audioQueue.length >= 2 && this.currentAudio) {
      this.currentAudio.play().catch(err => {
        console.warn('[AudioPlayer] 自动播放失败:', err);
      });
    }
    
    this.processQueue();
  }

  /**
   * 处理音频队列
   */
  private processQueue(): void {
    if (!this.sourceBuffer || this.sourceBuffer.updating || this.audioQueue.length === 0) {
      return;
    }
    
    const chunk = this.audioQueue.shift()!;
    
    try {
      this.sourceBuffer.appendBuffer(chunk.buffer as ArrayBuffer);
    } catch (error) {
      console.error('[AudioPlayer] 追加音频块失败:', error);
    }
  }

  /**
   * 结束流式传输
   */
  public endStream(): void {
    if (!this.isStreamMode || !this.mediaSource) return;
    
    // 等待所有数据处理完毕
    const tryEnd = () => {
      if (this.audioQueue.length > 0) {
        setTimeout(tryEnd, 100);
        return;
      }
      
      if (this.sourceBuffer && !this.sourceBuffer.updating) {
        try {
          if (this.mediaSource && this.mediaSource.readyState === 'open') {
            this.mediaSource.endOfStream();
            console.log('[AudioPlayer] 流式传输结束');
          }
        } catch (error) {
          console.warn('[AudioPlayer] 结束流失败:', error);
        }
      }
    };
    
    tryEnd();
  }

  /**
   * 设置时间轴
   * @param timeline - 时间轴数组
   * @param totalDuration - 总时长（毫秒）
   */
  public setTimeline(timeline: Array<{timing: string | number, callback: () => void}>, totalDuration?: number): void {
    this.clearTimeline();
    
    timeline.forEach(item => {
      let triggerTime: number;
      
      if (typeof item.timing === 'number') {
        // 百分比 (0-100)
        if (totalDuration) {
          triggerTime = (item.timing / 100) * totalDuration;
        } else {
          console.warn('[AudioPlayer] 百分比时间轴需要 totalDuration');
          return;
        }
      } else {
        // 语义标记
        const semanticMap: {[key: string]: number} = {
          'start': 0,
          'early': 0.15,
          'middle': 0.5,
          'late': 0.85,
          'end': 0.98
        };
        
        const ratio = semanticMap[item.timing] ?? 0;
        triggerTime = totalDuration ? ratio * totalDuration : 0;
      }
      
      this.timelineCallbacks.push({
        trigger: triggerTime,
        callback: item.callback
      });
    });
    
    console.log('[AudioPlayer] 时间轴已设置:', this.timelineCallbacks.length, '个触发点');
  }

  /**
   * 启动时间轴
   */
  public startTimeline(): void {
    this.timelineCallbacks.forEach(item => {
      const timer = window.setTimeout(() => {
        item.callback();
      }, item.trigger);
      
      this.timelineTimers.push(timer);
    });
  }

  /**
   * 清除时间轴
   */
  private clearTimeline(): void {
    this.timelineTimers.forEach(timer => clearTimeout(timer));
    this.timelineTimers = [];
    this.timelineCallbacks = [];
  }
}

// 导出全局实例
window.audioPlayer = new AudioPlayer();
