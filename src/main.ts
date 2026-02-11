import { app, BrowserWindow, ipcMain, screen, IpcMainInvokeEvent, Tray, Menu, nativeImage, dialog, shell } from 'electron';
import * as path from 'path';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import asrService from './asr-service';
import { logger } from './logger';
import { AgentServer } from './agent-server';

// GPU 优化：添加命令行开关以提高 Windows + NVIDIA 显卡的稳定性
// 这些开关可以缓解 GPU 进程相关的错误（如 command_buffer_proxy_impl 错误）
if (process.platform === 'win32') {
  // 禁用 GPU 沙箱以避免某些驱动兼容性问题
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  // 禁用 GPU 进程崩溃限制
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
  // 使用 ANGLE 作为 WebGL 后端（D3D11），提高兼容性
  app.commandLine.appendSwitch('use-angle', 'd3d11');
  // 禁用软件光栅化回退
  app.commandLine.appendSwitch('disable-software-rasterizer');
  // 限制 GPU 内存使用
  app.commandLine.appendSwitch('force-gpu-mem-available-mb', '2048');
}

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

// 插件进程管理
const pluginProcesses: Map<string, ChildProcess> = new Map();

// UI状态追踪
let isUIVisible: boolean = true;
let isChatOpen: boolean = false;

// 内置 Agent 服务器
const agentServer = new AgentServer({ port: 8765 });
let backendMode: 'builtin' | 'custom' = 'builtin';

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
      nodeIntegration: false,
      // GPU 优化：启用硬件加速和 WebGL 优化
      webgl: true,
      // 禁用 Chromium 的背景节流以保持渲染流畅
      backgroundThrottling: false
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
      label: '插件管理',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('open-plugins');
        }
      }
    },
    ...(backendMode === 'builtin' ? [{
      label: 'Agent 管理',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('open-agent');
        }
      }
    }] : []),
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
      // 尝试加载带 @2x 后缀的 Retina 版本，Electron 会自动处理多分辨率
      const iconPath = path.join(__dirname, '../assets/tray-icon-mac.png');
      
      // 先尝试使用 32x32 作为 @2x（Retina）版本
      const icon2xPath = path.join(__dirname, '../assets/tray-icon-mac@2x.png');
      const normalIconPath = iconPath;
      
      // 检查是否存在 @2x 版本
      if (fs.existsSync(icon2xPath)) {
        // 如果有 @2x 版本，让 Electron 自动处理多分辨率
        trayIcon = nativeImage.createFromPath(normalIconPath);
      } else if (fs.existsSync(normalIconPath)) {
        // 如果只有一个文件，需要调整尺寸
        const originalIcon = nativeImage.createFromPath(normalIconPath);
        if (!originalIcon.isEmpty()) {
          const size = originalIcon.getSize();
          // 如果图标是 32x32，将其缩小到 16x16 以适配菜单栏
          if (size.width > 20 || size.height > 20) {
            trayIcon = originalIcon.resize({ width: 16, height: 16 });
          } else {
            trayIcon = originalIcon;
          }
        } else {
          trayIcon = nativeImage.createEmpty();
        }
      } else {
        logger.warn('托盘图标未找到，使用默认图标');
        // 创建一个简单的16x16图标
        trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEPSURBVDiNpdMxSgNBFAbgb3azye4uCaQQFEEQxEIQFKysbGzsLLyBN/AGXsAzWNhYWVnZ2FhYWAgWgqAQBEVBSLJZdnfGYneDhIjgwDDMzPv+eW+Gf6SUUkop/dcYM8YMY8wYY8YYM8YYM8b8i4gQESEiQkSEiAgRESIiRESIiPiXiIiIiIiIiIiIiIiIiIiIiPhXRERERERERERERERERERExL9ERERERERERERERERERMRfRURERERERERERERERET8q4iIiIiIiIiIiIiIiIiIiH+JiIiIiIiIiIiIiIiIiIiI+FeIiIiIiIiIiIiIiIiIiIh/hYiIiIiIiIiIiIiIiIiI+FdYa621dsv2AIkRHvLqZH0AAAAASUVORK5CYII=');
      }
      trayIcon.setTemplateImage(true);
    } else {
      // Windows 和 Linux
      // Windows 优先使用 ICO 格式，Linux 使用 PNG
      const iconPath = process.platform === 'win32' 
        ? path.join(__dirname, '../assets/tray-icon.ico')
        : path.join(__dirname, '../assets/tray-icon.png');
      
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        logger.warn('托盘图标未找到，尝试使用备用图标');
        // 尝试使用应用图标作为备用
        const fallbackPath = process.platform === 'win32'
          ? path.join(__dirname, '../assets/icon.ico')
          : path.join(__dirname, '../assets/icon.png');
        trayIcon = nativeImage.createFromPath(fallbackPath);
        
        if (trayIcon.isEmpty()) {
          logger.warn('备用图标也未找到，使用默认图标');
          // 使用一个简单的占位图标
          trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEPSURBVDiNpdMxSgNBFAbgb3azye4uCaQQFEEQxEIQFKysbGzsLLyBN/AGXsAzWNhYWVnZ2FhYWAgWgqAQBEVBSLJZdnfGYneDhIjgwDDMzPv+eW+Gf6SUUkop/dcYM8YMY8wYY8YYM8YYM8b8i4gQESEiQkSEiAgRESIiRESIiPiXiIiIiIiIiIiIiIiIiIiIiPhXRERERERERERERERERERExL9ERERERERERERERERERMRfRURERERERERERERERET8q4iIiIiIiIiIiIiIiIiIiH+JiIiIiIiIiIiIiIiIiIiI+FeIiIiIiIiIiIiIiIiIiIh/hYiIiIiIiIiIiIiIiIiI+FdYa621dsv2AIkRHvLqZH0AAAAASUVORK5CYII=');
        }
      }
      
      // Windows 托盘图标可能需要调整尺寸
      if (process.platform === 'win32' && !trayIcon.isEmpty()) {
        const size = trayIcon.getSize();
        // Windows 托盘图标标准尺寸是 16x16
        if (size.width > 16 || size.height > 16) {
          trayIcon = trayIcon.resize({ width: 16, height: 16 });
        }
      }
    }
  } catch (error) {
    logger.error('创建托盘图标失败:', error);
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
  // 初始化日志系统（从本地存储加载配置将在渲染进程中处理）
  logger.initialize();
  logger.info('应用启动');
  
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
  
  // 关闭日志系统
  logger.info('应用退出');
  logger.close();
});

// IPC 通信处理
ipcMain.handle('get-window-position', () => {
  if (!mainWindow) return { x: 0, y: 0 };
  const bounds = mainWindow.getBounds();
  return { x: bounds.x, y: bounds.y };
});

ipcMain.handle('get-cursor-screen-point', () => {
  const point = screen.getCursorScreenPoint();
  return { x: point.x, y: point.y };
});

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

// 接收后端模式变更通知
ipcMain.on('backend-mode-changed', (_event, mode: 'builtin' | 'custom') => {
  backendMode = mode;
  updateTrayMenu();
});

// 从渲染进程接收消息并转发到后端
ipcMain.handle('send-message', async (_event: IpcMainInvokeEvent, message: unknown) => {
  // 这里可以添加额外的主进程逻辑
  logger.info('Received message from renderer:', message);
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
            logger.error('[ASR] FFmpeg 转换失败:', error);
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
      logger.error('[ASR] 清理临时文件失败:', e);
    }

    if (result) {
      return { success: true, text: result.text, confidence: result.confidence };
    } else {
      return { success: false, error: '识别失败' };
    }
  } catch (error: any) {
    logger.error('[ASR] 识别错误:', error);
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

// ==================== 日志系统 IPC 处理器 ====================

/**
 * 更新日志配置
 */
ipcMain.handle('logger-update-config', (_event: IpcMainInvokeEvent, config: any) => {
  logger.updateConfig(config);
  return { success: true };
});

/**
 * 获取日志配置
 */
ipcMain.handle('logger-get-config', () => {
  return logger.getConfig();
});

/**
 * 获取日志文件列表
 */
ipcMain.handle('logger-get-files', () => {
  return logger.getLogFiles();
});

/**
 * 删除指定日志文件
 */
ipcMain.handle('logger-delete-file', (_event: IpcMainInvokeEvent, fileName: string) => {
  const success = logger.deleteLogFile(fileName);
  return { success };
});

/**
 * 删除所有日志文件
 */
ipcMain.handle('logger-delete-all', () => {
  const count = logger.deleteAllLogs();
  return { success: true, count };
});

/**
 * 打开日志目录
 */
ipcMain.handle('logger-open-directory', () => {
  logger.openLogDirectory();
  return { success: true };
});

/**
 * 记录日志（从渲染进程）
 */
ipcMain.on('logger-log', (_event, level: string, message: string, data?: any) => {
  switch (level) {
    case 'debug':
      logger.debug(message, data);
      break;
    case 'info':
      logger.info(message, data);
      break;
    case 'warn':
      logger.warn(message, data);
      break;
    case 'error':
      logger.error(message, data);
      break;
    case 'critical':
      logger.critical(message, data);
      break;
  }
});

/**
 * 设置开机自启动
 */
ipcMain.handle('set-auto-launch', (_event: IpcMainInvokeEvent, enable: boolean) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: false,
      args: []
    });
    logger.info('开机自启动设置已更新', { enable });
    return { success: true };
  } catch (error) {
    logger.error('设置开机自启动失败', { error });
    return { success: false, error: String(error) };
  }
});

/**
 * 获取开机自启动状态
 */
ipcMain.handle('get-auto-launch', () => {
  try {
    const settings = app.getLoginItemSettings();
    return { enabled: settings.openAtLogin };
  } catch (error) {
    logger.error('获取开机自启动状态失败', { error });
    return { enabled: false };
  }
});

/**
 * 插件管理 - 读取插件清单
 */
ipcMain.handle('plugin:read-manifest', async (_event: IpcMainInvokeEvent, pluginName: string) => {
  try {
    const appPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const manifestPath = path.join(appPath, 'plugins', pluginName, 'metadata.json');
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`清单文件不存在: ${manifestPath}`);
    }
    
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    
    // 尝试读取config.json（如果存在）
    const configPath = path.join(appPath, 'plugins', pluginName, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const configSchema = JSON.parse(configContent);
        manifest.config = configSchema;
        logger.debug(`读取插件配置Schema: ${pluginName}`);
      } catch (configError) {
        logger.warn(`读取插件配置Schema失败 (${pluginName}):`, configError);
        // 配置文件读取失败不影响清单加载
      }
    }
    
    logger.debug(`读取插件清单: ${pluginName}`);
    return { success: true, manifest };
  } catch (error) {
    logger.error(`读取插件清单失败 (${pluginName}):`, error);
    return { success: false, error: (error as Error).message };
  }
});

/**
 * 插件管理 - 扫描插件目录
 */
ipcMain.handle('plugin:scan-directory', async () => {
  try {
    const appPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const pluginsPath = path.join(appPath, 'plugins');
    
    if (!fs.existsSync(pluginsPath)) {
      logger.warn('插件目录不存在');
      return { success: true, plugins: [] };
    }
    
    const entries = fs.readdirSync(pluginsPath, { withFileTypes: true });
    const pluginDirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    
    logger.info(`扫描到 ${pluginDirs.length} 个插件目录:`, pluginDirs);
    return { success: true, plugins: pluginDirs };
  } catch (error) {
    logger.error('扫描插件目录失败:', error);
    return { success: false, error: (error as Error).message, plugins: [] };
  }
});

/**
 * 插件管理 - 启动插件
 */
ipcMain.handle('plugin:start', async (_event: IpcMainInvokeEvent, args: { name: string; command: any; workingDirectory?: string }) => {
  const { name, command } = args;
  
  try {
    // 检查是否已经在运行
    if (pluginProcesses.has(name)) {
      const existingProcess = pluginProcesses.get(name);
      if (existingProcess && !existingProcess.killed) {
        logger.info(`插件 ${name} 已在运行`);
        return { success: true, pid: existingProcess.pid };
      }
    }

    // 获取平台对应的命令
    const platform = process.platform as 'win32' | 'darwin' | 'linux';
    const cmdConfig = command[platform];
    
    if (!cmdConfig) {
      throw new Error(`不支持的平台: ${platform}`);
    }

    // 获取工作目录路径
    const appPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const workingDir = args.workingDirectory || 'plugins';
    const pluginPath = path.join(appPath, workingDir);
    
    // 构建命令和参数
    let execCommand: string;
    let execArgs: string[];
    
    if (Array.isArray(cmdConfig)) {
      // 数组格式: ["venv/bin/python3", "main.py"]
      execCommand = cmdConfig[0];
      execArgs = cmdConfig.slice(1);
    } else {
      // 字符串格式: "python main.py"
      const parts = cmdConfig.split(' ');
      execCommand = parts[0];
      execArgs = parts.slice(1);
    }
    
    logger.info(`启动插件: ${name}`, { 
      command: execCommand, 
      args: execArgs, 
      cwd: pluginPath 
    });
    logger.info(`[Plugin] 启动 ${name}: ${execCommand} ${execArgs.join(' ')}`);
    logger.info(`[Plugin] 工作目录: ${pluginPath}`);
    
    // 直接执行命令，不使用shell
    const childProcess = spawn(execCommand, execArgs, {
      cwd: pluginPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      shell: false  // 直接执行，不通过shell
    });

    if (!childProcess.pid) {
      throw new Error('无法获取进程 PID');
    }

    // 保存进程引用
    pluginProcesses.set(name, childProcess);

    // 监听输出
    childProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      logger.info(`[Plugin:${name}] ${output}`);
      logger.info(`[Plugin:${name}] ${output}`);
    });

    childProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      logger.warn(`[Plugin:${name}] ${output}`);
      logger.error(`[Plugin:${name}] ${output}`);
    });

    // 监听进程退出
    childProcess.on('exit', (code, signal) => {
      logger.info(`插件 ${name} 已退出`, { code, signal });
      pluginProcesses.delete(name);
    });

    childProcess.on('error', (error) => {
      logger.error(`插件 ${name} 错误:`, error);
      pluginProcesses.delete(name);
    });

    logger.info(`插件 ${name} 启动成功 (PID: ${childProcess.pid})`);
    return { success: true, pid: childProcess.pid };
    
  } catch (error) {
    logger.error(`启动插件 ${name} 失败:`, error);
    return { success: false, error: (error as Error).message };
  }
});

/**
 * 插件管理 - 停止插件
 */
ipcMain.handle('plugin:stop', async (_event: IpcMainInvokeEvent, args: { name: string; pid?: number }) => {
  const { name } = args;
  
  try {
    const childProcess = pluginProcesses.get(name);
    
    if (!childProcess) {
      logger.warn(`插件 ${name} 未在运行`);
      return { success: true };
    }

    // 发送终止信号
    const killed = childProcess.kill('SIGTERM');
    
    if (killed) {
      pluginProcesses.delete(name);
      logger.info(`插件 ${name} 已停止`);
      return { success: true };
    } else {
      throw new Error('无法终止进程');
    }
    
  } catch (error) {
    logger.error(`停止插件 ${name} 失败:`, error);
    return { success: false, error: (error as Error).message };
  }
});

// 应用退出时清理所有插件进程和内置 Agent
app.on('before-quit', async () => {
  logger.info('应用退出，清理插件进程');
  pluginProcesses.forEach((process, name) => {
    if (process && !process.killed) {
      logger.info(`停止插件: ${name}`);
      process.kill('SIGTERM');
    }
  });
  pluginProcesses.clear();

  // 停止内置 Agent 服务器
  if (agentServer.isRunning()) {
    logger.info('停止内置 Agent 服务器');
    await agentServer.stop();
  }
});

/**
 * 插件数据目录管理
 */

// 获取插件数据目录路径
function getPluginDataDirectory(pluginId: string): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'plugins', pluginId);
}

// 确保插件数据目录存在
function ensurePluginDataDirectory(pluginId: string): string {
  const dataDir = getPluginDataDirectory(pluginId);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info(`创建插件数据目录: ${dataDir}`);
  }
  return dataDir;
}

// 打开插件目录
ipcMain.handle('plugin:open-directory', async (_event: IpcMainInvokeEvent, args: { name: string }) => {
  try {
    const appPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const pluginPath = path.join(appPath, 'plugins', args.name);
    
    if (fs.existsSync(pluginPath)) {
      await shell.openPath(pluginPath);
      return { success: true };
    } else {
      return { success: false, error: '插件目录不存在' };
    }
  } catch (error) {
    logger.error(`打开插件目录失败:`, error);
    return { success: false, error: (error as Error).message };
  }
});

// 打开插件数据目录
ipcMain.handle('plugin:open-data-directory', async (_event: IpcMainInvokeEvent, args: { name: string }) => {
  try {
    // 使用插件的 id 而不是 name
    const dataDir = ensurePluginDataDirectory(args.name);
    await shell.openPath(dataDir);
    return { success: true };
  } catch (error) {
    logger.error(`打开插件数据目录失败:`, error);
    return { success: false, error: (error as Error).message };
  }
});

// 清除插件数据
ipcMain.handle('plugin:clear-data', async (_event: IpcMainInvokeEvent, args: { name: string }) => {
  try {
    const dataDir = getPluginDataDirectory(args.name);
    
    if (fs.existsSync(dataDir)) {
      // 递归删除目录
      fs.rmSync(dataDir, { recursive: true, force: true });
      logger.info(`已清除插件数据: ${dataDir}`);
      
      // 重新创建空目录
      ensurePluginDataDirectory(args.name);
      
      return { success: true };
    } else {
      return { success: true }; // 目录不存在，视为已清除
    }
  } catch (error) {
    logger.error(`清除插件数据失败:`, error);
    return { success: false, error: (error as Error).message };
  }
});
// 获取插件配置
ipcMain.handle('plugin:get-config', async (_event: IpcMainInvokeEvent, args: { pluginId: string }) => {
  try {
    const dataDir = ensurePluginDataDirectory(args.pluginId);
    const configPath = path.join(dataDir, 'config.json');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData);
      return { success: true, config };
    } else {
      return { success: true, config: {} };  // 配置文件不存在，返回空对象
    }
  } catch (error) {
    logger.error(`读取插件配置失败:`, error);
    return { success: false, error: (error as Error).message, config: {} };
  }
});

// 保存插件配置
ipcMain.handle('plugin:save-config', async (_event: IpcMainInvokeEvent, args: { pluginId: string; config: any }) => {
  try {
    const dataDir = ensurePluginDataDirectory(args.pluginId);
    const configPath = path.join(dataDir, 'config.json');
    
    fs.writeFileSync(configPath, JSON.stringify(args.config, null, 2), 'utf-8');
    logger.info(`保存插件配置: ${configPath}`);
    
    return { success: true };
  } catch (error) {
    logger.error(`保存插件配置失败:`, error);
    return { success: false, error: (error as Error).message };
  }
});

// 获取插件权限授权记录
ipcMain.handle('plugin:get-permissions', async (_event: IpcMainInvokeEvent) => {
  try {
    const userDataPath = app.getPath('userData');
    const permissionsPath = path.join(userDataPath, 'plugin-permissions.json');
    
    if (fs.existsSync(permissionsPath)) {
      const data = fs.readFileSync(permissionsPath, 'utf-8');
      const permissions = JSON.parse(data);
      return { success: true, permissions };
    } else {
      return { success: true, permissions: [] };
    }
  } catch (error) {
    logger.error(`读取权限记录失败:`, error);
    return { success: false, error: (error as Error).message, permissions: [] };
  }
});

// 保存插件权限授权记录
ipcMain.handle('plugin:save-permissions', async (_event: IpcMainInvokeEvent, args: { permissions: any[] }) => {
  try {
    const userDataPath = app.getPath('userData');
    const permissionsPath = path.join(userDataPath, 'plugin-permissions.json');
    
    fs.writeFileSync(permissionsPath, JSON.stringify(args.permissions, null, 2), 'utf-8');
    logger.info(`保存权限记录: ${permissionsPath}`);
    
    return { success: true };
  } catch (error) {
    logger.error(`保存权限记录失败:`, error);
    return { success: false, error: (error as Error).message };
  }
});

// ==================== 内置 Agent 服务器 IPC 处理器 ====================

/**
 * 启动内置 Agent 服务器
 */
ipcMain.handle('agent:start', async () => {
  try {
    if (agentServer.isRunning()) {
      return { success: true, ...agentServer.getStatus() };
    }
    const result = await agentServer.start();
    if (result) {
      // 通知渲染进程更新状态
      mainWindow?.webContents.send('agent-status-changed', agentServer.getStatus());
      return { success: true, ...agentServer.getStatus() };
    }
    return { success: false, error: '启动失败' };
  } catch (error) {
    logger.error('[Agent] 启动失败:', error);
    return { success: false, error: (error as Error).message };
  }
});

/**
 * 停止内置 Agent 服务器
 */
ipcMain.handle('agent:stop', async () => {
  try {
    await agentServer.stop();
    mainWindow?.webContents.send('agent-status-changed', agentServer.getStatus());
    return { success: true };
  } catch (error) {
    logger.error('[Agent] 停止失败:', error);
    return { success: false, error: (error as Error).message };
  }
});

/**
 * 获取内置 Agent 服务器状态
 */
ipcMain.handle('agent:status', () => {
  return agentServer.getStatus();
});

/**
 * 获取内置 Agent 的 WebSocket URL
 */
ipcMain.handle('agent:get-url', () => {
  return {
    wsUrl: agentServer.getWsUrl(),
    httpUrl: `http://127.0.0.1:${agentServer.getPort()}`
  };
});