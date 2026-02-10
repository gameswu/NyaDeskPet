/**
 * 插件UI
 * 负责插件列表的渲染和交互
 */

class PluginUI {
  private container: HTMLElement | null;

  constructor() {
    this.container = document.getElementById('plugin-list');
  }

  /**
   * 渲染插件列表
   */
  public renderPlugins(): void {
    if (!this.container) return;

    const plugins = window.pluginConnector.getPlugins();
    
    if (plugins.length === 0) {
      this.container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="puzzle" style="width: 48px; height: 48px; color: var(--text-secondary); margin-bottom: 16px;"></i>
          <p data-i18n="plugins.noPlugins">没有可用的插件</p>
        </div>
      `;
      if (window.lucide) {
        window.lucide.createIcons();
      }
      return;
    }

    this.container.innerHTML = plugins.map(plugin => {
      const i18n = window.pluginConnector.getPluginI18n(plugin.manifest.name);
      const displayName = i18n?.displayName || plugin.manifest.name;
      const description = i18n?.description || '';
      const category = i18n?.category || plugin.manifest.type;
      
      // 状态配置
      const statusConfig = {
        'stopped': {
          class: 'stopped',
          icon: 'circle',
          text: '已停止',
          color: '#6c757d'
        },
        'starting': {
          class: 'starting',
          icon: 'loader',
          text: '启动中',
          color: '#0dcaf0'
        },
        'running': {
          class: 'running',
          icon: 'activity',
          text: '运行中',
          color: '#ffc107'
        },
        'connected': {
          class: 'connected',
          icon: 'check-circle',
          text: '已连接',
          color: '#198754'
        },
        'error': {
          class: 'error',
          icon: 'alert-circle',
          text: '错误',
          color: '#dc3545'
        }
      };

      const status = statusConfig[plugin.status] || statusConfig['stopped'];

      // 按钮组
      let actionButtons = '';
      if (plugin.status === 'stopped' || plugin.status === 'error') {
        actionButtons = `
          <button class="plugin-btn plugin-btn-primary" onclick="window.pluginConnector.startPlugin('${plugin.manifest.name}')">
            <i data-lucide="play" style="width: 16px; height: 16px;"></i>
            <span>启动</span>
          </button>
        `;
      } else if (plugin.status === 'running') {
        actionButtons = `
          <button class="plugin-btn plugin-btn-secondary" onclick="window.pluginConnector.connectPlugin('${plugin.manifest.name}')">
            <i data-lucide="link" style="width: 16px; height: 16px;"></i>
            <span>连接</span>
          </button>
          <button class="plugin-btn plugin-btn-danger" onclick="window.pluginConnector.stopPlugin('${plugin.manifest.name}')">
            <i data-lucide="square" style="width: 16px; height: 16px;"></i>
            <span>停止</span>
          </button>
        `;
      } else if (plugin.status === 'connected') {
        actionButtons = `
          <button class="plugin-btn plugin-btn-secondary" onclick="window.pluginConnector.disconnectPlugin('${plugin.manifest.name}')">
            <i data-lucide="unlink" style="width: 16px; height: 16px;"></i>
            <span>断开</span>
          </button>
          <button class="plugin-btn plugin-btn-danger" onclick="window.pluginConnector.stopPlugin('${plugin.manifest.name}')">
            <i data-lucide="square" style="width: 16px; height: 16px;"></i>
            <span>停止</span>
          </button>
        `;
      } else if (plugin.status === 'starting') {
        actionButtons = `
          <button class="plugin-btn plugin-btn-secondary" disabled>
            <i data-lucide="loader" class="spinning" style="width: 16px; height: 16px;"></i>
            <span>启动中...</span>
          </button>
        `;
      }

      // 图标显示逻辑
      let iconHtml = '';
      if (plugin.manifest.iconFile) {
        const iconPath = `plugins/${plugin.manifest.name}/${plugin.manifest.iconFile}`;
        iconHtml = `<img src="${iconPath}" alt="${displayName}" style="width: 32px; height: 32px; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
        iconHtml += `<i data-lucide="puzzle" style="width: 32px; height: 32px; display: none;"></i>`;
      } else {
        iconHtml = `<i data-lucide="puzzle" style="width: 32px; height: 32px;"></i>`;
      }

      return `
        <div class="plugin-card status-${status.class}">
          <div class="plugin-card-header">
            <div class="plugin-icon">
              ${iconHtml}
            </div>
            <div class="plugin-title-section">
              <h3 class="plugin-title">${displayName}</h3>
              <span class="plugin-category">${category}</span>
            </div>
            <div class="plugin-status">
              <i data-lucide="${status.icon}" style="width: 18px; height: 18px; color: ${status.color};"></i>
              <span style="color: ${status.color};">${status.text}</span>
            </div>
          </div>
          
          <div class="plugin-card-body">
            <p class="plugin-description">${description}</p>
            
            <div class="plugin-meta">
              <div class="plugin-meta-item">
                <i data-lucide="tag" style="width: 14px; height: 14px;"></i>
                <span>v${plugin.manifest.version}</span>
              </div>
              <div class="plugin-meta-item">
                <i data-lucide="user" style="width: 14px; height: 14px;"></i>
                <span>${plugin.manifest.author}</span>
              </div>
              ${plugin.processId ? `
                <div class="plugin-meta-item">
                  <i data-lucide="hash" style="width: 14px; height: 14px;"></i>
                  <span>PID: ${plugin.processId}</span>
                </div>
              ` : ''}
            </div>

            <div class="plugin-capabilities">
              <span class="capabilities-label">
                <i data-lucide="zap" style="width: 14px; height: 14px;"></i>
                功能:
              </span>
              ${plugin.manifest.capabilities.slice(0, 3).map(cap => 
                `<span class="capability-tag">${cap}</span>`
              ).join('')}
              ${plugin.manifest.capabilities.length > 3 ? 
                `<span class="capability-tag">+${plugin.manifest.capabilities.length - 3}</span>` : ''}
            </div>
          </div>

          <div class="plugin-card-footer">
            ${actionButtons}
          </div>
        </div>
      `;
    }).join('');

    // 创建 Lucide 图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

// 导出全局实例
window.pluginUI = new PluginUI();

