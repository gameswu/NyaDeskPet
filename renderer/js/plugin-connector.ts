/**
 * 插件连接器
 * 负责连接和管理 WebSocket 插件
 */

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  type: string;
  url: string;
  autoStart: boolean;
  permissions: string[];
  capabilities: string[];
  i18n: {
    [locale: string]: {
      displayName: string;
      description: string;
      category: string;
    };
  };
  icon: string;
  iconFile?: string | null;
  preCommands?: {
    win32?: (string | string[])[];
    darwin?: (string | string[])[];
    linux?: (string | string[])[];
  };
  command: {
    win32: string | string[];
    darwin: string | string[];
    linux: string | string[];
  };
  workingDirectory?: string;
}

interface PluginInfo {
  manifest: PluginManifest;
  ws: WebSocket | null;
  status: 'stopped' | 'starting' | 'running' | 'connected' | 'error';
  processId: number | null;
  locale: string;
  reconnectTimer: number | null;
  reconnectAttempts: number;
  directoryName: string;  // 插件所在的文件夹名称
}

class PluginConnector {
  private plugins: Map<string, PluginInfo> = new Map();
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectInterval = 3000;

  constructor() {
    // 加载插件配置
    this.loadPlugins();
  }

  /**
   * 从文件加载插件配置
   */
  private async loadPlugins(): Promise<void> {
    try {
      // 先扫描插件目录
      const scanResult = await window.electronAPI.invoke('plugin:scan-directory');
      
      if (!scanResult.success || scanResult.plugins.length === 0) {
        window.logger?.warn('插件系统：没有找到插件目录');
        this.updatePluginUI();
        return;
      }

      window.logger?.info('插件系统：发现插件', { count: scanResult.plugins.length, plugins: scanResult.plugins });

      // 加载每个插件的清单
      for (const pluginDir of scanResult.plugins) {
        try {
          const result = await window.electronAPI.invoke('plugin:read-manifest', pluginDir);
          
          if (!result.success) {
            window.logger?.warn('插件系统：无法加载插件清单', { pluginDir, error: result.error });
            continue;
          }

          const manifest: PluginManifest = result.manifest;
          
          // 兼容性处理：将旧格式的权限数组转换为新格式
          if (manifest.permissions && manifest.permissions.length > 0 && typeof manifest.permissions[0] === 'string') {
            // 旧格式，转换为新格式
            manifest.permissions = (manifest.permissions as any).map((perm: string) => ({
              id: perm,
              dangerLevel: 'medium' as const,
              i18n: {
                'zh-CN': { name: perm, description: '' },
                'en-US': { name: perm, description: '' }
              }
            }));
          }
          
          this.plugins.set(manifest.name, {
            manifest,
            ws: null,
            status: 'stopped',
            processId: null,
            locale: window.settingsManager?.getSettings().locale || 'en-US',
            reconnectTimer: null,
            reconnectAttempts: 0,
            directoryName: pluginDir  // 保存文件夹名称
          });

          window.logger?.info('插件系统：加载插件清单', { 
            name: manifest.name, 
            displayName: manifest.i18n['zh-CN']?.displayName || manifest.name 
          });
        } catch (error) {
          window.logger?.error('插件系统：加载插件清单失败', { pluginDir, error });
        }
      }

      this.updatePluginUI();
    } catch (error) {
      window.logger?.error('插件系统：加载插件失败', { error });
      this.updatePluginUI();
    }
  }

  /**
   * 启动插件进程
   */
  public async startPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      window.logger?.error('插件系统：插件不存在', { name });
      return false;
    }

    if (plugin.status === 'running' || plugin.status === 'connected') {
      window.logger?.info('插件系统：插件已在运行', { name });
      return true;
    }

    window.logger?.info('插件系统：启动插件', { 
      name, 
      workingDirectory: plugin.manifest.workingDirectory,
      preCommands: plugin.manifest.preCommands,
      command: plugin.manifest.command
    });
    plugin.status = 'starting';
    this.updatePluginUI();

    try {
      // 通过 IPC 请求主进程启动插件
      const result = await window.electronAPI.invoke('plugin:start', {
        name: plugin.manifest.name,
        command: plugin.manifest.command,
        preCommands: plugin.manifest.preCommands,
        workingDirectory: plugin.manifest.workingDirectory
      });

      if (result.success) {
        plugin.processId = result.pid;
        plugin.status = 'running';
        window.logger?.info('插件系统：插件启动成功', { name, pid: result.pid });
        
        // 等待3秒让插件服务完全启动，然后连接
        window.logger?.debug('插件系统：等待3秒后尝试连接WebSocket', { name });
        setTimeout(() => {
          this.connectPlugin(name);
        }, 3000);
        
        this.updatePluginUI();
        return true;
      } else {
        throw new Error(result.error || '启动失败');
      }
    } catch (error) {
      window.logger?.error('插件系统：启动插件失败', { name, error });
      plugin.status = 'error';
      this.updatePluginUI();
      return false;
    }
  }

  /**
   * 停止插件进程
   */
  public async stopPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      window.logger?.error('插件系统：插件不存在', { name });
      return false;
    }

    window.logger?.info('插件系统：停止插件', { name });
    
    // 先断开 WebSocket 连接
    this.disconnectPlugin(name);

    try {
      // 通过 IPC 请求主进程停止插件
      const result = await window.electronAPI.invoke('plugin:stop', {
        name: plugin.manifest.name,
        pid: plugin.processId
      });

      if (result.success) {
        plugin.processId = null;
        plugin.status = 'stopped';
        window.logger?.info('插件系统：插件已停止', { name });
        this.updatePluginUI();
        return true;
      } else {
        throw new Error(result.error || '停止失败');
      }
    } catch (error) {
      window.logger?.error('插件系统：停止插件失败', { name, error });
      return false;
    }
  }

  /**
   * 连接插件 WebSocket
   */
  public async connectPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      window.logger?.error('插件系统：插件不存在', { name });
      return false;
    }

    if (plugin.ws && (plugin.status === 'connected')) {
      window.logger?.info('插件系统：插件已连接', { name });
      return true;
    }

    window.logger?.info('插件系统：连接插件WebSocket', { name, url: plugin.manifest.url });
    this.updatePluginUI();

    try {
      plugin.ws = new WebSocket(plugin.manifest.url);

      plugin.ws.onopen = async () => {
        window.logger?.info('插件系统：WebSocket连接成功', { name });
        plugin.status = 'connected';
        plugin.reconnectAttempts = 0;
        this.clearReconnectTimer(name);
        
        // 请求插件元数据
        await this.requestMetadata(name);
        this.updatePluginUI();
      };

      plugin.ws.onmessage = (event: MessageEvent) => {
        this.handlePluginMessage(name, event.data);
      };

      plugin.ws.onerror = (error: Event) => {
        window.logger?.error('插件系统：WebSocket错误', { name, error });
        // 保持 running 状态，只是 WebSocket 出错
        this.updatePluginUI();
      };

      plugin.ws.onclose = () => {
        window.logger?.info('插件系统：WebSocket关闭', { name });
        // 如果插件还在运行，尝试重连
        if (plugin.status === 'connected' || plugin.status === 'running') {
          plugin.status = 'running';
          plugin.ws = null;
          this.updatePluginUI();
          this.scheduleReconnect(name);
        }
      };

      return true;
    } catch (error) {
      window.logger?.error('插件系统：连接WebSocket失败', { name, error });
      this.updatePluginUI();
      return false;
    }
  }

  /**
   * 断开插件 WebSocket 连接（不停止进程）
   */
  public disconnectPlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    this.clearReconnectTimer(name);
    
    if (plugin.ws) {
      plugin.ws.close();
      plugin.ws = null;
    }
    
    // 如果进程还在运行，保持 running 状态
    if (plugin.status === 'connected' && plugin.processId) {
      plugin.status = 'running';
    }
    
    this.updatePluginUI();
    window.logger?.info('插件系统：WebSocket已断开', { name });
  }

  /**
   * 请求插件元数据
   */
  private async requestMetadata(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.ws || plugin.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const locale = window.settingsManager?.getSettings().locale || 'en-US';
    plugin.locale = locale;

    const message = {
      action: 'getMetadata',
      locale: locale
    };

    plugin.ws.send(JSON.stringify(message));
    window.logger?.debug('插件系统：请求元数据', { name, locale });
  }

  /**
   * 处理插件消息
   */
  private handlePluginMessage(name: string, data: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    try {
      const message = JSON.parse(data);

      // 处理配置请求
      if (message.action === 'getConfig') {
        this.handleConfigRequest(name, message);
        return;
      }

      // 处理权限请求
      if (message.type === 'permission_request') {
        this.handlePermissionRequest(name, message);
        return;
      }

      // 处理元数据响应（从插件服务器返回的，用于验证）
      if (message.type === 'metadata') {
        window.logger?.debug('插件系统：收到元数据验证', { name, metadata: message.metadata });
        // 这里可以验证插件服务器返回的元数据是否与本地清单匹配
        return;
      }

      // 处理连接确认
      if (message.type === 'connected') {
        window.logger?.debug('插件系统：插件确认连接', { name, message: message.message });
        return;
      }

      // 处理其他响应
      window.logger?.debug('插件系统：收到消息', { name, type: message.type });
      
      // 自动转发插件响应到后端 Agent
      if (message.type === 'plugin_response' && message.requestId) {
        this.forwardPluginResponseToBackend(name, message);
      }
      
      // 触发自定义事件，让其他模块处理
      const event = new CustomEvent('plugin-message', {
        detail: { plugin: name, message }
      });
      document.dispatchEvent(event);
      
    } catch (error) {
      window.logger?.error('插件系统：解析消息失败', { name, error });
    }
  }

  /**
   * 获取插件的本地化信息
   */
  public getPluginI18n(name: string): { displayName: string; description: string; category: string } | null {
    const plugin = this.plugins.get(name);
    if (!plugin) return null;

    const locale = plugin.locale;
    return plugin.manifest.i18n[locale] || plugin.manifest.i18n['en-US'];
  }

  /**
   * 调用插件功能
   */
  public async callPlugin<T = unknown>(name: string, action: string, params: Record<string, unknown> = {}): Promise<T> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`插件 ${name} 不存在`);
    }

    if (plugin.status !== 'connected' || !plugin.ws || plugin.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`插件 ${name} 未连接`);
    }

    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();
      const message = {
        requestId,
        action,
        params
      };

      // 设置超时
      const timeout = setTimeout(() => {
        document.removeEventListener('plugin-message', handler);
        reject(new Error(`插件 ${name} 调用超时`));
      }, params.timeout as number || 30000);

      // 监听响应
      const handler = (event: Event) => {
        const customEvent = event as CustomEvent;
        if (customEvent.detail.plugin === name && customEvent.detail.message.requestId === requestId) {
          clearTimeout(timeout);
          document.removeEventListener('plugin-message', handler);
          
          const response = customEvent.detail.message;
          if (response.success) {
            resolve(response.result || response.data);
          } else {
            reject(new Error(response.error || '插件调用失败'));
          }
        }
      };

      document.addEventListener('plugin-message', handler);

      // 发送消息
      plugin.ws!.send(JSON.stringify(message));
      window.logger.info(`📤 调用插件 ${name}.${action}:`, params);
    });
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 转发插件响应到后端 Agent
   */
  private forwardPluginResponseToBackend(pluginName: string, message: any): void {
    if (!window.backendClient) {
      window.logger?.warn('插件系统：后端客户端未初始化，无法转发插件响应');
      return;
    }

    // 验证响应格式（成功的响应必须包含result字段，且result必须有type字段）
    if (message.success && (!message.result || !message.result.type)) {
      window.logger?.error('插件系统：插件响应格式不规范，缺少result或result.type字段', {
        pluginName,
        requestId: message.requestId,
        hasResult: !!message.result,
        resultType: message.result?.type
      });
      
      // 将格式错误转为失败响应
      const errorData: import('../types/global').PluginResponseData = {
        pluginId: pluginName,
        requestId: message.requestId,
        success: false,
        action: message.action || 'unknown',
        error: '插件响应格式不规范：缺少result或result.type字段',
        timestamp: Date.now()
      };
      
      window.backendClient.sendMessage({
        type: 'plugin_response',
        data: errorData
      });
      return;
    }

    const responseData: import('../types/global').PluginResponseData = {
      pluginId: pluginName,
      requestId: message.requestId,
      success: message.success || false,
      action: message.action || 'unknown',
      result: message.result, // 严格使用result字段，不再后备到data
      error: message.error,
      timestamp: Date.now()
    };

    window.backendClient.sendMessage({
      type: 'plugin_response',
      data: responseData
    });

    window.logger?.info('插件系统：已转发响应到后端', { pluginName, requestId: message.requestId });
  }

  /**
   * 处理来自后端的插件调用请求
   */
  public async handlePluginInvoke(data: import('../types/global').PluginInvokeData): Promise<void> {
    const { requestId, pluginId, action, params, timeout } = data;

    window.logger?.info('插件系统：收到后端调用请求', { requestId, pluginId, action });

    try {
      // 调用插件
      const result = await this.callPlugin(pluginId, action, { ...params, timeout });

      // 发送成功响应
      this.forwardPluginResponseToBackend(pluginId, {
        requestId,
        success: true,
        action,
        result
      });
    } catch (error) {
      // 发送失败响应
      this.forwardPluginResponseToBackend(pluginId, {
        requestId,
        success: false,
        action,
        error: String(error)
      });
    }
  }

  /**
   * 切换插件语言
   */
  public async setPluginLocale(name: string, locale: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.ws || plugin.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      action: 'setLocale',
      params: { locale }
    };

    plugin.ws.send(JSON.stringify(message));
    plugin.locale = locale;
    window.logger?.info('插件系统：切换插件语言', { name, locale });
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    if (plugin.reconnectAttempts >= this.maxReconnectAttempts) {
      window.logger?.warn('插件系统：达到最大重连次数', { name, attempts: plugin.reconnectAttempts });
      return;
    }

    this.clearReconnectTimer(name);
    
    plugin.reconnectTimer = window.setTimeout(() => {
      plugin.reconnectAttempts++;
      window.logger?.info('插件系统：重连插件', { 
        name, 
        attempt: plugin.reconnectAttempts, 
        max: this.maxReconnectAttempts 
      });
      this.connectPlugin(name);
    }, this.reconnectInterval);
  }

  /**
   * 清除重连定时器
   */
  private clearReconnectTimer(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin?.reconnectTimer) {
      clearTimeout(plugin.reconnectTimer);
      plugin.reconnectTimer = null;
    }
  }

  /**
   * 获取所有插件状态
   */
  public getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取指定插件
   */
  public getPlugin(name: string): PluginInfo | undefined {
    return this.plugins.get(name);
  }

  /**
   * 自动启动设置为 autoStart 的插件
   */
  public async connectAll(): Promise<void> {
    window.logger?.info('插件系统：检查自动启动的插件');
    
    const autoStartPlugins = Array.from(this.plugins.entries())
      .filter(([_, plugin]) => plugin.manifest.autoStart)
      .map(([name, _]) => name);
    
    if (autoStartPlugins.length === 0) {
      window.logger?.info('插件系统：没有需要自动启动的插件');
      return;
    }
    
    window.logger?.info('插件系统：自动启动插件', { plugins: autoStartPlugins });
    const promises = autoStartPlugins.map(name => this.startPlugin(name));
    await Promise.allSettled(promises);
  }

  /**
   * 断开所有插件
   */
  public disconnectAll(): void {
    window.logger?.info('插件系统：断开所有插件');
    this.plugins.forEach((_, name) => {
      this.disconnectPlugin(name);
    });
  }

  /**
   * 处理配置请求
   */
  private async handleConfigRequest(name: string, message: any): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.ws) return;

    const pluginId = message.pluginId;
    window.logger?.debug('插件系统：插件请求配置', { name, pluginId });

    try {
      // 从配置管理器获取配置
      const config = await window.pluginConfigManager.getConfig(pluginId);
      
      // 发送配置给插件
      plugin.ws.send(JSON.stringify({
        type: 'plugin_config',
        config: config
      }));

      window.logger?.info('插件系统：已发送配置', { name });
    } catch (error) {
      window.logger?.error('插件系统：发送配置失败', { name, error });
    }
  }

  /**
   * 处理权限请求
   */
  private async handlePermissionRequest(name: string, message: any): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin || !plugin.ws) return;

    const { requestId, permissionId, operation } = message;
    window.logger?.debug('插件系统：插件请求权限', { name, permissionId, operation });

    try {
      // 获取权限定义（权限可能是对象或字符串）
      const permissionObj = plugin.manifest.permissions.find((p: any) => 
        (typeof p === 'string' ? p : p.id) === permissionId
      );
      
      if (!permissionObj) {
        window.logger?.warn('插件系统：未找到权限定义', { name, permissionId });
        plugin.ws.send(JSON.stringify({
          type: 'permission_response',
          requestId,
          granted: false
        }));
        return;
      }

      // 获取危险等级（兼容旧格式的字符串权限）
      const dangerLevel = typeof permissionObj === 'string' ? 'medium' : ((permissionObj as any).dangerLevel || 'medium');

      // 检查权限
      const granted = await window.pluginPermissionManager.checkPermission(
        plugin.manifest.id,
        permissionId,
        dangerLevel
      );

      // 返回结果
      plugin.ws.send(JSON.stringify({
        type: 'permission_response',
        requestId,
        granted
      }));

      window.logger?.info('插件系统：权限请求结果', { name, permissionId, granted });
    } catch (error) {
      window.logger?.error('插件系统：处理权限请求失败', { name, error });
      plugin.ws.send(JSON.stringify({
        type: 'permission_response',
        requestId,
        granted: false
      }));
    }
  }

  /**
   * 更新插件UI
   */
  private updatePluginUI(): void {
    if (window.pluginUI) {
      window.pluginUI.renderPlugins();
    }
  }
}

// 导出全局实例
window.pluginConnector = new PluginConnector() as any;
