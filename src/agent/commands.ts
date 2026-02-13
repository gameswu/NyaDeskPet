/**
 * 指令系统（Slash Command）
 * 
 * 类似 Discord 的斜杠指令系统，为内置 Agent 提供可扩展的指令注册与执行能力。
 * 
 * 核心概念：
 * - CommandDefinition：指令定义（名称、描述、参数、处理器）
 * - CommandRegistry：全局指令注册表
 * - 插件通过 ctx.registerCommand() 注册指令
 * - 前端连接后接收 commands_register 消息，获取所有可用指令
 * - 用户输入 / 前缀触发指令自动补全
 * - 前端发送 command_execute 消息执行指令，后端返回 command_response
 */

import { logger } from '../logger';

// ==================== 类型定义 ====================

/** 指令参数定义 */
export interface CommandParam {
  /** 参数名称 */
  name: string;
  /** 参数描述 */
  description: string;
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean';
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default?: unknown;
  /** 可选值列表（用于自动补全） */
  choices?: Array<{ name: string; value: string | number }>;
}

/** 指令定义 */
export interface CommandDefinition {
  /** 指令名称（不含 / 前缀，如 'info'） */
  name: string;
  /** 指令描述 */
  description: string;
  /** 参数列表 */
  params?: CommandParam[];
  /** 指令分类（用于分组显示） */
  category?: string;
  /** 注册来源插件名 */
  source?: string;
  /** 是否启用 */
  enabled?: boolean;
}

/** 指令执行请求（前端 → 后端） */
export interface CommandExecuteData {
  /** 指令名称（不含 / 前缀） */
  command: string;
  /** 参数键值对 */
  args: Record<string, unknown>;
}

/** 指令执行结果（后端 → 前端） */
export interface CommandResponseData {
  /** 指令名称 */
  command: string;
  /** 是否成功 */
  success: boolean;
  /** 文本结果（会显示在聊天窗口中） */
  text?: string;
  /** 错误信息 */
  error?: string;
}

/** 指令注册消息数据（后端 → 前端） */
export interface CommandsRegisterData {
  /** 所有可用指令列表 */
  commands: CommandDefinition[];
}

/** 指令处理器 */
export type CommandHandler = (args: Record<string, unknown>, sessionId: string) => Promise<CommandResponseData> | CommandResponseData;

// ==================== 指令注册表 ====================

interface CommandRecord {
  definition: CommandDefinition;
  handler: CommandHandler;
  /** 注册来源插件名 */
  source: string;
}

class CommandRegistry {
  private commands: Map<string, CommandRecord> = new Map();

  /**
   * 注册指令
   */
  register(definition: CommandDefinition, handler: CommandHandler, source: string): void {
    const name = definition.name.toLowerCase();
    
    if (this.commands.has(name)) {
      logger.warn(`[CommandRegistry] 指令 /${name} 已存在，将被 ${source} 覆盖`);
    }

    this.commands.set(name, {
      definition: { ...definition, name, source, enabled: definition.enabled !== false },
      handler,
      source
    });

    logger.info(`[CommandRegistry] 注册指令: /${name} (来源: ${source})`);
  }

  /**
   * 注销指令
   */
  unregister(name: string): void {
    const lower = name.toLowerCase();
    if (this.commands.delete(lower)) {
      logger.info(`[CommandRegistry] 注销指令: /${lower}`);
    }
  }

  /**
   * 注销指定来源的所有指令
   */
  unregisterBySource(source: string): void {
    const toDelete: string[] = [];
    for (const [name, record] of this.commands) {
      if (record.source === source) {
        toDelete.push(name);
      }
    }
    for (const name of toDelete) {
      this.commands.delete(name);
      logger.info(`[CommandRegistry] 注销指令: /${name} (来源: ${source})`);
    }
  }

  /**
   * 执行指令
   */
  async execute(name: string, args: Record<string, unknown>, sessionId: string): Promise<CommandResponseData> {
    const lower = name.toLowerCase();
    const record = this.commands.get(lower);

    if (!record) {
      return {
        command: lower,
        success: false,
        error: `未知指令: /${lower}`
      };
    }

    if (record.definition.enabled === false) {
      return {
        command: lower,
        success: false,
        error: `指令 /${lower} 已被禁用`
      };
    }

    // 验证必填参数
    if (record.definition.params) {
      for (const param of record.definition.params) {
        if (param.required && (args[param.name] === undefined || args[param.name] === '')) {
          return {
            command: lower,
            success: false,
            error: `缺少必填参数: ${param.name}`
          };
        }
      }
    }

    try {
      return await record.handler(args, sessionId);
    } catch (error) {
      logger.error(`[CommandRegistry] 指令 /${lower} 执行失败: ${error}`);
      return {
        command: lower,
        success: false,
        error: `指令执行失败: ${(error as Error).message}`
      };
    }
  }

  /**
   * 获取所有指令定义（供前端显示）
   */
  getAllDefinitions(): CommandDefinition[] {
    const result: CommandDefinition[] = [];
    for (const record of this.commands.values()) {
      result.push({ ...record.definition });
    }
    return result;
  }

  /**
   * 获取所有已启用的指令定义
   */
  getEnabledDefinitions(): CommandDefinition[] {
    return this.getAllDefinitions().filter(d => d.enabled !== false);
  }

  /**
   * 设置指令启用状态
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const record = this.commands.get(name.toLowerCase());
    if (!record) return false;
    record.definition.enabled = enabled;
    return true;
  }

  /**
   * 指令是否存在
   */
  has(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  /**
   * 获取指令数量
   */
  get size(): number {
    return this.commands.size;
  }
}

/** 全局指令注册表单例 */
export const commandRegistry = new CommandRegistry();
