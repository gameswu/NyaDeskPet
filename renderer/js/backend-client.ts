/**
 * 后端客户端
 * 负责与后端 Agent 服务器通信
 */

import type { 
  BackendClient as IBackendClient, 
  BackendConfig, 
  BackendMessage,
  DialogueData,
  VoiceData,
  Live2DCommandData
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
      this.httpUrl = settings.backendUrl;
      this.wsUrl = settings.wsUrl;
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
          console.log('WebSocket 连接成功');
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
          console.error('WebSocket 错误:', error);
          this.isConnecting = false;
        };

        this.ws.onclose = () => {
          console.log('WebSocket 连接关闭');
          this.isConnecting = false;
          this.updateStatus('disconnected');
          this.scheduleReconnect();
          resolve(false);
        };
      } catch (error) {
        console.error('WebSocket 连接失败:', error);
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
      console.log('收到消息:', message);

      // 触发所有消息处理器
      this.messageHandlers.forEach(handler => handler(message));

      // 根据消息类型处理
      switch (message.type) {
        case 'dialogue':
          this.handleDialogue(message.data as DialogueData);
          break;
        case 'voice':
          this.handleVoice(message.data as VoiceData);
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
        default:
          console.warn('未知消息类型:', message.type);
      }
    } catch (error) {
      console.error('消息处理失败:', error);
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
   * 处理语音消息
   */
  public handleVoice(data: VoiceData): void {
    if (window.audioPlayer) {
      window.audioPlayer.playAudio(data.url || data.base64 || '');
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
      default:
        console.warn('未知 Live2D 指令:', data.command);
    }
  }

  /**
   * 处理同步指令
   */
  public handleSyncCommand(data: unknown): void {
    if (window.live2dManager && typeof (window.live2dManager as any).executeSyncCommand === 'function') {
      (window.live2dManager as any).executeSyncCommand(data);
    } else {
      console.warn('Live2D管理器不支持同步指令');
    }
  }

  /**
   * 处理系统消息
   */
  public handleSystemMessage(data: unknown): void {
    console.log('系统消息:', data);
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
      console.error('HTTP 请求失败:', error);
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
      console.log('尝试重新连接...');
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
    const characterInfo: any = {
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
      console.error('发送角色信息失败:', err);
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
