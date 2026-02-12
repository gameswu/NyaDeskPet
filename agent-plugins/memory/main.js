/**
 * 记忆管理插件 (Memory Plugin)
 * 
 * 提供会话分离的上下文管理和自动压缩汇总功能：
 * 1. 上下文窗口管理 — 跟踪每个会话的消息数量和 token 估算
 * 2. 自动压缩汇总 — 当上下文超过阈值时，调用 LLM 将早期历史压缩为摘要
 * 3. 摘要持久化 — 压缩后的摘要作为系统消息注入上下文
 * 
 * 注册工具：
 * - clear_memory: 清除当前会话的记忆摘要
 * - view_memory_stats: 查看记忆统计信息
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

// ==================== 默认配置 ====================

const DEFAULT_CONFIG = {
  recentMessageCount: 10,
  compressionThreshold: 20,
  maxTokenEstimate: 4000,
  compressionMaxTokens: 500,
  compressionPrompt: `请将以下对话历史压缩为一段简洁的摘要，保留关键信息（用户偏好、重要事实、对话主题等），忽略闲聊和重复内容。摘要应使用第三人称描述，字数控制在 300 字以内。

对话历史：
{history}

请输出摘要：`
};

class MemoryPlugin extends AgentPlugin {

  /** 记忆配置 */
  config = { ...DEFAULT_CONFIG };

  /** 会话记忆状态 Map<sessionId, { summary, lastCompressionAt, compressionCount }> */
  sessionMemories = new Map();

  async initialize() {
    // 从插件配置中读取覆盖
    const pluginConfig = this.ctx.getConfig();
    if (pluginConfig.recentMessageCount) this.config.recentMessageCount = pluginConfig.recentMessageCount;
    if (pluginConfig.compressionThreshold) this.config.compressionThreshold = pluginConfig.compressionThreshold;
    if (pluginConfig.maxTokenEstimate) this.config.maxTokenEstimate = pluginConfig.maxTokenEstimate;
    if (pluginConfig.compressionMaxTokens) this.config.compressionMaxTokens = pluginConfig.compressionMaxTokens;

    // 注册工具：清除记忆
    this.ctx.registerTool(
      {
        name: 'clear_memory',
        description: '清除当前会话的历史摘要记忆。清除后，AI 将忘记之前的对话总结。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: '要清除的会话 ID（可选，默认当前会话）'
            }
          },
          required: []
        }
      },
      async (args) => {
        const sid = args.sessionId || 'default';
        this.clearSessionMemory(sid);
        return { toolCallId: '', content: `会话 ${sid} 的记忆摘要已清除`, success: true };
      }
    );

    // 注册工具：查看记忆统计
    this.ctx.registerTool(
      {
        name: 'view_memory_stats',
        description: '查看记忆管理的统计信息，包括活跃会话数和压缩次数。',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      async () => {
        const stats = this.getStats();
        return {
          toolCallId: '',
          content: `记忆统计: ${stats.sessions} 个活跃会话, 共 ${stats.totalCompressions} 次压缩`,
          success: true
        };
      }
    );

    this.ctx.logger.info('记忆管理插件已初始化');
  }

  async terminate() {
    this.ctx.unregisterTool('clear_memory');
    this.ctx.unregisterTool('view_memory_stats');
    this.sessionMemories.clear();
    this.ctx.logger.info('记忆管理插件已停止');
  }

  // ==================== 服务 API ====================

  /**
   * 构建发送给 LLM 的消息列表
   * 
   * @param {string} sessionId 会话 ID
   * @param {object} sessions 会话管理器
   * @param {object|null} provider 用于压缩的 LLM Provider（可选）
   * @returns {Promise<Array>} 消息列表
   */
  async buildContextMessages(sessionId, sessions, provider) {
    const memory = this._getSessionMemory(sessionId);
    const fullHistory = sessions.getHistory(sessionId);
    const totalMessages = fullHistory.length;

    // 检查是否需要压缩
    if (provider && this._shouldCompress(totalMessages, fullHistory, memory)) {
      await this._compressHistory(sessionId, fullHistory, memory, provider);
    }

    const messages = [];

    // 注入历史摘要
    if (memory.summary) {
      messages.push({
        role: 'system',
        content: `[对话历史摘要]\n${memory.summary}`
      });
    }

    // 取近期消息
    if (totalMessages <= this.config.recentMessageCount) {
      messages.push(...fullHistory);
    } else {
      const recentMessages = fullHistory.slice(-this.config.recentMessageCount);
      messages.push(...recentMessages);
    }

    return messages;
  }

  /**
   * 清除会话记忆
   */
  clearSessionMemory(sessionId) {
    this.sessionMemories.delete(sessionId);
  }

  /**
   * 获取会话摘要
   */
  getSessionSummary(sessionId) {
    return this.sessionMemories.get(sessionId)?.summary ?? null;
  }

  /**
   * 手动设置会话摘要
   */
  setSessionSummary(sessionId, summary) {
    const memory = this._getSessionMemory(sessionId);
    memory.summary = summary;
  }

  /**
   * 获取记忆统计
   */
  getStats() {
    let totalCompressions = 0;
    for (const [, memory] of this.sessionMemories) {
      totalCompressions += memory.compressionCount;
    }
    return {
      sessions: this.sessionMemories.size,
      totalCompressions
    };
  }

  // ==================== 内部方法 ====================

  _getSessionMemory(sessionId) {
    let memory = this.sessionMemories.get(sessionId);
    if (!memory) {
      memory = {
        summary: null,
        lastCompressionAt: 0,
        compressionCount: 0
      };
      this.sessionMemories.set(sessionId, memory);
    }
    return memory;
  }

  _shouldCompress(totalMessages, history, memory) {
    if (totalMessages > this.config.compressionThreshold) {
      const newMessagesSinceCompression = totalMessages - memory.lastCompressionAt;
      if (newMessagesSinceCompression >= this.config.recentMessageCount) {
        return true;
      }
    }

    const estimatedTokens = this._estimateTokens(history);
    if (estimatedTokens > this.config.maxTokenEstimate) {
      return true;
    }

    return false;
  }

  _estimateTokens(messages) {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
    }
    return Math.ceil(totalChars * 1.5);
  }

  async _compressHistory(sessionId, fullHistory, memory, provider) {
    try {
      const messagesToCompress = fullHistory.slice(0, -this.config.recentMessageCount);
      if (messagesToCompress.length === 0) return;

      const historyText = messagesToCompress
        .map(m => `[${m.role}]: ${m.content}`)
        .join('\n');

      let compressionInput = historyText;
      if (memory.summary) {
        compressionInput = `[之前的对话摘要]: ${memory.summary}\n\n[新增的对话内容]:\n${historyText}`;
      }

      const prompt = this.config.compressionPrompt.replace('{history}', compressionInput);

      const request = {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: '你是一个对话摘要助手，请简洁准确地总结对话内容。',
        maxTokens: this.config.compressionMaxTokens
      };

      const response = await provider.chat(request);

      if (response.text) {
        memory.summary = response.text;
        memory.lastCompressionAt = fullHistory.length;
        memory.compressionCount++;
        this.ctx.logger.info(`会话 ${sessionId} 完成第 ${memory.compressionCount} 次压缩，摘要 ${response.text.length} 字`);
      }
    } catch (error) {
      this.ctx.logger.warn(`压缩失败: ${error.message}`);
    }
  }
}

module.exports = MemoryPlugin;
module.exports.default = MemoryPlugin;
