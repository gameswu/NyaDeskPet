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
  
  // 消息通信
  sendMessage: (message: unknown) => Promise<{ success: boolean; message: string }>;
  
  // 文件选择
  selectModelFile: () => Promise<string | null>;
  
  // 更新检查
  checkUpdate: (updateSource: string) => Promise<UpdateCheckResult>;
  openExternal: (url: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
  
  // 监听来自主进程的消息
  onBackendMessage: (callback: (data: unknown) => void) => void;
  onVoicePlay: (callback: (data: unknown) => void) => void;
  onLive2dCommand: (callback: (data: unknown) => void) => void;
  onOpenSettings: (callback: () => void) => void;
  onOpenChat: (callback: () => void) => void;
  onToggleUI: (callback: () => void) => void;
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
  internalModel?: {
    coreModel: {
      addParameterValueById: (id: string, value: number) => void;
    };
  };
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
}

// 后端通信相关类型
export interface BackendConfig {
  httpUrl?: string;
  wsUrl?: string;
}

export interface BackendMessage {
  type: 'dialogue' | 'voice' | 'live2d' | 'system' | 'user_input' | 'interaction';
  data?: unknown;
  text?: string;
  timestamp?: number;
  action?: string;
  position?: { x: number; y: number };
}

export interface DialogueData {
  text: string;
  duration?: number;
}

export interface VoiceData {
  url?: string;
  base64?: string;
}

export interface Live2DCommandData {
  command: 'motion' | 'expression';
  group?: string;
  index?: number;
  priority?: number;
  expressionId?: string;
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
  handleVoice(data: VoiceData): void;
  handleLive2DCommand(data: Live2DCommandData): void;
  handleSystemMessage(data: unknown): void;
  sendMessage(message: BackendMessage): Promise<{ success: boolean; method?: string; data?: unknown; error?: string }>;
  sendHTTP(message: BackendMessage): Promise<{ success: boolean; method: string; data?: unknown; error?: string }>;
  onMessage(handler: (message: BackendMessage) => void): void;
  updateStatus(status: 'connected' | 'disconnected' | 'connecting'): void;
  scheduleReconnect(): void;
  clearReconnectTimer(): void;
  disconnect(): void;
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
  playAudio(source: string): Promise<boolean>;
  playLocalFile(filePath: string): Promise<boolean>;
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
}

// 应用配置类型
export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  modelPath: string;
  backendUrl: string;
  wsUrl: string;
  autoConnect: boolean;
  volume: number;
  updateSource: string;
  locale: string;
  theme: ThemeMode;
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
}

export interface AppState {
  initialized: boolean;
  modelLoaded: boolean;
  connected: boolean;
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
  initialize(): Promise<void>;
  t(key: string, params?: { [key: string]: string }): string;
  setLocale(locale: string): Promise<void>;
  getLocale(): string;
  getAvailableLocales(): Array<{ code: string; name: string }>;
}

// 主题管理器接口
export interface ThemeManager {
  initialize(): void;
  setTheme(theme: ThemeMode): void;
  getTheme(): ThemeMode;
  getEffectiveTheme(): 'light' | 'dark';
}

// ============ 安全模块接口 ============
