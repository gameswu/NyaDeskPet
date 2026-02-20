/**
 * 绘图插件 (Image Generation Plugin)
 *
 * 封装 generate_image 工具，调用支持图像生成的 Provider（OpenAI DALL·E 等）
 * 返回生成的图片。插件配置中指定使用的 Provider 实例。
 *
 * 使用 Node.js 内置 https/http 模块直接调用 images/generations API。
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

/** 合法尺寸白名单 */
const VALID_SIZES = ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'];
/** 合法质量 */
const VALID_QUALITIES = ['standard', 'hd'];
/** 请求超时（毫秒） */
const REQUEST_TIMEOUT = 120000;
/** 最大响应体（10MB） */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

class ImageGenPlugin extends AgentPlugin {

  /** @type {string} */
  providerInstanceId = 'primary';
  /** @type {string} */
  model = '';
  /** @type {string} */
  defaultSize = '1024x1024';
  /** @type {string} */
  defaultQuality = 'standard';

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.providerInstanceId) this.providerInstanceId = String(config.providerInstanceId);
    if (config.model) this.model = String(config.model);
    if (config.defaultSize) this.defaultSize = String(config.defaultSize);
    if (config.defaultQuality) this.defaultQuality = String(config.defaultQuality);

    // 注册 generate_image 工具
    this.ctx.registerTool(
      {
        name: 'generate_image',
        description: '根据文本描述生成图片。传入详细的英文 prompt 以获得最佳效果。返回生成图片的 Base64 数据。',
        i18n: {
          'zh-CN': { description: '根据文本描述生成图片。传入详细的英文 prompt 以获得最佳效果。返回生成图片的 Base64 数据。' },
          'en-US': { description: 'Generate an image from a text description. Provide a detailed English prompt for best results. Returns Base64 image data.' }
        },
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: '图片描述（建议使用详细的英文描述）'
            },
            size: {
              type: 'string',
              enum: VALID_SIZES,
              description: `图片尺寸，可选值: ${VALID_SIZES.join(', ')}。默认 ${this.defaultSize}`
            },
            quality: {
              type: 'string',
              enum: VALID_QUALITIES,
              description: `图片质量，可选值: ${VALID_QUALITIES.join(', ')}。默认 ${this.defaultQuality}`
            }
          },
          required: ['prompt']
        }
      },
      async (args) => this._handleGenerateImage(args)
    );

    this.ctx.logger.info(`绘图插件已初始化，Provider: ${this.providerInstanceId}`);
  }

  async destroy() {
    this.ctx.unregisterTool('generate_image');
  }

  // ==================== 工具处理 ====================

  /**
   * 处理 generate_image 工具调用
   */
  async _handleGenerateImage(args) {
    const { prompt, size, quality } = args;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return { toolCallId: '', content: '错误: prompt 不能为空', success: false };
    }

    // 获取 Provider 配置
    const providerConfig = this.ctx.getProviderConfig(this.providerInstanceId);
    if (!providerConfig) {
      return {
        toolCallId: '',
        content: `错误: 找不到 Provider 实例 "${this.providerInstanceId}"，请在插件配置中指定正确的 Provider`,
        success: false
      };
    }

    if (!providerConfig.apiKey) {
      return {
        toolCallId: '',
        content: `错误: Provider "${providerConfig.displayName}" 未配置 API Key`,
        success: false
      };
    }

    const imageSize = (size && VALID_SIZES.includes(size)) ? size : this.defaultSize;
    const imageQuality = (quality && VALID_QUALITIES.includes(quality)) ? quality : this.defaultQuality;
    const imageModel = this.model || providerConfig.model || 'dall-e-3';

    this.ctx.logger.info(`生成图片: model=${imageModel}, size=${imageSize}, quality=${imageQuality}, prompt="${prompt.substring(0, 80)}..."`);

    try {
      const result = await this._callImageAPI(providerConfig, {
        prompt: prompt.trim(),
        model: imageModel,
        size: imageSize,
        quality: imageQuality,
        n: 1,
        response_format: 'b64_json'
      });

      if (!result.success) {
        return { toolCallId: '', content: `图片生成失败: ${result.error}`, success: false };
      }

      // 返回 base64 图片数据作为 data URL
      const dataUrl = `data:image/png;base64,${result.b64Data}`;
      const revisedPrompt = result.revisedPrompt ? `\n修改后的提示词: ${result.revisedPrompt}` : '';

      return {
        toolCallId: '',
        content: `图片已生成成功。${revisedPrompt}\n\n![generated image](${dataUrl})`,
        success: true
      };
    } catch (error) {
      this.ctx.logger.error(`图片生成异常: ${error.message}`);
      return { toolCallId: '', content: `图片生成异常: ${error.message}`, success: false };
    }
  }

  // ==================== API 调用 ====================

  /**
   * 调用图像生成 API（OpenAI 兼容格式）
   * @param {object} providerConfig Provider 配置（apiKey, baseUrl）
   * @param {object} body 请求体
   * @returns {Promise<{success: boolean, b64Data?: string, revisedPrompt?: string, error?: string}>}
   */
  async _callImageAPI(providerConfig, body) {
    const baseUrl = (providerConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const apiUrl = `${baseUrl}/images/generations`;

    return new Promise((resolve) => {
      try {
        const url = new URL(apiUrl);
        const isHttps = url.protocol === 'https:';
        const mod = isHttps ? require('https') : require('http');

        const postData = JSON.stringify(body);

        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${providerConfig.apiKey}`,
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: REQUEST_TIMEOUT
        };

        const req = mod.request(options, (res) => {
          const chunks = [];
          let totalSize = 0;

          res.on('data', (chunk) => {
            totalSize += chunk.length;
            if (totalSize > MAX_RESPONSE_SIZE) {
              res.destroy();
              resolve({ success: false, error: '响应体超过大小限制 (10MB)' });
              return;
            }
            chunks.push(chunk);
          });

          res.on('end', () => {
            try {
              const responseText = Buffer.concat(chunks).toString('utf-8');
              const response = JSON.parse(responseText);

              if (res.statusCode !== 200) {
                const errorMsg = response.error?.message || response.message || `HTTP ${res.statusCode}`;
                resolve({ success: false, error: errorMsg });
                return;
              }

              if (!response.data || response.data.length === 0) {
                resolve({ success: false, error: '未返回图片数据' });
                return;
              }

              const imageData = response.data[0];
              resolve({
                success: true,
                b64Data: imageData.b64_json,
                revisedPrompt: imageData.revised_prompt
              });
            } catch (parseErr) {
              resolve({ success: false, error: `解析响应失败: ${parseErr.message}` });
            }
          });

          res.on('error', (err) => {
            resolve({ success: false, error: `网络错误: ${err.message}` });
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: `请求超时 (${REQUEST_TIMEOUT / 1000}s)` });
        });

        req.on('error', (err) => {
          resolve({ success: false, error: `请求失败: ${err.message}` });
        });

        req.write(postData);
        req.end();
      } catch (err) {
        resolve({ success: false, error: `构建请求失败: ${err.message}` });
      }
    });
  }
}

module.exports = ImageGenPlugin;
