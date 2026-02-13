/**
 * 会话抖动收集器 (Input Collector Plugin)
 * 
 * 解决问题：用户短时间内连续发送多条消息（如分多行输入），每条都触发独立的 LLM 调用，
 * 导致产生多个不完整的回复，浪费 token 且体验差。
 * 
 * 解决方案：在一个可配置的抖动窗口内收集所有输入，窗口结束后合并为一条消息再处理。
 * 
 * 工作原理：
 * 1. handler 或 core-agent 在处理 user_input 前调用 collectInput()
 * 2. collectInput() 返回一个 Promise，如果在 debounceMs 内有新输入到达：
 *    - 旧的 Promise 以 null 解析（表示"跳过此输入"）
 *    - 新输入合并到缓冲区
 * 3. 当 debounceMs 内无新输入（或达到 maxWaitMs），最新的 Promise 以合并文本解析
 * 
 * 暴露服务 API：
 * - collectInput(sessionId, text): Promise<string | null>
 *   返回 null 表示"此输入已被收集，不需处理"；返回 string 表示"合并完毕，请处理此文本"
 * - isEnabled(): boolean
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

class InputCollectorPlugin extends AgentPlugin {

  /** 是否启用 */
  enabled = true;
  /** 抖动等待时间 */
  debounceMs = 1500;
  /** 最大等待时间 */
  maxWaitMs = 10000;
  /** 合并分隔符 */
  separator = '\n';

  /**
   * 每个 session 的收集状态
   * @type {Map<string, {
   *   texts: string[],
   *   debounceTimer: NodeJS.Timeout | null,
   *   maxTimer: NodeJS.Timeout | null,
   *   firstInputTime: number,
   *   resolve: ((text: string) => void) | null,
   *   previousResolves: ((text: null) => void)[]
   * }>}
   */
  sessions = new Map();

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.enabled !== undefined) this.enabled = config.enabled;
    if (config.debounceMs) this.debounceMs = config.debounceMs;
    if (config.maxWaitMs) this.maxWaitMs = config.maxWaitMs;
    if (config.separator !== undefined) this.separator = config.separator;

    this.ctx.logger.info(`会话抖动收集器已初始化 (enabled=${this.enabled}, debounce=${this.debounceMs}ms, maxWait=${this.maxWaitMs}ms)`);
  }

  async terminate() {
    // 清理所有挂起的定时器和 Promise
    for (const [, state] of this.sessions) {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      if (state.maxTimer) clearTimeout(state.maxTimer);
      // 立即刷出所有挂起的回调
      if (state.resolve) {
        state.resolve(state.texts.join(this.separator));
      }
      for (const prev of state.previousResolves) {
        prev(null);
      }
    }
    this.sessions.clear();
    this.ctx.logger.info('会话抖动收集器已停止');
  }

  // ==================== 服务 API ====================

  /**
   * 是否启用
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * 收集输入
   * 
   * @param {string} sessionId 会话 ID
   * @param {string} text 用户输入文本
   * @returns {Promise<string | null>}
   *   - string: 合并完毕的文本，调用方应处理此文本
   *   - null: 此输入已被收集到缓冲区，调用方应跳过（不处理）
   */
  collectInput(sessionId, text) {
    if (!this.enabled || !text || !text.trim()) {
      // 未启用或空输入，直接返回原文本
      return Promise.resolve(text);
    }

    let state = this.sessions.get(sessionId);

    if (!state) {
      // 该 session 首次输入，创建状态
      state = {
        texts: [],
        debounceTimer: null,
        maxTimer: null,
        firstInputTime: Date.now(),
        resolve: null,
        previousResolves: []
      };
      this.sessions.set(sessionId, state);
    }

    // 追加文本
    state.texts.push(text);

    // 如果有之前等待中的 resolve，标记为"跳过"
    if (state.resolve) {
      state.previousResolves.push(state.resolve);
      state.resolve = null;
    }

    // 清除旧的 debounce 定时器
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    // 如果是首条消息，设置 maxWait 定时器
    if (state.texts.length === 1) {
      state.firstInputTime = Date.now();
      state.maxTimer = setTimeout(() => {
        this._flush(sessionId, 'maxWait');
      }, this.maxWaitMs);
    }

    // 检查是否已超过 maxWait（安全检查）
    const elapsed = Date.now() - state.firstInputTime;
    if (elapsed >= this.maxWaitMs) {
      return new Promise((resolve) => {
        state.resolve = resolve;
        this._flush(sessionId, 'maxWait-immediate');
      });
    }

    // 创建新的 Promise 并设置 debounce 定时器
    return new Promise((resolve) => {
      state.resolve = resolve;

      state.debounceTimer = setTimeout(() => {
        this._flush(sessionId, 'debounce');
      }, this.debounceMs);
    });
  }

  /**
   * 刷出收集的输入
   */
  _flush(sessionId, reason) {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    // 清理定时器
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    if (state.maxTimer) {
      clearTimeout(state.maxTimer);
      state.maxTimer = null;
    }

    // 合并文本
    const merged = state.texts.join(this.separator);
    const count = state.texts.length;

    if (count > 1) {
      this.ctx.logger.info(`收集器合并了 ${count} 条消息 (${reason}): "${merged.slice(0, 100)}..."`);
    }

    // 解析之前的 resolve 为 null（跳过）
    for (const prev of state.previousResolves) {
      prev(null);
    }

    // 解析当前 resolve 为合并文本
    if (state.resolve) {
      state.resolve(merged);
    }

    // 清除该 session 的状态
    this.sessions.delete(sessionId);
  }
}

module.exports = InputCollectorPlugin;
