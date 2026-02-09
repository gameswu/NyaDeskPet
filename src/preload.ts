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

// 暴露安全的 API 给渲染进程
const electronAPI: ElectronAPI = {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => 
    ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
  
  // 消息通信
  sendMessage: (message: unknown) => ipcRenderer.invoke('send-message', message),
  
  // 文件选择
  selectModelFile: () => ipcRenderer.invoke('select-model-file'),
  
  // 更新检查
  checkUpdate: (updateSource: string) => ipcRenderer.invoke('check-update', updateSource),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
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

  onOpenChat: (callback: () => void) => {
    ipcRenderer.on('open-chat', () => callback());
  },

  onToggleUI: (callback: () => void) => {
    ipcRenderer.on('toggle-ui', () => callback());
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
