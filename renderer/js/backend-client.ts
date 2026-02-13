/**
 * 后端客户端
 * 负责与后端 Agent 服务器通信
 */

import type { 
  BackendClient as IBackendClient, 
  BackendConfig, 
  BackendMessage,
  DialogueData,
  DialogueStreamStartData,
  DialogueStreamChunkData,
  DialogueStreamEndData,
  ToolConfirmData,
  AudioStreamStartData,
  AudioChunkData,
  AudioStreamEndData,
  Live2DCommandData,
  TimelineItem,
  CharacterInfo,
  CommandsRegisterData,
  CommandResponseData
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
  private _disposed: boolean;

  constructor(config: BackendConfig = {}) {
    this.httpUrl = config.httpUrl || 'http://localhost:8000';
    this.wsUrl = config.wsUrl || 'ws://localhost:8000/ws';
    this.ws = null;
    this.reconnectInterval = 5000;
    this.reconnectTimer = null;
    this.isConnecting = false;
    this._disposed = false;
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
          if (!this._disposed) {
            this.scheduleReconnect();
          }
          resolve(false);
        };
      } catch (error) {
        window.logger.error('WebSocket 连接失败:', error);
        this.isConnecting = false;
        this.updateStatus('disconnected');
        if (!this._disposed) {
          this.scheduleReconnect();
        }
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

      const responseId = message.responseId;
      const priority = message.priority ?? 0;

      // ===== 响应优先级中断检查 =====
      // 仅对"会产生可见效果"的消息类型做优先级判断
      // 纯数据类消息（plugin_invoke、plugin_response、system 等）不受中断影响
      const interruptableTypes = ['dialogue', 'dialogue_stream_start', 'audio_stream_start', 'sync_command', 'live2d'];
      
      if (responseId && interruptableTypes.includes(message.type)) {
        // 首次出现的 responseId → 判断是否可以中断当前响应
        if (message.type === 'dialogue' || message.type === 'dialogue_stream_start' || message.type === 'audio_stream_start' || message.type === 'sync_command') {
          if (!window.responseController.shouldAccept(responseId, priority)) {
            window.logger.info(`[Backend] 丢弃低优先级消息: type=${message.type} responseId=${responseId}`);
            return;
          }
        } else {
          // live2d 等附属消息：检查 responseId 是否仍然活跃
          if (!window.responseController.isActive(responseId)) {
            window.logger.info(`[Backend] 过滤已中断的消息: type=${message.type} responseId=${responseId}`);
            return;
          }
        }
      }

      // 音频分片和结束消息：检查 responseId 是否仍然活跃（防止被中断后仍处理残留分片）
      if (responseId && (message.type === 'audio_chunk' || message.type === 'audio_stream_end' || message.type === 'dialogue_stream_chunk' || message.type === 'dialogue_stream_end')) {
        if (!window.responseController.isActive(responseId)) {
          window.logger.info(`[Backend] 过滤已中断的音频消息: type=${message.type} responseId=${responseId}`);
          return;
        }
      }

      // 触发所有消息处理器
      this.messageHandlers.forEach(handler => handler(message));

      // 根据消息类型处理
      switch (message.type) {
        case 'dialogue':
          this.handleDialogue(message.data as DialogueData);
          // 如果当前响应没有活跃的音频流，对话结束时即视为响应结束
          if (responseId) {
            const session = window.responseController.getCurrentSession();
            if (session && !session.hasActiveAudio) {
              const duration = (message.data as DialogueData)?.duration || 5000;
              setTimeout(() => {
                window.responseController.notifyComplete(responseId);
              }, duration);
            }
          }
          break;
        case 'audio_stream_start':
          if (responseId) window.responseController.markAudioActive();
          this.handleAudioStreamStart(message.data as AudioStreamStartData);
          break;
        case 'audio_chunk':
          this.handleAudioChunk(message.data as AudioChunkData);
          break;
        case 'audio_stream_end':
          this.handleAudioStreamEnd(message.data as AudioStreamEndData);
          // 音频流结束 → 响应会话可以结束
          if (responseId) window.responseController.notifyComplete(responseId);
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
        case 'dialogue_stream_start':
          this.handleDialogueStreamStart(message.data as DialogueStreamStartData);
          break;
        case 'dialogue_stream_chunk':
          this.handleDialogueStreamChunk(message.data as DialogueStreamChunkData);
          break;
        case 'dialogue_stream_end':
          this.handleDialogueStreamEnd(message.data as DialogueStreamEndData, responseId);
          break;
        case 'tool_confirm':
          this.handleToolConfirm(message.data as ToolConfirmData);
          break;
        case 'commands_register':
          this.handleCommandsRegister(message.data as CommandsRegisterData);
          break;
        case 'command_response':
          this.handleCommandResponse(message.data as CommandResponseData);
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
    // 已关闭，不再发送
    if (this._disposed) {
      return { success: false, method: 'none', error: 'Client disposed' };
    }

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
      const key = `topBar.${status}`;
      statusText.textContent = window.i18nManager?.t(key) || status;
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

  // ==================== 流式对话处理 ====================

  /** 当前流式对话的 streamId */
  private currentStreamId: string | null = null;
  /** 流式对话累计文本 */
  private streamAccumulated: string = '';
  /** 流式思维链累计文本 */
  private streamReasoningAccumulated: string = '';

  /**
   * 处理流式对话开始
   */
  private handleDialogueStreamStart(data: DialogueStreamStartData): void {
    this.currentStreamId = data.streamId;
    this.streamAccumulated = '';
    this.streamReasoningAccumulated = '';
    window.logger.info(`[Backend] 流式对话开始: ${data.streamId}`);
    if (window.dialogueManager) {
      // 显示对话框但内容为空，准备接收增量
      window.dialogueManager.showDialogue('', 0, false);
    }
  }

  /**
   * 处理流式对话增量
   */
  private handleDialogueStreamChunk(data: DialogueStreamChunkData): void {
    if (data.streamId !== this.currentStreamId) return;
    if (data.delta) {
      this.streamAccumulated += data.delta;
    }
    if (data.reasoningDelta) {
      this.streamReasoningAccumulated += data.reasoningDelta;
    }
    if (window.dialogueManager && data.delta) {
      window.dialogueManager.appendText(data.delta);
    }
  }

  /**
   * 处理流式对话结束
   */
  private handleDialogueStreamEnd(data: DialogueStreamEndData, responseId?: string): void {
    if (data.streamId !== this.currentStreamId) return;
    this.currentStreamId = null;
    window.logger.info(`[Backend] 流式对话结束: ${data.streamId}`);

    // 将完整的流式对话文本添加到聊天窗口
    const fullText = data.fullText || this.streamAccumulated;
    if (fullText) {
      const messagesContainer = document.getElementById('chat-messages');
      if (messagesContainer) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message assistant';

        // 思维链（折叠展示）
        if (this.streamReasoningAccumulated) {
          const details = document.createElement('details');
          details.className = 'reasoning-block';
          const summary = document.createElement('summary');
          summary.className = 'reasoning-summary';
          const icon = document.createElement('i');
          icon.setAttribute('data-lucide', 'brain');
          icon.style.cssText = 'width: 13px; height: 13px;';
          summary.appendChild(icon);
          const label = document.createElement('span');
          label.textContent = window.i18nManager?.t('chatWindow.reasoning') || '思考过程';
          summary.appendChild(label);
          details.appendChild(summary);
          const content = document.createElement('div');
          content.className = 'reasoning-content';
          content.textContent = this.streamReasoningAccumulated;
          details.appendChild(content);
          messageDiv.appendChild(details);
        }

        const textNode = document.createElement('div');
        textNode.textContent = fullText;
        messageDiv.appendChild(textNode);

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        if (window.lucide) {
          window.lucide.createIcons();
        }
      }
    }

    this.streamAccumulated = '';
    this.streamReasoningAccumulated = '';

    if (window.dialogueManager) {
      const duration = data.duration || 5000;
      window.dialogueManager.startAutoHide(duration);
    }
    // 流式对话结束，通知响应控制器
    if (responseId) {
      const duration = data.duration || 5000;
      setTimeout(() => {
        window.responseController.notifyComplete(responseId);
      }, duration);
    }
  }

  // ==================== 工具确认处理 ====================

  /**
   * 处理工具调用确认请求
   * 在前端显示确认对话框，用户批准/拒绝后发送 tool_confirm_response
   */
  private handleToolConfirm(data: ToolConfirmData): void {
    window.logger.info(`[Backend] 收到工具确认请求: ${data.confirmId}`);

    // 构建确认信息
    const toolDetails = data.toolCalls.map(tc => {
      const argsStr = Object.entries(tc.arguments)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ');
      const sourceLabel = tc.source === 'plugin' ? '🧩 插件' : tc.source === 'mcp' ? '🔌 MCP' : '⚙️ 内置';
      return `${sourceLabel} ${tc.name}(${argsStr})`;
    }).join('\n');

    // 显示确认对话
    if (window.dialogueManager) {
      window.dialogueManager.showDialogue(
        `🔧 AI 请求执行以下操作:\n${toolDetails}\n\n等待确认...`,
        0, // 不自动隐藏
        false
      );
    }

    // 创建确认 UI
    this.showToolConfirmUI(data);
  }

  /**
   * 显示工具确认 UI
   */
  private showToolConfirmUI(data: ToolConfirmData): void {
    // 移除已有的确认 UI
    const existing = document.getElementById('tool-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tool-confirm-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; pointer-events: all;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: rgba(30, 30, 30, 0.95); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px; padding: 20px; max-width: 400px; width: 90%;
      color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `;

    const title = document.createElement('div');
    title.textContent = '🔧 工具调用确认';
    title.style.cssText = 'font-size: 16px; font-weight: 600; margin-bottom: 12px;';
    panel.appendChild(title);

    // 工具列表
    for (const tc of data.toolCalls) {
      const toolItem = document.createElement('div');
      toolItem.style.cssText = `
        background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px;
        margin-bottom: 8px; font-size: 13px;
      `;
      const sourceLabel = tc.source === 'plugin' ? '🧩' : tc.source === 'mcp' ? '🔌' : '⚙️';
      toolItem.innerHTML = `
        <div style="font-weight: 500; margin-bottom: 4px;">${sourceLabel} ${tc.name}</div>
        ${tc.description ? `<div style="color: rgba(255,255,255,0.6); font-size: 12px; margin-bottom: 4px;">${tc.description}</div>` : ''}
        <div style="color: rgba(255,255,255,0.5); font-size: 11px; word-break: break-all;">
          参数: ${JSON.stringify(tc.arguments, null, 0)}
        </div>
      `;
      panel.appendChild(toolItem);
    }

    // 超时提示
    const timeoutSec = Math.round(data.timeout / 1000);
    const timeoutHint = document.createElement('div');
    timeoutHint.style.cssText = 'color: rgba(255,255,255,0.4); font-size: 11px; margin: 8px 0;';
    timeoutHint.textContent = `⏱ ${timeoutSec} 秒后自动拒绝`;
    panel.appendChild(timeoutHint);

    // 按钮容器
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 12px;';

    const approveBtn = document.createElement('button');
    approveBtn.textContent = '✅ 允许';
    approveBtn.style.cssText = `
      flex: 1; padding: 10px; border: none; border-radius: 8px;
      background: #4CAF50; color: #fff; font-size: 14px; cursor: pointer;
      font-weight: 500; transition: opacity 0.2s;
    `;
    approveBtn.onmouseenter = () => { approveBtn.style.opacity = '0.8'; };
    approveBtn.onmouseleave = () => { approveBtn.style.opacity = '1'; };

    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = '❌ 拒绝';
    rejectBtn.style.cssText = `
      flex: 1; padding: 10px; border: none; border-radius: 8px;
      background: #f44336; color: #fff; font-size: 14px; cursor: pointer;
      font-weight: 500; transition: opacity 0.2s;
    `;
    rejectBtn.onmouseenter = () => { rejectBtn.style.opacity = '0.8'; };
    rejectBtn.onmouseleave = () => { rejectBtn.style.opacity = '1'; };

    const respond = (approved: boolean) => {
      overlay.remove();
      if (window.dialogueManager) {
        window.dialogueManager.hideDialogue();
      }
      this.sendMessage({
        type: 'tool_confirm_response',
        data: { confirmId: data.confirmId, approved }
      }).catch(err => {
        window.logger.error('[Backend] 发送工具确认响应失败:', err);
      });
    };

    approveBtn.onclick = () => respond(true);
    rejectBtn.onclick = () => respond(false);

    btnContainer.appendChild(approveBtn);
    btnContainer.appendChild(rejectBtn);
    panel.appendChild(btnContainer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // 超时自动移除
    setTimeout(() => {
      if (document.getElementById('tool-confirm-overlay')) {
        overlay.remove();
        if (window.dialogueManager) {
          window.dialogueManager.hideDialogue();
        }
      }
    }, data.timeout);
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
    this._disposed = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('disconnected');
  }

  // ==================== 指令系统 ====================

  /** 已注册的指令列表（来自后端） */
  private registeredCommands: import('../types/global').CommandDefinition[] = [];

  /**
   * 处理指令注册消息（后端 → 前端）
   */
  private handleCommandsRegister(data: CommandsRegisterData): void {
    if (!data?.commands) return;
    this.registeredCommands = data.commands;
    window.logger.info(`[Backend] 收到 ${data.commands.length} 个指令定义`);
  }

  /**
   * 处理指令执行结果
   */
  private handleCommandResponse(data: CommandResponseData): void {
    if (!data) return;
    window.logger.info(`[Backend] 指令响应: /${data.command} success=${data.success}`);

    // 在聊天窗口显示指令结果
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'chat-message assistant command-result';

      const header = document.createElement('div');
      header.className = 'command-result-header';
      header.innerHTML = `<span class="command-result-prefix">/${data.command}</span>`;
      messageDiv.appendChild(header);

      if (data.success && data.text) {
        const content = document.createElement('div');
        content.className = 'command-result-content';
        // 支持简易 markdown 换行
        content.innerHTML = data.text.replace(/\n/g, '<br>');
        messageDiv.appendChild(content);
      } else if (!data.success) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'command-result-error';
        errorDiv.textContent = data.error || '指令执行失败';
        messageDiv.appendChild(errorDiv);
      }

      messagesContainer.appendChild(messageDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // 也在对话框中简短显示
    if (data.success && data.text && window.dialogueManager) {
      const shortText = data.text.length > 100 ? data.text.substring(0, 100) + '...' : data.text;
      window.dialogueManager.showDialogue(shortText, 5000);
    }
  }

  /**
   * 获取已注册的指令列表
   */
  public getRegisteredCommands(): import('../types/global').CommandDefinition[] {
    return this.registeredCommands;
  }

  /**
   * 发送指令执行请求
   */
  public async executeCommand(command: string, args: Record<string, unknown> = {}): Promise<void> {
    await this.sendMessage({
      type: 'command_execute',
      data: { command, args }
    });
  }
}

// 导出全局实例
window.backendClient = new BackendClient({
  httpUrl: 'http://localhost:8000',
  wsUrl: 'ws://localhost:8000/ws'
});
