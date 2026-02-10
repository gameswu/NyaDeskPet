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
        console.warn('[Plugin] 没有找到插件目录');
        this.updatePluginUI();
        return;
      }

      console.log(`[Plugin] 发现 ${scanResult.plugins.length} 个插件:`, scanResult.plugins);

      // 加载每个插件的清单
      for (const pluginDir of scanResult.plugins) {
        try {
          const result = await window.electronAPI.invoke('plugin:read-manifest', pluginDir);
          
          if (!result.success) {
            console.warn(`[Plugin] 无法加载插件清单: ${pluginDir} - ${result.error}`);
            continue;
          }

          const manifest: PluginManifest = result.manifest;
          
          this.plugins.set(manifest.name, {
            manifest,
            ws: null,
            status: 'stopped',
            processId: null,
            locale: window.settingsManager?.getSettings().locale || 'en-US',
            reconnectTimer: null,
            reconnectAttempts: 0
          });

          console.log(`[Plugin] 加载插件清单: ${manifest.name} (${manifest.i18n['zh-CN']?.displayName || manifest.name})`);
        } catch (error) {
          console.error(`[Plugin] 加载插件清单失败 (${pluginDir}):`, error);
        }
      }

      this.updatePluginUI();
    } catch (error) {
      console.error('[Plugin] 加载插件失败:', error);
      this.updatePluginUI();
    }
  }

  /**
   * 启动插件进程
   */
  public async startPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      console.error(`[Plugin] 插件 ${name} 不存在`);
      return false;
    }

    if (plugin.status === 'running' || plugin.status === 'connected') {
      console.log(`[Plugin] 插件 ${name} 已在运行`);
      return true;
    }

    console.log(`[Plugin] 启动插件: ${name}`);
    console.log(`[Plugin] 工作目录: ${plugin.manifest.workingDirectory}`);
    console.log(`[Plugin] 预执行命令:`, plugin.manifest.preCommands);
    console.log(`[Plugin] 主命令:`, plugin.manifest.command);
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
        console.log(`[Plugin] 插件 ${name} 启动成功 (PID: ${result.pid})`);
        
        // 等待3秒让插件服务完全启动，然后连接
        console.log(`[Plugin] 等待3秒后尝试连接 WebSocket...`);
        setTimeout(() => {
          this.connectPlugin(name);
        }, 3000);
        
        this.updatePluginUI();
        return true;
      } else {
        throw new Error(result.error || '启动失败');
      }
    } catch (error) {
      console.error(`[Plugin] 启动插件 ${name} 失败:`, error);
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
      console.error(`[Plugin] 插件 ${name} 不存在`);
      return false;
    }

    console.log(`[Plugin] 停止插件: ${name}`);
    
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
        console.log(`[Plugin] 插件 ${name} 已停止`);
        this.updatePluginUI();
        return true;
      } else {
        throw new Error(result.error || '停止失败');
      }
    } catch (error) {
      console.error(`[Plugin] 停止插件 ${name} 失败:`, error);
      return false;
    }
  }

  /**
   * 连接插件 WebSocket
   */
  public async connectPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      console.error(`插件 ${name} 不存在`);
      return false;
    }

    if (plugin.ws && (plugin.status === 'connected')) {
      console.log(`插件 ${name} 已连接`);
      return true;
    }

    console.log(`[Plugin] 连接插件 WebSocket: ${name} (${plugin.manifest.url})`);
    this.updatePluginUI();

    try {
      plugin.ws = new WebSocket(plugin.manifest.url);

      plugin.ws.onopen = async () => {
        console.log(`[Plugin] 插件 ${name} WebSocket 连接成功`);
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
        console.error(`[Plugin] 插件 ${name} WebSocket 错误:`, error);
        // 保持 running 状态，只是 WebSocket 出错
        this.updatePluginUI();
      };

      plugin.ws.onclose = () => {
        console.log(`[Plugin] 插件 ${name} WebSocket 关闭`);
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
      console.error(`连接插件 ${name} WebSocket 失败:`, error);
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
    console.log(`[Plugin] 插件 ${name} WebSocket 已断开`);
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
    console.log(`📨 请求插件 ${name} 元数据 (locale: ${locale})`);
  }

  /**
   * 处理插件消息
   */
  private handlePluginMessage(name: string, data: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    try {
      const message = JSON.parse(data);

      // 处理元数据响应（从插件服务器返回的，用于验证）
      if (message.type === 'metadata') {
        console.log(`📦 收到插件 ${name} 元数据验证:`, message.metadata);
        // 这里可以验证插件服务器返回的元数据是否与本地清单匹配
        return;
      }

      // 处理连接确认
      if (message.type === 'connected') {
        console.log(`✅ 插件 ${name} 确认连接:`, message.message);
        return;
      }

      // 处理其他响应
      console.log(`📨 插件 ${name} 消息:`, message);
      
      // 触发自定义事件，让其他模块处理
      const event = new CustomEvent('plugin-message', {
        detail: { plugin: name, message }
      });
      document.dispatchEvent(event);
      
    } catch (error) {
      console.error(`解析插件 ${name} 消息失败:`, error);
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
  public async callPlugin(name: string, action: string, params: any = {}): Promise<any> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`插件 ${name} 不存在`);
    }

    if (plugin.status !== 'connected' || !plugin.ws || plugin.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`插件 ${name} 未连接`);
    }

    return new Promise((resolve, reject) => {
      const message = {
        action,
        params
      };

      // 设置超时
      const timeout = setTimeout(() => {
        reject(new Error(`插件 ${name} 调用超时`));
      }, 30000);

      // 监听响应
      const handler = (event: Event) => {
        const customEvent = event as CustomEvent;
        if (customEvent.detail.plugin === name) {
          clearTimeout(timeout);
          document.removeEventListener('plugin-message', handler);
          resolve(customEvent.detail.message);
        }
      };

      document.addEventListener('plugin-message', handler);

      // 发送消息
      plugin.ws!.send(JSON.stringify(message));
      console.log(`📤 调用插件 ${name}.${action}:`, params);
    });
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
    console.log(`🌍 切换插件 ${name} 语言为: ${locale}`);
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    if (plugin.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`插件 ${name} 达到最大重连次数`);
      return;
    }

    this.clearReconnectTimer(name);
    
    plugin.reconnectTimer = window.setTimeout(() => {
      plugin.reconnectAttempts++;
      console.log(`🔄 重连插件 ${name} (尝试 ${plugin.reconnectAttempts}/${this.maxReconnectAttempts})`);
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
    console.log('[Plugin] 检查自动启动的插件...');
    
    const autoStartPlugins = Array.from(this.plugins.entries())
      .filter(([_, plugin]) => plugin.manifest.autoStart)
      .map(([name, _]) => name);
    
    if (autoStartPlugins.length === 0) {
      console.log('[Plugin] 没有需要自动启动的插件');
      return;
    }
    
    console.log('[Plugin] 自动启动插件:', autoStartPlugins);
    const promises = autoStartPlugins.map(name => this.startPlugin(name));
    await Promise.allSettled(promises);
  }

  /**
   * 断开所有插件
   */
  public disconnectAll(): void {
    console.log('📴 断开所有插件...');
    this.plugins.forEach((_, name) => {
      this.disconnectPlugin(name);
    });
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
window.pluginConnector = new PluginConnector();
