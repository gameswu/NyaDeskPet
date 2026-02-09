9/**
 * 渲染进程主脚本
 * 协调各个模块的工作
 */

import type { AppState, AppDebugInterface } from '../types/global';

// 应用状态
const appState: AppState = {
  initialized: false,
  modelLoaded: false,
  connected: false
};

/**
 * 初始化应用
 */
async function initializeApp(): Promise<void> {
  console.log('开始初始化应用...');

  try {
    // 1. 初始化设置管理器
    window.settingsManager.initialize();
    const settings = window.settingsManager.getSettings();
    console.log('当前设置:', settings);

    // 2. 初始化 Live2D
    console.log('初始化 Live2D...');
    await window.live2dManager.initialize();
    console.log('Live2D 初始化成功');
    
    // 3. 加载模型
    try {
      console.log('加载模型:', settings.modelPath);
      await window.live2dManager.loadModel(settings.modelPath);
      appState.modelLoaded = true;
      console.log('模型加载成功');
    } catch (error) {
      console.error('模型加载失败:', error);
      showError('模型加载失败，请检查模型文件路径或在设置中更改');
    }

    // 4. 设置音频音量
    window.audioPlayer.setVolume(settings.volume);

    // 5. 初始化后端连接
    if (settings.autoConnect) {
      console.log('连接后端服务器...');
      await window.backendClient.initialize();
    }

    // 4. 设置事件监听
    setupEventListeners();

    // 5. 设置窗口控制
    setupWindowControls();

    appState.initialized = true;
    console.log('应用初始化完成');

    // 显示欢迎消息
    setTimeout(() => {
      window.dialogueManager.showDialogue(
        '你好！我是你的桌面宠物喵~ 点击我可以和我互动哦！',
        5000
      );
    }, 1000);

  } catch (error) {
    console.error('应用初始化失败:', error);
  }
}

/**
 * 设置事件监听
 */
function setupEventListeners(): void {
  // 交互区域点击事件
  const interactionArea = document.getElementById('interaction-area');
  
  if (!interactionArea) {
    console.error('交互区域元素未找到');
    return;
  }

  interactionArea.addEventListener('click', (e: MouseEvent) => {
    const rect = interactionArea.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    console.log('点击了宠物');
    window.live2dManager.tap(x, y);
    
    // 发送点击事件到后端
    window.backendClient.sendMessage({
      type: 'interaction',
      action: 'tap',
      position: { x, y }
    });
  });

  // 鼠标移动事件 - Live2D 视线跟随
  let mouseMoveThrottle: number | null = null;
  interactionArea.addEventListener('mousemove', (e: MouseEvent) => {
    if (mouseMoveThrottle) return;
    
    mouseMoveThrottle = window.setTimeout(() => {
      const rect = interactionArea.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      window.live2dManager.lookAt(x, y);
      mouseMoveThrottle = null;
    }, 50);
  });

  // 监听后端消息
  window.backendClient.onMessage((message) => {
    console.log('收到后端消息:', message);
  });
}

/**
 * 设置窗口控制
 */
function setupWindowControls(): void {
  // 最小化按钮
  const btnMinimize = document.getElementById('btn-minimize');
  if (btnMinimize) {
    btnMinimize.addEventListener('click', () => {
      window.electronAPI.minimizeWindow();
    });
  }

  // 关闭按钮
  const btnClose = document.getElementById('btn-close');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      if (confirm('确定要关闭桌面宠物吗？')) {
        window.electronAPI.closeWindow();
      }
    });
  }

  // 对话框点击事件（防止拖拽）
  const dialogueBox = document.getElementById('dialogue-box');
  if (dialogueBox) {
    dialogueBox.addEventListener('mousedown', (e: MouseEvent) => {
      e.stopPropagation();
    });
  }

  // 设置按钮
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      showSettingsPanel();
    });
  }
}

/**
 * 显示设置面板
 */
function showSettingsPanel(): void {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  // 加载当前设置
  const settings = window.settingsManager.getSettings();
  
  (document.getElementById('setting-model-path') as HTMLInputElement).value = settings.modelPath;
  (document.getElementById('setting-backend-url') as HTMLInputElement).value = settings.backendUrl;
  (document.getElementById('setting-ws-url') as HTMLInputElement).value = settings.wsUrl;
  (document.getElementById('setting-auto-connect') as HTMLInputElement).checked = settings.autoConnect;
  (document.getElementById('setting-volume') as HTMLInputElement).value = String(settings.volume);
  (document.getElementById('volume-value') as HTMLSpanElement).textContent = Math.round(settings.volume * 100) + '%';

  panel.classList.add('show');
}

/**
 * 隐藏设置面板
 */
function hideSettingsPanel(): void {
  const panel = document.getElementById('settings-panel');
  if (panel) {
    panel.classList.remove('show');
  }
}

/**
 * 保存设置
 */
async function saveSettings(): Promise<void> {
  const modelPath = (document.getElementById('setting-model-path') as HTMLInputElement).value;
  const backendUrl = (document.getElementById('setting-backend-url') as HTMLInputElement).value;
  const wsUrl = (document.getElementById('setting-ws-url') as HTMLInputElement).value;
  const autoConnect = (document.getElementById('setting-auto-connect') as HTMLInputElement).checked;
  const volume = parseFloat((document.getElementById('setting-volume') as HTMLInputElement).value);

  // 更新设置
  window.settingsManager.updateSettings({
    modelPath,
    backendUrl,
    wsUrl,
    autoConnect,
    volume
  });

  // 验证设置
  const validation = window.settingsManager.validateSettings();
  if (!validation.valid) {
    alert('设置验证失败:\n' + validation.errors.join('\n'));
    return;
  }

  // 应用设置
  window.audioPlayer.setVolume(volume);
  
  // 提示用户重启应用
  if (confirm('设置已保存！部分设置需要重新加载才能生效，是否立即重新加载？')) {
    window.location.reload();
  } else {
    hideSettingsPanel();
  }
}

/**
 * 重置设置
 */
function resetSettings(): void {
  if (confirm('确定要恢复默认设置吗？')) {
    window.settingsManager.resetToDefaults();
    showSettingsPanel(); // 重新显示以更新表单
    window.dialogueManager.showDialogue('已恢复默认设置', 2000);
  }
}

/**
 * 初始化设置面板事件
 */
function initializeSettingsPanel(): void {
  // 关闭按钮
  const btnCloseSettings = document.getElementById('btn-close-settings');
  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', hideSettingsPanel);
  }

  // 保存按钮
  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', saveSettings);
  }

  // 重置按钮
  const btnResetSettings = document.getElementById('btn-reset-settings');
  if (btnResetSettings) {
    btnResetSettings.addEventListener('click', resetSettings);
  }

  // 音量滑块实时更新
  const volumeSlider = document.getElementById('setting-volume') as HTMLInputElement;
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      const display = document.getElementById('volume-value');
      if (display) {
        display.textContent = Math.round(parseFloat(value) * 100) + '%';
      }
    });
  }

  // 点击背景关闭
  const panel = document.getElementById('settings-panel');
  if (panel) {
    panel.addEventListener('click', (e: MouseEvent) => {
      if (e.target === panel) {
        hideSettingsPanel();
      }
    });
  }
}

/**
 * 发送用户消息
 * @param text - 用户输入的文本
 */
async function sendUserMessage(text: string): Promise<void> {
  if (!text || text.trim().length === 0) {
    return;
  }

  try {
    const result = await window.backendClient.sendMessage({
      type: 'user_input',
      text: text.trim(),
      timestamp: Date.now()
    });

    console.log('消息发送结果:', result);
  } catch (error) {
    console.error('发送消息失败:', error);
    window.dialogueManager.showDialogue('发送消息失败，请检查网络连接', 3000);
  }
}

/**
 * 显示错误消息
 */
function showError(message: string, duration: number = 5000): void {
  console.error(message);
  window.dialogueManager?.showDialogue(`❌ ${message}`, duration);
}

/**
 * 页面加载完成后初始化
 */
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM 加载完成');
  initializeSettingsPanel();
  initializeApp();
});

/**
 * 页面卸载时清理
 */
window.addEventListener('beforeunload', () => {
  console.log('页面卸载，清理资源');
  
  if (window.live2dManager) {
    window.live2dManager.destroy();
  }
  
  if (window.backendClient) {
    window.backendClient.disconnect();
  }
  
  if (window.audioPlayer) {
    window.audioPlayer.stop();
  }
});

// 暴露全局函数供调试使用
const appDebug: AppDebugInterface = {
  sendMessage: sendUserMessage,
  showDialogue: (text: string, duration?: number) => window.dialogueManager.showDialogue(text, duration),
  playMotion: (group: string, index?: number) => window.live2dManager.playMotion(group, index),
  setExpression: (id: string) => window.live2dManager.setExpression(id),
  getState: () => appState,
  showSettings: () => showSettingsPanel()
};

window.app = appDebug;

console.log('渲染进程脚本加载完成');
console.log('调试命令: window.app');
