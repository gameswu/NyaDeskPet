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

/** Provider 实例配置（持久化用） */
export interface ProviderInstanceConfig {
  /** 实例唯一 ID (uuid) */
  instanceId: string;
  /** Provider 类型 ID (如 'openai', 'echo') */
  providerId: string;
  /** 用户自定义的显示名称 */
  displayName: string;
  /** Provider 配置参数 */
  config: ProviderConfig;
  /** 是否启用（仅启用的实例才会尝试连接） */
  enabled: boolean;
}

/** Provider 实例运行时状态 */
export interface ProviderInstanceInfo {
  instanceId: string;
  providerId: string;
  displayName: string;
  config: ProviderConfig;
  metadata: ProviderMetadata | undefined;
  enabled: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error?: string;
  isPrimary: boolean;
}

export class AgentHandler {
  /** 所有 Provider 实例（instanceId → 运行时） */
  private providerInstances: Map<string, {
    config: ProviderInstanceConfig;
    provider: LLMProvider | null;
    status: 'idle' | 'connecting' | 'connected' | 'error';
    error?: string;
  }> = new Map();

  /** 主 LLM 实例 ID */
  private primaryInstanceId: string = '';

  /** 会话管理器 */
  public readonly sessions: SessionManager;

  /** 模型和角色状态 */
  private modelInfo: ModelInfo | null = null;
  private characterInfo: CharacterInfo | null = null;

  /** 是否启用 Function Calling */
  private enableToolCalling: boolean = true;

  /** 配置持久化文件路径 */
  private configPath: string;

  constructor() {
    this.sessions = new SessionManager();
    // 持久化路径
    const { app } = require('electron');
    this.configPath = require('path').join(app.getPath('userData'), 'data', 'providers.json');

    // 加载持久化配置
    this.loadConfig();
  }

  // ==================== Provider 实例管理 ====================

  /** 添加一个 Provider 实例 */
  public async addProviderInstance(instanceConfig: ProviderInstanceConfig): Promise<boolean> {
    // 验证 Provider 类型存在
    if (!providerRegistry.has(instanceConfig.providerId)) {
      logger.error(`[AgentHandler] Provider 类型不存在: ${instanceConfig.providerId}`);
      return false;
    }

    // 确保 enabled 字段有默认值
    if (instanceConfig.enabled === undefined) {
      instanceConfig.enabled = true;
    }

    this.providerInstances.set(instanceConfig.instanceId, {
      config: instanceConfig,
      provider: null,
      status: 'idle'
    });

    // 如果是第一个实例，自动设为主 LLM
    if (this.providerInstances.size === 1) {
      this.primaryInstanceId = instanceConfig.instanceId;
    }

    this.saveConfig();
    logger.info(`[AgentHandler] 添加 Provider 实例: ${instanceConfig.displayName} (${instanceConfig.providerId})`);
    return true;
  }

  /** 移除一个 Provider 实例 */
  public async removeProviderInstance(instanceId: string): Promise<boolean> {
    const entry = this.providerInstances.get(instanceId);
    if (!entry) return false;

    // 先终止
    if (entry.provider) {
      try { await entry.provider.terminate(); } catch {}
    }

    this.providerInstances.delete(instanceId);

    // 如果移除的是主 LLM，自动选择下一个
    if (this.primaryInstanceId === instanceId) {
      const firstKey = this.providerInstances.keys().next().value;
      this.primaryInstanceId = firstKey || '';
    }

    this.saveConfig();
    logger.info(`[AgentHandler] 移除 Provider 实例: ${instanceId}`);
    return true;
  }

  /** 更新 Provider 实例配置 */
  public async updateProviderInstance(instanceId: string, config: Partial<ProviderInstanceConfig>): Promise<boolean> {
    const entry = this.providerInstances.get(instanceId);
    if (!entry) return false;

    // 如果更新了配置参数，需要重新初始化
    if (config.config) {
      entry.config.config = { ...entry.config.config, ...config.config };
    }
    if (config.displayName) {
      entry.config.displayName = config.displayName;
    }
    if (config.providerId) {
      entry.config.providerId = config.providerId;
    }

    // 如果已有实例在运行，销毁并重新创建
    if (entry.provider) {
      try { await entry.provider.terminate(); } catch {}
      entry.provider = null;
      entry.status = 'idle';
    }

    this.saveConfig();
    return true;
  }

  /** 初始化（连接）一个 Provider 实例 */
  public async initializeProviderInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.providerInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    try {
      // 如果已有实例，先终止
      if (entry.provider) {
        await entry.provider.terminate();
      }

      entry.status = 'connecting';
      entry.error = undefined;

      const provider = providerRegistry.create(entry.config.providerId, entry.config.config);
      if (!provider) {
        throw new Error(`无法创建 Provider: ${entry.config.providerId}`);
      }

      await provider.initialize();
      entry.provider = provider;
      entry.status = 'connected';
      entry.error = undefined;

      logger.info(`[AgentHandler] Provider 实例已连接: ${entry.config.displayName}`);
      return { success: true };
    } catch (error) {
      entry.status = 'error';
      entry.error = (error as Error).message;
      logger.error(`[AgentHandler] Provider 实例连接失败: ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }

  /** 断开 Provider 实例连接 */
  public async disconnectProviderInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.providerInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    try {
      if (entry.provider) {
        await entry.provider.terminate();
        entry.provider = null;
      }
      entry.status = 'idle';
      entry.error = undefined;
      logger.info(`[AgentHandler] Provider 实例已断开: ${entry.config.displayName}`);
      return { success: true };
    } catch (error) {
      entry.status = 'error';
      entry.error = (error as Error).message;
      logger.error(`[AgentHandler] Provider 实例断开失败: ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }

  /** 启用 Provider 实例（启用后自动尝试连接） */
  public async enableProviderInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.providerInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    entry.config.enabled = true;
    this.saveConfig();
    logger.info(`[AgentHandler] Provider 实例已启用: ${entry.config.displayName}`);

    // 启用后自动尝试连接
    return this.initializeProviderInstance(instanceId);
  }

  /** 禁用 Provider 实例（禁用后自动断开连接） */
  public async disableProviderInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.providerInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    entry.config.enabled = false;

    // 断开连接
    if (entry.provider) {
      try { await entry.provider.terminate(); } catch {}
      entry.provider = null;
    }
    entry.status = 'idle';
    entry.error = undefined;

    this.saveConfig();
    logger.info(`[AgentHandler] Provider 实例已禁用: ${entry.config.displayName}`);
    return { success: true };
  }

  /** 设置主 LLM */
  public setPrimaryProvider(instanceId: string): boolean {
    if (!this.providerInstances.has(instanceId)) return false;
    this.primaryInstanceId = instanceId;
    this.saveConfig();
    logger.info(`[AgentHandler] 已设置主 LLM: ${instanceId}`);
    return true;
  }

  /** 获取主 LLM 的 Provider 实例 */
  private getPrimaryProvider(): LLMProvider | null {
    if (!this.primaryInstanceId) return null;
    const entry = this.providerInstances.get(this.primaryInstanceId);
    return entry?.provider || null;
  }

  /** 获取指定 Provider 实例 */
  public getProviderInstance(instanceId: string): LLMProvider | null {
    return this.providerInstances.get(instanceId)?.provider || null;
  }

  /** 获取主 LLM 的 instanceId */
  public getPrimaryInstanceId(): string {
    return this.primaryInstanceId;
  }

  /**
   * 调用指定 Provider 实例进行 LLM 对话
   * 供插件系统使用，支持 'primary' 作为 instanceId 自动选择主 LLM
   */
  public async callProvider(instanceId: string, request: LLMRequest): Promise<LLMResponse> {
    const targetId = instanceId === 'primary' ? this.primaryInstanceId : instanceId;
    if (!targetId) {
      throw new Error('未配置主 LLM Provider');
    }

    const entry = this.providerInstances.get(targetId);
    if (!entry) {
      throw new Error(`Provider 实例不存在: ${targetId}`);
    }

    // 如果尚未初始化，先尝试初始化
    if (!entry.provider) {
      const initResult = await this.initializeProviderInstance(targetId);
      if (!initResult.success) {
        throw new Error(`Provider 初始化失败: ${initResult.error}`);
      }
    }

    return entry.provider!.chat(request);
  }

  /**
   * 获取所有 Provider 实例摘要（供插件使用）
   */
  public getProvidersSummary(): Array<{
    instanceId: string;
    providerId: string;
    displayName: string;
    enabled: boolean;
    status: 'idle' | 'connecting' | 'connected' | 'error';
    isPrimary: boolean;
  }> {
    const result: Array<{
      instanceId: string;
      providerId: string;
      displayName: string;
      enabled: boolean;
      status: 'idle' | 'connecting' | 'connected' | 'error';
      isPrimary: boolean;
    }> = [];
    for (const [instanceId, entry] of this.providerInstances) {
      result.push({
        instanceId,
        providerId: entry.config.providerId,
        displayName: entry.config.displayName,
        enabled: entry.config.enabled !== false,
        status: entry.status,
        isPrimary: instanceId === this.primaryInstanceId
      });
    }
    return result;
  }

  /** 测试指定 Provider 实例（不改变运行时状态） */
  public async testProviderInstance(instanceId: string): Promise<{ success: boolean; error?: string; model?: string }> {
    const entry = this.providerInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    // 如果已有活跃连接，直接用它测试
    if (entry.provider) {
      return entry.provider.test();
    }

    // 否则创建临时 Provider 进行测试，不修改实例状态
    let tempProvider: LLMProvider | null = null;
    try {
      tempProvider = providerRegistry.create(entry.config.providerId, entry.config.config);
      if (!tempProvider) {
        return { success: false, error: `无法创建 Provider: ${entry.config.providerId}` };
      }
      await tempProvider.initialize();
      const result = await tempProvider.test();
      return result;
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      // 清理临时 Provider
      if (tempProvider) {
        try { await tempProvider.terminate(); } catch {}
      }
    }
  }

  /** 获取所有实例信息（供 UI 展示） */
  public getAllProviderInstances(): ProviderInstanceInfo[] {
    const result: ProviderInstanceInfo[] = [];
    for (const [instanceId, entry] of this.providerInstances) {
      result.push({
        instanceId,
        providerId: entry.config.providerId,
        displayName: entry.config.displayName,
        config: entry.config.config,
        metadata: providerRegistry.get(entry.config.providerId),
        enabled: entry.config.enabled !== false,
        status: entry.status,
        error: entry.error,
        isPrimary: instanceId === this.primaryInstanceId
      });
    }
    return result;
  }

  /** 获取所有可用 Provider 类型 */
  public getAvailableProviders(): ProviderMetadata[] {
    return providerRegistry.getAll();
  }

  /** 设置是否启用 Function Calling */
  public setToolCallingEnabled(enabled: boolean): void {
    this.enableToolCalling = enabled;
  }

  // ==================== 自动连接 ====================

  /** 自动连接所有已启用的 Provider 实例 */
  private async autoConnectEnabled(): Promise<void> {
    for (const [instanceId, entry] of this.providerInstances) {
      if (entry.config.enabled) {
        this.initializeProviderInstance(instanceId).catch(err => {
          logger.warn(`[AgentHandler] 自动连接 Provider 失败 (${entry.config.displayName}): ${err}`);
        });
      }
    }
  }

  // ==================== 持久化 ====================

  private loadConfig(): void {
    const fs = require('fs');
    const path = require('path');
    try {
      // 确保目录存在
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        if (data.instances && Array.isArray(data.instances)) {
          for (const inst of data.instances) {
            // 兼容旧配置：如果没有 enabled 字段，默认为 true
            if (inst.enabled === undefined) {
              inst.enabled = true;
            }
            this.providerInstances.set(inst.instanceId, {
              config: inst,
              provider: null,
              status: 'idle'
            });
          }
        }
        if (data.primaryInstanceId) {
          this.primaryInstanceId = data.primaryInstanceId;
        }
        logger.info(`[AgentHandler] 已加载 ${this.providerInstances.size} 个 Provider 配置`);

        // 自动连接已启用的 Provider 实例
        this.autoConnectEnabled();
      }
    } catch (error) {
      logger.warn(`[AgentHandler] 加载 Provider 配置失败: ${error}`);
    }

    // 如果没有任何实例，默认添加 Echo
    if (this.providerInstances.size === 0) {
      const echoId = 'echo-default';
      this.providerInstances.set(echoId, {
        config: {
          instanceId: echoId,
          providerId: 'echo',
          displayName: 'Echo (内置)',
          config: { id: 'echo', name: 'Echo' },
          enabled: true
        },
        provider: null,
        status: 'idle'
      });
      this.primaryInstanceId = echoId;
    }
  }

  private saveConfig(): void {
    const fs = require('fs');
    try {
      const instances: ProviderInstanceConfig[] = [];
      for (const [, entry] of this.providerInstances) {
        instances.push(entry.config);
      }
      const data = {
        primaryInstanceId: this.primaryInstanceId,
        instances
      };
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[AgentHandler] 保存 Provider 配置失败: ${error}`);
    }
  }

  // ==================== 消息处理方法 ====================

  /**
   * 处理用户文本输入 — 核心逻辑
   * 通过 LLM Provider 生成回复，支持 Function Calling 工具循环
   */
  public async processUserInput(ctx: PipelineContext): Promise<void> {
    const text = ctx.message.text || '';
    logger.info(`[AgentHandler] 用户输入: ${text}`);

    const primaryProvider = this.getPrimaryProvider();
    if (!primaryProvider) {
      ctx.addReply({
        type: 'dialogue',
        data: { text: '[内置Agent] 未配置或未激活主 LLM Provider', duration: 5000 }
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
      const response = await this.executeWithToolLoop(request, ctx, primaryProvider);

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
  private async executeWithToolLoop(request: LLMRequest, ctx: PipelineContext, provider: LLMProvider): Promise<LLMResponse> {
    let iterations = 0;
    let currentRequest = { ...request };

    while (iterations < MAX_TOOL_LOOP_ITERATIONS) {
      iterations++;

      const response = await provider.chat(currentRequest);

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

    // 如果有主 LLM Provider 且不是 Echo，让 LLM 决定反应
    const primaryProvider = this.getPrimaryProvider();
    const primaryEntry = this.primaryInstanceId ? this.providerInstances.get(this.primaryInstanceId) : null;
    if (primaryProvider && primaryEntry?.config.providerId !== 'echo') {
      const prompt = `用户触碰了角色的 "${data.hitArea}" 部位，请给出一个简短可爱的反应（1-2句话）。`;
      try {
        const response = await primaryProvider.chat({
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
