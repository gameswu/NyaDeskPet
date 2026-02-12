import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// 更新检查结果类型
export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: string;
  error?: string;
}

// 定义暴露给渲染进程的 API 类型
export interface ElectronAPI {
  // 窗口控制
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  showWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  toggleWindow: () => Promise<void>;
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => Promise<void>;
  getWindowPosition: () => Promise<{ x: number; y: number }>;
  getCursorScreenPoint: () => Promise<{ x: number; y: number }>;
  
  // 消息通信
  sendMessage: (message: unknown) => Promise<{ success: boolean; message: string }>;
  
  // UI状态更新
  updateUIState: (state: { uiVisible?: boolean; chatOpen?: boolean }) => void;
  
  // 文件选择
  selectModelFile: () => Promise<string | null>;
  
  // 更新检查
  checkUpdate: (updateSource: string) => Promise<UpdateCheckResult>;
  openExternal: (url: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
  
  // ASR 服务
  asrInitialize: () => Promise<{ success: boolean }>;
  asrIsReady: () => Promise<{ ready: boolean }>;
  asrRecognize: (audioData: string) => Promise<{ success: boolean; text?: string; confidence?: number; error?: string }>;
  
  // 日志系统
  loggerUpdateConfig: (config: any) => Promise<{ success: boolean }>;
  loggerGetConfig: () => Promise<any>;
  loggerGetFiles: () => Promise<Array<{ name: string; path: string; size: number; mtime: Date; isCurrent: boolean }>>;
  loggerDeleteFile: (fileName: string) => Promise<{ success: boolean }>;
  loggerDeleteAll: () => Promise<{ success: true; count: number }>;
  loggerOpenDirectory: () => Promise<{ success: boolean }>;
  loggerLog: (level: string, message: string, data?: any) => void;
  
  // 开机自启动
  setAutoLaunch: (enable: boolean) => Promise<{ success: boolean }>;
  getAutoLaunch: () => Promise<{ enabled: boolean }>;
  
  // 终端插件
  terminalExecute: (options: any) => Promise<any>;
  terminalGetSessions: () => Promise<any[]>;
  terminalCloseSession: (sessionId: string) => Promise<{ success: boolean }>;
  terminalSendInput: (sessionId: string, input: string) => Promise<{ success: boolean }>;
  terminalResize: (sessionId: string, cols: number, rows: number) => Promise<{ success: boolean }>;
  terminalGetCwd: (sessionId: string) => Promise<{ cwd: string | null }>;
  
  // UI自动化插件
  uiCaptureScreen: (options?: any) => Promise<any>;
  uiMouseClick: (options: any) => Promise<{ success: boolean; error?: string }>;
  uiMouseMove: (options: any) => Promise<{ success: boolean; error?: string }>;
  uiMouseDrag: (options: any) => Promise<{ success: boolean; error?: string }>;
  uiGetMousePosition: () => Promise<{ x: number; y: number }>;
  uiKeyboardType: (options: any) => Promise<{ success: boolean; error?: string }>;
  uiKeyboardPress: (options: any) => Promise<{ success: boolean; error?: string }>;
  uiMouseScroll: (deltaX: number, deltaY: number) => Promise<{ success: boolean; error?: string }>;
  uiGetScreenSize: () => Promise<{ width: number; height: number }>;
  uiSetMouseSpeed: (speed: number) => Promise<{ success: boolean }>;
  
  // 监听来自主进程的消息
  onBackendMessage: (callback: (data: unknown) => void) => void;
  onVoicePlay: (callback: (data: unknown) => void) => void;
  onLive2dCommand: (callback: (data: unknown) => void) => void;
  onOpenSettings: (callback: () => void) => void;
  onOpenPlugins: (callback: () => void) => void;
  onOpenChat: (callback: () => void) => void;
  onToggleUI: (callback: () => void) => void;
  
  // 内置 Agent 管理
  agentStart: () => Promise<any>;
  agentStop: () => Promise<any>;
  agentGetStatus: () => Promise<any>;
  agentGetUrl: () => Promise<{ wsUrl: string; httpUrl: string }>;
  onOpenAgent: (callback: () => void) => void;
  onAgentStatusChanged: (callback: (status: any) => void) => void;
  notifyBackendModeChanged: (mode: 'builtin' | 'custom') => void;
  
  // 工具管理
  agentGetTools: () => Promise<any[]>;
  agentSetToolEnabled: (toolId: string, enabled: boolean) => Promise<{ success: boolean }>;
  agentDeleteTool: (toolId: string) => Promise<{ success: boolean }>;
  agentGetToolStats: () => Promise<{ total: number; enabled: number; function: number; mcp: number }>;
  agentSetToolCallingEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
  
  // MCP 管理
  agentGetMCPServers: () => Promise<{ configs: any[]; statuses: any[] }>;
  agentAddMCPServer: (config: any) => Promise<{ success: boolean; error?: string }>;
  agentRemoveMCPServer: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentConnectMCPServer: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentDisconnectMCPServer: (name: string) => Promise<{ success: boolean; error?: string }>;
  
  // Agent 插件管理
  agentGetPlugins: () => Promise<any[]>;
  agentActivatePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentDeactivatePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentReloadPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentUninstallPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentSavePluginConfig: (name: string, config: any) => Promise<{ success: boolean; error?: string }>;
  agentOpenPluginsDir: () => Promise<{ success: boolean }>;
  
  // 插件管理
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}

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
  
  // 工具管理
  agentGetTools: () => ipcRenderer.invoke('agent:get-tools'),
  agentSetToolEnabled: (toolId: string, enabled: boolean) => ipcRenderer.invoke('agent:set-tool-enabled', toolId, enabled),
  agentDeleteTool: (toolId: string) => ipcRenderer.invoke('agent:delete-tool', toolId),
  agentGetToolStats: () => ipcRenderer.invoke('agent:get-tool-stats'),
  agentSetToolCallingEnabled: (enabled: boolean) => ipcRenderer.invoke('agent:set-tool-calling-enabled', enabled),
  
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
