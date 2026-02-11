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
                <i data-lucide="shield" style="width: 14px; height: 14px;"></i>
                权限:
              </span>
              <div class="permission-tags" id="permissions-${plugin.manifest.name}">
                ${this.renderPermissions(plugin.manifest, false)}
              </div>
              ${plugin.manifest.permissions.length > 3 ? `
                <button class="permission-toggle-btn" onclick="window.pluginUI.togglePermissions('${plugin.manifest.name}')">
                  <span class="toggle-text">展开</span>
                  <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </button>
              ` : ''}
            </div>
          </div>

          <div class="plugin-card-footer">
            <div class="plugin-footer-left">
              <button class="plugin-icon-btn" onclick="window.pluginUI.showPluginSettings('${plugin.manifest.name}')" title="插件设置">
                <i data-lucide="settings" style="width: 16px; height: 16px;"></i>
              </button>
              <button class="plugin-icon-btn" onclick="window.electronAPI.openPluginDirectory('${plugin.directoryName}')" title="${window.i18nManager?.t('plugin.openDirectory') || '打开插件目录'}">
                <i data-lucide="folder" style="width: 20px; height: 20px;"></i>
              </button>
              <button class="plugin-icon-btn" onclick="window.electronAPI.openPluginDataDirectory('${plugin.manifest.id}')" title="${window.i18nManager?.t('plugin.openDataDirectory') || '打开数据目录'}">
                <i data-lucide="database" style="width: 20px; height: 20px;"></i>
              </button>
              <button class="plugin-icon-btn plugin-btn-danger-icon" onclick="window.pluginUI.clearPluginData('${plugin.manifest.name}')" title="${window.i18nManager?.t('plugin.clearData') || '清除数据'}">
                <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
              </button>
            </div>
            <div class="plugin-footer-right">
              ${actionButtons}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 创建 Lucide 图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  /**
   * 渲染权限标签
   */
  private renderPermissions(manifest: any, expanded: boolean): string {
    const permissions = manifest.permissions || [];
    const locale = window.i18nManager?.getLocale() || 'zh-CN';
    
    const visiblePermissions = expanded ? permissions : permissions.slice(0, 3);
    
    const dangerLevelColors: { [key: string]: string } = {
      'safe': '#28a745',
      'low': '#17a2b8',
      'medium': '#ffc107',
      'high': '#fd7e14',
      'critical': '#dc3545'
    };
    
    const tags = visiblePermissions.map((perm: any) => {
      const permI18n = perm.i18n?.[locale] || perm.i18n?.['zh-CN'] || {};
      const color = dangerLevelColors[perm.dangerLevel] || '#6c757d';
      const description = (permI18n.description || '').replace(/"/g, '&quot;');
      return `<span class="permission-tag" style="border-color: ${color}; color: ${color};" data-hint="${description}">${permI18n.name || perm.id}</span>`;
    }).join('');
    
    return tags + (expanded && permissions.length > 3 ? '' : (!expanded && permissions.length > 3 ? `<span class="permission-tag" style="border-color: #6c757d; color: #6c757d;">+${permissions.length - 3}</span>` : ''));
  }

  /**
   * 切换权限显示
   */
  public togglePermissions(pluginName: string): void {
    const container = document.getElementById(`permissions-${pluginName}`);
    const button = container?.parentElement?.querySelector('.permission-toggle-btn');
    if (!container || !button) return;

    const plugin = window.pluginConnector.getPlugins().find(p => p.manifest.name === pluginName);
    if (!plugin) return;

    const isExpanded = container.dataset.expanded === 'true';
    container.dataset.expanded = String(!isExpanded);
    container.innerHTML = this.renderPermissions(plugin.manifest, !isExpanded);

    const toggleText = button.querySelector('.toggle-text');
    const toggleIcon = button.querySelector('i');
    if (toggleText && toggleIcon) {
      toggleText.textContent = isExpanded ? '展开' : '收起';
      toggleIcon.setAttribute('data-lucide', isExpanded ? 'chevron-down' : 'chevron-up');
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }
  }

  /**
   * 显示插件设置
   */
  public showPluginSettings(pluginName: string): void {
    const plugin = window.pluginConnector.getPlugin(pluginName);
    if (!plugin) {
      alert('插件不存在');
      return;
    }
    
    const schema = plugin.manifest.config;
    if (!schema || Object.keys(schema).length === 0) {
      alert('此插件没有可配置的设置项');
      return;
    }
    
    const i18n = window.pluginConnector.getPluginI18n(pluginName);
    const displayName = i18n?.displayName || pluginName;
    
    window.pluginConfigUI.showConfigDialog(plugin.manifest.id, displayName, schema);
  }

  /**
   * 清除插件数据
   */
  public async clearPluginData(pluginName: string): Promise<void> {
    const confirmed = confirm(`确定要清除插件 "${pluginName}" 的所有数据吗？此操作不可撤销。`);
    if (!confirmed) return;

    try {
      const result = await window.electronAPI.clearPluginData(pluginName);
      if (result.success) {
        alert('插件数据已清除');
      } else {
        alert(`清除失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      window.logger.error('清除插件数据失败:', error);
      alert('清除失败，请查看控制台');
    }
  }
}

// 导出全局实例
window.pluginUI = new PluginUI();

