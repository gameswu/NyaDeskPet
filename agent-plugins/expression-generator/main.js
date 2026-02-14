/**
 * 表情生成器插件 (Expression Generator Plugin)
 * 
 * 使用独立的 LLM 调用，根据对话文本生成 Live2D 参数控制指令。
 * 将表情/动作生成与对话文本生成完全分离，解决了 XML 标签方案的可靠性问题。
 * 
 * 工作流：
 * 1. 接收对话 LLM 产出的纯文本回复
 * 2. 构建表情专用系统提示词（含模型可用参数/表情/动作列表）
 * 3. 调用配置的 LLM Provider（或主 LLM）生成纯 JSON 参数指令
 * 4. 校验参数合法性（clamp 到 min/max 范围）
 * 5. 返回结构化的 Live2D 控制指令列表
 * 
 * 暴露服务 API 供 core-agent 调用：
 * - generateExpression(dialogueText, modelInfo) → { actions, error? }
 * - isEnabled() → boolean
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

/** 表情 LLM 最大重试次数 */
const MAX_RETRIES = 1;

class ExpressionGeneratorPlugin extends AgentPlugin {

  /** 配置项 */
  expressionProviderId = '';
  temperature = 0.7;
  maxTokens = 300;
  enabled = true;

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.expressionProviderId !== undefined) this.expressionProviderId = config.expressionProviderId;
    if (config.temperature !== undefined) this.temperature = config.temperature;
    if (config.maxTokens !== undefined) this.maxTokens = config.maxTokens;
    if (config.enabled !== undefined) this.enabled = config.enabled;

    this.ctx.logger.info('表情生成器插件已初始化');
  }

  async terminate() {
    this.ctx.logger.info('表情生成器插件已停止');
  }

  // ==================== 服务 API ====================

  /**
   * 是否启用表情生成
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * 根据对话文本生成 Live2D 控制指令
   * 
   * @param {string} dialogueText - 对话 LLM 产出的纯文本回复
   * @param {object|null} modelInfo - 当前 Live2D 模型信息
   * @returns {{ actions: Array<object>, error?: string }}
   */
  async generateExpression(dialogueText, modelInfo) {
    if (!this.enabled || !dialogueText) {
      return { actions: [] };
    }

    // 没有模型信息时无法生成参数指令
    if (!modelInfo) {
      return { actions: [] };
    }

    const providerId = this._resolveProviderId();
    if (!providerId) {
      this.ctx.logger.warn('无可用的 LLM Provider，跳过表情生成');
      return { actions: [] };
    }

    const systemPrompt = this._buildExpressionSystemPrompt(modelInfo);
    const userPrompt = this._buildUserPrompt(dialogueText);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.ctx.callProvider(providerId, {
          messages: [{ role: 'user', content: userPrompt }],
          systemPrompt,
          maxTokens: this.maxTokens,
          temperature: this.temperature
        });

        const result = this._parseAndValidate(response.text, modelInfo);
        if (result.error && attempt < MAX_RETRIES) {
          this.ctx.logger.warn(`表情生成解析失败 (尝试 ${attempt + 1}/${MAX_RETRIES + 1}): ${result.error}`);
          continue;
        }
        return result;
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          this.ctx.logger.warn(`表情生成 LLM 调用失败 (尝试 ${attempt + 1}): ${error}`);
          continue;
        }
        this.ctx.logger.error(`表情生成最终失败: ${error}`);
        return { actions: [], error: String(error) };
      }
    }

    return { actions: [] };
  }

  // ==================== 内部方法 ====================

  /**
   * 解析配置的 Provider ID，验证可用性，回退到主 LLM
   * @returns {string|null}
   */
  _resolveProviderId() {
    // 如果配置了特定 Provider，检查其是否存在且可用
    if (this.expressionProviderId) {
      const providers = this.ctx.getProviders();
      const target = providers.find(p => p.instanceId === this.expressionProviderId);
      if (target && target.status === 'connected' && target.enabled) {
        return this.expressionProviderId;
      }
      this.ctx.logger.warn(
        `配置的表情 Provider "${this.expressionProviderId}" 不可用，回退到主 LLM`
      );
    }

    // 回退到主 LLM
    const primaryId = this.ctx.getPrimaryProviderId();
    if (!primaryId) return null;

    const providers = this.ctx.getProviders();
    const primary = providers.find(p => p.instanceId === primaryId);
    if (!primary || primary.status !== 'connected') return null;
    // echo provider 不能用于生成
    if (primary.providerId === 'echo') return null;

    return 'primary';
  }

  /**
   * 构建表情生成专用的系统提示词
   * @param {object} modelInfo
   * @returns {string}
   */
  _buildExpressionSystemPrompt(modelInfo) {
    const sections = [];
    const hasMapped = !!(modelInfo.mappedParameters || modelInfo.mappedExpressions || modelInfo.mappedMotions);

    sections.push(`你是一个 Live2D 模型的表情控制器。你的任务是根据对话文本的情感和语义，生成合适的 Live2D 控制指令。

你必须且只能输出一个 JSON 对象，不要输出任何其他文字。`);

    // 模型能力
    const capabilities = ['## 可用控制能力'];

    // 表情列表（优先映射版）
    if (modelInfo.mappedExpressions && modelInfo.mappedExpressions.length > 0) {
      const expList = modelInfo.mappedExpressions
        .map(e => `  - ${e.alias}: ${e.description}`)
        .join('\n');
      capabilities.push(`\n**预设表情**:\n${expList}`);
    } else if (modelInfo.expressions && modelInfo.expressions.length > 0) {
      capabilities.push(`\n**预设表情**: ${modelInfo.expressions.join(', ')}`);
    }

    // 动作列表（优先映射版：逐个动作）
    if (modelInfo.mappedMotions && modelInfo.mappedMotions.length > 0) {
      const motionList = modelInfo.mappedMotions
        .map(m => `  - ${m.alias}: ${m.description}`)
        .join('\n');
      capabilities.push(`\n**可用动作**:\n${motionList}`);
    } else if (modelInfo.motions && Object.keys(modelInfo.motions).length > 0) {
      const motionList = Object.entries(modelInfo.motions)
        .map(([group, info]) => `  - ${group}（${info.count} 个变体）`)
        .join('\n');
      capabilities.push(`\n**动作组**:\n${motionList}`);
    }

    // 参数列表（优先映射版：别名 + 描述 + 范围）
    if (modelInfo.mappedParameters && modelInfo.mappedParameters.length > 0) {
      const paramList = modelInfo.mappedParameters
        .map(p => `  - ${p.alias}: ${p.description}（${p.min} ~ ${p.max}，默认 ${p.default}）`)
        .join('\n');
      capabilities.push(`\n**可控参数**（推荐优先使用）:\n${paramList}`);
    } else if (modelInfo.availableParameters && modelInfo.availableParameters.length > 0) {
      const paramList = modelInfo.availableParameters
        .map(p => `  - ${p.id}: ${p.min} ~ ${p.max}（默认 ${p.default}）`)
        .join('\n');
      capabilities.push(`\n**可控参数**（推荐优先使用）:\n${paramList}`);
    }

    sections.push(capabilities.join(''));

    // 输出格式规范
    sections.push(`## 输出格式

输出一个 JSON 对象，格式如下：

\`\`\`json
{
  "expression": "简短描述当前情感",
  "actions": [
    {
      "type": "parameter",
      "parameterId": "参数名称",
      "value": 数值
    },
    {
      "type": "expression",
      "expressionId": "表情名称"
    },
    {
      "type": "motion",
      "group": "动作名称"
    }
  ]
}
\`\`\`

### 规则
- **parameterId / expressionId / group 必须使用上方列表中给出的名称**（动作使用可用动作列表中的名称）
- **parameter** 的 value 必须在对应参数的 min ~ max 范围内
- 过渡动画时长由系统根据参数变化幅度自动计算，你无需指定
- 多个 parameter 可以组合出丰富的表情（如歪头+眯眼+微笑）
- **优先使用 parameter** 组合控制，比预设 expression 更自然灵动
- expression 和 motion 仅在确实需要时使用
- 如果对话文本情感平淡，可以只输出少量参数或空 actions 数组
- 只输出 JSON，不要有任何多余文字`);

    // 示例（使用映射别名或原始 ID）
    sections.push(this._buildExampleSection(modelInfo, hasMapped));

    return sections.join('\n\n');
  }

  /**
   * 构建示例部分（根据是否有映射表动态生成）
   */
  _buildExampleSection(modelInfo, hasMapped) {
    // 如果有映射参数，使用前几个别名生成动态示例
    if (hasMapped && modelInfo.mappedParameters && modelInfo.mappedParameters.length >= 2) {
      const params = modelInfo.mappedParameters;
      // 选取最多 4 个参数构造示例
      const sampleActions = params.slice(0, 4).map(p => {
        // 生成一个偏离默认值的示例值
        const range = p.max - p.min;
        const sampleValue = Math.round((p.default + range * 0.3) * 100) / 100;
        const clamped = Math.min(p.max, Math.max(p.min, sampleValue));
        return `    { "type": "parameter", "parameterId": "${p.alias}", "value": ${clamped} }`;
      }).join(',\n');

      return `## 示例

对话文本: "嘻嘻，有点困了喵~"
\`\`\`json
{
  "expression": "困倦微笑",
  "actions": [
${sampleActions}
  ]
}
\`\`\`

对话文本: "好的，我知道了。"
\`\`\`json
{
  "expression": "平静",
  "actions": []
}
\`\`\``;
    }

    // 无映射表时使用静态示例
    return `## 示例

对话文本: "嘻嘻，有点困了喵~"
\`\`\`json
{
  "expression": "困倦微笑",
  "actions": [
    { "type": "parameter", "parameterId": "ParamAngleZ", "value": 15 },
    { "type": "parameter", "parameterId": "ParamEyeLOpen", "value": 0.3 },
    { "type": "parameter", "parameterId": "ParamEyeROpen", "value": 0.3 },
    { "type": "parameter", "parameterId": "ParamMouthForm", "value": 0.8 }
  ]
}
\`\`\`

对话文本: "好的，我知道了。"
\`\`\`json
{
  "expression": "平静",
  "actions": []
}
\`\`\``;
  }

  /**
   * 构建用户提示（传入对话文本）
   * @param {string} dialogueText
   * @returns {string}
   */
  _buildUserPrompt(dialogueText) {
    return `对话文本: "${dialogueText}"`;
  }

  /**
   * 解析 LLM 输出的 JSON 并校验参数合法性
   * @param {string} rawOutput - LLM 原始输出
   * @param {object} modelInfo - 模型信息（用于参数校验）
   * @returns {{ actions: Array<object>, error?: string }}
   */
  _parseAndValidate(rawOutput, modelInfo) {
    // 尝试从输出中提取 JSON
    let jsonStr = rawOutput.trim();

    // 如果包含 markdown 代码块，提取其中的 JSON
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // 尝试找到 JSON 对象的起止位置
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return { actions: [], error: `JSON 解析失败: ${e.message}` };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { actions: [], error: '输出不是有效的 JSON 对象' };
    }

    const rawActions = parsed.actions;
    if (!Array.isArray(rawActions)) {
      // 允许空 actions
      return { actions: [] };
    }

    // === 构建查找表 ===

    // 参数：真实 ID → 范围
    const paramMap = new Map();
    if (modelInfo.availableParameters) {
      for (const p of modelInfo.availableParameters) {
        paramMap.set(p.id, { min: p.min, max: p.max, default: p.default });
      }
    }
    // 参数：别名 → { realId, min, max, default }
    const paramAliasMap = new Map();
    if (modelInfo.mappedParameters) {
      for (const mp of modelInfo.mappedParameters) {
        paramAliasMap.set(mp.alias, { id: mp.id, min: mp.min, max: mp.max, default: mp.default });
      }
    }

    // 表情：有效集合 + 别名映射
    const validExpressions = new Set(modelInfo.expressions || []);
    const expressionAliasMap = new Map();
    if (modelInfo.mappedExpressions) {
      for (const me of modelInfo.mappedExpressions) {
        expressionAliasMap.set(me.alias, me.id);
      }
    }

    // 动作：有效组集合 + 别名 → {group, index} 映射
    const validMotionGroups = new Set(Object.keys(modelInfo.motions || {}));
    const motionAliasMap = new Map();
    if (modelInfo.mappedMotions) {
      for (const mm of modelInfo.mappedMotions) {
        motionAliasMap.set(mm.alias, { group: mm.group, index: mm.index });
      }
    }

    // === 校验并解析每个动作 ===

    const validatedActions = [];

    for (const action of rawActions) {
      if (!action || !action.type) continue;

      switch (action.type) {
        case 'parameter': {
          if (!action.parameterId || action.value === undefined) break;

          // 解析参数：先查真实 ID，再查别名
          let realId = action.parameterId;
          let paramInfo = paramMap.get(realId);
          if (!paramInfo) {
            const aliased = paramAliasMap.get(action.parameterId);
            if (aliased) {
              realId = aliased.id;
              paramInfo = { min: aliased.min, max: aliased.max, default: aliased.default };
            }
          }
          if (!paramInfo) {
            this.ctx.logger.warn(`表情生成器: 未知参数 "${action.parameterId}"，已跳过`);
            break;
          }

          const clampedValue = Math.max(paramInfo.min, Math.min(paramInfo.max, Number(action.value)));
          validatedActions.push({
            type: 'parameter',
            parameterId: realId,  // 始终输出真实 ID
            value: clampedValue,
            weight: 1.0
          });
          break;
        }
        case 'expression': {
          if (!action.expressionId) break;

          // 解析表情：先查真实 ID，再查别名
          let realExpId = action.expressionId;
          if (!validExpressions.has(realExpId)) {
            const aliased = expressionAliasMap.get(realExpId);
            if (aliased) {
              realExpId = aliased;
            }
          }
          if (!validExpressions.has(realExpId)) {
            this.ctx.logger.warn(`表情生成器: 未知表情 "${action.expressionId}"，已跳过`);
            break;
          }

          validatedActions.push({
            type: 'expression',
            expressionId: realExpId  // 始终输出真实 ID
          });
          break;
        }
        case 'motion': {
          if (action.group === undefined) break;

          // 解析动作：先查别名（→ 精确的 group+index），再查真实组名
          let realGroup = action.group;
          let realIndex = (typeof action.index === 'number') ? action.index : 0;

          const aliased = motionAliasMap.get(action.group);
          if (aliased) {
            realGroup = aliased.group;
            realIndex = aliased.index;
          }

          if (!validMotionGroups.has(realGroup)) {
            this.ctx.logger.warn(`表情生成器: 未知动作 "${action.group}"，已跳过`);
            break;
          }

          validatedActions.push({
            type: 'motion',
            group: realGroup,  // 始终输出真实组名
            index: realIndex,
            priority: 2
          });
          break;
        }
      }
    }

    this.ctx.logger.info(`表情生成完成: ${validatedActions.length} 个有效指令 (${parsed.expression || ''})`);
    return { actions: validatedActions };
  }
}

module.exports = ExpressionGeneratorPlugin;
module.exports.default = ExpressionGeneratorPlugin;
