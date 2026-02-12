/**
 * 插件工具桥接 (Plugin Tool Bridge Plugin)
 * 
 * 将前端插件的能力自动转换为 Function Calling 工具定义，
 * 让 LLM 可以理解和调用这些插件功能。
 * 
 * 工作流程：
 * 1. 从前端收集已连接插件的 capabilities 和 metadata
 * 2. 为每个插件能力生成 ToolSchema（OpenAI Function Calling 格式）
 * 3. 注册到 ToolManager
 * 4. LLM 调用工具时 → 通过 WebSocket 转发到前端 → 前端调用插件 → 返回结果
 * 
 * 内置插件映射：
 * - terminal: execute(command, cwd) — 执行终端命令
 * - ui-automation: screenshot(), click(x, y), type(text) — UI 自动化
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

// ==================== 内置插件的工具定义 ====================

const BUILTIN_PLUGIN_TOOLS = {
  'terminal': [
    {
      name: 'terminal_execute',
      description: '在用户的终端中执行一条 Shell 命令。可以用来查看文件、安装软件、运行脚本等。注意：命令将在用户的操作系统上实际执行，请谨慎使用。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 Shell 命令' },
          cwd: { type: 'string', description: '命令执行的工作目录（可选，默认为用户主目录）' },
          timeout: { type: 'number', description: '命令超时时间（毫秒），默认 30000' }
        },
        required: ['command']
      }
    }
  ],
  'ui-automation': [
    {
      name: 'ui_screenshot',
      description: '对用户的屏幕进行截图。返回截图的 Base64 图片数据。',
      parameters: {
        type: 'object',
        properties: {
          region: { type: 'string', description: '截图区域（可选）：full（全屏）、active（活动窗口）' }
        },
        required: []
      }
    },
    {
      name: 'ui_click',
      description: '在屏幕上指定坐标执行鼠标点击。',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '点击的 X 坐标（像素）' },
          y: { type: 'number', description: '点击的 Y 坐标（像素）' },
          button: { type: 'string', description: '鼠标按钮：left（左键）、right（右键）、middle（中键）', enum: ['left', 'right', 'middle'] }
        },
        required: ['x', 'y']
      }
    },
    {
      name: 'ui_type_text',
      description: '在当前焦点位置输入文本。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要输入的文本' }
        },
        required: ['text']
      }
    }
  ]
};

/** 内置插件的动作映射 */
const ACTION_MAPPINGS = {
  'terminal_execute': {
    pluginId: 'terminal',
    action: 'execute',
    paramMapper: (args) => ({ command: args.command, cwd: args.cwd || undefined, timeout: args.timeout || 30000 })
  },
  'ui_screenshot': {
    pluginId: 'ui-automation',
    action: 'screenshot',
    paramMapper: (args) => ({ region: args.region || 'full' })
  },
  'ui_click': {
    pluginId: 'ui-automation',
    action: 'click',
    paramMapper: (args) => ({ x: args.x, y: args.y, button: args.button || 'left' })
  },
  'ui_type_text': {
    pluginId: 'ui-automation',
    action: 'typeText',
    paramMapper: (args) => ({ text: args.text })
  }
};

class PluginToolBridgePlugin extends AgentPlugin {

  /** 已桥接的工具列表 Map<toolId, { toolId, pluginId, action, schema }> */
  bridgedTools = new Map();

  /** 插件调用发送器 */
  invokeSender = null;

  async initialize() {
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
      const builtinSchemas = BUILTIN_PLUGIN_TOOLS[plugin.pluginId];

      if (builtinSchemas) {
        for (const schema of builtinSchemas) {
          this._registerSingleTool(plugin.pluginId, schema);
        }
      } else {
        for (const capability of plugin.capabilities) {
          const schema = this._generateGenericSchema(plugin.pluginId, plugin.pluginName, capability);
          this._registerSingleTool(plugin.pluginId, schema);
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

    const mapping = ACTION_MAPPINGS[toolName];
    if (!mapping) {
      const parts = toolName.split('_');
      const pluginId = parts[0];
      const action = parts.slice(1).join('_');

      try {
        const result = await this.invokeSender(pluginId, action, args);
        return { toolCallId: '', content: result.success ? this._formatPluginResult(result) : (result.error || '插件执行失败'), success: result.success };
      } catch (error) {
        return { toolCallId: '', content: `插件调用失败: ${error.message}`, success: false };
      }
    }

    try {
      const mappedParams = mapping.paramMapper(args);
      const result = await this.invokeSender(mapping.pluginId, mapping.action, mappedParams);
      return { toolCallId: '', content: result.success ? this._formatPluginResult(result) : (result.error || '插件执行失败'), success: result.success };
    } catch (error) {
      return { toolCallId: '', content: `插件调用失败: ${error.message}`, success: false };
    }
  }

  _formatPluginResult(result) {
    if (!result.result) return '执行成功（无返回数据）';

    switch (result.result.type) {
      case 'text':
        return result.result.content?.text || result.result.content?.output || JSON.stringify(result.result.content);
      case 'image':
        return `[图片: ${result.result.content?.filename || 'screenshot'}, ${result.result.content?.width}x${result.result.content?.height}]`;
      case 'data':
        return JSON.stringify(result.result.content, null, 2);
      case 'mixed':
        if (Array.isArray(result.result.content)) {
          return result.result.content.map(item => this._formatPluginResult({ success: true, result: item })).join('\n');
        }
        return JSON.stringify(result.result.content);
      default:
        return JSON.stringify(result.result.content);
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
