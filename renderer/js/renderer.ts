/**
 * 渲染进程主脚本
 * 协调各个模块的工作
 */

import type { AppState, AppDebugInterface, ThemeMode } from '../types/global';

// 应用状态
const appState: AppState = {
  initialized: false,
  modelLoaded: false,
  connected: false
};

// UI显示状态
let isUIVisible: boolean = true;

/**
 * 切换UI显示/隐藏
 */
function toggleUI(): void {
  isUIVisible = !isUIVisible;
  
  const topBar = document.getElementById('top-bar');
  const bottomBar = document.getElementById('bottom-bar');
  const toggleBtn = document.getElementById('btn-toggle-ui');
  
  if (isUIVisible) {
    topBar?.classList.remove('hidden');
    bottomBar?.classList.remove('hidden');
    toggleBtn?.classList.remove('ui-hidden');
    // 更换图标为 eye-off
    const icon = toggleBtn?.querySelector('i');
    if (icon) {
      icon.setAttribute('data-lucide', 'eye-off');
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }
    console.log('显示UI');
  } else {
    topBar?.classList.add('hidden');
    bottomBar?.classList.add('hidden');
    toggleBtn?.classList.add('ui-hidden');
    // 更换图标为 eye
    const icon = toggleBtn?.querySelector('i');
    if (icon) {
      icon.setAttribute('data-lucide', 'eye');
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }
    console.log('隐藏UI');
  }
  // 通知主进程 UI 状态变化
  window.electronAPI.updateUIState({ uiVisible: isUIVisible });
}

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

    // 2. 初始化国际化
    console.log('初始化国际化...');
    await window.i18nManager.initialize();
    console.log('国际化初始化成功');

    // 3. 初始化主题
    console.log('初始化主题...');
    window.themeManager.initialize();
    console.log('主题初始化成功');

    // 4. 初始化 Live2D
    console.log('初始化 Live2D...');
    await window.live2dManager.initialize();
    console.log('Live2D 初始化成功');
    
    // 5. 加载模型
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
    
    // 5. 初始化摄像头管理器
    console.log('初始化摄像头管理器...');
    await window.cameraManager.initialize();
    console.log('摄像头管理器初始化成功');
    
    // 6. 初始化麦克风管理器
    console.log('初始化麦克风管理器...');
    await window.microphoneManager.initialize();
    console.log('麦克风管理器初始化成功');
    
    // 7. 初始化 ASR 服务
    console.log('初始化 ASR 服务...');
    try {
      const asrResult = await (window as any).electronAPI.asrInitialize();
      if (asrResult.success) {
        console.log('ASR 服务初始化成功');
        appState.asrReady = true;
      } else {
        console.warn('ASR 服务初始化失败，语音识别功能将不可用');
        appState.asrReady = false;
      }
    } catch (error) {
      console.error('ASR 服务初始化异常:', error);
      appState.asrReady = false;
    }
    
    // 设置麦克风 ASR 回调
    window.microphoneManager.setASRCallback((text: string) => {
      if (!text.trim()) return;
      
      // 如果启用了自动发送，直接发送消息
      if (settings.micAutoSend) {
        sendUserMessage(text);
      } else {
        // 否则追加到输入框（保留原有内容）
        const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
        if (chatInput) {
          const currentValue = chatInput.value.trim();
          chatInput.value = currentValue ? `${currentValue} ${text}` : text;
          chatInput.focus();
        }
      }
    });

    // 8. 初始化后端连接
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

  // 双击切换UI显示
  interactionArea.addEventListener('dblclick', () => {
    toggleUI();
  });

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
  
  // 摄像头设备选择
  const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
  if (cameraSelect) {
    cameraSelect.addEventListener('change', async () => {
      const deviceId = cameraSelect.value;
      if (deviceId) {
        try {
          await window.cameraManager.switchDevice(deviceId);
          console.log('已切换到摄像头:', deviceId);
        } catch (error) {
          console.error('切换摄像头失败:', error);
        }
      }
    });
  }
  
  // 摄像头预览关闭按钮
  const btnCloseCamera = document.getElementById('btn-close-camera');
  if (btnCloseCamera) {
    btnCloseCamera.addEventListener('click', () => {
      window.cameraManager.stop();
      const btnCamera = document.getElementById('btn-camera');
      if (btnCamera) {
        btnCamera.classList.remove('active');
      }
    });
  }

  // 监听后端消息
  window.backendClient.onMessage((message) => {
    console.log('收到后端消息:', message);
    if (message.type === 'dialogue') {
      const data = message.data as any;
      addChatMessage(data.text, false, data.attachment);
    }
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

  // UI切换按钮
  const btnToggleUI = document.getElementById('btn-toggle-ui');
  if (btnToggleUI) {
    btnToggleUI.addEventListener('click', toggleUI);
  }
}

/**
 * 显示对话窗口
 */
function showChatWindow(): void {
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) {
    chatWindow.classList.remove('hidden');
    const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
    chatInput?.focus();
    // 通知主进程对话窗口已打开
    window.electronAPI.updateUIState({ chatOpen: true });
  }
}

/**
 * 隐藏对话窗口
 */
function hideChatWindow(): void {
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) {
    chatWindow.classList.add('hidden');
    // 通知主进程对话窗口已关闭
    window.electronAPI.updateUIState({ chatOpen: false });
  }
}

/**
 * 添加聊天消息到界面
 */
function addChatMessage(text: string, isUser: boolean, attachment?: { type: 'image' | 'file', url: string, name?: string }): void {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;
  
  if (text) {
    const textNode = document.createElement('div');
    textNode.textContent = text;
    messageDiv.appendChild(textNode);
  }

  if (attachment) {
    const attachmentDiv = document.createElement('div');
    attachmentDiv.className = 'message-attachment';

    if (attachment.type === 'image') {
      const img = document.createElement('img');
      img.src = attachment.url;
      img.className = 'message-image';
      img.onclick = () => window.open(attachment.url);
      attachmentDiv.appendChild(img);
    } else {
      const fileLink = document.createElement('a');
      fileLink.href = attachment.url;
      fileLink.className = 'message-file';
      fileLink.target = '_blank';
      fileLink.download = attachment.name || 'file';
      
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'file');
      fileLink.appendChild(icon);
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = attachment.name || 'file';
      fileLink.appendChild(nameSpan);
      
      attachmentDiv.appendChild(fileLink);
    }
    
    messageDiv.appendChild(attachmentDiv);
    
    // 重新创建图标
    if (attachment.type === 'file') {
      // @ts-ignore
      if (typeof window.lucide !== 'undefined') {
        // @ts-ignore
        window.lucide.createIcons({
          nameAttr: 'data-lucide'
        });
      }
    }
  }

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * 发送聊天消息
 */
async function sendChatMessage(): Promise<void> {
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
  if (!chatInput) return;

  const text = chatInput.value.trim();
  if (!text) return;

  // 添加用户消息到界面
  addChatMessage(text, true);
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 发送到后端
  try {
    await sendUserMessage(text);
  } catch (error) {
    console.error('发送消息失败:', error);
    addChatMessage('发送失败，请检查连接', false);
  }
}

/**
 * 初始化对话窗口
 */
function initializeChatWindow(): void {
  // 打开对话按钮
  const btnOpenChat = document.getElementById('btn-open-chat');
  if (btnOpenChat) {
    btnOpenChat.addEventListener('click', showChatWindow);
  }

  // 关闭对话按钮
  const btnCloseChat = document.getElementById('btn-close-chat');
  if (btnCloseChat) {
    btnCloseChat.addEventListener('click', hideChatWindow);
  }

  // 发送按钮
  const btnSend = document.getElementById('btn-send');
  if (btnSend) {
    btnSend.addEventListener('click', sendChatMessage);
  }

  // 输入框回车发送
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
  if (chatInput) {
    chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    // 自动调整输入框高度
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = chatInput.scrollHeight + 'px';
    });
  }

  // 语音输入按钮
  const btnVoice = document.getElementById('btn-voice');
  if (btnVoice) {
    btnVoice.addEventListener('click', async () => {
      try {
        const isActive = window.microphoneManager.isActive();
        if (isActive) {
          // 停止监听
          window.microphoneManager.stopListening();
          btnVoice.classList.remove('active');
          console.log('麦克风已停止');
        } else {
          // 启动监听
          await window.microphoneManager.startListening();
          btnVoice.classList.add('active');
          console.log('麦克风已启动');
        }
      } catch (error) {
        console.error('麦克风操作失败:', error);
        window.dialogueManager?.showQuick('麦克风启动失败，请检查权限设置', 2000);
      }
    });
  }

  // 摄像头输入按钮
  const btnCamera = document.getElementById('btn-camera');
  if (btnCamera) {
    btnCamera.addEventListener('click', async () => {
      try {
        const isActive = window.cameraManager.isRunning();
        if (isActive) {
          // 停止摄像头
          window.cameraManager.stop();
          btnCamera.classList.remove('active');
          console.log('摄像头已停止');
        } else {
          // 启动摄像头
          await window.cameraManager.start();
          btnCamera.classList.add('active');
          
          // 填充设备列表
          const devices = window.cameraManager.getDevices();
          const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
          if (cameraSelect) {
            cameraSelect.innerHTML = '<option value="" data-i18n="camera.selectDevice">选择摄像头...</option>';
            devices.forEach(device => {
              const option = document.createElement('option');
              option.value = device.deviceId;
              option.textContent = device.label || `摄像头 ${device.deviceId.substring(0, 8)}`;
              cameraSelect.appendChild(option);
            });
          }
          
          console.log('摄像头已启动');
        }
      } catch (error) {
        console.error('摄像头操作失败:', error);
        window.dialogueManager?.showQuick('摄像头启动失败，请检查权限设置', 2000);
      }
    });
  }

  // 附件按钮
  const btnAttach = document.getElementById('btn-attach');
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (btnAttach && fileInput) {
    btnAttach.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const files = fileInput.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        
        reader.onload = (e) => {
          const url = e.target?.result as string;
          const isImage = file.type.startsWith('image/');
          
          addChatMessage('', true, {
            type: isImage ? 'image' : 'file',
            url: url,
            name: file.name
          });
          
          // TODO: 发送文件数据到后端
          console.log('发送文件:', file.name, '类型:', file.type);
        };

        if (file.type.startsWith('image/') || file.type.startsWith('text/') || file.size < 1024 * 1024 * 5) {
          reader.readAsDataURL(file);
        } else {
          // 对大文件仅显示名称
          addChatMessage('', true, {
            type: 'file',
            url: '#',
            name: file.name + ' (文件过大，预览暂存本地)'
          });
        }
      }
      
      // 清空 input 允许重复选择同一文件
      fileInput.value = '';
    });
  }

  // 点击背景关闭
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) {
    chatWindow.addEventListener('click', (e: MouseEvent) => {
      if (e.target === chatWindow) {
        hideChatWindow();
      }
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
  (document.getElementById('setting-websocket-url') as HTMLInputElement).value = settings.wsUrl;
  (document.getElementById('setting-auto-connect') as HTMLInputElement).checked = settings.autoConnect;
  (document.getElementById('setting-volume') as HTMLInputElement).value = String(settings.volume);
  (document.getElementById('volume-value') as HTMLSpanElement).textContent = Math.round(settings.volume * 100) + '%';
  (document.getElementById('setting-update-source') as HTMLInputElement).value = settings.updateSource;
  (document.getElementById('setting-language') as HTMLSelectElement).value = settings.locale;
  (document.getElementById('setting-theme') as HTMLSelectElement).value = settings.theme;
  (document.getElementById('setting-show-subtitle') as HTMLInputElement).checked = settings.showSubtitle;
  (document.getElementById('setting-use-custom-character') as HTMLInputElement).checked = settings.useCustomCharacter;
  (document.getElementById('setting-custom-name') as HTMLInputElement).value = settings.customName;
  (document.getElementById('setting-custom-personality') as HTMLTextAreaElement).value = settings.customPersonality;
  (document.getElementById('setting-mic-background-mode') as HTMLInputElement).checked = settings.micBackgroundMode || false;
  (document.getElementById('setting-mic-threshold') as HTMLInputElement).value = String(settings.micVolumeThreshold || 30);
  (document.getElementById('mic-threshold-value') as HTMLSpanElement).textContent = String(settings.micVolumeThreshold || 30);
  (document.getElementById('setting-mic-auto-send') as HTMLInputElement).checked = settings.micAutoSend !== false;

  // 加载触碰配置
  loadTapConfigUI();

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
  const wsUrl = (document.getElementById('setting-websocket-url') as HTMLInputElement).value;
  const autoConnect = (document.getElementById('setting-auto-connect') as HTMLInputElement).checked;
  const volume = parseFloat((document.getElementById('setting-volume') as HTMLInputElement).value);
  const updateSource = (document.getElementById('setting-update-source') as HTMLInputElement).value;
  const locale = (document.getElementById('setting-language') as HTMLSelectElement).value;
  const theme = (document.getElementById('setting-theme') as HTMLSelectElement).value as ThemeMode;
  const showSubtitle = (document.getElementById('setting-show-subtitle') as HTMLInputElement).checked;
  const useCustomCharacter = (document.getElementById('setting-use-custom-character') as HTMLInputElement).checked;
  const customName = (document.getElementById('setting-custom-name') as HTMLInputElement).value;
  const customPersonality = (document.getElementById('setting-custom-personality') as HTMLTextAreaElement).value;
  const micBackgroundMode = (document.getElementById('setting-mic-background-mode') as HTMLInputElement).checked;
  const micVolumeThreshold = parseFloat((document.getElementById('setting-mic-threshold') as HTMLInputElement).value);
  const micAutoSend = (document.getElementById('setting-mic-auto-send') as HTMLInputElement).checked;

  // 保存触碰配置
  saveTapConfigFromUI();

  // 更新设置
  window.settingsManager.updateSettings({
    modelPath,
    backendUrl,
    wsUrl,
    autoConnect,
    volume,
    updateSource,
    locale,
    theme,
    showSubtitle,
    useCustomCharacter,
    customName,
    customPersonality,
    micBackgroundMode,
    micVolumeThreshold,
    micAutoSend
  });

  // 验证设置
  const validation = window.settingsManager.validateSettings();
  if (!validation.valid) {
    alert(window.i18nManager.t('messages.settingsValidationFailed') + ':\n' + validation.errors.join('\n'));
    return;
  }

  // 应用设置
  window.audioPlayer.setVolume(volume);
  window.microphoneManager.setVolumeThreshold(micVolumeThreshold);
  window.microphoneManager.setBackgroundMode(micBackgroundMode);
  
  // 保存触碰配置
  saveTapConfigFromUI();
  
  // 提示用户重启应用
  if (confirm(window.i18nManager.t('messages.reloadConfirm'))) {
    window.location.reload();
  } else {
    hideSettingsPanel();
  }
}

/**
 * 重置设置
 */
function resetSettings(): void {
  if (confirm(window.i18nManager.t('messages.resetConfirm'))) {
    window.settingsManager.resetToDefaults();
    showSettingsPanel(); // 重新显示以更新表单
    window.dialogueManager.showDialogue(window.i18nManager.t('messages.settingsReset'), 2000);
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

  // 标签页切换
  const tabs = document.querySelectorAll('.settings-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e: Event) => {
      const target = e.currentTarget as HTMLElement;
      const tabName = target.getAttribute('data-tab');
      if (!tabName) return;

      // 移除所有激活状态
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.remove('active');
      });

      // 激活当前标签
      target.classList.add('active');
      const content = document.querySelector(`[data-tab-content="${tabName}"]`);
      if (content) {
        content.classList.add('active');
      }
    });
  });

  // 浏览模型文件按钮
  const btnBrowseModel = document.getElementById('btn-browse-model');
  if (btnBrowseModel) {
    btnBrowseModel.addEventListener('click', async () => {
      try {
        const filePath = await window.electronAPI.selectModelFile();
        if (filePath) {
          const modelPathInput = document.getElementById('setting-model-path') as HTMLInputElement;
          if (modelPathInput) {
            modelPathInput.value = filePath;
          }
        }
      } catch (error) {
        console.error('选择文件失败:', error);
      }
    });
  }

  // 检查更新按钮
  const btnCheckUpdate = document.getElementById('btn-check-update');
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', checkForUpdates);
  }

  // 获取并显示当前版本
  loadAppVersion();

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
  
  // 麦克风音量阈值滑块实时更新
  const micThresholdSlider = document.getElementById('setting-mic-threshold') as HTMLInputElement;
  if (micThresholdSlider) {
    micThresholdSlider.addEventListener('input', (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      const display = document.getElementById('mic-threshold-value');
      if (display) {
        display.textContent = value;
      }
    });
  }

  // 语言切换
  const languageSelect = document.getElementById('setting-language') as HTMLSelectElement;
  if (languageSelect) {
    languageSelect.addEventListener('change', async (e: Event) => {
      const newLocale = (e.target as HTMLSelectElement).value;
      await window.i18nManager.setLocale(newLocale);
    });
  }

  // 主题切换
  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement;
  if (themeSelect) {
    themeSelect.addEventListener('change', (e: Event) => {
      const newTheme = (e.target as HTMLSelectElement).value as ThemeMode;
      window.themeManager.setTheme(newTheme);
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
 * 加载触碰配置UI
 */
function loadTapConfigUI(): void {
  const container = document.getElementById('tap-config-container');
  if (!container) return;

  // 清空容器
  container.innerHTML = '';

  // 获取当前模型的触碰配置
  const tapConfig = window.settingsManager.getCurrentTapConfig();
  
  // 获取模型的hitAreas信息
  const modelInfo = window.live2dManager?.extractModelInfo();
  const modelHitAreas = modelInfo?.hitAreas || [];
  
  // 只渲染模型中实际存在的触碰区域（排除 default）
  for (const hitArea of modelHitAreas) {
    if (hitArea === 'default') continue; // 隐藏 default
    
    const config = tapConfig[hitArea] || { enabled: true, description: '' };
    addTapConfigItem(container, hitArea, config.enabled, config.description || '');
  }
}

/**
 * 添加触碰配置项
 */
function addTapConfigItem(container: HTMLElement, areaName: string, enabled: boolean, description: string): void {
  const item = document.createElement('div');
  item.className = 'tap-config-item';
  item.dataset.areaName = areaName;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = enabled;
  checkbox.dataset.areaName = areaName;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tap-area-name';
  nameSpan.textContent = areaName;

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'tap-area-description';
  descInput.value = description;
  descInput.placeholder = window.i18nManager.t('settings.tap.areaDescription');

  item.appendChild(checkbox);
  item.appendChild(nameSpan);
  item.appendChild(descInput);

  container.appendChild(item);
}

/**
 * 保存触碰配置
 */
function saveTapConfigFromUI(): void {
  const container = document.getElementById('tap-config-container');
  if (!container) return;

  // 获取模型的hitAreas信息，只保存模型中实际存在的区域
  const modelInfo = window.live2dManager?.extractModelInfo();
  const modelHitAreas = modelInfo?.hitAreas || [];

  const tapConfig: any = {
    // 始终保留 default 配置
    'default': { enabled: true, description: '默认触摸' }
  };
  const items = container.querySelectorAll('.tap-config-item');

  items.forEach((item: Element) => {
    const areaName = (item as HTMLElement).dataset.areaName;
    if (!areaName) return;

    // 只保存模型中存在的区域
    if (!modelHitAreas.includes(areaName)) {
      console.warn(`跳过不存在于模型中的区域: ${areaName}`);
      return;
    }

    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const descInput = item.querySelector('.tap-area-description') as HTMLInputElement;

    tapConfig[areaName] = {
      enabled: checkbox.checked,
      description: descInput.value || ''
    };
  });

  // 保存当前模型的触碰配置
  const currentModelPath = window.settingsManager.getSetting('modelPath');
  window.settingsManager.updateTapConfig(currentModelPath, tapConfig);
}

/**
 * 加载应用版本
 */
async function loadAppVersion(): Promise<void> {
  try {
    const version = await window.electronAPI.getAppVersion();
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
      versionEl.textContent = version;
    }
  } catch (error) {
    console.error('获取版本失败:', error);
  }
}

/**
 * 检查更新
 */
async function checkForUpdates(): Promise<void> {
  const statusEl = document.getElementById('update-status');
  const btnCheckUpdate = document.getElementById('btn-check-update') as HTMLButtonElement;
  
  if (!statusEl) return;
  
  // 获取更新源设置
  const settings = window.settingsManager.getSettings();
  const updateSource = settings.updateSource || 'https://github.com/gameswu/NyaDeskPet';
  
  // 显示检查中状态
  statusEl.className = 'update-status checking';
  statusEl.innerHTML = '<i data-lucide="loader" style="width: 14px; height: 14px; animation: spin 1s linear infinite;"></i> 正在检查更新...';
  statusEl.classList.remove('hidden');
  if (btnCheckUpdate) btnCheckUpdate.disabled = true;
  
  // 刷新图标
  if (window.lucide) {
    window.lucide.createIcons();
  }
  
  try {
    const result = await window.electronAPI.checkUpdate(updateSource);
    
    if (result.error) {
      statusEl.className = 'update-status error';
      statusEl.textContent = `检查更新失败: ${result.error}`;
    } else if (result.hasUpdate) {
      statusEl.className = 'update-status has-update';
      statusEl.innerHTML = `
        <div><strong>发现新版本 ${result.latestVersion}</strong></div>
        <div style="margin-top: 4px;">${result.releaseName || ''}</div>
        <div style="margin-top: 8px;">
          <a id="link-release" href="#">点击前往下载页面</a>
        </div>
      `;
      
      // 绑定链接点击事件
      const linkRelease = document.getElementById('link-release');
      if (linkRelease && result.releaseUrl) {
        linkRelease.addEventListener('click', (e) => {
          e.preventDefault();
          window.electronAPI.openExternal(result.releaseUrl!);
        });
      }
    } else {
      statusEl.className = 'update-status no-update';
      statusEl.textContent = `当前已是最新版本 (${result.currentVersion})`;
    }
  } catch (error) {
    statusEl.className = 'update-status error';
    statusEl.textContent = '检查更新失败，请稍后再试';
  } finally {
    if (btnCheckUpdate) btnCheckUpdate.disabled = false;
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
    const message: any = {
      type: 'user_input',
      text: text.trim(),
      timestamp: Date.now()
    };
    
    // 如果摄像头正在运行，附带截图
    if (window.cameraManager.isRunning()) {
      const frame = await window.cameraManager.captureFrame();
      if (frame) {
        message.attachment = {
          type: 'image',
          data: frame,
          source: 'camera'
        };
        console.log('已附加摄像头截图');
      }
    }
    
    const result = await window.backendClient.sendMessage(message);

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
  initializeChatWindow();
  initializeApp();

  // 监听来自主进程的设置打开请求
  window.electronAPI.onOpenSettings(() => {
    console.log('收到主进程打开设置请求');
    showSettingsPanel();
  });

  // 监听来自主进程的打开对话请求
  if (window.electronAPI.onOpenChat) {
    window.electronAPI.onOpenChat(() => {
      console.log('收到主进程打开对话请求');
      showChatWindow();
    });
  }

  // 监听来自主进程的切换UI请求
  if (window.electronAPI.onToggleUI) {
    window.electronAPI.onToggleUI(() => {
      console.log('收到主进程切换UI请求');
      toggleUI();
    });
  }
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
  showSettings: () => showSettingsPanel(),
  showChat: () => showChatWindow(),
  toggleUI: () => toggleUI()
};

window.app = appDebug;

console.log('渲染进程脚本加载完成');
console.log('调试命令: window.app');
