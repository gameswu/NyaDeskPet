/**
 * SQLite 数据库管理
 * 参考 AstrBot 的 SQLiteDatabase 设计
 * 
 * 使用 better-sqlite3（同步 API）简化 Electron 主进程中的数据库操作。
 * 存储位置：app.getPath('userData')/data/agent.db
 * 
 * 表结构：
 * - conversations：对话表（一个对话包含多条消息）
 * - messages：消息表（支持多种类型：text, image, file, tool_call, tool_result）
 * - tool_definitions：工具定义表（Function Calling + MCP 工具）
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from '../logger';

// ==================== 数据实体类型 ====================

/** 对话记录 */
export interface ConversationRecord {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  metadata: string; // JSON 字符串
}

/** 消息类型 */
export type MessageType = 'text' | 'image' | 'file' | 'tool_call' | 'tool_result' | 'system';

/** 消息记录 */
export interface MessageRecord {
  id: number;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  type: MessageType;
  content: string;
  /** 额外数据（JSON）：附件信息、tool_call 参数、tool_result 等 */
  extra: string;
  tokenCount: number;
  createdAt: number;
}

/** 工具定义记录 */
export interface ToolDefinitionRecord {
  id: string;
  name: string;
  description: string;
  /** JSON Schema 格式的参数定义 */
  parameters: string;
  /** 工具来源：'function' | 'mcp' */
  source: 'function' | 'mcp';
  /** MCP 服务器名（source=mcp 时） */
  mcpServer: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ==================== 数据库管理器 ====================

export class AgentDatabase {
  private db: Database.Database | null = null;
  private dbPath: string = '';

  /**
   * 初始化数据库
   * @param customPath 自定义路径（测试用），默认使用 appData/NyaDeskPet/data
   */
  initialize(customPath?: string): void {
    if (this.db) {
      logger.warn('[AgentDB] 数据库已初始化');
      return;
    }

    // 确定数据库路径
    if (customPath) {
      this.dbPath = customPath;
    } else {
      const dataDir = path.join(app.getPath('userData'), 'data');
      fs.mkdirSync(dataDir, { recursive: true });
      this.dbPath = path.join(dataDir, 'agent.db');
    }

    logger.info(`[AgentDB] 初始化数据库: ${this.dbPath}`);

    this.db = new Database(this.dbPath);

    // 启用 WAL 模式提升并发性能
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // 创建表结构
    this.createTables();
  }

  /** 关闭数据库 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('[AgentDB] 数据库已关闭');
    }
  }

  private ensureDb(): Database.Database {
    if (!this.db) {
      throw new Error('数据库未初始化，请先调用 initialize()');
    }
    return this.db;
  }

  // ==================== 表结构 ====================

  private createTables(): void {
    const db = this.ensureDb();

    db.exec(`
      -- 对话表
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
      CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

      -- 消息表
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
        type TEXT NOT NULL DEFAULT 'text',
        content TEXT NOT NULL DEFAULT '',
        extra TEXT DEFAULT '{}',
        token_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at);

      -- 工具定义表
      CREATE TABLE IF NOT EXISTS tool_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        parameters TEXT DEFAULT '{}',
        source TEXT NOT NULL DEFAULT 'function' CHECK(source IN ('function', 'mcp')),
        mcp_server TEXT,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_source ON tool_definitions(source);
      CREATE INDEX IF NOT EXISTS idx_tool_enabled ON tool_definitions(enabled);
    `);

    logger.info('[AgentDB] 表结构已就绪');
  }

  // ==================== 对话 CRUD ====================

  /** 创建对话 */
  createConversation(sessionId: string, title?: string, id?: string): ConversationRecord {
    const db = this.ensureDb();
    const now = Date.now();
    const convId = id || `conv_${now}_${Math.random().toString(36).slice(2, 8)}`;

    db.prepare(`
      INSERT INTO conversations (id, session_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(convId, sessionId, title || '', now, now);

    return {
      id: convId,
      sessionId,
      title: title || '',
      createdAt: now,
      updatedAt: now,
      metadata: '{}'
    };
  }

  /** 获取对话 */
  getConversation(id: string): ConversationRecord | null {
    const db = this.ensureDb();
    const row = db.prepare(`
      SELECT id, session_id as sessionId, title, created_at as createdAt,
             updated_at as updatedAt, metadata
      FROM conversations WHERE id = ?
    `).get(id) as ConversationRecord | undefined;
    return row || null;
  }

  /** 获取会话的所有对话 */
  getConversationsBySession(sessionId: string, limit: number = 50, offset: number = 0): ConversationRecord[] {
    const db = this.ensureDb();
    return db.prepare(`
      SELECT id, session_id as sessionId, title, created_at as createdAt,
             updated_at as updatedAt, metadata
      FROM conversations
      WHERE session_id = ?
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(sessionId, limit, offset) as ConversationRecord[];
  }

  /** 获取所有对话（分页） */
  getAllConversations(limit: number = 50, offset: number = 0): { conversations: ConversationRecord[]; total: number } {
    const db = this.ensureDb();
    const conversations = db.prepare(`
      SELECT id, session_id as sessionId, title, created_at as createdAt,
             updated_at as updatedAt, metadata
      FROM conversations
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as ConversationRecord[];

    const total = (db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }).count;
    return { conversations, total };
  }

  /** 更新对话标题 */
  updateConversationTitle(id: string, title: string): void {
    const db = this.ensureDb();
    db.prepare(`
      UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
    `).run(title, Date.now(), id);
  }

  /** 更新对话时间戳 */
  touchConversation(id: string): void {
    const db = this.ensureDb();
    db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  /** 删除对话（级联删除消息） */
  deleteConversation(id: string): void {
    const db = this.ensureDb();
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  /** 删除会话的所有对话 */
  deleteConversationsBySession(sessionId: string): void {
    const db = this.ensureDb();
    db.prepare('DELETE FROM conversations WHERE session_id = ?').run(sessionId);
  }

  // ==================== 消息 CRUD ====================

  /** 添加消息 */
  addMessage(
    conversationId: string,
    role: MessageRecord['role'],
    content: string,
    options?: {
      type?: MessageType;
      extra?: Record<string, unknown>;
      tokenCount?: number;
    }
  ): MessageRecord {
    const db = this.ensureDb();
    const now = Date.now();
    const type = options?.type || 'text';
    const extra = JSON.stringify(options?.extra || {});
    const tokenCount = options?.tokenCount || 0;

    const result = db.prepare(`
      INSERT INTO messages (conversation_id, role, type, content, extra, token_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(conversationId, role, type, content, extra, tokenCount, now);

    // 更新对话时间戳
    this.touchConversation(conversationId);

    return {
      id: result.lastInsertRowid as number,
      conversationId,
      role,
      type,
      content,
      extra,
      tokenCount,
      createdAt: now
    };
  }

  /** 批量添加消息（事务） */
  addMessages(conversationId: string, messages: Array<{
    role: MessageRecord['role'];
    content: string;
    type?: MessageType;
    extra?: Record<string, unknown>;
    tokenCount?: number;
  }>): void {
    const db = this.ensureDb();
    const insertStmt = db.prepare(`
      INSERT INTO messages (conversation_id, role, type, content, extra, token_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      const now = Date.now();
      for (const msg of messages) {
        insertStmt.run(
          conversationId,
          msg.role,
          msg.type || 'text',
          msg.content,
          JSON.stringify(msg.extra || {}),
          msg.tokenCount || 0,
          now
        );
      }
      this.touchConversation(conversationId);
    });

    transaction();
  }

  /** 获取对话的消息列表 */
  getMessages(conversationId: string, limit: number = 200, offset: number = 0): MessageRecord[] {
    const db = this.ensureDb();
    return db.prepare(`
      SELECT id, conversation_id as conversationId, role, type, content, extra,
             token_count as tokenCount, created_at as createdAt
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `).all(conversationId, limit, offset) as MessageRecord[];
  }

  /** 获取对话的消息数量 */
  getMessageCount(conversationId: string): number {
    const db = this.ensureDb();
    return (db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { count: number }).count;
  }

  /** 删除对话的所有消息 */
  clearMessages(conversationId: string): void {
    const db = this.ensureDb();
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  }

  // ==================== 工具定义 CRUD ====================

  /** 注册/更新工具定义 */
  upsertToolDefinition(tool: {
    id: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    source: 'function' | 'mcp';
    mcpServer?: string;
    enabled?: boolean;
  }): void {
    const db = this.ensureDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO tool_definitions (id, name, description, parameters, source, mcp_server, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        parameters = excluded.parameters,
        source = excluded.source,
        mcp_server = excluded.mcp_server,
        updated_at = excluded.updated_at
    `).run(
      tool.id,
      tool.name,
      tool.description,
      JSON.stringify(tool.parameters),
      tool.source,
      tool.mcpServer || null,
      tool.enabled !== false ? 1 : 0,
      now,
      now
    );
  }

  /** 获取所有已启用的工具 */
  getEnabledTools(): ToolDefinitionRecord[] {
    const db = this.ensureDb();
    return db.prepare(`
      SELECT id, name, description, parameters, source,
             mcp_server as mcpServer, enabled, created_at as createdAt, updated_at as updatedAt
      FROM tool_definitions
      WHERE enabled = 1
      ORDER BY name
    `).all() as ToolDefinitionRecord[];
  }

  /** 获取所有工具 */
  getAllTools(): ToolDefinitionRecord[] {
    const db = this.ensureDb();
    return db.prepare(`
      SELECT id, name, description, parameters, source,
             mcp_server as mcpServer, enabled, created_at as createdAt, updated_at as updatedAt
      FROM tool_definitions
      ORDER BY source, name
    `).all() as ToolDefinitionRecord[];
  }

  /** 启用/禁用工具 */
  setToolEnabled(id: string, enabled: boolean): void {
    const db = this.ensureDb();
    db.prepare(`
      UPDATE tool_definitions SET enabled = ?, updated_at = ? WHERE id = ?
    `).run(enabled ? 1 : 0, Date.now(), id);
  }

  /** 删除工具 */
  deleteTool(id: string): void {
    const db = this.ensureDb();
    db.prepare('DELETE FROM tool_definitions WHERE id = ?').run(id);
  }

  /** 删除某个 MCP 服务器的所有工具 */
  deleteToolsByMcpServer(serverName: string): void {
    const db = this.ensureDb();
    db.prepare('DELETE FROM tool_definitions WHERE source = ? AND mcp_server = ?').run('mcp', serverName);
  }

  // ==================== 统计 ====================

  /** 获取数据库统计 */
  getStats(): { conversations: number; messages: number; tools: number } {
    const db = this.ensureDb();
    const conversations = (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }).c;
    const messages = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;
    const tools = (db.prepare('SELECT COUNT(*) as c FROM tool_definitions').get() as { c: number }).c;
    return { conversations, messages, tools };
  }
}

/** 全局数据库实例 */
export const agentDb = new AgentDatabase();
