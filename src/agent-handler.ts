/**
 * Agent 消息处理器
 * 处理所有业务逻辑，与服务器传输层完全分离
 * 
 * 职责：
 * - 处理前端发来的各类消息（user_input, model_info, tap_event 等）
 * - 生成响应并通过 AgentServer 发送回前端
 * - 管理对话上下文和状态
 * 
 * 扩展指南：
 * - 在 handleMessage() 的 switch 中添加新的消息类型处理
 * - 在 handleUserInput() 中集成 AI 服务（LLM API 等）
 * - 添加新的私有方法来实现特定功能
 */

import { WebSocket } from 'ws';
import { logger } from './logger';
import type { AgentServer } from './agent-server';

// 消息类型定义
interface IncomingMessage {
  type: string;
  text?: string;
  data?: any;
  timestamp?: number;
  action?: string;
  position?: { x: number; y: number };
}

interface ModelInfo {
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

interface CharacterInfo {
  useCustom: boolean;
  name?: string;
  personality?: string;
}

interface TapEventData {
  hitArea: string;
  position: { x: number; y: number };
  timestamp: number;
}

export class AgentHandler {
  private server: AgentServer;
  private modelInfo: ModelInfo | null = null;
  private characterInfo: CharacterInfo | null = null;

  constructor(server: AgentServer) {
    this.server = server;
  }

  /**
   * 处理收到的消息（主入口）
   */
  public handleMessage(message: IncomingMessage, ws: WebSocket): void {
    switch (message.type) {
      case 'user_input':
        this.handleUserInput(message.text || '', ws);
        break;
      
      case 'model_info':
        this.handleModelInfo(message.data as ModelInfo, ws);
        break;

      case 'tap_event':
        this.handleTapEvent(message.data as TapEventData, ws);
        break;

      case 'character_info':
        this.handleCharacterInfo(message.data as CharacterInfo, ws);
        break;

      case 'interaction':
        this.handleInteraction(message, ws);
        break;

      case 'file_upload':
        this.handleFileUpload(message.data, ws);
        break;

      case 'plugin_response':
        this.handlePluginResponse(message.data, ws);
        break;

      default:
        logger.debug(`[AgentHandler] 未处理的消息类型: ${message.type}`);
    }
  }

  /**
   * 处理用户文本输入
   * TODO: 在此集成 LLM API（OpenAI、Anthropic 等）
   */
  private handleUserInput(text: string, ws: WebSocket): void {
    logger.info(`[AgentHandler] 用户输入: ${text}`);

    // === 框架占位逻辑 ===
    // 目前仅回显消息，后续可替换为 LLM 调用
    const response = {
      type: 'dialogue',
      data: {
        text: `[内置Agent] 收到消息: "${text}"`,
        duration: 5000
      }
    };

    this.server.sendTo(ws, response);
  }

  /**
   * 处理模型信息
   */
  private handleModelInfo(data: ModelInfo, _ws: WebSocket): void {
    this.modelInfo = data;
    logger.info('[AgentHandler] 已接收模型信息', {
      motions: Object.keys(data.motions || {}),
      expressions: data.expressions,
      hitAreas: data.hitAreas,
      paramCount: data.availableParameters?.length || 0
    });
  }

  /**
   * 处理触碰事件
   */
  private handleTapEvent(data: TapEventData, ws: WebSocket): void {
    logger.info(`[AgentHandler] 触碰事件: ${data.hitArea}`);

    // === 框架占位逻辑 ===
    // 根据触碰部位返回不同反应
    const reactions: Record<string, string> = {
      'Head': '头被摸了喵~',
      'Body': '不要乱摸喵！',
      'Face': '脸好痒喵~'
    };

    const text = reactions[data.hitArea] || '被点到了喵~';

    this.server.sendTo(ws, {
      type: 'dialogue',
      data: { text, duration: 3000 }
    });
  }

  /**
   * 处理角色信息
   */
  private handleCharacterInfo(data: CharacterInfo, _ws: WebSocket): void {
    this.characterInfo = data;
    logger.info('[AgentHandler] 已接收角色信息', {
      useCustom: data.useCustom,
      name: data.name
    });
  }

  /**
   * 处理交互事件（点击等）
   */
  private handleInteraction(message: IncomingMessage, _ws: WebSocket): void {
    logger.debug('[AgentHandler] 交互事件:', message.action);
  }

  /**
   * 处理文件上传
   */
  private handleFileUpload(data: any, ws: WebSocket): void {
    logger.info(`[AgentHandler] 收到文件: ${data?.fileName}`);

    this.server.sendTo(ws, {
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
  private handlePluginResponse(data: any, _ws: WebSocket): void {
    logger.info(`[AgentHandler] 插件响应: ${data?.pluginId} - ${data?.action}`);
    // TODO: 根据插件响应结果执行后续逻辑
  }

  /**
   * 获取当前模型信息
   */
  public getModelInfo(): ModelInfo | null {
    return this.modelInfo;
  }

  /**
   * 获取当前角色信息
   */
  public getCharacterInfo(): CharacterInfo | null {
    return this.characterInfo;
  }
}
