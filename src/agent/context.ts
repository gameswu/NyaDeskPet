/**
 * Pipeline 上下文 & 会话管理
 * 参考 AstrBot 的 UMO (Unified Message Origin) + ConversationManager 设计
 * 
 * PipelineContext：单次消息处理的上下文，贯穿整个管线
 * SessionManager：会话/对话历史管理，基于 SQLite 持久化
 */

import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { logger } from '../logger';
import type { ChatMessage, ToolCallInfo } from './provider';
import { agentDb, type MessageRecord, type MessageType } from './database';

// ==================== Pipeline Context ====================

/** 前端发来的原始消息 */
export interface IncomingMessage {
  type: string;
  text?: string;
  data?: unknown;
  timestamp?: number;
  action?: string;
  position?: { x: number; y: number };
}

/** 回复消息（发送到前端） */
export interface OutgoingMessage {
  type: string;
  data?: unknown;
  /** 响应会话 ID（同一次回复的所有消息共享相同 ID） */
  responseId?: string;
  /** 响应优先级（用于前端中断判断） */
  priority?: number;
  [key: string]: unknown;
}

/**
 * 可发送消息的最小接口
 * 供 synthesizeAndStream / executeWithToolLoop 等方法使用，
 * PipelineContext 和 MessageContext 代理均可满足
 */
export interface Sendable {
  /** 会话 ID */
  sessionId: string;
  /** 立即发送消息 */
  send(msg: object): void;
}

/**
 * Pipeline 上下文
 * 每条前端消息创建一个，在所有 Stage 间共享
 */
export class PipelineContext {
  /** 原始消息 */
  public message: IncomingMessage;

  /** 关联的 WebSocket 连接 */
  public ws: WebSocket;

  /** 会话 ID（从连接中派生） */
  public sessionId: string;

  /** 待发送的回复列表（由各 Stage 填充） */
  public replies: OutgoingMessage[] = [];

  /** 管线是否已中止 */
  public aborted: boolean = false;

  /** 处理过程中的错误 */
  public error: Error | null = null;

  /** 通用键值存储，Stage 之间传递数据 */
  public state: Map<string, unknown> = new Map();

  /** 发送函数（由 AgentServer 注入） */
  private sendFn: (ws: WebSocket, msg: object) => void;

  /**
   * 响应会话 ID（同一次管线处理产生的所有消息共享）
   * 前端据此将多条消息归为同一组，统一管理中断
   */
  public responseId: string;

  /**
   * 响应优先级（PreProcessStage 根据消息类型自动设置）
   * 前端据此判断新响应是否能中断当前正在播放的响应
   */
  public responsePriority: number = 0;

  constructor(
    message: IncomingMessage,
    ws: WebSocket,
    sessionId: string,
    sendFn: (ws: WebSocket, msg: object) => void
  ) {
    this.message = message;
    this.ws = ws;
    this.sessionId = sessionId;
    this.sendFn = sendFn;
    this.responseId = randomUUID();
  }

  /** 添加回复到缓冲（Respond 阶段统一发送），自动注入 responseId 和 priority */
  addReply(msg: OutgoingMessage): void {
    msg.responseId = this.responseId;
    msg.priority = this.responsePriority;
    this.replies.push(msg);
  }

  /** 立即发送消息（不经过缓冲，用于流式场景），自动注入 responseId 和 priority */
  send(msg: object): void {
    const envelope = msg as Record<string, unknown>;
    if (envelope.responseId === undefined) {
      envelope.responseId = this.responseId;
    }
    if (envelope.priority === undefined) {
      envelope.priority = this.responsePriority;
    }
    this.sendFn(this.ws, envelope);
  }

  /** 中止管线（后续 Stage 不再执行） */
  abort(): void {
    this.aborted = true;
  }
}

// ==================== 会话管理（SQLite 持久化） ====================

/** 会话运行时信息（内存中，不持久化） */
interface SessionRuntime {
  /** 当前对话 ID */
  currentConversationId: string;
  /** 扩展数据 */
  metadata: Record<string, unknown>;
}

/**
 * 会话管理器（SQLite 持久化版）
 * 参考 AstrBot 的 ConversationManager — 会话/对话分离
 * 
 * Session：对应一个 WebSocket 连接（运行时状态在内存中）
 * Conversation：一次连续对话，消息持久化到 SQLite
 */
export class SessionManager {
  /** 运行时会话状态（内存中） */
  private sessions: Map<string, SessionRuntime> = new Map();
  private maxHistoryPerConversation: number;

  /** 是否从 LLM 历史上下文中过滤指令消息 */
  private _filterCommandFromHistory: boolean = true;

  constructor(maxHistory: number = 50) {
    this.maxHistoryPerConversation = maxHistory;
  }

  /** 获取是否过滤指令消息 */
  get filterCommandFromHistory(): boolean {
    return this._filterCommandFromHistory;
  }

  /** 设置是否过滤指令消息 */
  set filterCommandFromHistory(value: boolean) {
    this._filterCommandFromHistory = value;
    logger.info(`[SessionManager] 指令消息过滤: ${value ? '开启' : '关闭'}`);
  }

  /** 获取或创建会话 */
  getOrCreateSession(sessionId: string): SessionRuntime {
    let session = this.sessions.get(sessionId);
    if (!session) {
      // 尝试从数据库恢复最近的对话
      let convId: string;
      try {
        const existingConvs = agentDb.getConversationsBySession(sessionId, 1);
        if (existingConvs.length > 0) {
          convId = existingConvs[0].id;
          logger.debug(`[SessionManager] 恢复会话: ${sessionId}, 对话: ${convId}`);
        } else {
          const conv = agentDb.createConversation(sessionId);
          convId = conv.id;
          logger.debug(`[SessionManager] 创建会话: ${sessionId}, 新对话: ${convId}`);
        }
      } catch {
        // 数据库未初始化时回退到内存 ID
        convId = this.generateId();
        logger.debug(`[SessionManager] 创建会话(内存): ${sessionId}`);
      }

      session = {
        currentConversationId: convId,
        metadata: {}
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /** 获取当前对话 ID */
  getCurrentConversationId(sessionId: string): string {
    const session = this.getOrCreateSession(sessionId);
    return session.currentConversationId;
  }

  /** 获取当前对话的历史消息（从 SQLite 读取，转换为 ChatMessage 格式） */
  getHistory(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    try {
      const records = agentDb.getMessages(session.currentConversationId, this.maxHistoryPerConversation);
      const filtered = this._filterCommandFromHistory
        ? records.filter(r => r.type !== 'command')
        : records;
      return filtered.map(r => this.recordToChatMessage(r));
    } catch {
      // 数据库未初始化时返回空
      return [];
    }
  }

  /** 追加消息到当前对话（持久化到 SQLite） */
  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.getOrCreateSession(sessionId);

    try {
      const { type, extra } = this.chatMessageToRecord(message);
      agentDb.addMessage(session.currentConversationId, message.role, message.content, {
        type,
        extra,
        tokenCount: 0
      });

      // 自动生成对话标题（第一条用户消息，跳过指令消息）
      if (message.role === 'user' && !message.isCommand) {
        const conv = agentDb.getConversation(session.currentConversationId);
        if (conv && !conv.title) {
          const title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
          agentDb.updateConversationTitle(session.currentConversationId, title);
        }
      }
    } catch {
      // 数据库未初始化时忽略
      logger.debug('[SessionManager] 数据库未初始化，消息未持久化');
    }
  }

  /** 开始新对话（保留会话） */
  newConversation(sessionId: string): string {
    const session = this.getOrCreateSession(sessionId);

    let convId: string;
    try {
      const conv = agentDb.createConversation(sessionId);
      convId = conv.id;
    } catch {
      convId = this.generateId();
    }

    session.currentConversationId = convId;
    logger.debug(`[SessionManager] 新对话: ${convId} (会话: ${sessionId})`);
    return convId;
  }

  /** 切换到指定对话 */
  switchConversation(sessionId: string, conversationId: string): boolean {
    const session = this.getOrCreateSession(sessionId);
    try {
      const conv = agentDb.getConversation(conversationId);
      if (conv) {
        session.currentConversationId = conversationId;
        logger.debug(`[SessionManager] 切换对话: ${conversationId}`);
        return true;
      }
    } catch {
      // 忽略
    }
    return false;
  }

  /** 获取会话的所有对话列表 */
  getConversationList(sessionId: string): Array<{ id: string; title: string; updatedAt: number }> {
    try {
      return agentDb.getConversationsBySession(sessionId).map(c => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt
      }));
    } catch {
      return [];
    }
  }

  /** 删除对话 */
  deleteConversation(sessionId: string, conversationId: string): void {
    const session = this.sessions.get(sessionId);
    try {
      agentDb.deleteConversation(conversationId);
    } catch {
      // 忽略
    }

    // 如果删除的是当前对话，切换到新对话
    if (session && session.currentConversationId === conversationId) {
      this.newConversation(sessionId);
    }
  }

  /** 清除会话的所有对话历史 */
  clearHistory(sessionId: string): void {
    try {
      agentDb.deleteConversationsBySession(sessionId);
    } catch {
      // 忽略
    }
    // 创建新的空对话
    this.newConversation(sessionId);
  }

  /** 删除会话（不删除持久化数据，仅移除运行时状态） */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug(`[SessionManager] 移除运行时会话: ${sessionId}`);
  }

  /** 设置会话元数据 */
  setMetadata(sessionId: string, key: string, value: unknown): void {
    const session = this.getOrCreateSession(sessionId);
    session.metadata[key] = value;
  }

  /** 获取会话元数据 */
  getMetadata(sessionId: string, key: string): unknown {
    return this.sessions.get(sessionId)?.metadata[key];
  }

  // ==================== 内部工具方法 ====================

  /** 将 MessageRecord 转换为 ChatMessage */
  private recordToChatMessage(record: MessageRecord): ChatMessage {
    const msg: ChatMessage = {
      role: record.role,
      content: record.content
    };

    // 斜杠指令消息：标记并直接返回
    if (record.type === 'command') {
      msg.isCommand = true;
      return msg;
    }

    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(record.extra || '{}');
    } catch {
      // 忽略
    }

    // 恢复附件
    if (record.type === 'image' || record.type === 'file') {
      msg.attachment = extra.attachment as ChatMessage['attachment'];
    }

    // 恢复 tool_calls（assistant 消息）
    if (extra.toolCalls) {
      msg.toolCalls = extra.toolCalls as ToolCallInfo[];
    }

    // 恢复 tool_call_id（tool 消息）
    if (extra.toolCallId) {
      msg.toolCallId = extra.toolCallId as string;
    }
    if (extra.toolName) {
      msg.toolName = extra.toolName as string;
    }

    // 恢复多模态图片（工具结果）
    if (extra.images && Array.isArray(extra.images)) {
      msg.images = extra.images as ChatMessage['images'];
    }

    return msg;
  }

  /** 将 ChatMessage 转换为存储格式（type + extra） */
  private chatMessageToRecord(msg: ChatMessage): { type: MessageType; extra: Record<string, unknown> } {
    let type: MessageType = 'text';
    const extra: Record<string, unknown> = {};

    // 斜杠指令消息优先标记
    if (msg.isCommand) {
      type = 'command';
      return { type, extra };
    }

    if (msg.attachment) {
      type = msg.attachment.type === 'image' ? 'image' : 'file';
      extra.attachment = msg.attachment;
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      type = 'tool_call';
      extra.toolCalls = msg.toolCalls;
    }

    if (msg.toolCallId) {
      type = 'tool_result';
      extra.toolCallId = msg.toolCallId;
      if (msg.toolName) {
        extra.toolName = msg.toolName;
      }
      // 持久化多模态图片（工具结果）
      if (msg.images && msg.images.length > 0) {
        extra.images = msg.images;
      }
    }

    if (msg.role === 'system') {
      type = 'system';
    }

    return { type, extra };
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
