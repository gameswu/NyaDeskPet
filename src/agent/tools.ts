/**
 * 工具系统 — Function Calling & MCP 支持
 * 参考 AstrBot 的 FunctionTool / ToolSet / MCPTool / FunctionToolManager 设计
 * 
 * 核心概念：
 * - ToolSchema：工具的 JSON Schema 描述（OpenAI function calling 格式）
 * - ToolDefinition：注册到系统中的工具定义
 * - ToolCall：LLM 返回的工具调用请求
 * - ToolResult：工具执行后的结果
 * - ToolManager：工具注册表 + 执行器
 */

import { logger } from '../logger';
import { agentDb } from './database';

// ==================== 核心类型 ====================

/** 工具的 JSON Schema（OpenAI function calling 格式） */
export interface ToolSchema {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 JSON Schema */
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: Record<string, unknown>;
      default?: unknown;
    }>;
    required?: string[];
  };
}

/** 工具定义（注册到系统中） */
export interface ToolDefinition {
  /** 唯一 ID */
  id: string;
  /** JSON Schema */
  schema: ToolSchema;
  /** 工具来源 */
  source: 'function' | 'mcp' | 'plugin';
  /** 执行器（function 类型工具） */
  handler?: ToolHandler;
  /** MCP 服务器名（mcp 类型工具） */
  mcpServer?: string;
  /** 是否启用 */
  enabled: boolean;
}

/** 工具执行器类型 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** LLM 返回的工具调用请求 */
export interface ToolCall {
  /** 调用 ID（用于匹配结果） */
  id: string;
  /** 工具名称 */
  name: string;
  /** 调用参数 */
  arguments: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResult {
  /** 调用 ID */
  toolCallId: string;
  /** 结果内容（文本） */
  content: string;
  /** 是否执行成功 */
  success: boolean;
  /** 额外数据（如图片等） */
  data?: Record<string, unknown>;
}

/** 转换为 OpenAI API tools 格式 */
export interface OpenAIToolFormat {
  type: 'function';
  function: ToolSchema;
}

// ==================== 工具管理器 ====================

/**
 * 工具管理器
 * 参考 AstrBot 的 FunctionToolManager
 * 
 * 职责：
 * - 注册/注销 Function Calling 工具
 * - 管理 MCP 工具
 * - 生成 OpenAI API 的 tools 参数
 * - 执行工具调用
 */
export class ToolManager {
  /** 已注册的工具 */
  private tools: Map<string, ToolDefinition> = new Map();

  /** 工具变更回调列表 */
  private onChangeCallbacks: Array<() => void> = [];

  constructor() {}

  /** 注册工具变更回调 */
  onChange(callback: () => void): void {
    this.onChangeCallbacks.push(callback);
  }

  /** 通知工具变更 */
  private notifyChange(): void {
    for (const cb of this.onChangeCallbacks) {
      try { cb(); } catch { /* ignore */ }
    }
  }

  // ==================== 工具注册 ====================

  /**
   * 注册 Function Calling 工具
   */
  registerFunction(
    schema: ToolSchema,
    handler: ToolHandler,
    options?: { id?: string; enabled?: boolean; source?: 'function' | 'plugin' }
  ): void {
    const id = options?.id || `func_${schema.name}`;
    const source = options?.source || 'function';
    const def: ToolDefinition = {
      id,
      schema,
      source,
      handler,
      enabled: options?.enabled !== false
    };

    this.tools.set(id, def);
    logger.info(`[ToolManager] 注册工具: ${schema.name} (${id})`);

    // 持久化到数据库
    try {
      agentDb.upsertToolDefinition({
        id,
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
        source,
        enabled: def.enabled
      });
    } catch {
      // 数据库未初始化时忽略
    }

    this.notifyChange();
  }

  /**
   * 注册 MCP 工具（由 MCP 客户端在连接后调用）
   */
  registerMCPTool(
    schema: ToolSchema,
    mcpServer: string,
    handler: ToolHandler
  ): void {
    const id = `mcp_${mcpServer}_${schema.name}`;
    const def: ToolDefinition = {
      id,
      schema,
      source: 'mcp',
      handler,
      mcpServer,
      enabled: true
    };

    this.tools.set(id, def);
    logger.info(`[ToolManager] 注册 MCP 工具: ${schema.name} (server: ${mcpServer})`);

    // 持久化到数据库
    try {
      agentDb.upsertToolDefinition({
        id,
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
        source: 'mcp',
        mcpServer,
        enabled: true
      });
    } catch {
      // 数据库未初始化时忽略
    }

    this.notifyChange();
  }

  /** 注销工具 */
  unregister(id: string): void {
    this.tools.delete(id);
    try {
      agentDb.deleteTool(id);
    } catch {
      // 忽略
    }
    logger.info(`[ToolManager] 注销工具: ${id}`);
    this.notifyChange();
  }

  /** 注销某个 MCP 服务器的所有工具 */
  unregisterMCPServer(serverName: string): void {
    for (const [id, def] of this.tools) {
      if (def.source === 'mcp' && def.mcpServer === serverName) {
        this.tools.delete(id);
      }
    }
    try {
      agentDb.deleteToolsByMcpServer(serverName);
    } catch {
      // 忽略
    }
    logger.info(`[ToolManager] 注销 MCP 服务器的所有工具: ${serverName}`);
    this.notifyChange();
  }

  // ==================== 工具查询 ====================

  /** 获取所有已启用的工具定义 */
  getEnabledTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.enabled);
  }

  /** 获取所有工具定义 */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** 根据名称查找工具 */
  getToolByName(name: string): ToolDefinition | undefined {
    return Array.from(this.tools.values()).find(t => t.schema.name === name);
  }

  /** 根据 ID 查找工具 */
  getToolById(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  /** 启用/禁用工具 */
  setEnabled(id: string, enabled: boolean): void {
    const tool = this.tools.get(id);
    if (tool) {
      tool.enabled = enabled;
      try {
        agentDb.setToolEnabled(id, enabled);
      } catch {
        // 忽略
      }
    }
  }

  /** 是否有已启用的工具 */
  hasEnabledTools(): boolean {
    return this.getEnabledTools().length > 0;
  }

  // ==================== OpenAI 格式转换 ====================

  /**
   * 生成 OpenAI API 的 tools 参数
   * 仅包含已启用的工具
   */
  toOpenAITools(): OpenAIToolFormat[] {
    return this.getEnabledTools().map(def => ({
      type: 'function' as const,
      function: def.schema
    }));
  }

  // ==================== 工具执行 ====================

  /**
   * 执行工具调用
   * @param toolCall LLM 返回的工具调用请求
   * @param timeout 超时时间（毫秒），默认 60 秒
   */
  async executeTool(toolCall: ToolCall, timeout: number = 60000): Promise<ToolResult> {
    const tool = this.getToolByName(toolCall.name);

    if (!tool) {
      logger.error(`[ToolManager] 未找到工具: ${toolCall.name}`);
      return {
        toolCallId: toolCall.id,
        content: `Error: Tool "${toolCall.name}" not found`,
        success: false
      };
    }

    if (!tool.enabled) {
      logger.warn(`[ToolManager] 工具已禁用: ${toolCall.name}`);
      return {
        toolCallId: toolCall.id,
        content: `Error: Tool "${toolCall.name}" is disabled`,
        success: false
      };
    }

    if (!tool.handler) {
      logger.error(`[ToolManager] 工具无执行器: ${toolCall.name}`);
      return {
        toolCallId: toolCall.id,
        content: `Error: Tool "${toolCall.name}" has no handler`,
        success: false
      };
    }

    try {
      logger.info(`[ToolManager] 执行工具: ${toolCall.name}`, { args: toolCall.arguments });

      // 带超时执行（清理定时器避免泄漏）
      let timer: NodeJS.Timeout;
      const timeoutPromise = new Promise<ToolResult>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool "${toolCall.name}" execution timeout (${timeout}ms)`)), timeout);
      });
      
      try {
        const result = await Promise.race([
          tool.handler(toolCall.arguments),
          timeoutPromise
        ]);

        // 确保 toolCallId 正确
        result.toolCallId = toolCall.id;
        
        logger.info(`[ToolManager] 工具执行完成: ${toolCall.name}`, { success: result.success });
        return result;
      } finally {
        clearTimeout(timer!);
      }
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`[ToolManager] 工具执行失败: ${toolCall.name}`, { error: message });
      return {
        toolCallId: toolCall.id,
        content: `Error: ${message}`,
        success: false
      };
    }
  }

  /**
   * 批量执行工具调用
   */
  async executeToolCalls(toolCalls: ToolCall[], timeout: number = 60000): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      const result = await this.executeTool(tc, timeout);
      results.push(result);
    }
    return results;
  }

  /** 获取工具统计 */
  getStats(): { total: number; enabled: number; function: number; mcp: number; plugin: number } {
    const all = this.getAllTools();
    return {
      total: all.length,
      enabled: all.filter(t => t.enabled).length,
      function: all.filter(t => t.source === 'function').length,
      mcp: all.filter(t => t.source === 'mcp').length,
      plugin: all.filter(t => t.source === 'plugin').length
    };
  }
}

/** 全局工具管理器实例 */
export const toolManager = new ToolManager();
