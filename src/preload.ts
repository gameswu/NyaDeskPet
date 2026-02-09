import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// 定义暴露给渲染进程的 API 类型
export interface ElectronAPI {
  // 窗口控制
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => Promise<void>;
  
  // 消息通信
  sendMessage: (message: unknown) => Promise<{ success: boolean; message: string }>;
  
  // 监听来自主进程的消息
  onBackendMessage: (callback: (data: unknown) => void) => void;
  onVoicePlay: (callback: (data: unknown) => void) => void;
  onLive2dCommand: (callback: (data: unknown) => void) => void;
}

// 暴露安全的 API 给渲染进程
const electronAPI: ElectronAPI = {
  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => 
    ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
  
  // 消息通信
  sendMessage: (message: unknown) => ipcRenderer.invoke('send-message', message),
  
  // 监听来自主进程的消息
  onBackendMessage: (callback: (data: unknown) => void) => {
    ipcRenderer.on('backend-message', (_event: IpcRendererEvent, data: unknown) => callback(data));
  },
  
  onVoicePlay: (callback: (data: unknown) => void) => {
    ipcRenderer.on('voice-play', (_event: IpcRendererEvent, data: unknown) => callback(data));
  },
  
  onLive2dCommand: (callback: (data: unknown) => void) => {
    ipcRenderer.on('live2d-command', (_event: IpcRendererEvent, data: unknown) => callback(data));
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
