/**
 * 图片转述插件 (Image Transcriber Plugin)
 * 
 * 解决问题：当主 LLM 不支持图片模态（Vision）时，用户发送的图片无法被理解。
 * 
 * 解决方案：使用一个支持 Vision 的辅助 Provider（如 GPT-4o、Claude 等）
 * 将图片转述为文字描述，然后将描述添加到对话上下文中，供主 LLM 使用。
 * 
 * 功能：
 * 1. 注册 describe_image 工具 — LLM 可主动调用来描述缓存的图片
 * 2. 自动转述模式 — 收到图片时自动调用视觉 Provider，将描述注入上下文
 * 3. transcribeImage() 服务 — 供 handler/core-agent 在 file_upload 时调用
 * 
 * 配置：
 * - visionProviderId: 视觉 Provider 实例 ID（必须支持图片输入）
 * - autoTranscribe: 是否自动转述
 * - transcribePrompt: 转述提示词
 * - maxTokens: 最大回复 token
 * 
 * 默认不启用（metadata.json: autoActivate: false），需要用户手动激活并配置 Provider。
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

class ImageTranscriberPlugin extends AgentPlugin {

  /** 视觉 Provider 实例 ID */
  visionProviderId = '';
  /** 转述提示词 */
  transcribePrompt = '请详细描述这张图片的内容，包括画面中的主要元素、文字、颜色、布局等。用中文回复。';
  /** 最大 token 数 */
  maxTokens = 500;
  /** 是否自动转述 */
  autoTranscribe = true;

  /**
   * 最近接收的图片缓存（供 describe_image 工具使用）
   * @type {{ data: string, mimeType: string, fileName: string } | null}
   */
  lastImage = null;

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.visionProviderId) this.visionProviderId = config.visionProviderId;
    if (config.transcribePrompt) this.transcribePrompt = config.transcribePrompt;
    if (config.maxTokens) this.maxTokens = config.maxTokens;
    if (config.autoTranscribe !== undefined) this.autoTranscribe = config.autoTranscribe;

    // 注册 describe_image 工具
    this.ctx.registerTool(
      {
        name: 'describe_image',
        description: '描述最近收到的图片内容。当用户提到了图片或你需要了解图片内容时使用。需要先有图片被上传。',
        i18n: {
          'zh-CN': { description: '描述最近收到的图片内容。当用户提到了图片或你需要了解图片内容时使用。需要先有图片被上传。' },
          'en-US': { description: 'Describe the content of a recently received image. Use when the user mentions an image or you need to understand image content. An image must be uploaded first.' }
        },
        parameters: {
          type: 'object',
          properties: {
            detail: {
              type: 'string',
              description: '关注的重点。例如"文字内容"、"人物表情"、"整体布局"等。留空则进行通用描述。'
            }
          },
          required: []
        }
      },
      async (args) => this._handleDescribeImage(args)
    );

    if (this.visionProviderId) {
      this.ctx.logger.info(`图片转述插件已初始化 (provider: ${this.visionProviderId}, auto: ${this.autoTranscribe})`);
    } else {
      this.ctx.logger.warn('图片转述插件已初始化，但未配置 visionProviderId，图片转述功能将不可用');
    }
  }

  async terminate() {
    this.ctx.unregisterTool('describe_image');
    this.lastImage = null;
    this.ctx.logger.info('图片转述插件已停止');
  }

  // ==================== 服务 API ====================

  /**
   * 转述图片为文字描述
   * 
   * @param {string} base64Data Base64 编码的图片数据
   * @param {string} mimeType 图片 MIME 类型（如 image/jpeg）
   * @param {string} [prompt] 自定义提示词（可选）
   * @returns {Promise<{ success: boolean, description?: string, error?: string }>}
   */
  async transcribeImage(base64Data, mimeType, prompt) {
    if (!this.visionProviderId) {
      return { success: false, error: '未配置视觉 Provider (visionProviderId)' };
    }

    // 验证 Provider 状态
    const providers = this.ctx.getProviders();
    const visionProvider = providers.find(p => p.instanceId === this.visionProviderId);
    if (!visionProvider) {
      return { success: false, error: `视觉 Provider 不存在: ${this.visionProviderId}` };
    }
    if (visionProvider.status !== 'connected') {
      return { success: false, error: `视觉 Provider 未连接: ${visionProvider.displayName} (${visionProvider.status})` };
    }

    try {
      this.ctx.logger.info(`调用视觉 Provider 转述图片 (${mimeType}, ${Math.round(base64Data.length / 1024)}KB)`);

      const response = await this.ctx.callProvider(this.visionProviderId, {
        messages: [{
          role: 'user',
          content: prompt || this.transcribePrompt,
          attachment: {
            type: 'image',
            data: base64Data,
            mimeType: mimeType || 'image/png'
          }
        }],
        maxTokens: this.maxTokens
      });

      const description = response.text;
      this.ctx.logger.info(`图片转述完成: "${description.slice(0, 80)}..."`);

      return { success: true, description };
    } catch (error) {
      this.ctx.logger.error(`图片转述失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 是否已配置且可用
   */
  isAvailable() {
    if (!this.visionProviderId) return false;
    const providers = this.ctx.getProviders();
    const vp = providers.find(p => p.instanceId === this.visionProviderId);
    return vp && vp.status === 'connected';
  }

  /**
   * 缓存图片（供 describe_image 工具使用）
   */
  cacheImage(base64Data, mimeType, fileName) {
    this.lastImage = { data: base64Data, mimeType, fileName };
  }

  // ==================== 工具处理 ====================

  async _handleDescribeImage(args) {
    if (!this.lastImage) {
      return {
        toolCallId: '',
        content: '当前没有缓存的图片。请等用户上传图片后再试。',
        success: false
      };
    }

    const prompt = args.detail
      ? `${this.transcribePrompt}\n\n请特别关注: ${args.detail}`
      : this.transcribePrompt;

    const result = await this.transcribeImage(
      this.lastImage.data,
      this.lastImage.mimeType,
      prompt
    );

    if (result.success) {
      return {
        toolCallId: '',
        content: `图片描述（${this.lastImage.fileName || '未知文件'}）:\n\n${result.description}`,
        success: true
      };
    } else {
      return {
        toolCallId: '',
        content: `图片描述失败: ${result.error}`,
        success: false
      };
    }
  }
}

module.exports = ImageTranscriberPlugin;
module.exports.default = ImageTranscriberPlugin;
