import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * ElectronAPI 类型定义的唯一来源：renderer/types/global.d.ts
 * 修改 API 时请同步更新 global.d.ts 中的 ElectronAPI 接口
 */

// 暴露安全的 API 给渲染进程
const electronAPI = {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => 
    ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  getCursorScreenPoint: () => ipcRenderer.invoke('get-cursor-screen-point'),
  
  // 消息通信
  sendMessage: (message: unknown) => ipcRenderer.invoke('send-message', message),
  
  // UI状态更新
  updateUIState: (state: { uiVisible?: boolean; chatOpen?: boolean }) => {
    ipcRenderer.send('ui-state-changed', state);
  },
  
  // 文件选择
  selectModelFile: () => ipcRenderer.invoke('select-model-file'),
  
  // 更新检查
  checkUpdate: (updateSource: string) => ipcRenderer.invoke('check-update', updateSource),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // ASR 服务
  asrInitialize: () => ipcRenderer.invoke('asr-initialize'),
  asrIsReady: () => ipcRenderer.invoke('asr-is-ready'),
  asrRecognize: (audioData: string) => ipcRenderer.invoke('asr-recognize', audioData),
  
  // 日志系统
  loggerUpdateConfig: (config: any) => ipcRenderer.invoke('logger-update-config', config),
  loggerGetConfig: () => ipcRenderer.invoke('logger-get-config'),
  loggerGetFiles: () => ipcRenderer.invoke('logger-get-files'),
  loggerDeleteFile: (fileName: string) => ipcRenderer.invoke('logger-delete-file', fileName),
  loggerDeleteAll: () => ipcRenderer.invoke('logger-delete-all'),
  loggerOpenDirectory: () => ipcRenderer.invoke('logger-open-directory'),
  loggerLog: (level: string, message: string, data?: any) => {
    ipcRenderer.send('logger-log', level, message, data);
  },
  
  // 开机自启动
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('set-auto-launch', enable),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  
  // 监听来自主进程的消息
  onBackendMessage: (callback: (data: unknown) => void) => {
    ipcRenderer.on('backend-message', (_event: IpcRendererEvent, data: unknown) => callback(data));
  },
  
  onVoicePlay: (callback: (data: unknown) => void) => {
    ipcRenderer.on('voice-play', (_event: IpcRendererEvent, data: unknown) => callback(data));
  },
  
  onLive2dCommand: (callback: (data: unknown) => void) => {
    ipcRenderer.on('live2d-command', (_event: IpcRendererEvent, data: unknown) => callback(data));
  },

  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', () => callback());
  },

  onOpenPlugins: (callback: () => void) => {
    ipcRenderer.on('open-plugins', () => callback());
  },

  onOpenChat: (callback: () => void) => {
    ipcRenderer.on('open-chat', () => callback());
  },

  onToggleUI: (callback: () => void) => {
    ipcRenderer.on('toggle-ui', () => callback());
  },
  
  // 内置 Agent 管理
  agentSetPort: (port: number) => ipcRenderer.invoke('agent:set-port', port),
  agentStart: () => ipcRenderer.invoke('agent:start'),
  agentStop: () => ipcRenderer.invoke('agent:stop'),
  agentGetStatus: () => ipcRenderer.invoke('agent:status'),
  agentGetUrl: () => ipcRenderer.invoke('agent:get-url'),
  
  agentGetProviders: () => ipcRenderer.invoke('agent:get-providers'),
  agentAddProviderInstance: (instanceConfig: any) => ipcRenderer.invoke('agent:add-provider-instance', instanceConfig),
  agentRemoveProviderInstance: (instanceId: string) => ipcRenderer.invoke('agent:remove-provider-instance', instanceId),
  agentUpdateProviderInstance: (instanceId: string, config: any) => ipcRenderer.invoke('agent:update-provider-instance', instanceId, config),
  agentInitProviderInstance: (instanceId: string) => ipcRenderer.invoke('agent:init-provider-instance', instanceId),
  agentTestProviderInstance: (instanceId: string) => ipcRenderer.invoke('agent:test-provider-instance', instanceId),
  agentSetPrimaryProvider: (instanceId: string) => ipcRenderer.invoke('agent:set-primary-provider', instanceId),
  agentDisconnectProviderInstance: (instanceId: string) => ipcRenderer.invoke('agent:disconnect-provider-instance', instanceId),
  agentEnableProviderInstance: (instanceId: string) => ipcRenderer.invoke('agent:enable-provider-instance', instanceId),
  agentDisableProviderInstance: (instanceId: string) => ipcRenderer.invoke('agent:disable-provider-instance', instanceId),
  agentGetPipeline: () => ipcRenderer.invoke('agent:get-pipeline'),
  
  // TTS Provider 管理
  agentGetTTSProviders: () => ipcRenderer.invoke('agent:get-tts-providers'),
  agentAddTTSInstance: (instanceConfig: any) => ipcRenderer.invoke('agent:add-tts-instance', instanceConfig),
  agentRemoveTTSInstance: (instanceId: string) => ipcRenderer.invoke('agent:remove-tts-instance', instanceId),
  agentUpdateTTSInstance: (instanceId: string, config: any) => ipcRenderer.invoke('agent:update-tts-instance', instanceId, config),
  agentInitTTSInstance: (instanceId: string) => ipcRenderer.invoke('agent:init-tts-instance', instanceId),
  agentTestTTSInstance: (instanceId: string) => ipcRenderer.invoke('agent:test-tts-instance', instanceId),
  agentSetPrimaryTTS: (instanceId: string) => ipcRenderer.invoke('agent:set-primary-tts', instanceId),
  agentDisconnectTTSInstance: (instanceId: string) => ipcRenderer.invoke('agent:disconnect-tts-instance', instanceId),
  agentEnableTTSInstance: (instanceId: string) => ipcRenderer.invoke('agent:enable-tts-instance', instanceId),
  agentDisableTTSInstance: (instanceId: string) => ipcRenderer.invoke('agent:disable-tts-instance', instanceId),
  agentGetTTSVoices: (instanceId: string) => ipcRenderer.invoke('agent:get-tts-voices', instanceId),
  
  // 工具管理
  agentGetTools: () => ipcRenderer.invoke('agent:get-tools'),
  agentSetToolEnabled: (toolId: string, enabled: boolean) => ipcRenderer.invoke('agent:set-tool-enabled', toolId, enabled),
  agentDeleteTool: (toolId: string) => ipcRenderer.invoke('agent:delete-tool', toolId),
  agentGetToolStats: () => ipcRenderer.invoke('agent:get-tool-stats'),
  agentSetToolCallingEnabled: (enabled: boolean) => ipcRenderer.invoke('agent:set-tool-calling-enabled', enabled),
  agentSetCommandFilterEnabled: (enabled: boolean) => ipcRenderer.invoke('agent:set-command-filter-enabled', enabled),
  agentGetCommandFilterEnabled: () => ipcRenderer.invoke('agent:get-command-filter-enabled'),
  onAgentToolsChanged: (callback: () => void) => {
    ipcRenderer.on('agent-tools-changed', () => callback());
  },
  
  // MCP 管理
  agentGetMCPServers: () => ipcRenderer.invoke('agent:get-mcp-servers'),
  agentAddMCPServer: (config: any) => ipcRenderer.invoke('agent:add-mcp-server', config),
  agentRemoveMCPServer: (name: string) => ipcRenderer.invoke('agent:remove-mcp-server', name),
  agentConnectMCPServer: (name: string) => ipcRenderer.invoke('agent:connect-mcp-server', name),
  agentDisconnectMCPServer: (name: string) => ipcRenderer.invoke('agent:disconnect-mcp-server', name),
  
  // Agent 插件管理
  agentGetPlugins: () => ipcRenderer.invoke('agent:get-plugins'),
  agentActivatePlugin: (name: string) => ipcRenderer.invoke('agent:activate-plugin', name),
  agentDeactivatePlugin: (name: string) => ipcRenderer.invoke('agent:deactivate-plugin', name),
  agentReloadPlugin: (name: string) => ipcRenderer.invoke('agent:reload-plugin', name),
  agentUninstallPlugin: (name: string) => ipcRenderer.invoke('agent:uninstall-plugin', name),
  agentSavePluginConfig: (name: string, config: any) => ipcRenderer.invoke('agent:save-plugin-config', name, config),
  agentOpenPluginsDir: () => ipcRenderer.invoke('agent:open-plugins-dir'),
  agentOpenPluginDataDir: (name: string) => ipcRenderer.invoke('agent:open-plugin-data-dir', name),
  agentClearPluginData: (name: string) => ipcRenderer.invoke('agent:clear-plugin-data', name),
  
  // 指令系统
  agentGetCommands: () => ipcRenderer.invoke('agent:get-commands'),
  agentSetCommandEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('agent:set-command-enabled', name, enabled),
  
  // 对话管理
  agentGetConversations: (limit?: number) => ipcRenderer.invoke('agent:get-conversations', limit),
  agentGetMessages: (conversationId: string) => ipcRenderer.invoke('agent:get-messages', conversationId),
  agentNewConversation: () => ipcRenderer.invoke('agent:new-conversation'),
  agentSwitchConversation: (conversationId: string) => ipcRenderer.invoke('agent:switch-conversation', conversationId),
  agentDeleteConversation: (conversationId: string) => ipcRenderer.invoke('agent:delete-conversation', conversationId),
  agentGetCurrentConversation: () => ipcRenderer.invoke('agent:get-current-conversation'),
  
  onOpenAgent: (callback: () => void) => {
    ipcRenderer.on('open-agent', () => callback());
  },
  
  onAgentStatusChanged: (callback: (status: any) => void) => {
    ipcRenderer.on('agent-status-changed', (_event: IpcRendererEvent, status: any) => callback(status));
  },
  
  notifyBackendModeChanged: (mode: 'builtin' | 'custom') => {
    ipcRenderer.send('backend-mode-changed', mode);
  },
  
  // 插件目录管理
  openPluginDirectory: (pluginName: string) => {
    return ipcRenderer.invoke('plugin:open-directory', { name: pluginName });
  },
  
  openPluginDataDirectory: (pluginName: string) => {
    return ipcRenderer.invoke('plugin:open-data-directory', { name: pluginName });
  },
  
  clearPluginData: (pluginName: string) => {
    return ipcRenderer.invoke('plugin:clear-data', { name: pluginName });
  },
  
  // 通用 IPC 调用（用于插件管理等扩展功能）
  invoke: (channel: string, ...args: any[]) => {
    return ipcRenderer.invoke(channel, ...args);
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
