/**
 * Planning 插件 — 基于 LLM 的任务规划与 Sub-Agent 管理
 *
 * 核心能力：
 * 1. 任务规划 — 将复杂目标分解为多步骤计划
 * 2. 计划执行 — 按依赖顺序逐步执行，汇总结果
 * 3. Sub-Agent — 为特定步骤创建独立上下文代理，支持工具调用
 *
 * 注册工具：
 * - create_plan: 根据目标创建任务计划
 * - execute_plan: 执行/恢复指定计划
 * - view_plan: 查看计划状态
 * - cancel_plan: 取消计划
 * - create_sub_agent: 创建 Sub-Agent 执行特定任务
 * - list_sub_agents: 列出所有 Sub-Agent
 *
 * 服务 API（供其他插件调用）：
 * - createPlan(goal, context): 创建计划
 * - executePlan(planId): 执行计划
 * - getPlan(planId): 获取计划
 * - createSubAgent(name, task, systemPrompt): 创建 Sub-Agent
 * - runSubAgent(agentId, input): 运行 Sub-Agent
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

// ==================== 常量 ====================

const PLAN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

const STEP_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

const SUB_AGENT_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

const PLAN_SYSTEM_PROMPT = `你是一个任务规划助手。根据用户的目标，创建一个结构化的执行计划。

输出要求（严格 JSON 格式）：
{
  "title": "计划标题（简短描述）",
  "steps": [
    {
      "id": 1,
      "description": "步骤描述（具体、可执行的行动）",
      "dependencies": [],
      "needsSubAgent": false,
      "subAgentTask": ""
    }
  ]
}

规则：
1. 每个步骤必须是具体、可执行的行动，而非抽象描述
2. dependencies 填入依赖的步骤 id 数组（如 [1, 2] 表示依赖步骤 1 和 2）
3. 无依赖的步骤 dependencies 为空数组 []
4. 若步骤需要独立上下文处理（如复杂分析、长文本生成），将 needsSubAgent 设为 true 并填写 subAgentTask
5. 步骤数量不应超过限制
6. 只输出 JSON，不要包含任何其他文字`;

const STEP_EXECUTION_PROMPT = `你正在执行一个任务计划的某个步骤。

计划目标：{goal}
当前步骤：{step}
前置步骤结果：
{previousResults}

请执行当前步骤并给出结果。如果需要使用工具，请调用适当的工具。完成后请给出步骤执行结果的总结。`;

const SUB_AGENT_DEFAULT_PROMPT = `你是一个专注于特定任务的 Sub-Agent。你的任务是：

{task}

请专注于完成这个任务，给出完整、准确的结果。你可以使用可用的工具来辅助完成任务。`;

// ==================== 工具函数 ====================

let planIdCounter = 0;
let subAgentIdCounter = 0;

function generatePlanId() {
  return `plan_${Date.now()}_${++planIdCounter}`;
}

function generateSubAgentId() {
  return `agent_${Date.now()}_${++subAgentIdCounter}`;
}

// ==================== 插件主类 ====================

class PlanningPlugin extends AgentPlugin {

  /** @type {Map<string, Plan>} */
  plans = new Map();

  /** @type {Map<string, SubAgent>} */
  subAgents = new Map();

  /** 配置 */
  planMaxTokens = 2000;
  subAgentMaxTokens = 1500;
  maxPlanSteps = 10;
  maxSubAgents = 5;
  autoExecute = true;

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.planMaxTokens) this.planMaxTokens = config.planMaxTokens;
    if (config.subAgentMaxTokens) this.subAgentMaxTokens = config.subAgentMaxTokens;
    if (config.maxPlanSteps) this.maxPlanSteps = config.maxPlanSteps;
    if (config.maxSubAgents) this.maxSubAgents = config.maxSubAgents;
    if (config.autoExecute !== undefined) this.autoExecute = config.autoExecute;

    // ====== 注册工具 ======

    this.ctx.registerTool(
      {
        name: 'create_plan',
        description: '根据目标描述创建一个多步骤任务计划。LLM 会将复杂目标分解为可执行的步骤序列。',
        i18n: {
          'zh-CN': { description: '根据目标描述创建一个多步骤任务计划。LLM 会将复杂目标分解为可执行的步骤序列。' },
          'en-US': { description: 'Create a multi-step task plan from a goal. LLM decomposes complex goals into executable step sequences.' }
        },
        parameters: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: '任务目标描述'
            },
            context: {
              type: 'string',
              description: '附加上下文信息（可选，如背景知识、约束条件等）'
            }
          },
          required: ['goal']
        }
      },
      async (args) => this._handleCreatePlan(args)
    );

    this.ctx.registerTool(
      {
        name: 'execute_plan',
        description: '执行或恢复指定的任务计划。按步骤依赖顺序逐步执行，每个步骤通过 LLM 处理或委托给 Sub-Agent。',
        i18n: {
          'zh-CN': { description: '执行或恢复指定的任务计划。按步骤依赖顺序逐步执行。' },
          'en-US': { description: 'Execute or resume a task plan. Steps are executed in dependency order.' }
        },
        parameters: {
          type: 'object',
          properties: {
            planId: {
              type: 'string',
              description: '计划 ID'
            }
          },
          required: ['planId']
        }
      },
      async (args) => this._handleExecutePlan(args)
    );

    this.ctx.registerTool(
      {
        name: 'view_plan',
        description: '查看指定计划的当前状态，包括所有步骤的执行进度和结果。不指定 planId 则列出所有计划。',
        i18n: {
          'zh-CN': { description: '查看指定计划的当前状态。不指定 planId 则列出所有计划。' },
          'en-US': { description: 'View plan status. Omit planId to list all plans.' }
        },
        parameters: {
          type: 'object',
          properties: {
            planId: {
              type: 'string',
              description: '计划 ID（可选，不填则列出所有计划）'
            }
          },
          required: []
        }
      },
      async (args) => this._handleViewPlan(args)
    );

    this.ctx.registerTool(
      {
        name: 'cancel_plan',
        description: '取消指定的任务计划，停止所有未完成的步骤。',
        i18n: {
          'zh-CN': { description: '取消指定的任务计划，停止所有未完成的步骤。' },
          'en-US': { description: 'Cancel a task plan and stop all pending steps.' }
        },
        parameters: {
          type: 'object',
          properties: {
            planId: {
              type: 'string',
              description: '计划 ID'
            }
          },
          required: ['planId']
        }
      },
      async (args) => this._handleCancelPlan(args)
    );

    this.ctx.registerTool(
      {
        name: 'create_sub_agent',
        description: '创建一个 Sub-Agent 来执行特定任务。Sub-Agent 拥有独立的对话上下文，可以使用工具，适合处理需要独立上下文的复杂子任务。',
        i18n: {
          'zh-CN': { description: '创建一个 Sub-Agent 来执行特定任务。Sub-Agent 拥有独立的对话上下文，可以使用工具。' },
          'en-US': { description: 'Create a Sub-Agent for a specific task. Sub-Agents have independent context and can use tools.' }
        },
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Sub-Agent 名称（用于标识）'
            },
            task: {
              type: 'string',
              description: '分配给 Sub-Agent 的任务描述'
            },
            systemPrompt: {
              type: 'string',
              description: '自定义系统提示词（可选，不填使用默认模板）'
            }
          },
          required: ['name', 'task']
        }
      },
      async (args) => this._handleCreateSubAgent(args)
    );

    this.ctx.registerTool(
      {
        name: 'list_sub_agents',
        description: '列出所有已创建的 Sub-Agent 及其状态。',
        i18n: {
          'zh-CN': { description: '列出所有已创建的 Sub-Agent 及其状态。' },
          'en-US': { description: 'List all Sub-Agents and their status.' }
        },
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      async () => this._handleListSubAgents()
    );

    this.ctx.logger.info('Planning 插件已初始化');
  }

  async terminate() {
    this.ctx.unregisterTool('create_plan');
    this.ctx.unregisterTool('execute_plan');
    this.ctx.unregisterTool('view_plan');
    this.ctx.unregisterTool('cancel_plan');
    this.ctx.unregisterTool('create_sub_agent');
    this.ctx.unregisterTool('list_sub_agents');
    this.plans.clear();
    this.subAgents.clear();
    this.ctx.logger.info('Planning 插件已停止');
  }

  // ==================== 服务 API（供其他插件调用） ====================

  /**
   * 创建任务计划
   * @param {string} goal 任务目标
   * @param {string} [context] 附加上下文
   * @returns {Promise<{success: boolean, plan?: object, error?: string}>}
   */
  async createPlan(goal, context) {
    try {
      const planPrompt = context
        ? `目标: ${goal}\n\n附加上下文: ${context}\n\n步骤数量上限: ${this.maxPlanSteps}`
        : `目标: ${goal}\n\n步骤数量上限: ${this.maxPlanSteps}`;

      const response = await this.ctx.callProvider('primary', {
        messages: [{ role: 'user', content: planPrompt }],
        systemPrompt: PLAN_SYSTEM_PROMPT,
        maxTokens: this.planMaxTokens
      });

      const parsed = this._parsePlanResponse(response.text);
      if (!parsed) {
        return { success: false, error: 'LLM 返回的计划格式无效' };
      }

      // 限制步骤数
      if (parsed.steps.length > this.maxPlanSteps) {
        parsed.steps = parsed.steps.slice(0, this.maxPlanSteps);
      }

      const planId = generatePlanId();
      const plan = {
        id: planId,
        title: parsed.title || goal,
        goal,
        context: context || '',
        status: PLAN_STATUS.PENDING,
        steps: parsed.steps.map((s, i) => ({
          id: s.id || (i + 1),
          description: s.description,
          dependencies: s.dependencies || [],
          needsSubAgent: s.needsSubAgent || false,
          subAgentTask: s.subAgentTask || '',
          status: STEP_STATUS.PENDING,
          result: null,
          subAgentId: null
        })),
        createdAt: Date.now(),
        completedAt: null
      };

      this.plans.set(planId, plan);
      this.ctx.logger.info(`已创建计划 ${planId}: ${plan.title} (${plan.steps.length} 步)`);

      return { success: true, plan };
    } catch (error) {
      this.ctx.logger.error(`创建计划失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 执行计划
   * @param {string} planId 计划 ID
   * @returns {Promise<{success: boolean, results?: object[], error?: string}>}
   */
  async executePlan(planId) {
    const plan = this.plans.get(planId);
    if (!plan) {
      return { success: false, error: `计划不存在: ${planId}` };
    }
    if (plan.status === PLAN_STATUS.COMPLETED) {
      return { success: true, results: plan.steps.map(s => ({ step: s.id, result: s.result })) };
    }
    if (plan.status === PLAN_STATUS.CANCELLED) {
      return { success: false, error: '计划已被取消' };
    }

    plan.status = PLAN_STATUS.RUNNING;
    const results = [];

    try {
      // 按依赖顺序执行步骤
      const executionOrder = this._topologicalSort(plan.steps);

      for (const stepId of executionOrder) {
        const step = plan.steps.find(s => s.id === stepId);
        if (!step || step.status === STEP_STATUS.COMPLETED) continue;

        // 检查依赖是否都已完成
        const depsCompleted = step.dependencies.every(depId => {
          const dep = plan.steps.find(s => s.id === depId);
          return dep && dep.status === STEP_STATUS.COMPLETED;
        });

        if (!depsCompleted) {
          step.status = STEP_STATUS.SKIPPED;
          step.result = '依赖步骤未完成，已跳过';
          results.push({ step: step.id, status: STEP_STATUS.SKIPPED, result: step.result });
          continue;
        }

        step.status = STEP_STATUS.RUNNING;
        this.ctx.logger.info(`执行计划 ${planId} 步骤 ${step.id}: ${step.description}`);

        try {
          let result;

          if (step.needsSubAgent && step.subAgentTask) {
            // 通过 Sub-Agent 执行
            result = await this._executeStepWithSubAgent(plan, step);
          } else {
            // 直接通过 LLM 执行
            result = await this._executeStep(plan, step);
          }

          step.status = STEP_STATUS.COMPLETED;
          step.result = result;
          results.push({ step: step.id, status: STEP_STATUS.COMPLETED, result });
        } catch (error) {
          step.status = STEP_STATUS.FAILED;
          step.result = `执行失败: ${error.message}`;
          results.push({ step: step.id, status: STEP_STATUS.FAILED, result: step.result });
          this.ctx.logger.error(`步骤 ${step.id} 执行失败: ${error.message}`);
        }
      }

      // 判定计划最终状态
      const allCompleted = plan.steps.every(s => s.status === STEP_STATUS.COMPLETED);
      const anyFailed = plan.steps.some(s => s.status === STEP_STATUS.FAILED);

      if (allCompleted) {
        plan.status = PLAN_STATUS.COMPLETED;
        plan.completedAt = Date.now();
      } else if (anyFailed) {
        plan.status = PLAN_STATUS.FAILED;
      }

      this.ctx.logger.info(`计划 ${planId} 执行完毕: ${plan.status}`);
      return { success: !anyFailed, results };
    } catch (error) {
      plan.status = PLAN_STATUS.FAILED;
      this.ctx.logger.error(`计划 ${planId} 执行出错: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取计划信息
   * @param {string} planId
   * @returns {object|null}
   */
  getPlan(planId) {
    return this.plans.get(planId) || null;
  }

  /**
   * 获取所有计划摘要
   * @returns {object[]}
   */
  getAllPlans() {
    const result = [];
    for (const [, plan] of this.plans) {
      result.push({
        id: plan.id,
        title: plan.title,
        status: plan.status,
        stepCount: plan.steps.length,
        completedSteps: plan.steps.filter(s => s.status === STEP_STATUS.COMPLETED).length,
        createdAt: plan.createdAt
      });
    }
    return result;
  }

  /**
   * 创建 Sub-Agent
   * @param {string} name 名称
   * @param {string} task 任务描述
   * @param {string} [systemPrompt] 自定义系统提示词
   * @returns {{success: boolean, agentId?: string, error?: string}}
   */
  createSubAgent(name, task, systemPrompt) {
    if (this.subAgents.size >= this.maxSubAgents) {
      return { success: false, error: `Sub-Agent 数量已达上限 (${this.maxSubAgents})` };
    }

    const agentId = generateSubAgentId();
    const agent = {
      id: agentId,
      name,
      task,
      systemPrompt: systemPrompt || SUB_AGENT_DEFAULT_PROMPT.replace('{task}', task),
      status: SUB_AGENT_STATUS.IDLE,
      messages: [],
      result: null,
      createdAt: Date.now(),
      completedAt: null
    };

    this.subAgents.set(agentId, agent);
    this.ctx.logger.info(`已创建 Sub-Agent ${agentId}: ${name}`);

    return { success: true, agentId };
  }

  /**
   * 运行 Sub-Agent（发送消息并获取响应）
   * @param {string} agentId
   * @param {string} input 用户输入
   * @returns {Promise<{success: boolean, output?: string, error?: string}>}
   */
  async runSubAgent(agentId, input) {
    const agent = this.subAgents.get(agentId);
    if (!agent) {
      return { success: false, error: `Sub-Agent 不存在: ${agentId}` };
    }

    agent.status = SUB_AGENT_STATUS.RUNNING;
    agent.messages.push({ role: 'user', content: input });

    try {
      const request = {
        messages: [...agent.messages],
        systemPrompt: agent.systemPrompt,
        maxTokens: this.subAgentMaxTokens
      };

      // 如果工具可用，允许 Sub-Agent 使用
      if (this.ctx.isToolCallingEnabled() && this.ctx.hasEnabledTools()) {
        request.tools = this.ctx.getOpenAITools();
        request.toolChoice = 'auto';
      }

      let response;
      // 如果有工具，使用工具循环；否则直接调用
      if (request.tools && request.tools.length > 0) {
        // Sub-Agent 工具循环需要 MessageContext，此处构建一个最小化的
        const minimalMctx = this._createMinimalMctx(agentId);
        response = await this.ctx.executeWithToolLoop(request, minimalMctx);
      } else {
        response = await this.ctx.callProvider('primary', request);
      }

      agent.messages.push({ role: 'assistant', content: response.text });
      agent.status = SUB_AGENT_STATUS.COMPLETED;
      agent.result = response.text;
      agent.completedAt = Date.now();

      this.ctx.logger.info(`Sub-Agent ${agentId} 执行完成`);
      return { success: true, output: response.text };
    } catch (error) {
      agent.status = SUB_AGENT_STATUS.FAILED;
      agent.result = `执行失败: ${error.message}`;
      this.ctx.logger.error(`Sub-Agent ${agentId} 执行失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ==================== 工具处理器 ====================

  async _handleCreatePlan(args) {
    const { goal, context } = args;
    if (!goal) {
      return { toolCallId: '', content: '错误: 缺少 goal 参数', success: false };
    }

    const result = await this.createPlan(goal, context);

    if (!result.success) {
      return { toolCallId: '', content: `创建计划失败: ${result.error}`, success: false };
    }

    const plan = result.plan;
    const stepsText = plan.steps
      .map(s => `  ${s.id}. ${s.description}${s.dependencies.length > 0 ? ` (依赖: ${s.dependencies.join(', ')})` : ''}${s.needsSubAgent ? ' [Sub-Agent]' : ''}`)
      .join('\n');

    let content = `已创建计划: ${plan.title}\nID: ${plan.id}\n步骤 (${plan.steps.length}):\n${stepsText}`;

    // 自动执行
    if (this.autoExecute) {
      content += '\n\n正在自动执行计划...';
      const execResult = await this.executePlan(plan.id);
      if (execResult.success) {
        const resultsText = execResult.results
          .map(r => `  步骤 ${r.step}: [${r.status}] ${r.result || '(无结果)'}`)
          .join('\n');
        content += `\n\n执行完成:\n${resultsText}`;
      } else {
        const resultsText = execResult.results
          ? execResult.results.map(r => `  步骤 ${r.step}: [${r.status}] ${r.result || '(无结果)'}`).join('\n')
          : '';
        content += `\n\n执行出错: ${execResult.error || '部分步骤失败'}${resultsText ? '\n' + resultsText : ''}`;
      }
    }

    return { toolCallId: '', content, success: true };
  }

  async _handleExecutePlan(args) {
    const { planId } = args;
    if (!planId) {
      return { toolCallId: '', content: '错误: 缺少 planId 参数', success: false };
    }

    const result = await this.executePlan(planId);

    if (!result.success) {
      const resultsText = result.results
        ? '\n' + result.results.map(r => `  步骤 ${r.step}: [${r.status}] ${r.result || ''}`).join('\n')
        : '';
      return { toolCallId: '', content: `执行计划失败: ${result.error || '部分步骤失败'}${resultsText}`, success: false };
    }

    const resultsText = result.results
      .map(r => `  步骤 ${r.step}: [${r.status}] ${r.result || '(无结果)'}`)
      .join('\n');

    return { toolCallId: '', content: `计划执行完成:\n${resultsText}`, success: true };
  }

  async _handleViewPlan(args) {
    const { planId } = args;

    if (!planId) {
      // 列出所有计划
      const allPlans = this.getAllPlans();
      if (allPlans.length === 0) {
        return { toolCallId: '', content: '当前没有任何计划', success: true };
      }
      const text = allPlans.map(p =>
        `- ${p.id}: ${p.title} [${p.status}] (${p.completedSteps}/${p.stepCount} 步完成)`
      ).join('\n');
      return { toolCallId: '', content: `所有计划 (${allPlans.length}):\n${text}`, success: true };
    }

    const plan = this.getPlan(planId);
    if (!plan) {
      return { toolCallId: '', content: `计划不存在: ${planId}`, success: false };
    }

    const stepsText = plan.steps.map(s => {
      let line = `  ${s.id}. [${s.status}] ${s.description}`;
      if (s.result) line += `\n     结果: ${s.result}`;
      if (s.subAgentId) line += `\n     Sub-Agent: ${s.subAgentId}`;
      return line;
    }).join('\n');

    const elapsed = plan.completedAt
      ? `${((plan.completedAt - plan.createdAt) / 1000).toFixed(1)}s`
      : `${((Date.now() - plan.createdAt) / 1000).toFixed(1)}s (进行中)`;

    return {
      toolCallId: '',
      content: `计划: ${plan.title}\nID: ${plan.id}\n目标: ${plan.goal}\n状态: ${plan.status}\n耗时: ${elapsed}\n\n步骤:\n${stepsText}`,
      success: true
    };
  }

  async _handleCancelPlan(args) {
    const { planId } = args;
    if (!planId) {
      return { toolCallId: '', content: '错误: 缺少 planId 参数', success: false };
    }

    const plan = this.plans.get(planId);
    if (!plan) {
      return { toolCallId: '', content: `计划不存在: ${planId}`, success: false };
    }

    if (plan.status === PLAN_STATUS.COMPLETED || plan.status === PLAN_STATUS.CANCELLED) {
      return { toolCallId: '', content: `计划已是终态: ${plan.status}`, success: false };
    }

    plan.status = PLAN_STATUS.CANCELLED;
    // 将所有未完成的步骤标记为跳过
    for (const step of plan.steps) {
      if (step.status === STEP_STATUS.PENDING || step.status === STEP_STATUS.RUNNING) {
        step.status = STEP_STATUS.SKIPPED;
        step.result = '计划已取消';
      }
    }

    this.ctx.logger.info(`计划 ${planId} 已取消`);
    return { toolCallId: '', content: `计划 ${planId} 已取消`, success: true };
  }

  async _handleCreateSubAgent(args) {
    const { name, task, systemPrompt } = args;
    if (!name || !task) {
      return { toolCallId: '', content: '错误: 缺少 name 或 task 参数', success: false };
    }

    const result = this.createSubAgent(name, task, systemPrompt);
    if (!result.success) {
      return { toolCallId: '', content: `创建 Sub-Agent 失败: ${result.error}`, success: false };
    }

    // 自动执行任务
    const runResult = await this.runSubAgent(result.agentId, task);
    if (!runResult.success) {
      return { toolCallId: '', content: `Sub-Agent ${result.agentId} 创建成功但执行失败: ${runResult.error}`, success: false };
    }

    return {
      toolCallId: '',
      content: `Sub-Agent "${name}" (${result.agentId}) 已创建并执行完成:\n\n${runResult.output}`,
      success: true
    };
  }

  async _handleListSubAgents() {
    if (this.subAgents.size === 0) {
      return { toolCallId: '', content: '当前没有任何 Sub-Agent', success: true };
    }

    const agents = [];
    for (const [, agent] of this.subAgents) {
      agents.push(
        `- ${agent.id}: ${agent.name} [${agent.status}] — ${agent.task.slice(0, 80)}${agent.task.length > 80 ? '...' : ''}`
      );
    }

    return {
      toolCallId: '',
      content: `Sub-Agent 列表 (${this.subAgents.size}/${this.maxSubAgents}):\n${agents.join('\n')}`,
      success: true
    };
  }

  // ==================== 内部方法 ====================

  /**
   * 解析 LLM 返回的计划 JSON
   * @param {string} text
   * @returns {object|null}
   */
  _parsePlanResponse(text) {
    try {
      // 尝试直接解析
      const parsed = JSON.parse(text);
      if (parsed.steps && Array.isArray(parsed.steps)) {
        return parsed;
      }
    } catch {
      // 尝试从 Markdown 代码块中提取
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        try {
          const parsed = JSON.parse(codeBlockMatch[1].trim());
          if (parsed.steps && Array.isArray(parsed.steps)) {
            return parsed;
          }
        } catch {
          // 继续尝试
        }
      }

      // 尝试提取 JSON 对象
      const jsonMatch = text.match(/\{[\s\S]*"steps"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.steps && Array.isArray(parsed.steps)) {
            return parsed;
          }
        } catch {
          // 解析失败
        }
      }
    }

    this.ctx.logger.warn(`无法解析计划 JSON: ${text.slice(0, 200)}`);
    return null;
  }

  /**
   * 直接通过 LLM 执行步骤
   * @param {object} plan
   * @param {object} step
   * @returns {Promise<string>}
   */
  async _executeStep(plan, step) {
    // 收集前置步骤结果
    const previousResults = step.dependencies
      .map(depId => {
        const dep = plan.steps.find(s => s.id === depId);
        return dep ? `步骤 ${dep.id} (${dep.description}): ${dep.result || '(无结果)'}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const prompt = STEP_EXECUTION_PROMPT
      .replace('{goal}', plan.goal)
      .replace('{step}', step.description)
      .replace('{previousResults}', previousResults || '(无前置步骤)');

    const response = await this.ctx.callProvider('primary', {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: this.subAgentMaxTokens
    });

    return response.text;
  }

  /**
   * 通过 Sub-Agent 执行步骤
   * @param {object} plan
   * @param {object} step
   * @returns {Promise<string>}
   */
  async _executeStepWithSubAgent(plan, step) {
    const agentResult = this.createSubAgent(
      `plan-${plan.id}-step-${step.id}`,
      step.subAgentTask || step.description
    );

    if (!agentResult.success) {
      // 回退到直接 LLM 执行
      this.ctx.logger.warn(`创建 Sub-Agent 失败，回退到直接执行: ${agentResult.error}`);
      return this._executeStep(plan, step);
    }

    step.subAgentId = agentResult.agentId;

    // 构建包含前置结果的上下文
    const previousResults = step.dependencies
      .map(depId => {
        const dep = plan.steps.find(s => s.id === depId);
        return dep ? `步骤 ${dep.id} 结果: ${dep.result || '(无结果)'}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const input = previousResults
      ? `请执行以下任务。前置步骤结果供参考:\n${previousResults}\n\n任务: ${step.description}`
      : `请执行以下任务: ${step.description}`;

    const runResult = await this.runSubAgent(agentResult.agentId, input);
    return runResult.success ? runResult.output : `Sub-Agent 执行失败: ${runResult.error}`;
  }

  /**
   * 拓扑排序步骤（按依赖顺序）
   * @param {object[]} steps
   * @returns {number[]} 排序后的步骤 ID
   */
  _topologicalSort(steps) {
    const visited = new Set();
    const result = [];
    const stepMap = new Map(steps.map(s => [s.id, s]));

    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);

      const step = stepMap.get(id);
      if (step) {
        for (const depId of step.dependencies) {
          visit(depId);
        }
      }
      result.push(id);
    };

    for (const step of steps) {
      visit(step.id);
    }

    return result;
  }

  /**
   * 创建最小化的 MessageContext（供 Sub-Agent 工具循环使用）
   * @param {string} agentId
   * @returns {object}
   */
  _createMinimalMctx(agentId) {
    const agent = this.subAgents.get(agentId);
    return {
      message: { type: 'sub_agent', text: agent?.task || '' },
      sessionId: `sub-agent-${agentId}`,
      addReply: () => {},
      send: () => {},
      ws: null
    };
  }
}

module.exports = PlanningPlugin;
module.exports.default = PlanningPlugin;