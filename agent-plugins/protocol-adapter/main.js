/**
 * 协议适配插件 (Protocol Adapter Plugin)
 * 
 * 将 LLM 的原始文本回复解析为前端期望的结构化消息格式。
 * 
 * LLM 回复中可能包含：
 * - 纯文本对话
 * - XML 风格的动作/表情/参数标签
 * 
 * 解析后输出：
 * - dialogue: 纯文字对话
 * - live2d: 动作/表情/参数控制
 * - sync_command: 组合指令
 * 
 * 标签格式：
 *   <expression id="happy" />
 *   <motion group="TapBody" index="0" />
 *   <param id="ParamEyeLOpen" value="0.5" />
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

class ProtocolAdapterPlugin extends AgentPlugin {

  /** 持续时间配置 */
  durationPerChar = 80;
  minDuration = 3000;
  maxDuration = 30000;

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.durationPerChar) this.durationPerChar = config.durationPerChar;
    if (config.minDuration) this.minDuration = config.minDuration;
    if (config.maxDuration) this.maxDuration = config.maxDuration;
    this.ctx.logger.info('协议适配插件已初始化');
  }

  async terminate() {
    this.ctx.logger.info('协议适配插件已停止');
  }

  // ==================== 服务 API ====================

  /**
   * 解析 LLM 原始回复文本
   * 提取 XML 标签中的动作指令，返回纯文本和动作列表
   * @param {string} rawText 
   * @param {string} [reasoningContent]
   * @returns {{ text: string, actions: Array, reasoningContent?: string }}
   */
  parseResponse(rawText, reasoningContent) {
    const actions = [];
    let cleanText = rawText;

    // 提取 <expression id="..." /> 标签
    const expressionRegex = /<expression\s+id\s*=\s*"([^"]+)"\s*\/?\s*>/gi;
    let match;
    while ((match = expressionRegex.exec(rawText)) !== null) {
      actions.push({
        type: 'expression',
        expressionId: match[1]
      });
    }
    cleanText = cleanText.replace(expressionRegex, '');

    // 提取 <motion group="..." index="..." /> 标签
    const motionRegex = /<motion\s+(?:group\s*=\s*"([^"]+)"\s*)?(?:index\s*=\s*"(\d+)"\s*)?(?:group\s*=\s*"([^"]+)"\s*)?(?:priority\s*=\s*"(\d+)"\s*)?\/?\s*>/gi;
    while ((match = motionRegex.exec(rawText)) !== null) {
      const group = match[1] || match[3];
      const index = match[2] ? parseInt(match[2], 10) : 0;
      const priority = match[4] ? parseInt(match[4], 10) : 2;
      if (group) {
        actions.push({ type: 'motion', group, index, priority });
      }
    }
    cleanText = cleanText.replace(/<motion\s+[^>]*\/?>/gi, '');

    // 提取 <param id="..." value="..." /> 标签
    const paramRegex = /<param\s+(?:id\s*=\s*"([^"]+)"\s*)?(?:value\s*=\s*"([^"]+)"\s*)?(?:id\s*=\s*"([^"]+)"\s*)?(?:weight\s*=\s*"([^"]+)"\s*)?\/?\s*>/gi;
    while ((match = paramRegex.exec(rawText)) !== null) {
      const id = match[1] || match[3];
      const value = match[2] ? parseFloat(match[2]) : undefined;
      const weight = match[4] ? parseFloat(match[4]) : undefined;
      if (id && value !== undefined) {
        actions.push({
          type: 'parameter',
          parameterId: id,
          value,
          weight: weight ?? 1.0
        });
      }
    }
    cleanText = cleanText.replace(/<param\s+[^>]*\/?>/gi, '');

    // 清理多余空行和首尾空白
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

    return { text: cleanText, actions, reasoningContent };
  }

  /**
   * 将解析结果转换为前端期望的协议消息列表
   * @param {{ text: string, actions: Array, reasoningContent?: string }} parsed
   * @returns {Array} OutgoingMessage[]
   */
  toOutgoingMessages(parsed) {
    const messages = [];

    if (parsed.actions.length === 0) {
      if (parsed.text) {
        messages.push({
          type: 'dialogue',
          data: {
            text: parsed.text,
            duration: this._calculateDuration(parsed.text),
            ...(parsed.reasoningContent ? { reasoningContent: parsed.reasoningContent } : {})
          }
        });
      }
    } else if (!parsed.text) {
      for (const action of parsed.actions) {
        messages.push(this._actionToLive2DMessage(action));
      }
    } else {
      const syncActions = [];

      for (const action of parsed.actions) {
        syncActions.push(this._actionToSyncAction(action));
      }

      syncActions.push({
        type: 'dialogue',
        text: parsed.text,
        duration: this._calculateDuration(parsed.text),
        waitComplete: false,
        ...(parsed.reasoningContent ? { reasoningContent: parsed.reasoningContent } : {})
      });

      messages.push({
        type: 'sync_command',
        data: { actions: syncActions }
      });
    }

    return messages;
  }

  // ==================== 内部方法 ====================

  /** 默认值常量 */
  static DEFAULT_MOTION_INDEX = 0;
  static DEFAULT_MOTION_PRIORITY = 2;
  static DEFAULT_PARAM_WEIGHT = 1.0;
  static DEFAULT_EXPRESSION_ID = 'default';

  /**
   * 提取动作公共字段
   * @param {object} action 
   * @returns {{ type: string, [key: string]: unknown }}
   */
  _extractActionFields(action) {
    switch (action.type) {
      case 'expression':
        return { type: 'expression', expressionId: action.expressionId };
      case 'motion':
        return {
          type: 'motion',
          group: action.group,
          index: action.index ?? ProtocolAdapterPlugin.DEFAULT_MOTION_INDEX,
          priority: action.priority ?? ProtocolAdapterPlugin.DEFAULT_MOTION_PRIORITY
        };
      case 'parameter':
        return {
          type: 'parameter',
          parameterId: action.parameterId,
          value: action.value,
          weight: action.weight ?? ProtocolAdapterPlugin.DEFAULT_PARAM_WEIGHT
        };
      default:
        return { type: 'expression', expressionId: ProtocolAdapterPlugin.DEFAULT_EXPRESSION_ID };
    }
  }

  _actionToLive2DMessage(action) {
    const fields = this._extractActionFields(action);
    return { type: 'live2d', data: { command: fields.type, ...fields } };
  }

  _actionToSyncAction(action) {
    const fields = this._extractActionFields(action);
    return { ...fields, waitComplete: false };
  }

  _calculateDuration(text) {
    return Math.min(this.maxDuration, Math.max(this.minDuration, text.length * this.durationPerChar));
  }
}

module.exports = ProtocolAdapterPlugin;
module.exports.default = ProtocolAdapterPlugin;
