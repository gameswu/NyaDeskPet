/**
 * 插件工具桥接 (Plugin Tool Bridge Plugin)
 * 
 * 将前端插件的能力自动转换为 Function Calling 工具定义，
 * 让 LLM 可以理解和调用这些插件功能。
 * 
 * 工作流程：
 * 1. 从前端收集已连接插件的 capabilities 和 metadata
 * 2. 从各插件目录读取 tools.json 工具定义（或自动生成通用 schema）
 * 3. 注册到 ToolManager
 * 4. LLM 调用工具时 → 通过 WebSocket 转发到前端 → 前端调用插件 → 返回结果
 * 
 * tools.json 格式：
 * [
 *   {
 *     "name": "tool_name",
 *     "description": "工具描述",
 *     "action": "pluginCapabilityName",
 *     "parameters": { ... OpenAI Function Calling schema ... },
 *     "defaults": { "key": "defaultValue" }  // 可选
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');
const { AgentPlugin } = require('../../dist/agent/agent-plugin');

/** 前端插件根目录（相对于本插件目录） */
const FRONTEND_PLUGINS_DIR = path.resolve(__dirname, '../../plugins');

class PluginToolBridgePlugin extends AgentPlugin {

  /** 已桥接的工具列表 Map<toolId, { toolId, pluginId, action, schema }> */
  bridgedTools = new Map();

  /**
   * 动态加载的动作映射 Map<toolName, { pluginId, action, defaults }>
   * 由 _loadToolDefinitions() 在注册工具时填充
   */
  actionMappings = new Map();

  /** pluginId → 目录绝对路径 的缓存 */
  pluginDirCache = new Map();

  /** 插件调用发送器 */
  invokeSender = null;

  async initialize() {
    this._buildPluginDirCache();
    this.ctx.logger.info('插件工具桥接已初始化');
  }

  async terminate() {
    this.unregisterAll();
    this.ctx.logger.info('插件工具桥接已停止');
  }

  // ==================== 服务 API ====================

  /**
   * 设置插件调用发送器
   */
  setInvokeSender(sender) {
    this.invokeSender = sender;
  }

  /**
   * 根据已连接的插件列表注册工具
   * @param {Array<{ pluginId: string, pluginName: string, capabilities: string[] }>} connectedPlugins
   */
  registerPluginTools(connectedPlugins) {
    this.unregisterAll();

    for (const plugin of connectedPlugins) {
      const toolDefs = this._loadToolDefinitions(plugin.pluginId);

      if (toolDefs) {
        for (const def of toolDefs) {
          // 构建 FC schema（name + description + parameters）
          const schema = {
            name: def.name,
            description: def.description,
            parameters: def.parameters
          };
          this._registerSingleTool(plugin.pluginId, schema);

          // 记录动作映射
          this.actionMappings.set(def.name, {
            pluginId: plugin.pluginId,
            action: def.action,
            defaults: def.defaults || {}
          });
        }
      } else {
        // 没有 tools.json，退化为通用 schema
        for (const capability of plugin.capabilities) {
          const schema = this._generateGenericSchema(plugin.pluginId, plugin.pluginName, capability);
          this._registerSingleTool(plugin.pluginId, schema);

          // 通用 schema 也要注册到 actionMappings，避免 _executePluginAction 中的 split 推断出错
          this.actionMappings.set(schema.name, {
            pluginId: plugin.pluginId,
            action: capability,
            defaults: {}
          });
        }
      }
    }

    this.ctx.logger.info(`已桥接 ${this.bridgedTools.size} 个插件工具`);
  }

  /**
   * 注销所有桥接工具
   */
  unregisterAll() {
    for (const [, tool] of this.bridgedTools) {
      this.ctx.unregisterTool(tool.schema.name);
    }
    this.bridgedTools.clear();
    this.actionMappings.clear();
  }

  /**
   * 获取已桥接工具数量
   */
  getBridgedToolCount() {
    return this.bridgedTools.size;
  }

  /**
   * 获取所有已桥接工具摘要
   */
  getBridgedTools() {
    return Array.from(this.bridgedTools.values());
  }

  // ==================== 内部方法 ====================

  /**
   * 扫描前端插件目录，构建 pluginId → 目录绝对路径 的缓存
   * 读取每个子目录的 metadata.json 获取 id 字段
   */
  _buildPluginDirCache() {
    this.pluginDirCache.clear();
    try {
      if (!fs.existsSync(FRONTEND_PLUGINS_DIR)) {
        this.ctx.logger.debug('前端插件目录不存在: ' + FRONTEND_PLUGINS_DIR);
        return;
      }
      const entries = fs.readdirSync(FRONTEND_PLUGINS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(FRONTEND_PLUGINS_DIR, entry.name, 'metadata.json');
        try {
          if (!fs.existsSync(metaPath)) continue;
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.id) {
            this.pluginDirCache.set(meta.id, path.join(FRONTEND_PLUGINS_DIR, entry.name));
          }
        } catch (_) {
          // 忽略无法解析的 metadata
        }
      }
      this.ctx.logger.debug(`已构建插件目录缓存: ${Array.from(this.pluginDirCache.entries()).map(([id, dir]) => `${id} → ${path.basename(dir)}`).join(', ')}`);
    } catch (err) {
      this.ctx.logger.warn('扫描前端插件目录失败: ' + err.message);
    }
  }

  /**
   * 从插件目录读取 tools.json 工具定义
   * @param {string} pluginId
   * @returns {Array|null} 工具定义数组，文件不存在或解析失败返回 null
   */
  _loadToolDefinitions(pluginId) {
    // 通过缓存查找插件实际目录
    let pluginDir = this.pluginDirCache.get(pluginId);
    if (!pluginDir) {
      // 缓存未命中，尝试重建
      this._buildPluginDirCache();
      pluginDir = this.pluginDirCache.get(pluginId);
    }
    if (!pluginDir) {
      this.ctx.logger.debug(`插件 ${pluginId} 未找到对应目录，将使用通用 schema`);
      return null;
    }

    const toolsPath = path.join(pluginDir, 'tools.json');
    try {
      if (!fs.existsSync(toolsPath)) {
        this.ctx.logger.debug(`插件 ${pluginId} 未提供 tools.json，将使用通用 schema`);
        return null;
      }
      const content = fs.readFileSync(toolsPath, 'utf-8');
      const defs = JSON.parse(content);
      if (!Array.isArray(defs)) {
        this.ctx.logger.warn(`插件 ${pluginId} 的 tools.json 格式无效（应为数组）`);
        return null;
      }
      this.ctx.logger.debug(`插件 ${pluginId} 加载了 ${defs.length} 个工具定义`);
      return defs;
    } catch (err) {
      this.ctx.logger.warn(`读取插件 ${pluginId} 的 tools.json 失败: ${err.message}`);
      return null;
    }
  }

  _registerSingleTool(pluginId, schema) {
    const toolId = `bridge_${pluginId}_${schema.name}`;

    const handler = async (args) => {
      return this._executePluginAction(schema.name, args);
    };

    this.ctx.registerTool(schema, handler);

    this.bridgedTools.set(toolId, { toolId, pluginId, action: schema.name, schema });
  }

  async _executePluginAction(toolName, args) {
    if (!this.invokeSender) {
      return { toolCallId: '', content: '插件调用系统未初始化', success: false };
    }

    // 从动态加载的映射中查找
    const mapping = this.actionMappings.get(toolName);
    let pluginId, action, params;
    if (mapping) {
      pluginId = mapping.pluginId;
      action = mapping.action;
      // 合并默认值：defaults 中的值作为兜底，args 中的值优先
      params = { ...mapping.defaults, ...args };
    } else {
      // 通用 schema 退化路径：从工具名推断插件 ID 和动作
      const parts = toolName.split('_');
      pluginId = parts[0];
      action = parts.slice(1).join('_');
      params = args;
    }

    return this._invokePlugin(pluginId, action, params);
  }

  /**
   * 统一的插件调用方法
   * @param {string} pluginId 
   * @param {string} action 
   * @param {object} params 
   */
  async _invokePlugin(pluginId, action, params) {
    try {
      const result = await this.invokeSender(pluginId, action, params);
      if (!result.success) {
        return { toolCallId: '', content: result.error || '插件执行失败', success: false };
      }
      const { text, images } = this._formatPluginResult(result);
      const toolResult = { toolCallId: '', content: text, success: true };
      if (images.length > 0) {
        toolResult.images = images;
      }
      return toolResult;
    } catch (error) {
      return { toolCallId: '', content: `插件调用失败: ${error.message}`, success: false };
    }
  }

  /**
   * 格式化插件结果，返回 { text, images }
   * 图片数据保留为 base64，由上层传递给多模态 LLM
   */
  _formatPluginResult(result) {
    const images = [];
    const text = this._extractContent(result.result, images);
    return { text, images };
  }

  /**
   * 递归提取插件结果中的文本和图片
   * @param {object} content - PluginResultContent
   * @param {Array} images - 收集的图片数组 [{ data, mimeType }]
   * @returns {string} 文本描述
   */
  _extractContent(content, images) {
    if (!content) return '执行成功（无返回数据）';

    switch (content.type) {
      case 'text':
        return content.content?.text || content.content?.output || JSON.stringify(content.content);
      case 'image': {
        const imgData = content.content;
        if (imgData?.data) {
          const formatToMime = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
          images.push({
            data: imgData.data,
            mimeType: formatToMime[imgData.format] || 'image/png'
          });
        }
        return `[图片: ${imgData?.filename || 'screenshot'}, ${imgData?.width || '?'}x${imgData?.height || '?'}]`;
      }
      case 'data':
        return JSON.stringify(content.content, null, 2);
      case 'mixed':
        if (Array.isArray(content.content)) {
          return content.content.map(item => this._extractContent(item, images)).join('\n');
        }
        return JSON.stringify(content.content);
      default:
        return JSON.stringify(content.content);
    }
  }

  _generateGenericSchema(pluginId, pluginName, capability) {
    return {
      name: `${pluginId}_${capability}`,
      description: `调用 ${pluginName} 插件的 ${capability} 功能`,
      parameters: {
        type: 'object',
        properties: {
          params: { type: 'string', description: '传递给插件的 JSON 格式参数' }
        },
        required: []
      }
    };
  }
}

module.exports = PluginToolBridgePlugin;
module.exports.default = PluginToolBridgePlugin;
