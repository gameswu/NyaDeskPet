/**
 * 插件配置UI
 * 根据Schema渲染配置表单
 */

import type { PluginConfigDefinition, PluginConfigSchema, ConfigDialogOptions } from '../types/global';

class PluginConfigUI {
  private currentPluginId: string | null = null;
  private currentSchema: PluginConfigDefinition | null = null;
  private currentConfig: { [key: string]: any } = {};
  /** 当前对话框中活跃的 Monaco Editor 实例 ID 映射（data-key -> editorId） */
  private activeEditors: Map<string, string> = new Map();
  /** 自定义配置回调 */
  private customOptions: ConfigDialogOptions | null = null;
  
  /**
   * 显示插件配置对话框
   * @param options 可选的自定义加载/保存回调（用于 Agent 插件等非标准配置存储）
   */
  public async showConfigDialog(pluginId: string, pluginName: string, schema: PluginConfigDefinition, options?: ConfigDialogOptions): Promise<void> {
    this.currentPluginId = pluginId;
    this.currentSchema = schema;
    this.customOptions = options || null;
    
    // 获取默认配置
    const defaultConfig = window.pluginConfigManager.getDefaultConfig(schema);
    
    // 加载已保存的配置（支持自定义加载回调）
    const savedConfig = this.customOptions?.loadConfig
      ? await this.customOptions.loadConfig(pluginId)
      : await window.pluginConfigManager.getConfig(pluginId);
    
    // 合并配置：默认值 + 已保存值（已保存的优先）
    this.currentConfig = this.mergeConfig(defaultConfig, savedConfig);
    
    // 如果是首次打开（savedConfig 为空或无关键字段），自动保存默认配置
    const isEmpty = Object.keys(savedConfig).length === 0;
    if (isEmpty) {
      if (this.customOptions?.saveConfig) {
        await this.customOptions.saveConfig(pluginId, this.currentConfig);
      } else {
        await window.pluginConfigManager.saveConfig(pluginId, this.currentConfig);
      }
      window.logger.info(`[PluginConfigUI] 首次打开插件 ${pluginId}，已保存默认配置`);
    }
    
    // 创建对话框
    const dialog = document.createElement('div');
    dialog.className = 'plugin-config-dialog-overlay';
    dialog.innerHTML = `
      <div class="plugin-config-dialog">
        <div class="plugin-config-header">
          <h3><i data-lucide="settings" style="width: 20px; height: 20px;"></i> ${pluginName} - 设置</h3>
          <button class="close-btn" onclick="this.closest('.plugin-config-dialog-overlay').remove()">
            <i data-lucide="x" style="width: 20px; height: 20px;"></i>
          </button>
        </div>
        <div class="plugin-config-body">
          ${this.renderConfigForm(schema, this.currentConfig)}
        </div>
        <div class="plugin-config-footer">
          <button class="plugin-config-btn secondary" onclick="window.pluginConfigUI.resetConfig()">
            <i data-lucide="rotate-ccw" style="width: 16px; height: 16px;"></i>
            恢复默认
          </button>
          <div class="plugin-config-footer-right">
            <button class="plugin-config-btn secondary" onclick="this.closest('.plugin-config-dialog-overlay').remove()">取消</button>
            <button class="plugin-config-btn primary" onclick="window.pluginConfigUI.saveConfig()">保存</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 创建图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
    
    // 绑定事件
    this.bindEvents(dialog);

    // 等待一帧确保对话框布局完成后再初始化 Monaco Editor
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await this.initMonacoEditors(dialog);
  }

  /**
   * 合并配置：默认值 + 已保存值
   * @param defaultConfig 默认配置
   * @param savedConfig 已保存的配置
   * @returns 合并后的配置
   */
  private mergeConfig(defaultConfig: { [key: string]: any }, savedConfig: { [key: string]: any }): { [key: string]: any } {
    const merged: { [key: string]: any } = { ...defaultConfig };
    
    for (const key in savedConfig) {
      if (savedConfig[key] !== null && savedConfig[key] !== undefined) {
        // 如果是object类型且默认配置也是object，递归合并
        if (typeof savedConfig[key] === 'object' && !Array.isArray(savedConfig[key]) &&
            typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
          merged[key] = this.mergeConfig(merged[key], savedConfig[key]);
        } else {
          merged[key] = savedConfig[key];
        }
      }
    }
    
    return merged;
  }

  /**
   * 渲染配置表单
   */
  private renderConfigForm(schema: PluginConfigDefinition, config: { [key: string]: any }, prefix: string = ''): string {
    const locale = window.i18nManager?.getLocale() || 'zh-CN';
    let html = '<div class="plugin-config-fields">';
    
    for (const [key, field] of Object.entries(schema)) {
      if (field.invisible) {
        continue;
      }
      
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const value = config[key];
      const description = window.pluginConfigManager.getLocalizedField(field, locale, 'description');
      const hint = window.pluginConfigManager.getLocalizedField(field, locale, 'hint');
      
      html += `<div class="plugin-config-field">`;
      html += `<label class="plugin-config-label">
                 ${key}
                 ${hint ? `<span class="plugin-config-hint ${field.obvious_hint ? 'obvious' : ''}" data-hint="${hint.replace(/"/g, '&quot;')}">
                   <i data-lucide="help-circle" style="width: 14px; height: 14px;"></i>
                 </span>` : ''}
               </label>`;
      
      if (description) {
        html += `<div class="plugin-config-description">${description}</div>`;
      }
      
      html += this.renderField(fullKey, field, value);
      html += `</div>`;
    }
    
    html += '</div>';
    return html;
  }

  /**
   * 渲染单个字段
   */
  private renderField(key: string, field: PluginConfigSchema, value: any): string {
    const locale = window.i18nManager?.getLocale() || 'zh-CN';
    
    switch (field.type) {
      case 'bool':
        return `<label class="plugin-config-switch">
                  <input type="checkbox" data-key="${key}" ${value ? 'checked' : ''}>
                  <span class="plugin-config-slider"></span>
                </label>`;
      
      case 'int':
      case 'float':
        return `<input type="number" class="plugin-config-input" data-key="${key}" 
                       value="${value ?? ''}" 
                       ${field.type === 'int' ? 'step="1"' : 'step="any"'}>`;
      
      case 'string':
        if (field.options && field.options.length > 0) {
          const options = window.pluginConfigManager.getLocalizedOptions(field, locale);
          return `<select class="plugin-config-select" data-key="${key}">
                    ${options.map((opt, idx) => 
                      `<option value="${field.options![idx]}" ${value === field.options![idx] ? 'selected' : ''}>${opt}</option>`
                    ).join('')}
                  </select>`;
        }
        return `<input type="text" class="plugin-config-input" data-key="${key}" value="${value ?? ''}">`;
      
      case 'text': {
        const lang = field.editor_language || (field.editor_mode ? 'json' : 'plaintext');
        const minH = field.editor_mode ? 200 : 150;
        return `<div class="monaco-editor-container" data-key="${key}" 
                     data-language="${lang}" data-min-height="${minH}"
                     data-initial-value="${encodeURIComponent(String(value ?? ''))}"></div>`;
      }
      
      case 'list':
        return `<div class="plugin-config-list" data-key="${key}">
                  ${this.renderList(key, value || [])}
                  <button class="plugin-config-btn small" onclick="window.pluginConfigUI.addListItem('${key}')">
                    <i data-lucide="plus" style="width: 14px; height: 14px;"></i> 添加项
                  </button>
                </div>`;
      
      case 'object':
        if (field.items) {
          return this.renderConfigForm(field.items, value || {}, key);
        }
        return `<div class="monaco-editor-container" data-key="${key}"
                     data-language="json" data-min-height="150"
                     data-initial-value="${encodeURIComponent(JSON.stringify(value || {}, null, 2))}"></div>`;
      
      case 'dict':
        return `<div class="monaco-editor-container" data-key="${key}"
                     data-language="json" data-min-height="150"
                     data-initial-value="${encodeURIComponent(JSON.stringify(value || {}, null, 2))}"></div>`;
      
      default:
        return `<input type="text" class="plugin-config-input" data-key="${key}" value="${value ?? ''}">`;
    }
  }

  /**
   * 渲染列表
   */
  private renderList(key: string, items: any[]): string {
    return items.map((item, index) => `
      <div class="plugin-config-list-item">
        <input type="text" class="plugin-config-input" data-key="${key}" data-index="${index}" value="${item}">
        <button class="plugin-config-btn small danger" onclick="window.pluginConfigUI.removeListItem('${key}', ${index})">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
      </div>
    `).join('');
  }

  /**
   * 添加列表项
   */
  public addListItem(key: string): void {
    const listContainer = document.querySelector(`.plugin-config-list[data-key="${key}"]`);
    if (!listContainer) return;
    
    const items = Array.from(listContainer.querySelectorAll('.plugin-config-list-item'));
    const newItem = document.createElement('div');
    newItem.className = 'plugin-config-list-item';
    newItem.innerHTML = `
      <input type="text" class="plugin-config-input" data-key="${key}" data-index="${items.length}" value="">
      <button class="plugin-config-btn small danger" onclick="window.pluginConfigUI.removeListItem('${key}', ${items.length})">
        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
      </button>
    `;
    
    const addButton = listContainer.querySelector('button');
    listContainer.insertBefore(newItem, addButton);
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  /**
   * 移除列表项
   */
  public removeListItem(key: string, index: number): void {
    const items = document.querySelectorAll(`.plugin-config-list-item input[data-key="${key}"]`);
    if (items[index]) {
      items[index].closest('.plugin-config-list-item')?.remove();
    }
  }

  /**
   * 绑定事件
   */
  private bindEvents(dialog: HTMLElement): void {
    // 阻止点击对话框内部时关闭
    const dialogContent = dialog.querySelector('.plugin-config-dialog');
    dialogContent?.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    
    // 点击遮罩关闭
    dialog.addEventListener('click', () => {
      this.cleanupEditors();
      dialog.remove();
    });

    // 监听关闭按钮（需要清理编辑器）
    const closeBtn = dialog.querySelector('.close-btn');
    closeBtn?.addEventListener('click', () => {
      this.cleanupEditors();
    });
  }

  /**
   * 初始化对话框中的 Monaco Editor 实例
   */
  private async initMonacoEditors(dialog: HTMLElement): Promise<void> {
    const containers = Array.from(dialog.querySelectorAll<HTMLElement>('.monaco-editor-container[data-key]'));
    if (containers.length === 0) return;

    try {
      await window.monacoManager.load();
    } catch (err) {
      window.logger.error('[PluginConfigUI] Monaco Editor 加载失败，回退到 textarea:', err);
      // 回退：将容器替换为 textarea
      containers.forEach(container => {
        const key = container.getAttribute('data-key') || '';
        const value = decodeURIComponent(container.getAttribute('data-initial-value') || '');
        const textarea = document.createElement('textarea');
        textarea.className = 'plugin-config-textarea';
        textarea.setAttribute('data-key', key);
        textarea.rows = 5;
        textarea.value = value;
        container.parentElement?.replaceChild(textarea, container);
      });
      return;
    }

    for (const container of containers) {
      const key = container.getAttribute('data-key') || '';
      const lang = container.getAttribute('data-language') || 'plaintext';
      const minHeight = parseInt(container.getAttribute('data-min-height') || '150');
      const value = decodeURIComponent(container.getAttribute('data-initial-value') || '');

      try {
        const editorId = await window.monacoManager.createEditor({
          container,
          value,
          language: lang,
          minHeight,
          maxHeight: 500,
        });
        this.activeEditors.set(key, editorId);
      } catch (err) {
        window.logger.error(`[PluginConfigUI] 创建 Monaco Editor 失败 (${key}):`, err);
      }
    }
  }

  /**
   * 清理当前对话框中的 Monaco Editor 实例
   */
  private cleanupEditors(): void {
    for (const [, editorId] of this.activeEditors) {
      window.monacoManager.destroyEditor(editorId);
    }
    this.activeEditors.clear();
  }

  /**
   * 从表单读取配置
   */
  private readFormValues(): { [key: string]: any } {
    if (!this.currentSchema) return {};
    
    const config: { [key: string]: any } = {};
    
    for (const [key, field] of Object.entries(this.currentSchema)) {
      if (field.invisible) {
        continue;
      }
      
      const value = this.readFieldValue(key, field);
      config[key] = value;
    }
    
    return config;
  }

  /**
   * 读取单个字段的值
   */
  private readFieldValue(key: string, field: PluginConfigSchema): any {
    switch (field.type) {
      case 'bool': {
        const input = document.querySelector<HTMLInputElement>(`input[type="checkbox"][data-key="${key}"]`);
        return input?.checked ?? false;
      }
      
      case 'int': {
        const input = document.querySelector<HTMLInputElement>(`input[type="number"][data-key="${key}"]`);
        return parseInt(input?.value || '0', 10);
      }
      
      case 'float': {
        const input = document.querySelector<HTMLInputElement>(`input[type="number"][data-key="${key}"]`);
        return parseFloat(input?.value || '0');
      }
      
      case 'string': {
        const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(
          `input[data-key="${key}"], select[data-key="${key}"]`
        );
        return input?.value || '';
      }
      
      case 'text': {
        const editorId = this.activeEditors.get(key);
        if (editorId) {
          return window.monacoManager.getValue(editorId);
        }
        return '';
      }
      
      case 'list': {
        const inputs = document.querySelectorAll<HTMLInputElement>(`input[data-key="${key}"]`);
        return Array.from(inputs).map(input => input.value);
      }
      
      case 'object': {
        if (field.items) {
          const nestedConfig: { [key: string]: any } = {};
          for (const [nestedKey, nestedField] of Object.entries(field.items)) {
            nestedConfig[nestedKey] = this.readFieldValue(`${key}.${nestedKey}`, nestedField);
          }
          return nestedConfig;
        }
        const objEditorId = this.activeEditors.get(key);
        if (objEditorId) {
          try {
            return JSON.parse(window.monacoManager.getValue(objEditorId) || '{}');
          } catch {
            return {};
          }
        }
        return {};
      }
      
      case 'dict': {
        const dictEditorId = this.activeEditors.get(key);
        if (dictEditorId) {
          try {
            return JSON.parse(window.monacoManager.getValue(dictEditorId) || '{}');
          } catch {
            return {};
          }
        }
        return {};
      }
      
      default:
        return null;
    }
  }

  /**
   * 保存配置
   */
  public async saveConfig(): Promise<void> {
    if (!this.currentPluginId || !this.currentSchema) return;
    
    const config = this.readFormValues();
    
    // 验证配置
    const validation = window.pluginConfigManager.validateConfig(this.currentSchema, config);
    if (!validation.valid) {
      alert('配置验证失败:\n' + validation.errors.join('\n'));
      return;
    }
    
    // 保存配置（支持自定义保存回调）
    const success = this.customOptions?.saveConfig
      ? await this.customOptions.saveConfig(this.currentPluginId, config)
      : await window.pluginConfigManager.saveConfig(this.currentPluginId, config);
    if (success) {
      this.cleanupEditors();
      this.customOptions?.onSaved?.();
      alert('配置已保存');
      document.querySelector('.plugin-config-dialog-overlay')?.remove();
    } else {
      alert('保存失败，请查看日志');
    }
  }

  /**
   * 重置为默认配置
   */
  public async resetConfig(): Promise<void> {
    if (!this.currentPluginId || !this.currentSchema) return;
    
    if (!confirm('确定要恢复默认设置吗？')) {
      return;
    }
    
    let success: boolean;
    if (this.customOptions?.saveConfig) {
      const defaultConfig = window.pluginConfigManager.getDefaultConfig(this.currentSchema);
      success = await this.customOptions.saveConfig(this.currentPluginId, defaultConfig);
    } else {
      success = await window.pluginConfigManager.resetConfig(this.currentPluginId, this.currentSchema);
    }
    if (success) {
      this.cleanupEditors();
      this.customOptions?.onSaved?.();
      alert('已恢复默认设置');
      document.querySelector('.plugin-config-dialog-overlay')?.remove();
    } else {
      alert('重置失败，请查看日志');
    }
  }
}

// 导出单例
const pluginConfigUI = new PluginConfigUI();
(window as any).pluginConfigUI = pluginConfigUI;

export default pluginConfigUI;
