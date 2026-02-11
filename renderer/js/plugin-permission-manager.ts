/**
 * 插件权限管理器
 * 负责权限的审批、记录和管理
 */

import type { PluginPermissionGrant } from '../types/global';

class PluginPermissionManager {
  private permissions: PluginPermissionGrant[] = [];
  private initialized: boolean = false;

  /**
   * 初始化权限管理器
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const result = await window.electronAPI.invoke('plugin:get-permissions');
      if (result.success) {
        this.permissions = result.permissions || [];
        window.logger.info(`[PermissionManager] 加载了 ${this.permissions.length} 条权限记录`);
      }
      this.initialized = true;
    } catch (error) {
      window.logger.error('[PermissionManager] 初始化失败:', error);
      this.initialized = true;
    }
  }

  /**
   * 检查权限
   * @param pluginId 插件ID
   * @param permissionId 权限ID
   * @param dangerLevel 危险级别
   * @returns 是否已授权
   */
  public async checkPermission(pluginId: string, permissionId: string, dangerLevel: string): Promise<boolean> {
    await this.initialize();
    
    // 检查是否已有授权记录
    const existing = this.permissions.find(
      p => p.pluginId === pluginId && p.permissionId === permissionId
    );
    
    if (existing) {
      return existing.granted;
    }
    
    // safe 级别自动授权
    if (dangerLevel === 'safe') {
      await this.grantPermission(pluginId, permissionId, true);
      return true;
    }
    
    // 弹出确认对话框
    return await this.requestPermission(pluginId, permissionId, dangerLevel);
  }

  /**
   * 请求权限（弹出对话框）
   */
  private async requestPermission(pluginId: string, permissionId: string, dangerLevel: string): Promise<boolean> {
    return new Promise((resolve) => {
      // 创建对话框
      const dialog = document.createElement('div');
      dialog.className = 'permission-dialog-overlay';
      
      // 获取插件信息
      const plugin: any = window.pluginConnector.getPlugin(pluginId) || 
                     Array.from((window.pluginConnector as any).plugins.values())
                       .find((p: any) => p.manifest.id === pluginId);
      
      const pluginName = plugin?.manifest.i18n[window.i18nManager?.getLocale() || 'zh-CN']?.displayName || pluginId;
      
      // 获取权限信息
      const permission = plugin?.manifest.permissions.find((p: any) => p.id === permissionId);
      const permissionI18n = permission?.i18n?.[window.i18nManager?.getLocale() || 'zh-CN'];
      
      const dangerLevelText: { [key: string]: string } = {
        'low': '低风险',
        'medium': '中等风险',
        'high': '高风险',
        'critical': '严重风险'
      };
      
      const dangerLevelColor: { [key: string]: string } = {
        'low': '#17a2b8',
        'medium': '#ffc107',
        'high': '#fd7e14',
        'critical': '#dc3545'
      };
      
      dialog.innerHTML = `
        <div class="permission-dialog">
          <div class="permission-dialog-header">
            <i data-lucide="alert-triangle" style="width: 24px; height: 24px; color: ${dangerLevelColor[dangerLevel] || '#ffc107'};"></i>
            <h3>权限请求</h3>
          </div>
          <div class="permission-dialog-body">
            <p class="permission-dialog-plugin">插件 <strong>${pluginName}</strong> 请求以下权限：</p>
            <div class="permission-dialog-detail">
              <div class="permission-dialog-name">${permissionI18n?.name || permissionId}</div>
              <div class="permission-dialog-description">${permissionI18n?.description || '无描述'}</div>
              <div class="permission-dialog-danger" style="color: ${dangerLevelColor[dangerLevel] || '#ffc107'};">
                危险级别：${dangerLevelText[dangerLevel] || dangerLevel}
              </div>
            </div>
            <label class="permission-dialog-remember">
              <input type="checkbox" id="permission-remember">
              <span>记住我的选择</span>
            </label>
          </div>
          <div class="permission-dialog-footer">
            <button class="permission-dialog-btn deny" id="permission-deny">拒绝</button>
            <button class="permission-dialog-btn allow" id="permission-allow">允许</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(dialog);
      
      // 创建图标
      if (window.lucide) {
        window.lucide.createIcons();
      }
      
      // 绑定事件
      const rememberCheckbox = dialog.querySelector<HTMLInputElement>('#permission-remember')!;
      const allowBtn = dialog.querySelector('#permission-allow')!;
      const denyBtn = dialog.querySelector('#permission-deny')!;
      
      allowBtn.addEventListener('click', async () => {
        const remember = rememberCheckbox.checked;
        await this.grantPermission(pluginId, permissionId, remember);
        dialog.remove();
        resolve(true);
      });
      
      denyBtn.addEventListener('click', async () => {
        const remember = rememberCheckbox.checked;
        if (remember) {
          await this.revokePermission(pluginId, permissionId);
        }
        dialog.remove();
        resolve(false);
      });
    });
  }

  /**
   * 授予权限
   */
  public async grantPermission(pluginId: string, permissionId: string, remember: boolean): Promise<void> {
    await this.initialize();
    
    // 移除旧记录
    this.permissions = this.permissions.filter(
      p => !(p.pluginId === pluginId && p.permissionId === permissionId)
    );
    
    // 添加新记录
    if (remember) {
      this.permissions.push({
        pluginId,
        permissionId,
        granted: true,
        remember: true,
        timestamp: Date.now()
      });
      
      // 保存到文件
      await this.savePermissions();
    }
  }

  /**
   * 拒绝权限
   */
  public async revokePermission(pluginId: string, permissionId: string): Promise<void> {
    await this.initialize();
    
    // 移除旧记录
    this.permissions = this.permissions.filter(
      p => !(p.pluginId === pluginId && p.permissionId === permissionId)
    );
    
    // 添加拒绝记录
    this.permissions.push({
      pluginId,
      permissionId,
      granted: false,
      remember: true,
      timestamp: Date.now()
    });
    
    // 保存到文件
    await this.savePermissions();
  }

  /**
   * 获取已授权的权限列表
   */
  public async getGrantedPermissions(pluginId: string): Promise<string[]> {
    await this.initialize();
    
    return this.permissions
      .filter(p => p.pluginId === pluginId && p.granted)
      .map(p => p.permissionId);
  }

  /**
   * 清除插件的所有权限记录
   */
  public async clearPermissions(pluginId: string): Promise<void> {
    await this.initialize();
    
    this.permissions = this.permissions.filter(p => p.pluginId !== pluginId);
    await this.savePermissions();
  }

  /**
   * 保存权限记录
   */
  private async savePermissions(): Promise<void> {
    try {
      const result = await window.electronAPI.invoke('plugin:save-permissions', {
        permissions: this.permissions
      });
      
      if (!result.success) {
        window.logger.error('[PermissionManager] 保存权限失败:', result.error);
      }
    } catch (error) {
      window.logger.error('[PermissionManager] 保存权限异常:', error);
    }
  }
}

// 导出单例
const pluginPermissionManager = new PluginPermissionManager();
(window as any).pluginPermissionManager = pluginPermissionManager;

export default pluginPermissionManager;
