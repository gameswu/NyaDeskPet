import { app, BrowserWindow, ipcMain, screen, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
const isDev: boolean = process.argv.includes('--dev');

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    x: width - 450,
    y: height - 650,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: isDev,
    skipTaskbar: !isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('renderer/index.html');
  
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 设置窗口可拖拽
  mainWindow.setIgnoreMouseEvents(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 通信处理
ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('close-window', () => {
  app.quit();
});

ipcMain.handle('set-ignore-mouse-events', (_event: IpcMainInvokeEvent, ignore: boolean, options?: { forward?: boolean }) => {
  mainWindow?.setIgnoreMouseEvents(ignore, options);
});

// 从渲染进程接收消息并转发到后端
ipcMain.handle('send-message', async (_event: IpcMainInvokeEvent, message: unknown) => {
  // 这里可以添加额外的主进程逻辑
  console.log('Received message from renderer:', message);
  return { success: true, message: 'Message forwarded' };
});
