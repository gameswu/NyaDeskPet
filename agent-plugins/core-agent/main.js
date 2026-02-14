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

  /** @type {import('../expression-generator/main')|null} 可选插件 */
  expressionGenerator = null;

  /** @type {import('../input-collector/main')|null} 可选插件 */
  inputCollector = null;

  /** @type {import('../image-transcriber/main')|null} 可选插件 */
  imageTranscriber = null;

  /** 配置项 */
  tapMaxTokens = 200;
  enableTTS = true;
  enableToolCalling = true;

  /** 自定义触碰反应提示词（空字符串使用内置默认） */
  tapReactionPrompt = '';

  async initialize() {
    this.ctx.logger.info('Core Agent 处理器正在初始化...');

    // 读取配置
    const config = this.ctx.getConfig();
    if (config.tapMaxTokens) this.tapMaxTokens = config.tapMaxTokens;
    if (config.enableTTS !== undefined) this.enableTTS = config.enableTTS;
    if (config.enableToolCalling !== undefined) this.enableToolCalling = config.enableToolCalling;
    if (config.tapReactionPrompt) this.tapReactionPrompt = config.tapReactionPrompt;

    // 获取依赖的基础插件实例
    this.personality = this.ctx.getPluginInstance('personality');
    this.memory = this.ctx.getPluginInstance('memory');
    this.protocolAdapter = this.ctx.getPluginInstance('protocol-adapter');
    this.pluginToolBridge = this.ctx.getPluginInstance('plugin-tool-bridge');

    // 可选插件采用懒加载（首次使用时获取），避免拓扑排序导致的激活顺序问题
    // inputCollector, imageTranscriber, expressionGenerator 会在 _getOptionalPlugin() 中动态获取

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
    this.inputCollector = null;
    this.imageTranscriber = null;
    this.expressionGenerator = null;
    this.ctx.logger.info('Core Agent 处理器已停止');
  }

  /**
   * 懒加载可选插件：首次获取成功后缓存，避免拓扑排序激活顺序问题
   * @param {string} field - 实例字段名 ('inputCollector'|'imageTranscriber'|'expressionGenerator')
   * @param {string} pluginName - 插件名称
   * @returns {object|null}
   */
  _getOptionalPlugin(field, pluginName) {
    if (!this[field]) {
      this[field] = this.ctx.getPluginInstance(pluginName);
      if (this[field]) {
        this.ctx.logger.info(`已关联可选插件: ${pluginName}`);
      }
    }
    return this[field];
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
    let text = mctx.message.text || '';

    // === 输入收集器：合并短时间内的多条输入 ===
    const inputCollector = this._getOptionalPlugin('inputCollector', 'input-collector');
    if (inputCollector?.isEnabled?.() && inputCollector.collectInput) {
      const collected = await inputCollector.collectInput(mctx.sessionId, text);
      if (collected === null) {
        this.ctx.logger.info('[Core Agent] 输入已被收集器缓冲，等待更多输入...');
        return true;
      }
      text = collected;
      this.ctx.logger.info(`[Core Agent] 收集器合并输出: ${text}`);
    }

    // 检查 Provider 可用性
    if (!this._getPrimaryProvider()) {
      mctx.addReply({
        type: 'dialogue',
        data: { text: '[Core Agent] 未配置或未激活主 LLM Provider', duration: 5000 }
      });
      return true;
    }

    const sessions = this.ctx.getSessions();
    sessions.addMessage(mctx.sessionId, { role: 'user', content: text });

    await this._callLLMAndRespond(mctx, text, 'LLM');
    return true;
  }

  /**
   * 处理前端插件主动发送的消息
   * 持久化并交给 LLM 处理，与 onUserInput 共享上下文和记忆
   */
  async onPluginMessage(mctx) {
    const data = mctx.message.data;
    if (!data?.text) return false;

    const pluginLabel = data.pluginName || data.pluginId || '未知插件';
    const userContent = `[插件 ${pluginLabel}] ${data.text}`;

    if (!this._getPrimaryProvider()) {
      // 无 Provider 时仅持久化
      const sessions = this.ctx.getSessions();
      sessions.addMessage(mctx.sessionId, { role: 'user', content: userContent });
      mctx.addReply({
        type: 'dialogue',
        data: { text: userContent, duration: 5000 }
      });
      return true;
    }

    const sessions = this.ctx.getSessions();
    sessions.addMessage(mctx.sessionId, { role: 'user', content: userContent });

    await this._callLLMAndRespond(mctx, userContent, '插件消息');
    return true;
  }

  /**
   * 处理触碰事件
   */
  async onTapEvent(mctx) {
    const data = mctx.message.data;
    if (!data?.hitArea) return false;

    if (!this._getPrimaryProvider()) return false;

    const sessions = this.ctx.getSessions();
    sessions.addMessage(mctx.sessionId, { role: 'user', content: `[触碰] 用户触碰了 "${data.hitArea}" 部位` });

    this._syncInfoToPlugins();
    const defaultTapPrompt = `用户触碰了你的 "${data.hitArea}" 部位，请给出一个简短可爱的反应（1-2句话）。你可以使用表情和动作来表达。`;
    const prompt = this.tapReactionPrompt
      ? this.tapReactionPrompt.replace(/\{hitArea\}/g, data.hitArea)
      : defaultTapPrompt;

    try {
      const response = await this.ctx.callProvider('primary', {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: this.personality.buildSystemPrompt(),
        maxTokens: this.tapMaxTokens
      });

      sessions.addMessage(mctx.sessionId, { role: 'assistant', content: response.text });

      const parsed = this.protocolAdapter.parseResponse(response.text);

      // 使用 expression-generator 生成 Live2D 控制指令
      const expressionActions = await this._generateExpressionActions(parsed.text);
      parsed.actions = expressionActions;

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
   * 处理文件上传
   * 
   * 如果是图片且 image-transcriber 可用，自动转述为文字并通过 LLM 处理。
   */
  async onFileUpload(mctx) {
    const data = mctx.message.data;
    if (!data) return false;

    const isImage = data.fileType?.startsWith('image/');

    // 缓存图片供 describe_image 工具使用
    const imageTranscriber = this._getOptionalPlugin('imageTranscriber', 'image-transcriber');
    if (isImage && data.fileData && imageTranscriber?.cacheImage) {
      imageTranscriber.cacheImage(data.fileData, data.fileType, data.fileName || 'image');
    }

    // 自动转述模式
    if (isImage && data.fileData && imageTranscriber?.isAvailable?.() && imageTranscriber.autoTranscribe && imageTranscriber.transcribeImage) {
      mctx.addReply({
        type: 'dialogue',
        data: { text: `正在识别图片 ${data.fileName}...`, duration: 3000 }
      });

      try {
        const result = await imageTranscriber.transcribeImage(data.fileData, data.fileType);
        if (result.success && result.description) {
          const sessions = this.ctx.getSessions();
          const imageContext = `[用户上传了图片: ${data.fileName}]\n\n图片描述: ${result.description}`;
          sessions.addMessage(mctx.sessionId, { role: 'user', content: imageContext });

          await this._callLLMAndRespond(mctx, imageContext, '图片回复');
          return true;
        } else {
          this.ctx.logger.warn(`图片转述失败: ${result.error}`);
        }
      } catch (error) {
        this.ctx.logger.error(`图片转述出错: ${error}`);
      }
    }

    // 默认：记录文件上传并确认
    const sessions = this.ctx.getSessions();
    const fileMsg = `[文件上传] ${data.fileName || '未知文件'}` + (data.fileType ? ` (${data.fileType})` : '');
    sessions.addMessage(mctx.sessionId, { role: 'user', content: fileMsg });
    const ackText = `[Core Agent] 收到文件: ${data.fileName || '未知文件'}`;
    sessions.addMessage(mctx.sessionId, { role: 'assistant', content: ackText });
    mctx.addReply({
      type: 'dialogue',
      data: { text: ackText, duration: 3000 }
    });
    return true;
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
      } else {
        this.ctx.logger.warn('插件调用发送器不可用（WebSocket 未就绪），工具将注册但暂时无法执行调用');
      }
      this.pluginToolBridge.registerPluginTools(plugins);
      this.ctx.logger.info(`已注册前端插件工具: ${plugins.map(p => p.pluginId).join(', ')}`);
    } else {
      this.ctx.logger.warn('plugin-tool-bridge 插件未就绪，无法注册前端插件工具');
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 获取主 Provider（若不可用返回 null）
   */
  _getPrimaryProvider() {
    const providers = this.ctx.getProviders();
    const primaryId = this.ctx.getPrimaryProviderId();
    const provider = providers.find(p => p.instanceId === primaryId);
    if (!primaryId || !provider || provider.status !== 'connected') return null;
    if (provider.providerId === 'echo') return null;
    return provider;
  }

  /**
   * 通用 LLM 调用 + 响应处理 + TTS 合成流程
   *
   * @param {object} mctx 消息上下文
   * @param {string} userContent 用户消息内容（已持久化）
   * @param {string} [errorLabel='LLM'] 日志标签
   */
  async _callLLMAndRespond(mctx, userContent, errorLabel = 'LLM') {
    const sessions = this.ctx.getSessions();

    this._syncInfoToPlugins();
    const systemPrompt = this.personality.buildSystemPrompt();

    const compressionProvider = {
      chat: (req) => this.ctx.callProvider('primary', req)
    };

    const contextMessages = await this.memory.buildContextMessages(
      mctx.sessionId, sessions, compressionProvider
    );

    // 确保当前用户消息在上下文中
    const lastMsg = contextMessages[contextMessages.length - 1];
    if (!lastMsg || lastMsg.content !== userContent) {
      contextMessages.push({ role: 'user', content: userContent });
    }

    const request = { messages: contextMessages, systemPrompt, sessionId: mctx.sessionId };

    if (this.enableToolCalling && this.ctx.isToolCallingEnabled() && this.ctx.hasEnabledTools()) {
      request.tools = this.ctx.getOpenAITools();
      request.toolChoice = 'auto';
    }

    const sender = this.ctx.getPluginInvokeSender();
    if (sender) {
      this.pluginToolBridge.setInvokeSender(sender);
    }

    try {
      const response = await this.ctx.executeWithToolLoop(request, mctx);
      sessions.addMessage(mctx.sessionId, { role: 'assistant', content: response.text });

      // 对话 LLM 只输出纯文本，由 protocol-adapter 转为前端消息
      const parsed = this.protocolAdapter.parseResponse(response.text, response.reasoningContent);

      // 使用 expression-generator 生成 Live2D 控制指令（异步，不阻断主流程）
      const expressionActions = await this._generateExpressionActions(parsed.text);
      parsed.actions = expressionActions;

      const outgoingMessages = this.protocolAdapter.toOutgoingMessages(parsed);
      for (const msg of outgoingMessages) {
        mctx.addReply(msg);
      }

      if (this.enableTTS && this.ctx.hasTTS() && parsed.text) {
        this.ctx.synthesizeAndStream(parsed.text, mctx).catch(err => {
          this.ctx.logger.warn(`${errorLabel} TTS 合成失败（非致命）: ${err}`);
        });
      }
    } catch (error) {
      this.ctx.logger.error(`${errorLabel} 调用失败: ${error}`);
      const errText = `[Core Agent] ${errorLabel} 回复失败: ${error.message}`;
      sessions.addMessage(mctx.sessionId, { role: 'assistant', content: errText });
      mctx.addReply({
        type: 'dialogue',
        data: { text: errText, duration: 5000 }
      });
    }
  }

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

  /**
   * 使用 expression-generator 生成 Live2D 控制指令
   * 如果插件不可用或生成失败，返回空数组（不影响主流程）
   * @param {string} dialogueText 
   * @returns {Promise<Array>}
   */
  async _generateExpressionActions(dialogueText) {
    const expressionGenerator = this._getOptionalPlugin('expressionGenerator', 'expression-generator');
    if (!expressionGenerator || !expressionGenerator.isEnabled?.()) {
      return [];
    }

    try {
      const modelInfo = this.ctx.getModelInfo();
      const result = await expressionGenerator.generateExpression(dialogueText, modelInfo);
      if (result.error) {
        this.ctx.logger.warn(`表情生成出错（非致命）: ${result.error}`);
      }
      return result.actions || [];
    } catch (error) {
      this.ctx.logger.warn(`表情生成异常（非致命）: ${error}`);
      return [];
    }
  }
}

module.exports = CoreAgentPlugin;
module.exports.default = CoreAgentPlugin;
