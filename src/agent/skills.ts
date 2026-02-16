/**
 * Agent Skills 系统
 * 参考 Claude Agent Skills 设计，提供技能注册、调用和管理功能。
 *
 * 核心概念：
 * - SkillSchema：技能的结构化描述（名称、类别、参数、指令、示例）
 * - SkillDefinition：注册到系统中的技能定义（含处理器、来源等元数据）
 * - SkillManager：技能注册表 + 执行器（全局单例）
 *
 * 与 Tool 的区别：
 * - Tool 是原子操作（fetch_url、search_web）
 * - Skill 是高级能力，可组合多个 Tool / Provider 调用，附带详细指令和示例
 * - Skill 可通过 toToolSchemas() 降级为 Tool，供 LLM Function Calling 使用
 */

import { logger } from '../logger';
import type { ToolSchema, ToolResult } from './tools';
import type { LLMRequest, LLMResponse } from './provider';

// ==================== 核心类型 ====================

/** 技能使用示例 */
export interface SkillExample {
  /** 示例描述 */
  description: string;
  /** 示例输入参数 */
  input: Record<string, unknown>;
  /** 预期输出（可选，文档用） */
  expectedOutput?: string;
}

/** 技能的结构化描述 */
export interface SkillSchema {
  /** 唯一标识（snake_case） */
  name: string;
  /** 技能描述 */
  description: string;
  /** 分类：system / knowledge / creative / automation / communication */
  category: string;
  /** 详细指令（供 LLM 理解如何使用此技能） */
  instructions: string;
  /** 输入参数 schema（OpenAI function calling 格式） */
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
  /** 使用示例 */
  examples?: SkillExample[];
}

/** 技能执行上下文 */
export interface SkillContext {
  /** 调用 LLM Provider */
  callProvider: (request: LLMRequest) => Promise<LLMResponse>;
  /** 执行已注册的工具 */
  executeTool: (toolName: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** 日志 */
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

/** 技能执行结果 */
export interface SkillResult {
  /** 是否执行成功 */
  success: boolean;
  /** 输出文本 */
  output: string;
  /** 附加数据（可选） */
  data?: unknown;
}

/** 技能处理函数 */
export type SkillHandler = (params: Record<string, unknown>, ctx: SkillContext) => Promise<SkillResult>;

/** 技能定义（注册到系统中） */
export interface SkillDefinition {
  /** 技能 schema */
  schema: SkillSchema;
  /** 处理器 */
  handler: SkillHandler;
  /** 来源（插件名 or 'builtin'） */
  source: string;
  /** 是否启用 */
  enabled: boolean;
  /** 注册时间 */
  registeredAt: number;
}

/** 系统级技能信息（只读，用于前端展示） */
export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  instructions: string;
  source: string;
  enabled: boolean;
  exampleCount: number;
  parameterNames: string[];
}

// ==================== SkillManager ====================

/** 变更回调 */
type SkillChangeCallback = () => void;

/**
 * 技能管理器 — 全局单例
 * 负责技能的注册、注销、调用和查询
 */
export class SkillManager {
  /** 技能注册表 */
  private skills: Map<string, SkillDefinition> = new Map();
  /** 变更监听器 */
  private changeListeners: SkillChangeCallback[] = [];

  // ==================== 注册 / 注销 ====================

  /**
   * 注册技能
   * @param schema 技能描述
   * @param handler 处理函数
   * @param source 来源标识
   */
  register(schema: SkillSchema, handler: SkillHandler, source: string = 'builtin'): void {
    if (this.skills.has(schema.name)) {
      logger.warn(`[SkillManager] 技能已存在，将覆盖: ${schema.name}`);
    }

    this.skills.set(schema.name, {
      schema,
      handler,
      source,
      enabled: true,
      registeredAt: Date.now(),
    });

    logger.info(`[SkillManager] 注册技能: ${schema.name} (${schema.category}) [${source}]`);
    this.notifyChange();
  }

  /**
   * 注销技能
   */
  unregister(name: string): boolean {
    const deleted = this.skills.delete(name);
    if (deleted) {
      logger.info(`[SkillManager] 注销技能: ${name}`);
      this.notifyChange();
    }
    return deleted;
  }

  /**
   * 注销指定来源的所有技能
   */
  unregisterBySource(source: string): number {
    let count = 0;
    for (const [name, def] of this.skills) {
      if (def.source === source) {
        this.skills.delete(name);
        count++;
      }
    }
    if (count > 0) {
      logger.info(`[SkillManager] 注销来源 ${source} 的 ${count} 个技能`);
      this.notifyChange();
    }
    return count;
  }

  // ==================== 调用 ====================

  /**
   * 调用技能
   * @param name 技能名称
   * @param params 输入参数
   * @param ctx 执行上下文
   */
  async invoke(name: string, params: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult> {
    const def = this.skills.get(name);
    if (!def) {
      return { success: false, output: `技能不存在: ${name}` };
    }
    if (!def.enabled) {
      return { success: false, output: `技能已禁用: ${name}` };
    }

    logger.info(`[SkillManager] 调用技能: ${name}`, );
    const startTime = Date.now();

    try {
      const result = await def.handler(params, ctx);
      const elapsed = Date.now() - startTime;
      logger.info(`[SkillManager] 技能 ${name} 执行完成 (${elapsed}ms) success=${result.success}`);
      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errMsg = (error as Error).message || String(error);
      logger.error(`[SkillManager] 技能 ${name} 执行失败 (${elapsed}ms): ${errMsg}`);
      return { success: false, output: `技能执行异常: ${errMsg}` };
    }
  }

  // ==================== 查询 ====================

  /**
   * 获取所有技能信息列表
   */
  list(): SkillInfo[] {
    return Array.from(this.skills.values()).map(def => ({
      name: def.schema.name,
      description: def.schema.description,
      category: def.schema.category,
      instructions: def.schema.instructions,
      source: def.source,
      enabled: def.enabled,
      exampleCount: def.schema.examples?.length ?? 0,
      parameterNames: Object.keys(def.schema.parameters.properties),
    }));
  }

  /**
   * 获取技能 schema
   */
  getSchema(name: string): SkillSchema | undefined {
    return this.skills.get(name)?.schema;
  }

  /**
   * 获取技能定义（内部使用）
   */
  getDefinition(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * 检查技能是否存在
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 设置技能启用/禁用
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const def = this.skills.get(name);
    if (!def) return false;
    def.enabled = enabled;
    logger.info(`[SkillManager] 技能 ${name} ${enabled ? '已启用' : '已禁用'}`);
    this.notifyChange();
    return true;
  }

  /**
   * 获取已启用的技能数量
   */
  getEnabledCount(): number {
    let count = 0;
    for (const def of this.skills.values()) {
      if (def.enabled) count++;
    }
    return count;
  }

  // ==================== Tool 兼容层 ====================

  /**
   * 将所有已启用的技能转换为 ToolSchema 数组
   * 用于注入到 LLM Function Calling 工具列表中
   */
  toToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = [];
    for (const def of this.skills.values()) {
      if (!def.enabled) continue;
      schemas.push({
        name: `skill_${def.schema.name}`,
        description: `[Skill] ${def.schema.description}\n\n${def.schema.instructions}`,
        parameters: def.schema.parameters,
      });
    }
    return schemas;
  }

  /**
   * 判断工具名是否是技能调用
   */
  isSkillToolCall(toolName: string): boolean {
    if (!toolName.startsWith('skill_')) return false;
    const skillName = toolName.slice(6); // 'skill_'.length
    return this.skills.has(skillName);
  }

  /**
   * 从工具调用中提取并执行技能
   * @param toolName 工具名（skill_xxx 格式）
   * @param args 参数
   * @param ctx 执行上下文
   */
  async handleToolCall(toolName: string, args: Record<string, unknown>, ctx: SkillContext): Promise<ToolResult> {
    const skillName = toolName.slice(6);
    const result = await this.invoke(skillName, args, ctx);
    return {
      toolCallId: '',
      content: result.output,
      success: result.success,
    };
  }

  // ==================== 事件 ====================

  /**
   * 监听技能变更
   */
  onChange(callback: SkillChangeCallback): void {
    this.changeListeners.push(callback);
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) {
      try {
        cb();
      } catch (error) {
        logger.error('[SkillManager] 变更回调执行失败:', error);
      }
    }
  }
}

// 全局单例
export const skillManager = new SkillManager();
