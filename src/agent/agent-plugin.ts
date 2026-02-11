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
 * 插件目录结构：
 *   agent-plugins/
 *     my-plugin/
 *       metadata.json     — 必须：{ name, author, desc, version }
 *       main.js           — 必须：导出 default class extends AgentPlugin
 *       _conf_schema.json — 可选：配置 Schema
 *       config.json       — 自动生成：持久化配置
 */

import { logger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { toolManager, type ToolSchema, type ToolHandler } from './tools';

// ==================== 类型定义 ====================

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
}

/** 插件上下文（传递给插件实例） */
export interface AgentPluginContext {
  /** 注册工具 */
  registerTool(schema: ToolSchema, handler: ToolHandler): void;
  /** 注销工具 */
  unregisterTool(toolName: string): void;
  /** 日志 */
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  /** 获取插件配置 */
  getConfig(): Record<string, unknown>;
  /** 保存插件配置 */
  saveConfig(config: Record<string, unknown>): void;
  /** 获取数据目录 */
  getDataPath(): string;
}

// ==================== 插件基类 ====================

/**
 * Agent 插件基类
 * 
 * 所有 Agent 插件都应继承此类并实现生命周期方法。
 */
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
  dirPath: string;
}

// ==================== 插件管理器 ====================

export class AgentPluginManager {
  private plugins: Map<string, PluginRecord> = new Map();
  private pluginsDir: string;

  constructor() {
    // 插件目录：应用根目录下的 agent-plugins/
    this.pluginsDir = path.join(app.getAppPath(), 'agent-plugins');
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

    // 3. 加载/创建配置文件
    const configPath = path.join(dirPath, 'config.json');
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
      dirPath
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

    record.instance = null;
    record.status = 'loaded';
    record.error = undefined;

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

    // 删除目录
    try {
      fs.rmSync(record.dirPath, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`删除插件目录失败: ${error}`);
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
        dirName: record.dirName
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
      dirName: record.dirName
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

    return {
      registerTool: (schema: ToolSchema, handler: ToolHandler) => {
        const toolId = `plugin_${pluginName}_${schema.name}`;
        toolManager.registerFunction(schema, handler, { id: toolId });
        record.registeredToolIds.push(toolId);
      },

      unregisterTool: (toolName: string) => {
        const toolId = `plugin_${pluginName}_${toolName}`;
        toolManager.unregister(toolId);
        record.registeredToolIds = record.registeredToolIds.filter(id => id !== toolId);
      },

      logger: {
        info: (msg: string) => logger.info(`[Plugin:${pluginName}] ${msg}`),
        warn: (msg: string) => logger.warn(`[Plugin:${pluginName}] ${msg}`),
        error: (msg: string) => logger.error(`[Plugin:${pluginName}] ${msg}`)
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
        const dataPath = path.join(record.dirPath, 'data');
        if (!fs.existsSync(dataPath)) {
          fs.mkdirSync(dataPath, { recursive: true });
        }
        return dataPath;
      }
    };
  }
}

/** 全局单例 */
export const agentPluginManager = new AgentPluginManager();
