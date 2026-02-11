/**
 * 渲染进程主脚本
 * 协调各个模块的工作
 */

import type { AppState, AppDebugInterface, ThemeMode, TapConfig, BackendMessage } from '../types/global';

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
      const asrResult = await (window as any).electronAPI.asrInitialize();
      if (asrResult.success) {
        window.logger.info('ASR 服务初始化成功');
        window.logger.info('ASR语音识别服务初始化成功');
        appState.asrReady = true;
      } else {
        window.logger.warn('ASR 服务初始化失败，语音识别功能将不可用');
        window.logger.warn('ASR语音识别服务初始化失败');
        appState.asrReady = false;
      }
    } catch (error) {
      window.logger.error('ASR 服务初始化异常:', error);
      window.logger.error('ASR语音识别服务初始化异常', { error });
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
    // 如果使用内置后端模式，先启动 Agent 服务器
    if (settings.backendMode === 'builtin') {
      window.logger.info('启动内置 Agent 服务器...');
      try {
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
        '你好！我是你的桌面宠物喵~ 点击我可以和我互动哦！',
        5000
      );
    }, 1000);

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

  // 加载工具列表
  initAgentToolsUI();

  // 加载 MCP 服务器列表
  initAgentMCPUI();

  // 初始化 Agent 插件 UI
  initAgentPluginUI();

  // 初始化标签页切换
  initAgentTabs();

  // 立即刷新一次状态
  refreshAgentStatus();

  // 定时刷新状态
  if (agentStatusTimer) clearInterval(agentStatusTimer);
  agentStatusTimer = window.setInterval(refreshAgentStatus, 3000);
}

/**
 * 初始化 Provider 选择器 UI
 */
async function initAgentProviderUI(): Promise<void> {
  try {
    const info = await window.electronAPI.agentGetProviders();
    const select = document.getElementById('agent-provider-select') as HTMLSelectElement;
    if (!select) return;

    // 填充 Provider 下拉列表
    select.innerHTML = '';
    for (const p of info.providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === info.active.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }

    // 渲染当前 Provider 配置字段（带已保存的配置值）
    const activeMetadata = info.providers.find(p => p.id === info.active.id);
    renderProviderConfigFields(activeMetadata, info.active.config);

    // 切换 Provider 时更新配置字段
    select.onchange = () => {
      const selectedMeta = info.providers.find(p => p.id === select.value);
      // 切换时，如果是当前 active 的 provider 则带入已保存的配置，否则使用默认值
      const savedConfig = (select.value === info.active.id) ? info.active.config : undefined;
      renderProviderConfigFields(selectedMeta, savedConfig);
      hideProviderStatus();
    };

    // 绑定测试按钮
    const btnTest = document.getElementById('btn-provider-test');
    if (btnTest) {
      btnTest.onclick = async () => {
        showProviderStatus(window.i18nManager.t('agent.provider.testing'), 'info');
        const result = await window.electronAPI.agentTestProvider();
        if (result.success) {
          showProviderStatus(window.i18nManager.t('agent.provider.testSuccess'), 'success');
        } else {
          showProviderStatus(
            `${window.i18nManager.t('agent.provider.testFailed')}: ${result.error || ''}`,
            'error'
          );
        }
      };
    }

    // 绑定应用按钮
    const btnSave = document.getElementById('btn-provider-save');
    if (btnSave) {
      btnSave.onclick = async () => {
        const providerId = select.value;
        const config = collectProviderConfig(providerId);
        const result = await window.electronAPI.agentSetProvider(providerId, config);
        if (result.success) {
          showProviderStatus(window.i18nManager.t('agent.provider.saved'), 'success');
        }
      };
    }
  } catch (error) {
    window.logger.error('加载 Provider 列表失败:', error);
  }
}

/**
 * 渲染 Provider 配置字段
 * @param metadata Provider 元信息
 * @param savedConfig 已保存的配置值（可选）
 */
function renderProviderConfigFields(metadata: any, savedConfig?: Record<string, unknown>): void {
  const container = document.getElementById('agent-provider-config');
  if (!container) return;

  container.innerHTML = '';

  if (!metadata || !metadata.configSchema || metadata.configSchema.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.style.margin = '0';
    hint.style.padding = '4px 0';
    hint.textContent = window.i18nManager.t('agent.provider.noConfig');
    container.appendChild(hint);
    return;
  }

  for (const field of metadata.configSchema) {
    const div = document.createElement('div');
    div.className = 'provider-field';

    const label = document.createElement('label');
    label.textContent = field.label;
    if (field.required) {
      const asterisk = document.createElement('span');
      asterisk.textContent = ' *';
      asterisk.style.color = '#dc3545';
      label.appendChild(asterisk);
    }
    div.appendChild(label);

    // 获取值：优先使用已保存配置，其次使用默认值
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
        option.textContent = opt.label;
        if (opt.value === currentValue) {
          option.selected = true;
        }
        input.appendChild(option);
      }
    } else if (field.type === 'boolean') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const val = getValue();
      checkbox.checked = val === true || val === 'true';
      checkbox.dataset.providerField = field.key;
      div.appendChild(checkbox);
      if (field.description) {
        const hint = document.createElement('div');
        hint.className = 'field-hint';
        hint.textContent = field.description;
        div.appendChild(hint);
      }
      container.appendChild(div);
      continue;
    } else {
      input = document.createElement('input');
      input.type = field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text';
      if (field.placeholder) input.placeholder = field.placeholder;
      const val = getValue();
      if (val !== undefined && val !== null) {
        input.value = String(val);
      }
    }

    input.dataset.providerField = field.key;
    div.appendChild(input);

    if (field.description) {
      const hint = document.createElement('div');
      hint.className = 'field-hint';
      hint.textContent = field.description;
      div.appendChild(hint);
    }

    container.appendChild(div);
  }
}

/**
 * 收集 Provider 配置表单数据
 */
function collectProviderConfig(providerId: string): any {
  const config: any = { id: providerId, name: providerId };
  const container = document.getElementById('agent-provider-config');
  if (!container) return config;

  const fields = container.querySelectorAll('[data-provider-field]');
  fields.forEach((el) => {
    const key = (el as HTMLElement).dataset.providerField!;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        config[key] = el.checked;
      } else if (el.type === 'number') {
        config[key] = parseFloat(el.value) || 0;
      } else {
        config[key] = el.value;
      }
    } else if (el instanceof HTMLSelectElement) {
      config[key] = el.value;
    }
  });

  return config;
}

/**
 * 显示 Provider 操作状态
 */
function showProviderStatus(message: string, type: 'success' | 'error' | 'info'): void {
  const el = document.getElementById('agent-provider-status');
  if (!el) return;
  el.textContent = message;
  el.className = `agent-provider-status ${type}`;
  el.classList.remove('hidden');

  // 成功和信息类消息 3 秒后自动隐藏
  if (type === 'success' || type === 'info') {
    setTimeout(() => hideProviderStatus(), 3000);
  }
}

/**
 * 隐藏 Provider 状态
 */
function hideProviderStatus(): void {
  const el = document.getElementById('agent-provider-status');
  if (el) {
    el.classList.add('hidden');
  }
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

      const sourceIcon = tool.source === 'mcp' ? '🔌' : '⚡';
      const sourceLabel = tool.source === 'mcp' ? 'MCP' : 'Func';
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
          <div class="agent-tool-desc" title="${escapeHtml(tool.description || '')}">${escapeHtml(tool.description || '')}</div>
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

  // 绑定配置弹窗关闭按钮
  const btnCloseConfig = document.getElementById('btn-close-plugin-config');
  if (btnCloseConfig) {
    btnCloseConfig.onclick = () => hidePluginConfigDialog();
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
        <div class="agent-plugin-desc">${escapeHtml(plugin.desc)}</div>
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
              showPluginConfigDialog(plugin);
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
 * 显示插件配置弹窗
 */
function showPluginConfigDialog(plugin: any): void {
  const dialog = document.getElementById('agent-plugin-config-dialog');
  const title = document.getElementById('agent-plugin-config-title');
  const body = document.getElementById('agent-plugin-config-body');
  if (!dialog || !title || !body) return;

  title.textContent = `${plugin.name} - ${window.i18nManager.t('agent.agentPlugins.config')}`;
  body.innerHTML = '';

  if (!plugin.configSchema) return;

  // 渲染配置字段
  for (const [key, field] of Object.entries(plugin.configSchema as Record<string, any>)) {
    const div = document.createElement('div');
    div.className = 'config-field';

    const label = document.createElement('label');
    label.textContent = field.description || key;
    div.appendChild(label);

    const currentValue = plugin.config?.[key] ?? field.default;

    if (field.type === 'boolean') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!currentValue;
      checkbox.dataset.configKey = key;
      div.appendChild(checkbox);
    } else if (field.type === 'select' && field.options) {
      const select = document.createElement('select');
      select.dataset.configKey = key;
      for (const opt of field.options) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === String(currentValue)) option.selected = true;
        select.appendChild(option);
      }
      div.appendChild(select);
    } else if (field.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.dataset.configKey = key;
      if (currentValue !== undefined) input.value = String(currentValue);
      div.appendChild(input);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.configKey = key;
      if (currentValue !== undefined) input.value = String(currentValue);
      div.appendChild(input);
    }

    body.appendChild(div);
  }

  // 绑定保存按钮
  const btnSave = document.getElementById('btn-plugin-config-save');
  if (btnSave) {
    btnSave.onclick = async () => {
      const config: Record<string, unknown> = {};
      body.querySelectorAll('[data-config-key]').forEach((el) => {
        const key = (el as HTMLElement).dataset.configKey!;
        if (el instanceof HTMLInputElement) {
          if (el.type === 'checkbox') config[key] = el.checked;
          else if (el.type === 'number') config[key] = parseFloat(el.value) || 0;
          else config[key] = el.value;
        } else if (el instanceof HTMLSelectElement) {
          config[key] = el.value;
        }
      });

      try {
        const result = await window.electronAPI.agentSavePluginConfig(plugin.name, config);
        if (result.success) {
          hidePluginConfigDialog();
          await refreshAgentPlugins();
        } else {
          window.logger.error('保存插件配置失败:', result.error);
        }
      } catch (error) {
        window.logger.error('保存插件配置失败:', error);
      }
    };
  }

  dialog.classList.remove('hidden');
}

/**
 * 隐藏插件配置弹窗
 */
function hidePluginConfigDialog(): void {
  const dialog = document.getElementById('agent-plugin-config-dialog');
  if (dialog) dialog.classList.add('hidden');
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
    if (addressEl) addressEl.textContent = '-';
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
    window.logger.error('发送消息失败:', error);
    addChatMessage(window.i18nManager.t('messages.sendFailed'), false);
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
        const maxSizeMB = 100;
        
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
            type: isImage ? 'image' : 'file',
            url: url,
            name: file.name
          });
          
          // 发送文件数据到后端
          sendFileToBackend(file, url);
        };
        
        reader.onerror = () => {
          window.logger?.error('文件读取失败', { fileName: file.name });
          window.dialogueManager?.showQuick(`文件 ${file.name} 读取失败`, 3000);
        };
        
        // 对于大文件显示加载提示
        if (fileSizeMB > 10) {
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
  const customFields = document.getElementById('custom-backend-fields');
  if (customFields) {
    customFields.style.display = mode === 'custom' ? 'block' : 'none';
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
  (document.getElementById('setting-backend-mode') as HTMLSelectElement).value = settings.backendMode || 'builtin';
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
  (document.getElementById('setting-custom-personality') as HTMLTextAreaElement).value = settings.customPersonality;
  (document.getElementById('setting-mic-background-mode') as HTMLInputElement).checked = settings.micBackgroundMode || false;
  (document.getElementById('setting-mic-threshold') as HTMLInputElement).value = String(settings.micVolumeThreshold || 30);
  (document.getElementById('mic-threshold-value') as HTMLSpanElement).textContent = String(settings.micVolumeThreshold || 30);
  (document.getElementById('setting-mic-auto-send') as HTMLInputElement).checked = settings.micAutoSend !== false;

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
  const backendMode = (document.getElementById('setting-backend-mode') as HTMLSelectElement).value as 'builtin' | 'custom';
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
  const customPersonality = (document.getElementById('setting-custom-personality') as HTMLTextAreaElement).value;
  const micBackgroundMode = (document.getElementById('setting-mic-background-mode') as HTMLInputElement).checked;
  const micVolumeThreshold = parseFloat((document.getElementById('setting-mic-threshold') as HTMLInputElement).value);
  const micAutoSend = (document.getElementById('setting-mic-auto-send') as HTMLInputElement).checked;
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
  
  // 更新日志配置
  await window.logger.updateConfig({
    enabled: logEnabled,
    levels: logLevels,
    retentionDays: logRetentionDays
  });
  
  // 保存触碰配置
  saveTapConfigFromUI();
  
  // 更新 Agent 按钮可见性并通知主进程
  updateAgentButtonVisibility();
  window.electronAPI.notifyBackendModeChanged(backendMode);
  
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

  // 主题切换 - 移除实时切换，仅在保存时生效
  // const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement;
  // if (themeSelect) {
  //   themeSelect.addEventListener('change', (e: Event) => {
  //     const newTheme = (e.target as HTMLSelectElement).value as ThemeMode;
  //     window.themeManager.setTheme(newTheme);
  //   });
  // }

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
 * 发送用户消息
 * @param text - 用户输入的文本
 */
async function sendUserMessage(text: string): Promise<void> {
  if (!text || text.trim().length === 0) {
    return;
  }

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
    if (fileSizeMB > 10) {
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
    if (fileSizeMB > 10) {
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
function showError(message: string, duration: number = 5000): void {
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
