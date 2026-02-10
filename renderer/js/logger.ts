/**
 * 渲染进程日志管理器（包装器）
 * 通过 IPC 将日志发送到主进程
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

class Logger {
  private enabled: boolean = false;
  private levels: LogLevel[] = ['warn', 'error', 'critical'];

  /**
   * 初始化日志系统
   */
  public async initialize(): Promise<void> {
    try {
      // 从主进程获取当前配置
      const config = await window.electronAPI.loggerGetConfig();
      this.enabled = config.enabled;
      this.levels = config.levels;
      
      console.log('[Renderer Logger] 日志系统已初始化', config);
    } catch (error) {
      console.error('[Renderer Logger] 初始化失败:', error);
    }
  }

  /**
   * 更新配置
   */
  public async updateConfig(config: { enabled?: boolean; levels?: LogLevel[]; retentionDays?: number }): Promise<void> {
    try {
      await window.electronAPI.loggerUpdateConfig(config);
      
      if (config.enabled !== undefined) {
        this.enabled = config.enabled;
      }
      if (config.levels) {
        this.levels = config.levels;
      }
      
      console.log('[Renderer Logger] 配置已更新', config);
    } catch (error) {
      console.error('[Renderer Logger] 更新配置失败:', error);
    }
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.enabled || !this.levels.includes(level)) {
      return;
    }

    // 通过 IPC 发送到主进程
    window.electronAPI.loggerLog(level, `[Renderer] ${message}`, data);

    // 同时输出到控制台
    const consoleMethod = level === 'critical' || level === 'error' ? 'error' : 
                         level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](`[Logger] ${message}`, data || '');
  }

  /**
   * 调试日志
   */
  public debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  /**
   * 信息日志
   */
  public info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  /**
   * 警告日志
   */
  public warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  /**
   * 错误日志
   */
  public error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  /**
   * 严重错误日志
   */
  public critical(message: string, data?: any): void {
    this.log('critical', message, data);
  }

  /**
   * 获取日志文件列表
   */
  public async getLogFiles(): Promise<Array<{ name: string; path: string; size: number; mtime: Date }>> {
    try {
      return await window.electronAPI.loggerGetFiles();
    } catch (error) {
      console.error('[Renderer Logger] 获取日志文件列表失败:', error);
      return [];
    }
  }

  /**
   * 删除日志文件
   */
  public async deleteLogFile(fileName: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.loggerDeleteFile(fileName);
      return result.success;
    } catch (error) {
      console.error('[Renderer Logger] 删除日志文件失败:', error);
      return false;
    }
  }

  /**
   * 删除所有日志文件
   */
  public async deleteAllLogs(): Promise<number> {
    try {
      const result = await window.electronAPI.loggerDeleteAll();
      return result.count;
    } catch (error) {
      console.error('[Renderer Logger] 删除所有日志失败:', error);
      return 0;
    }
  }

  /**
   * 打开日志目录
   */
  public async openLogDirectory(): Promise<void> {
    try {
      await window.electronAPI.loggerOpenDirectory();
    } catch (error) {
      console.error('[Renderer Logger] 打开日志目录失败:', error);
    }
  }

  /**
   * 获取当前配置
   */
  public async getConfig(): Promise<any> {
    try {
      return await window.electronAPI.loggerGetConfig();
    } catch (error) {
      console.error('[Renderer Logger] 获取配置失败:', error);
      return null;
    }
  }
}

// 导出单例
export const logger = new Logger();

// 暴露到全局
(window as any).logger = logger;
