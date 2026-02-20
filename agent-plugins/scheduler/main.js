/**
 * Scheduler 插件 — 基于时间的任务调度
 *
 * 核心能力：
 * 1. 一次性任务 — 在指定时间点触发
 * 2. 周期性任务 — 按 cron 风格规则重复触发（简化版：间隔秒/分/时/日）
 * 3. Planning 集成 — 调度任务可触发 Planning 插件创建和执行计划
 * 4. 持久化 — 任务定义保存到磁盘，重启后自动恢复
 *
 * 注册工具：
 * - schedule_task: 创建调度任务（一次性或周期性）
 * - list_tasks: 列出所有调度任务
 * - cancel_task: 取消调度任务
 * - pause_task: 暂停周期性任务
 * - resume_task: 恢复已暂停的任务
 *
 * 服务 API（供其他插件调用）：
 * - scheduleOnce(name, delayMs, action): 一次性延迟任务
 * - scheduleRepeat(name, intervalMs, action): 周期性任务
 * - scheduleAt(name, dateTime, action): 在指定时间执行
 * - cancelTask(taskId): 取消任务
 * - getTask(taskId): 获取任务
 * - getAllTasks(): 获取所有任务
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');
const fs = require('fs');
const path = require('path');

// ==================== 常量 ====================

const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  PAUSED: 'paused'
};

const TASK_TYPE = {
  ONCE: 'once',
  REPEAT: 'repeat'
};

const INTERVAL_UNITS = {
  s: 1000,
  sec: 1000,
  second: 1000,
  seconds: 1000,
  m: 60 * 1000,
  min: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  h: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000
};

const TASKS_FILE = 'tasks.json';

let taskIdCounter = 0;

function generateTaskId() {
  return `task_${Date.now()}_${++taskIdCounter}`;
}

// ==================== 插件主类 ====================

class SchedulerPlugin extends AgentPlugin {

  /** @type {Map<string, ScheduledTask>} */
  tasks = new Map();

  /** 调度器定时器 */
  tickTimer = null;

  /** @type {import('../planning/main')|null} Planning 插件实例（懒加载） */
  planningPlugin = null;

  /** 配置 */
  maxTasks = 20;
  tickInterval = 30;
  taskMaxTokens = 1500;
  enablePlanningIntegration = true;
  persistTasks = true;

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.maxTasks) this.maxTasks = config.maxTasks;
    if (config.tickInterval) this.tickInterval = config.tickInterval;
    if (config.taskMaxTokens) this.taskMaxTokens = config.taskMaxTokens;
    if (config.enablePlanningIntegration !== undefined) this.enablePlanningIntegration = config.enablePlanningIntegration;
    if (config.persistTasks !== undefined) this.persistTasks = config.persistTasks;

    // 恢复持久化任务
    if (this.persistTasks) {
      this._loadTasks();
    }

    // ====== 注册工具 ======

    this.ctx.registerTool(
      {
        name: 'schedule_task',
        description: '创建一个调度任务。支持一次性延迟执行和周期性重复执行。任务触发时会通过 LLM 执行指定的动作描述。',
        i18n: {
          'zh-CN': { description: '创建一个调度任务。支持一次性延迟执行和周期性重复执行。' },
          'en-US': { description: 'Create a scheduled task. Supports one-time delayed and recurring execution.' }
        },
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '任务名称'
            },
            action: {
              type: 'string',
              description: '任务触发时要执行的动作描述（LLM 会根据此描述执行任务，如"提醒用户喝水"、"查询今日天气并汇报"）'
            },
            delay: {
              type: 'string',
              description: '延迟时间（一次性任务）。格式: 数字+单位，如 "30s"、"5m"、"2h"、"1d"。也可用 "at:2026-02-20T15:00:00" 指定具体时间'
            },
            interval: {
              type: 'string',
              description: '重复间隔（周期性任务，与 delay 二选一）。格式同 delay，如 "30m" 表示每 30 分钟执行一次'
            },
            usePlanning: {
              type: 'boolean',
              description: '是否使用 Planning 插件创建计划来执行此任务（适合复杂任务，默认 false）'
            },
            maxRuns: {
              type: 'number',
              description: '周期性任务的最大执行次数（可选，不填则无限重复直到取消）'
            }
          },
          required: ['name', 'action']
        }
      },
      async (args) => this._handleScheduleTask(args)
    );

    this.ctx.registerTool(
      {
        name: 'list_tasks',
        description: '列出所有调度任务及其状态、下次执行时间等信息。',
        i18n: {
          'zh-CN': { description: '列出所有调度任务及其状态。' },
          'en-US': { description: 'List all scheduled tasks and their status.' }
        },
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      async () => this._handleListTasks()
    );

    this.ctx.registerTool(
      {
        name: 'cancel_task',
        description: '取消指定的调度任务。已取消的任务不会再执行。',
        i18n: {
          'zh-CN': { description: '取消指定的调度任务。' },
          'en-US': { description: 'Cancel a scheduled task.' }
        },
        parameters: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: '任务 ID'
            }
          },
          required: ['taskId']
        }
      },
      async (args) => this._handleCancelTask(args)
    );

    this.ctx.registerTool(
      {
        name: 'pause_task',
        description: '暂停周期性调度任务。暂停期间不会触发执行，可通过 resume_task 恢复。',
        i18n: {
          'zh-CN': { description: '暂停周期性调度任务。' },
          'en-US': { description: 'Pause a recurring scheduled task.' }
        },
        parameters: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: '任务 ID'
            }
          },
          required: ['taskId']
        }
      },
      async (args) => this._handlePauseTask(args)
    );

    this.ctx.registerTool(
      {
        name: 'resume_task',
        description: '恢复已暂停的调度任务。',
        i18n: {
          'zh-CN': { description: '恢复已暂停的调度任务。' },
          'en-US': { description: 'Resume a paused scheduled task.' }
        },
        parameters: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: '任务 ID'
            }
          },
          required: ['taskId']
        }
      },
      async (args) => this._handleResumeTask(args)
    );

    // 启动调度器
    this._startTicker();

    this.ctx.logger.info(`Scheduler 插件已初始化 (间隔: ${this.tickInterval}s, 最大任务: ${this.maxTasks})`);
  }

  async terminate() {
    this._stopTicker();

    this.ctx.unregisterTool('schedule_task');
    this.ctx.unregisterTool('list_tasks');
    this.ctx.unregisterTool('cancel_task');
    this.ctx.unregisterTool('pause_task');
    this.ctx.unregisterTool('resume_task');

    // 持久化
    if (this.persistTasks) {
      this._saveTasks();
    }

    this.tasks.clear();
    this.planningPlugin = null;
    this.ctx.logger.info('Scheduler 插件已停止');
  }

  // ==================== 服务 API ====================

  /**
   * 创建一次性延迟任务
   * @param {string} name 任务名称
   * @param {number} delayMs 延迟毫秒
   * @param {string} action 动作描述
   * @returns {{success: boolean, taskId?: string, error?: string}}
   */
  scheduleOnce(name, delayMs, action) {
    return this._createTask({
      name,
      action,
      type: TASK_TYPE.ONCE,
      nextRunAt: Date.now() + delayMs,
      intervalMs: 0
    });
  }

  /**
   * 创建周期性任务
   * @param {string} name 任务名称
   * @param {number} intervalMs 间隔毫秒
   * @param {string} action 动作描述
   * @param {number} [maxRuns] 最大执行次数（可选）
   * @returns {{success: boolean, taskId?: string, error?: string}}
   */
  scheduleRepeat(name, intervalMs, action, maxRuns) {
    return this._createTask({
      name,
      action,
      type: TASK_TYPE.REPEAT,
      nextRunAt: Date.now() + intervalMs,
      intervalMs,
      maxRuns: maxRuns || 0
    });
  }

  /**
   * 在指定时间执行一次性任务
   * @param {string} name 任务名称
   * @param {Date|number} dateTime 执行时间
   * @param {string} action 动作描述
   * @returns {{success: boolean, taskId?: string, error?: string}}
   */
  scheduleAt(name, dateTime, action) {
    const timestamp = dateTime instanceof Date ? dateTime.getTime() : dateTime;
    if (timestamp <= Date.now()) {
      return { success: false, error: '指定时间已过去' };
    }
    return this._createTask({
      name,
      action,
      type: TASK_TYPE.ONCE,
      nextRunAt: timestamp,
      intervalMs: 0
    });
  }

  /**
   * 取消任务
   * @param {string} taskId
   * @returns {{success: boolean, error?: string}}
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, error: `任务不存在: ${taskId}` };
    if (task.status === TASK_STATUS.CANCELLED || task.status === TASK_STATUS.COMPLETED) {
      return { success: false, error: `任务已是终态: ${task.status}` };
    }
    task.status = TASK_STATUS.CANCELLED;
    this._persistIfEnabled();
    return { success: true };
  }

  /**
   * 获取任务
   * @param {string} taskId
   * @returns {object|null}
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 获取所有任务
   * @returns {object[]}
   */
  getAllTasks() {
    const result = [];
    for (const [, task] of this.tasks) {
      result.push({ ...task });
    }
    return result;
  }

  // ==================== 工具处理器 ====================

  async _handleScheduleTask(args) {
    const { name, action, delay, interval, usePlanning, maxRuns } = args;

    if (!name || !action) {
      return { toolCallId: '', content: '错误: 缺少 name 或 action 参数', success: false };
    }

    if (!delay && !interval) {
      return { toolCallId: '', content: '错误: 必须指定 delay（一次性）或 interval（周期性）', success: false };
    }

    let type, nextRunAt, intervalMs;

    if (interval) {
      // 周期性任务
      type = TASK_TYPE.REPEAT;
      intervalMs = this._parseTimeString(interval);
      if (!intervalMs) {
        return { toolCallId: '', content: `错误: 无法解析间隔时间 "${interval}"。格式: 数字+单位（s/m/h/d），如 "30m"`, success: false };
      }
      nextRunAt = Date.now() + intervalMs;
    } else {
      // 一次性任务
      type = TASK_TYPE.ONCE;
      intervalMs = 0;

      if (delay.startsWith('at:')) {
        // 指定时间
        const dateStr = delay.slice(3).trim();
        const timestamp = new Date(dateStr).getTime();
        if (isNaN(timestamp)) {
          return { toolCallId: '', content: `错误: 无法解析时间 "${dateStr}"`, success: false };
        }
        if (timestamp <= Date.now()) {
          return { toolCallId: '', content: '错误: 指定时间已过去', success: false };
        }
        nextRunAt = timestamp;
      } else {
        const delayMs = this._parseTimeString(delay);
        if (!delayMs) {
          return { toolCallId: '', content: `错误: 无法解析延迟时间 "${delay}"。格式: 数字+单位（s/m/h/d），如 "5m"`, success: false };
        }
        nextRunAt = Date.now() + delayMs;
      }
    }

    const result = this._createTask({
      name,
      action,
      type,
      nextRunAt,
      intervalMs,
      usePlanning: usePlanning || false,
      maxRuns: maxRuns || 0
    });

    if (!result.success) {
      return { toolCallId: '', content: `创建任务失败: ${result.error}`, success: false };
    }

    const task = this.tasks.get(result.taskId);
    const nextRunStr = new Date(task.nextRunAt).toLocaleString('zh-CN');
    const typeLabel = type === TASK_TYPE.REPEAT
      ? `周期性 (每 ${this._formatDuration(intervalMs)})${maxRuns ? ` 最多 ${maxRuns} 次` : ''}`
      : '一次性';

    return {
      toolCallId: '',
      content: `已创建调度任务:\n  名称: ${name}\n  ID: ${result.taskId}\n  类型: ${typeLabel}\n  下次执行: ${nextRunStr}\n  动作: ${action}${usePlanning ? '\n  模式: Planning 计划执行' : ''}`,
      success: true
    };
  }

  async _handleListTasks() {
    if (this.tasks.size === 0) {
      return { toolCallId: '', content: '当前没有调度任务', success: true };
    }

    const lines = [];
    for (const [, task] of this.tasks) {
      const nextRunStr = task.nextRunAt ? new Date(task.nextRunAt).toLocaleString('zh-CN') : '-';
      const typeLabel = task.type === TASK_TYPE.REPEAT
        ? `周期 (${this._formatDuration(task.intervalMs)})`
        : '一次性';
      let line = `- ${task.id}: "${task.name}" [${task.status}] ${typeLabel}`;
      if (task.status === TASK_STATUS.PENDING || task.status === TASK_STATUS.PAUSED) {
        line += ` | 下次: ${nextRunStr}`;
      }
      if (task.runCount > 0) {
        line += ` | 已执行 ${task.runCount} 次`;
      }
      lines.push(line);
    }

    return {
      toolCallId: '',
      content: `调度任务 (${this.tasks.size}/${this.maxTasks}):\n${lines.join('\n')}`,
      success: true
    };
  }

  async _handleCancelTask(args) {
    if (!args.taskId) {
      return { toolCallId: '', content: '错误: 缺少 taskId 参数', success: false };
    }
    const result = this.cancelTask(args.taskId);
    if (!result.success) {
      return { toolCallId: '', content: result.error, success: false };
    }
    return { toolCallId: '', content: `任务 ${args.taskId} 已取消`, success: true };
  }

  async _handlePauseTask(args) {
    if (!args.taskId) {
      return { toolCallId: '', content: '错误: 缺少 taskId 参数', success: false };
    }
    const task = this.tasks.get(args.taskId);
    if (!task) {
      return { toolCallId: '', content: `任务不存在: ${args.taskId}`, success: false };
    }
    if (task.type !== TASK_TYPE.REPEAT) {
      return { toolCallId: '', content: '只有周期性任务可以暂停', success: false };
    }
    if (task.status !== TASK_STATUS.PENDING) {
      return { toolCallId: '', content: `任务当前状态 ${task.status}，无法暂停`, success: false };
    }
    task.status = TASK_STATUS.PAUSED;
    this._persistIfEnabled();
    return { toolCallId: '', content: `任务 ${args.taskId} 已暂停`, success: true };
  }

  async _handleResumeTask(args) {
    if (!args.taskId) {
      return { toolCallId: '', content: '错误: 缺少 taskId 参数', success: false };
    }
    const task = this.tasks.get(args.taskId);
    if (!task) {
      return { toolCallId: '', content: `任务不存在: ${args.taskId}`, success: false };
    }
    if (task.status !== TASK_STATUS.PAUSED) {
      return { toolCallId: '', content: `任务当前状态 ${task.status}，无法恢复`, success: false };
    }
    task.status = TASK_STATUS.PENDING;
    task.nextRunAt = Date.now() + task.intervalMs;
    this._persistIfEnabled();
    const nextRunStr = new Date(task.nextRunAt).toLocaleString('zh-CN');
    return { toolCallId: '', content: `任务 ${args.taskId} 已恢复，下次执行: ${nextRunStr}`, success: true };
  }

  // ==================== 内部方法 ====================

  /**
   * 创建任务内部实现
   */
  _createTask({ name, action, type, nextRunAt, intervalMs, usePlanning, maxRuns }) {
    if (this.tasks.size >= this.maxTasks) {
      return { success: false, error: `任务数量已达上限 (${this.maxTasks})` };
    }

    const taskId = generateTaskId();
    const task = {
      id: taskId,
      name,
      action,
      type,
      status: TASK_STATUS.PENDING,
      nextRunAt,
      intervalMs: intervalMs || 0,
      usePlanning: usePlanning || false,
      maxRuns: maxRuns || 0,
      runCount: 0,
      lastRunAt: null,
      lastResult: null,
      createdAt: Date.now()
    };

    this.tasks.set(taskId, task);
    this._persistIfEnabled();
    this.ctx.logger.info(`已创建调度任务 ${taskId}: "${name}" (${type})`);

    return { success: true, taskId };
  }

  /**
   * 启动调度器定时器
   */
  _startTicker() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this._tick(), this.tickInterval * 1000);
    this.ctx.logger.info(`调度器已启动 (间隔: ${this.tickInterval}s)`);
  }

  /**
   * 停止调度器定时器
   */
  _stopTicker() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      this.ctx.logger.info('调度器已停止');
    }
  }

  /**
   * 调度器心跳：检查并执行到期任务
   */
  async _tick() {
    const now = Date.now();

    for (const [, task] of this.tasks) {
      if (task.status !== TASK_STATUS.PENDING) continue;
      if (task.nextRunAt > now) continue;

      // 任务到期，执行
      this._executeTask(task).catch(err => {
        this.ctx.logger.error(`任务 ${task.id} 执行异常: ${err.message}`);
      });
    }
  }

  /**
   * 执行到期任务
   * @param {object} task
   */
  async _executeTask(task) {
    task.status = TASK_STATUS.RUNNING;
    task.lastRunAt = Date.now();
    task.runCount++;

    this.ctx.logger.info(`执行调度任务 ${task.id}: "${task.name}" (第 ${task.runCount} 次)`);

    try {
      let result;

      if (task.usePlanning && this.enablePlanningIntegration) {
        result = await this._executeWithPlanning(task);
      } else {
        result = await this._executeDirect(task);
      }

      task.lastResult = result;

      // 判定后续状态
      if (task.type === TASK_TYPE.ONCE) {
        task.status = TASK_STATUS.COMPLETED;
      } else if (task.type === TASK_TYPE.REPEAT) {
        if (task.maxRuns > 0 && task.runCount >= task.maxRuns) {
          task.status = TASK_STATUS.COMPLETED;
          this.ctx.logger.info(`周期任务 ${task.id} 已达最大执行次数 (${task.maxRuns})，标记为完成`);
        } else {
          task.status = TASK_STATUS.PENDING;
          task.nextRunAt = Date.now() + task.intervalMs;
        }
      }

      this._persistIfEnabled();
      this.ctx.logger.info(`任务 ${task.id} 执行完成`);
    } catch (error) {
      task.status = task.type === TASK_TYPE.REPEAT ? TASK_STATUS.PENDING : TASK_STATUS.FAILED;
      task.lastResult = `执行失败: ${error.message}`;

      if (task.type === TASK_TYPE.REPEAT) {
        task.nextRunAt = Date.now() + task.intervalMs;
        this.ctx.logger.warn(`周期任务 ${task.id} 本次执行失败，将在下个周期重试: ${error.message}`);
      } else {
        this.ctx.logger.error(`任务 ${task.id} 执行失败: ${error.message}`);
      }

      this._persistIfEnabled();
    }
  }

  /**
   * 直接通过 LLM 执行任务
   * @param {object} task
   * @returns {Promise<string>}
   */
  async _executeDirect(task) {
    const prompt = `你需要执行以下定时任务:\n\n任务名称: ${task.name}\n任务描述: ${task.action}\n当前时间: ${new Date().toLocaleString('zh-CN')}\n执行次数: 第 ${task.runCount} 次\n\n请执行此任务并给出结果。`;

    const response = await this.ctx.callProvider('primary', {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: this.taskMaxTokens
    });

    return response.text;
  }

  /**
   * 通过 Planning 插件执行任务
   * @param {object} task
   * @returns {Promise<string>}
   */
  async _executeWithPlanning(task) {
    // 懒加载 Planning 插件
    if (!this.planningPlugin) {
      this.planningPlugin = this.ctx.getPluginInstance('planning');
    }

    if (!this.planningPlugin || !this.planningPlugin.createPlan) {
      this.ctx.logger.warn('Planning 插件不可用，回退到直接 LLM 执行');
      return this._executeDirect(task);
    }

    const context = `这是一个定时任务（第 ${task.runCount} 次执行），当前时间: ${new Date().toLocaleString('zh-CN')}`;
    const planResult = await this.planningPlugin.createPlan(task.action, context);

    if (!planResult.success) {
      this.ctx.logger.warn(`Planning 创建计划失败，回退到直接执行: ${planResult.error}`);
      return this._executeDirect(task);
    }

    const execResult = await this.planningPlugin.executePlan(planResult.plan.id);

    if (execResult.success) {
      const summary = execResult.results
        .map(r => `步骤 ${r.step}: ${r.result || '(无结果)'}`)
        .join('\n');
      return `通过计划执行完成 (${planResult.plan.id}):\n${summary}`;
    } else {
      return `计划执行部分失败: ${execResult.error || '部分步骤出错'}`;
    }
  }

  // ==================== 时间解析 ====================

  /**
   * 解析时间字符串（如 "30s", "5m", "2h", "1d"）
   * @param {string} str
   * @returns {number|null} 毫秒数，无效返回 null
   */
  _parseTimeString(str) {
    if (!str || typeof str !== 'string') return null;

    const match = str.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
    if (!match) {
      // 尝试纯数字（默认秒）
      const num = parseFloat(str);
      if (!isNaN(num) && num > 0) return num * 1000;
      return null;
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    if (isNaN(value) || value <= 0) return null;

    const multiplier = INTERVAL_UNITS[unit];
    if (!multiplier) return null;

    return Math.round(value * multiplier);
  }

  /**
   * 格式化毫秒为可读字符串
   * @param {number} ms
   * @returns {string}
   */
  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(0)}m`;
    if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
    return `${(ms / 86400000).toFixed(1)}d`;
  }

  // ==================== 持久化 ====================

  /**
   * 保存任务到磁盘
   */
  _saveTasks() {
    try {
      const dataPath = this.ctx.getDataPath();
      const filePath = path.join(dataPath, TASKS_FILE);

      // 只保存非终态任务（pending / paused / running）
      const tasksToSave = [];
      for (const [, task] of this.tasks) {
        if (task.status === TASK_STATUS.PENDING || task.status === TASK_STATUS.PAUSED) {
          tasksToSave.push({ ...task });
        }
      }

      fs.writeFileSync(filePath, JSON.stringify(tasksToSave, null, 2), 'utf-8');
      this.ctx.logger.debug(`已保存 ${tasksToSave.length} 个任务到磁盘`);
    } catch (error) {
      this.ctx.logger.error(`保存任务失败: ${error.message}`);
    }
  }

  /**
   * 从磁盘恢复任务
   */
  _loadTasks() {
    try {
      const dataPath = this.ctx.getDataPath();
      const filePath = path.join(dataPath, TASKS_FILE);

      if (!fs.existsSync(filePath)) return;

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(data)) return;

      let restored = 0;
      for (const taskData of data) {
        if (!taskData.id || !taskData.name || !taskData.action) continue;

        // 一次性已过期任务跳过
        if (taskData.type === TASK_TYPE.ONCE && taskData.nextRunAt <= Date.now()) {
          this.ctx.logger.info(`跳过已过期的一次性任务: ${taskData.name}`);
          continue;
        }

        // 周期性任务重新计算下次执行时间
        if (taskData.type === TASK_TYPE.REPEAT && taskData.nextRunAt <= Date.now()) {
          taskData.nextRunAt = Date.now() + (taskData.intervalMs || 60000);
        }

        // 恢复 running 状态为 pending
        if (taskData.status === TASK_STATUS.RUNNING) {
          taskData.status = TASK_STATUS.PENDING;
        }

        this.tasks.set(taskData.id, taskData);
        restored++;
      }

      if (restored > 0) {
        this.ctx.logger.info(`已从磁盘恢复 ${restored} 个调度任务`);
      }
    } catch (error) {
      this.ctx.logger.error(`恢复任务失败: ${error.message}`);
    }
  }

  /**
   * 条件持久化
   */
  _persistIfEnabled() {
    if (this.persistTasks) {
      this._saveTasks();
    }
  }
}

module.exports = SchedulerPlugin;
module.exports.default = SchedulerPlugin;