/**
 * 人格管理插件 (Personality Plugin)
 * 
 * 构建结构化的系统提示词（System Prompt），整合：
 * - 默认基础人格
 * - 用户自定义人格（来自前端 character_info）
 * - 模型能力信息（可用的动作、表情、参数）
 * - 输出格式规范（指导 LLM 输出可解析的结构化回复）
 * 
 * 暴露服务（supply service）供其他插件调用：
 * - buildSystemPrompt()
 * - setModelInfo(info)
 * - setCharacterInfo(info)
 * - setToolsHint(hint)
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

class PersonalityPlugin extends AgentPlugin {

  /** 默认基础人格 */
  defaultPersonality = '你是一个可爱的桌面宠物助手。你活泼开朗，喜欢和用户互动。你会根据对话内容做出各种表情和动作来回应用户。';

  /** 是否在系统提示词中包含模型能力信息 */
  includeModelCapabilities = true;

  /** 是否在系统提示词中包含回复格式规范 */
  includeResponseFormat = true;

  /** 自定义回复格式提示词（空字符串使用内置默认） */
  responseFormatPrompt = '';

  /** 自定义工具使用引导提示词（空字符串使用内置默认） */
  toolsGuidancePrompt = '';

  /** 当前模型能力信息 */
  modelInfo = null;

  /** 当前角色信息 */
  characterInfo = null;

  /** 可用工具描述 */
  availableToolsHint = '';

  async initialize() {
    // 从插件配置中读取
    const config = this.ctx.getConfig();
    if (config.defaultPersonality) {
      this.defaultPersonality = config.defaultPersonality;
    }
    if (config.includeModelCapabilities !== undefined) {
      this.includeModelCapabilities = config.includeModelCapabilities;
    }
    if (config.includeResponseFormat !== undefined) {
      this.includeResponseFormat = config.includeResponseFormat;
    }
    if (config.responseFormatPrompt) {
      this.responseFormatPrompt = config.responseFormatPrompt;
    }
    if (config.toolsGuidancePrompt) {
      this.toolsGuidancePrompt = config.toolsGuidancePrompt;
    }

    // 注册一个工具：让 LLM 可以动态修改人格
    this.ctx.registerTool(
      {
        name: 'set_personality',
        description: '临时修改桌宠的人格设定（仅在当前会话有效）。可以用来扮演不同角色。',
        i18n: {
          'zh-CN': { description: '临时修改桌宠的人格设定（仅在当前会话有效）。可以用来扮演不同角色。' },
          'en-US': { description: 'Temporarily modify the desktop pet personality (only effective in current session). Can be used to play different roles.' }
        },
        parameters: {
          type: 'object',
          properties: {
            personality: {
              type: 'string',
              description: '新的人格描述文本'
            }
          },
          required: ['personality']
        }
      },
      async (args) => {
        if (args.personality) {
          this.defaultPersonality = args.personality;
          return { toolCallId: '', content: `人格已更新为: ${args.personality.slice(0, 50)}...`, success: true };
        }
        return { toolCallId: '', content: '缺少 personality 参数', success: false };
      }
    );

    this.ctx.logger.info('人格管理插件已初始化');
  }

  async terminate() {
    this.ctx.unregisterTool('set_personality');
    this.ctx.logger.info('人格管理插件已停止');
  }

  // ==================== 服务 API（供其他插件通过 getService 调用） ====================

  /**
   * 更新模型信息
   */
  setModelInfo(info) {
    this.modelInfo = info;
  }

  /**
   * 更新角色信息
   */
  setCharacterInfo(info) {
    this.characterInfo = info;
  }

  /**
   * 设置可用工具提示
   */
  setToolsHint(hint) {
    this.availableToolsHint = hint;
  }

  /**
   * 构建完整的系统提示词
   */
  buildSystemPrompt() {
    const sections = [];

    // Section 1: 人格与角色设定
    sections.push(this._buildPersonalitySection());

    // Section 2: 模型能力
    if (this.includeModelCapabilities && this.modelInfo) {
      sections.push(this._buildModelCapabilitiesSection());
    }

    // Section 3: 回复格式规范
    if (this.includeResponseFormat) {
      sections.push(this._buildResponseFormatSection());
    }

    // Section 4: 工具使用引导
    if (this.availableToolsHint) {
      sections.push(this._buildToolsGuidanceSection());
    }

    return sections.join('\n\n');
  }

  // ==================== 内部方法 ====================

  _buildPersonalitySection() {
    let personality;

    if (this.characterInfo?.useCustom && this.characterInfo.personality) {
      personality = this.characterInfo.personality;
      if (this.characterInfo.name) {
        personality = `你的名字是"${this.characterInfo.name}"。${personality}`;
      }
    } else {
      personality = this.defaultPersonality;
    }

    return `## 角色设定\n${personality}`;
  }

  _buildModelCapabilitiesSection() {
    if (!this.modelInfo) return '';

    const parts = ['## 你的身体能力（Live2D 模型）\n你拥有一个 Live2D 模型身体，能做出各种表情和动作。这些会由独立的表情系统根据你的对话内容自动生成，你完全不需要手动指定。'];

    // 触碰部位属于交互信息，对话 LLM 需要知道以便做出语言反应
    if (this.modelInfo.hitAreas && this.modelInfo.hitAreas.length > 0) {
      parts.push(`\n**可触碰部位**: ${this.modelInfo.hitAreas.join(', ')}`);
    }

    // 动作组、表情、参数等控制能力不在此暴露
    // 全部由 expression-generator 插件的独立 LLM 负责

    return parts.join('');
  }

  _buildResponseFormatSection() {
    if (this.responseFormatPrompt) {
      return this.responseFormatPrompt;
    }

    return `## 回复格式规范

请直接输出纯文字对话内容。你的表情、动作、身体姿态变化全部由独立的表情系统自动生成，你完全不需要也不应该手动控制。

重要规则：
- 只输出纯文字对话
- 禁止输出任何结构化控制指令或格式标记
- 通过文字本身的情感表达（如语气词、颜文字）来传达情绪
- 专注于对话质量和角色性格的表现`;
  }

  _buildToolsGuidanceSection() {
    if (this.toolsGuidancePrompt) {
      return this.toolsGuidancePrompt.replace('{tools}', this.availableToolsHint);
    }
    return `## 工具使用说明\n${this.availableToolsHint}\n\n当需要执行操作时，请通过 function calling 调用对应的工具。调用工具后，等待工具结果再继续回复用户。`;
  }
}

module.exports = PersonalityPlugin;
module.exports.default = PersonalityPlugin;
