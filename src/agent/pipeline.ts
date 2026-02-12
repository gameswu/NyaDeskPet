/**
 * 消息处理管线 (Pipeline)
 * 参考 AstrBot 的 9 阶段洋葱模型，以 Stage 链式处理前端消息
 * 
 * 设计原则：
 * - 洋葱模型：Stage.process() 调用 next() 进入下一阶段，next() 返回后执行后置逻辑
 * - 职责分离：每个 Stage 只关注一件事
 * - 可插拔：通过 addStage() 动态增删阶段
 * - 短路机制：Stage 可通过 ctx.abort() 中止后续阶段
 * 
 * 内置阶段顺序：
 * 1. PreProcess  — 消息标准化、日志记录
 * 2. Process     — 核心逻辑：调用 LLM Provider 生成回复
 * 3. Respond     — 将处理结果封装成协议消息，发送给前端
 */

import { logger } from '../logger';
import type { PipelineContext } from './context';

// ==================== Stage 基类 ====================

/**
 * Pipeline Stage 抽象基类
 * 每个阶段接收 PipelineContext，调用 next() 传递给下一个阶段
 */
export abstract class Stage {
  /** 阶段唯一名称 */
  abstract readonly name: string;

  /**
   * 阶段处理逻辑
   * @param ctx  管线上下文（包含消息、状态、回复缓冲等）
   * @param next 调用下一个阶段的函数
   */
  abstract process(ctx: PipelineContext, next: () => Promise<void>): Promise<void>;
}

// ==================== Pipeline ====================

/**
 * 消息处理管线
 * 按注册顺序依次执行 Stage，支持洋葱模型
 */
export class Pipeline {
  private stages: Stage[] = [];

  /** 添加一个阶段到管线末尾 */
  addStage(stage: Stage): void {
    this.stages.push(stage);
    logger.debug(`[Pipeline] 添加阶段: ${stage.name} (共 ${this.stages.length} 个)`);
  }

  /** 在指定阶段之前插入 */
  insertBefore(targetName: string, stage: Stage): boolean {
    const idx = this.stages.findIndex(s => s.name === targetName);
    if (idx === -1) return false;
    this.stages.splice(idx, 0, stage);
    return true;
  }

  /** 在指定阶段之后插入 */
  insertAfter(targetName: string, stage: Stage): boolean {
    const idx = this.stages.findIndex(s => s.name === targetName);
    if (idx === -1) return false;
    this.stages.splice(idx + 1, 0, stage);
    return true;
  }

  /** 移除阶段 */
  removeStage(name: string): boolean {
    const idx = this.stages.findIndex(s => s.name === name);
    if (idx === -1) return false;
    this.stages.splice(idx, 1);
    return true;
  }

  /** 获取所有阶段名称 */
  getStageNames(): string[] {
    return this.stages.map(s => s.name);
  }

  /**
   * 执行管线
   * 洋葱模型：每个 Stage 的 process() 可在 next() 前后执行逻辑
   */
  async execute(ctx: PipelineContext): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      // 已中止或无更多阶段
      if (ctx.aborted || index >= this.stages.length) return;

      const stage = this.stages[index++];
      try {
        logger.debug(`[Pipeline] 进入阶段: ${stage.name}`);
        await stage.process(ctx, next);
      } catch (error) {
        logger.error(`[Pipeline] 阶段 "${stage.name}" 出错:`, error);
        ctx.error = error as Error;
        // 出错时仍然继续到 Respond 阶段，以便返回错误信息
        if (stage.name !== 'respond') {
          await next();
        }
      }
    };

    await next();
  }
}

// ==================== 内置 Stage 实现 ====================

import type { AgentHandler } from './handler';

/**
 * PreProcess 阶段
 * - 消息日志记录
 * - 消息标准化
 */
export class PreProcessStage extends Stage {
  readonly name = 'preprocess';

  async process(ctx: PipelineContext, next: () => Promise<void>): Promise<void> {
    logger.info(`[PreProcess] 收到消息: type=${ctx.message.type}`);

    // 记录时间戳
    if (!ctx.message.timestamp) {
      ctx.message.timestamp = Date.now();
    }

    await next();
  }
}

/**
 * Process 阶段
 * - 核心业务逻辑：根据消息类型分发处理
 * - user_input: 调用 LLM Provider 生成回复
 * - 其他类型: 委托给 handler 处理
 */
export class ProcessStage extends Stage {
  readonly name = 'process';

  private handler: AgentHandler;

  constructor(handler: AgentHandler) {
    super();
    this.handler = handler;
  }

  async process(ctx: PipelineContext, next: () => Promise<void>): Promise<void> {
    const { type } = ctx.message;

    switch (type) {
      case 'user_input':
        await this.handler.processUserInput(ctx);
        break;

      case 'model_info':
        this.handler.processModelInfo(ctx);
        break;

      case 'tap_event':
        await this.handler.processTapEvent(ctx);
        break;

      case 'character_info':
        this.handler.processCharacterInfo(ctx);
        break;

      case 'file_upload':
        await this.handler.processFileUpload(ctx);
        break;

      case 'plugin_response':
        this.handler.processPluginResponse(ctx);
        break;

      case 'plugin_status':
        this.handler.processPluginStatus(ctx);
        break;

      default:
        logger.debug(`[Process] 未处理的消息类型: ${type}`);
    }

    await next();
  }
}

/**
 * Respond 阶段
 * - 将 ctx.replies 中积累的回复消息统一发送给前端
 * - 如果管线出错（ctx.error），发送错误提示
 */
export class RespondStage extends Stage {
  readonly name = 'respond';

  async process(ctx: PipelineContext, next: () => Promise<void>): Promise<void> {
    // 如果有错误且没有手动添加回复，发送通用错误提示
    if (ctx.error && ctx.replies.length === 0) {
      ctx.addReply({
        type: 'dialogue',
        data: {
          text: `[内置Agent] 处理出错: ${ctx.error.message}`,
          duration: 5000
        }
      });
    }

    // 发送所有回复
    for (const reply of ctx.replies) {
      ctx.send(reply);
    }

    await next();
  }
}
