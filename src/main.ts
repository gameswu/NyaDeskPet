import { app, BrowserWindow, ipcMain, screen, IpcMainInvokeEvent, Tray, Menu, nativeImage, dialog, shell } from 'electron';
import * as path from 'path';
import * as https from 'https';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting: boolean = false;
const isDev: boolean = process.argv.includes('--dev');

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

  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示宠物',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: '隐藏宠物',
      click: () => {
        mainWindow?.hide();
      }
    },
    { type: 'separator' },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: true,
      click: (menuItem) => {
        mainWindow?.setAlwaysOnTop(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: '显示/隐藏UI',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('toggle-ui');
        }
      }
    },
    {
      label: '打开对话',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('open-chat');
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

  // 双击托盘图标显示窗口
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
