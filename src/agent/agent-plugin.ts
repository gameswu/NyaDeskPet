/**
 * Agent 插件系统
 * 
 * 仿照 AstrBot 的插件架构设计，为内置 Agent 提供扩展能力。
 * 
 * 核心概念：
 * - AgentPluginMetadata：插件元信息（name, author, desc, version）
 * - AgentPlugin：插件基类，提供生命周期钩子
 * - AgentPluginManager：插件管理器，负责扫描、加载、启用/禁用
 * 
 * 插件源码目录（app.getAppPath()/agent-plugins/）：
 *   agent-plugins/
 *     my-plugin/
 *       metadata.json     — 必须：{ name, author, desc, version }
 *       main.js           — 必须：导出 default class extends AgentPlugin
 *       _conf_schema.json — 可选：配置 Schema
 * 
 * 插件持久化数据（app.getPath('userData')/data/agent-plugins/）：
 *   agent-plugins/
 *     my-plugin/
 *       config.json       — 自动生成：持久化配置
 *       data/             — 插件自由使用的数据目录
 */

import { logger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { toolManager, type ToolSchema, type ToolHandler, type OpenAIToolFormat } from './tools';
import { commandRegistry, type CommandDefinition, type CommandHandler } from './commands';
import { skillManager, type SkillSchema, type SkillHandler, type SkillInfo, type SkillResult, type SkillContext } from './skills';
import type { LLMRequest, LLMResponse } from './provider';
import type { SessionManager, OutgoingMessage } from './context';
import type { ModelInfo, CharacterInfo } from './handler';

// ==================== 类型定义 ====================

/** Provider 实例摘要信息（插件可见） */
export interface PluginProviderInfo {
  instanceId: string;
  providerId: string;
  displayName: string;
  enabled: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  isPrimary: boolean;
}

/** 插件元信息 */
export interface AgentPluginMetadata {
  /** 插件唯一名称 */
  name: string;
  /** 作者 */
  author: string;
  /** 描述 */
  desc: string;
  /** 版本号 */
  version: string;
  /** 仓库地址 */
  repo?: string;
  /** 入口文件（默认 main.js） */
  entry?: string;
  /** 是否为消息处理器插件（拦截 user_input、tap_event 等核心消息处理） */
  handlerPlugin?: boolean;
  /** 是否在加载后自动激活 */
  autoActivate?: boolean;
  /** 依赖的插件名称列表（将按顺序在此插件之前激活） */
  dependencies?: string[];
  /** 国际化（可选，按 locale 提供 desc 的翻译） */
  i18n?: Record<string, { desc?: string }>;
}

/** 插件配置 Schema 字段 */
export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  default?: unknown;
  options?: { value: string; label: string }[];
}

/** 插件配置 Schema */
export type PluginConfigSchema = Record<string, PluginConfigField>;

/** 插件运行时状态 */
export type AgentPluginStatus = 'loaded' | 'active' | 'error' | 'disabled';

/** 插件运行时信息（供 UI 展示） */
export interface AgentPluginInfo {
  name: string;
  author: string;
  desc: string;
  version: string;
  repo?: string;
  status: AgentPluginStatus;
  error?: string;
  configSchema?: PluginConfigSchema;
  config?: Record<string, unknown>;
  toolCount: number;
  dirName: string;
  /** 国际化 */
  i18n?: Record<string, { desc?: string }>;
}

/** 插件上下文（传递给插件实例） */
/** 插件调用发送器（发送 plugin_invoke 到前端，等待 plugin_response） */
export type PluginInvokeSender = (
  pluginId: string,
  action: string,
  params: Record<string, unknown>,
  timeout?: number
) => Promise<{ success: boolean; result?: unknown; error?: string }>;

export interface AgentPluginContext {
  /** 注册工具 */
  registerTool(schema: ToolSchema, handler: ToolHandler): void;
  /** 注销工具 */
  unregisterTool(toolName: string): void;
  /** 注册斜杠指令 */
  registerCommand(definition: CommandDefinition, handler: CommandHandler): void;
  /** 注销斜杠指令 */
  unregisterCommand(commandName: string): void;
  /** 日志 */
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
  };
  /** 获取插件配置 */
  getConfig(): Record<string, unknown>;
  /** 保存插件配置 */
  saveConfig(config: Record<string, unknown>): void;
  /** 获取数据目录 */
  getDataPath(): string;

  // ====== Provider 访问能力（多 LLM 编排） ======

  /** 获取所有 Provider 实例信息 */
  getProviders(): PluginProviderInfo[];
  /** 获取主 LLM 的 instanceId */
  getPrimaryProviderId(): string;
  /**
   * 调用指定 Provider 实例进行 LLM 对话
   * @param instanceId Provider 实例 ID。传入 'primary' 可自动使用主 LLM
   * @param request LLM 请求参数
   * @returns LLM 响应
   */
  callProvider(instanceId: string, request: LLMRequest): Promise<LLMResponse>;

  // ====== Handler 插件扩展能力 ======

  /** 获取会话管理器 */
  getSessions(): SessionManager;
  /** 获取当前模型信息 */
  getModelInfo(): ModelInfo | null;
  /** 获取当前角色信息 */
  getCharacterInfo(): CharacterInfo | null;
  /** 使用主 TTS Provider 合成音频并流式推送到前端 */
  synthesizeAndStream(text: string, ctx: MessageContext): Promise<void>;
  /** 是否有已连接的 TTS Provider */
  hasTTS(): boolean;
  /** 获取插件调用发送器（用于调用前端插件） */
  getPluginInvokeSender(): PluginInvokeSender | null;
  /** 工具系统是否启用 */
  isToolCallingEnabled(): boolean;
  /** 获取 OpenAI 格式的工具列表 */
  getOpenAITools(): OpenAIToolFormat[] | undefined;
  /** 检查是否有已注册工具 */
  hasEnabledTools(): boolean;
  /** 获取其他插件的实例（用于插件间服务调用） */
  getPluginInstance(pluginName: string): AgentPlugin | null;
  /** 执行含工具循环的 LLM 调用（自动处理 tool_calls → 执行 → 继续） */
  executeWithToolLoop(request: LLMRequest, ctx: MessageContext): Promise<LLMResponse>;

  // ====== Skills 技能系统 ======

  /** 注册技能 */
  registerSkill(schema: SkillSchema, handler: SkillHandler): void;
  /** 注销技能 */
  unregisterSkill(skillName: string): void;
  /** 调用技能 */
  invokeSkill(skillName: string, params: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult>;
  /** 获取所有技能信息 */
  listSkills(): SkillInfo[];
}

// ==================== 插件基类 ====================

/**
 * Agent 插件基类
 * 
 * 所有 Agent 插件都应继承此类并实现生命周期方法。
 */
/**
 * 消息上下文（传递给插件的消息处理钩子）
 * 提供消息相关操作，如添加回复、发送消息等
 */
export interface MessageContext {
  /** 原始消息 */
  message: { type: string; text?: string; data?: unknown; timestamp?: number };
  /** 会话 ID */
  sessionId: string;
  /** 添加回复到缓冲（Respond 阶段统一发送） */
  addReply(msg: OutgoingMessage): void;
  /** 立即发送消息（不经过缓冲，用于流式场景） */
  send(msg: object): void;
  /** WebSocket 连接引用 */
  ws: import('ws').WebSocket;
}

export abstract class AgentPlugin {
  /** 插件上下文 */
  protected ctx!: AgentPluginContext;

  /** 设置上下文（内部使用） */
  _setContext(ctx: AgentPluginContext): void {
    this.ctx = ctx;
  }

  /** 初始化（插件加载后调用） */
  async initialize(): Promise<void> {}

  /** 销毁（插件卸载前调用） */
  async terminate(): Promise<void> {}

  // ====== 消息处理钩子（handlerPlugin 专用） ======
  // 返回 true 表示已处理，handler 不再执行默认逻辑
  // 返回 false 或不实现则 handler 执行默认逻辑

  /** 处理用户文本输入 */
  async onUserInput?(mctx: MessageContext): Promise<boolean>;

  /** 处理触碰事件 */
  async onTapEvent?(mctx: MessageContext): Promise<boolean>;

  /** 处理文件上传 */
  async onFileUpload?(mctx: MessageContext): Promise<boolean>;

  /** 处理模型信息更新 */
  onModelInfo?(mctx: MessageContext): boolean;

  /** 处理角色信息更新 */
  onCharacterInfo?(mctx: MessageContext): boolean;

  /** 处理插件响应 */
  onPluginResponse?(mctx: MessageContext): boolean;

  /** 处理前端插件主动发送的消息 */
  async onPluginMessage?(mctx: MessageContext): Promise<boolean>;
}

// ==================== 内部记录 ====================

interface PluginRecord {
  metadata: AgentPluginMetadata;
  instance: AgentPlugin | null;
  status: AgentPluginStatus;
  error?: string;
  configSchema?: PluginConfigSchema;
  config: Record<string, unknown>;
  configPath: string;
  registeredToolIds: string[];
  dirName: string;
  /** 插件源码目录（metadata.json、main.js 所在） */
  dirPath: string;
  /** 插件持久化数据目录（config.json、data/ 所在，位于 userData 下） */
  dataDir: string;
}

// ==================== 插件管理器 ====================

/** Provider 访问器接口（用于解耦 handler 依赖） */
export interface ProviderAccessor {
  /** 获取所有 Provider 实例摘要 */
  getAllProviders(): PluginProviderInfo[];
  /** 获取主 LLM 的 instanceId */
  getPrimaryId(): string;
  /** 调用指定 Provider 实例 */
  callProvider(instanceId: string, request: LLMRequest): Promise<LLMResponse>;
}

/** Handler 访问器接口（为 handlerPlugin 提供深度访问） */
export interface HandlerAccessor {
  /** 获取会话管理器 */
  getSessions(): SessionManager;
  /** 获取模型信息 */
  getModelInfo(): ModelInfo | null;
  /** 获取角色信息 */
  getCharacterInfo(): CharacterInfo | null;
  /** TTS 合成并推流 */
  synthesizeAndStream(text: string, ctx: MessageContext): Promise<void>;
  /** 是否有可用的 TTS Provider */
  hasTTS(): boolean;
  /** 获取插件调用发送器 */
  getPluginInvokeSender(): PluginInvokeSender | null;
  /** 是否启用了工具调用 */
  isToolCallingEnabled(): boolean;
  /** 获取 OpenAI 格式的工具列表 */
  getOpenAITools(): OpenAIToolFormat[] | undefined;
  /** 是否有已注册的工具 */
  hasEnabledTools(): boolean;
  /** 执行含工具循环的 LLM 调用 */
  executeWithToolLoop(request: LLMRequest, ctx: MessageContext): Promise<LLMResponse>;
  /** 注册已连接的前端插件（触发 plugin-tool-bridge 工具注册） */
  registerConnectedPlugins(plugins: Array<{ pluginId: string; pluginName: string; capabilities: string[] }>): void;
}

export class AgentPluginManager {
  private plugins: Map<string, PluginRecord> = new Map();
  /** 插件源码目录 */
  private pluginsDir: string;
  /** 插件持久化数据根目录 */
  private pluginsDataDir: string;
  /** Provider 访问器（由外部注入，避免循环依赖） */
  private providerAccessor: ProviderAccessor | null = null;
  /** Handler 访问器（由外部注入，为 handlerPlugin 提供深度访问） */
  private handlerAccessor: HandlerAccessor | null = null;
  /** 当前激活的 handler 插件名称 */
  private activeHandlerPluginName: string | null = null;

  constructor() {
    // 插件源码目录：asarUnpack 物理路径，确保原生文件操作可达
    this.pluginsDir = path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'agent-plugins');
    // 插件持久化数据目录：userData/data/agent-plugins/
    this.pluginsDataDir = path.join(app.getPath('userData'), 'data', 'agent-plugins');
  }

  /**
   * 注入 Provider 访问器
   * 应在 AgentHandler 初始化完成后调用，为插件提供访问多个 LLM Provider 的能力
   */
  setProviderAccessor(accessor: ProviderAccessor): void {
    this.providerAccessor = accessor;
    logger.info('[AgentPluginManager] Provider 访问器已注入');
  }

  /**
   * 注入 Handler 访问器
   * 为 handlerPlugin 提供会话管理、TTS、插件调用等深度访问能力
   */
  setHandlerAccessor(accessor: HandlerAccessor): void {
    this.handlerAccessor = accessor;
    logger.info('[AgentPluginManager] Handler 访问器已注入');
  }

  /**
   * 获取当前激活的 handler 插件实例
   * handler 会调用此方法来委托消息处理
   */
  getHandlerPlugin(): AgentPlugin | null {
    if (!this.activeHandlerPluginName) return null;
    const record = this.plugins.get(this.activeHandlerPluginName);
    if (!record || record.status !== 'active' || !record.instance) return null;
    return record.instance;
  }

  /**
   * 获取指定插件实例（用于插件间服务调用）
   */
  getPluginInstance(name: string): AgentPlugin | null {
    const record = this.plugins.get(name);
    if (!record || record.status !== 'active' || !record.instance) return null;
    return record.instance;
  }

  /**
   * 扫描并加载所有插件
   */
  async loadAll(): Promise<void> {
    // 确保插件目录存在
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      logger.info(`[AgentPluginManager] 创建插件目录: ${this.pluginsDir}`);
    }
    // 确保持久化数据目录存在
    if (!fs.existsSync(this.pluginsDataDir)) {
      fs.mkdirSync(this.pluginsDataDir, { recursive: true });
      logger.info(`[AgentPluginManager] 创建插件数据目录: ${this.pluginsDataDir}`);
    }

    const dirs = fs.readdirSync(this.pluginsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dirName of dirs) {
      try {
        await this.loadPlugin(dirName);
      } catch (error) {
        logger.error(`[AgentPluginManager] 加载插件 ${dirName} 失败: ${error}`);
      }
    }

    logger.info(`[AgentPluginManager] 已加载 ${this.plugins.size} 个插件`);

    // 自动激活标记了 autoActivate 的插件（按依赖顺序）
    await this.autoActivatePlugins();
  }

  /**
   * 自动激活标记了 autoActivate 的插件
   * 按依赖关系排序，确保被依赖的插件先激活
   */
  private async autoActivatePlugins(): Promise<void> {
    // 收集需要自动激活的插件
    const toActivate: string[] = [];
    for (const [name, record] of this.plugins) {
      if (record.metadata.autoActivate && record.status !== 'active') {
        toActivate.push(name);
      }
    }

    if (toActivate.length === 0) return;

    // 拓扑排序：按依赖关系确定激活顺序
    let sorted: string[];
    try {
      sorted = this.topologicalSort(toActivate);
    } catch (error) {
      logger.error(`[AgentPluginManager] 插件依赖排序失败: ${error}`);
      // 循环依赖时回退到原始顺序，尽力激活
      sorted = toActivate;
    }

    for (const name of sorted) {
      try {
        await this.activatePlugin(name);
        logger.info(`[AgentPluginManager] 自动激活插件: ${name}`);
      } catch (error) {
        logger.error(`[AgentPluginManager] 自动激活插件 ${name} 失败: ${error}`);
      }
    }
  }

  /**
   * 拓扑排序：按依赖关系排序插件名称
   * 使用 visiting 集合检测循环依赖（DFS 灰白黑三色标记法）
   */
  private topologicalSort(names: string[]): string[] {
    const nameSet = new Set(names);
    const visited = new Set<string>();   // 已完成（黑色）
    const visiting = new Set<string>();  // 正在访问（灰色，用于检测环）
    const result: string[] = [];

    const visit = (name: string, chain: string[]) => {
      if (visited.has(name)) return;

      if (visiting.has(name)) {
        // 检测到循环依赖：chain 中从 name 开始到当前形成环
        const cycleStart = chain.indexOf(name);
        const cycle = chain.slice(cycleStart).concat(name);
        logger.error(`[AgentPluginManager] 检测到循环依赖: ${cycle.join(' → ')}`);
        throw new Error(`插件循环依赖: ${cycle.join(' → ')}`);
      }

      visiting.add(name);

      // 获取依赖
      const record = this.plugins.get(name);
      if (record?.metadata.dependencies) {
        for (const dep of record.metadata.dependencies) {
          if (nameSet.has(dep)) {
            visit(dep, [...chain, name]);
          }
        }
      }

      visiting.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const name of names) {
      visit(name, []);
    }

    return result;
  }

  /**
   * 加载单个插件
   */
  async loadPlugin(dirName: string): Promise<void> {
    const dirPath = path.join(this.pluginsDir, dirName);

    // 1. 读取 metadata.json
    const metadataPath = path.join(dirPath, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      logger.warn(`[AgentPluginManager] 插件 ${dirName} 缺少 metadata.json，跳过`);
      return;
    }

    let metadata: AgentPluginMetadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch (error) {
      logger.error(`[AgentPluginManager] 解析 ${dirName}/metadata.json 失败: ${error}`);
      return;
    }

    if (!metadata.name || !metadata.author || !metadata.desc || !metadata.version) {
      logger.error(`[AgentPluginManager] 插件 ${dirName} 元信息不完整 (需要 name, author, desc, version)`);
      return;
    }

    // 2. 读取配置 Schema（可选）
    let configSchema: PluginConfigSchema | undefined;
    const schemaPath = path.join(dirPath, '_conf_schema.json');
    if (fs.existsSync(schemaPath)) {
      try {
        configSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      } catch {
        logger.warn(`[AgentPluginManager] 解析 ${dirName}/_conf_schema.json 失败`);
      }
    }

    // 3. 加载/创建配置文件（持久化数据目录）
    const dataDir = path.join(this.pluginsDataDir, dirName);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const configPath = path.join(dataDir, 'config.json');
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        logger.warn(`[AgentPluginManager] 解析 ${dirName}/config.json 失败，使用默认配置`);
      }
    }

    // 如果有 schema，填充默认值
    if (configSchema) {
      for (const [key, field] of Object.entries(configSchema)) {
        if (config[key] === undefined && field.default !== undefined) {
          config[key] = field.default;
        }
      }
    }

    // 4. 创建插件记录
    const record: PluginRecord = {
      metadata,
      instance: null,
      status: 'loaded',
      configSchema,
      config,
      configPath,
      registeredToolIds: [],
      dirName,
      dirPath,
      dataDir
    };

    this.plugins.set(metadata.name, record);
    logger.info(`[AgentPluginManager] 已加载插件: ${metadata.name} v${metadata.version} by ${metadata.author}`);
  }

  /**
   * 激活插件（实例化并调用 initialize）
   */
  async activatePlugin(name: string): Promise<void> {
    const record = this.plugins.get(name);
    if (!record) throw new Error(`插件 ${name} 不存在`);
    if (record.status === 'active') return;

    try {
      // 动态导入插件模块
      const entryFile = record.metadata.entry || 'main.js';
      const entryPath = path.join(record.dirPath, entryFile);

      if (!fs.existsSync(entryPath)) {
        throw new Error(`入口文件不存在: ${entryFile}`);
      }

      // 清除 require 缓存以支持热重载
      const resolvedPath = require.resolve(entryPath);
      delete require.cache[resolvedPath];

      const pluginModule = require(entryPath);
      const PluginClass = pluginModule.default || pluginModule;

      if (typeof PluginClass !== 'function') {
        throw new Error('插件入口必须导出一个类');
      }

      const instance: AgentPlugin = new PluginClass();

      // 创建插件上下文
      const ctx = this.createContext(record);
      instance._setContext(ctx);

      // 调用 initialize
      await instance.initialize();

      record.instance = instance;
      record.status = 'active';
      record.error = undefined;

      // 如果是 handler 插件，记录为当前活跃的 handler 插件
      if (record.metadata.handlerPlugin) {
        this.activeHandlerPluginName = name;
        logger.info(`[AgentPluginManager] 已设置 handler 插件: ${name}`);
      }

      logger.info(`[AgentPluginManager] 插件 ${name} 已激活`);
    } catch (error) {
      record.status = 'error';
      record.error = String(error);
      logger.error(`[AgentPluginManager] 激活插件 ${name} 失败: ${error}`);
      throw error;
    }
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(name: string): Promise<void> {
    const record = this.plugins.get(name);
    if (!record) throw new Error(`插件 ${name} 不存在`);
    if (record.status !== 'active') return;

    try {
      // 调用 terminate
      if (record.instance) {
        await record.instance.terminate();
      }
    } catch (error) {
      logger.warn(`[AgentPluginManager] 插件 ${name} 终止时出错: ${error}`);
    }

    // 注销该插件注册的所有工具
    for (const toolId of record.registeredToolIds) {
      toolManager.unregister(toolId);
    }
    record.registeredToolIds = [];

    // 注销该插件注册的所有指令
    commandRegistry.unregisterBySource(name);

    record.instance = null;
    record.status = 'loaded';
    record.error = undefined;

    // 如果停用的是 handler 插件，清除跟踪
    if (this.activeHandlerPluginName === name) {
      this.activeHandlerPluginName = null;
      logger.info(`[AgentPluginManager] handler 插件已清除: ${name}`);
    }

    logger.info(`[AgentPluginManager] 插件 ${name} 已停用`);
  }

  /**
   * 重新加载插件
   */
  async reloadPlugin(name: string): Promise<void> {
    const record = this.plugins.get(name);
    if (!record) throw new Error(`插件 ${name} 不存在`);

    const wasActive = record.status === 'active';

    if (wasActive) {
      await this.deactivatePlugin(name);
    }

    // 重新读取元信息和配置
    this.plugins.delete(name);
    await this.loadPlugin(record.dirName);

    if (wasActive) {
      await this.activatePlugin(name);
    }
  }

  /**
   * 卸载插件
   */
  async uninstallPlugin(name: string): Promise<void> {
    const record = this.plugins.get(name);
    if (!record) throw new Error(`插件 ${name} 不存在`);

    // 先停用
    if (record.status === 'active') {
      await this.deactivatePlugin(name);
    }

    // 删除插件源码目录
    try {
      fs.rmSync(record.dirPath, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`删除插件目录失败: ${error}`);
    }

    // 删除插件持久化数据目录
    try {
      if (fs.existsSync(record.dataDir)) {
        fs.rmSync(record.dataDir, { recursive: true, force: true });
      }
    } catch (error) {
      logger.warn(`[AgentPluginManager] 删除插件数据目录失败: ${error}`);
    }

    this.plugins.delete(name);
    logger.info(`[AgentPluginManager] 插件 ${name} 已卸载`);
  }

  /**
   * 获取所有插件信息（供 UI 展示）
   */
  getAllPlugins(): AgentPluginInfo[] {
    const result: AgentPluginInfo[] = [];
    for (const [, record] of this.plugins) {
      result.push({
        name: record.metadata.name,
        author: record.metadata.author,
        desc: record.metadata.desc,
        version: record.metadata.version,
        repo: record.metadata.repo,
        status: record.status,
        error: record.error,
        configSchema: record.configSchema,
        config: { ...record.config },
        toolCount: record.registeredToolIds.length,
        dirName: record.dirName,
        i18n: record.metadata.i18n
      });
    }
    return result;
  }

  /**
   * 获取单个插件信息
   */
  getPlugin(name: string): AgentPluginInfo | null {
    const record = this.plugins.get(name);
    if (!record) return null;
    return {
      name: record.metadata.name,
      author: record.metadata.author,
      desc: record.metadata.desc,
      version: record.metadata.version,
      repo: record.metadata.repo,
      status: record.status,
      error: record.error,
      configSchema: record.configSchema,
      config: { ...record.config },
      toolCount: record.registeredToolIds.length,
      dirName: record.dirName,
      i18n: record.metadata.i18n
    };
  }

  /**
   * 更新插件配置
   */
  savePluginConfig(name: string, config: Record<string, unknown>): void {
    const record = this.plugins.get(name);
    if (!record) throw new Error(`插件 ${name} 不存在`);

    record.config = { ...config };
    // 持久化
    try {
      fs.writeFileSync(record.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`保存配置失败: ${error}`);
    }
  }

  /**
   * 获取插件目录路径
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /**
   * 获取插件持久化数据目录路径
   */
  getPluginDataDir(name: string): string {
    const record = this.plugins.get(name);
    if (!record) throw new Error(`插件 ${name} 不存在`);
    return record.dataDir;
  }

  /**
   * 清除插件持久化数据（保留 config.json）
   */
  clearPluginData(name: string): void {
    const record = this.plugins.get(name);
    if (!record) throw new Error(`插件 ${name} 不存在`);

    if (!fs.existsSync(record.dataDir)) return;

    // 备份 config.json
    let configBackup: string | null = null;
    if (fs.existsSync(record.configPath)) {
      configBackup = fs.readFileSync(record.configPath, 'utf-8');
    }

    // 清除整个数据目录
    fs.rmSync(record.dataDir, { recursive: true, force: true });
    fs.mkdirSync(record.dataDir, { recursive: true });

    // 恢复 config.json
    if (configBackup !== null) {
      fs.writeFileSync(record.configPath, configBackup, 'utf-8');
    }

    logger.info(`[AgentPluginManager] 已清除插件 ${name} 的数据目录: ${record.dataDir}`);
  }

  /**
   * 销毁所有插件
   */
  async destroyAll(): Promise<void> {
    for (const [name] of this.plugins) {
      try {
        await this.deactivatePlugin(name);
      } catch {
        // ignore
      }
    }
    this.plugins.clear();
  }

  // ==================== 私有方法 ====================

  /**
   * 创建插件上下文
   */
  private createContext(record: PluginRecord): AgentPluginContext {
    const pluginName = record.metadata.name;
    const manager = this;

    return {
      registerTool: (schema: ToolSchema, handler: ToolHandler) => {
        const toolId = `plugin_${pluginName}_${schema.name}`;
        toolManager.registerFunction(schema, handler, { id: toolId, source: 'plugin' });
        record.registeredToolIds.push(toolId);
      },

      unregisterTool: (toolName: string) => {
        const toolId = `plugin_${pluginName}_${toolName}`;
        toolManager.unregister(toolId);
        record.registeredToolIds = record.registeredToolIds.filter(id => id !== toolId);
      },

      registerCommand: (definition: CommandDefinition, handler: CommandHandler) => {
        commandRegistry.register(definition, handler, pluginName);
      },

      unregisterCommand: (commandName: string) => {
        commandRegistry.unregister(commandName);
      },

      logger: {
        info: (msg: string) => logger.info(`[Plugin:${pluginName}] ${msg}`),
        warn: (msg: string) => logger.warn(`[Plugin:${pluginName}] ${msg}`),
        error: (msg: string) => logger.error(`[Plugin:${pluginName}] ${msg}`),
        debug: (msg: string) => logger.debug(`[Plugin:${pluginName}] ${msg}`)
      },

      getConfig: () => ({ ...record.config }),

      saveConfig: (config: Record<string, unknown>) => {
        record.config = { ...config };
        try {
          fs.writeFileSync(record.configPath, JSON.stringify(config, null, 2), 'utf-8');
        } catch (error) {
          logger.error(`[Plugin:${pluginName}] 保存配置失败: ${error}`);
        }
      },

      getDataPath: () => {
        const dataPath = path.join(record.dataDir, 'data');
        if (!fs.existsSync(dataPath)) {
          fs.mkdirSync(dataPath, { recursive: true });
        }
        return dataPath;
      },

      // ====== Provider 访问能力 ======

      getProviders: (): PluginProviderInfo[] => {
        if (!manager.providerAccessor) {
          logger.warn(`[Plugin:${pluginName}] Provider 访问器未注入，无法获取 Provider 列表`);
          return [];
        }
        return manager.providerAccessor.getAllProviders();
      },

      getPrimaryProviderId: (): string => {
        if (!manager.providerAccessor) {
          logger.warn(`[Plugin:${pluginName}] Provider 访问器未注入`);
          return '';
        }
        return manager.providerAccessor.getPrimaryId();
      },

      callProvider: async (instanceId: string, request: LLMRequest): Promise<LLMResponse> => {
        if (!manager.providerAccessor) {
          throw new Error('Provider 访问器未注入，无法调用 LLM');
        }
        logger.info(`[Plugin:${pluginName}] 调用 Provider: ${instanceId}`);
        return manager.providerAccessor.callProvider(instanceId, request);
      },

      // ====== Handler 扩展能力（handlerPlugin 专用） ======

      getSessions: (): SessionManager => {
        if (!manager.handlerAccessor) {
          throw new Error('Handler 访问器未注入');
        }
        return manager.handlerAccessor.getSessions();
      },

      getModelInfo: () => {
        return manager.handlerAccessor?.getModelInfo() ?? null;
      },

      getCharacterInfo: () => {
        return manager.handlerAccessor?.getCharacterInfo() ?? null;
      },

      synthesizeAndStream: async (text: string, ctx: MessageContext): Promise<void> => {
        if (!manager.handlerAccessor) {
          throw new Error('Handler 访问器未注入');
        }
        return manager.handlerAccessor.synthesizeAndStream(text, ctx);
      },

      hasTTS: (): boolean => {
        return manager.handlerAccessor?.hasTTS() ?? false;
      },

      getPluginInvokeSender: (): PluginInvokeSender | null => {
        return manager.handlerAccessor?.getPluginInvokeSender() ?? null;
      },

      isToolCallingEnabled: (): boolean => {
        return manager.handlerAccessor?.isToolCallingEnabled() ?? false;
      },

      getOpenAITools: (): OpenAIToolFormat[] | undefined => {
        return manager.handlerAccessor?.getOpenAITools();
      },

      hasEnabledTools: (): boolean => {
        return manager.handlerAccessor?.hasEnabledTools() ?? false;
      },

      // ====== 插件间协作 ======

      getPluginInstance: (name: string): AgentPlugin | null => {
        return manager.getPluginInstance(name);
      },

      executeWithToolLoop: async (request: LLMRequest, ctx: MessageContext): Promise<LLMResponse> => {
        if (!manager.handlerAccessor) {
          throw new Error('Handler 访问器未注入，无法执行工具循环');
        }
        return manager.handlerAccessor.executeWithToolLoop(request, ctx);
      },

      // ====== Skills 技能系统 ======

      registerSkill: (schema: SkillSchema, handler: SkillHandler) => {
        skillManager.register(schema, handler, pluginName);
      },

      unregisterSkill: (skillName: string) => {
        skillManager.unregister(skillName);
      },

      invokeSkill: async (skillName: string, params: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult> => {
        return skillManager.invoke(skillName, params, ctx);
      },

      listSkills: (): SkillInfo[] => {
        return skillManager.list();
      },
    };
  }
}

/** 全局单例 */
export const agentPluginManager = new AgentPluginManager();
