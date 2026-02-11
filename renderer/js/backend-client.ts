/**
 * 后端客户端
 * 负责与后端 Agent 服务器通信
 */

import type { 
  BackendClient as IBackendClient, 
  BackendConfig, 
  BackendMessage,
  DialogueData,
  AudioStreamStartData,
  AudioChunkData,
  AudioStreamEndData,
  Live2DCommandData,
  TimelineItem,
  CharacterInfo
} from '../types/global';

class BackendClient implements IBackendClient {
  public httpUrl: string;
  public wsUrl: string;
  public ws: WebSocket | null;
  public reconnectInterval: number;
  public reconnectTimer: number | null;
  public isConnecting: boolean;
  public messageHandlers: Array<(message: BackendMessage) => void>;
  public statusIndicator: HTMLElement | null;

  constructor(config: BackendConfig = {}) {
    this.httpUrl = config.httpUrl || 'http://localhost:8000';
    this.wsUrl = config.wsUrl || 'ws://localhost:8000/ws';
    this.ws = null;
    this.reconnectInterval = 5000;
    this.reconnectTimer = null;
    this.isConnecting = false;
    this.messageHandlers = [];
    this.statusIndicator = document.getElementById('status-indicator');
  }

  /**
   * 初始化连接
   */
  public async initialize(): Promise<boolean> {
    // 从设置管理器更新URL
    if (window.settingsManager) {
      const settings = window.settingsManager.getSettings();
      
      if (settings.backendMode === 'builtin') {
        // 内置后端模式：使用内置 Agent 的 URL
        try {
          const urls = await window.electronAPI.agentGetUrl();
          this.httpUrl = urls.httpUrl;
          this.wsUrl = urls.wsUrl;
          window.logger.info('[BackendClient] 使用内置 Agent:', this.wsUrl);
        } catch (error) {
          window.logger.error('[BackendClient] 获取内置 Agent URL 失败，使用默认配置:', error);
          this.httpUrl = settings.backendUrl;
          this.wsUrl = settings.wsUrl;
        }
      } else {
        // 自定义链接模式：使用用户配置的 URL
        this.httpUrl = settings.backendUrl;
        this.wsUrl = settings.wsUrl;
        window.logger.info('[BackendClient] 使用自定义链接:', this.wsUrl);
      }
    }
    
    await this.connectWebSocket();
    return true;
  }

  /**
   * 连接 WebSocket
   */
  public connectWebSocket(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
        resolve(false);
        return;
      }

      this.isConnecting = true;
      this.updateStatus('connecting');
      
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          window.logger.info('WebSocket 连接成功');
          this.isConnecting = false;
          this.updateStatus('connected');
          this.clearReconnectTimer();
          
          // 连接成功后发送角色信息
          this.sendCharacterInfo();
          
          resolve(true);
        };

        this.ws.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error: Event) => {
          window.logger.error('WebSocket 错误:', error);
          this.isConnecting = false;
        };

        this.ws.onclose = () => {
          window.logger.info('WebSocket 连接关闭');
          this.isConnecting = false;
          this.updateStatus('disconnected');
          this.scheduleReconnect();
          resolve(false);
        };
      } catch (error) {
        window.logger.error('WebSocket 连接失败:', error);
        this.isConnecting = false;
        this.updateStatus('disconnected');
        this.scheduleReconnect();
        resolve(false);
      }
    });
  }

  /**
   * 处理接收到的消息
   */
  public handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as BackendMessage;
      window.logger.info('收到消息:', message);

      // 触发所有消息处理器
      this.messageHandlers.forEach(handler => handler(message));

      // 根据消息类型处理
      switch (message.type) {
        case 'dialogue':
          this.handleDialogue(message.data as DialogueData);
          break;
        case 'audio_stream_start':
          this.handleAudioStreamStart(message.data as AudioStreamStartData);
          break;
        case 'audio_chunk':
          this.handleAudioChunk(message.data as AudioChunkData);
          break;
        case 'audio_stream_end':
          this.handleAudioStreamEnd(message.data as AudioStreamEndData);
          break;
        case 'live2d':
          this.handleLive2DCommand(message.data as Live2DCommandData);
          break;
        case 'sync_command':
          this.handleSyncCommand(message.data);
          break;
        case 'system':
          this.handleSystemMessage(message.data);
          break;
        case 'plugin_invoke':
          this.handlePluginInvoke(message.data as import('../types/global').PluginInvokeData);
          break;
        default:
          window.logger.warn('未知消息类型:', message.type);
      }
    } catch (error) {
      window.logger.error('消息处理失败:', error);
    }
  }

  /**
   * 处理对话消息
   */
  public handleDialogue(data: DialogueData): void {
    if (window.dialogueManager) {
      let displayText = data.text;
      // 如果消息没有文本但有附件，显示占位符
      if (!displayText && data.attachment) {
        displayText = `[${data.attachment.type === 'image' ? '图片' : '文件'}]`;
      }
      window.dialogueManager.showDialogue(displayText, data.duration);
    }
  }

  /**
   * 处理流式音频开始
   */
  public handleAudioStreamStart(data: AudioStreamStartData): void {
    window.logger.info('[Backend] 开始流式音频传输');
    
    // 立即显示文字
    if (data.text && window.dialogueManager) {
      window.dialogueManager.showDialogue(data.text, data.totalDuration || 5000);
    }
    
    // 初始化流式播放
    if (window.audioPlayer) {
      window.audioPlayer.startStreamingAudio(data.mimeType || 'audio/mpeg');
      
      // 设置时间轴
      if (data.timeline && Array.isArray(data.timeline)) {
        const timelineCallbacks = data.timeline.map((item: TimelineItem) => ({
          timing: item.timing,
          callback: () => this.executeTimelineAction(item)
        }));
        
        window.audioPlayer.setTimeline(timelineCallbacks, data.totalDuration);
        window.audioPlayer.startTimeline();
      }
    }
  }

  /**
   * 处理音频块
   */
  public handleAudioChunk(data: AudioChunkData): void {
    if (!window.audioPlayer) return;
    
    try {
      // Base64 解码
      const binaryString = atob(data.chunk);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      window.audioPlayer.appendAudioChunk(bytes);
    } catch (error) {
      window.logger.error('[Backend] 音频块解码失败:', error);
    }
  }

  /**
   * 处理流式音频结束
   */
  public handleAudioStreamEnd(_data: AudioStreamEndData): void {
    window.logger.info('[Backend] 音频流结束');
    window.audioPlayer.endStream();
  }

  /**
   * 执行时间轴动作
   */  /**
   * 执行时间轴动作
   */
  private executeTimelineAction(item: TimelineItem): void {
    if (!window.live2dManager) return;
    
    switch (item.action) {
      case 'expression':
        window.live2dManager.setExpression(item.expressionId || '');
        break;
      case 'motion':
        window.live2dManager.playMotion(item.group || '', item.index || 0, item.priority || 2);
        break;
      case 'parameter':
        if (item.parameters && Array.isArray(item.parameters)) {
          window.live2dManager.setParameters(item.parameters);
        }
        break;
      default:
        window.logger.warn('[Backend] 未知时间轴动作:', item.action);
    }
  }

  /**
   * 处理 Live2D 指令
   */
  public handleLive2DCommand(data: Live2DCommandData): void {
    if (!window.live2dManager) return;

    switch (data.command) {
      case 'motion':
        window.live2dManager.playMotion(
          data.group || '', 
          data.index || 0, 
          data.priority || 2
        );
        break;
      case 'expression':
        window.live2dManager.setExpression(data.expressionId || '');
        break;
      case 'parameter':
        if (data.parameters && Array.isArray(data.parameters)) {
          window.live2dManager.setParameters(data.parameters);
        } else if (data.parameterId !== undefined && data.value !== undefined) {
          // 单个参数设置
          window.live2dManager.setParameter(data.parameterId, data.value, data.weight || 1.0);
        }
        break;
      default:
        window.logger.warn('未知 Live2D 指令:', data.command);
    }
  }

  /**
   * 处理同步指令
   */
  public handleSyncCommand(data: unknown): void {
    if (window.live2dManager && typeof (window.live2dManager as any).executeSyncCommand === 'function') {
      (window.live2dManager as any).executeSyncCommand(data);
    } else {
      window.logger.warn('Live2D管理器不支持同步指令');
    }
  }

  /**
   * 处理系统消息
   */
  public handleSystemMessage(data: unknown): void {
    window.logger.info('系统消息:', data);
  }

  /**
   * 发送消息到后端
   * @param message - 消息对象
   */
  public async sendMessage(message: BackendMessage): Promise<{ success: boolean; method?: string; data?: unknown; error?: string }> {
    // 优先使用 WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return { success: true, method: 'websocket' };
    }

    // 降级到 HTTP
    return await this.sendHTTP(message);
  }

  /**
   * 通过 HTTP 发送消息
   */
  public async sendHTTP(message: BackendMessage): Promise<{ success: boolean; method: string; data?: unknown; error?: string }> {
    try {
      const response = await fetch(`${this.httpUrl}/api/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });

      const data = await response.json();
      return { success: true, method: 'http', data };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      window.logger.error('HTTP 请求失败:', error);
      return { success: false, method: 'http', error: errorMessage };
    }
  }

  /**
   * 添加消息处理器
   */
  public onMessage(handler: (message: BackendMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 更新状态指示器
   */
  public updateStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
    if (this.statusIndicator) {
      this.statusIndicator.className = `status-dot ${status}`;
    }
    
    // 更新状态文本
    const statusText = document.getElementById('status-text');
    if (statusText) {
      switch (status) {
        case 'connected':
          statusText.textContent = '已连接';
          break;
        case 'connecting':
          statusText.textContent = '连接中...';
          break;
        case 'disconnected':
          statusText.textContent = '未连接';
          break;
      }
    }
  }

  /**
   * 安排重连
   */
  public scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => {
      window.logger.info('尝试重新连接...');
      this.connectWebSocket();
    }, this.reconnectInterval);
  }

  /**
   * 清除重连定时器
   */
  public clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 发送角色信息到后端
   */
  private sendCharacterInfo(): void {
    const settings = window.settingsManager.getSettings();
    
    // 构建角色信息消息
    const characterInfo: CharacterInfo = {
      useCustom: settings.useCustomCharacter
    };
    
    // 只有在启用自定义且有值时才发送
    if (settings.useCustomCharacter) {
      if (settings.customName) {
        characterInfo.name = settings.customName;
      }
      if (settings.customPersonality) {
        characterInfo.personality = settings.customPersonality;
      }
    }
    
    // 发送到后端
    this.sendMessage({
      type: 'character_info',
      data: characterInfo
    }).catch(err => {
      window.logger.error('发送角色信息失败:', err);
    });
  }

  /**
   * 处理后端的插件调用请求
   */
  private handlePluginInvoke(data: import('../types/global').PluginInvokeData): void {
    if (!window.pluginConnector) {
      window.logger.error('[Backend] 插件连接器未初始化');
      
      // 发送错误响应
      this.sendMessage({
        type: 'plugin_response',
        data: {
          pluginId: data.pluginId,
          requestId: data.requestId,
          success: false,
          action: data.action,
          error: '插件系统未初始化',
          timestamp: Date.now()
        }
      }).catch(err => {
        window.logger.error('[Backend] 发送插件错误响应失败:', err);
      });
      return;
    }

    // 转发给插件连接器处理
    window.pluginConnector.handlePluginInvoke(data).catch(err => {
      window.logger.error('[Backend] 处理插件调用失败:', err);
    });
  }

  /**
   * 关闭连接
   */
  public disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('disconnected');
  }
}

// 导出全局实例
window.backendClient = new BackendClient({
  httpUrl: 'http://localhost:8000',
  wsUrl: 'ws://localhost:8000/ws'
});
