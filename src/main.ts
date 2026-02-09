import { app, BrowserWindow, ipcMain, screen, IpcMainInvokeEvent, Tray, Menu, nativeImage, dialog, shell } from 'electron';
import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import asrService from './asr-service';

// 在最开始设置动态库路径，确保 Electron 启动时就能找到 sherpa-onnx 库
const platform = process.platform;
const arch = process.arch;
let sherpaPackageName = '';

if (platform === 'darwin') {
  sherpaPackageName = arch === 'arm64' ? 'sherpa-onnx-darwin-arm64' : 'sherpa-onnx-darwin-x64';
} else if (platform === 'linux') {
  sherpaPackageName = 'sherpa-onnx-linux-x64';
} else if (platform === 'win32') {
  sherpaPackageName = arch === 'x64' ? 'sherpa-onnx-win32-x64' : 'sherpa-onnx-win32-ia32';
}

if (sherpaPackageName) {
  // 在开发模式下，使用 __dirname 的父目录（项目根目录）
  const appPath = __dirname.endsWith('dist') ? path.dirname(__dirname) : __dirname;
  const sherpaLibPath = path.join(appPath, 'node_modules', sherpaPackageName);
  
  if (platform === 'darwin') {
    const currentDyldPath = process.env.DYLD_LIBRARY_PATH || '';
    process.env.DYLD_LIBRARY_PATH = currentDyldPath 
      ? `${sherpaLibPath}:${currentDyldPath}` 
      : sherpaLibPath;
  } else if (platform === 'linux') {
    const currentLdPath = process.env.LD_LIBRARY_PATH || '';
    process.env.LD_LIBRARY_PATH = currentLdPath 
      ? `${sherpaLibPath}:${currentLdPath}` 
      : sherpaLibPath;
  } else if (platform === 'win32') {
    const currentPath = process.env.PATH || '';
    process.env.PATH = currentPath 
      ? `${sherpaLibPath};${currentPath}` 
      : sherpaLibPath;
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting: boolean = false;
const isDev: boolean = process.argv.includes('--dev');

// UI状态追踪
let isUIVisible: boolean = true;
let isChatOpen: boolean = false;

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 300,
    minHeight: 400,
    x: width - 450,
    y: height - 650,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
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

  // 窗口关闭时隐藏而不是退出（除非在开发模式）
  mainWindow.on('close', (event) => {
    if (!isDev && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

/**
 * 更新托盘菜单（根据当前状态动态显示）
 */
function updateTrayMenu(): void {
  if (!tray) return;
  
  const isWindowVisible = mainWindow?.isVisible() || false;
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isWindowVisible ? '隐藏宠物' : '显示宠物',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
          // 切换后更新菜单
          setTimeout(() => updateTrayMenu(), 100);
        } else {
          createWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: mainWindow?.isAlwaysOnTop() || true,
      click: (menuItem) => {
        mainWindow?.setAlwaysOnTop(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: isUIVisible ? '隐藏UI' : '显示UI',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('toggle-ui');
          isUIVisible = !isUIVisible;
          // 切换后更新菜单
          setTimeout(() => updateTrayMenu(), 100);
        }
      }
    },
    {
      label: isChatOpen ? '关闭对话' : '打开对话',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          if (isChatOpen) {
            mainWindow.webContents.send('close-chat');
          } else {
            mainWindow.webContents.send('open-chat');
          }
          isChatOpen = !isChatOpen;
          // 切换后更新菜单
          setTimeout(() => updateTrayMenu(), 100);
        } else {
          createWindow();
        }
      }
    },
    {
      label: '设置',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    {
      label: '开发者工具',
      visible: isDev,
      click: () => {
        mainWindow?.webContents.openDevTools({ mode: 'detach' });
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * 创建系统托盘
 */
function createTray(): void {
  // 创建托盘图标（使用应用图标或默认图标）
  let trayIcon: Electron.NativeImage;
  
  try {
    // 根据平台选择合适的图标
    if (process.platform === 'darwin') {
      // macOS 使用模板图标
      const iconPath = path.join(__dirname, '../assets/tray-icon-mac.png');
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        console.warn('托盘图标未找到，使用默认图标');
        // 创建一个简单的16x16图标
        trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEPSURBVDiNpdMxSgNBFAbgb3azye4uCaQQFEEQxEIQFKysbGzsLLyBN/AGXsAzWNhYWVnZ2FhYWAgWgqAQBEVBSLJZdnfGYneDhIjgwDDMzPv+eW+Gf6SUUkop/dcYM8YMY8wYY8YYM8YYM8b8i4gQESEiQkSEiAgRESIiRESIiPiXiIiIiIiIiIiIiIiIiIiIiPhXRERERERERERERERERERExL9ERERERERERERERERERMRfRURERERERERERERERET8q4iIiIiIiIiIiIiIiIiIiH+JiIiIiIiIiIiIiIiIiIiI+FeIiIiIiIiIiIiIiIiIiIh/hYiIiIiIiIiIiIiIiIiI+FdYa621dsv2AIkRHvLqZH0AAAAASUVORK5CYII=');
      }
      trayIcon.setTemplateImage(true);
    } else {
      // Windows 和 Linux
      const iconPath = path.join(__dirname, '../assets/tray-icon.png');
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        console.warn('托盘图标未找到，使用默认图标');
        // 使用一个简单的占位图标
        trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEPSURBVDiNpdMxSgNBFAbgb3azye4uCaQQFEEQxEIQFKysbGzsLLyBN/AGXsAzWNhYWVnZ2FhYWAgWgqAQBEVBSLJZdnfGYneDhIjgwDDMzPv+eW+Gf6SUUkop/dcYM8YMY8wYY8YYM8YYM8b8i4gQESEiQkSEiAgRESIiRESIiPiXiIiIiIiIiIiIiIiIiIiIiPhXRERERERERERERERERERExL9ERERERERERERERERERMRfRURERERERERERERERET8q4iIiIiIiIiIiIiIiIiIiH+JiIiIiIiIiIiIiIiIiIiI+FeIiIiIiIiIiIiIiIiIiIh/hYiIiIiIiIiIiIiIiIiI+FdYa621dsv2AIkRHvLqZH0AAAAASUVORK5CYII=');
      }
    }
  } catch (error) {
    console.error('创建托盘图标失败:', error);
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('NyaDeskPet - 桌面宠物');

  // 更新托盘菜单
  updateTrayMenu();

  // 双击托盘图标切换窗口显示/隐藏
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 不自动退出，保持托盘运行
  // 用户需要通过托盘菜单退出
});

// 退出前清理
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  // 清理托盘
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// IPC 通信处理
ipcMain.handle('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.handle('close-window', () => {
  // 隐藏窗口而不是退出（在生产模式）
  if (!isDev) {
    mainWindow?.hide();
  } else {
    app.quit();
  }
});

ipcMain.handle('show-window', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle('hide-window', () => {
  mainWindow?.hide();
});

ipcMain.handle('toggle-window', () => {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

ipcMain.handle('set-ignore-mouse-events', (_event: IpcMainInvokeEvent, ignore: boolean, options?: { forward?: boolean }) => {
  mainWindow?.setIgnoreMouseEvents(ignore, options);
});

// 更新UI状态（用于同步托盘菜单）
ipcMain.on('ui-state-changed', (_event, state: { uiVisible?: boolean; chatOpen?: boolean }) => {
  if (state.uiVisible !== undefined) {
    isUIVisible = state.uiVisible;
  }
  if (state.chatOpen !== undefined) {
    isChatOpen = state.chatOpen;
  }
  updateTrayMenu();
});

// 从渲染进程接收消息并转发到后端
ipcMain.handle('send-message', async (_event: IpcMainInvokeEvent, message: unknown) => {
  // 这里可以添加额外的主进程逻辑
  console.log('Received message from renderer:', message);
  return { success: true, message: 'Message forwarded' };
});

// 选择模型文件
ipcMain.handle('select-model-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '选择 Live2D 模型文件',
    filters: [
      { name: 'Live2D 模型', extensions: ['model3.json', 'model.json'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  return result.filePaths[0];
});

// 检查更新
ipcMain.handle('check-update', async (_event: IpcMainInvokeEvent, updateSource: string) => {
  return new Promise((resolve) => {
    // 解析 GitHub URL 获取 owner 和 repo
    let owner = '';
    let repo = '';
    
    try {
      // 支持格式: https://github.com/owner/repo 或 owner/repo
      const cleanUrl = updateSource.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      const parts = cleanUrl.split('/');
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts[1];
      } else {
        resolve({
          error: '更新源格式不正确，请使用 https://github.com/owner/repo 格式',
          hasUpdate: false,
          currentVersion: app.getVersion()
        });
        return;
      }
    } catch {
      resolve({
        error: '解析更新源失败',
        hasUpdate: false,
        currentVersion: app.getVersion()
      });
      return;
    }
    
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'NyaDeskPet-Updater',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const release = JSON.parse(data);
            const latestVersion = release.tag_name.replace(/^v/, '');
            const currentVersion = app.getVersion();
            
            resolve({
              hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
              currentVersion,
              latestVersion,
              releaseUrl: release.html_url,
              releaseName: release.name,
              releaseNotes: release.body,
              publishedAt: release.published_at
            });
          } else {
            resolve({
              error: `GitHub API 返回 ${res.statusCode}`,
              hasUpdate: false,
              currentVersion: app.getVersion()
            });
          }
        } catch (error) {
          resolve({
            error: '解析响应失败',
            hasUpdate: false,
            currentVersion: app.getVersion()
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        error: error.message,
        hasUpdate: false,
        currentVersion: app.getVersion()
      });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({
        error: '请求超时',
        hasUpdate: false,
        currentVersion: app.getVersion()
      });
    });

    req.end();
  });
});

// 打开外部链接
ipcMain.handle('open-external', async (_event: IpcMainInvokeEvent, url: string) => {
  await shell.openExternal(url);
});

// 获取应用版本
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ==================== ASR 相关处理器 ====================

/**
 * 初始化 ASR 服务
 */
ipcMain.handle('asr-initialize', async () => {
  const success = await asrService.initialize();
  return { success };
});

/**
 * 检查 ASR 服务是否就绪
 */
ipcMain.handle('asr-is-ready', () => {
  return { ready: asrService.isReady() };
});

/**
 * 识别音频数据
 * @param audioData 音频数据（Base64 编码的 WebM 格式）
 */
ipcMain.handle('asr-recognize', async (_event: IpcMainInvokeEvent, audioData: string) => {
  try {
    if (!asrService.isReady()) {
      return { success: false, error: 'ASR 服务未初始化' };
    }

    // 将 Base64 解码为 Buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // 保存临时文件
    const tempDir = os.tmpdir();
    const tempWebMPath = path.join(tempDir, `asr_${Date.now()}.webm`);
    const tempWavPath = path.join(tempDir, `asr_${Date.now()}.wav`);
    
    fs.writeFileSync(tempWebMPath, audioBuffer);

    // 使用 ffmpeg 转换为 16kHz 16-bit PCM WAV
    const { exec } = require('child_process');
    await new Promise<void>((resolve, reject) => {
      exec(
        `ffmpeg -i "${tempWebMPath}" -ar 16000 -ac 1 -sample_fmt s16 "${tempWavPath}"`,
        (error: any) => {
          if (error) {
            console.error('[ASR] FFmpeg 转换失败:', error);
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });

    // 读取 WAV 文件并识别
    const wavBuffer = fs.readFileSync(tempWavPath);
    
    // 跳过 WAV 头（44 字节）
    const pcmBuffer = wavBuffer.slice(44);
    
    // 识别音频
    const result = await asrService.recognize(pcmBuffer);

    // 清理临时文件
    try {
      fs.unlinkSync(tempWebMPath);
      fs.unlinkSync(tempWavPath);
    } catch (e) {
      console.error('[ASR] 清理临时文件失败:', e);
    }

    if (result) {
      return { success: true, text: result.text, confidence: result.confidence };
    } else {
      return { success: false, error: '识别失败' };
    }
  } catch (error: any) {
    console.error('[ASR] 识别错误:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 比较版本号
 * @returns 1 如果 v1 > v2, -1 如果 v1 < v2, 0 如果相等
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}
