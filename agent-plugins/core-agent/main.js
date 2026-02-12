/**
 * Core Agent Handler Plugin — 核心消息处理编排器
 * 
 * 作为 handlerPlugin 拦截 handler 的消息处理流程，编排以下基础插件：
 * - personality: 人格管理（系统提示词构建）
 * - memory: 记忆管理（上下文压缩与历史管理）
 * - protocol-adapter: 协议适配（LLM 回复 → 前端协议消息）
 * - plugin-tool-bridge: 插件工具桥接（前端插件 → Function Calling）
 * 
 * 通过 AgentPluginManager 的 getPluginInstance() 获取其他插件实例，
 * 直接调用其服务方法。
 * 
 * 支持：
 * - 完整的 LLM 调用 + 工具循环（executeWithToolLoop）
 * - 流式 TTS 合成
 * - 前端插件工具自动注册
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

class CoreAgentPlugin extends AgentPlugin {

  /** @type {import('../personality/main')} */
  personality = null;

  /** @type {import('../memory/main')} */
  memory = null;

  /** @type {import('../protocol-adapter/main')} */
  protocolAdapter = null;

  /** @type {import('../plugin-tool-bridge/main')} */
  pluginToolBridge = null;

  /** 配置项 */
  tapMaxTokens = 200;
  enableTTS = true;
  enableToolCalling = true;

  async initialize() {
    this.ctx.logger.info('Core Agent 处理器正在初始化...');

    // 读取配置
    const config = this.ctx.getConfig();
    if (config.tapMaxTokens) this.tapMaxTokens = config.tapMaxTokens;
    if (config.enableTTS !== undefined) this.enableTTS = config.enableTTS;
    if (config.enableToolCalling !== undefined) this.enableToolCalling = config.enableToolCalling;

    // 获取依赖的基础插件实例
    this.personality = this.ctx.getPluginInstance('personality');
    this.memory = this.ctx.getPluginInstance('memory');
    this.protocolAdapter = this.ctx.getPluginInstance('protocol-adapter');
    this.pluginToolBridge = this.ctx.getPluginInstance('plugin-tool-bridge');

    // 验证依赖
    const missing = [];
    if (!this.personality) missing.push('personality');
    if (!this.memory) missing.push('memory');
    if (!this.protocolAdapter) missing.push('protocol-adapter');
    if (!this.pluginToolBridge) missing.push('plugin-tool-bridge');

    if (missing.length > 0) {
      throw new Error(`Core Agent 缺少依赖插件: ${missing.join(', ')}。请确保这些插件已安装并已激活。`);
    }

    this.ctx.logger.info('Core Agent 处理器初始化完成，所有依赖插件已就绪');
  }

  async terminate() {
    this.personality = null;
    this.memory = null;
    this.protocolAdapter = null;
    this.pluginToolBridge = null;
    this.ctx.logger.info('Core Agent 处理器已停止');
  }

  // ==================== 消息处理钩子 ====================

  /**
   * 处理用户文本输入
   * 
   * 完整流程：
   * 1. PersonalityPlugin 构建系统提示词
   * 2. MemoryPlugin 构建上下文（自动压缩）
   * 3. LLM 调用（含工具循环 via executeWithToolLoop）
   * 4. ProtocolAdapterPlugin 解析回复（提取 Live2D 指令）
   * 5. 转换为前端协议消息
   * 6. TTS 合成
   */
  async onUserInput(mctx) {
    const text = mctx.message.text || '';

    // 检查是否有可用的 LLM Provider
    const providers = this.ctx.getProviders();
    const primaryId = this.ctx.getPrimaryProviderId();
    const primaryProvider = providers.find(p => p.instanceId === primaryId);

    if (!primaryId || !primaryProvider || primaryProvider.status !== 'connected') {
      mctx.addReply({
        type: 'dialogue',
        data: { text: '[Core Agent] 未配置或未激活主 LLM Provider', duration: 5000 }
      });
      return true;
    }

    // Echo 类型不使用高级功能
    if (primaryProvider.providerId === 'echo') {
      return false;
    }

    const sessions = this.ctx.getSessions();

    // 追加用户消息到会话历史
    sessions.addMessage(mctx.sessionId, { role: 'user', content: text });

    // 1. 同步信息到人格管理器，构建系统提示词
    this._syncInfoToPlugins();
    const systemPrompt = this.personality.buildSystemPrompt();

    // 2. 构建上下文消息（摘要 + 近期历史，自动压缩旧消息）
    let compressionProvider = null;
    try {
      compressionProvider = {
        chat: (req) => this.ctx.callProvider('primary', req)
      };
    } catch {
      // 忽略
    }

    const contextMessages = await this.memory.buildContextMessages(
      mctx.sessionId,
      sessions,
      compressionProvider
    );

    // 确保当前用户消息在上下文中
    const lastMsg = contextMessages[contextMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== text) {
      contextMessages.push({ role: 'user', content: text });
    }

    // 3. 构建 LLM 请求
    const request = {
      messages: contextMessages,
      systemPrompt,
      sessionId: mctx.sessionId
    };

    // 添加工具
    if (this.enableToolCalling && this.ctx.isToolCallingEnabled() && this.ctx.hasEnabledTools()) {
      request.tools = this.ctx.getOpenAITools();
      request.toolChoice = 'auto';
    }

    // 更新插件工具桥接的调用器
    const sender = this.ctx.getPluginInvokeSender();
    if (sender) {
      this.pluginToolBridge.setInvokeSender(sender);
    }

    try {
      // 4. 工具循环执行（使用 handler 的 executeWithToolLoop）
      const response = await this.ctx.executeWithToolLoop(request, mctx);

      // 追加助手回复到历史
      sessions.addMessage(mctx.sessionId, {
        role: 'assistant',
        content: response.text
      });

      // 5. 协议适配：解析 LLM 回复，提取 Live2D 指令
      const parsed = this.protocolAdapter.parseResponse(response.text, response.reasoningContent);

      // 6. 转换为前端期望的协议消息
      const outgoingMessages = this.protocolAdapter.toOutgoingMessages(parsed);

      for (const msg of outgoingMessages) {
        mctx.addReply(msg);
      }

      // 7. TTS 合成（使用纯文本，不含 XML 标签）
      if (this.enableTTS && this.ctx.hasTTS() && parsed.text) {
        this.ctx.synthesizeAndStream(parsed.text, mctx).catch(err => {
          this.ctx.logger.warn(`TTS 合成失败（非致命）: ${err}`);
        });
      }
    } catch (error) {
      this.ctx.logger.error(`LLM 调用失败: ${error}`);
      mctx.addReply({
        type: 'dialogue',
        data: { text: `[Core Agent] AI 回复失败: ${error.message}`, duration: 5000 }
      });
    }

    return true;
  }

  /**
   * 处理触碰事件
   */
  async onTapEvent(mctx) {
    const data = mctx.message.data;
    if (!data?.hitArea) return false;

    // 检查 LLM 是否可用
    const providers = this.ctx.getProviders();
    const primaryId = this.ctx.getPrimaryProviderId();
    const primaryProvider = providers.find(p => p.instanceId === primaryId);

    if (!primaryId || !primaryProvider || primaryProvider.status !== 'connected' || primaryProvider.providerId === 'echo') {
      return false;
    }

    this._syncInfoToPlugins();
    const prompt = `用户触碰了你的 "${data.hitArea}" 部位，请给出一个简短可爱的反应（1-2句话）。你可以使用表情和动作来表达。`;

    try {
      const response = await this.ctx.callProvider('primary', {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: this.personality.buildSystemPrompt(),
        maxTokens: this.tapMaxTokens
      });

      const parsed = this.protocolAdapter.parseResponse(response.text);
      const outgoingMessages = this.protocolAdapter.toOutgoingMessages(parsed);

      for (const msg of outgoingMessages) {
        mctx.addReply(msg);
      }

      if (this.enableTTS && this.ctx.hasTTS() && parsed.text) {
        this.ctx.synthesizeAndStream(parsed.text, mctx).catch(err => {
          this.ctx.logger.warn(`触碰 TTS 合成失败（非致命）: ${err}`);
        });
      }

      return true;
    } catch (error) {
      this.ctx.logger.warn(`触碰 LLM 调用失败: ${error}`);
      return false;
    }
  }

  /**
   * 处理模型信息更新
   */
  onModelInfo(mctx) {
    const modelInfo = mctx.message.data;
    if (modelInfo && this.personality) {
      this.personality.setModelInfo(modelInfo);
      this.ctx.logger.info('已同步模型信息到人格管理器');
    }
    return true;
  }

  /**
   * 处理角色信息更新
   */
  onCharacterInfo(mctx) {
    const characterInfo = mctx.message.data;
    if (characterInfo && this.personality) {
      this.personality.setCharacterInfo(characterInfo);
      this.ctx.logger.info('已同步角色信息到人格管理器');
    }
    return true;
  }

  // ==================== 公共方法 ====================

  /**
   * 注册已连接的前端插件工具
   */
  registerConnectedPlugins(plugins) {
    if (this.pluginToolBridge) {
      const sender = this.ctx.getPluginInvokeSender();
      if (sender) {
        this.pluginToolBridge.setInvokeSender(sender);
      }
      this.pluginToolBridge.registerPluginTools(plugins);
      this.ctx.logger.info(`已注册前端插件工具: ${plugins.map(p => p.pluginId).join(', ')}`);
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 将 handler 中的 modelInfo / characterInfo 同步到人格管理器
   */
  _syncInfoToPlugins() {
    if (!this.personality) return;

    const modelInfo = this.ctx.getModelInfo();
    if (modelInfo) {
      this.personality.setModelInfo(modelInfo);
    }

    const characterInfo = this.ctx.getCharacterInfo();
    if (characterInfo) {
      this.personality.setCharacterInfo(characterInfo);
    }
  }
}

module.exports = CoreAgentPlugin;
module.exports.default = CoreAgentPlugin;
