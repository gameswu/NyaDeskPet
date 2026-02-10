/**
 * 主进程日志管理器
 * 负责日志记录、文件管理和自动清理
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

interface LoggerConfig {
  enabled: boolean;
  levels: LogLevel[];
  retentionDays: number;
  logDir: string;
}

class Logger {
  private config: LoggerConfig;
  private logFilePath: string | null = null;
  private logStream: fs.WriteStream | null = null;
  private sessionStartTime: Date;

  constructor() {
    this.sessionStartTime = new Date();
    
    // 默认配置
    this.config = {
      enabled: false,
      levels: ['warn', 'error', 'critical'],
      retentionDays: 7,
      logDir: path.join(app.getPath('userData'), 'logs')
    };
  }

  /**
   * 初始化日志系统
   */
  public initialize(config?: Partial<LoggerConfig>): void {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    if (!this.config.enabled) {
      console.log('[Logger] 日志记录已禁用');
      return;
    }

    // 确保日志目录存在
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    // 创建日志文件
    this.createLogFile();

    // 清理过期日志
    this.cleanOldLogs();

    console.log('[Logger] 日志系统已初始化');
    console.log(`[Logger] 日志文件: ${this.logFilePath}`);
  }

  /**
   * 创建日志文件
   */
  private createLogFile(): void {
    const timestamp = this.sessionStartTime.getTime();
    const fileName = `app-${timestamp}.log`;
    this.logFilePath = path.join(this.config.logDir, fileName);

    this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    
    // 写入会话开始标记
    this.writeToFile('='.repeat(80));
    this.writeToFile(`Session started at: ${this.sessionStartTime.toISOString()}`);
    this.writeToFile(`Electron version: ${process.versions.electron}`);
    this.writeToFile(`Node version: ${process.versions.node}`);
    this.writeToFile(`Platform: ${process.platform}`);
    this.writeToFile('='.repeat(80));
  }

  /**
   * 写入日志文件
   */
  private writeToFile(message: string): void {
    if (this.logStream && !this.logStream.destroyed) {
      this.logStream.write(message + '\n');
    }
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(8);
    let formattedMsg = `[${timestamp}] [${levelStr}] ${message}`;
    
    if (data) {
      if (data instanceof Error) {
        formattedMsg += `\n  Error: ${data.message}\n  Stack: ${data.stack}`;
      } else if (typeof data === 'object') {
        formattedMsg += `\n  Data: ${JSON.stringify(data, null, 2)}`;
      } else {
        formattedMsg += `\n  Data: ${data}`;
      }
    }
    
    return formattedMsg;
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, data?: any): void {
    // 检查是否启用日志记录
    if (!this.config.enabled) {
      return;
    }

    // 检查日志级别
    if (!this.config.levels.includes(level)) {
      return;
    }

    const formattedMsg = this.formatMessage(level, message, data);
    
    // 写入文件
    this.writeToFile(formattedMsg);
    
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
   * 清理过期日志
   */
  private cleanOldLogs(): void {
    if (!fs.existsSync(this.config.logDir)) {
      return;
    }

    const now = Date.now();
    const maxAge = this.config.retentionDays * 24 * 60 * 60 * 1000;

    try {
      const files = fs.readdirSync(this.config.logDir);
      
      files.forEach(file => {
        if (!file.endsWith('.log')) {
          return;
        }

        const filePath = path.join(this.config.logDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtime.getTime();

        if (age > maxAge) {
          fs.unlinkSync(filePath);
          console.log(`[Logger] 已删除过期日志: ${file}`);
        }
      });
    } catch (error) {
      console.error('[Logger] 清理日志失败:', error);
    }
  }

  /**
   * 获取日志文件列表
   */
  public getLogFiles(): Array<{ name: string; path: string; size: number; mtime: Date; isCurrent: boolean }> {
    if (!fs.existsSync(this.config.logDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(this.config.logDir);
      
      return files
        .filter(file => file.endsWith('.log'))
        .map(file => {
          const filePath = path.join(this.config.logDir, file);
          const stats = fs.statSync(filePath);
          
          return {
            name: file,
            path: filePath,
            size: stats.size,
            mtime: stats.mtime,
            isCurrent: filePath === this.logFilePath
          };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch (error) {
      console.error('[Logger] 获取日志文件列表失败:', error);
      return [];
    }
  }

  /**
   * 删除指定日志文件
   */
  public deleteLogFile(fileName: string): boolean {
    const filePath = path.join(this.config.logDir, fileName);
    
    try {
      if (fs.existsSync(filePath)) {
        // 不允许删除当前会话的日志文件
        if (filePath === this.logFilePath) {
          console.warn('[Logger] 无法删除当前会话的日志文件');
          return false;
        }
        
        fs.unlinkSync(filePath);
        console.log(`[Logger] 已删除日志文件: ${fileName}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Logger] 删除日志文件失败:', error);
      return false;
    }
  }

  /**
   * 删除所有日志文件
   */
  public deleteAllLogs(): number {
    if (!fs.existsSync(this.config.logDir)) {
      return 0;
    }

    let deletedCount = 0;

    try {
      const files = fs.readdirSync(this.config.logDir);
      
      files.forEach(file => {
        if (!file.endsWith('.log')) {
          return;
        }

        const filePath = path.join(this.config.logDir, file);
        
        // 跳过当前会话的日志文件
        if (filePath === this.logFilePath) {
          return;
        }

        try {
          fs.unlinkSync(filePath);
          deletedCount++;
        } catch (error) {
          console.error(`[Logger] 删除日志文件失败: ${file}`, error);
        }
      });

      console.log(`[Logger] 已删除 ${deletedCount} 个日志文件`);
    } catch (error) {
      console.error('[Logger] 删除所有日志失败:', error);
    }

    return deletedCount;
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<LoggerConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    // 如果从禁用变为启用，需要初始化
    if (!wasEnabled && this.config.enabled) {
      this.initialize();
    }
    
    // 如果从启用变为禁用，关闭日志流
    if (wasEnabled && !this.config.enabled) {
      this.close();
    }

    console.log('[Logger] 配置已更新', this.config);
  }

  /**
   * 获取当前配置
   */
  public getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * 打开日志目录
   */
  public openLogDirectory(): void {
    const { shell } = require('electron');
    if (fs.existsSync(this.config.logDir)) {
      shell.openPath(this.config.logDir);
    }
  }

  /**
   * 关闭日志系统
   */
  public close(): void {
    if (this.logStream && !this.logStream.destroyed) {
      this.writeToFile('='.repeat(80));
      this.writeToFile(`Session ended at: ${new Date().toISOString()}`);
      this.writeToFile('='.repeat(80));
      this.logStream.end();
      this.logStream = null;
    }
    console.log('[Logger] 日志系统已关闭');
  }
}

// 导出单例
export const logger = new Logger();
