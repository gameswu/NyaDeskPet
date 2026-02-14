// 全局类型定义
import type { Application } from 'pixi.js';

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

// Electron API 类型
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
  
  // 监听来自主进程的消息
  onBackendMessage: (callback: (data: unknown) => void) => void;
  onVoicePlay: (callback: (data: unknown) => void) => void;
  onLive2dCommand: (callback: (data: unknown) => void) => void;
  onOpenSettings: (callback: () => void) => void;
  onOpenPlugins: (callback: () => void) => void;
  onOpenChat: (callback: () => void) => void;
  onToggleUI: (callback: () => void) => void;
  
  // 内置 Agent 管理
  agentSetPort: (port: number) => Promise<{ success: boolean; error?: string }>;
  agentStart: () => Promise<{ success: boolean; running?: boolean; port?: number; host?: string; error?: string }>;
  agentStop: () => Promise<{ success: boolean; error?: string }>;
  agentGetStatus: () => Promise<AgentServerStatus>;
  agentGetUrl: () => Promise<{ wsUrl: string; httpUrl: string }>;
  agentGetProviders: () => Promise<AgentProvidersInfo>;
  agentAddProviderInstance: (instanceConfig: AgentProviderInstanceConfig) => Promise<{ success: boolean }>;
  agentRemoveProviderInstance: (instanceId: string) => Promise<{ success: boolean }>;
  agentUpdateProviderInstance: (instanceId: string, config: Partial<AgentProviderInstanceConfig>) => Promise<{ success: boolean }>;
  agentInitProviderInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentTestProviderInstance: (instanceId: string) => Promise<{ success: boolean; error?: string; model?: string }>;
  agentSetPrimaryProvider: (instanceId: string) => Promise<{ success: boolean }>;
  agentDisconnectProviderInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentEnableProviderInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentDisableProviderInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentGetPipeline: () => Promise<{ stages: string[] }>;

  // TTS Provider 管理
  agentGetTTSProviders: () => Promise<{ providerTypes: AgentProviderMetadata[]; instances: AgentProviderInstanceInfo[] }>;
  agentAddTTSInstance: (instanceConfig: AgentProviderInstanceConfig) => Promise<{ success: boolean }>;
  agentRemoveTTSInstance: (instanceId: string) => Promise<{ success: boolean }>;
  agentUpdateTTSInstance: (instanceId: string, config: Partial<AgentProviderInstanceConfig>) => Promise<{ success: boolean }>;
  agentInitTTSInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentTestTTSInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentSetPrimaryTTS: (instanceId: string) => Promise<{ success: boolean }>;
  agentDisconnectTTSInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentEnableTTSInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentDisableTTSInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
  agentGetTTSVoices: (instanceId: string) => Promise<Array<{ id: string; name: string; description?: string }>>;

  onOpenAgent: (callback: () => void) => void;
  onAgentStatusChanged: (callback: (status: AgentServerStatus) => void) => void;
  notifyBackendModeChanged: (mode: 'builtin' | 'custom') => void;
  
  // 工具管理
  agentGetTools: () => Promise<AgentToolInfo[]>;
  agentSetToolEnabled: (toolId: string, enabled: boolean) => Promise<{ success: boolean }>;
  agentDeleteTool: (toolId: string) => Promise<{ success: boolean }>;
  agentGetToolStats: () => Promise<{ total: number; enabled: number; function: number; mcp: number }>;
  agentSetToolCallingEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
  onAgentToolsChanged: (callback: () => void) => void;
  
  // MCP 管理
  agentGetMCPServers: () => Promise<{ configs: MCPServerInfo[]; statuses: MCPServerStatusInfo[] }>;
  agentAddMCPServer: (config: MCPServerInfo) => Promise<{ success: boolean; error?: string }>;
  agentRemoveMCPServer: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentConnectMCPServer: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentDisconnectMCPServer: (name: string) => Promise<{ success: boolean; error?: string }>;
  
  // Agent 插件管理
  agentGetPlugins: () => Promise<AgentPluginInfo[]>;
  agentActivatePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentDeactivatePlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentReloadPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentUninstallPlugin: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentSavePluginConfig: (name: string, config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  agentOpenPluginsDir: () => Promise<{ success: boolean }>;
  agentOpenPluginDataDir: (name: string) => Promise<{ success: boolean; error?: string }>;
  agentClearPluginData: (name: string) => Promise<{ success: boolean; error?: string }>;
  
  // 指令系统
  agentGetCommands: () => Promise<CommandDefinition[]>;
  agentSetCommandEnabled: (name: string, enabled: boolean) => Promise<{ success: boolean }>;
  
  // 对话管理
  agentGetConversations: (limit?: number) => Promise<ConversationItem[]>;
  agentGetMessages: (conversationId: string) => Promise<ConversationMessage[]>;
  agentNewConversation: () => Promise<{ success: boolean; conversationId?: string; error?: string }>;
  agentSwitchConversation: (conversationId: string) => Promise<{ success: boolean; error?: string }>;
  agentDeleteConversation: (conversationId: string) => Promise<{ success: boolean; error?: string }>;
  agentGetCurrentConversation: () => Promise<{ conversationId: string | null }>;
  
  // 通用 IPC 调用（用于插件管理等扩展功能）
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  
  // 插件目录管理
  openPluginDirectory: (pluginName: string) => Promise<{ success: boolean }>;
  openPluginDataDirectory: (pluginName: string) => Promise<{ success: boolean }>;
  clearPluginData: (pluginName: string) => Promise<{ success: boolean; error?: string }>;
  
  // 状态同步
  updateUIState: (state: { uiVisible?: boolean; chatOpen?: boolean }) => void;
}

// 扩展 Window 接口
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    live2dManager: Live2DManager;
    backendClient: BackendClient;
    dialogueManager: DialogueManager;
    audioPlayer: AudioPlayer;
    settingsManager: SettingsManager;
    i18nManager: I18nManager;
    themeManager: ThemeManager;
    pluginConnector: PluginConnector;
    pluginUI: PluginUI;
    pluginConfigManager: PluginConfigManager;
    pluginConfigUI: PluginConfigUI;
    pluginPermissionManager: PluginPermissionManager;
    cameraManager: CameraManager;
    microphoneManager: MicrophoneManager;
    responseController: ResponseController;
    logger: any;
    app: AppDebugInterface;
    PIXI: typeof import('pixi.js');
    lucide?: {
      createIcons: () => void;
    };
  }
}

// Live2D 相关类型
export interface Live2DModel {
  scale: { set: (value: number) => void };
  x: number;
  y: number;
  anchor: { set: (x: number, y: number) => void };
  motion?: (group: string, index: number, priority: number) => void;
  expression?: (expressionId: string) => void;
  destroy?: () => void;
  internalModel?: {
    coreModel: {
      addParameterValueById: (id: string, value: number) => void;
      getParameterValueById: (id: string) => number;
      getParameterMinValueById: (id: string) => number;
      getParameterMaxValueById: (id: string) => number;
      getParameterDefaultValueById: (id: string) => number;
      // Cubism 4 包装类需要通过 getModel() 访问原生模型
      getModel?: () => {
        parameters: {
          count: number;
          ids: string[];
          values: Float32Array;
          minimumValues: Float32Array;
          maximumValues: Float32Array;
          defaultValues: Float32Array;
        };
      };
    };
    motionManager?: {
      definitions?: {
        [group: string]: any[];
      };
    };
    settings?: {
      expressions?: any[];
    };
    hitAreas?: Array<{
      name?: string;
      Name?: string;
      id?: string;
      Id?: string;
    }>;
  };
}

/** 参数映射表配置（模型目录下的 param-map.json） */
export interface ParamMapConfig {
  version: number;
  parameters?: Array<{
    id: string;          // Live2D 原始参数 ID
    alias: string;       // LLM 友好的语义别名
    description: string; // 参数功能描述
  }>;
  expressions?: Array<{
    id: string;          // 原始表情 ID
    alias: string;       // 语义别名
    description: string; // 表情效果描述
  }>;
  motions?: Array<{
    group: string;       // 原始动作组名
    index: number;       // 组内动作索引
    alias: string;       // 语义别名
    description: string; // 动作效果描述
  }>;
}

// Live2D模型信息类型
export interface ModelInfo {
  available: boolean;
  modelPath: string;
  dimensions: {
    width: number;
    height: number;
  };
  motions: {
    [group: string]: {
      count: number;
      files: string[];
    };
  };
  expressions: string[];
  hitAreas: string[];
  availableParameters: Array<{
    id: string;
    value: number;
    min: number;
    max: number;
    default: number;
  }>;
  parameters: {
    canScale: boolean;
    currentScale: number;
    userScale: number;
    baseScale: number;
  };
  // 参数映射表（当模型目录存在 param-map.json 时填充）
  mappedParameters?: Array<{
    id: string;          // 原始参数 ID
    alias: string;       // 语义别名
    description: string; // 功能描述
    min: number;
    max: number;
    default: number;
  }>;
  mappedExpressions?: Array<{
    id: string;          // 原始表情 ID
    alias: string;       // 语义别名
    description: string; // 效果描述
  }>;
  mappedMotions?: Array<{
    group: string;       // 原始动作组名
    index: number;       // 组内动作索引
    alias: string;       // 语义别名
    description: string; // 效果描述
  }>;
}

// 同步指令类型
export interface SyncCommandData {
  actions: Array<SyncAction>;
}

export interface SyncAction {
  type: 'motion' | 'expression' | 'dialogue' | 'parameter';
  waitComplete?: boolean;
  /** 过渡动画时长（ms），用于 parameter 类型的缓动过渡 */
  duration?: number;
  // motion
  group?: string;
  index?: number;
  priority?: number;
  // expression
  expressionId?: string;
  // dialogue
  text?: string;
  // parameter（数组格式）
  parameters?: Array<{
    id: string;
    value: number;
    blend?: number;
    /** 过渡动画时长（ms） */
    duration?: number;
  }>;
  // parameter（扁平格式，来自 protocol-adapter）
  parameterId?: string;
  value?: number;
  weight?: number;
}

// 时间轴项类型
export interface TimelineItem {
  timing: string | number;
  action: 'motion' | 'expression' | 'parameter';
  // motion
  group?: string;
  index?: number;
  priority?: number;
  // expression
  expressionId?: string;
  // parameter
  parameters?: Array<{
    id: string;
    value: number;
    blend?: number;
  }>;
}

// 角色信息类型
export interface CharacterInfo {
  useCustom: boolean;
  name?: string;
  personality?: string;
}

// 文件上传数据类型
export interface FileUploadData {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileData: string;  // base64编码的文件数据
  timestamp: number;
}

// 插件调用数据类型
export interface PluginInvokeData {
  requestId: string;
  pluginId: string;
  action: string;
  params: Record<string, unknown>;
  timeout?: number;
}

// 插件富内容类型
export interface PluginTextContent {
  type: 'text';
  content: {
    text: string;
    format?: 'plain' | 'markdown' | 'html';
  };
}

export interface PluginImageContent {
  type: 'image';
  content: {
    data: string; // Base64编码
    format: 'png' | 'jpeg' | 'gif' | 'webp';
    width: number;
    height: number;
    filename?: string;
  };
}

export interface PluginFileContent {
  type: 'file';
  content: {
    filename: string;
    size: number;
    mimeType: string;
    data?: string; // Base64编码的文件内容
    path?: string; // 本地文件路径
  };
}

export interface PluginDataContent {
  type: 'data';
  content: Record<string, unknown>;
}

export interface PluginMixedContent {
  type: 'mixed';
  content: Array<PluginTextContent | PluginImageContent | PluginFileContent | PluginDataContent>;
}

export type PluginResultContent = 
  | PluginTextContent 
  | PluginImageContent 
  | PluginFileContent 
  | PluginDataContent 
  | PluginMixedContent;

// 插件响应数据类型
export interface PluginResponseData {
  pluginId: string;
  requestId: string;
  success: boolean;
  action: string;
  result?: PluginResultContent; // 必须使用标准富内容格式
  error?: string;
  timestamp: number;
}

/** 前端插件状态数据（发送给后端 Agent，通知已连接的前端插件列表） */
export interface PluginStatusData {
  plugins: Array<{
    pluginId: string;
    pluginName: string;
    capabilities: string[];
  }>;
}

/** 前端插件主动发送的消息（插件主动发起，交给后端 Agent 处理并持久化） */
export interface PluginMessageData {
  pluginId: string;
  pluginName?: string;
  /** 插件消息文本内容 */
  text: string;
  /** 可选：插件提供的额外结构化数据 */
  metadata?: Record<string, unknown>;
}

// Tap配置记录类型
export interface TapConfigRecord {
  [modelPath: string]: TapConfig;
}

export interface Live2DManagerConfig {
  canvasId: string;
}

export interface Live2DManager {
  canvas: HTMLCanvasElement;
  app: Application | null;
  model: Live2DModel | null;
  currentMotion: string | null;
  currentExpression: string | null;
  initialized: boolean;
  initialize(): Promise<boolean>;
  loadModel(modelPath: string): Promise<boolean>;
  adjustModelTransform(): void;
  playMotion(motionGroup: string, motionIndex?: number, priority?: number): void;
  setExpression(expressionId: string): void;
  lookAt(x: number, y: number): void;
  tap(x: number, y: number): void;
  destroy(): void;
  extractModelInfo(): ModelInfo | null;
  isTapEnabled(hitAreaName: string): boolean;
  loadTapConfig(): TapConfig;
  executeSyncCommand(data: SyncCommandData): Promise<void>;
  setLipSync(value: number): void;
  stopLipSync(): void;
  enableEyeTracking(enabled: boolean): void;
  isEyeTrackingEnabled(): boolean;
  /** 设置参数（带缓动过渡动画） duration 为过渡动画时长（ms） */
  setParameter(parameterId: string, value: number, weight?: number, duration?: number): void;
  setParameters(params: Array<{id: string, value: number, blend?: number, duration?: number}>): void;
  getAvailableParameters(): Array<{id: string, value: number, min: number, max: number, default: number}>;
  clearParameterOverrides(): void;
}

// 后端通信相关类型
// 插件权限信息
export interface PluginPermission {
  id: string;
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  i18n: {
    [locale: string]: {
      name: string;
      description: string;
    };
  };
}

// 插件配置Schema类型
export type PluginConfigType = 'string' | 'text' | 'int' | 'float' | 'bool' | 'object' | 'list' | 'dict' | 'template_list';

export interface PluginConfigSchema {
  type: PluginConfigType;
  description?: string;
  hint?: string;
  obvious_hint?: boolean;
  default?: any;
  items?: { [key: string]: PluginConfigSchema };  // 用于 object 类型
  invisible?: boolean;
  options?: string[];
  editor_mode?: boolean;
  editor_language?: string;
  // 以下为国际化支持
  i18n?: {
    [locale: string]: {
      description?: string;
      hint?: string;
      options?: string[];  // 选项的翻译
    };
  };
}

export interface PluginConfigDefinition {
  [key: string]: PluginConfigSchema;
}

// 插件权限审批记录
export interface PluginPermissionGrant {
  pluginId: string;
  permissionId: string;
  granted: boolean;
  remember: boolean;
  timestamp: number;
}

// 插件清单类型
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  type: string;
  url: string;
  autoStart: boolean;
  permissions: PluginPermission[];
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
  config?: PluginConfigDefinition;  // 插件配置定义（可选）
}

// 插件信息类型
export interface PluginInfo {
  manifest: PluginManifest;
  ws: WebSocket | null;
  status: 'stopped' | 'starting' | 'running' | 'connected' | 'error';
  processId: number | null;
  locale: string;
  reconnectTimer: number | null;
  reconnectAttempts: number;
  directoryName: string;  // 插件所在的文件夹名称
}

// 插件连接器接口
export interface PluginConnector {
  startPlugin(name: string): Promise<boolean>;
  stopPlugin(name: string): Promise<boolean>;
  connectPlugin(name: string): Promise<boolean>;
  disconnectPlugin(name: string): void;
  callPlugin(name: string, action: string, params: any): Promise<any>;
  setPluginLocale(name: string, locale: string): Promise<void>;
  getPlugins(): PluginInfo[];
  getPlugin(name: string): PluginInfo | undefined;
  getPluginI18n(name: string): { displayName: string; description: string; category: string } | null;
  handlePluginInvoke(data: PluginInvokeData): Promise<void>;
  connectAll(): Promise<void>;
  disconnectAll(): void;
}

// 插件UI接口
export interface PluginUI {
  renderPlugins(): void;
}

// 插件配置管理器接口
export interface PluginConfigManager {
  getConfig(pluginId: string): Promise<{ [key: string]: any }>;
  saveConfig(pluginId: string, config: { [key: string]: any }): Promise<boolean>;
  resetConfig(pluginId: string, schema: PluginConfigDefinition): Promise<boolean>;
  getDefaultConfig(schema: PluginConfigDefinition): { [key: string]: any };
  validateConfig(schema: PluginConfigDefinition, config: { [key: string]: any }): { valid: boolean; errors: string[] };
  getLocalizedField(field: PluginConfigSchema, locale: string, fieldName: 'description' | 'hint'): string;
  getLocalizedOptions(field: PluginConfigSchema, locale: string): string[];
}

// 插件配置UI接口
export interface PluginConfigUI {
  showConfigDialog(pluginId: string, pluginName: string, schema: PluginConfigDefinition): Promise<void>;
  addListItem(key: string): void;
  removeListItem(key: string, index: number): void;
  saveConfig(): Promise<void>;
  resetConfig(): Promise<void>;
}

// 插件权限管理器接口
export interface PluginPermissionManager {
  checkPermission(pluginId: string, permissionId: string, dangerLevel: string): Promise<boolean>;
  grantPermission(pluginId: string, permissionId: string, remember: boolean): Promise<void>;
  revokePermission(pluginId: string, permissionId: string): Promise<void>;
  getGrantedPermissions(pluginId: string): Promise<string[]>;
  clearPermissions(pluginId: string): Promise<void>;
}

export interface BackendConfig {
  httpUrl?: string;
  wsUrl?: string;
}

export interface BackendMessage {
  type: 'dialogue' | 'dialogue_stream_start' | 'dialogue_stream_chunk' | 'dialogue_stream_end' | 'live2d' | 'system' | 'user_input' | 'model_info' | 'tap_event' | 'sync_command' | 'character_info' | 'audio_stream_start' | 'audio_chunk' | 'audio_stream_end' | 'file_upload' | 'plugin_invoke' | 'plugin_response' | 'plugin_status' | 'plugin_message' | 'tool_confirm' | 'tool_confirm_response' | 'commands_register' | 'command_execute' | 'command_response';
  data?: DialogueData | DialogueStreamStartData | DialogueStreamChunkData | DialogueStreamEndData | Live2DCommandData | AudioStreamStartData | AudioChunkData | AudioStreamEndData | SyncCommandData | ModelInfo | CharacterInfo | FileUploadData | PluginInvokeData | PluginResponseData | PluginStatusData | PluginMessageData | ToolConfirmData | ToolConfirmResponseData | CommandsRegisterData | CommandExecuteData | CommandResponseData | unknown;
  text?: string;
  timestamp?: number;
  action?: string;
  position?: { x: number; y: number };
  /** 响应会话 ID（同一次回复的所有消息共享相同 ID） */
  responseId?: string;
  /** 响应优先级（用于中断判断） */
  priority?: number;
  attachment?: {
    type: 'image' | 'file';
    url?: string;
    data?: string;
    source?: string;
    name?: string;
  };
}

export interface DialogueData {
  text: string;
  duration?: number;
  reasoningContent?: string;
  attachment?: {
    type: 'image' | 'file';
    url: string;
    name?: string;
  };
}

/** 流式对话开始 */
export interface DialogueStreamStartData {
  /** 流式会话 ID */
  streamId: string;
}

/** 流式对话增量块 */
export interface DialogueStreamChunkData {
  streamId: string;
  /** 增量文本 */
  delta: string;
  /** 思维链增量（如有） */
  reasoningDelta?: string;
}

/** 流式对话结束 */
export interface DialogueStreamEndData {
  streamId: string;
  /** 完整文本（可选，用于校验） */
  fullText?: string;
  /** 显示时长 */
  duration?: number;
}

/** 工具调用确认请求（后端→前端） */
export interface ToolConfirmData {
  /** 确认请求 ID */
  confirmId: string;
  /** 工具调用列表 */
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    /** 工具来源 */
    source: 'function' | 'mcp' | 'plugin';
    /** 工具描述 */
    description?: string;
  }>;
  /** 超时时间（毫秒），超时自动拒绝 */
  timeout: number;
}

/** 工具调用确认响应（前端→后端） */
export interface ToolConfirmResponseData {
  confirmId: string;
  /** 是否批准 */
  approved: boolean;
  /** 用户是否选择「记住此操作」 */
  remember?: boolean;
}

// ============ 对话管理类型 ============

/** 对话列表项 */
export interface ConversationItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** 对话消息 */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  type: string;
  content: string;
  extra: string;
  createdAt: number;
}

// ============ 指令系统类型 ============

/** 指令参数定义 */
export interface CommandParam {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: unknown;
  choices?: Array<{ name: string; value: string | number }>;
}

/** 指令定义 */
export interface CommandDefinition {
  name: string;
  description: string;
  params?: CommandParam[];
  category?: string;
  source?: string;
  enabled?: boolean;
}

/** 指令注册消息数据（后端→前端） */
export interface CommandsRegisterData {
  commands: CommandDefinition[];
}

/** 指令执行请求（前端→后端） */
export interface CommandExecuteData {
  command: string;
  args: Record<string, unknown>;
}

/** 指令执行结果（后端→前端） */
export interface CommandResponseData {
  command: string;
  success: boolean;
  text?: string;
  error?: string;
}

export interface AudioStreamStartData {
  mimeType: string;
  totalDuration?: number;
  text?: string;
  timeline?: TimelineItem[];
}

export interface AudioChunkData {
  chunk: string;  // base64
  sequence: number;
}

export interface AudioStreamEndData {
  complete: boolean;
}

export interface Live2DCommandData {
  command: 'motion' | 'expression' | 'parameter';
  group?: string;
  index?: number;
  priority?: number;
  expressionId?: string;
  parameterId?: string;
  value?: number;
  weight?: number;
  parameters?: Array<{id: string, value: number, blend?: number}>;
}

export interface BackendClient {
  httpUrl: string;
  wsUrl: string;
  ws: WebSocket | null;
  reconnectInterval: number;
  reconnectTimer: number | null;
  isConnecting: boolean;
  messageHandlers: Array<(message: BackendMessage) => void>;
  statusIndicator: HTMLElement | null;
  initialize(): Promise<boolean>;
  connectWebSocket(): Promise<boolean>;
  handleMessage(data: string): void;
  handleDialogue(data: DialogueData): void;
  handleLive2DCommand(data: Live2DCommandData): void;
  handleSystemMessage(data: unknown): void;
  sendMessage(message: BackendMessage): Promise<{ success: boolean; method?: string; data?: unknown; error?: string }>;
  sendHTTP(message: BackendMessage): Promise<{ success: boolean; method: string; data?: unknown; error?: string }>;
  onMessage(handler: (message: BackendMessage) => void): void;
  updateStatus(status: 'connected' | 'disconnected' | 'connecting'): void;
  scheduleReconnect(): void;
  clearReconnectTimer(): void;
  disconnect(): void;
  getRegisteredCommands(): CommandDefinition[];
  executeCommand(command: string, args?: Record<string, unknown>): Promise<void>;
}

// 对话管理器类型
export interface DialogueManager {
  dialogueBox: HTMLElement;
  dialogueText: HTMLElement;
  dialogueProgress: HTMLElement;
  isShowing: boolean;
  currentTimeout: number | null;
  typewriterTimeout: number | null;
  showDialogue(text: string, duration?: number, typewriter?: boolean): void;
  typewriterEffect(text: string, duration: number): void;
  startAutoHide(duration: number): void;
  hideDialogue(): void;
  clearTimeouts(): void;
  appendText(text: string): void;
  showQuick(text: string, duration?: number): void;
}

// 音频播放器类型
export interface AudioPlayer {
  audioContext: AudioContext | null;
  currentAudio: HTMLAudioElement | null;
  isPlaying: boolean;
  volume: number;
  initAudioContext(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setVolume(volume: number): void;
  getStatus(): {
    isPlaying: boolean;
    volume: number;
    currentTime: number;
    duration: number;
  };
  startStreamingAudio(mimeType: string): void;
  appendAudioChunk(chunk: Uint8Array): void;
  endStream(): void;
  setTimeline(timeline: Array<{timing: string | number, callback: () => void}>, totalDuration?: number): void;
  startTimeline(): void;
}

// 应用配置类型
export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  modelPath: string;
  backendMode: 'builtin' | 'custom';
  agentPort: number;
  backendUrl: string;
  wsUrl: string;
  autoConnect: boolean;
  volume: number;
  updateSource: string;
  locale: string;
  theme: ThemeMode;
  showSubtitle: boolean;
  tapConfigs: { [modelPath: string]: TapConfig };
  useCustomCharacter: boolean;
  customName: string;
  customPersonality: string;
  micBackgroundMode: boolean;
  micVolumeThreshold: number;
  micAutoSend: boolean;
  enableEyeTracking: boolean;
  autoLaunch: boolean;
  logEnabled: boolean;
  logLevels: string[];
  logRetentionDays: number;
}

// 触碰配置类型
export interface TapConfig {
  [hitArea: string]: {
    enabled: boolean;
    description?: string;
  };
}

export interface AppConfig {
  modelPath: string;
  backendUrl: string;
  wsUrl: string;
  autoConnect: boolean;
}

// 设置管理器类型
export interface SettingsManager {
  initialize(): void;
  getSettings(): AppSettings;
  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K];
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void;
  updateSettings(updates: Partial<AppSettings>): void;
  resetToDefaults(): void;
  validateSettings(): { valid: boolean; errors: string[] };
  exportSettings(): string;
  importSettings(json: string): boolean;
  getTapConfig(modelPath: string): TapConfig;
  updateTapConfig(modelPath: string, config: TapConfig): void;
  getCurrentTapConfig(): TapConfig;
}

export interface AppState {
  initialized: boolean;
  modelLoaded: boolean;
  connected: boolean;
  asrReady?: boolean;
}

export interface AppDebugInterface {
  sendMessage: (text: string) => Promise<void>;
  showDialogue: (text: string, duration?: number) => void;
  playMotion: (group: string, index?: number) => void;
  setExpression: (id: string) => void;
  getState: () => AppState;
  showSettings: () => void;
  showChat: () => void;
  toggleUI: () => void;
}

// 国际化管理器接口
export interface I18nManager {
  currentLocale: string;
  initialize(): Promise<void>;
  t(key: string, params?: { [key: string]: string }): string;
  setLocale(locale: string): Promise<void>;
  getLocale(): string;
  getAvailableLocales(): Array<{ code: string; name: string }>;
  applyTranslations(): void;
}

// 主题管理器接口
export interface ThemeManager {
  initialize(): void;
  setTheme(theme: ThemeMode): void;
  getTheme(): ThemeMode;
  getEffectiveTheme(): 'light' | 'dark';
}

// ============ 内置 Agent 服务器状态 ============
export interface AgentServerStatus {
  running: boolean;
  port: number;
  host: string;
  connectedClients: number;
  startTime: number | null;
}

// Provider 配置字段描述
export interface AgentProviderConfigField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'number' | 'select' | 'boolean';
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

// Provider 元信息
export interface AgentProviderMetadata {
  id: string;
  name: string;
  description: string;
  configSchema: AgentProviderConfigField[];
}

// Provider 实例信息
export interface AgentProviderInstanceInfo {
  instanceId: string;
  providerId: string;
  displayName: string;
  config: Record<string, unknown>;
  metadata: AgentProviderMetadata | undefined;
  enabled: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error?: string;
  isPrimary: boolean;
}

// Provider 实例配置（创建/更新用）
export interface AgentProviderInstanceConfig {
  instanceId: string;
  providerId: string;
  displayName: string;
  config: Record<string, unknown>;
}

// Provider 列表信息
export interface AgentProvidersInfo {
  providerTypes: AgentProviderMetadata[];
  instances: AgentProviderInstanceInfo[];
}

// ============ 工具信息接口 ============
export interface AgentToolInfo {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: 'function' | 'mcp' | 'plugin';
  mcpServer?: string;
  enabled: boolean;
  i18n?: Record<string, { description?: string }>;
}

// ============ MCP 服务器接口 ============
export interface MCPServerInfo {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  url?: string;
  env?: Record<string, string>;
  workingDirectory?: string;
  autoStart?: boolean;
  enabled?: boolean;
  description?: string;
}

export interface MCPServerStatusInfo {
  name: string;
  connected: boolean;
  toolCount: number;
  error?: string;
  lastConnectedAt?: string;
}

// ============ 响应控制器接口 ============
export interface ResponseSession {
  responseId: string;
  priority: number;
  startTime: number;
  hasActiveAudio: boolean;
}

export interface ResponseController {
  shouldAccept(responseId: string, priority: number): boolean;
  isActive(responseId: string | undefined): boolean;
  markAudioActive(): void;
  notifyComplete(responseId?: string): void;
  getCurrentSession(): ResponseSession | null;
}

// ============ Agent 插件接口 ============
export type AgentPluginStatus = 'loaded' | 'active' | 'error' | 'disabled';

export interface AgentPluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  description: string;
  default?: unknown;
  options?: { value: string; label: string }[];
}

export type AgentPluginConfigSchema = Record<string, AgentPluginConfigField>;

export interface AgentPluginInfo {
  name: string;
  author: string;
  desc: string;
  version: string;
  repo?: string;
  status: AgentPluginStatus;
  error?: string;
  configSchema?: AgentPluginConfigSchema;
  config?: Record<string, unknown>;
  toolCount: number;
  dirName: string;
  i18n?: Record<string, { desc?: string }>;
}

// ============ 摄像头管理器接口 ============
export interface CameraManager {
  initialize(): Promise<void>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  getDevices(): MediaDeviceInfo[];
  start(deviceId?: string): Promise<void>;
  stop(): void;
  switchDevice(deviceId: string): Promise<void>;
  getCurrentDeviceId(): string | null;
  isRunning(): boolean;
  captureFrame(): Promise<string | null>;
  destroy(): void;
}

// ============ 麦克风管理器接口 ============
export interface MicrophoneManager {
  initialize(): Promise<void>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  getDevices(): MediaDeviceInfo[];
  startListening(deviceId?: string): Promise<void>;
  stopListening(): void;
  setASRCallback(callback: (text: string) => void): void;
  setVolumeThreshold(threshold: number): void;
  getVolumeThreshold(): number;
  setBackgroundMode(enabled: boolean): void;
  isBackgroundModeEnabled(): boolean;
  switchDevice(deviceId: string): Promise<void>;
  getCurrentDeviceId(): string | null;
  isActive(): boolean;
  destroy(): void;
}

// ============ 安全模块接口 ============
