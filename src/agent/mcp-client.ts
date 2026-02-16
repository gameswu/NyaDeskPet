/**
 * MCP (Model Context Protocol) 客户端
 * 参考 AstrBot 的 MCPClient + MCPTool 设计
 * 
 * 职责：
 * - 管理 MCP 服务器连接（stdio / SSE 传输）
 * - 发现并注册工具到 ToolManager
 * - 执行工具调用并返回结果
 * - 连接生命周期管理（自动重连）
 * 
 * 配置文件：appData/NyaDeskPet/data/mcp_servers.json
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { logger } from '../logger';
import { toolManager, type ToolResult, type ToolSchema } from './tools';

// ==================== 配置类型 ====================

/** MCP 服务器配置 */
export interface MCPServerConfig {
  /** 服务器唯一名称 */
  name: string;
  /** 传输类型 */
  transport: 'stdio' | 'sse';
  /** stdio 传输的命令（分平台） */
  command?: {
    darwin?: string[];
    linux?: string[];
    win32?: string[];
  };
  /** SSE 传输的 URL */
  url?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  workingDirectory?: string;
  /** 是否自动启动 */
  autoStart?: boolean;
  /** 是否启用 */
  enabled?: boolean;
  /** 描述 */
  description?: string;
}

/** MCP 服务器运行时状态 */
export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  error?: string;
  lastConnectedAt?: number;
}

// ==================== MCP 客户端 ====================

/**
 * 单个 MCP 服务器客户端
 * 参考 AstrBot 的 MCPClient
 */
class MCPConnection {
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | null = null;
  private config: MCPServerConfig;
  private _connected: boolean = false;
  private _toolCount: number = 0;
  private _error: string | undefined;
  private _lastConnectedAt: number | undefined;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  get connected(): boolean { return this._connected; }
  get toolCount(): number { return this._toolCount; }

  getStatus(): MCPServerStatus {
    return {
      name: this.config.name,
      connected: this._connected,
      toolCount: this._toolCount,
      error: this._error,
      lastConnectedAt: this._lastConnectedAt
    };
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<void> {
    if (this._connected) {
      logger.warn(`[MCP] ${this.config.name} 已连接`);
      return;
    }

    try {
      logger.info(`[MCP] 正在连接: ${this.config.name} (${this.config.transport})`);

      // 创建传输层
      if (this.config.transport === 'stdio') {
        this.transport = this.createStdioTransport();
      } else if (this.config.transport === 'sse') {
        this.transport = this.createSSETransport();
      } else {
        throw new Error(`不支持的传输类型: ${this.config.transport}`);
      }

      // 动态读取 package.json 版本
      let appVersion = '1.0.0';
      try {
        const pkgPath = require('path').join(require('electron').app.getAppPath(), 'package.json');
        appVersion = require(pkgPath).version || appVersion;
      } catch { /* 忽略 */ }

      this.client = new Client(
        {
          name: 'NyaDeskPet',
          version: appVersion
        },
        {
          capabilities: {}
        }
      );

      // 连接
      await this.client.connect(this.transport);
      this._connected = true;
      this._error = undefined;
      this._lastConnectedAt = Date.now();

      logger.info(`[MCP] 已连接: ${this.config.name}`);

      // 发现并注册工具
      await this.discoverAndRegisterTools();

    } catch (error) {
      this._connected = false;
      this._error = (error as Error).message;
      logger.error(`[MCP] 连接失败: ${this.config.name}`, { error: this._error });
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    // 注销该服务器的所有工具
    toolManager.unregisterMCPServer(this.config.name);
    this._toolCount = 0;

    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        logger.warn(`[MCP] 关闭客户端失败: ${this.config.name}`, { error: (error as Error).message });
      }
      this.client = null;
    }

    this.transport = null;
    this._connected = false;
    logger.info(`[MCP] 已断开: ${this.config.name}`);
  }

  /**
   * 调用工具（带重连机制）
   * 参考 AstrBot 的 call_tool_with_reconnect
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // 尝试调用
    try {
      return await this._callTool(name, args);
    } catch (error) {
      // 连接断开时尝试重连
      if (!this._connected) {
        logger.info(`[MCP] 工具调用失败，尝试重连: ${this.config.name}`);
        try {
          await this.disconnect();
          await this.connect();
          return await this._callTool(name, args);
        } catch (reconnectError) {
          return {
            toolCallId: '',
            content: `MCP 重连失败: ${(reconnectError as Error).message}`,
            success: false
          };
        }
      }
      return {
        toolCallId: '',
        content: `工具调用失败: ${(error as Error).message}`,
        success: false
      };
    }
  }

  private async _callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.client || !this._connected) {
      throw new Error(`MCP 服务器未连接: ${this.config.name}`);
    }

    const result = await this.client.callTool({ name, arguments: args });

    // 提取文本内容
    let content = '';
    if (result.content && Array.isArray(result.content)) {
      content = result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    } else if (typeof result.content === 'string') {
      content = result.content;
    }

    return {
      toolCallId: '',  // 由调用方设置
      content,
      success: !result.isError
    };
  }

  /**
   * 发现 MCP 服务器提供的工具并注册到 ToolManager
   * 参考 AstrBot 的 list_tools_and_save
   */
  private async discoverAndRegisterTools(): Promise<void> {
    if (!this.client) return;

    try {
      const toolsResult = await this.client.listTools();
      const tools = toolsResult.tools || [];

      logger.info(`[MCP] ${this.config.name} 提供 ${tools.length} 个工具`);

      for (const tool of tools) {
        const schema: ToolSchema = {
          name: tool.name,
          description: tool.description || '',
          parameters: (tool.inputSchema || { type: 'object', properties: {} }) as ToolSchema['parameters']
        };

        // 创建工具处理器（闭包引用当前连接）
        const handler = async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.callTool(tool.name, args);
        };

        toolManager.registerMCPTool(schema, this.config.name, handler);
      }

      this._toolCount = tools.length;
    } catch (error) {
      logger.error(`[MCP] 发现工具失败: ${this.config.name}`, { error: (error as Error).message });
    }
  }

  // ==================== 传输层创建 ====================

  private createStdioTransport(): StdioClientTransport {
    if (!this.config.command) {
      throw new Error('stdio 传输需要配置 command');
    }

    const platform = process.platform as 'darwin' | 'linux' | 'win32';
    const command = this.config.command[platform];
    if (!command || command.length === 0) {
      throw new Error(`当前平台 ${platform} 未配置 command`);
    }

    const [cmd, ...args] = command;

    // 解析工作目录
    let cwd: string | undefined;
    if (this.config.workingDirectory) {
      cwd = path.isAbsolute(this.config.workingDirectory)
        ? this.config.workingDirectory
        : path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), this.config.workingDirectory);
    }

    return new StdioClientTransport({
      command: cmd,
      args,
      env: { ...process.env, ...this.config.env } as Record<string, string>,
      cwd
    });
  }

  private createSSETransport(): SSEClientTransport {
    if (!this.config.url) {
      throw new Error('SSE 传输需要配置 url');
    }
    return new SSEClientTransport(new URL(this.config.url));
  }
}

// ==================== MCP 管理器 ====================

/**
 * MCP 管理器
 * 管理多个 MCP 服务器连接
 */
export class MCPManager {
  private connections: Map<string, MCPConnection> = new Map();
  private configs: MCPServerConfig[] = [];
  private configPath: string = '';

  /**
   * 初始化 MCP 管理器
   * 加载配置并自动连接标记了 autoStart 的服务器
   */
  async initialize(): Promise<void> {
    this.configPath = path.join(app.getPath('userData'), 'data', 'mcp_servers.json');

    // 加载配置
    this.loadConfigs();

    // 自动启动
    for (const config of this.configs) {
      if (config.autoStart && config.enabled !== false) {
        try {
          await this.connectServer(config.name);
        } catch (error) {
          logger.warn(`[MCPManager] 自动启动失败: ${config.name}`, { error: (error as Error).message });
        }
      }
    }
  }

  /**
   * 关闭所有连接
   */
  async terminate(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.values()).map(conn => conn.disconnect());
    await Promise.allSettled(disconnectPromises);
    this.connections.clear();
  }

  // ==================== 服务器管理 ====================

  /** 连接到指定服务器 */
  async connectServer(name: string): Promise<void> {
    const config = this.configs.find(c => c.name === name);
    if (!config) {
      throw new Error(`未找到 MCP 服务器配置: ${name}`);
    }

    // 如果已连接，先断开
    const existing = this.connections.get(name);
    if (existing) {
      await existing.disconnect();
    }

    const conn = new MCPConnection(config);
    await conn.connect();
    this.connections.set(name, conn);
  }

  /** 断开指定服务器 */
  async disconnectServer(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (conn) {
      await conn.disconnect();
      this.connections.delete(name);
    }
  }

  /** 获取所有服务器状态 */
  getServerStatuses(): MCPServerStatus[] {
    const statuses: MCPServerStatus[] = [];

    for (const config of this.configs) {
      const conn = this.connections.get(config.name);
      if (conn) {
        statuses.push(conn.getStatus());
      } else {
        statuses.push({
          name: config.name,
          connected: false,
          toolCount: 0
        });
      }
    }

    return statuses;
  }

  /** 获取所有服务器配置 */
  getConfigs(): MCPServerConfig[] {
    return [...this.configs];
  }

  /** 添加服务器配置 */
  addServerConfig(config: MCPServerConfig): void {
    // 检查名称唯一性
    const existing = this.configs.findIndex(c => c.name === config.name);
    if (existing >= 0) {
      this.configs[existing] = config;
    } else {
      this.configs.push(config);
    }
    this.saveConfigs();
  }

  /** 删除服务器配置 */
  async removeServerConfig(name: string): Promise<void> {
    // 先断开连接
    await this.disconnectServer(name);
    this.configs = this.configs.filter(c => c.name !== name);
    this.saveConfigs();
  }

  // ==================== 配置持久化 ====================

  private loadConfigs(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.configs = JSON.parse(data);
        logger.info(`[MCPManager] 已加载 ${this.configs.length} 个 MCP 服务器配置`);
      } else {
        this.configs = [];
        // 创建默认配置文件
        this.saveConfigs();
        logger.info('[MCPManager] 已创建空的 MCP 配置文件');
      }
    } catch (error) {
      logger.error('[MCPManager] 加载配置失败', { error: (error as Error).message });
      this.configs = [];
    }
  }

  private saveConfigs(): void {
    try {
      const dir = path.dirname(this.configPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.configs, null, 2), 'utf-8');
    } catch (error) {
      logger.error('[MCPManager] 保存配置失败', { error: (error as Error).message });
    }
  }
}

/** 全局 MCP 管理器实例 */
export const mcpManager = new MCPManager();
