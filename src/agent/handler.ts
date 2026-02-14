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
import {
  type TTSProvider,
  ttsProviderRegistry
} from './tts-provider';
import { type PipelineContext, type Sendable, SessionManager } from './context';
import { toolManager, type ToolCall, type ToolResult } from './tools';
import { commandRegistry } from './commands';
import { agentPluginManager, type HandlerAccessor, type MessageContext, type PluginInvokeSender } from './agent-plugin';

// ==================== 类型定义 ====================

/** 工具循环最大迭代次数 */
const MAX_TOOL_LOOP_ITERATIONS = 10;

/** 对话框显示时长常量 */
const DIALOGUE_MIN_DURATION = 3000;
const DIALOGUE_MAX_DURATION = 30000;
const DIALOGUE_MS_PER_CHAR = 80;
const ERROR_DIALOGUE_DURATION = 5000;

/** 工具确认超时（ms） */
const DEFAULT_TOOL_CONFIRM_TIMEOUT = 30000;

/** 插件调用超时（ms） */
const DEFAULT_PLUGIN_INVOKE_TIMEOUT = 30000;

/** 默认触碰反应 token 数 */
const TAP_RESPONSE_MAX_TOKENS = 100;

/** 配置文件名 */
const PROVIDER_CONFIG_FILENAME = 'providers.json';
const TTS_CONFIG_FILENAME = 'tts-providers.json';

/** 工具拒绝消息 */
const TOOL_REJECTED_MESSAGE = '用户拒绝了此工具调用。';

/** 默认人格 */
const DEFAULT_PERSONALITY = '你是一个可爱的桌面宠物。';

/** 根据文本长度计算对话框显示时长 */
function calculateDialogueDuration(text: string): number {
  return Math.min(DIALOGUE_MAX_DURATION, Math.max(DIALOGUE_MIN_DURATION, text.length * DIALOGUE_MS_PER_CHAR));
}

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
  // 参数映射表（当模型目录存在 param-map.json 时填充）
  mappedParameters?: Array<{
    id: string;
    alias: string;
    description: string;
    min: number;
    max: number;
    default: number;
  }>;
  mappedExpressions?: Array<{
    id: string;
    alias: string;
    description: string;
  }>;
  mappedMotions?: Array<{
    group: string;
    index: number;
    alias: string;
    description: string;
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

/** Provider 实例配置（持久化用） */
export interface ProviderInstanceConfig {
  /** 实例唯一 ID (uuid) */
  instanceId: string;
  /** Provider 类型 ID (如 'openai', 'deepseek') */
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

/** TTS Provider 实例配置（持久化用） */
export interface TTSProviderInstanceConfig {
  instanceId: string;
  providerId: string;
  displayName: string;
  config: ProviderConfig;
  enabled: boolean;
}

/** TTS Provider 实例运行时状态 */
export interface TTSProviderInstanceInfo {
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

  /** 所有 TTS Provider 实例（instanceId → 运行时） */
  private ttsInstances: Map<string, {
    config: TTSProviderInstanceConfig;
    provider: TTSProvider | null;
    status: 'idle' | 'connecting' | 'connected' | 'error';
    error?: string;
  }> = new Map();

  /** 主 TTS 实例 ID */
  private primaryTTSInstanceId: string = '';

  /** Provider 初始化并发锁（防止同一实例被并发 initialize） */
  private initLocks: Map<string, Promise<{ success: boolean; error?: string }>> = new Map();

  /** TTS 配置持久化文件路径 */
  private ttsConfigPath: string = '';

  /** 会话管理器 */
  public readonly sessions: SessionManager;

  /** 模型和角色状态 */
  private modelInfo: ModelInfo | null = null;
  private characterInfo: CharacterInfo | null = null;

  /** 是否启用 Function Calling */
  private enableToolCalling: boolean = true;

  /** 配置持久化文件路径 */
  private configPath: string;

  // ==================== 插件调用基础设施 ====================

  /** 挂起的插件调用请求（requestId → resolve/reject） */
  private pendingPluginRequests: Map<string, {
    resolve: (result: { success: boolean; result?: unknown; error?: string }) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();

  /** 挂起的工具确认请求（confirmId → resolve） */
  private pendingToolConfirms: Map<string, {
    resolve: (approved: boolean) => void;
    timer: NodeJS.Timeout;
  }> = new Map();

  /** 当前活跃的 WebSocket 连接（用于插件调用） */
  private activeWs: import('ws').WebSocket | null = null;
  private activeSendFn: ((ws: import('ws').WebSocket, msg: object) => void) | null = null;

  constructor() {
    this.sessions = new SessionManager();
    // 持久化路径
    const { app } = require('electron');
    const path = require('path');
    this.configPath = path.join(app.getPath('userData'), 'data', PROVIDER_CONFIG_FILENAME);
    this.ttsConfigPath = path.join(app.getPath('userData'), 'data', TTS_CONFIG_FILENAME);

    // 注入 Handler 访问器到插件管理器
    agentPluginManager.setHandlerAccessor(this.createHandlerAccessor());

    // 加载持久化配置
    this.loadConfig();
    this.loadTTSConfig();
  }

  // ==================== Provider 实例管理 ====================

  /** 添加一个 Provider 实例 */
  public async addProviderInstance(instanceConfig: ProviderInstanceConfig): Promise<boolean> {
    // 验证 Provider 类型存在
    if (!providerRegistry.has(instanceConfig.providerId)) {
      logger.error(`[AgentHandler] Provider 类型不存在: ${instanceConfig.providerId}`);
      return false;
    }

    // 确保 enabled 字段有默认值（新建默认不启用，需用户手动开启）
    if (instanceConfig.enabled === undefined) {
      instanceConfig.enabled = false;
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
    // 并发锁：如果同一实例正在初始化，直接复用其 Promise
    const pending = this.initLocks.get(instanceId);
    if (pending) {
      logger.info(`[AgentHandler] Provider 实例 ${instanceId} 正在初始化中，等待完成...`);
      return pending;
    }

    const entry = this.providerInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    const initPromise = (async (): Promise<{ success: boolean; error?: string }> => {
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
      } finally {
        this.initLocks.delete(instanceId);
      }
    })();

    this.initLocks.set(instanceId, initPromise);
    return initPromise;
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
            // 跳过已不存在的 Provider 类型（如已删除的 echo）
            if (!providerRegistry.get(inst.providerId)) {
              logger.warn(`[AgentHandler] 跳过未知 Provider 类型: ${inst.providerId} (${inst.instanceId})`);
              continue;
            }
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
          // 如果主实例被跳过，清空主实例 ID
          this.primaryInstanceId = this.providerInstances.has(data.primaryInstanceId)
            ? data.primaryInstanceId
            : '';
        }
        logger.info(`[AgentHandler] 已加载 ${this.providerInstances.size} 个 Provider 配置`);

        // 自动连接已启用的 Provider 实例
        this.autoConnectEnabled();
      }
    } catch (error) {
      logger.warn(`[AgentHandler] 加载 Provider 配置失败: ${error}`);
    }

    // 首次启动无 Provider 实例，用户需要在设置中手动添加
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

  // ==================== TTS Provider 实例管理 ====================

  /** 添加一个 TTS Provider 实例 */
  public async addTTSInstance(instanceConfig: TTSProviderInstanceConfig): Promise<boolean> {
    if (!ttsProviderRegistry.has(instanceConfig.providerId)) {
      logger.error(`[AgentHandler] TTS Provider 类型不存在: ${instanceConfig.providerId}`);
      return false;
    }

    if (instanceConfig.enabled === undefined) {
      instanceConfig.enabled = false;
    }

    this.ttsInstances.set(instanceConfig.instanceId, {
      config: instanceConfig,
      provider: null,
      status: 'idle'
    });

    // 如果是第一个 TTS 实例，自动设为主 TTS
    if (this.ttsInstances.size === 1) {
      this.primaryTTSInstanceId = instanceConfig.instanceId;
    }

    this.saveTTSConfig();
    logger.info(`[AgentHandler] 添加 TTS 实例: ${instanceConfig.displayName} (${instanceConfig.providerId})`);
    return true;
  }

  /** 移除一个 TTS Provider 实例 */
  public async removeTTSInstance(instanceId: string): Promise<boolean> {
    const entry = this.ttsInstances.get(instanceId);
    if (!entry) return false;

    if (entry.provider) {
      try { await entry.provider.terminate(); } catch {}
    }

    this.ttsInstances.delete(instanceId);

    if (this.primaryTTSInstanceId === instanceId) {
      const firstKey = this.ttsInstances.keys().next().value;
      this.primaryTTSInstanceId = firstKey || '';
    }

    this.saveTTSConfig();
    logger.info(`[AgentHandler] 移除 TTS 实例: ${instanceId}`);
    return true;
  }

  /** 更新 TTS Provider 实例配置 */
  public async updateTTSInstance(instanceId: string, config: Partial<TTSProviderInstanceConfig>): Promise<boolean> {
    const entry = this.ttsInstances.get(instanceId);
    if (!entry) return false;

    if (config.config) {
      entry.config.config = { ...entry.config.config, ...config.config };
    }
    if (config.displayName) {
      entry.config.displayName = config.displayName;
    }
    if (config.providerId) {
      entry.config.providerId = config.providerId;
    }

    if (entry.provider) {
      try { await entry.provider.terminate(); } catch {}
      entry.provider = null;
      entry.status = 'idle';
    }

    this.saveTTSConfig();
    return true;
  }

  /** 初始化（连接）一个 TTS Provider 实例 */
  public async initializeTTSInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    // 并发锁：复用已有的初始化 Promise
    const lockKey = `tts:${instanceId}`;
    const pending = this.initLocks.get(lockKey);
    if (pending) {
      logger.info(`[AgentHandler] TTS 实例 ${instanceId} 正在初始化中，等待完成...`);
      return pending;
    }

    const entry = this.ttsInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    const initPromise = (async (): Promise<{ success: boolean; error?: string }> => {
      try {
        if (entry.provider) {
          await entry.provider.terminate();
        }

        entry.status = 'connecting';
        entry.error = undefined;

        const provider = ttsProviderRegistry.create(entry.config.providerId, entry.config.config);
        if (!provider) {
          throw new Error(`无法创建 TTS Provider: ${entry.config.providerId}`);
        }

        await provider.initialize();
        entry.provider = provider;
        entry.status = 'connected';
        entry.error = undefined;

        logger.info(`[AgentHandler] TTS 实例已连接: ${entry.config.displayName}`);
        return { success: true };
      } catch (error) {
        entry.status = 'error';
        entry.error = (error as Error).message;
        logger.error(`[AgentHandler] TTS 实例连接失败: ${(error as Error).message}`);
        return { success: false, error: (error as Error).message };
      } finally {
        this.initLocks.delete(lockKey);
      }
    })();

    this.initLocks.set(lockKey, initPromise);
    return initPromise;
  }

  /** 断开 TTS Provider 实例连接 */
  public async disconnectTTSInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.ttsInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    try {
      if (entry.provider) {
        await entry.provider.terminate();
        entry.provider = null;
      }
      entry.status = 'idle';
      entry.error = undefined;
      logger.info(`[AgentHandler] TTS 实例已断开: ${entry.config.displayName}`);
      return { success: true };
    } catch (error) {
      entry.status = 'error';
      entry.error = (error as Error).message;
      return { success: false, error: (error as Error).message };
    }
  }

  /** 启用 TTS Provider 实例 */
  public async enableTTSInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.ttsInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    entry.config.enabled = true;
    this.saveTTSConfig();
    logger.info(`[AgentHandler] TTS 实例已启用: ${entry.config.displayName}`);
    return this.initializeTTSInstance(instanceId);
  }

  /** 禁用 TTS Provider 实例 */
  public async disableTTSInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.ttsInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    entry.config.enabled = false;

    if (entry.provider) {
      try { await entry.provider.terminate(); } catch {}
      entry.provider = null;
    }
    entry.status = 'idle';
    entry.error = undefined;

    this.saveTTSConfig();
    logger.info(`[AgentHandler] TTS 实例已禁用: ${entry.config.displayName}`);
    return { success: true };
  }

  /** 设置主 TTS */
  public setPrimaryTTS(instanceId: string): boolean {
    if (!this.ttsInstances.has(instanceId)) return false;
    this.primaryTTSInstanceId = instanceId;
    this.saveTTSConfig();
    logger.info(`[AgentHandler] 已设置主 TTS: ${instanceId}`);
    return true;
  }

  /** 获取主 TTS 的 Provider 实例 */
  public getPrimaryTTSProvider(): TTSProvider | null {
    if (!this.primaryTTSInstanceId) return null;
    const entry = this.ttsInstances.get(this.primaryTTSInstanceId);
    return entry?.provider || null;
  }

  /** 获取主 TTS instanceId */
  public getPrimaryTTSInstanceId(): string {
    return this.primaryTTSInstanceId;
  }

  /** 测试指定 TTS Provider 实例 */
  public async testTTSInstance(instanceId: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.ttsInstances.get(instanceId);
    if (!entry) return { success: false, error: '实例不存在' };

    if (entry.provider) {
      return entry.provider.test();
    }

    let tempProvider: TTSProvider | null = null;
    try {
      tempProvider = ttsProviderRegistry.create(entry.config.providerId, entry.config.config);
      if (!tempProvider) {
        return { success: false, error: `无法创建 TTS Provider: ${entry.config.providerId}` };
      }
      await tempProvider.initialize();
      const result = await tempProvider.test();
      return result;
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      if (tempProvider) {
        try { await tempProvider.terminate(); } catch {}
      }
    }
  }

  /** 获取所有 TTS 实例信息 */
  public getAllTTSInstances(): TTSProviderInstanceInfo[] {
    const result: TTSProviderInstanceInfo[] = [];
    for (const [instanceId, entry] of this.ttsInstances) {
      result.push({
        instanceId,
        providerId: entry.config.providerId,
        displayName: entry.config.displayName,
        config: entry.config.config,
        metadata: ttsProviderRegistry.get(entry.config.providerId),
        enabled: entry.config.enabled !== false,
        status: entry.status,
        error: entry.error,
        isPrimary: instanceId === this.primaryTTSInstanceId
      });
    }
    return result;
  }

  /** 获取所有可用 TTS Provider 类型 */
  public getAvailableTTSProviders(): ProviderMetadata[] {
    return ttsProviderRegistry.getAll();
  }

  /** 获取 TTS 音色列表 */
  public async getTTSVoices(instanceId: string): Promise<Array<{ id: string; name: string; description?: string }>> {
    const entry = this.ttsInstances.get(instanceId);
    if (!entry?.provider) return [];

    try {
      const voices = await entry.provider.getVoices();
      return voices.map(v => ({ id: v.id, name: v.name, description: v.description }));
    } catch (error) {
      logger.error(`[AgentHandler] 获取 TTS 音色列表失败: ${(error as Error).message}`);
      return [];
    }
  }

  // ==================== TTS 自动连接 ====================

  private async autoConnectTTSEnabled(): Promise<void> {
    for (const [instanceId, entry] of this.ttsInstances) {
      if (entry.config.enabled) {
        this.initializeTTSInstance(instanceId).catch(err => {
          logger.warn(`[AgentHandler] 自动连接 TTS 失败 (${entry.config.displayName}): ${err}`);
        });
      }
    }
  }

  // ==================== TTS 持久化 ====================

  private loadTTSConfig(): void {
    const fs = require('fs');
    const path = require('path');
    try {
      const dir = path.dirname(this.ttsConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.ttsConfigPath)) {
        const data = JSON.parse(fs.readFileSync(this.ttsConfigPath, 'utf-8'));
        if (data.instances && Array.isArray(data.instances)) {
          for (const inst of data.instances) {
            if (inst.enabled === undefined) {
              inst.enabled = true;
            }
            this.ttsInstances.set(inst.instanceId, {
              config: inst,
              provider: null,
              status: 'idle'
            });
          }
        }
        if (data.primaryInstanceId) {
          this.primaryTTSInstanceId = data.primaryInstanceId;
        }
        logger.info(`[AgentHandler] 已加载 ${this.ttsInstances.size} 个 TTS Provider 配置`);
        this.autoConnectTTSEnabled();
      }
    } catch (error) {
      logger.warn(`[AgentHandler] 加载 TTS Provider 配置失败: ${error}`);
    }
  }

  private saveTTSConfig(): void {
    const fs = require('fs');
    try {
      const instances: TTSProviderInstanceConfig[] = [];
      for (const [, entry] of this.ttsInstances) {
        instances.push(entry.config);
      }
      const data = {
        primaryInstanceId: this.primaryTTSInstanceId,
        instances
      };
      fs.writeFileSync(this.ttsConfigPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[AgentHandler] 保存 TTS Provider 配置失败: ${error}`);
    }
  }

  /**
   * 使用主 TTS Provider 合成音频并通过 WebSocket 流式发送
   * LLM 回复后自动调用，将文字转语音推送到前端
   */
  public async synthesizeAndStream(text: string, ctx: Sendable): Promise<void> {
    const ttsProvider = this.getPrimaryTTSProvider();
    if (!ttsProvider) {
      return; // 没有 TTS Provider 就静默跳过
    }

    try {
      const rawFormat = ttsProvider.getConfig().format;
      const format = (typeof rawFormat === 'string' ? rawFormat : 'mp3') as 'mp3' | 'wav' | 'pcm' | 'opus';
      const mimeType = ttsProvider.getMimeType(format);

      // 发送 audio_stream_start
      ctx.send({
        type: 'audio_stream_start',
        data: {
          mimeType,
          text
        }
      });

      // 流式合成并发送 audio_chunk
      let sequence = 0;
      for await (const chunk of ttsProvider.synthesizeStream({ text, format })) {
        ctx.send({
          type: 'audio_chunk',
          data: {
            chunk: chunk.toString('base64'),
            sequence: sequence++
          }
        });
      }

      // 发送 audio_stream_end
      ctx.send({
        type: 'audio_stream_end',
        data: { complete: true }
      });

      logger.info(`[AgentHandler] TTS 合成完成，共 ${sequence} 个分片`);
    } catch (error) {
      logger.error(`[AgentHandler] TTS 合成失败: ${(error as Error).message}`);
      // 如果已经发送了 start，需要发送 end 通知前端
      ctx.send({
        type: 'audio_stream_end',
        data: { complete: false, error: (error as Error).message }
      });
    }
  }

  // ==================== 消息处理方法 ====================

  // ---------- 默认路径系统提示词构建 ----------

  /**
   * 为默认路径构建系统提示词
   * 对话 LLM 只需输出纯文本，表情/动作由独立的 expression-generator 插件生成。
   */
  private buildDefaultSystemPrompt(): string {
    const personality = this.characterInfo?.personality || DEFAULT_PERSONALITY;
    const sections = [personality];

    // 追加模型能力信息（仅告知 LLM 拥有身体，具体控制由 expression-generator 负责）
    if (this.modelInfo) {
      const capParts = ['## 你的身体能力（Live2D 模型）\n你拥有一个 Live2D 模型身体，能做出各种表情和动作。这些会由独立的表情系统根据你的对话内容自动生成，你完全不需要手动指定。'];

      if (this.modelInfo.hitAreas && this.modelInfo.hitAreas.length > 0) {
        capParts.push(`\n**可触碰部位**: ${this.modelInfo.hitAreas.join(', ')}`);
      }

      sections.push(capParts.join(''));
    }

    // 追加回复格式引导（纯文本输出）
    sections.push(`## 回复格式规范

请直接输出纯文字对话内容。你的表情、动作、身体姿态变化全部由独立的表情系统自动生成，你完全不需要也不应该手动控制。

重要规则：
- 只输出纯文字对话，绝对禁止使用任何 XML 标签（如 <expression>、<motion>、<parameter>、<action> 等）
- 禁止在回复中描述或指定具体的表情名称、动作名称或参数值
- 禁止输出任何结构化控制指令或格式标记
- 通过文字本身的情感表达（如语气词、颜文字）来传达情绪
- 专注于对话质量和角色性格的表现`);

    return sections.join('\n\n');
  }

  /**
   * 处理用户文本输入 — 核心逻辑（Core Agent 增强版）
   * 
   * 如果有活跃的 handler 插件，委托给插件处理；
   * 否则使用默认逻辑（简单的 LLM 调用 + 文本回复）。
   * 
   * 集成 input-collector：在默认逻辑中，先将输入交给收集器，
   * 如果收集器返回 null 表示输入已缓冲，跳过处理。
   */
  public async processUserInput(ctx: PipelineContext): Promise<void> {
    let text = ctx.message.text || '';
    logger.info(`[AgentHandler] 用户输入: ${text}`);

    // 更新活跃连接（绑定到 WebSocket 连接而非 PipelineContext，避免并发消息覆盖闭包）
    this.setActiveConnection(ctx.ws, (ws, msg) => {
      if (ws.readyState === 1 /* WebSocket.OPEN */) {
        ws.send(JSON.stringify(msg));
      }
    });

    // 尝试委托给 handler 插件
    const handlerPlugin = agentPluginManager.getHandlerPlugin();
    if (handlerPlugin?.onUserInput) {
      const mctx = this.createMessageContext(ctx);
      const handled = await handlerPlugin.onUserInput(mctx);
      if (handled) return;
    }

    // === 默认逻辑（无 handler 插件时的回退） ===

    // 集成 input-collector：抖动收集
    const collector = agentPluginManager.getPluginInstance('input-collector') as { isEnabled?: () => boolean; collectInput?: (sid: string, text: string) => Promise<string | null> } | null;
    if (collector?.isEnabled?.() && collector.collectInput) {
      const collected = await collector.collectInput(ctx.sessionId, text);
      if (collected === null) {
        logger.info(`[AgentHandler] 输入已被收集器缓冲，跳过处理`);
        return;
      }
      text = collected;
      logger.info(`[AgentHandler] 收集器输出: ${text}`);
    }

    const primaryProvider = this.getPrimaryProvider();
    if (!primaryProvider) {
      ctx.addReply({
        type: 'dialogue',
        data: { text: '[内置Agent] 未配置或未激活主 LLM Provider', duration: ERROR_DIALOGUE_DURATION }
      });
      return;
    }

    this.sessions.addMessage(ctx.sessionId, { role: 'user', content: text });

    const history = this.sessions.getHistory(ctx.sessionId);
    const request: LLMRequest = {
      messages: [...history],
      systemPrompt: this.buildDefaultSystemPrompt(),
      sessionId: ctx.sessionId
    };

    if (this.enableToolCalling && toolManager.hasEnabledTools()) {
      request.tools = toolManager.toOpenAITools();
      request.toolChoice = 'auto';
    }

    try {
      // 判断是否启用流式输出
      const isStreaming = this.isStreamingEnabled();

      if (isStreaming) {
        const fullText = await this.executeWithToolLoopStreaming(request, ctx, primaryProvider);
        // 对话 LLM 现在只输出纯文本，直接保存和使用
        this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: fullText });
        // TTS 合成
        this.synthesizeAndStream(fullText, ctx).catch(e =>
          logger.warn(`[AgentHandler] TTS 合成失败（非致命）: ${e}`)
        );
      } else {
        const response = await this.executeWithToolLoop(request, ctx, primaryProvider);
        this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: response.text });

        ctx.addReply({
          type: 'dialogue',
          data: { text: response.text, duration: calculateDialogueDuration(response.text) }
        });
        // TTS 合成
        this.synthesizeAndStream(response.text, ctx).catch(e =>
          logger.warn(`[AgentHandler] TTS 合成失败（非致命）: ${e}`)
        );
      }
    } catch (error) {
      logger.error('[AgentHandler] LLM 调用失败:', error);
      ctx.addReply({
        type: 'dialogue',
        data: { text: `[内置Agent] AI 回复失败: ${(error as Error).message}`, duration: ERROR_DIALOGUE_DURATION }
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
  private async executeWithToolLoop(request: LLMRequest, ctx: Sendable, provider: LLMProvider): Promise<LLMResponse> {
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

      // 将 assistant 的 tool_calls 消息追加到历史（保留 reasoningContent 供 DeepSeek thinking mode）
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.text || '',
        toolCalls: response.toolCalls,
        ...(response.reasoningContent !== undefined && { reasoningContent: response.reasoningContent })
      };
      currentRequest.messages.push(assistantMsg);
      this.sessions.addMessage(ctx.sessionId, assistantMsg);

      // 解析工具调用参数（安全处理 LLM 返回的无效 JSON）
      const toolCalls: ToolCall[] = [];
      for (const tc of response.toolCalls) {
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;
        } catch (parseErr) {
          logger.error(`[AgentHandler] 工具参数 JSON 解析失败 (${tc.name}):`, parseErr);
          // 跳过此工具调用，用错误结果占位
          toolCalls.push({ id: tc.id, name: tc.name, arguments: {} });
          continue;
        }
        toolCalls.push({ id: tc.id, name: tc.name, arguments: parsedArgs });
      }

      // 请求用户确认工具调用（仅对插件来源工具需要确认）
      const hasPluginTools = toolCalls.some(tc => {
        const toolDef = toolManager.getToolByName(tc.name);
        return toolDef?.source === 'plugin';
      });

      if (hasPluginTools) {
        const approved = await this.requestToolConfirm(toolCalls, iterations, ctx);
        if (!approved) {
          // 用户拒绝，通知 LLM
          for (const tc of toolCalls) {
            const toolMsg: ChatMessage = {
              role: 'tool',
              content: TOOL_REJECTED_MESSAGE,
              toolCallId: tc.id,
              toolName: tc.name
            };
            currentRequest.messages.push(toolMsg);
            this.sessions.addMessage(ctx.sessionId, toolMsg);
          }
          continue;
        }
      }

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
   * 判断主 LLM Provider 是否启用了流式输出
   */
  private isStreamingEnabled(): boolean {
    if (!this.primaryInstanceId) return false;
    const entry = this.providerInstances.get(this.primaryInstanceId);
    return !!(entry?.config.config?.stream);
  }

  /**
   * 发送工具确认请求到前端，等待用户确认
   * @returns true = 用户批准, false = 用户拒绝或超时
   */
  private async requestToolConfirm(
    toolCalls: ToolCall[],
    _iteration: number,
    ctx: Sendable,
    timeout: number = DEFAULT_TOOL_CONFIRM_TIMEOUT
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const confirmId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const timer = setTimeout(() => {
        this.pendingToolConfirms.delete(confirmId);
        logger.warn(`[AgentHandler] 工具确认超时 (${timeout}ms)，自动拒绝`);
        resolve(false);
      }, timeout);

      this.pendingToolConfirms.set(confirmId, { resolve, timer });

      // 构建确认数据（附带工具描述信息）
      const confirmData = {
        confirmId,
        toolCalls: toolCalls.map(tc => {
          const toolDef = toolManager.getToolByName(tc.name);
          return {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            source: (toolDef?.source || 'function') as 'function' | 'mcp' | 'plugin',
            description: toolDef?.schema.description
          };
        }),
        timeout
      };

      ctx.send({
        type: 'tool_confirm',
        data: confirmData
      });

      logger.info(`[AgentHandler] 已发送工具确认请求: ${confirmId}, 工具: ${toolCalls.map(tc => tc.name).join(', ')}`);
    });
  }

  /**
   * 处理前端返回的工具确认响应
   */
  public processToolConfirmResponse(ctx: PipelineContext): void {
    const data = ctx.message.data as { confirmId?: string; approved?: boolean; remember?: boolean } | undefined;
    if (!data?.confirmId) {
      logger.warn('[AgentHandler] tool_confirm_response 缺少 confirmId');
      return;
    }

    const pending = this.pendingToolConfirms.get(data.confirmId);
    if (!pending) {
      logger.warn(`[AgentHandler] 未找到挂起的工具确认: ${data.confirmId}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingToolConfirms.delete(data.confirmId);
    
    logger.info(`[AgentHandler] 工具确认响应: ${data.confirmId} → ${data.approved ? '批准' : '拒绝'}`);
    pending.resolve(!!data.approved);
  }

  /**
   * 流式工具循环执行
   * 
   * 使用 chatStream() 获取流式响应，实时发送 dialogue_stream_* 到前端。
   * 当遇到 tool_calls 时切换到内部积累模式，不发送中间 tool_calls 的流式文本。
   * 
   * @returns 最终完整文本
   */
  private async executeWithToolLoopStreaming(
    request: LLMRequest,
    ctx: Sendable,
    provider: LLMProvider
  ): Promise<string> {
    let iterations = 0;
    let currentRequest = { ...request };
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let streamStarted = false;

    while (iterations < MAX_TOOL_LOOP_ITERATIONS) {
      iterations++;

      let fullText = '';
      let fullReasoning = '';
      const toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let hasToolCalls = false;

      // 流式读取 LLM 响应
      for await (const chunk of provider.chatStream(currentRequest)) {
        // 积累工具调用增量
        if (chunk.toolCallDeltas) {
          hasToolCalls = true;
          for (const delta of chunk.toolCallDeltas) {
            let existing = toolCallAccumulator.get(delta.index);
            if (!existing) {
              existing = { id: '', name: '', arguments: '' };
              toolCallAccumulator.set(delta.index, existing);
            }
            if (delta.id) existing.id = delta.id;
            if (delta.name) existing.name += delta.name;
            if (delta.arguments) existing.arguments += delta.arguments;
          }
        }

        // 积累文本
        if (chunk.delta) {
          fullText += chunk.delta;

          // 仅在非工具调用轮次才流式输出文本
          if (!hasToolCalls) {
            if (!streamStarted) {
              streamStarted = true;
              ctx.send({ type: 'dialogue_stream_start', data: { streamId } });
            }
            // 对话 LLM 只输出纯文本，直接发送 delta
            ctx.send({
              type: 'dialogue_stream_chunk',
              data: {
                streamId,
                delta: chunk.delta,
                reasoningDelta: chunk.reasoningDelta
              }
            });
          }
        }

        if (chunk.reasoningDelta) {
          fullReasoning += chunk.reasoningDelta;
          // 如果流已开始且有推理增量（但无普通 delta），也发送
          if (!hasToolCalls && streamStarted && !chunk.delta) {
            ctx.send({
              type: 'dialogue_stream_chunk',
              data: { streamId, delta: '', reasoningDelta: chunk.reasoningDelta }
            });
          }
        }

        if (chunk.done) break;
      }

      // 如果没有工具调用，结束流并返回
      if (!hasToolCalls || toolCallAccumulator.size === 0) {
        if (streamStarted) {
          const duration = calculateDialogueDuration(fullText);
          ctx.send({
            type: 'dialogue_stream_end',
            data: { streamId, fullText, duration }
          });
        }
        return fullText;
      }

      // === 有工具调用 ===
      logger.info(`[AgentHandler] 流式工具循环 #${iterations}: ${toolCallAccumulator.size} 个工具调用`);

      // 构建 ToolCallInfo
      const toolCallInfos: import('./provider').ToolCallInfo[] = [];
      for (const [, tc] of toolCallAccumulator) {
        toolCallInfos.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
      }

      // 将 assistant 的 tool_calls 消息追加到历史（保留 reasoningContent 供 DeepSeek thinking mode）
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: fullText || '',
        toolCalls: toolCallInfos,
        ...(fullReasoning && { reasoningContent: fullReasoning })
      };
      currentRequest.messages.push(assistantMsg);
      this.sessions.addMessage(ctx.sessionId, assistantMsg);

      // 解析工具调用参数
      const toolCalls: ToolCall[] = [];
      for (const tc of toolCallInfos) {
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;
        } catch (parseErr) {
          logger.error(`[AgentHandler] 流式工具参数 JSON 解析失败 (${tc.name}):`, parseErr);
          toolCalls.push({ id: tc.id, name: tc.name, arguments: {} });
          continue;
        }
        toolCalls.push({ id: tc.id, name: tc.name, arguments: parsedArgs });
      }

      // 请求用户确认工具调用
      const hasPluginTools = toolCalls.some(tc => {
        const toolDef = toolManager.getToolByName(tc.name);
        return toolDef?.source === 'plugin';
      });
      
      if (hasPluginTools) {
        const approved = await this.requestToolConfirm(toolCalls, iterations, ctx);
        if (!approved) {
          // 用户拒绝，发送拒绝消息作为工具结果，让 LLM 知道
          for (const tc of toolCalls) {
            const toolMsg: ChatMessage = {
              role: 'tool',
              content: TOOL_REJECTED_MESSAGE,
              toolCallId: tc.id,
              toolName: tc.name
            };
            currentRequest.messages.push(toolMsg);
            this.sessions.addMessage(ctx.sessionId, toolMsg);
          }
          // 继续循环让 LLM 生成不使用工具的回复
          continue;
        }
      }

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

      // 通知前端工具执行状态
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
    logger.warn(`[AgentHandler] 流式工具循环超过最大迭代次数 (${MAX_TOOL_LOOP_ITERATIONS})`);
    if (streamStarted) {
      ctx.send({
        type: 'dialogue_stream_end',
        data: { streamId, fullText: '[内置Agent] 工具调用次数超过限制，请简化请求。', duration: ERROR_DIALOGUE_DURATION }
      });
    }
    return '[内置Agent] 工具调用次数超过限制，请简化请求。';
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

    // 委托给 handler 插件
    const handlerPlugin = agentPluginManager.getHandlerPlugin();
    if (handlerPlugin?.onModelInfo) {
      handlerPlugin.onModelInfo(this.createMessageContext(ctx));
    }
  }

  /**
   * 处理触碰事件
   */
  public async processTapEvent(ctx: PipelineContext): Promise<void> {
    const data = ctx.message.data as TapEventData;
    logger.info(`[AgentHandler] 触碰事件: ${data.hitArea}`);

    // 尝试委托给 handler 插件
    const handlerPlugin = agentPluginManager.getHandlerPlugin();
    if (handlerPlugin?.onTapEvent) {
      const mctx = this.createMessageContext(ctx);
      const handled = await handlerPlugin.onTapEvent(mctx);
      if (handled) return;
    }

    // === 默认逻辑 ===
    const tapUserMsg = `[触碰] 用户触碰了 "${data.hitArea}" 部位`;
    this.sessions.addMessage(ctx.sessionId, { role: 'user', content: tapUserMsg });

    const primaryProvider = this.getPrimaryProvider();
    if (primaryProvider) {
      try {
        const response = await primaryProvider.chat({
          messages: [{ role: 'user', content: `用户触碰了你的 "${data.hitArea}" 部位，请给出简短反应。` }],
          systemPrompt: this.buildDefaultSystemPrompt(),
          maxTokens: TAP_RESPONSE_MAX_TOKENS
        });
        // 对话 LLM 只输出纯文本
        this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: response.text });
        ctx.addReply({ type: 'dialogue', data: { text: response.text, duration: 3000 } });
        // TTS 合成（异步，不阻断主流程）
        this.synthesizeAndStream(response.text, ctx).catch(e =>
          logger.warn(`[AgentHandler] TTS 合成失败（非致命）: ${e}`)
        );
        return;
      } catch (error) {
        logger.warn('[AgentHandler] 触碰 LLM 调用失败，使用默认反应');
      }
    }

    const reactions: Record<string, string> = {
      'Head': '头被摸了喵~', 'Body': '不要乱摸喵！', 'Face': '脸好痒喵~'
    };
    const replyText = reactions[data.hitArea] || '被点到了喵~';
    this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: replyText });
    ctx.addReply({ type: 'dialogue', data: { text: replyText, duration: 3000 } });
    // TTS 合成（异步，不阻断主流程）
    this.synthesizeAndStream(replyText, ctx).catch(e =>
      logger.warn(`[AgentHandler] TTS 合成失败（非致命）: ${e}`)
    );
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

    // 委托给 handler 插件
    const handlerPlugin = agentPluginManager.getHandlerPlugin();
    if (handlerPlugin?.onCharacterInfo) {
      handlerPlugin.onCharacterInfo(this.createMessageContext(ctx));
    }
  }

  /**
   * 处理文件上传
   * 
   * 集成 image-transcriber：如果上传的是图片且图片转述插件已启用，
   * 自动调用视觉 Provider 获取描述，并将描述添加到会话上下文中。
   */
  public async processFileUpload(ctx: PipelineContext): Promise<void> {
    const data = ctx.message.data as { fileName?: string; fileType?: string; fileData?: string; fileSize?: number } | undefined;
    logger.info(`[AgentHandler] 收到文件: ${data?.fileName}`);

    // 尝试委托给 handler 插件
    const handlerPlugin = agentPluginManager.getHandlerPlugin();
    if (handlerPlugin?.onFileUpload) {
      const mctx = this.createMessageContext(ctx);
      const handled = await handlerPlugin.onFileUpload(mctx);
      if (handled) return;
    }

    // === 默认逻辑（无 handler 插件时的回退） ===

    // 检查是否为图片且 image-transcriber 可用
    const isImage = data?.fileType?.startsWith('image/');
    const transcriber = agentPluginManager.getPluginInstance('image-transcriber') as {
      isAvailable?: () => boolean;
      autoTranscribe?: boolean;
      cacheImage?: (data: string, mime: string, name: string) => void;
      transcribeImage?: (data: string, mime: string) => Promise<{ success: boolean; description?: string; error?: string }>;
    } | null;

    if (isImage && data?.fileData) {
      // 缓存图片供 describe_image 工具使用
      if (transcriber?.cacheImage) {
        transcriber.cacheImage(data.fileData, data.fileType!, data.fileName || 'image');
      }

      // 自动转述模式
      if (transcriber?.isAvailable?.() && transcriber.autoTranscribe && transcriber.transcribeImage) {
        ctx.addReply({
          type: 'dialogue',
          data: { text: `正在识别图片 ${data.fileName}...`, duration: 3000 }
        });

        const result = await transcriber.transcribeImage(data.fileData, data.fileType!);
        if (result.success && result.description) {
          // 将图片描述添加到会话历史
          this.sessions.addMessage(ctx.sessionId, {
            role: 'user',
            content: `[用户上传了图片: ${data.fileName}]\n\n图片描述: ${result.description}`
          });

          ctx.addReply({
            type: 'dialogue',
            data: { text: `📷 ${data.fileName}\n\n${result.description}`, duration: 8000 }
          });
          return;
        } else {
          logger.warn(`[AgentHandler] 图片转述失败: ${result.error}`);
          // 降级：仅记录文件信息
        }
      }
    }

    // 默认：记录文件上传并确认
    const fileMsg = `[文件上传] ${data?.fileName || '未知文件'}` + (data?.fileType ? ` (${data.fileType})` : '');
    this.sessions.addMessage(ctx.sessionId, { role: 'user', content: fileMsg });
    const ackText = `[内置Agent] 收到文件: ${data?.fileName}`;
    this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: ackText });
    ctx.addReply({
      type: 'dialogue',
      data: { text: ackText, duration: 3000 }
    });
  }

  // ==================== 指令系统 ====================

  /**
   * 处理指令执行请求（command_execute 消息）
   */
  public async processCommandExecute(ctx: PipelineContext): Promise<void> {
    const data = ctx.message.data as { command?: string; args?: Record<string, unknown> } | undefined;
    if (!data?.command) {
      ctx.addReply({
        type: 'command_response',
        data: { command: '', success: false, error: '缺少指令名称' }
      });
      return;
    }

    logger.info(`[AgentHandler] 执行指令: /${data.command}`);

    // 持久化指令输入
    const argsStr = data.args && Object.keys(data.args).length > 0 ? ' ' + JSON.stringify(data.args) : '';
    this.sessions.addMessage(ctx.sessionId, { role: 'user', content: `/${data.command}${argsStr}` });

    const result = await commandRegistry.execute(data.command, data.args || {}, ctx.sessionId);

    // 持久化指令执行结果
    const resultText = result.success
      ? (result.text || `指令 /${data.command} 执行成功`)
      : `指令 /${data.command} 失败: ${result.error || '未知错误'}`;
    this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: resultText });

    ctx.addReply({
      type: 'command_response',
      data: result
    });
  }

  /**
   * 向指定客户端发送已注册指令列表
   */
  public sendCommandsRegister(ws: import('ws').WebSocket): void {
    const commands = commandRegistry.getEnabledDefinitions();
    const msg = {
      type: 'commands_register',
      data: { commands }
    };
    if (ws.readyState === 1 /* WebSocket.OPEN */) {
      ws.send(JSON.stringify(msg));
    }
    logger.info(`[AgentHandler] 已发送 ${commands.length} 个指令定义到前端`);
  }

  /**
   * 处理插件响应
   * 将插件响应与挂起的请求匹配，解析 Promise
   */
  public processPluginResponse(ctx: PipelineContext): void {
    const data = ctx.message.data as { requestId?: string; pluginId?: string; action?: string; success?: boolean; result?: unknown; error?: string } | undefined;
    if (!data?.requestId) {
      logger.warn('[AgentHandler] 插件响应缺少 requestId');
      return;
    }

    const requestId = data.requestId;
    const pending = this.pendingPluginRequests.get(requestId);

    if (!pending) {
      // 也通知 handler 插件（如果有）
      const handlerPlugin = agentPluginManager.getHandlerPlugin();
      if (handlerPlugin?.onPluginResponse) {
        handlerPlugin.onPluginResponse(this.createMessageContext(ctx));
      }
      return;
    }

    clearTimeout(pending.timer);
    this.pendingPluginRequests.delete(requestId);
    logger.info(`[AgentHandler] 插件响应已匹配: ${data.pluginId} - ${data.action} (requestId: ${requestId})`);

    pending.resolve({
      success: data.success ?? false,
      result: data.result,
      error: data.error
    });
  }

  /**
   * 处理前端插件主动发送的消息
   * 插件可以主动向后端发送消息（非工具调用响应），消息将持久化到会话历史，
   * 并作为用户消息交给 LLM 处理以获取回复。
   */
  public async processPluginMessage(ctx: PipelineContext): Promise<void> {
    const data = ctx.message.data as { pluginId?: string; pluginName?: string; text?: string; metadata?: Record<string, unknown> } | undefined;
    if (!data?.text) {
      logger.warn('[AgentHandler] plugin_message 缺少 text 字段');
      return;
    }

    const pluginLabel = data.pluginName || data.pluginId || '未知插件';
    logger.info(`[AgentHandler] 收到插件主动消息: ${pluginLabel}`);

    // 尝试委托给 handler 插件
    const handlerPlugin = agentPluginManager.getHandlerPlugin();
    if (handlerPlugin?.onPluginMessage) {
      const mctx = this.createMessageContext(ctx);
      const handled = await handlerPlugin.onPluginMessage(mctx);
      if (handled) return;
    }

    // === 默认逻辑：作为用户消息持久化并交给 LLM 处理 ===
    const userContent = `[插件 ${pluginLabel}] ${data.text}`;
    this.sessions.addMessage(ctx.sessionId, { role: 'user', content: userContent });

    const primaryProvider = this.getPrimaryProvider();
    if (!primaryProvider) {
      // 无 Provider，仅持久化，不生成回复
      ctx.addReply({
        type: 'dialogue',
        data: { text: userContent, duration: ERROR_DIALOGUE_DURATION }
      });
      return;
    }

    const history = this.sessions.getHistory(ctx.sessionId);
    const request: LLMRequest = {
      messages: [...history],
      systemPrompt: this.buildDefaultSystemPrompt(),
      sessionId: ctx.sessionId
    };

    if (this.enableToolCalling && toolManager.hasEnabledTools()) {
      request.tools = toolManager.toOpenAITools();
      request.toolChoice = 'auto';
    }

    try {
      const isStreaming = this.isStreamingEnabled();
      if (isStreaming) {
        const fullText = await this.executeWithToolLoopStreaming(request, ctx, primaryProvider);
        this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: fullText });
        // TTS 合成
        this.synthesizeAndStream(fullText, ctx).catch(e =>
          logger.warn(`[AgentHandler] TTS 合成失败（非致命）: ${e}`)
        );
      } else {
        const response = await this.executeWithToolLoop(request, ctx, primaryProvider);
        this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: response.text });
        ctx.addReply({
          type: 'dialogue',
          data: { text: response.text, duration: calculateDialogueDuration(response.text) }
        });
        // TTS 合成
        this.synthesizeAndStream(response.text, ctx).catch(e =>
          logger.warn(`[AgentHandler] TTS 合成失败（非致命）: ${e}`)
        );
      }
    } catch (error) {
      logger.error('[AgentHandler] 插件消息 LLM 处理失败:', error);
      const errText = `处理插件消息失败: ${(error as Error).message}`;
      this.sessions.addMessage(ctx.sessionId, { role: 'assistant', content: errText });
      ctx.addReply({
        type: 'dialogue',
        data: { text: errText, duration: ERROR_DIALOGUE_DURATION }
      });
    }
  }

  /**
   * 处理前端插件状态报告
   * 前端在插件连接/断开时发送 plugin_status 消息，通知后端当前已连接的插件列表。
   * 后端将这些信息传递给 handler 插件的 registerConnectedPlugins，
   * 使 plugin-tool-bridge 将前端插件能力注册为 Function Calling 工具。
   */
  public processPluginStatus(ctx: PipelineContext): void {
    const data = ctx.message.data as { plugins?: Array<{ pluginId: string; pluginName: string; capabilities: string[] }> } | undefined;
    if (!data?.plugins || !Array.isArray(data.plugins)) {
      logger.warn('[AgentHandler] plugin_status 消息格式不正确');
      return;
    }

    // 确保活跃连接已设置（plugin_status 可能在 user_input 之前到达）
    if (!this.activeWs) {
      this.setActiveConnection(ctx.ws, (ws, msg) => {
        if (ws.readyState === 1 /* WebSocket.OPEN */) {
          ws.send(JSON.stringify(msg));
        }
      });
    }

    const plugins = data.plugins;
    logger.info(`[AgentHandler] 收到前端插件状态: ${plugins.length} 个插件`);

    // 通过 HandlerAccessor 传递给 handler 插件
    const handlerPlugin = agentPluginManager.getHandlerPlugin();
    if (handlerPlugin && 'registerConnectedPlugins' in handlerPlugin &&
        typeof (handlerPlugin as Record<string, unknown>).registerConnectedPlugins === 'function') {
      (handlerPlugin as unknown as { registerConnectedPlugins: (plugins: Array<{ pluginId: string; pluginName: string; capabilities: string[] }>) => void }).registerConnectedPlugins(plugins);
    }
  }

  // ==================== WebSocket 连接管理 ====================

  /**
   * 设置活跃的 WebSocket 连接（用于插件调用）
   */
  public setActiveConnection(ws: import('ws').WebSocket, sendFn: (ws: import('ws').WebSocket, msg: object) => void): void {
    this.activeWs = ws;
    this.activeSendFn = sendFn;
  }

  /**
   * 清除活跃连接（WebSocket 断开时调用）
   * 同时 reject 所有挂起的插件请求
   */
  public clearActiveConnection(ws: import('ws').WebSocket): void {
    if (this.activeWs === ws) {
      this.activeWs = null;
      this.activeSendFn = null;

      // 清理所有挂起的插件请求
      for (const [requestId, pending] of this.pendingPluginRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebSocket 连接已断开'));
        this.pendingPluginRequests.delete(requestId);
      }

      // 清理所有挂起的工具确认请求
      for (const [confirmId, pending] of this.pendingToolConfirms) {
        clearTimeout(pending.timer);
        pending.resolve(false); // 连接断开视为拒绝
        this.pendingToolConfirms.delete(confirmId);
      }

      logger.info('[AgentHandler] 活跃连接已清除，挂起的请求已拒绝');
    }
  }

  /**
   * 创建插件调用发送器
   * 发送 plugin_invoke 到前端，返回 Promise 等待 plugin_response
   */
  public createPluginInvokeSender(): PluginInvokeSender {
    return (pluginId: string, action: string, params: Record<string, unknown>, timeout: number = DEFAULT_PLUGIN_INVOKE_TIMEOUT) => {
      return new Promise((resolve, reject) => {
        if (!this.activeWs || !this.activeSendFn) {
          reject(new Error('没有活跃的 WebSocket 连接'));
          return;
        }

        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const timer = setTimeout(() => {
          this.pendingPluginRequests.delete(requestId);
          reject(new Error(`插件调用超时 (${timeout}ms): ${pluginId}.${action}`));
        }, timeout);

        this.pendingPluginRequests.set(requestId, { resolve, reject, timer });

        this.activeSendFn!(this.activeWs!, {
          type: 'plugin_invoke',
          data: { requestId, pluginId, action, params, timeout }
        });

        logger.debug(`[AgentHandler] 已发送插件调用: ${pluginId}.${action} (requestId: ${requestId})`);
      });
    };
  }

  // ==================== 内部工具方法 ====================

  /**
   * 从 PipelineContext 创建 MessageContext（供插件使用）
   */
  private createMessageContext(ctx: PipelineContext): MessageContext {
    return {
      message: ctx.message,
      sessionId: ctx.sessionId,
      addReply: (msg) => ctx.addReply(msg),
      send: (msg) => ctx.send(msg),
      ws: ctx.ws
    };
  }

  /**
   * 创建 HandlerAccessor（注入到插件管理器）
   */
  private createHandlerAccessor(): HandlerAccessor {
    const handler = this;
    return {
      getSessions: () => handler.sessions,
      getModelInfo: () => handler.modelInfo,
      getCharacterInfo: () => handler.characterInfo,
      synthesizeAndStream: (text: string, ctx: MessageContext) => handler.synthesizeAndStream(text, ctx),
      hasTTS: () => handler.getPrimaryTTSProvider() !== null,
      getPluginInvokeSender: () => (handler.activeWs && handler.activeSendFn) ? handler.createPluginInvokeSender() : null,
      isToolCallingEnabled: () => handler.enableToolCalling,
      getOpenAITools: () => (handler.enableToolCalling && toolManager.hasEnabledTools()) ? toolManager.toOpenAITools() : undefined,
      hasEnabledTools: () => toolManager.hasEnabledTools(),
      executeWithToolLoop: (request: LLMRequest, ctx: MessageContext) => {
        const provider = handler.getPrimaryProvider();
        if (!provider) throw new Error('未配置主 LLM Provider');
        // MessageContext 满足 Sendable 接口，无需 as any
        return handler.executeWithToolLoop(request, ctx, provider);
      },
      registerConnectedPlugins: (plugins: Array<{ pluginId: string; pluginName: string; capabilities: string[] }>) => {
        // 委托给 handler 插件的 registerConnectedPlugins 方法
        const handlerPlugin = agentPluginManager.getHandlerPlugin();
        if (handlerPlugin && 'registerConnectedPlugins' in handlerPlugin &&
            typeof (handlerPlugin as Record<string, unknown>).registerConnectedPlugins === 'function') {
          (handlerPlugin as unknown as { registerConnectedPlugins: (p: typeof plugins) => void }).registerConnectedPlugins(plugins);
          logger.info(`[AgentHandler] 已注册 ${plugins.length} 个前端插件到 handler 插件`);
        } else {
          logger.warn('[AgentHandler] 无 handler 插件或 handler 插件不支持 registerConnectedPlugins');
        }
      }
    };
  }

  // ==================== 状态访问 ====================

  public getModelInfo(): ModelInfo | null {
    return this.modelInfo;
  }

  public getCharacterInfo(): CharacterInfo | null {
    return this.characterInfo;
  }
}
