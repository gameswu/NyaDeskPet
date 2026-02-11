/**
 * 内置 Agent 服务器
 * 在主进程中运行的轻量级 WebSocket 服务器，实现与外部后端相同的通信协议
 * 
 * 职责：
 * - 启动/停止 WebSocket 服务
 * - 接收前端消息并转发给 AgentHandler
 * - 将 AgentHandler 的响应发送回前端
 * 
 * 设计原则：
 * - 服务器仅负责通信传输，不包含业务逻辑
 * - 所有业务逻辑由 AgentHandler 处理
 * - 保持与外部后端协议完全一致
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { logger } from './logger';
import { AgentHandler } from './agent-handler';

export interface AgentServerConfig {
  port: number;
  host?: string;
}

export interface AgentServerStatus {
  running: boolean;
  port: number;
  host: string;
  connectedClients: number;
  startTime: number | null;
}

export class AgentServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private config: AgentServerConfig;
  private handler: AgentHandler;
  private startTime: number | null = null;

  constructor(config: AgentServerConfig = { port: 8765 }) {
    this.config = {
      port: config.port,
      host: config.host || '127.0.0.1'
    };
    this.handler = new AgentHandler(this);
  }

  /**
   * 启动 WebSocket 服务器
   */
  public start(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.wss) {
        logger.warn('[AgentServer] 服务器已在运行');
        resolve(true);
        return;
      }

      try {
        this.wss = new WebSocketServer({
          port: this.config.port,
          host: this.config.host
        });

        this.wss.on('listening', () => {
          this.startTime = Date.now();
          logger.info(`[AgentServer] 服务器已启动: ws://${this.config.host}:${this.config.port}`);
          resolve(true);
        });

        this.wss.on('connection', (ws: WebSocket) => {
          this.clients.add(ws);
          logger.info(`[AgentServer] 客户端已连接 (当前: ${this.clients.size})`);

          ws.on('message', (data: RawData) => {
            this.handleMessage(ws, data);
          });

          ws.on('close', () => {
            this.clients.delete(ws);
            logger.info(`[AgentServer] 客户端已断开 (当前: ${this.clients.size})`);
          });

          ws.on('error', (error: Error) => {
            logger.error('[AgentServer] 客户端错误:', error);
            this.clients.delete(ws);
          });
        });

        this.wss.on('error', (error: Error) => {
          logger.error('[AgentServer] 服务器错误:', error);
          this.wss = null;
          resolve(false);
        });

      } catch (error) {
        logger.error('[AgentServer] 启动失败:', error);
        resolve(false);
      }
    });
  }

  /**
   * 停止 WebSocket 服务器
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // 关闭所有客户端连接
      this.clients.forEach(ws => {
        try {
          ws.close(1000, 'Server shutting down');
        } catch (e) {
          // 忽略关闭错误
        }
      });
      this.clients.clear();

      this.wss.close((err) => {
        if (err) {
          logger.error('[AgentServer] 关闭错误:', err);
        }
        this.wss = null;
        this.startTime = null;
        logger.info('[AgentServer] 服务器已停止');
        resolve();
      });
    });
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(ws: WebSocket, rawData: RawData): void {
    try {
      const data = JSON.parse(rawData.toString());
      logger.debug('[AgentServer] 收到消息:', data.type);
      
      // 委托给 AgentHandler 处理
      this.handler.handleMessage(data, ws);
    } catch (error) {
      logger.error('[AgentServer] 消息解析失败:', error);
    }
  }

  /**
   * 向指定客户端发送消息
   */
  public sendTo(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * 向所有客户端广播消息
   */
  public broadcast(message: object): void {
    const data = JSON.stringify(message);
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  /**
   * 获取服务器状态
   */
  public getStatus(): AgentServerStatus {
    return {
      running: this.wss !== null,
      port: this.config.port,
      host: this.config.host || '127.0.0.1',
      connectedClients: this.clients.size,
      startTime: this.startTime
    };
  }

  /**
   * 获取 AgentHandler
   */
  public getHandler(): AgentHandler {
    return this.handler;
  }

  /**
   * 更新配置（需要重启生效）
   */
  public updateConfig(config: Partial<AgentServerConfig>): void {
    if (config.port !== undefined) this.config.port = config.port;
    if (config.host !== undefined) this.config.host = config.host;
  }

  /**
   * 服务器是否在运行
   */
  public isRunning(): boolean {
    return this.wss !== null;
  }

  /**
   * 获取当前端口
   */
  public getPort(): number {
    return this.config.port;
  }

  /**
   * 获取 WebSocket URL
   */
  public getWsUrl(): string {
    return `ws://${this.config.host}:${this.config.port}`;
  }
}
