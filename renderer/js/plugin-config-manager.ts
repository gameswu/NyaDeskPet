/**
 * 插件配置管理器
 * 负责插件配置的加载、保存和验证
 */

import type { PluginConfigDefinition, PluginConfigSchema } from '../types/global';

class PluginConfigManager {
  /**
   * 获取插件配置
   * @param pluginId 插件ID
   * @returns 配置值对象
   */
  public async getConfig(pluginId: string): Promise<{ [key: string]: any }> {
    try {
      const result = await window.electronAPI.invoke('plugin:get-config', { pluginId });
      if (result.success) {
        return result.config || {};
      }
      window.logger.error(`[PluginConfig] 获取配置失败: ${result.error}`);
      return {};
    } catch (error) {
      window.logger.error(`[PluginConfig] 获取配置异常:`, error);
      return {};
    }
  }

  /**
   * 保存插件配置
   * @param pluginId 插件ID
   * @param config 配置对象
   * @returns 是否成功
   */
  public async saveConfig(pluginId: string, config: { [key: string]: any }): Promise<boolean> {
    try {
      const result = await window.electronAPI.invoke('plugin:save-config', { pluginId, config });
      if (result.success) {
        window.logger.info(`[PluginConfig] 保存配置成功: ${pluginId}`);
        return true;
      }
      window.logger.error(`[PluginConfig] 保存配置失败: ${result.error}`);
      return false;
    } catch (error) {
      window.logger.error(`[PluginConfig] 保存配置异常:`, error);
      return false;
    }
  }

  /**
   * 重置插件配置为默认值
   * @param pluginId 插件ID
   * @param schema 配置Schema
   * @returns 是否成功
   */
  public async resetConfig(pluginId: string, schema: PluginConfigDefinition): Promise<boolean> {
    const defaultConfig = this.getDefaultConfig(schema);
    return await this.saveConfig(pluginId, defaultConfig);
  }

  /**
   * 从Schema提取默认配置
   * @param schema 配置Schema
   * @returns 默认配置对象
   */
  public getDefaultConfig(schema: PluginConfigDefinition): { [key: string]: any } {
    const config: { [key: string]: any } = {};
    
    for (const [key, field] of Object.entries(schema)) {
      if (field.invisible) {
        continue;  // 跳过隐藏字段
      }
      
      if (field.default !== undefined) {
        config[key] = field.default;
      } else {
        // 根据类型设置默认值
        switch (field.type) {
          case 'int':
            config[key] = 0;
            break;
          case 'float':
            config[key] = 0.0;
            break;
          case 'bool':
            config[key] = false;
            break;
          case 'string':
          case 'text':
            config[key] = '';
            break;
          case 'object':
          case 'dict':
            config[key] = {};
            break;
          case 'list':
          case 'template_list':
            config[key] = [];
            break;
          default:
            config[key] = null;
        }
      }
      
      // 如果是object类型且有items，递归处理
      if (field.type === 'object' && field.items) {
        config[key] = this.getDefaultConfig(field.items);
      }
    }
    
    return config;
  }

  /**
   * 验证配置值
   * @param schema 配置Schema
   * @param config 配置值
   * @returns 验证结果和错误信息
   */
  public validateConfig(schema: PluginConfigDefinition, config: { [key: string]: any }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    for (const [key, field] of Object.entries(schema)) {
      if (field.invisible) {
        continue;
      }
      
      const value = config[key];
      
      // 检查类型
      if (!this.validateType(field.type, value)) {
        errors.push(`字段 ${key} 类型不匹配，期望 ${field.type}`);
      }
      
      // 检查选项
      if (field.options && field.options.length > 0) {
        if (!field.options.includes(value)) {
          errors.push(`字段 ${key} 的值必须是: ${field.options.join(', ')}`);
        }
      }
      
      // 如果是object类型且有items，递归验证
      if (field.type === 'object' && field.items && typeof value === 'object' && value !== null) {
        const nestedResult = this.validateConfig(field.items, value);
        if (!nestedResult.valid) {
          errors.push(...nestedResult.errors.map(err => `${key}.${err}`));
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 验证值的类型
   */
  private validateType(type: string, value: any): boolean {
    switch (type) {
      case 'int':
        return Number.isInteger(value);
      case 'float':
        return typeof value === 'number' && !isNaN(value);
      case 'bool':
        return typeof value === 'boolean';
      case 'string':
      case 'text':
        return typeof value === 'string';
      case 'object':
      case 'dict':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'list':
      case 'template_list':
        return Array.isArray(value);
      default:
        return true;  // 未知类型，允许通过
    }
  }

  /**
   * 获取配置字段的本地化描述
   */
  public getLocalizedField(field: PluginConfigSchema, locale: string, fieldName: 'description' | 'hint'): string {
    if (field.i18n && field.i18n[locale] && field.i18n[locale][fieldName]) {
      return field.i18n[locale][fieldName]!;
    }
    return field[fieldName] || '';
  }

  /**
   * 获取配置选项的本地化文本
   */
  public getLocalizedOptions(field: PluginConfigSchema, locale: string): string[] {
    if (field.i18n && field.i18n[locale] && field.i18n[locale].options) {
      return field.i18n[locale].options!;
    }
    return field.options || [];
  }
}

// 导出单例
const pluginConfigManager = new PluginConfigManager();
(window as any).pluginConfigManager = pluginConfigManager;

export default pluginConfigManager;
