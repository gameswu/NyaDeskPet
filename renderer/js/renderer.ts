/**
 * 渲染进程主脚本
 * 协调各个模块的工作
 */

import type { AppState, AppDebugInterface, ThemeMode, TapConfig, BackendMessage, AgentProviderMetadata } from '../types/global';

// 应用状态
const appState: AppState = {
  initialized: false,
  modelLoaded: false,
  connected: false
};

// UI显示状态
let isUIVisible: boolean = true;

// 发送锁：防止连续发送消息导致后端并发处理错乱
let isSendingMessage: boolean = false;

// ==================== Provider UI 缓存 ====================

/** LLM Provider 类型缓存 */
let providerTypesCache: AgentProviderMetadata[] | null = null;

/** TTS Provider 类型缓存 */
let ttsTypesCache: AgentProviderMetadata[] | null = null;

/** 当前编辑中的 LLM Provider 元数据 */
let currentProviderMetadata: AgentProviderMetadata | undefined = undefined;

/** 当前编辑中的 TTS Provider 元数据 */
let currentTTSMetadata: AgentProviderMetadata | undefined = undefined;

// ==================== UI 常量 ====================

/** 鼠标移动节流间隔（ms） */
const MOUSE_THROTTLE_MS = 50;

/** 欢迎消息延迟（ms） */
const WELCOME_DELAY_MS = 1000;

/** 欢迎消息展示时长（ms） */
const WELCOME_DURATION_MS = 5000;

/** 弹窗状态提示自动隐藏延迟（ms） */
const DIALOG_STATUS_HIDE_DELAY_MS = 3000;

/** 对话列表延迟刷新（ms） */
const CONVERSATION_REFRESH_DELAY_MS = 500;

/** 指令建议延迟隐藏（ms） */
const COMMAND_SUGGESTION_HIDE_DELAY_MS = 200;

/** 文件最大大小（MB） */
const MAX_FILE_SIZE_MB = 100;

/** 大文件提示阈值（MB） */
const LARGE_FILE_WARN_MB = 10;

/** 错误消息默认展示时长（ms） */
const ERROR_MESSAGE_DURATION_MS = 5000;

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
    window.logger.info('显示UI');
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
    window.logger.info('隐藏UI');
  }
  // 通知主进程 UI 状态变化
  window.electronAPI.updateUIState({ uiVisible: isUIVisible });
}

/**
 * 初始化应用
 */
async function initializeApp(): Promise<void> {
  window.logger.info('开始初始化应用...');

  try {
    // 1. 初始化设置管理器
    window.settingsManager.initialize();
    const settings = window.settingsManager.getSettings();
    window.logger.info('当前设置:', settings);

    // 2. 初始化日志系统
    window.logger.info('初始化日志系统...');
    await window.logger.initialize();
    // 更新主进程日志配置
    await window.electronAPI.loggerUpdateConfig({
      enabled: settings.logEnabled,
      levels: settings.logLevels,
      retentionDays: settings.logRetentionDays
    });
    window.logger.info('日志系统初始化成功');

    // 3. 初始化国际化
    window.logger.info('初始化国际化...');
    await window.i18nManager.initialize();
    window.logger.info('国际化初始化成功');

    // 3. 初始化主题
    window.logger.info('初始化主题...');
    window.themeManager.initialize();
    window.logger.info('主题初始化成功');

    // 4. 初始化 Live2D
    window.logger.info('初始化 Live2D...');
    await window.live2dManager.initialize();
    window.logger.info('Live2D 初始化成功');
    
    // 5. 加载模型
    try {
      window.logger.info('加载模型:', settings.modelPath);
      await window.live2dManager.loadModel(settings.modelPath);
      appState.modelLoaded = true;
      window.logger.info('模型加载成功');
      
      // 应用视线跟随设置
      window.live2dManager.enableEyeTracking(settings.enableEyeTracking);
    } catch (error) {
      window.logger.error('模型加载失败:', error);
      showError('模型加载失败，请检查模型文件路径或在设置中更改');
    }

    // 4. 设置音频音量
    window.audioPlayer.setVolume(settings.volume);
    
    // 5. 初始化摄像头管理器
    window.logger.info('初始化摄像头管理器...');
    await window.cameraManager.initialize();
    window.logger.info('摄像头管理器初始化成功');
    
    // 6. 初始化麦克风管理器
    window.logger.info('初始化麦克风管理器...');
    await window.microphoneManager.initialize();
    window.logger.info('麦克风管理器初始化成功');
    
    // 7. 初始化 ASR 服务
    window.logger.info('初始化 ASR 服务...');
    try {
      const asrModel = settings.asrModel || 'sense-voice-small';
      const asrResult = await window.electronAPI.asrInitialize(asrModel);
      if (asrResult.success) {
        window.logger.info('ASR 服务初始化成功');
        appState.asrReady = true;
      } else {
        window.logger.warn('ASR 服务初始化失败，语音识别功能将不可用');
        appState.asrReady = false;
      }
    } catch (error) {
      window.logger.error('ASR 服务初始化异常:', error);
      appState.asrReady = false;
    }

    // 更新麦克风按钮状态（ASR 不可用时显示灰色）
    updateMicButtonState();
    
    // 设置麦克风 ASR 回调
    window.microphoneManager.setASRCallback((text: string) => {
      if (!text.trim()) return;
      
      // 如果启用了自动发送，直接发送消息
      if (settings.micAutoSend) {
        // 显示用户消息到聊天界面
        addChatMessage(text, true);
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
    // 如果使用内置后端模式，先启动 Agent 服务器
    if (settings.backendMode === 'builtin') {
      window.logger.info('启动内置 Agent 服务器...');
      try {
        // 同步端口设置到主进程（在 start 之前）
        const port = settings.agentPort || 8765;
        await window.electronAPI.agentSetPort(port);
        
        const agentResult = await window.electronAPI.agentStart();
        if (agentResult.success) {
          window.logger.info('内置 Agent 已启动');
          // 获取内置 Agent 的 URL 并更新 backendClient
          const urls = await window.electronAPI.agentGetUrl();
          window.backendClient.wsUrl = urls.wsUrl;
          window.backendClient.httpUrl = urls.httpUrl;
        } else {
          window.logger.error('启动内置 Agent 失败:', agentResult.error);
        }
      } catch (error) {
        window.logger.error('启动内置 Agent 异常:', error);
      }
    }

    // 更新顶栏 Agent 按钮可见性
    updateAgentButtonVisibility();

    if (settings.autoConnect) {
      window.logger.info('连接后端服务器...');
      await window.backendClient.initialize();
    }

    // 9. 插件系统已初始化（插件需要手动启动）
    window.logger.info('插件系统已就绪，等待用户操作');

    // 10. 设置事件监听
    setupEventListeners();

    // 11. 设置窗口控制
    setupWindowControls();

    appState.initialized = true;
    window.logger.info('应用初始化完成');

    // 显示欢迎消息
    setTimeout(() => {
      window.dialogueManager.showDialogue(
        window.i18nManager.t('messages.welcome'),
        WELCOME_DURATION_MS
      );
    }, WELCOME_DELAY_MS);

  } catch (error) {
    window.logger.error('应用初始化失败:', error);
  }
}

/**
 * 设置事件监听
 */
function setupEventListeners(): void {
  // 交互区域点击事件
  const interactionArea = document.getElementById('interaction-area');
  
  if (!interactionArea) {
    window.logger.error('交互区域元素未找到');
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
    
    window.logger.info('点击了宠物');
    // Live2D tap 会触发 hitTest，命中时由 live2d-manager 发送 tap_event 到后端
    window.live2dManager.tap(x, y);
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
    }, MOUSE_THROTTLE_MS);
  });
  
  // 摄像头设备选择
  const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
  if (cameraSelect) {
    cameraSelect.addEventListener('change', async () => {
      const deviceId = cameraSelect.value;
      if (deviceId) {
        try {
          await window.cameraManager.switchDevice(deviceId);
          window.logger.info('已切换到摄像头:', deviceId);
        } catch (error) {
          window.logger.error('切换摄像头失败:', error);
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
    window.logger.info('收到后端消息:', message);
    if (message.type === 'dialogue') {
      // 后端已清洗 XML 控制标签，前端直接显示
      const data = message.data as { text: string; attachment?: { type: 'image' | 'file'; url: string; name?: string }; reasoningContent?: string };
      addChatMessage(data.text, false, { attachment: data.attachment, reasoningContent: data.reasoningContent });
    } else if (message.type === 'sync_command') {
      // sync_command 包含动作+对话的组合消息，提取其中的对话文本显示在聊天记录中
      // 文本已由后端 protocol-adapter 清洗过
      const data = message.data as { actions?: Array<{ type: string; text?: string; reasoningContent?: string; attachment?: { type: 'image' | 'file'; url: string; name?: string } }> };
      if (data.actions) {
        const dialogueAction = data.actions.find(a => a.type === 'dialogue');
        if (dialogueAction?.text || dialogueAction?.attachment) {
          addChatMessage(dialogueAction.text || '', false, { attachment: dialogueAction.attachment, reasoningContent: dialogueAction.reasoningContent });
        }
      }
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
      if (confirm(window.i18nManager.t('messages.confirmClose'))) {
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

  // 插件管理按钮
  const btnPlugins = document.getElementById('btn-plugins');
  if (btnPlugins) {
    btnPlugins.addEventListener('click', () => {
      showPluginsPanel();
    });
  }

  // Agent 管理按钮
  const btnAgent = document.getElementById('btn-agent');
  if (btnAgent) {
    btnAgent.addEventListener('click', () => {
      showAgentPanel();
    });
  }

  // UI切换按钮
  const btnToggleUI = document.getElementById('btn-toggle-ui');
  if (btnToggleUI) {
    btnToggleUI.addEventListener('click', toggleUI);
  }
}

/**
 * 显示插件管理面板
 */
function showPluginsPanel(): void {
  const pluginsPanel = document.getElementById('plugins-panel');
  if (pluginsPanel) {
    pluginsPanel.classList.add('show');
    // 设置关闭按钮事件
    const btnClose = document.getElementById('btn-close-plugins');
    if (btnClose) {
      btnClose.onclick = hidePluginsPanel;
    }
    // 点击背景关闭
    pluginsPanel.onclick = (e) => {
      if (e.target === pluginsPanel) {
        hidePluginsPanel();
      }
    };
  }
}

/**
 * 隐藏插件管理面板
 */
function hidePluginsPanel(): void {
  const pluginsPanel = document.getElementById('plugins-panel');
  if (pluginsPanel) {
    pluginsPanel.classList.remove('show');
  }
}

// ==================== Agent 管理面板 ====================

/** Agent 状态刷新定时器 */
let agentStatusTimer: number | null = null;

/**
 * 显示 Agent 管理面板
 */
function showAgentPanel(): void {
  const agentPanel = document.getElementById('agent-panel');
  if (!agentPanel) return;

  agentPanel.classList.add('show');

  // 设置关闭按钮事件
  const btnClose = document.getElementById('btn-close-agent');
  if (btnClose) {
    btnClose.onclick = hideAgentPanel;
  }

  // 点击背景关闭
  agentPanel.onclick = (e) => {
    if (e.target === agentPanel) {
      hideAgentPanel();
    }
  };

  // 绑定启动/停止按钮
  const btnStart = document.getElementById('btn-agent-start');
  const btnStop = document.getElementById('btn-agent-stop');

  if (btnStart) {
    btnStart.onclick = async () => {
      btnStart.setAttribute('disabled', 'true');
      const result = await window.electronAPI.agentStart();
      if (result.success) {
        window.logger.info('内置 Agent 已启动');
      } else {
        window.logger.error('启动内置 Agent 失败:', result.error);
        btnStart.removeAttribute('disabled');
      }
      refreshAgentStatus();
    };
  }

  if (btnStop) {
    btnStop.onclick = async () => {
      btnStop.setAttribute('disabled', 'true');
      const result = await window.electronAPI.agentStop();
      if (result.success) {
        window.logger.info('内置 Agent 已停止');
      } else {
        window.logger.error('停止内置 Agent 失败:', result.error);
      }
      refreshAgentStatus();
    };
  }

  // 初始化 Provider 选择器
  initAgentProviderUI();

  // 初始化 TTS Provider UI
  initAgentTTSUI();

  // 加载工具列表
  initAgentToolsUI();

  // 加载 MCP 服务器列表
  initAgentMCPUI();

  // 初始化 Agent 插件 UI
  initAgentPluginUI();

  // 初始化指令管理 UI
  initAgentCommandsUI();

  // 初始化技能管理 UI
  initAgentSkillsUI();

  // 初始化标签页切换
  initAgentTabs();

  // 立即刷新一次状态
  refreshAgentStatus();

  // 定时刷新状态
  if (agentStatusTimer) clearInterval(agentStatusTimer);
  agentStatusTimer = window.setInterval(refreshAgentStatus, 3000);
}

/**
 * 初始化 Provider 多实例管理 UI
 */
async function initAgentProviderUI(): Promise<void> {
  try {
    // 绑定添加按钮
    const btnAdd = document.getElementById('btn-add-provider');
    if (btnAdd) {
      btnAdd.onclick = () => showProviderDialog();
    }

    // 绑定弹窗关闭/取消
    const btnClose = document.getElementById('btn-close-provider-dialog');
    const btnCancel = document.getElementById('btn-provider-dialog-cancel');
    if (btnClose) btnClose.onclick = () => hideProviderDialog();
    if (btnCancel) btnCancel.onclick = () => hideProviderDialog();

    // 点击遮罩层关闭弹窗
    const overlay = document.getElementById('provider-dialog-overlay');
    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) hideProviderDialog();
      };
    }

    // 绑定弹窗保存
    const btnSave = document.getElementById('btn-provider-dialog-save');
    if (btnSave) {
      btnSave.onclick = () => saveProviderDialog();
    }

    // 绑定 Provider 类型切换时更新配置字段
    const typeSelect = document.getElementById('provider-form-type') as HTMLSelectElement;
    if (typeSelect) {
      typeSelect.onchange = () => {
        const info = providerTypesCache;
        if (info) {
          const selectedMeta = info.find((p) => p.id === typeSelect.value);
          renderProviderConfigFields(selectedMeta, undefined, 'provider-form-config');
        }
      };
    }

    // 初始加载列表
    await refreshProviderInstances();
  } catch (error) {
    window.logger.error('初始化 Provider UI 失败:', error);
  }
}

/**
 * 刷新 Provider 实例列表
 */
async function refreshProviderInstances(): Promise<void> {
  try {
    const info = await window.electronAPI.agentGetProviders();
    providerTypesCache = info.providerTypes;

    const container = document.getElementById('agent-provider-list');
    if (!container) return;

    if (!info.instances || info.instances.length === 0) {
      container.innerHTML = `<div class="agent-provider-empty">${window.i18nManager.t('agent.provider.empty')}</div>`;
      return;
    }

    container.innerHTML = '';
    for (const inst of info.instances) {
      const card = document.createElement('div');
      card.className = `agent-provider-instance-card${inst.isPrimary ? ' primary' : ''}${!inst.enabled ? ' disabled' : ''}`;
      card.title = inst.isPrimary ? window.i18nManager.t('agent.provider.primary') : window.i18nManager.t('agent.provider.setPrimary');

      const statusLabels: Record<string, string> = {
        idle: window.i18nManager.t('agent.provider.statusIdle'),
        connecting: window.i18nManager.t('agent.provider.statusConnecting'),
        connected: window.i18nManager.t('agent.provider.statusConnected'),
        error: window.i18nManager.t('agent.provider.statusError')
      };
      const statusLabel = statusLabels[inst.status] || inst.status;

      const modelInfo = inst.config?.model ? `<div class="agent-provider-instance-model">${window.i18nManager.t('agent.provider.model')}: <span>${escapeHtml(String(inst.config.model))}</span></div>` : '';
      const errorInfo = inst.error ? `<div class="agent-provider-instance-error">${escapeHtml(inst.error)}</div>` : '';

      card.innerHTML = `
        <div class="agent-provider-instance-card-header">
          <div class="agent-provider-instance-info">
            <span class="agent-provider-instance-name">${escapeHtml(inst.displayName)}</span>
            <span class="agent-provider-instance-type">${escapeHtml(tProvider(inst.providerId, 'name', inst.metadata?.name || inst.providerId))}</span>
          </div>
          <div class="agent-provider-instance-badges">
            ${inst.isPrimary ? `<span class="agent-provider-primary-badge">${window.i18nManager.t('agent.provider.primary')}</span>` : ''}
            ${inst.enabled
              ? `<span class="agent-provider-status-badge ${inst.status}">${statusLabel}</span>`
              : `<span class="agent-provider-status-badge disabled">${window.i18nManager.t('agent.provider.statusDisabled')}</span>`
            }
          </div>
        </div>
        ${modelInfo}
        ${errorInfo}
        <div class="agent-provider-instance-actions">
          <label class="provider-enable-toggle" data-action="toggle-enable" data-instance="${escapeHtml(inst.instanceId)}">
            <input type="checkbox" ${inst.enabled ? 'checked' : ''}>
            <span class="provider-toggle-slider"></span>
            <span class="provider-toggle-label">${inst.enabled ? window.i18nManager.t('agent.provider.enabled') : window.i18nManager.t('agent.provider.disabled')}</span>
          </label>
          <div class="agent-provider-instance-btns">
            <button class="btn-small btn-primary" data-action="test" data-instance="${escapeHtml(inst.instanceId)}">
              <i data-lucide="zap" style="width: 12px; height: 12px;"></i>
              ${window.i18nManager.t('agent.provider.test')}
            </button>
            <button class="btn-small" data-action="edit" data-instance="${escapeHtml(inst.instanceId)}">
              <i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>
              ${window.i18nManager.t('agent.provider.edit')}
            </button>
            <button class="btn-small btn-danger" data-action="remove" data-instance="${escapeHtml(inst.instanceId)}">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
              ${window.i18nManager.t('agent.provider.remove')}
            </button>
          </div>
        </div>
      `;

      // 点击卡片空白区域设为主 LLM
      card.addEventListener('click', async (e) => {
        // 如果点击的是按钮或toggle，不触发
        if ((e.target as HTMLElement).closest('[data-action]') || (e.target as HTMLElement).closest('.provider-enable-toggle')) return;
        if (!inst.isPrimary) {
          await window.electronAPI.agentSetPrimaryProvider(inst.instanceId);
          await refreshProviderInstances();
        }
      });

      // 绑定卡片内按钮事件
      card.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation(); // 阻止冒泡到卡片点击
          const action = btn.getAttribute('data-action');
          const instanceId = btn.getAttribute('data-instance');
          if (!instanceId) return;

          if (action === 'toggle-enable') {
            const checkbox = btn.querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (checkbox) {
              const shouldEnable = checkbox.checked;
              if (shouldEnable) {
                await window.electronAPI.agentEnableProviderInstance(instanceId);
              } else {
                await window.electronAPI.agentDisableProviderInstance(instanceId);
              }
              await refreshProviderInstances();
            }
          } else if (action === 'test') {
            // 测试连接（不改变实例状态）
            const testResult = await window.electronAPI.agentTestProviderInstance(instanceId);
            if (testResult.success) {
              alert(window.i18nManager.t('agent.provider.testSuccess') + (testResult.model ? ` (${testResult.model})` : ''));
            } else {
              alert(`${window.i18nManager.t('agent.provider.testFailed')}: ${testResult.error || ''}`);
            }
          } else if (action === 'edit') {
            showProviderDialog(inst);
          } else if (action === 'remove') {
            if (confirm(window.i18nManager.t('agent.provider.removeConfirm'))) {
              await window.electronAPI.agentRemoveProviderInstance(instanceId);
              await refreshProviderInstances();
            }
          }
        });
      });

      container.appendChild(card);
    }

    // 刷新 lucide 图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (error) {
    window.logger.error('刷新 Provider 列表失败:', error);
  }
}

/**
 * 显示 Provider 配置弹窗（添加或编辑）
 */
function showProviderDialog(inst?: any): void {
  const overlay = document.getElementById('provider-dialog-overlay');
  if (!overlay) return;

  const titleSpan = document.querySelector('#provider-dialog-title span');
  const nameInput = document.getElementById('provider-form-name') as HTMLInputElement;
  const typeSelect = document.getElementById('provider-form-type') as HTMLSelectElement;
  const types = providerTypesCache;

  if (inst) {
    // 编辑模式
    if (titleSpan) titleSpan.textContent = window.i18nManager.t('agent.provider.editTitle');
    if (nameInput) nameInput.value = inst.displayName;

    // 填充类型下拉
    if (typeSelect && types) {
      typeSelect.innerHTML = '';
      for (const t of types) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = tProvider(t.id, 'name', t.name);
        if (t.id === inst.providerId) opt.selected = true;
        typeSelect.appendChild(opt);
      }
    }

    // 渲染配置字段，带入已保存的配置值
    const meta = types?.find((t: any) => t.id === inst.providerId);
    renderProviderConfigFields(meta, inst.config, 'provider-form-config');

    // 标记编辑状态
    overlay.setAttribute('data-editing-instance', inst.instanceId);
  } else {
    // 添加模式
    if (titleSpan) titleSpan.textContent = window.i18nManager.t('agent.provider.addTitle');
    if (nameInput) nameInput.value = '';

    // 填充 Provider 类型下拉
    if (typeSelect && types) {
      typeSelect.innerHTML = '';
      for (const t of types) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = tProvider(t.id, 'name', t.name);
        typeSelect.appendChild(opt);
      }
      // 渲染第一个类型的配置
      if (types.length > 0) {
        renderProviderConfigFields(types[0], undefined, 'provider-form-config');
      }
    }

    // 清除编辑状态
    overlay.removeAttribute('data-editing-instance');
  }

  overlay.classList.remove('hidden');
  hideProviderDialogStatus();

  // 刷新弹窗内图标
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 隐藏 Provider 配置弹窗
 */
function hideProviderDialog(): void {
  const overlay = document.getElementById('provider-dialog-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.removeAttribute('data-editing-instance');
  }
}

/**
 * 保存 Provider 弹窗（添加或更新）
 */
async function saveProviderDialog(): Promise<void> {
  const overlay = document.getElementById('provider-dialog-overlay');
  if (!overlay) return;

  const typeSelect = document.getElementById('provider-form-type') as HTMLSelectElement;
  const nameInput = document.getElementById('provider-form-name') as HTMLInputElement;
  const providerId = typeSelect?.value;
  const displayName = nameInput?.value.trim();

  if (!displayName) {
    showProviderDialogStatus(window.i18nManager.t('agent.provider.nameRequired'), 'error');
    return;
  }

  const config = collectProviderConfig(providerId, 'provider-form-config');
  const editingId = overlay.getAttribute('data-editing-instance');

  try {
    if (editingId) {
      // 更新现有实例
      const result = await window.electronAPI.agentUpdateProviderInstance(editingId, {
        providerId,
        displayName,
        config
      });
      if (result.success) {
        hideProviderDialog();
        await refreshProviderInstances();
      }
    } else {
      // 添加新实例
      const instanceId = `${providerId}-${Date.now()}`;
      const result = await window.electronAPI.agentAddProviderInstance({
        instanceId,
        providerId,
        displayName,
        config
      });
      if (result.success) {
        hideProviderDialog();
        await refreshProviderInstances();
      }
    }
  } catch (error) {
    showProviderDialogStatus(`保存失败: ${error}`, 'error');
  }
}

/**
 * 渲染 Provider 配置字段
 */
/**
 * Provider 元信息 i18n 辅助函数
 * 约定键路径: agent.providers.{providerId}.{path}
 * 找不到 i18n 键时回退到 metadata 原始值
 */
function tProvider(providerId: string, path: string, fallback: string): string {
  const key = `agent.providers.${providerId}.${path}`;
  const result = window.i18nManager.t(key);
  // t() 找不到键时返回 key 本身
  return result === key ? fallback : result;
}

function renderProviderConfigFields(metadata: any, savedConfig?: Record<string, unknown>, containerId: string = 'provider-form-config'): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  // 保存当前 metadata，供 collectProviderConfig 回退 default 值
  currentProviderMetadata = metadata;

  if (!metadata || !metadata.configSchema || metadata.configSchema.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.style.margin = '0';
    hint.style.padding = '4px 0';
    hint.textContent = window.i18nManager.t('agent.provider.noConfig');
    container.appendChild(hint);
    return;
  }

  const pid: string = metadata.id || '';

  // 分离能力声明字段（supports*）和普通字段
  const CAPABILITY_KEY_PREFIX = 'supports';
  const capabilityFields = metadata.configSchema.filter((f: any) => f.key.startsWith(CAPABILITY_KEY_PREFIX));
  const regularFields = metadata.configSchema.filter((f: any) => !f.key.startsWith(CAPABILITY_KEY_PREFIX));

  // —— 能力声明：一排勾选框，放在所有配置字段上方 ——
  if (capabilityFields.length > 0) {
    const row = document.createElement('div');
    row.className = 'provider-capability-row';
    for (const field of capabilityFields) {
      const val = savedConfig && savedConfig[field.key] !== undefined
        ? savedConfig[field.key]
        : field.default;
      const itemLabel = document.createElement('label');
      itemLabel.className = 'provider-capability-item';
      itemLabel.title = tProvider(pid, `fields.${field.key}.description`, field.description || '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = val === true || val === 'true';
      cb.dataset.providerField = field.key;
      itemLabel.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = tProvider(pid, `fields.${field.key}.label`, field.label);
      itemLabel.appendChild(span);
      row.appendChild(itemLabel);
    }
    container.appendChild(row);
  }

  // —— 普通配置字段 ——
  for (const field of regularFields) {
    const div = document.createElement('div');
    div.className = 'provider-field';

    // boolean 类型使用 Toggle 内含标签，不需要外部 label
    if (field.type !== 'boolean') {
      const label = document.createElement('label');
      label.textContent = tProvider(pid, `fields.${field.key}.label`, field.label);
      if (field.required) {
        const asterisk = document.createElement('span');
        asterisk.textContent = ' *';
        asterisk.style.color = '#dc3545';
        label.appendChild(asterisk);
      }
      div.appendChild(label);
    }

    // 获取字段值：已保存值 → default → undefined
    const getValue = () => {
      if (savedConfig && savedConfig[field.key] !== undefined) {
        return savedConfig[field.key];
      }
      return field.default;
    };

    let input: HTMLInputElement | HTMLSelectElement;

    if (field.type === 'select' && field.options) {
      input = document.createElement('select');
      const currentValue = getValue();
      for (const opt of field.options) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = tProvider(pid, `fields.${field.key}.options.${opt.value}`, opt.label);
        if (opt.value === currentValue) {
          option.selected = true;
        }
        input.appendChild(option);
      }
    } else if (field.type === 'boolean') {
      // 使用 Toggle 开关样式
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'provider-field-toggle';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const val = getValue();
      checkbox.checked = val === true || val === 'true';
      checkbox.dataset.providerField = field.key;
      toggleLabel.appendChild(checkbox);
      
      const slider = document.createElement('span');
      slider.className = 'provider-toggle-slider';
      toggleLabel.appendChild(slider);
      
      const toggleText = document.createElement('span');
      toggleText.className = 'provider-toggle-label';
      toggleText.textContent = tProvider(pid, `fields.${field.key}.label`, field.label);
      toggleLabel.appendChild(toggleText);
      
      div.appendChild(toggleLabel);
      if (field.description) {
        const hint = document.createElement('div');
        hint.className = 'field-hint';
        hint.textContent = tProvider(pid, `fields.${field.key}.description`, field.description);
        div.appendChild(hint);
      }
      container.appendChild(div);
      continue;
    } else {
      input = document.createElement('input');
      input.type = field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text';
      const val = getValue();
      if (val !== undefined && val !== null) {
        // 有值（已保存或默认值）→ 填入 input.value
        input.value = String(val);
      } else if (field.placeholder) {
        // 无值但有 placeholder → 灰色占位提示
        input.placeholder = tProvider(pid, `fields.${field.key}.placeholder`, field.placeholder);
      }
    }

    input.dataset.providerField = field.key;
    div.appendChild(input);

    if (field.description) {
      const hint = document.createElement('div');
      hint.className = 'field-hint';
      hint.textContent = tProvider(pid, `fields.${field.key}.description`, field.description);
      div.appendChild(hint);
    }

    container.appendChild(div);
  }
}

/**
 * 收集 Provider 配置表单数据
 */
function collectProviderConfig(providerId: string, containerId: string = 'provider-form-config'): any {
  const config: any = { id: providerId, name: providerId };
  const container = document.getElementById(containerId);
  if (!container) return config;

  // 获取当前选中的 provider 元信息，用于回退 default 值
  const metadata = currentProviderMetadata;
  const schemaMap = new Map<string, any>();
  if (metadata?.configSchema) {
    for (const field of metadata.configSchema) {
      schemaMap.set(field.key, field);
    }
  }

  const fields = container.querySelectorAll('[data-provider-field]');
  fields.forEach((el) => {
    const key = (el as HTMLElement).dataset.providerField!;
    const fieldSchema = schemaMap.get(key);
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        config[key] = el.checked;
      } else if (el.type === 'number') {
        const val = el.value.trim();
        config[key] = val ? (parseFloat(val) || 0) : (fieldSchema?.default ?? 0);
      } else {
        // 空字符串回退到 field.default
        config[key] = el.value || (fieldSchema?.default ?? '');
      }
    } else if (el instanceof HTMLSelectElement) {
      config[key] = el.value;
    }
  });

  return config;
}

/**
 * 显示弹窗状态
 */
function showProviderDialogStatus(message: string, type: 'success' | 'error' | 'info'): void {
  const el = document.getElementById('provider-dialog-status');
  if (!el) return;
  el.textContent = message;
  el.className = `agent-provider-status ${type}`;
  el.classList.remove('hidden');
  if (type === 'success' || type === 'info') {
    setTimeout(() => hideProviderDialogStatus(), DIALOG_STATUS_HIDE_DELAY_MS);
  }
}

function hideProviderDialogStatus(): void {
  const el = document.getElementById('provider-dialog-status');
  if (el) el.classList.add('hidden');
}

// ==================== TTS Provider 管理 UI ====================

/**
 * TTS Provider 元信息 i18n 辅助函数
 * 约定键路径: agent.ttsProviders.{providerId}.{path}
 */
function tTTSProvider(providerId: string, path: string, fallback: string): string {
  const key = `agent.ttsProviders.${providerId}.${path}`;
  const result = window.i18nManager.t(key);
  return result === key ? fallback : result;
}

/**
 * 初始化 TTS Provider 管理 UI
 */
async function initAgentTTSUI(): Promise<void> {
  try {
    const btnAdd = document.getElementById('btn-add-tts');
    if (btnAdd) {
      btnAdd.onclick = () => showTTSDialog();
    }

    const btnClose = document.getElementById('btn-close-tts-dialog');
    const btnCancel = document.getElementById('btn-tts-dialog-cancel');
    if (btnClose) btnClose.onclick = () => hideTTSDialog();
    if (btnCancel) btnCancel.onclick = () => hideTTSDialog();

    const overlay = document.getElementById('tts-dialog-overlay');
    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) hideTTSDialog();
      };
    }

    const btnSave = document.getElementById('btn-tts-dialog-save');
    if (btnSave) {
      btnSave.onclick = () => saveTTSDialog();
    }

    const typeSelect = document.getElementById('tts-form-type') as HTMLSelectElement;
    if (typeSelect) {
      typeSelect.onchange = () => {
        const info = ttsTypesCache;
        if (info) {
          const selectedMeta = info.find((p) => p.id === typeSelect.value);
          renderTTSConfigFields(selectedMeta, undefined);
        }
      };
    }

    await refreshTTSInstances();
  } catch (error) {
    window.logger.error('初始化 TTS Provider UI 失败:', error);
  }
}

/**
 * 渲染 TTS 配置字段（复用 LLM 的 renderProviderConfigFields，但用 TTS i18n）
 */
function renderTTSConfigFields(metadata: any, savedConfig?: Record<string, unknown>): void {
  const container = document.getElementById('tts-form-config');
  if (!container) return;

  if (!metadata || !metadata.configSchema || metadata.configSchema.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.style.margin = '0';
    hint.style.padding = '4px 0';
    hint.textContent = window.i18nManager.t('agent.provider.noConfig');
    container.innerHTML = '';
    container.appendChild(hint);
    return;
  }

  // 存储 metadata 引用
  currentTTSMetadata = metadata;

  container.innerHTML = '';

  const pid: string = metadata.id || '';

  for (const field of metadata.configSchema) {
    const div = document.createElement('div');
    div.className = 'provider-field';

    // boolean 类型使用 Toggle 内含标签，不需要外部 label
    if (field.type !== 'boolean') {
      const label = document.createElement('label');
      label.textContent = tTTSProvider(pid, `fields.${field.key}.label`, field.label);
      if (field.required) {
        const asterisk = document.createElement('span');
        asterisk.textContent = ' *';
        asterisk.style.color = '#dc3545';
        label.appendChild(asterisk);
      }
      div.appendChild(label);
    }

    // 获取字段值：已保存值 → default → undefined
    const getValue = (): any => {
      if (savedConfig && savedConfig[field.key] !== undefined && savedConfig[field.key] !== '') {
        return savedConfig[field.key];
      }
      return field.default;
    };

    let input: HTMLInputElement | HTMLSelectElement;

    if (field.type === 'select' && field.options) {
      input = document.createElement('select');
      const currentValue = getValue();
      for (const opt of field.options) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = tTTSProvider(pid, `fields.${field.key}.options.${opt.value}`, opt.label);
        if (opt.value === String(currentValue)) {
          option.selected = true;
        }
        input.appendChild(option);
      }
    } else if (field.type === 'boolean') {
      // 使用 Toggle 开关样式
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'provider-field-toggle';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const val = getValue();
      checkbox.checked = val === true || val === 'true';
      checkbox.dataset.providerField = field.key;
      toggleLabel.appendChild(checkbox);
      
      const slider = document.createElement('span');
      slider.className = 'provider-toggle-slider';
      toggleLabel.appendChild(slider);
      
      const toggleText = document.createElement('span');
      toggleText.className = 'provider-toggle-label';
      toggleText.textContent = tTTSProvider(pid, `fields.${field.key}.label`, field.label);
      toggleLabel.appendChild(toggleText);
      
      div.appendChild(toggleLabel);
      if (field.description) {
        const hint = document.createElement('div');
        hint.className = 'field-hint';
        hint.textContent = tTTSProvider(pid, `fields.${field.key}.description`, field.description);
        div.appendChild(hint);
      }
      container.appendChild(div);
      continue;
    } else {
      input = document.createElement('input');
      input.name = field.key;
      input.type = field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text';

      const val = getValue();
      if (val !== undefined && val !== null) {
        input.value = String(val);
      } else if (field.placeholder) {
        input.placeholder = tTTSProvider(pid, `fields.${field.key}.placeholder`, field.placeholder);
      }

      if (field.required) input.required = true;
    }

    input.dataset.providerField = field.key;
    div.appendChild(input);

    if (field.description) {
      const hint = document.createElement('div');
      hint.className = 'field-hint';
      hint.textContent = tTTSProvider(pid, `fields.${field.key}.description`, field.description);
      div.appendChild(hint);
    }

    container.appendChild(div);
  }
}

/**
 * 收集 TTS 配置表单数据
 */
function collectTTSConfig(providerId: string): any {
  const container = document.getElementById('tts-form-config');
  if (!container) return {};

  const config: any = { id: providerId, name: providerId };
  const metadata = currentTTSMetadata;
  const schemaMap = new Map<string, any>();
  if (metadata?.configSchema) {
    for (const field of metadata.configSchema) {
      schemaMap.set(field.key, field);
    }
  }

  const fields = container.querySelectorAll('[data-provider-field]');
  fields.forEach((el) => {
    const key = (el as HTMLElement).dataset.providerField!;
    const fieldSchema = schemaMap.get(key);
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        config[key] = el.checked;
      } else if (el.type === 'number') {
        const val = el.value.trim();
        config[key] = val ? (parseFloat(val) || 0) : (fieldSchema?.default ?? 0);
      } else {
        config[key] = el.value || (fieldSchema?.default ?? '');
      }
    } else if (el instanceof HTMLSelectElement) {
      config[key] = el.value;
    }
  });

  return config;
}

/**
 * 刷新 TTS Provider 实例列表
 */
async function refreshTTSInstances(): Promise<void> {
  try {
    const info = await window.electronAPI.agentGetTTSProviders();
    ttsTypesCache = info.providerTypes;

    const container = document.getElementById('agent-tts-list');
    if (!container) return;

    if (!info.instances || info.instances.length === 0) {
      container.innerHTML = `<div class="agent-provider-empty">${window.i18nManager.t('agent.tts.empty')}</div>`;
      return;
    }

    container.innerHTML = '';
    for (const inst of info.instances) {
      const card = document.createElement('div');
      card.className = `agent-provider-instance-card${inst.isPrimary ? ' primary' : ''}${!inst.enabled ? ' disabled' : ''}`;
      card.title = inst.isPrimary ? window.i18nManager.t('agent.tts.primary') : window.i18nManager.t('agent.tts.setPrimary');

      const statusLabels: Record<string, string> = {
        idle: window.i18nManager.t('agent.provider.statusIdle'),
        connecting: window.i18nManager.t('agent.provider.statusConnecting'),
        connected: window.i18nManager.t('agent.provider.statusConnected'),
        error: window.i18nManager.t('agent.provider.statusError')
      };
      const statusLabel = statusLabels[inst.status] || inst.status;

      const voiceInfo = inst.config?.voiceId ? `<div class="agent-provider-instance-model">${window.i18nManager.t('agent.tts.voice')}: <span>${escapeHtml(String(inst.config.voiceId))}</span></div>` : '';
      const errorInfo = inst.error ? `<div class="agent-provider-instance-error">${escapeHtml(inst.error)}</div>` : '';

      card.innerHTML = `
        <div class="agent-provider-instance-card-header">
          <div class="agent-provider-instance-info">
            <span class="agent-provider-instance-name">${escapeHtml(inst.displayName)}</span>
            <span class="agent-provider-instance-type">${escapeHtml(tTTSProvider(inst.providerId, 'name', inst.metadata?.name || inst.providerId))}</span>
          </div>
          <div class="agent-provider-instance-badges">
            ${inst.isPrimary ? `<span class="agent-provider-primary-badge">${window.i18nManager.t('agent.tts.primary')}</span>` : ''}
            ${inst.enabled
              ? `<span class="agent-provider-status-badge ${inst.status}">${statusLabel}</span>`
              : `<span class="agent-provider-status-badge disabled">${window.i18nManager.t('agent.provider.statusDisabled')}</span>`
            }
          </div>
        </div>
        ${voiceInfo}
        ${errorInfo}
        <div class="agent-provider-instance-actions">
          <label class="provider-enable-toggle" data-action="toggle-enable" data-instance="${escapeHtml(inst.instanceId)}">
            <input type="checkbox" ${inst.enabled ? 'checked' : ''}>
            <span class="provider-toggle-slider"></span>
            <span class="provider-toggle-label">${inst.enabled ? window.i18nManager.t('agent.provider.enabled') : window.i18nManager.t('agent.provider.disabled')}</span>
          </label>
          <div class="agent-provider-instance-btns">
            <button class="btn-small btn-primary" data-action="test" data-instance="${escapeHtml(inst.instanceId)}">
              <i data-lucide="zap" style="width: 12px; height: 12px;"></i>
              ${window.i18nManager.t('agent.provider.test')}
            </button>
            <button class="btn-small" data-action="edit" data-instance="${escapeHtml(inst.instanceId)}">
              <i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>
              ${window.i18nManager.t('agent.provider.edit')}
            </button>
            <button class="btn-small btn-danger" data-action="remove" data-instance="${escapeHtml(inst.instanceId)}">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
              ${window.i18nManager.t('agent.provider.remove')}
            </button>
          </div>
        </div>
      `;

      // 点击卡片空白区域设为主 TTS
      card.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).closest('[data-action]') || (e.target as HTMLElement).closest('.provider-enable-toggle')) return;
        if (!inst.isPrimary) {
          await window.electronAPI.agentSetPrimaryTTS(inst.instanceId);
          await refreshTTSInstances();
        }
      });

      // 绑定卡片内按钮事件
      card.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const action = btn.getAttribute('data-action');
          const instanceId = btn.getAttribute('data-instance');
          if (!instanceId) return;

          if (action === 'toggle-enable') {
            const checkbox = btn.querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (checkbox) {
              if (checkbox.checked) {
                await window.electronAPI.agentEnableTTSInstance(instanceId);
              } else {
                await window.electronAPI.agentDisableTTSInstance(instanceId);
              }
              await refreshTTSInstances();
            }
          } else if (action === 'test') {
            const testResult = await window.electronAPI.agentTestTTSInstance(instanceId);
            if (testResult.success) {
              alert(window.i18nManager.t('agent.tts.testSuccess'));
            } else {
              alert(`${window.i18nManager.t('agent.tts.testFailed')}: ${testResult.error || ''}`);
            }
          } else if (action === 'edit') {
            showTTSDialog(inst);
          } else if (action === 'remove') {
            if (confirm(window.i18nManager.t('agent.tts.removeConfirm'))) {
              await window.electronAPI.agentRemoveTTSInstance(instanceId);
              await refreshTTSInstances();
            }
          }
        });
      });

      container.appendChild(card);
    }

    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (error) {
    window.logger.error('刷新 TTS 列表失败:', error);
  }
}

/**
 * 显示 TTS Provider 配置弹窗
 */
function showTTSDialog(inst?: any): void {
  const overlay = document.getElementById('tts-dialog-overlay');
  if (!overlay) return;

  const titleSpan = document.querySelector('#tts-dialog-title span');
  const nameInput = document.getElementById('tts-form-name') as HTMLInputElement;
  const typeSelect = document.getElementById('tts-form-type') as HTMLSelectElement;
  const types = ttsTypesCache;

  if (inst) {
    if (titleSpan) titleSpan.textContent = window.i18nManager.t('agent.tts.editTitle');
    if (nameInput) nameInput.value = inst.displayName;

    if (typeSelect && types) {
      typeSelect.innerHTML = '';
      for (const t of types) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = tTTSProvider(t.id, 'name', t.name);
        if (t.id === inst.providerId) opt.selected = true;
        typeSelect.appendChild(opt);
      }
    }

    const meta = types?.find((t: any) => t.id === inst.providerId);
    renderTTSConfigFields(meta, inst.config);
    overlay.setAttribute('data-editing-instance', inst.instanceId);
  } else {
    if (titleSpan) titleSpan.textContent = window.i18nManager.t('agent.tts.addTitle');
    if (nameInput) nameInput.value = '';

    if (typeSelect && types) {
      typeSelect.innerHTML = '';
      for (const t of types) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = tTTSProvider(t.id, 'name', t.name);
        typeSelect.appendChild(opt);
      }
      if (types.length > 0) {
        renderTTSConfigFields(types[0], undefined);
      }
    }

    overlay.removeAttribute('data-editing-instance');
  }

  overlay.classList.remove('hidden');
  hideTTSDialogStatus();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function hideTTSDialog(): void {
  const overlay = document.getElementById('tts-dialog-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.removeAttribute('data-editing-instance');
  }
}

async function saveTTSDialog(): Promise<void> {
  const overlay = document.getElementById('tts-dialog-overlay');
  if (!overlay) return;

  const typeSelect = document.getElementById('tts-form-type') as HTMLSelectElement;
  const nameInput = document.getElementById('tts-form-name') as HTMLInputElement;
  const providerId = typeSelect?.value;
  const displayName = nameInput?.value.trim();

  if (!displayName) {
    showTTSDialogStatus(window.i18nManager.t('agent.tts.nameRequired'), 'error');
    return;
  }

  const config = collectTTSConfig(providerId);
  const editingId = overlay.getAttribute('data-editing-instance');

  try {
    if (editingId) {
      const result = await window.electronAPI.agentUpdateTTSInstance(editingId, {
        providerId,
        displayName,
        config
      });
      if (result.success) {
        hideTTSDialog();
        await refreshTTSInstances();
      }
    } else {
      const instanceId = `tts-${providerId}-${Date.now()}`;
      const result = await window.electronAPI.agentAddTTSInstance({
        instanceId,
        providerId,
        displayName,
        config
      });
      if (result.success) {
        hideTTSDialog();
        await refreshTTSInstances();
      }
    }
  } catch (error) {
    showTTSDialogStatus(`保存失败: ${error}`, 'error');
  }
}

function showTTSDialogStatus(message: string, type: 'success' | 'error' | 'info'): void {
  const el = document.getElementById('tts-dialog-status');
  if (!el) return;
  el.textContent = message;
  el.className = `agent-provider-status ${type}`;
  el.classList.remove('hidden');
  if (type === 'success' || type === 'info') {
    setTimeout(() => hideTTSDialogStatus(), DIALOG_STATUS_HIDE_DELAY_MS);
  }
}

function hideTTSDialogStatus(): void {
  const el = document.getElementById('tts-dialog-status');
  if (el) el.classList.add('hidden');
}

// ==================== Function 工具管理 ====================

/**
 * 初始化工具管理 UI
 */
async function initAgentToolsUI(): Promise<void> {
  // 绑定刷新按钮
  const btnRefresh = document.getElementById('btn-tools-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = () => refreshToolList();
  }

  // 监听后端工具变更，自动刷新列表
  window.electronAPI.onAgentToolsChanged(() => {
    refreshToolList();
  });

  await refreshToolList();
}

/**
 * 刷新工具列表
 */
async function refreshToolList(): Promise<void> {
  try {
    const tools = await window.electronAPI.agentGetTools();
    const container = document.getElementById('agent-tools-list');
    const countEl = document.getElementById('agent-tools-count');
    const enabledCountEl = document.getElementById('agent-tools-enabled-count');
    if (!container) return;

    const enabledCount = tools.filter((t: any) => t.enabled).length;
    if (countEl) countEl.textContent = `${tools.length} ${window.i18nManager.t('agent.tools.unit')}`;
    if (enabledCountEl) enabledCountEl.textContent = `(${enabledCount} ${window.i18nManager.t('agent.tools.enabled')})`;

    if (tools.length === 0) {
      container.innerHTML = `<div class="agent-tools-empty">${window.i18nManager.t('agent.tools.empty')}</div>`;
      return;
    }

    container.innerHTML = '';
    tools.forEach((tool: any) => {
      const item = document.createElement('div');
      item.className = 'agent-tool-item';

      // i18n: 优先使用当前 locale 的描述
      const locale = window.i18nManager?.currentLocale || 'zh-CN';
      const toolDesc = tool.i18n?.[locale]?.description || tool.description || '';

      const sourceIcon = tool.source === 'mcp' ? '🔌' : tool.source === 'plugin' ? '🧩' : '⚡';
      const sourceLabel = tool.source === 'mcp' ? 'MCP' : tool.source === 'plugin' ? 'Plugin' : 'Func';
      const mcpInfo = tool.mcpServer ? ` · ${tool.mcpServer}` : '';

      item.innerHTML = `
        <div class="agent-tool-icon ${tool.source}">
          ${sourceIcon}
        </div>
        <div class="agent-tool-info">
          <div class="agent-tool-name">
            ${escapeHtml(tool.name)}
            <span class="agent-tool-source-badge ${tool.source}">${sourceLabel}${mcpInfo}</span>
          </div>
          <div class="agent-tool-desc" title="${escapeHtml(toolDesc)}">${escapeHtml(toolDesc)}</div>
        </div>
        <div class="agent-tool-toggle">
          <label class="toggle-switch">
            <input type="checkbox" ${tool.enabled ? 'checked' : ''} data-tool-id="${escapeHtml(tool.id)}" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      `;

      // 绑定开关事件
      const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (checkbox) {
        checkbox.addEventListener('change', async () => {
          try {
            await window.electronAPI.agentSetToolEnabled(tool.id, checkbox.checked);
            // 更新计数
            await refreshToolList();
          } catch (error) {
            window.logger.error('设置工具启用状态失败:', error);
            checkbox.checked = !checkbox.checked; // 回滚
          }
        });
      }

      container.appendChild(item);
    });

    // 刷新 lucide 图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (error) {
    window.logger.error('加载工具列表失败:', error);
  }
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== MCP 服务器管理 ====================

/**
 * 初始化 MCP 管理 UI
 */
async function initAgentMCPUI(): Promise<void> {
  // 绑定添加按钮
  const btnAdd = document.getElementById('btn-mcp-add');
  if (btnAdd) {
    btnAdd.onclick = () => showMCPForm();
  }

  // 绑定取消按钮
  const btnCancel = document.getElementById('btn-mcp-cancel');
  if (btnCancel) {
    btnCancel.onclick = () => hideMCPForm();
  }

  // 绑定保存按钮
  const btnSave = document.getElementById('btn-mcp-save');
  if (btnSave) {
    btnSave.onclick = () => saveMCPServer();
  }

  // 传输方式切换：stdio/sse
  const transportSelect = document.getElementById('mcp-transport') as HTMLSelectElement;
  if (transportSelect) {
    transportSelect.addEventListener('change', () => {
      const commandRow = document.getElementById('mcp-command-row');
      const urlRow = document.getElementById('mcp-url-row');
      if (transportSelect.value === 'stdio') {
        commandRow?.classList.remove('hidden');
        urlRow?.classList.add('hidden');
      } else {
        commandRow?.classList.add('hidden');
        urlRow?.classList.remove('hidden');
      }
    });
  }

  await refreshMCPServers();
}

/**
 * 刷新 MCP 服务器列表
 */
async function refreshMCPServers(): Promise<void> {
  try {
    const { configs, statuses } = await window.electronAPI.agentGetMCPServers();
    const container = document.getElementById('agent-mcp-list');
    if (!container) return;

    if (configs.length === 0) {
      container.innerHTML = `<div class="agent-mcp-empty">${window.i18nManager.t('agent.mcp.noServers')}</div>`;
      return;
    }

    container.innerHTML = '';
    configs.forEach((config: any) => {
      const status = statuses.find((s: any) => s.name === config.name);
      const isConnected = status?.connected ?? false;
      const toolCount = status?.toolCount ?? 0;
      const error = status?.error;

      const item = document.createElement('div');
      item.className = 'agent-mcp-item';

      const statusClass = error ? 'error' : (isConnected ? 'connected' : '');

      item.innerHTML = `
        <div class="agent-mcp-status-dot ${statusClass}"></div>
        <div class="agent-mcp-info">
          <div class="agent-mcp-name">
            ${escapeHtml(config.name)}
            <span class="agent-mcp-transport-badge">${config.transport}</span>
          </div>
          ${config.description ? `<div class="agent-mcp-desc">${escapeHtml(config.description)}</div>` : ''}
          ${isConnected ? `<div class="agent-mcp-tool-count">${toolCount} ${window.i18nManager.t('agent.tools.unit')}</div>` : ''}
          ${error ? `<div class="agent-mcp-error">${escapeHtml(error)}</div>` : ''}
        </div>
        <div class="agent-mcp-actions">
          ${isConnected
            ? `<button class="btn-icon-small disconnect" title="${window.i18nManager.t('agent.mcp.disconnect')}" data-mcp-action="disconnect" data-mcp-name="${escapeHtml(config.name)}">
                <i data-lucide="unplug" style="width: 14px; height: 14px;"></i>
              </button>`
            : `<button class="btn-icon-small connect" title="${window.i18nManager.t('agent.mcp.connect')}" data-mcp-action="connect" data-mcp-name="${escapeHtml(config.name)}">
                <i data-lucide="plug" style="width: 14px; height: 14px;"></i>
              </button>`
          }
          <button class="btn-icon-small delete" title="${window.i18nManager.t('agent.mcp.remove')}" data-mcp-action="delete" data-mcp-name="${escapeHtml(config.name)}">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </div>
      `;

      // 绑定事件
      item.querySelectorAll('[data-mcp-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.getAttribute('data-mcp-action');
          const name = btn.getAttribute('data-mcp-name');
          if (!name) return;

          try {
            if (action === 'connect') {
              await window.electronAPI.agentConnectMCPServer(name);
            } else if (action === 'disconnect') {
              await window.electronAPI.agentDisconnectMCPServer(name);
            } else if (action === 'delete') {
              await window.electronAPI.agentDisconnectMCPServer(name);
              await window.electronAPI.agentRemoveMCPServer(name);
            }
            await refreshMCPServers();
            await refreshToolList(); // MCP 连接/断开会影响工具列表
          } catch (error) {
            window.logger.error(`MCP 操作 ${action} 失败:`, error);
          }
        });
      });

      container.appendChild(item);
    });

    // 刷新 lucide 图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (error) {
    window.logger.error('加载 MCP 服务器列表失败:', error);
  }
}

/**
 * 显示 MCP 添加表单
 */
function showMCPForm(): void {
  const form = document.getElementById('agent-mcp-form');
  form?.classList.remove('hidden');

  // 重置表单
  (document.getElementById('mcp-name') as HTMLInputElement).value = '';
  (document.getElementById('mcp-description') as HTMLInputElement).value = '';
  (document.getElementById('mcp-transport') as HTMLSelectElement).value = 'stdio';
  (document.getElementById('mcp-command') as HTMLInputElement).value = '';
  (document.getElementById('mcp-url') as HTMLInputElement).value = '';
  (document.getElementById('mcp-working-dir') as HTMLInputElement).value = '';
  (document.getElementById('mcp-env') as HTMLInputElement).value = '';

  // 默认显示 command 行
  document.getElementById('mcp-command-row')?.classList.remove('hidden');
  document.getElementById('mcp-url-row')?.classList.add('hidden');

  // 隐藏状态
  const statusEl = document.getElementById('agent-mcp-form-status');
  statusEl?.classList.add('hidden');
}

/**
 * 隐藏 MCP 添加表单
 */
function hideMCPForm(): void {
  const form = document.getElementById('agent-mcp-form');
  form?.classList.add('hidden');
}

/**
 * 保存新 MCP 服务器
 */
async function saveMCPServer(): Promise<void> {
  const name = (document.getElementById('mcp-name') as HTMLInputElement).value.trim();
  const description = (document.getElementById('mcp-description') as HTMLInputElement).value.trim();
  const transport = (document.getElementById('mcp-transport') as HTMLSelectElement).value as 'stdio' | 'sse';
  const command = (document.getElementById('mcp-command') as HTMLInputElement).value.trim();
  const url = (document.getElementById('mcp-url') as HTMLInputElement).value.trim();
  const workingDir = (document.getElementById('mcp-working-dir') as HTMLInputElement).value.trim();
  const envStr = (document.getElementById('mcp-env') as HTMLInputElement).value.trim();

  // 验证
  if (!name) {
    showMCPFormStatus(window.i18nManager.t('agent.mcp.nameRequired'), 'error');
    return;
  }

  if (transport === 'stdio' && !command) {
    showMCPFormStatus(window.i18nManager.t('agent.mcp.commandRequired'), 'error');
    return;
  }

  if (transport === 'sse' && !url) {
    showMCPFormStatus(window.i18nManager.t('agent.mcp.urlRequired'), 'error');
    return;
  }

  // 解析环境变量
  let env: Record<string, string> | undefined;
  if (envStr) {
    try {
      env = JSON.parse(envStr);
    } catch {
      showMCPFormStatus(window.i18nManager.t('agent.mcp.envInvalid'), 'error');
      return;
    }
  }

  const config: any = {
    name,
    transport,
    ...(description && { description }),
    ...(transport === 'stdio' && { command }),
    ...(transport === 'sse' && { url }),
    ...(workingDir && { workingDirectory: workingDir }),
    ...(env && { env }),
  };

  try {
    const result = await window.electronAPI.agentAddMCPServer(config);
    if (result.success) {
      hideMCPForm();
      await refreshMCPServers();
    } else {
      showMCPFormStatus(result.error || 'Failed', 'error');
    }
  } catch (error) {
    showMCPFormStatus(String(error), 'error');
  }
}

/**
 * 显示 MCP 表单状态消息
 */
function showMCPFormStatus(message: string, type: 'success' | 'error'): void {
  const statusEl = document.getElementById('agent-mcp-form-status');
  if (!statusEl) return;
  statusEl.className = `agent-provider-status ${type}`;
  statusEl.textContent = message;
  statusEl.classList.remove('hidden');
}

// ==================== Agent 标签页管理 ====================

/**
 * 初始化 Agent 标签页切换
 */
function initAgentTabs(): void {
  const tabs = document.querySelectorAll('.agent-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e: Event) => {
      const target = e.currentTarget as HTMLElement;
      const tabName = target.getAttribute('data-agent-tab');
      if (!tabName) return;

      // 移除所有激活状态
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.agent-tab-content').forEach(content => {
        content.classList.remove('active');
      });

      // 激活当前标签
      target.classList.add('active');
      const content = document.querySelector(`[data-agent-tab-content="${tabName}"]`);
      if (content) {
        content.classList.add('active');
      }

      // 如果是工具标签，刷新工具和 MCP 列表
      if (tabName === 'tools') {
        refreshToolList();
        refreshMCPServers();
      }

      // 如果是插件标签，刷新插件列表
      if (tabName === 'plugins') {
        refreshAgentPlugins();
      }

      // 如果是指令标签，刷新指令列表
      if (tabName === 'commands') {
        refreshAgentCommands();
      }

      // 如果是技能标签，刷新技能列表
      if (tabName === 'skills') {
        refreshAgentSkills();
      }
    });
  });
}

// ==================== Agent 插件管理 ====================

/**
 * 初始化 Agent 插件管理 UI
 */
function initAgentPluginUI(): void {
  // 绑定刷新按钮
  const btnRefresh = document.getElementById('btn-agent-plugin-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = () => refreshAgentPlugins();
  }

  // 绑定打开插件目录按钮
  const btnOpenDir = document.getElementById('btn-agent-plugin-open-dir');
  if (btnOpenDir) {
    btnOpenDir.onclick = async () => {
      await window.electronAPI.agentOpenPluginsDir();
    };
  }

}

/**
 * 刷新 Agent 插件列表
 */
async function refreshAgentPlugins(): Promise<void> {
  try {
    const plugins = await window.electronAPI.agentGetPlugins();
    const container = document.getElementById('agent-plugin-list');
    if (!container) return;

    if (!plugins || plugins.length === 0) {
      container.innerHTML = `<div class="agent-plugin-empty">${window.i18nManager.t('agent.agentPlugins.empty')}</div>`;
      return;
    }

    container.innerHTML = '';
    plugins.forEach((plugin: any) => {
      const card = document.createElement('div');
      card.className = 'agent-plugin-card';

      // i18n: 优先使用当前 locale 的描述
      const locale = window.i18nManager?.currentLocale || 'zh-CN';
      const pluginDesc = plugin.i18n?.[locale]?.desc || plugin.desc;

      const statusLabels: Record<string, string> = {
        loaded: window.i18nManager.t('agent.agentPlugins.statusLoaded'),
        active: window.i18nManager.t('agent.agentPlugins.statusActive'),
        error: window.i18nManager.t('agent.agentPlugins.statusError'),
        disabled: window.i18nManager.t('agent.agentPlugins.statusDisabled')
      };
      const statusLabel = statusLabels[plugin.status] || plugin.status;

      card.innerHTML = `
        <div class="agent-plugin-card-header">
          <div class="agent-plugin-info">
            <div class="agent-plugin-name">
              ${escapeHtml(plugin.name)}
              <span class="agent-plugin-version">v${escapeHtml(plugin.version)}</span>
              <span class="agent-plugin-status-badge ${plugin.status}">${statusLabel}</span>
            </div>
            <div class="agent-plugin-author">${window.i18nManager.t('agent.agentPlugins.author')}: ${escapeHtml(plugin.author)}</div>
          </div>
        </div>
        <div class="agent-plugin-desc">${escapeHtml(pluginDesc)}</div>
        <div class="agent-plugin-meta">
          <span class="agent-plugin-tool-count">
            <i data-lucide="wrench" style="width: 12px; height: 12px;"></i>
            ${plugin.toolCount} ${window.i18nManager.t('agent.tools.unit')}
          </span>
          ${plugin.repo ? `<a href="#" class="agent-plugin-repo" data-repo="${escapeHtml(plugin.repo)}">
            <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>
            ${window.i18nManager.t('agent.agentPlugins.repo')}
          </a>` : ''}
        </div>
        <div class="agent-plugin-card-actions">
          ${plugin.status === 'active'
            ? `<button class="btn-small btn-secondary" data-action="deactivate" data-plugin="${escapeHtml(plugin.name)}">
                <i data-lucide="pause" style="width: 12px; height: 12px;"></i>
                ${window.i18nManager.t('agent.agentPlugins.deactivate')}
              </button>`
            : `<button class="btn-small btn-primary" data-action="activate" data-plugin="${escapeHtml(plugin.name)}">
                <i data-lucide="play" style="width: 12px; height: 12px;"></i>
                ${window.i18nManager.t('agent.agentPlugins.activate')}
              </button>`
          }
          <button class="btn-small" data-action="reload" data-plugin="${escapeHtml(plugin.name)}">
            <i data-lucide="refresh-cw" style="width: 12px; height: 12px;"></i>
            ${window.i18nManager.t('agent.agentPlugins.reload')}
          </button>
          ${plugin.configSchema ? `<button class="btn-small" data-action="config" data-plugin="${escapeHtml(plugin.name)}">
            <i data-lucide="settings" style="width: 12px; height: 12px;"></i>
            ${window.i18nManager.t('agent.agentPlugins.config')}
          </button>` : ''}
          <button class="btn-small" data-action="open-data-dir" data-plugin="${escapeHtml(plugin.name)}" title="${window.i18nManager?.t('plugin.openDataDirectory') || '打开数据目录'}">
            <i data-lucide="database" style="width: 12px; height: 12px;"></i>
          </button>
          <button class="btn-small btn-danger" data-action="clear-data" data-plugin="${escapeHtml(plugin.name)}" title="${window.i18nManager?.t('plugin.clearData') || '清除数据'}">
            <i data-lucide="eraser" style="width: 12px; height: 12px;"></i>
          </button>
          <button class="btn-small btn-danger" data-action="uninstall" data-plugin="${escapeHtml(plugin.name)}">
            <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            ${window.i18nManager.t('agent.agentPlugins.uninstall')}
          </button>
        </div>
        ${plugin.error ? `<div class="agent-plugin-error-msg">${escapeHtml(plugin.error)}</div>` : ''}
      `;

      // 绑定操作按钮事件
      card.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.getAttribute('data-action');
          const name = btn.getAttribute('data-plugin');
          if (!name) return;

          try {
            if (action === 'activate') {
              const result = await window.electronAPI.agentActivatePlugin(name);
              if (!result.success) {
                window.logger.error(`激活插件 ${name} 失败:`, result.error);
              }
            } else if (action === 'deactivate') {
              const result = await window.electronAPI.agentDeactivatePlugin(name);
              if (!result.success) {
                window.logger.error(`停用插件 ${name} 失败:`, result.error);
              }
            } else if (action === 'reload') {
              const result = await window.electronAPI.agentReloadPlugin(name);
              if (!result.success) {
                window.logger.error(`重载插件 ${name} 失败:`, result.error);
              }
            } else if (action === 'uninstall') {
              if (confirm(window.i18nManager.t('agent.agentPlugins.uninstallConfirm'))) {
                const result = await window.electronAPI.agentUninstallPlugin(name);
                if (!result.success) {
                  window.logger.error(`卸载插件 ${name} 失败:`, result.error);
                }
              }
            } else if (action === 'config') {
              await showPluginConfigDialog(plugin);
            } else if (action === 'open-data-dir') {
              const result = await window.electronAPI.agentOpenPluginDataDir(name);
              if (!result.success) {
                window.logger.error(`打开插件 ${name} 数据目录失败:`, result.error);
              }
              return; // 不需要刷新列表
            } else if (action === 'clear-data') {
              if (confirm(`确定要清除插件 "${name}" 的所有持久化数据吗？配置将会保留，但此操作不可撤销。`)) {
                const result = await window.electronAPI.agentClearPluginData(name);
                if (result.success) {
                  alert('插件数据已清除');
                } else {
                  window.logger.error(`清除插件 ${name} 数据失败:`, result.error);
                  alert(`清除失败: ${result.error || '未知错误'}`);
                }
              }
              return; // 不需要刷新列表
            }
            await refreshAgentPlugins();
            await refreshToolList();
          } catch (error) {
            window.logger.error(`Agent 插件操作 ${action} 失败:`, error);
          }
        });
      });

      // 绑定仓库链接
      const repoLink = card.querySelector('.agent-plugin-repo');
      if (repoLink) {
        repoLink.addEventListener('click', (e) => {
          e.preventDefault();
          const repo = (repoLink as HTMLElement).dataset.repo;
          if (repo) {
            window.electronAPI.openExternal(repo);
          }
        });
      }

      container.appendChild(card);
    });

    // 刷新 lucide 图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (error) {
    window.logger.error('加载 Agent 插件列表失败:', error);
  }
}

/**
 * 显示插件配置弹窗（复用 PluginConfigUI，通过 Agent 插件 IPC 加载/保存）
 */
async function showPluginConfigDialog(plugin: any): Promise<void> {
  if (!plugin.configSchema) return;

  // 移除已存在的弹窗
  hidePluginConfigDialog();

  await window.pluginConfigUI.showConfigDialog(
    plugin.name,
    `${plugin.name} - ${window.i18nManager.t('agent.agentPlugins.config')}`,
    plugin.configSchema,
    {
      // 自定义加载：直接使用 plugin 对象中已有的 config
      loadConfig: async () => {
        return plugin.config || {};
      },
      // 自定义保存：通过 Agent 插件 IPC 通道保存
      saveConfig: async (_pluginId: string, config: Record<string, unknown>) => {
        try {
          const result = await window.electronAPI.agentSavePluginConfig(plugin.name, config);
          return result.success;
        } catch (error) {
          window.logger.error('保存插件配置失败:', error);
          return false;
        }
      },
      // 保存成功后刷新插件列表
      onSaved: () => {
        refreshAgentPlugins();
        refreshToolList();
      }
    }
  );
}

/**
 * 隐藏插件配置弹窗
 */
function hidePluginConfigDialog(): void {
  const overlay = document.getElementById('agent-plugin-config-overlay');
  if (overlay) overlay.remove();
}

// ==================== 指令管理 ====================

/**
 * 初始化指令管理 UI
 */
function initAgentCommandsUI(): void {
  const btnRefresh = document.getElementById('btn-commands-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = () => refreshAgentCommands();
  }

  // 指令消息过滤开关
  const toggleFilter = document.getElementById('toggle-command-filter') as HTMLInputElement;
  if (toggleFilter) {
    // 加载初始状态
    window.electronAPI.agentGetCommandFilterEnabled().then(result => {
      toggleFilter.checked = result.enabled;
    }).catch(() => { /* 忽略 */ });

    toggleFilter.addEventListener('change', () => {
      window.electronAPI.agentSetCommandFilterEnabled(toggleFilter.checked).catch(err => {
        window.logger.error('设置指令过滤失败:', err);
      });
    });
  }
}

// ==================== 技能管理 ====================

/**
 * 初始化技能管理 UI
 */
function initAgentSkillsUI(): void {
  const btnRefresh = document.getElementById('btn-skills-refresh');
  if (btnRefresh) {
    btnRefresh.onclick = () => refreshAgentSkills();
  }
}

/**
 * 刷新指令列表
 */
async function refreshAgentCommands(): Promise<void> {
  try {
    const commands = await window.electronAPI.agentGetCommands();
    const container = document.getElementById('agent-command-list');
    const countEl = document.getElementById('agent-commands-count');
    if (!container) return;

    if (countEl) {
      countEl.textContent = `${commands.length} 个指令`;
    }

    if (!commands || commands.length === 0) {
      container.innerHTML = `<div class="agent-command-empty">${window.i18nManager?.t('agent.commands.empty') || '暂无已注册的指令'}</div>`;
      return;
    }

    container.innerHTML = '';
    commands.forEach((cmd) => {
      const item = document.createElement('div');
      item.className = 'agent-command-item';

      const paramsHtml = cmd.params?.map((p) =>
        `<span class="agent-command-param">${escapeHtml(p.name)}${p.required ? '' : '?'}</span>`
      ).join('') || '';

      item.innerHTML = `
        <div class="agent-command-info">
          <div class="agent-command-name">/${escapeHtml(cmd.name)}</div>
          <div class="agent-command-desc">${escapeHtml(cmd.description)}</div>
          <div class="agent-command-meta">
            ${cmd.source ? `<span class="agent-command-source">${escapeHtml(cmd.source)}</span>` : ''}
            ${paramsHtml ? `<div class="agent-command-params">${paramsHtml}</div>` : ''}
          </div>
        </div>
        <label class="toggle-switch-small">
          <input type="checkbox" ${cmd.enabled !== false ? 'checked' : ''} data-command="${escapeHtml(cmd.name)}">
          <span class="toggle-slider-small"></span>
        </label>
      `;

      // 绑定启用/禁用切换
      const toggle = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (toggle) {
        toggle.addEventListener('change', async () => {
          const cmdName = toggle.getAttribute('data-command');
          if (cmdName) {
            await window.electronAPI.agentSetCommandEnabled(cmdName, toggle.checked);
          }
        });
      }

      container.appendChild(item);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (error) {
    window.logger.error('加载指令列表失败:', error);
  }
}

/**
 * 刷新技能列表
 */
async function refreshAgentSkills(): Promise<void> {
  try {
    const skills = await window.electronAPI.agentGetSkills();
    const container = document.getElementById('agent-skill-list');
    const countEl = document.getElementById('agent-skills-count');
    if (!container) return;

    if (countEl) {
      const enabledCount = skills.filter(s => s.enabled).length;
      countEl.textContent = `${skills.length} 个技能 (${enabledCount} 已启用)`;
    }

    if (!skills || skills.length === 0) {
      container.innerHTML = `<div class="agent-skill-empty">${window.i18nManager?.t('agent.skills.empty') || '暂无已注册的技能'}</div>`;
      return;
    }

    container.innerHTML = '';

    // 按分类名映射
    const categoryLabels: Record<string, string> = {
      system: '系统',
      knowledge: '知识',
      creative: '创意',
      automation: '自动化',
      communication: '通信',
    };

    skills.forEach((skill) => {
      const item = document.createElement('div');
      item.className = 'agent-skill-item';

      const categoryLabel = categoryLabels[skill.category] || skill.category;
      const paramsHtml = skill.parameterNames.map((p: string) =>
        `<span class="agent-skill-param">${escapeHtml(p)}</span>`
      ).join('');

      item.innerHTML = `
        <div class="agent-skill-info">
          <div class="agent-skill-name">${escapeHtml(skill.name)}</div>
          <div class="agent-skill-desc">${escapeHtml(skill.description)}</div>
          <div class="agent-skill-meta">
            <span class="agent-skill-category">${escapeHtml(categoryLabel)}</span>
            <span class="agent-skill-source">${escapeHtml(skill.source)}</span>
            ${paramsHtml ? `<div class="agent-skill-params">${paramsHtml}</div>` : ''}
          </div>
        </div>
        <label class="toggle-switch-small">
          <input type="checkbox" ${skill.enabled ? 'checked' : ''} data-skill="${escapeHtml(skill.name)}">
          <span class="toggle-slider-small"></span>
        </label>
      `;

      const toggle = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (toggle) {
        toggle.addEventListener('change', async () => {
          const skillName = toggle.getAttribute('data-skill');
          if (skillName) {
            await window.electronAPI.agentSetSkillEnabled(skillName, toggle.checked);
          }
        });
      }

      container.appendChild(item);
    });
  } catch (error) {
    window.logger.error('加载技能列表失败:', error);
  }
}

/**
 * 隐藏 Agent 管理面板
 */
function hideAgentPanel(): void {
  const agentPanel = document.getElementById('agent-panel');
  if (agentPanel) {
    agentPanel.classList.remove('show');
  }
  if (agentStatusTimer) {
    clearInterval(agentStatusTimer);
    agentStatusTimer = null;
  }
}

/**
 * 刷新 Agent 状态显示
 */
async function refreshAgentStatus(): Promise<void> {
  try {
    const status = await window.electronAPI.agentGetStatus();
    updateAgentStatusUI(status);
  } catch (error) {
    window.logger.error('获取 Agent 状态失败:', error);
  }
}

/**
 * 更新 Agent 状态 UI
 */
function updateAgentStatusUI(status: any): void {
  const badge = document.getElementById('agent-status-badge');
  const statusText = document.getElementById('agent-status-text');
  const addressEl = document.getElementById('agent-address');
  const clientsEl = document.getElementById('agent-clients');
  const uptimeEl = document.getElementById('agent-uptime');
  const btnStart = document.getElementById('btn-agent-start') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-agent-stop') as HTMLButtonElement;

  if (status.running) {
    badge?.classList.remove('stopped');
    badge?.classList.add('running');
    if (statusText) statusText.textContent = window.i18nManager.t('agent.running');
    if (addressEl) addressEl.textContent = `ws://${status.host}:${status.port}`;
    if (clientsEl) clientsEl.textContent = String(status.connectedClients);
    if (uptimeEl && status.startTime) {
      const elapsed = Math.floor((Date.now() - status.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      uptimeEl.textContent = `${mins}m ${secs}s`;
    }
    if (btnStart) btnStart.setAttribute('disabled', 'true');
    if (btnStop) btnStop.removeAttribute('disabled');
  } else {
    badge?.classList.remove('running');
    badge?.classList.add('stopped');
    if (statusText) statusText.textContent = window.i18nManager.t('agent.stopped');
    // 停止时仍显示配置的端口，方便用户确认
    const configuredPort = window.settingsManager?.getSetting('agentPort') || 8765;
    if (addressEl) addressEl.textContent = `ws://127.0.0.1:${configuredPort}`;
    if (clientsEl) clientsEl.textContent = '0';
    if (uptimeEl) uptimeEl.textContent = '-';
    if (btnStart) btnStart.removeAttribute('disabled');
    if (btnStop) btnStop.setAttribute('disabled', 'true');
  }
}

/**
 * 更新顶栏 Agent 按钮可见性
 */
function updateAgentButtonVisibility(): void {
  const btnAgent = document.getElementById('btn-agent');
  if (!btnAgent) return;

  const settings = window.settingsManager.getSettings();
  if (settings.backendMode === 'builtin') {
    btnAgent.classList.remove('hidden');
  } else {
    btnAgent.classList.add('hidden');
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
    // 加载对话列表，并恢复当前对话的消息
    loadConversations().then(() => {
      if (currentConversationId) {
        loadConversationMessages(currentConversationId);
      }
    });
  }
}

/**
 * 隐藏对话窗口
 */
function hideChatWindow(): void {
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) {
    chatWindow.classList.add('hidden');
    // 收起对话列表下拉
    hideConversationDropdown();
    // 通知主进程对话窗口已关闭
    window.electronAPI.updateUIState({ chatOpen: false });
  }
}

/**
 * 添加用户指令输入消息到界面（专属样式）
 */
function addCommandInputMessage(text: string): void {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message user command-input';
  const cmdTag = document.createElement('span');
  cmdTag.className = 'command-input-tag';
  cmdTag.textContent = text;
  messageDiv.appendChild(cmdTag);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * 添加聊天消息到界面
 */
function addChatMessage(text: string, isUser: boolean, options?: { attachment?: { type: 'image' | 'file', url: string, name?: string }; reasoningContent?: string }): void {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;

  // 思维链（折叠展示）
  if (!isUser && options?.reasoningContent) {
    const details = document.createElement('details');
    details.className = 'reasoning-block';
    const summary = document.createElement('summary');
    summary.className = 'reasoning-summary';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'brain');
    icon.style.cssText = 'width: 13px; height: 13px;';
    summary.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = window.i18nManager.t('chatWindow.reasoning');
    summary.appendChild(label);
    details.appendChild(summary);
    const content = document.createElement('div');
    content.className = 'reasoning-content';
    content.textContent = options.reasoningContent;
    details.appendChild(content);
    messageDiv.appendChild(details);
  }

  if (text) {
    const textNode = document.createElement('div');
    textNode.textContent = text;
    messageDiv.appendChild(textNode);
  }

  const attachment = options?.attachment;

  if (attachment?.type) {
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
 * 支持指令系统：以 / 开头的消息会被解析为指令
 */
async function sendChatMessage(): Promise<void> {
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
  if (!chatInput) return;

  const text = chatInput.value.trim();
  if (!text) return;

  // 关闭指令建议面板
  hideCommandSuggestions();

  // 指令检测：以 / 开头
  if (text.startsWith('/')) {
    const parsed = parseCommandInput(text);
    if (parsed) {
      // 显示用户指令（使用指令专属样式）
      addCommandInputMessage(text);
      chatInput.value = '';
      chatInput.style.height = 'auto';

      // 发送指令执行请求
      try {
        await window.backendClient.executeCommand(parsed.command, parsed.args);
      } catch (error) {
        window.logger.error('指令执行失败:', error);
        addChatMessage('指令执行失败', false);
      }
      return;
    }
  }

  // 添加用户消息到界面
  addChatMessage(text, true);
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 发送到后端
  try {
    await sendUserMessage(text);
    // 延迟刷新对话列表（等待后端保存消息并更新标题）
    setTimeout(() => loadConversations(), CONVERSATION_REFRESH_DELAY_MS);
  } catch (error) {
    window.logger.error('发送消息失败:', error);
    addChatMessage(window.i18nManager.t('messages.sendFailed'), false);
  }
}

// ==================== 对话管理 ====================

/** 当前活跃对话 ID */
let currentConversationId: string | null = null;

/**
 * 加载对话列表
 */
async function loadConversations(): Promise<void> {
  try {
    const conversations = await window.electronAPI.agentGetConversations(50);
    const currentResult = await window.electronAPI.agentGetCurrentConversation();
    currentConversationId = currentResult.conversationId;

    // 更新顶部标题栏
    updateChatTitleBar(conversations);

    const container = document.getElementById('conversation-list');
    if (!container) return;

    if (!conversations || conversations.length === 0) {
      container.innerHTML = `<div class="conversation-empty">${window.i18nManager?.t('chatWindow.noConversations') || '暂无对话记录'}</div>`;
      return;
    }

    container.innerHTML = '';
    conversations.forEach((conv: any) => {
      const item = document.createElement('div');
      item.className = `conversation-item${conv.id === currentConversationId ? ' active' : ''}`;
      item.setAttribute('data-conversation-id', conv.id);

      const title = document.createElement('div');
      title.className = 'conversation-item-title';
      title.textContent = conv.title || window.i18nManager?.t('chatWindow.newChat') || '新对话';
      item.appendChild(title);

      const time = document.createElement('div');
      time.className = 'conversation-item-time';
      time.textContent = formatConversationTime(conv.updatedAt);
      item.appendChild(time);

      // 删除按钮
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'conversation-delete-btn';
      deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>';
      deleteBtn.title = window.i18nManager?.t('chatWindow.deleteConversation') || '删除对话';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(conv.id);
      });
      item.appendChild(deleteBtn);

      // 点击切换到该对话并收起下拉
      item.addEventListener('click', () => {
        switchConversation(conv.id);
        hideConversationDropdown();
      });

      container.appendChild(item);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  } catch (error) {
    window.logger.error('加载对话列表失败:', error);
  }
}

/**
 * 更新顶部标题栏显示当前对话标题
 */
function updateChatTitleBar(conversations?: any[]): void {
  const titleEl = document.getElementById('chat-current-title');
  if (!titleEl) return;

  if (currentConversationId && conversations) {
    const current = conversations.find((c: any) => c.id === currentConversationId);
    titleEl.textContent = current?.title || window.i18nManager?.t('chatWindow.newChat') || '新对话';
  } else {
    titleEl.textContent = window.i18nManager?.t('chatWindow.newChat') || '新对话';
  }
}

/**
 * 切换对话列表下拉面板的显示/隐藏
 */
function toggleConversationDropdown(): void {
  const dropdown = document.getElementById('conversation-dropdown');
  const titleBar = document.getElementById('chat-title-bar');
  if (!dropdown) return;

  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');
    titleBar?.classList.add('expanded');
  } else {
    hideConversationDropdown();
  }
}

/**
 * 隐藏对话列表下拉面板
 */
function hideConversationDropdown(): void {
  const dropdown = document.getElementById('conversation-dropdown');
  const titleBar = document.getElementById('chat-title-bar');
  dropdown?.classList.add('hidden');
  titleBar?.classList.remove('expanded');
}

/**
 * 创建新对话
 */
async function createNewConversation(): Promise<void> {
  try {
    const result = await window.electronAPI.agentNewConversation();
    if (result.success && result.conversationId) {
      currentConversationId = result.conversationId;
      // 清空当前消息区域
      const messagesContainer = document.getElementById('chat-messages');
      if (messagesContainer) {
        messagesContainer.innerHTML = '';
      }
      // 收起下拉面板并刷新
      hideConversationDropdown();
      await loadConversations();
    }
  } catch (error) {
    window.logger.error('创建新对话失败:', error);
  }
}

/**
 * 切换到指定对话
 */
async function switchConversation(conversationId: string): Promise<void> {
  // 如果已是当前对话且消息区有内容，无需重新加载
  const messagesContainer = document.getElementById('chat-messages');
  if (conversationId === currentConversationId && messagesContainer && messagesContainer.children.length > 0) return;

  try {
    const result = await window.electronAPI.agentSwitchConversation(conversationId);
    if (result.success) {
      currentConversationId = conversationId;
      // 加载该对话的消息
      await loadConversationMessages(conversationId);
      // 刷新列表高亮
      await loadConversations();
    }
  } catch (error) {
    window.logger.error('切换对话失败:', error);
  }
}

/**
 * 删除对话
 */
async function deleteConversation(conversationId: string): Promise<void> {
  try {
    const result = await window.electronAPI.agentDeleteConversation(conversationId);
    if (result.success) {
      // 如果删除的是当前对话，清空消息区
      if (conversationId === currentConversationId) {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
          messagesContainer.innerHTML = '';
        }
        currentConversationId = null;
      }
      // 刷新对话列表
      await loadConversations();
    }
  } catch (error) {
    window.logger.error('删除对话失败:', error);
  }
}

/**
 * 从历史消息中提取指令名（查找当前 assistant command 消息之前最近的 user command 消息）
 */
function extractCommandNameFromHistory(messages: any[], currentMsg: any): string {
  const idx = messages.indexOf(currentMsg);
  // 向前查找最近的 user command 消息
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].type === 'command' && messages[i].role === 'user') {
      const match = messages[i].content.match(/^\/(\S+)/);
      return match ? match[1] : '';
    }
    // 如果遇到非 command 消息则停止查找
    if (messages[i].type !== 'command') break;
  }
  return '';
}

/**
 * 加载对话的消息记录
 */
async function loadConversationMessages(conversationId: string): Promise<void> {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  messagesContainer.innerHTML = '';

  try {
    const messages = await window.electronAPI.agentGetMessages(conversationId);
    if (!messages || messages.length === 0) return;

    messages.forEach((msg: any) => {
      // 跳过 system 和 tool 消息
      if (msg.role === 'system' || msg.role === 'tool') return;

      // 跳过 tool_call 类型（助手发起的工具调用请求）
      if (msg.type === 'tool_call' || msg.type === 'tool_result') return;

      // 指令消息：用户输入使用指令样式，助手结果使用指令结果样式
      if (msg.type === 'command') {
        if (msg.role === 'user') {
          // 用户的指令输入（如 /info）：保持用户底色，内部使用指令标记样式
          const messageDiv = document.createElement('div');
          messageDiv.className = 'chat-message user command-input';
          const cmdTag = document.createElement('span');
          cmdTag.className = 'command-input-tag';
          cmdTag.textContent = msg.content;
          messageDiv.appendChild(cmdTag);
          messagesContainer.appendChild(messageDiv);
          return;
        }
        // 助手的指令结果
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message assistant command-result';

        // 从上一条用户指令消息提取指令名
        const commandName = extractCommandNameFromHistory(messages, msg);
        if (commandName) {
          const header = document.createElement('div');
          header.className = 'command-result-header';
          header.innerHTML = `<span class="command-result-prefix">/${commandName}</span>`;
          messageDiv.appendChild(header);
        }

        if (msg.content) {
          const content = document.createElement('div');
          content.className = 'command-result-content';
          content.innerHTML = msg.content.replace(/\n/g, '<br>');
          messageDiv.appendChild(content);
        }

        messagesContainer.appendChild(messageDiv);
        return;
      }

      const isUser = msg.role === 'user';
      const messageDiv = document.createElement('div');
      messageDiv.className = `chat-message ${isUser ? 'user' : 'assistant'}`;

      // 解析 extra 数据
      let extra: Record<string, any> = {};
      try {
        extra = JSON.parse(msg.extra || '{}');
      } catch {
        // 忽略
      }

      // 附件
      if (extra.attachment && extra.attachment.type === 'image') {
        const img = document.createElement('img');
        img.src = extra.attachment.data || extra.attachment.url || '';
        img.className = 'message-image';
        if (img.src) {
          messageDiv.appendChild(img);
        }
      }

      if (msg.content) {
        const textNode = document.createElement('div');
        // 保留换行符：将 \n 渲染为 <br>，其他内容转义
        textNode.innerHTML = escapeHtml(msg.content).replace(/\n/g, '<br>');
        messageDiv.appendChild(textNode);
      }

      messagesContainer.appendChild(messageDiv);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (error) {
    window.logger.error('加载对话消息失败:', error);
  }
}

/**
 * 格式化对话时间
 */
function formatConversationTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ==================== 指令系统 ====================

/** 当前选中的指令建议索引 */
let commandSelectedIndex = -1;

/**
 * 解析指令输入
 * 支持格式：/command arg1 arg2 或 /command key:value
 */
function parseCommandInput(text: string): { command: string; args: Record<string, unknown> } | null {
  const match = text.match(/^\/(\S+)\s*(.*)?$/);
  if (!match) return null;

  const commandName = match[1].toLowerCase();
  const argString = (match[2] || '').trim();

  // 检查指令是否已注册
  const commands = window.backendClient.getRegisteredCommands();
  const cmdDef = commands.find(c => c.name === commandName);
  if (!cmdDef) return null;

  const args: Record<string, unknown> = {};

  if (argString && cmdDef.params && cmdDef.params.length > 0) {
    // 尝试按位置参数解析
    const parts = argString.split(/\s+/);
    cmdDef.params.forEach((param, i) => {
      if (i < parts.length) {
        if (param.type === 'number') {
          args[param.name] = Number(parts[i]);
        } else if (param.type === 'boolean') {
          args[param.name] = parts[i] === 'true';
        } else {
          // 最后一个字符串参数吃掉剩余所有文本
          if (i === cmdDef.params!.length - 1) {
            args[param.name] = parts.slice(i).join(' ');
          } else {
            args[param.name] = parts[i];
          }
        }
      }
    });
  } else if (argString && (!cmdDef.params || cmdDef.params.length === 0)) {
    // 无参指令但有多余文本 — 忽略
  }

  return { command: commandName, args };
}

/**
 * 显示指令建议面板
 */
function showCommandSuggestions(filter: string): void {
  const commands = window.backendClient.getRegisteredCommands();
  if (!commands || commands.length === 0) return;

  const query = filter.toLowerCase().replace(/^\//, '');
  const filtered = commands.filter(c =>
    c.name.toLowerCase().includes(query) ||
    c.description.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    hideCommandSuggestions();
    return;
  }

  let popup = document.getElementById('command-suggestions');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'command-suggestions';
    popup.className = 'command-suggestions';

    const inputWrapper = document.querySelector('.input-wrapper') as HTMLElement | null;
    if (inputWrapper) {
      inputWrapper.style.position = 'relative';
      inputWrapper.appendChild(popup);
    }
  }

  commandSelectedIndex = 0;

  popup.innerHTML = filtered.map((cmd, i) => {
    const paramHints = cmd.params?.map(p =>
      `<span class="cmd-param ${p.required ? 'required' : 'optional'}">${p.name}${p.required ? '' : '?'}</span>`
    ).join(' ') || '';

    return `<div class="command-suggestion-item ${i === 0 ? 'selected' : ''}" data-command="${cmd.name}">
      <div class="cmd-name-row">
        <span class="cmd-name">/${cmd.name}</span>
        ${paramHints}
      </div>
      <div class="cmd-desc">${cmd.description}</div>
      ${cmd.source ? `<span class="cmd-source">${cmd.source}</span>` : ''}
    </div>`;
  }).join('');

  popup.classList.remove('hidden');

  // 点击选中指令
  popup.querySelectorAll('.command-suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const cmdName = item.getAttribute('data-command');
      if (cmdName) {
        selectCommandSuggestion(cmdName);
      }
    });
  });
}

/**
 * 隐藏指令建议面板
 */
function hideCommandSuggestions(): void {
  const popup = document.getElementById('command-suggestions');
  if (popup) {
    popup.classList.add('hidden');
  }
  commandSelectedIndex = -1;
}

/**
 * 选中指令建议（填入输入框）
 */
function selectCommandSuggestion(commandName: string): void {
  const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
  if (!chatInput) return;

  const commands = window.backendClient.getRegisteredCommands();
  const cmd = commands.find(c => c.name === commandName);
  if (!cmd) return;

  // 如果指令有参数，填入指令名 + 空格，等待用户输入参数
  if (cmd.params && cmd.params.length > 0) {
    chatInput.value = `/${commandName} `;
  } else {
    chatInput.value = `/${commandName}`;
  }
  chatInput.focus();
  hideCommandSuggestions();
}

/**
 * 处理指令建议的键盘导航
 */
function handleCommandKeyNav(e: KeyboardEvent): boolean {
  const popup = document.getElementById('command-suggestions');
  if (!popup || popup.classList.contains('hidden')) return false;

  const items = popup.querySelectorAll('.command-suggestion-item');
  if (items.length === 0) return false;

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    commandSelectedIndex = Math.max(0, commandSelectedIndex - 1);
    items.forEach((item, i) => item.classList.toggle('selected', i === commandSelectedIndex));
    items[commandSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    commandSelectedIndex = Math.min(items.length - 1, commandSelectedIndex + 1);
    items.forEach((item, i) => item.classList.toggle('selected', i === commandSelectedIndex));
    items[commandSelectedIndex]?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  if (e.key === 'Tab' || (e.key === 'Enter' && commandSelectedIndex >= 0)) {
    e.preventDefault();
    const selected = items[commandSelectedIndex];
    if (selected) {
      const cmdName = selected.getAttribute('data-command');
      if (cmdName) {
        selectCommandSuggestion(cmdName);
        return true;
      }
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    hideCommandSuggestions();
    return true;
  }

  return false;
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

  // 标题栏点击展开/收起对话列表
  const chatTitleBar = document.getElementById('chat-title-bar');
  if (chatTitleBar) {
    chatTitleBar.addEventListener('click', toggleConversationDropdown);
  }

  // 新建对话按钮
  const btnNewChat = document.getElementById('btn-new-chat');
  if (btnNewChat) {
    btnNewChat.addEventListener('click', createNewConversation);
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
      // 先检查指令建议导航
      if (handleCommandKeyNav(e)) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    // 输入监听：指令自动补全 + 高度调整
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = chatInput.scrollHeight + 'px';

      // 指令建议
      const text = chatInput.value;
      if (text.startsWith('/') && !text.includes('\n')) {
        showCommandSuggestions(text);
      } else {
        hideCommandSuggestions();
      }
    });

    // 失焦时延迟隐藏（让 click 事件有机会触发）
    chatInput.addEventListener('blur', () => {
      setTimeout(() => hideCommandSuggestions(), COMMAND_SUGGESTION_HIDE_DELAY_MS);
    });
  }

  // 语音输入按钮
  const btnVoice = document.getElementById('btn-voice');
  if (btnVoice) {
    btnVoice.addEventListener('click', async () => {
      // ASR 不可用时拒绝操作并提示
      if (!appState.asrReady) {
        const status = await window.electronAPI.asrGetStatus();
        const errorMsg = status.error || window.i18nManager?.t('chatWindow.asrUnavailable') || '语音识别不可用，请在设置中检查 ASR 模型';
        window.dialogueManager?.showQuick(errorMsg, 3000);
        return;
      }

      try {
        const isActive = window.microphoneManager.isActive();
        if (isActive) {
          // 停止监听
          window.microphoneManager.stopListening();
          btnVoice.classList.remove('active');
          // 将焦点还给输入框
          const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
          chatInput?.focus();
          window.logger.info('麦克风已停止');
        } else {
          // 启动监听
          await window.microphoneManager.startListening();
          btnVoice.classList.add('active');
          window.logger.info('麦克风已启动');
        }
      } catch (error) {
        window.logger.error('麦克风操作失败:', error);
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
          window.logger.info('摄像头已停止');
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
          
          window.logger.info('摄像头已启动');
        }
      } catch (error) {
        window.logger.error('摄像头操作失败:', error);
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
        const fileSizeMB = file.size / (1024 * 1024);
        const maxSizeMB = MAX_FILE_SIZE_MB;
        
        // 检查文件大小
        if (fileSizeMB > maxSizeMB) {
          window.dialogueManager?.showQuick(
            `文件 ${file.name} 过大（${fileSizeMB.toFixed(1)}MB），最大支持${maxSizeMB}MB`,
            3000
          );
          window.logger?.warn('文件超过大小限制', { 
            fileName: file.name, 
            size: fileSizeMB.toFixed(2) + 'MB',
            limit: maxSizeMB + 'MB'
          });
          continue;
        }
        
        const reader = new FileReader();
        
        reader.onload = (e) => {
          const url = e.target?.result as string;
          const isImage = file.type.startsWith('image/');
          
          addChatMessage('', true, {
            attachment: {
              type: isImage ? 'image' : 'file',
              url: url,
              name: file.name
            }
          });
          
          // 发送文件数据到后端
          sendFileToBackend(file, url);
        };
        
        reader.onerror = () => {
          window.logger?.error('文件读取失败', { fileName: file.name });
          window.dialogueManager?.showQuick(`文件 ${file.name} 读取失败`, 3000);
        };
        
        // 对于大文件显示加载提示
        if (fileSizeMB > LARGE_FILE_WARN_MB) {
          window.dialogueManager?.showQuick(
            `正在加载文件 ${file.name} (${fileSizeMB.toFixed(1)}MB)，请稍候...`,
            2000
          );
        }

        reader.readAsDataURL(file);
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
 * 更新自定义后端链接字段的显示状态
 */
function updateCustomBackendFieldsVisibility(mode: 'builtin' | 'custom'): void {
  const builtinFields = document.getElementById('builtin-backend-fields');
  const customFields = document.getElementById('custom-backend-fields');
  if (builtinFields) {
    builtinFields.style.display = mode === 'builtin' ? 'block' : 'none';
  }
  if (customFields) {
    customFields.style.display = mode === 'custom' ? 'block' : 'none';
  }
}

/**
 * 设置面板中人格编辑器的 Monaco 实例 ID
 */
let personalityEditorId: string | null = null;

/**
 * 显示设置面板
 */
async function showSettingsPanel(): Promise<void> {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  // 加载当前设置
  const settings = window.settingsManager.getSettings();
  
  (document.getElementById('setting-model-path') as HTMLInputElement).value = settings.modelPath;
  (document.getElementById('setting-backend-mode') as HTMLSelectElement).value = settings.backendMode || 'builtin';
  (document.getElementById('setting-agent-port') as HTMLInputElement).value = String(settings.agentPort || 8765);
  (document.getElementById('setting-backend-url') as HTMLInputElement).value = settings.backendUrl;
  (document.getElementById('setting-websocket-url') as HTMLInputElement).value = settings.wsUrl;
  (document.getElementById('setting-auto-connect') as HTMLInputElement).checked = settings.autoConnect;

  // 根据后端模式显示/隐藏自定义链接字段
  updateCustomBackendFieldsVisibility(settings.backendMode || 'builtin');
  (document.getElementById('setting-volume') as HTMLInputElement).value = String(settings.volume);
  (document.getElementById('volume-value') as HTMLSpanElement).textContent = Math.round(settings.volume * 100) + '%';
  (document.getElementById('setting-update-source') as HTMLInputElement).value = settings.updateSource;
  (document.getElementById('setting-language') as HTMLSelectElement).value = settings.locale;
  (document.getElementById('setting-theme') as HTMLSelectElement).value = settings.theme;
  (document.getElementById('setting-show-subtitle') as HTMLInputElement).checked = settings.showSubtitle;
  (document.getElementById('setting-enable-eye-tracking') as HTMLInputElement).checked = settings.enableEyeTracking;
  (document.getElementById('setting-use-custom-character') as HTMLInputElement).checked = settings.useCustomCharacter;
  (document.getElementById('setting-custom-name') as HTMLInputElement).value = settings.customName;

  (document.getElementById('setting-mic-background-mode') as HTMLInputElement).checked = settings.micBackgroundMode || false;
  (document.getElementById('setting-mic-threshold') as HTMLInputElement).value = String(settings.micVolumeThreshold || 30);
  (document.getElementById('mic-threshold-value') as HTMLSpanElement).textContent = String(settings.micVolumeThreshold || 30);
  (document.getElementById('setting-mic-auto-send') as HTMLInputElement).checked = settings.micAutoSend !== false;

  // 加载 ASR 模型列表
  loadASRModelList(settings.asrModel || 'sense-voice-small');

  // 加载开机自启动状态（从主进程获取）
  window.electronAPI.getAutoLaunch().then(result => {
    (document.getElementById('setting-auto-launch') as HTMLInputElement).checked = result.enabled;
  }).catch(error => {
    window.logger.error('获取开机自启动状态失败', { error });
  });

  // 加载日志配置
  (document.getElementById('setting-log-enabled') as HTMLInputElement).checked = settings.logEnabled || false;
  (document.getElementById('setting-log-retention-days') as HTMLInputElement).value = String(settings.logRetentionDays || 7);
  
  // 加载日志级别
  const logLevels = settings.logLevels || ['warn', 'error', 'critical'];
  (document.getElementById('log-level-debug') as HTMLInputElement).checked = logLevels.includes('debug');
  (document.getElementById('log-level-info') as HTMLInputElement).checked = logLevels.includes('info');
  (document.getElementById('log-level-warn') as HTMLInputElement).checked = logLevels.includes('warn');
  (document.getElementById('log-level-error') as HTMLInputElement).checked = logLevels.includes('error');
  (document.getElementById('log-level-critical') as HTMLInputElement).checked = logLevels.includes('critical');

  // 加载触碰配置
  loadTapConfigUI();

  // 先显示面板，确保容器有实际尺寸
  panel.classList.add('show');

  // 等待一帧，确保布局完成后再初始化 Monaco Editor
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  // 初始化人格编辑器 Monaco Editor（必须在面板可见后创建，否则容器尺寸为 0）
  const personalityContainer = document.getElementById('setting-custom-personality') as HTMLElement;
  if (personalityContainer) {
    // 销毁旧的编辑器实例
    if (personalityEditorId) {
      window.monacoManager.destroyEditor(personalityEditorId);
      personalityEditorId = null;
    }
    try {
      await window.monacoManager.load();
      personalityEditorId = await window.monacoManager.createEditor({
        container: personalityContainer,
        value: settings.customPersonality || '',
        language: 'markdown',
        minHeight: 180,
        maxHeight: 400,
      });
    } catch (err) {
      window.logger.error('Monaco Editor 加载失败，回退到 textarea:', err);
      // 回退：将容器替换为 textarea
      const textarea = document.createElement('textarea');
      textarea.id = 'setting-custom-personality-fallback';
      textarea.rows = 8;
      textarea.value = settings.customPersonality || '';
      textarea.className = 'plugin-config-textarea';
      personalityContainer.parentElement?.replaceChild(textarea, personalityContainer);
    }
  }
}

/**
 * 隐藏设置面板
 */
function hideSettingsPanel(): void {
  const panel = document.getElementById('settings-panel');
  if (panel) {
    panel.classList.remove('show');
  }
  // 销毁人格编辑器 Monaco 实例
  if (personalityEditorId) {
    window.monacoManager.destroyEditor(personalityEditorId);
    personalityEditorId = null;
  }
}

/**
 * 保存设置
 */
async function saveSettings(): Promise<void> {
  const modelPath = (document.getElementById('setting-model-path') as HTMLInputElement).value;
  const backendMode = (document.getElementById('setting-backend-mode') as HTMLSelectElement).value as 'builtin' | 'custom';
  const agentPort = parseInt((document.getElementById('setting-agent-port') as HTMLInputElement).value) || 8765;
  const backendUrl = (document.getElementById('setting-backend-url') as HTMLInputElement).value;
  const wsUrl = (document.getElementById('setting-websocket-url') as HTMLInputElement).value;
  const autoConnect = (document.getElementById('setting-auto-connect') as HTMLInputElement).checked;
  const volume = parseFloat((document.getElementById('setting-volume') as HTMLInputElement).value);
  const updateSource = (document.getElementById('setting-update-source') as HTMLInputElement).value;
  const locale = (document.getElementById('setting-language') as HTMLSelectElement).value;
  const theme = (document.getElementById('setting-theme') as HTMLSelectElement).value as ThemeMode;
  const showSubtitle = (document.getElementById('setting-show-subtitle') as HTMLInputElement).checked;
  const enableEyeTracking = (document.getElementById('setting-enable-eye-tracking') as HTMLInputElement).checked;
  const useCustomCharacter = (document.getElementById('setting-use-custom-character') as HTMLInputElement).checked;
  const customName = (document.getElementById('setting-custom-name') as HTMLInputElement).value;
  // 从 Monaco Editor 或回退 textarea 读取人格描述
  let customPersonality = '';
  if (personalityEditorId) {
    customPersonality = window.monacoManager.getValue(personalityEditorId);
  } else {
    const fallback = document.getElementById('setting-custom-personality-fallback') as HTMLTextAreaElement | null;
    customPersonality = fallback?.value || '';
  }
  const micBackgroundMode = (document.getElementById('setting-mic-background-mode') as HTMLInputElement).checked;
  const micVolumeThreshold = parseFloat((document.getElementById('setting-mic-threshold') as HTMLInputElement).value);
  const micAutoSend = (document.getElementById('setting-mic-auto-send') as HTMLInputElement).checked;
  const asrModel = (document.getElementById('setting-asr-model') as HTMLSelectElement).value;
  const autoLaunch = (document.getElementById('setting-auto-launch') as HTMLInputElement).checked;

  // 获取日志配置
  const logEnabled = (document.getElementById('setting-log-enabled') as HTMLInputElement).checked;
  const logRetentionDays = parseInt((document.getElementById('setting-log-retention-days') as HTMLInputElement).value);
  const logLevels: string[] = [];
  if ((document.getElementById('log-level-debug') as HTMLInputElement).checked) logLevels.push('debug');
  if ((document.getElementById('log-level-info') as HTMLInputElement).checked) logLevels.push('info');
  if ((document.getElementById('log-level-warn') as HTMLInputElement).checked) logLevels.push('warn');
  if ((document.getElementById('log-level-error') as HTMLInputElement).checked) logLevels.push('error');
  if ((document.getElementById('log-level-critical') as HTMLInputElement).checked) logLevels.push('critical');

  // 保存触碰配置
  saveTapConfigFromUI();

  // 更新设置
  window.settingsManager.updateSettings({
    modelPath,
    backendMode,
    agentPort,
    backendUrl,
    wsUrl,
    autoConnect,
    volume,
    updateSource,
    logEnabled,
    logLevels,
    logRetentionDays,
    locale,
    theme,
    showSubtitle,
    enableEyeTracking,
    useCustomCharacter,
    customName,
    customPersonality,
    micBackgroundMode,
    micVolumeThreshold,
    micAutoSend,
    asrModel,
    autoLaunch
  });

  // 同步开机自启动到主进程
  window.electronAPI.setAutoLaunch(autoLaunch).then(result => {
    if (!result.success) {
      window.logger.error('设置开机自启动失败');
    }
  });

  // 验证设置
  const validation = window.settingsManager.validateSettings();
  if (!validation.valid) {
    window.logger.warn('设置验证失败', { errors: validation.errors });
    alert(window.i18nManager.t('messages.settingsValidationFailed') + ':\n' + validation.errors.join('\n'));
    return;
  }

  window.logger.info('用户设置已保存', {
    modelPath,
    backendMode,
    backendUrl,
    wsUrl,
    autoConnect,
    locale,
    theme,
    logEnabled,
    logLevels
  });

  // 应用设置
  window.audioPlayer.setVolume(volume);
  window.microphoneManager.setVolumeThreshold(micVolumeThreshold);
  window.microphoneManager.setBackgroundMode(micBackgroundMode);
  window.live2dManager.enableEyeTracking(enableEyeTracking);
  window.themeManager.setTheme(theme);
  
  // 更新日志配置
  await window.logger.updateConfig({
    enabled: logEnabled,
    levels: logLevels,
    retentionDays: logRetentionDays
  });
  
  // 更新 Agent 按钮可见性并通知主进程
  updateAgentButtonVisibility();
  window.electronAPI.notifyBackendModeChanged(backendMode);
  
  // 同步 Agent 端口到主进程
  if (backendMode === 'builtin') {
    window.electronAPI.agentSetPort(agentPort).catch(err => {
      window.logger.error('同步 Agent 端口失败:', err);
    });
  }
  
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

      // 如果是插件标签，渲染插件列表
      if (tabName === 'plugins' && window.pluginUI) {
        window.pluginUI.renderPlugins();
      }
      
      // 如果是日志标签，加载日志文件列表
      if (tabName === 'logs') {
        loadLogFiles();
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
        window.logger.error('选择文件失败:', error);
      }
    });
  }

  // 检查更新按钮
  const btnCheckUpdate = document.getElementById('btn-check-update');
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', checkForUpdates);
  }

  // 关于页面外部链接
  const linkGithub = document.getElementById('link-github');
  if (linkGithub) {
    linkGithub.addEventListener('click', (e: Event) => {
      e.preventDefault();
      window.electronAPI.openExternal('https://github.com/gameswu/NyaDeskPet');
    });
  }
  const linkDonate = document.getElementById('link-donate');
  if (linkDonate) {
    linkDonate.addEventListener('click', (e: Event) => {
      e.preventDefault();
      window.electronAPI.openExternal('https://afdian.com/a/gameswu');
    });
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

  // 后端模式切换 - 实时显示/隐藏自定义链接字段
  const backendModeSelect = document.getElementById('setting-backend-mode') as HTMLSelectElement;
  if (backendModeSelect) {
    backendModeSelect.addEventListener('change', (e: Event) => {
      const mode = (e.target as HTMLSelectElement).value as 'builtin' | 'custom';
      updateCustomBackendFieldsVisibility(mode);
    });
  }

  // 主题切换 - 选择时即时预览
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

  // 日志管理事件监听
  const btnRefreshLogs = document.getElementById('btn-refresh-logs');
  if (btnRefreshLogs) {
    btnRefreshLogs.addEventListener('click', loadLogFiles);
  }

  const btnOpenLogDirectory = document.getElementById('btn-open-log-directory');
  if (btnOpenLogDirectory) {
    btnOpenLogDirectory.addEventListener('click', openLogDirectory);
  }

  const btnDeleteAllLogs = document.getElementById('btn-delete-all-logs');
  if (btnDeleteAllLogs) {
    btnDeleteAllLogs.addEventListener('click', deleteAllLogs);
  }
}

/**
 * 加载日志文件列表
 */
async function loadLogFiles(): Promise<void> {
  const logFilesList = document.getElementById('log-files-list');
  if (!logFilesList) return;

  try {
    const files = await window.electronAPI.loggerGetFiles();
    
    if (files.length === 0) {
      logFilesList.innerHTML = `
        <div class="log-files-empty">
          <p data-i18n="settings.logs.noLogFiles">暂无日志文件</p>
        </div>
      `;
      return;
    }

    logFilesList.innerHTML = files.map(file => {
      const size = formatFileSize(file.size);
      const date = new Date(file.mtime).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      const currentBadge = file.isCurrent 
        ? '<span class="badge" data-i18n="settings.logs.currentSession">当前会话</span>' 
        : '';
      
      return `
        <div class="log-file-item ${file.isCurrent ? 'current-session' : ''}">
          <div class="log-file-info">
            <div class="log-file-name">${file.name} ${currentBadge}</div>
            <div class="log-file-meta">${size} • ${date}</div>
          </div>
          <button class="btn-delete-log" data-filename="${file.name}" ${file.isCurrent ? 'disabled' : ''}>
            <span data-i18n="settings.logs.delete">删除</span>
          </button>
        </div>
      `;
    }).join('');

    // 应用国际化翻译
    window.i18nManager.applyTranslations();

    // 绑定删除按钮事件
    const deleteButtons = logFilesList.querySelectorAll('.btn-delete-log');
    deleteButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLElement;
        const filename = target.dataset.filename;
        if (filename) {
          await deleteLogFile(filename);
        }
      });
    });
  } catch (error) {
    window.logger.error('加载日志文件列表失败:', error);
  }
}

/**
 * 删除单个日志文件
 */
async function deleteLogFile(fileName: string): Promise<void> {
  if (!confirm(window.i18nManager.t('settings.logs.deleteConfirm'))) {
    return;
  }

  try {
    window.logger.info(`尝试删除日志文件: ${fileName}`);
    const result = await window.electronAPI.loggerDeleteFile(fileName);
    if (result.success) {
      window.logger.info(`日志文件已删除: ${fileName}`);
      window.dialogueManager.showDialogue(window.i18nManager.t('settings.logs.deleteSuccess'), 2000);
      loadLogFiles(); // 刷新列表
    } else {
      window.logger.warn(`日志文件删除失败: ${fileName}`);
      window.dialogueManager.showDialogue(window.i18nManager.t('settings.logs.deleteFailed'), 2000);
    }
  } catch (error) {
    window.logger.error('删除日志文件失败:', error);
    window.logger.error(`删除日志文件失败: ${fileName}`, { error });
    window.dialogueManager.showDialogue(window.i18nManager.t('settings.logs.deleteFailed'), 2000);
  }
}

/**
 * 删除所有日志文件
 */
async function deleteAllLogs(): Promise<void> {
  if (!confirm(window.i18nManager.t('settings.logs.deleteAllConfirm'))) {
    return;
  }

  try {
    const result = await window.electronAPI.loggerDeleteAll();
    window.dialogueManager.showDialogue(`${window.i18nManager.t('settings.logs.deleteSuccess')} (${result.count})`, 2000);
    loadLogFiles(); // 刷新列表
  } catch (error) {
    window.logger.error('删除所有日志失败:', error);
    window.dialogueManager.showDialogue(window.i18nManager.t('settings.logs.deleteFailed'), 2000);
  }
}

/**
 * 打开日志目录
 */
async function openLogDirectory(): Promise<void> {
  try {
    await window.electronAPI.loggerOpenDirectory();
  } catch (error) {
    window.logger.error('打开日志目录失败:', error);
  }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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

  const label = document.createElement('label');
  label.className = 'tap-area-toggle';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = enabled;
  checkbox.dataset.areaName = areaName;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tap-area-name';
  nameSpan.textContent = areaName;

  label.appendChild(checkbox);
  label.appendChild(nameSpan);

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'tap-area-description';
  descInput.value = description;
  descInput.placeholder = window.i18nManager.t('settings.tap.areaDescription');

  item.appendChild(label);
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

  const tapConfig: TapConfig = {
    // 始终保留 default 配置
    'default': { enabled: true, description: '默认触摸' }
  };
  const items = container.querySelectorAll('.tap-config-item');

  items.forEach((item: Element) => {
    const areaName = (item as HTMLElement).dataset.areaName;
    if (!areaName) return;

    // 只保存模型中存在的区域
    if (!modelHitAreas.includes(areaName)) {
      window.logger.warn(`跳过不存在于模型中的区域: ${areaName}`);
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
    window.logger.error('获取版本失败:', error);
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
  statusEl.innerHTML = `<i data-lucide="loader" style="width: 14px; height: 14px; animation: spin 1s linear infinite;"></i> ${window.i18nManager.t('update.checking')}`;
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
      statusEl.textContent = window.i18nManager.t('update.error').replace('{error}', result.error);
    } else if (result.hasUpdate) {
      statusEl.className = 'update-status has-update';
      const updateMessage = window.i18nManager.t('update.hasUpdate')
        .replace('{version}', result.latestVersion || 'unknown');
      statusEl.innerHTML = updateMessage;
      
      // 绑定链接点击事件
      const linkRelease = statusEl.querySelector('a');
      if (linkRelease && result.releaseUrl) {
        linkRelease.addEventListener('click', (e) => {
          e.preventDefault();
          window.electronAPI.openExternal(result.releaseUrl!);
        });
      }

      // 更新日志预览
      if (result.releaseNotes) {
        const changelogContainer = document.createElement('details');
        changelogContainer.className = 'update-changelog';
        const summary = document.createElement('summary');
        summary.className = 'update-changelog-summary';
        const summaryIcon = document.createElement('i');
        summaryIcon.setAttribute('data-lucide', 'file-text');
        summaryIcon.style.cssText = 'width: 13px; height: 13px;';
        summary.appendChild(summaryIcon);
        const summaryLabel = document.createElement('span');
        summaryLabel.textContent = window.i18nManager.t('update.viewChangelog');
        summary.appendChild(summaryLabel);
        changelogContainer.appendChild(summary);

        const changelogContent = document.createElement('div');
        changelogContent.className = 'update-changelog-content';
        // 简单渲染 Markdown：标题、列表、加粗
        changelogContent.innerHTML = renderSimpleMarkdown(result.releaseNotes);
        changelogContainer.appendChild(changelogContent);

        statusEl.appendChild(changelogContainer);

        if (window.lucide) {
          window.lucide.createIcons();
        }
      }
    } else {
      statusEl.className = 'update-status no-update';
      statusEl.textContent = window.i18nManager.t('update.noUpdate');
    }
  } catch (error) {
    statusEl.className = 'update-status error';
    statusEl.textContent = window.i18nManager.t('update.error').replace('{error}', '未知错误');
  } finally {
    if (btnCheckUpdate) btnCheckUpdate.disabled = false;
  }
}

/**
 * 简单 Markdown 渲染（用于更新日志预览）
 * 支持标题、无序列表、加粗、行内代码
 */
function renderSimpleMarkdown(md: string): string {
  return md
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      // 标题
      if (trimmed.startsWith('### ')) return `<h4>${escapeHtml(trimmed.slice(4))}</h4>`;
      if (trimmed.startsWith('## ')) return `<h3>${escapeHtml(trimmed.slice(3))}</h3>`;
      if (trimmed.startsWith('# ')) return `<h2>${escapeHtml(trimmed.slice(2))}</h2>`;
      // 列表项
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const content = trimmed.slice(2);
        return `<div class="changelog-list-item">• ${formatInlineMarkdown(content)}</div>`;
      }
      // 普通段落
      return `<p>${formatInlineMarkdown(trimmed)}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

/** 处理行内 Markdown 格式（加粗、行内代码） */
function formatInlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  // 加粗 **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 行内代码 `code`
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  return html;
}

/**
 * 发送用户消息
 * @param text - 用户输入的文本
 */
async function sendUserMessage(text: string): Promise<void> {
  if (!text || text.trim().length === 0) {
    return;
  }

  // 防止连续发送：上一条消息还在处理时跳过
  if (isSendingMessage) {
    window.logger.warn('上一条消息仍在处理中，请稍候');
    return;
  }

  isSendingMessage = true;
  try {
    const message: BackendMessage = {
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
        window.logger.info('已附加摄像头截图');
      }
    }
    
    const result = await window.backendClient.sendMessage(message);

    window.logger.info('消息发送结果:', result);
  } catch (error) {
    window.logger.error('发送消息失败:', error);
    window.dialogueManager.showDialogue('发送消息失败，请检查网络连接', 3000);
  } finally {
    isSendingMessage = false;
  }
}

/**
 * 发送文件到后端
 */
async function sendFileToBackend(file: File, base64Data: string): Promise<void> {
  try {
    const fileSizeMB = file.size / (1024 * 1024);
    
    window.logger?.info('发送文件到后端', { 
      fileName: file.name, 
      fileType: file.type, 
      fileSize: fileSizeMB.toFixed(2) + 'MB'
    });
    
    // 对于大文件显示发送提示
    if (fileSizeMB > LARGE_FILE_WARN_MB) {
      window.dialogueManager?.showQuick(
        `正在发送文件 ${file.name} (${fileSizeMB.toFixed(1)}MB)，请稍候...`,
        3000
      );
    }

    // 提取base64数据部分（去除data:xxx;base64,前缀）
    const base64Content = base64Data.split(',')[1] || base64Data;

    await window.backendClient.sendMessage({
      type: 'file_upload',
      data: {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        fileData: base64Content,
        timestamp: Date.now()
      }
    });

    window.logger?.info('文件发送成功', { fileName: file.name });
    
    // 大文件发送成功后显示提示
    if (fileSizeMB > LARGE_FILE_WARN_MB) {
      window.dialogueManager?.showQuick(
        `文件 ${file.name} 发送成功`,
        2000
      );
    }
  } catch (error) {
    window.logger?.error('发送文件失败', { fileName: file.name, error });
    window.dialogueManager?.showQuick(`文件 ${file.name} 发送失败`, 3000);
  }
}

/**
 * 显示错误消息
 */
function showError(message: string, duration: number = ERROR_MESSAGE_DURATION_MS): void {
  window.logger.error(message);
  window.dialogueManager?.showDialogue(`❌ ${message}`, duration);
}

/**
 * 页面加载完成后初始化
 */
window.addEventListener('DOMContentLoaded', () => {
  window.logger.info('DOM 加载完成');
  initializeSettingsPanel();
  initializeChatWindow();
  initializeApp();

  // 监听来自主进程的设置打开请求
  window.electronAPI.onOpenSettings(() => {
    window.logger.info('收到主进程打开设置请求');
    showSettingsPanel();
  });

  // 监听来自主进程的插件管理打开请求
  if (window.electronAPI.onOpenPlugins) {
    window.electronAPI.onOpenPlugins(() => {
      window.logger.info('收到主进程打开插件管理请求');
      showPluginsPanel();
    });
  }

  // 监听来自主进程的打开对话请求
  if (window.electronAPI.onOpenChat) {
    window.electronAPI.onOpenChat(() => {
      window.logger.info('收到主进程打开对话请求');
      showChatWindow();
    });
  }

  // 监听来自主进程的切换UI请求
  if (window.electronAPI.onToggleUI) {
    window.electronAPI.onToggleUI(() => {
      window.logger.info('收到主进程切换UI请求');
      toggleUI();
    });
  }

  // 监听来自主进程的打开 Agent 管理请求
  if (window.electronAPI.onOpenAgent) {
    window.electronAPI.onOpenAgent(() => {
      window.logger.info('收到主进程打开 Agent 管理请求');
      showAgentPanel();
    });
  }

  // 监听 Agent 状态变化
  if (window.electronAPI.onAgentStatusChanged) {
    window.electronAPI.onAgentStatusChanged((status: any) => {
      updateAgentStatusUI(status);
    });
  }
});

/**
 * 页面卸载时清理
 */
window.addEventListener('beforeunload', () => {
  window.logger.info('页面卸载，清理资源');
  
  if (window.live2dManager) {
    window.live2dManager.destroy();
  }
  
  if (window.backendClient) {
    window.backendClient.disconnect();
  }
  
  if (window.audioPlayer) {
    window.audioPlayer.stop();
    if (window.audioPlayer.audioContext) {
      window.audioPlayer.audioContext.close().catch(() => {});
    }
  }
  
  if (window.pluginConnector) {
    window.pluginConnector.disconnectAll();
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

window.logger.info('渲染进程脚本加载完成');
window.logger.info('调试命令: window.app');

// ==================== ASR 模型管理 ====================

/**
 * 更新麦克风按钮状态
 * ASR 不可用时显示灰色 + 禁用样式
 */
function updateMicButtonState(): void {
  const btnVoice = document.getElementById('btn-voice');
  if (!btnVoice) return;

  if (appState.asrReady) {
    btnVoice.classList.remove('asr-disabled');
    btnVoice.title = window.i18nManager?.t('chatWindow.voice') || '语音输入';
  } else {
    btnVoice.classList.add('asr-disabled');
    btnVoice.title = window.i18nManager?.t('chatWindow.asrUnavailable') || '语音识别不可用';
  }
}

/**
 * 加载 ASR 模型列表到设置下拉框
 */
async function loadASRModelList(currentModel: string): Promise<void> {
  const select = document.getElementById('setting-asr-model') as HTMLSelectElement;
  const statusEl = document.getElementById('asr-model-status') as HTMLSpanElement;
  if (!select) return;

  try {
    const { models } = await window.electronAPI.asrListModels();

    // 清空选项
    select.innerHTML = '';

    if (models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = window.i18nManager?.t('settings.microphone.asrNoModel') || '未找到 ASR 模型';
      select.appendChild(opt);
      select.disabled = true;
      if (statusEl) {
        statusEl.textContent = '✗';
        statusEl.className = 'asr-model-status error';
      }
      return;
    }

    select.disabled = false;
    for (const model of models) {
      const opt = document.createElement('option');
      opt.value = model.name;
      const sizeMB = (model.size / 1024 / 1024).toFixed(0);
      opt.textContent = `${model.name} (${sizeMB}MB)`;
      if (model.name === currentModel) opt.selected = true;
      select.appendChild(opt);
    }

    // 更新状态指示
    if (statusEl) {
      if (appState.asrReady) {
        statusEl.textContent = '✓';
        statusEl.className = 'asr-model-status ready';
      } else {
        statusEl.textContent = '✗';
        statusEl.className = 'asr-model-status error';
      }
    }

    // 监听切换事件（实时切换模型）
    select.onchange = async () => {
      const newModel = select.value;
      if (!newModel) return;

      if (statusEl) {
        statusEl.textContent = '⟳';
        statusEl.className = 'asr-model-status loading';
      }

      try {
        const result = await window.electronAPI.asrSwitchModel(newModel);
        if (result.success) {
          appState.asrReady = true;
          window.settingsManager.setSetting('asrModel', newModel);
          window.logger.info(`ASR 模型切换成功: ${newModel}`);
          if (statusEl) {
            statusEl.textContent = '✓';
            statusEl.className = 'asr-model-status ready';
          }
        } else {
          appState.asrReady = false;
          window.logger.error(`ASR 模型切换失败: ${result.error}`);
          if (statusEl) {
            statusEl.textContent = '✗';
            statusEl.className = 'asr-model-status error';
          }
          window.dialogueManager?.showQuick(result.error || 'ASR 模型切换失败', 3000);
        }
        updateMicButtonState();
      } catch (error) {
        appState.asrReady = false;
        updateMicButtonState();
        window.logger.error('ASR 模型切换异常:', error);
        if (statusEl) {
          statusEl.textContent = '✗';
          statusEl.className = 'asr-model-status error';
        }
      }
    };
  } catch (error) {
    window.logger.error('加载 ASR 模型列表失败:', error);
  }
}

// ==================== 使用帮助 ====================

/**
 * 初始化使用帮助按钮（打开独立窗口）
 */
(function setupUsageHelp(): void {
  const linkHelp = document.getElementById('link-usage-help');
  if (linkHelp) {
    linkHelp.addEventListener('click', (e: Event) => {
      e.preventDefault();
      const theme = window.themeManager?.getEffectiveTheme?.() || 'light';
      const locale = window.i18nManager?.getLocale?.() || 'zh-CN';
      window.electronAPI.openHelpWindow(theme, locale).catch(err => {
        window.logger.error('打开帮助窗口失败:', err);
      });
    });
  }
})();
