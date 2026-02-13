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

// ==================== 重要参数列表 ====================

const IMPORTANT_PARAM_PREFIXES = [
  'ParamEyeLOpen', 'ParamEyeROpen',
  'ParamMouthOpenY', 'ParamMouthForm',
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamEyeBallX', 'ParamEyeBallY',
  'ParamBrowLY', 'ParamBrowRY',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'
];

class PersonalityPlugin extends AgentPlugin {

  /** 默认基础人格 */
  defaultPersonality = '你是一个可爱的桌面宠物助手，名叫"小喵"。你活泼开朗，说话带有猫咪的口癖（如"喵~"），喜欢和用户互动。你会根据对话内容做出各种表情和动作来回应用户。';

  /** 是否在系统提示词中包含模型能力信息 */
  includeModelCapabilities = true;

  /** 是否在系统提示词中包含回复格式规范 */
  includeResponseFormat = true;

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

    const parts = ['## 你的身体能力（Live2D 模型）\n以下是你可以执行的动作和表情：'];

    if (this.modelInfo.motions && Object.keys(this.modelInfo.motions).length > 0) {
      const motionList = Object.entries(this.modelInfo.motions)
        .map(([group, info]) => `  - ${group}（${info.count} 个变体）`)
        .join('\n');
      parts.push(`\n**可用动作组**:\n${motionList}`);
    }

    if (this.modelInfo.expressions && this.modelInfo.expressions.length > 0) {
      parts.push(`\n**可用表情**: ${this.modelInfo.expressions.join(', ')}`);
    }

    if (this.modelInfo.hitAreas && this.modelInfo.hitAreas.length > 0) {
      parts.push(`\n**可触碰部位**: ${this.modelInfo.hitAreas.join(', ')}`);
    }

    if (this.modelInfo.availableParameters && this.modelInfo.availableParameters.length > 0) {
      const importantParams = this.modelInfo.availableParameters
        .filter(p => IMPORTANT_PARAM_PREFIXES.some(prefix => p.id.startsWith(prefix)))
        .map(p => `  - ${p.id}: ${p.min} ~ ${p.max}（默认 ${p.default}）`)
        .join('\n');
      if (importantParams) {
        parts.push(`\n**可控参数（部分）**:\n${importantParams}`);
      }
    }

    return parts.join('');
  }

  _buildResponseFormatSection() {
    return `## 回复格式规范

你的回复可以包含文字对话和动作/表情指令。请按以下格式输出：

### 纯文字回复
直接输出对话文字即可。

### 带动作/表情的回复
在文字中使用 XML 标签来嵌入指令，格式如下：

**播放表情**:
<expression id="表情名称" />

**播放动作**:
<motion group="动作组名" index="0" />

**设置参数（精细控制）**:
<param id="ParamEyeLOpen" value="0.5" />

**组合使用示例**:
<expression id="happy" />
好开心能见到你喵~
<motion group="TapBody" index="0" />

注意事项：
- 标签应放在对话文字之前或之后，不要放在句子中间
- 表情和动作标签是可选的，大多数回复只需要纯文字
- 只在情感变化或需要强调时使用表情和动作
- 参数控制只在需要精细表达时使用（如眯眼、歪头等）`;
  }

  _buildToolsGuidanceSection() {
    return `## 工具使用说明\n${this.availableToolsHint}\n\n当需要执行操作时，请通过 function calling 调用对应的工具。调用工具后，等待工具结果再继续回复用户。`;
  }
}

module.exports = PersonalityPlugin;
module.exports.default = PersonalityPlugin;
