/**
 * 内置 Agent 服务器（Pipeline 架构版）
 * 在主进程中运行的轻量级 WebSocket 服务器，实现与外部后端相同的通信协议
 * 
 * 职责：
 * - 启动/停止 WebSocket 服务
 * - 接收前端消息，创建 PipelineContext，驱动 Pipeline 执行
 * - 管理 WebSocket 连接与会话映射
 * 
 * 架构：
 * 消息 → AgentServer → PipelineContext → Pipeline(Stage...) → 回复
 *                                            ↑
 *                                     AgentHandler (业务逻辑)
 *                                     LLMProvider  (AI 接口)
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { logger } from './logger';
import {
  AgentHandler,
  Pipeline,
  PreProcessStage,
  ProcessStage,
  RespondStage,
  PipelineContext,
  type IncomingMessage,
  type Stage
} from './agent/index';

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
  private startTime: number | null = null;

  /** 实际监听的端口（区别于 config.port，用于检测端口变更） */
  private listeningPort: number | null = null;

  /** 业务逻辑处理器 */
  private handler: AgentHandler;

  /** 消息处理管线 */
  private pipeline: Pipeline;

  /** WebSocket → sessionId 映射 */
  private sessionMap: WeakMap<WebSocket, string> = new WeakMap();

  constructor(config: AgentServerConfig = { port: 8765 }) {
    this.config = {
      port: config.port,
      host: config.host || '127.0.0.1'
    };

    // 初始化业务层
    this.handler = new AgentHandler();

    // 构建默认管线
    this.pipeline = new Pipeline();
    this.pipeline.addStage(new PreProcessStage());
    this.pipeline.addStage(new ProcessStage(this.handler));
    this.pipeline.addStage(new RespondStage());
  }

  // ==================== 管线操作 ====================

  /** 在管线中插入自定义 Stage（在指定阶段之前） */
  public insertStageBefore(targetName: string, stage: Stage): boolean {
    return this.pipeline.insertBefore(targetName, stage);
  }

  /** 在管线中插入自定义 Stage（在指定阶段之后） */
  public insertStageAfter(targetName: string, stage: Stage): boolean {
    return this.pipeline.insertAfter(targetName, stage);
  }

  /** 移除管线阶段 */
  public removeStage(name: string): boolean {
    return this.pipeline.removeStage(name);
  }

  /** 获取管线阶段名称 */
  public getStageNames(): string[] {
    return this.pipeline.getStageNames();
  }

  // ==================== 服务器生命周期 ====================

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
          this.listeningPort = this.config.port;
          logger.info(`[AgentServer] 服务器已启动: ws://${this.config.host}:${this.config.port}`);
          logger.info(`[AgentServer] 管线阶段: ${this.pipeline.getStageNames().join(' → ')}`);
          resolve(true);
        });

        this.wss.on('connection', (ws: WebSocket) => {
          this.clients.add(ws);
          // 使用固定的 sessionId 'builtin'，使对话历史在重连后可恢复
          const sessionId = 'builtin';
          this.sessionMap.set(ws, sessionId);
          this.handler.sessions.getOrCreateSession(sessionId);
          logger.info(`[AgentServer] 客户端已连接 (会话: ${sessionId}, 当前: ${this.clients.size})`);

          // 发送已注册的指令列表到前端
          this.handler.sendCommandsRegister(ws);

          ws.on('message', (data: RawData) => {
            this.handleMessage(ws, data).catch(err =>
              logger.error('[AgentServer] 消息处理未捕获异常:', err)
            );
          });

          ws.on('close', () => {
            this.clients.delete(ws);
            this.handler.clearActiveConnection(ws);
            // 不移除 session 运行时状态，保持对话上下文在重连后可用
            logger.info(`[AgentServer] 客户端已断开 (当前: ${this.clients.size})`);
          });

          ws.on('error', (error: Error) => {
            logger.error('[AgentServer] 客户端错误:', error);
            this.clients.delete(ws);
            this.handler.clearActiveConnection(ws);
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
        this.listeningPort = null;
        logger.info('[AgentServer] 服务器已停止');
        resolve();
      });
    });
  }

  // ==================== 消息处理 ====================

  /**
   * 处理收到的消息 — 创建 PipelineContext 并驱动管线执行
   */
  private async handleMessage(ws: WebSocket, rawData: RawData): Promise<void> {
    try {
      const message: IncomingMessage = JSON.parse(rawData.toString());
      logger.debug('[AgentServer] 收到消息:', message.type);

      const sessionId = this.sessionMap.get(ws) || 'unknown';

      // 创建管线上下文
      const ctx = new PipelineContext(
        message,
        ws,
        sessionId,
        this.sendTo.bind(this)
      );

      // 驱动管线执行
      await this.pipeline.execute(ctx);
    } catch (error) {
      logger.error('[AgentServer] 消息处理失败:', error);
    }
  }

  // ==================== 消息发送 ====================

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

  // ==================== 状态查询 ====================

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
   * 检查配置的端口是否与实际监听端口一致
   */
  public needsRestart(): boolean {
    return this.wss !== null && this.listeningPort !== null && this.listeningPort !== this.config.port;
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
