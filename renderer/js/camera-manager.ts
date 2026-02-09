/**
 * 摄像头管理器
 * 负责摄像头设备的枚举、选择、预览和截图
 */

import type { CameraManager as ICameraManager } from '../types/global';

class CameraManager implements ICameraManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private devices: MediaDeviceInfo[] = [];
  private currentDeviceId: string | null = null;
  private isActive: boolean = false;

  constructor() {
    this.videoElement = document.getElementById('camera-preview') as HTMLVideoElement;
  }

  /**
   * 初始化摄像头管理器
   */
  public async initialize(): Promise<void> {
    console.log('摄像头管理器初始化');
    await this.enumerateDevices();
  }

  /**
   * 枚举所有摄像头设备
   */
  public async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    try {
      // 先请求一次权限，否则 enumerateDevices 可能无法获取设备标签
      await navigator.mediaDevices.getUserMedia({ video: true });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.devices = devices.filter(device => device.kind === 'videoinput');
      
      console.log(`发现 ${this.devices.length} 个摄像头设备:`, this.devices);
      
      return this.devices;
    } catch (error) {
      console.error('枚举摄像头设备失败:', error);
      return [];
    }
  }

  /**
   * 获取可用的摄像头设备列表
   */
  public getDevices(): MediaDeviceInfo[] {
    return this.devices;
  }

  /**
   * 启动摄像头
   */
  public async start(deviceId?: string): Promise<void> {
    try {
      // 如果已经有活动的流，先停止它
      if (this.stream) {
        this.stop();
      }

      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentDeviceId = deviceId || null;
      this.isActive = true;

      if (this.videoElement) {
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
        
        // 显示预览容器
        const container = document.getElementById('camera-preview-container');
        if (container) {
          container.classList.remove('hidden');
        }
      }

      console.log('摄像头已启动:', deviceId || '默认设备');
    } catch (error) {
      console.error('启动摄像头失败:', error);
      this.isActive = false;
      throw error;
    }
  }

  /**
   * 停止摄像头
   */
  public stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.isActive = false;

      if (this.videoElement) {
        this.videoElement.srcObject = null;
      }

      // 隐藏预览容器
      const container = document.getElementById('camera-preview-container');
      if (container) {
        container.classList.add('hidden');
      }

      console.log('摄像头已停止');
    }
  }

  /**
   * 切换摄像头设备
   */
  public async switchDevice(deviceId: string): Promise<void> {
    const wasActive = this.isActive;
    if (wasActive) {
      this.stop();
      await this.start(deviceId);
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
   * 检查摄像头是否活动
   */
  public isRunning(): boolean {
    return this.isActive;
  }

  /**
   * 截取当前画面
   */
  public async captureFrame(): Promise<string | null> {
    if (!this.videoElement || !this.isActive) {
      console.warn('摄像头未启动，无法截图');
      return null;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = this.videoElement.videoWidth;
      canvas.height = this.videoElement.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('无法获取 canvas 上下文');
      }

      ctx.drawImage(this.videoElement, 0, 0);
      
      // 转换为 base64
      const base64 = canvas.toDataURL('image/jpeg', 0.8);
      console.log('截取画面成功');
      
      return base64;
    } catch (error) {
      console.error('截取画面失败:', error);
      return null;
    }
  }

  /**
   * 销毁摄像头管理器
   */
  public destroy(): void {
    this.stop();
    this.devices = [];
    this.videoElement = null;
  }
}

// 创建全局实例
const cameraManager = new CameraManager();
window.cameraManager = cameraManager;

export default cameraManager;
