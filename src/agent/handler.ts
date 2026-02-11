/**
 * Agent 业务逻辑处理器（重构版）
 * 
 * 与旧版 switch-case 不同，本模块只包含各消息类型的具体处理逻辑，
 * 消息路由由 Pipeline 的 ProcessStage 负责。
 * 
 * 职责：
 * - 调用 LLM Provider 处理用户输入
 * - 维护模型信息 / 角色信息状态
 * - 处理触碰、文件、插件响应等事件
 * - Function Calling 工具循环
 * 
 * 扩展指南：
 * - 新增消息类型：在 ProcessStage 的 switch 中添加分发，在本模块添加 processXxx 方法
 * - 切换 LLM：调用 setActiveProvider() 传入已注册的 Provider ID
 * - 自定义 Stage：继承 Stage 基类，通过 pipeline.addStage() 插入管线
 */

import { logger } from '../logger';
import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type ChatMessage,
  type ProviderConfig,
  type ProviderMetadata,
  providerRegistry
} from './provider';
import { type PipelineContext, SessionManager } from './context';
import { toolManager, type ToolCall, type ToolResult } from './tools';

// ==================== 类型定义 ====================

export interface ModelInfo {
  available: boolean;
  modelPath: string;
  motions: Record<string, { count: number; files: string[] }>;
  expressions: string[];
  hitAreas: string[];
  availableParameters: Array<{
    id: string;
    value: number;
    min: number;
    max: number;
    default: number;
  }>;
}

export interface CharacterInfo {
  useCustom: boolean;
  name?: string;
  personality?: string;
}

export interface TapEventData {
  hitArea: string;
  position: { x: number; y: number };
  timestamp: number;
}

// ==================== AgentHandler ====================

/** 工具循环最大迭代次数，防止无限循环 */
const MAX_TOOL_LOOP_ITERATIONS = 10;

export class AgentHandler {
  /** 当前激活的 LLM Provider */
  private activeProvider: LLMProvider | null = null;
  private activeProviderId: string = 'echo';
  private activeProviderConfig: ProviderConfig = { id: 'echo', name: 'Echo' };

  /** 会话管理器 */
  public readonly sessions: SessionManager;

  /** 模型和角色状态 */
  private modelInfo: ModelInfo | null = null;
  private characterInfo: CharacterInfo | null = null;

  /** 是否启用 Function Calling */
  private enableToolCalling: boolean = true;

  constructor() {
    this.sessions = new SessionManager();
    // 默认使用 Echo Provider（同步创建，不走 async initialize）
    const echoProvider = providerRegistry.create('echo', this.activeProviderConfig);
    if (echoProvider) {
      this.activeProvider = echoProvider;
    }
  }

  // ==================== Provider 管理 ====================

  /** 设置当前使用的 LLM Provider */
  public async setActiveProvider(providerId: string, config: ProviderConfig): Promise<boolean> {
    // 先销毁当前 Provider
    if (this.activeProvider) {
      try {
        await this.activeProvider.terminate();
      } catch (error) {
        logger.warn(`[AgentHandler] 销毁旧 Provider 失败: ${(error as Error).message}`);
      }
    }

    const provider = providerRegistry.create(providerId, config);
    if (!provider) {
      logger.error(`[AgentHandler] 无法创建 Provider: ${providerId}`);
      return false;
    }

    // 初始化新 Provider
    try {
      await provider.initialize();
    } catch (error) {
      logger.error(`[AgentHandler] Provider 初始化失败: ${(error as Error).message}`);
      return false;
    }

    this.activeProvider = provider;
    this.activeProviderId = providerId;
    this.activeProviderConfig = config;
    logger.info(`[AgentHandler] 已切换 Provider: ${providerId}`);
    return true;
  }

  /** 获取当前 Provider 信息 */
  public getActiveProviderInfo(): { id: string; config: ProviderConfig; metadata: ProviderMetadata | undefined } {
    return {
      id: this.activeProviderId,
      config: this.activeProviderConfig,
      metadata: providerRegistry.get(this.activeProviderId)
    };
  }

  /** 获取所有可用 Provider */
  public getAvailableProviders(): ProviderMetadata[] {
    return providerRegistry.getAll();
  }

  /** 测试当前 Provider 连接 */
  public async testProvider(): Promise<{ success: boolean; error?: string }> {
    if (!this.activeProvider) {
      return { success: false, error: '未配置 Provider' };
    }
    return this.activeProvider.test();
  }

  /** 设置是否启用 Function Calling */
  public setToolCallingEnabled(enabled: boolean): void {
    this.enableToolCalling = enabled;
  }

  // ==================== 消息处理方法 ====================

  /**
   * 处理用户文本输入 — 核心逻辑
   * 通过 LLM Provider 生成回复，支持 Function Calling 工具循环
   */
  public async processUserInput(ctx: PipelineContext): Promise<void> {
    const text = ctx.message.text || '';
    logger.info(`[AgentHandler] 用户输入: ${text}`);

    if (!this.activeProvider) {
      ctx.addReply({
        type: 'dialogue',
        data: { text: '[内置Agent] 未配置 LLM Provider', duration: 5000 }
      });
      return;
    }

    // 从会话历史构建消息
    const history = this.sessions.getHistory(ctx.sessionId);

    // 构建系统提示词
    let systemPrompt = '你是一个桌面宠物助手。';
    if (this.characterInfo?.useCustom && this.characterInfo.personality) {
      systemPrompt = this.characterInfo.personality;
    }

    // 追加用户消息到历史
    this.sessions.addMessage(ctx.sessionId, { role: 'user', content: text });

    // 构建 LLM 请求
    const request: LLMRequest = {
      messages: [
        ...history,
        { role: 'user', content: text }
      ],
      systemPrompt,
      sessionId: ctx.sessionId
    };

    // 如果有已启用的工具，添加到请求中
    if (this.enableToolCalling && toolManager.hasEnabledTools()) {
      request.tools = toolManager.toOpenAITools();
      request.toolChoice = 'auto';
    }

    try {
      // 工具循环：反复调用 LLM 直到不再请求工具
      const response = await this.executeWithToolLoop(request, ctx);

      // 追加助手回复到历史
      this.sessions.addMessage(ctx.sessionId, {
        role: 'assistant',
        content: response.text
      });

      ctx.addReply({
        type: 'dialogue',
        data: {
          text: response.text,
          duration: Math.max(3000, response.text.length * 100)
        }
      });
    } catch (error) {
      logger.error('[AgentHandler] LLM 调用失败:', error);
      ctx.addReply({
        type: 'dialogue',
        data: {
          text: `[内置Agent] AI 回复失败: ${(error as Error).message}`,
          duration: 5000
        }
      });
    }
  }

  /**
   * 工具循环执行
   * 参考 AstrBot 的 ToolLoopAgentRunner._handle_function_tools
   * 
   * 流程：
   * 1. 发送请求给 LLM
   * 2. 如果 LLM 返回 tool_calls → 执行工具 → 将结果追加到消息 → 回到步骤 1
   * 3. 如果 LLM 返回文本 → 结束循环
   */
  private async executeWithToolLoop(request: LLMRequest, ctx: PipelineContext): Promise<LLMResponse> {
    let iterations = 0;
    let currentRequest = { ...request };

    while (iterations < MAX_TOOL_LOOP_ITERATIONS) {
      iterations++;

      const response = await this.activeProvider!.chat(currentRequest);

      // 如果没有工具调用，直接返回
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response;
      }

      logger.info(`[AgentHandler] 工具循环 #${iterations}: ${response.toolCalls.length} 个工具调用`);

      // 将 assistant 的 tool_calls 消息追加到历史
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.text || '',
        toolCalls: response.toolCalls
      };
      currentRequest.messages.push(assistantMsg);
      this.sessions.addMessage(ctx.sessionId, assistantMsg);

      // 执行所有工具调用
      const toolCalls: ToolCall[] = response.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
      }));

      const results: ToolResult[] = await toolManager.executeToolCalls(toolCalls);

      // 将工具结果追加到消息
      for (const result of results) {
        const toolMsg: ChatMessage = {
          role: 'tool',
          content: result.content,
          toolCallId: result.toolCallId,
          toolName: toolCalls.find(tc => tc.id === result.toolCallId)?.name
        };
        currentRequest.messages.push(toolMsg);
        this.sessions.addMessage(ctx.sessionId, toolMsg);
      }

      // 通知前端工具执行状态（可选）
      ctx.send({
        type: 'tool_status',
        data: {
          iteration: iterations,
          calls: toolCalls.map(tc => ({ name: tc.name, id: tc.id })),
          results: results.map(r => ({ id: r.toolCallId, success: r.success }))
        }
      });
    }

    // 超过最大迭代次数
    logger.warn(`[AgentHandler] 工具循环超过最大迭代次数 (${MAX_TOOL_LOOP_ITERATIONS})`);
    return {
      text: '[内置Agent] 工具调用次数超过限制，请简化请求。',
      finishReason: 'max_iterations'
    };
  }

  /**
   * 处理模型信息
   */
  public processModelInfo(ctx: PipelineContext): void {
    this.modelInfo = ctx.message.data as ModelInfo;
    logger.info('[AgentHandler] 已接收模型信息', {
      motions: Object.keys(this.modelInfo.motions || {}),
      expressions: this.modelInfo.expressions,
      hitAreas: this.modelInfo.hitAreas,
      paramCount: this.modelInfo.availableParameters?.length || 0
    });
  }

  /**
   * 处理触碰事件
   */
  public async processTapEvent(ctx: PipelineContext): Promise<void> {
    const data = ctx.message.data as TapEventData;
    logger.info(`[AgentHandler] 触碰事件: ${data.hitArea}`);

    // 如果有 LLM Provider 且不是 Echo，让 LLM 决定反应
    if (this.activeProvider && this.activeProviderId !== 'echo') {
      const prompt = `用户触碰了角色的 "${data.hitArea}" 部位，请给出一个简短可爱的反应（1-2句话）。`;
      try {
        const response = await this.activeProvider.chat({
          messages: [{ role: 'user', content: prompt }],
          systemPrompt: this.characterInfo?.personality || '你是一个可爱的桌面宠物。',
          maxTokens: 100
        });
        ctx.addReply({
          type: 'dialogue',
          data: { text: response.text, duration: 3000 }
        });
        return;
      } catch (error) {
        logger.warn('[AgentHandler] 触碰 LLM 调用失败，使用默认反应');
      }
    }

    // 默认反应（无 LLM 或 LLM 失败时）
    const reactions: Record<string, string> = {
      'Head': '头被摸了喵~',
      'Body': '不要乱摸喵！',
      'Face': '脸好痒喵~'
    };

    ctx.addReply({
      type: 'dialogue',
      data: {
        text: reactions[data.hitArea] || '被点到了喵~',
        duration: 3000
      }
    });
  }

  /**
   * 处理角色信息
   */
  public processCharacterInfo(ctx: PipelineContext): void {
    this.characterInfo = ctx.message.data as CharacterInfo;
    logger.info('[AgentHandler] 已接收角色信息', {
      useCustom: this.characterInfo.useCustom,
      name: this.characterInfo.name
    });
  }

  /**
   * 处理文件上传
   */
  public async processFileUpload(ctx: PipelineContext): Promise<void> {
    const data = ctx.message.data;
    logger.info(`[AgentHandler] 收到文件: ${data?.fileName}`);

    // TODO: 将文件内容传给 LLM（如多模态模型）处理
    ctx.addReply({
      type: 'dialogue',
      data: {
        text: `[内置Agent] 收到文件: ${data?.fileName}`,
        duration: 3000
      }
    });
  }

  /**
   * 处理插件响应
   */
  public processPluginResponse(ctx: PipelineContext): void {
    const data = ctx.message.data;
    logger.info(`[AgentHandler] 插件响应: ${data?.pluginId} - ${data?.action}`);
    // TODO: 根据插件响应结果执行后续逻辑（如让 LLM 继续处理）
  }

  // ==================== 状态访问 ====================

  public getModelInfo(): ModelInfo | null {
    return this.modelInfo;
  }

  public getCharacterInfo(): CharacterInfo | null {
    return this.characterInfo;
  }
}
