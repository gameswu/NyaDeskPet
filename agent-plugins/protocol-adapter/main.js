/**
 * 协议适配插件 (Protocol Adapter Plugin)
 * 
 * 将 LLM 的纯文本回复和独立生成的 Live2D 动作指令
 * 转换为前端期望的结构化消息格式。
 * 
 * 对话 LLM 只输出纯文本，表情/动作由 expression-generator 插件
 * 通过独立 LLM 调用生成。本插件负责将两者组合为前端协议消息。
 * 
 * 输出消息类型：
 * - dialogue: 纯文字对话
 * - live2d: 动作/表情/参数控制
 * - sync_command: 组合指令（对话 + 动作同步下发）
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
   * 解析 LLM 纯文本回复（不再提取 XML 标签）
   * @param {string} rawText 
   * @param {string} [reasoningContent]
   * @returns {{ text: string, actions: Array, reasoningContent?: string }}
   */
  parseResponse(rawText, reasoningContent) {
    // 对话 LLM 现在只输出纯文本，无需提取任何标签
    const cleanText = rawText.replace(/\n{3,}/g, '\n\n').trim();
    return { text: cleanText, actions: [], reasoningContent };
  }

  /**
   * 将纯文本和动作列表组合为前端协议消息
   * 动作列表由 expression-generator 外部传入，不再从文本中提取
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
  static DEFAULT_PARAM_DURATION = 0;  // 0 = 前端自动计算
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
          weight: action.weight ?? ProtocolAdapterPlugin.DEFAULT_PARAM_WEIGHT,
          duration: action.duration ?? ProtocolAdapterPlugin.DEFAULT_PARAM_DURATION
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
