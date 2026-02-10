/**
 * 设置管理器
 * 负责应用设置的存储、读取和管理
 */

import type { SettingsManager as ISettingsManager, AppSettings, TapConfig } from '../types/global';

class SettingsManager implements ISettingsManager {
  private storageKey = 'nya-desk-pet-settings';
  private settings: AppSettings;
  private defaultSettings: AppSettings = {
    modelPath: '../models/live2d/mao_pro_zh/runtime/mao_pro.model3.json',
    backendUrl: 'http://localhost:8000',
    wsUrl: 'ws://localhost:8000/ws',
    autoConnect: true,
    volume: 0.8,
    updateSource: 'https://github.com/gameswu/NyaDeskPet',
    locale: 'zh-CN',
    theme: 'system',
    showSubtitle: true,
    tapConfigs: {},
    useCustomCharacter: false,
    customName: '',
    customPersonality: '',
    micBackgroundMode: false,
    micVolumeThreshold: 30,
    micAutoSend: true,
    enableEyeTracking: true,
    logEnabled: false,
    logLevels: ['warn', 'error', 'critical'],
    logRetentionDays: 7
  };

  constructor() {
    this.settings = this.loadSettings();
  }

  /**
   * 初始化设置管理器
   */
  public initialize(): void {
    console.log('设置管理器初始化');
    this.settings = this.loadSettings();
  }

  /**
   * 从 localStorage 加载设置
   */
  private loadSettings(): AppSettings {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...this.defaultSettings, ...parsed };
      }
    } catch (error) {
      console.error('加载设置失败:', error);
    }
    return { ...this.defaultSettings };
  }

  /**
   * 保存设置到 localStorage
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
      console.log('设置已保存');
    } catch (error) {
      console.error('保存设置失败:', error);
    }
  }

  /**
   * 获取所有设置
   */
  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  /**
   * 获取单个设置项
   */
  public getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  /**
   * 更新单个设置项
   */
  public setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value;
    this.saveSettings();
  }

  /**
   * 批量更新设置
   */
  public updateSettings(updates: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
  }

  /**
   * 重置为默认设置
   */
  public resetToDefaults(): void {
    this.settings = { ...this.defaultSettings };
    this.saveSettings();
  }

  /**
   * 验证设置有效性
   */
  public validateSettings(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证模型路径
    if (!this.settings.modelPath || this.settings.modelPath.trim() === '') {
      errors.push('模型路径不能为空');
    }

    // 验证后端URL
    if (this.settings.autoConnect) {
      if (!this.settings.backendUrl || !this.isValidUrl(this.settings.backendUrl)) {
        errors.push('后端URL格式不正确');
      }
      if (!this.settings.wsUrl || !this.isValidWebSocketUrl(this.settings.wsUrl)) {
        errors.push('WebSocket URL格式不正确');
      }
    }

    // 验证音量
    if (this.settings.volume < 0 || this.settings.volume > 1) {
      errors.push('音量必须在0-1之间');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 验证URL格式
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * 验证WebSocket URL格式
   */
  private isValidWebSocketUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
    } catch {
      return false;
    }
  }

  /**
   * 导出设置为JSON
   */
  public exportSettings(): string {
    return JSON.stringify(this.settings, null, 2);
  }

  /**
   * 从JSON导入设置
   */
  public importSettings(json: string): boolean {
    try {
      const imported = JSON.parse(json);
      this.settings = { ...this.defaultSettings, ...imported };
      this.saveSettings();
      return true;
    } catch (error) {
      console.error('导入设置失败:', error);
      return false;
    }
  }

  /**
   * 获取指定模型的触碰配置
   */
  public getTapConfig(modelPath: string): TapConfig {
    if (!this.settings.tapConfigs) {
      this.settings.tapConfigs = {};
    }
    
    // 如果该模型没有配置，返回默认配置
    if (!this.settings.tapConfigs[modelPath]) {
      return this.getDefaultTapConfig();
    }
    
    return this.settings.tapConfigs[modelPath];
  }

  /**
   * 更新指定模型的触碰配置
   */
  public updateTapConfig(modelPath: string, config: TapConfig): void {
    if (!this.settings.tapConfigs) {
      this.settings.tapConfigs = {};
    }
    
    this.settings.tapConfigs[modelPath] = config;
    this.saveSettings();
    console.log('触碰配置已保存:', modelPath);
  }

  /**
   * 获取当前模型的触碰配置
   */
  public getCurrentTapConfig(): any {
    return this.getTapConfig(this.settings.modelPath);
  }

  /**
   * 获取默认触碰配置
   */
  private getDefaultTapConfig(): any {
    return {
      'Head': { enabled: true, description: '头部触摸' },
      'Body': { enabled: true, description: '身体触摸' },
      'Mouth': { enabled: true, description: '嘴部触摸' },
      'Face': { enabled: true, description: '脸部触摸' },
      'default': { enabled: true, description: '默认触摸' }
    };
  }
}

// 创建全局实例
const settingsManager = new SettingsManager();
window.settingsManager = settingsManager;

export default settingsManager;
