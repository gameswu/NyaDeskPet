/**
 * 网络工具插件 (Web Tools Plugin)
 * 
 * 提供两个 Function Calling 工具：
 * - fetch_url：获取指定 URL 的网页内容（提取正文文本）
 * - search_web：通过搜索引擎查询关键词，返回搜索结果列表
 * 
 * 使用 Electron 内置的 net 模块发送 HTTP 请求，无需额外依赖。
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

class WebToolsPlugin extends AgentPlugin {

  /** 配置 */
  searchEngine = 'bing';
  maxContentLength = 8000;
  requestTimeout = 15000;
  searchResultCount = 5;

  async initialize() {
    const config = this.ctx.getConfig();
    if (config.searchEngine) this.searchEngine = config.searchEngine;
    if (config.maxContentLength) this.maxContentLength = config.maxContentLength;
    if (config.requestTimeout) this.requestTimeout = config.requestTimeout;
    if (config.searchResultCount) this.searchResultCount = config.searchResultCount;

    // 注册 fetch_url 工具
    this.ctx.registerTool(
      {
        name: 'fetch_url',
        description: '获取指定 URL 的网页内容。会自动提取页面正文文本，去除 HTML 标签、脚本和样式。适合获取文章、文档、API 响应等内容。',
        i18n: {
          'zh-CN': { description: '获取指定 URL 的网页内容。会自动提取页面正文文本，去除 HTML 标签、脚本和样式。适合获取文章、文档、API 响应等内容。' },
          'en-US': { description: 'Fetch webpage content from a URL. Automatically extracts body text, removes HTML tags, scripts and styles. Suitable for articles, docs and API responses.' }
        },
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '要获取的网页 URL（必须以 http:// 或 https:// 开头）'
            }
          },
          required: ['url']
        }
      },
      async (args) => this._handleFetchUrl(args)
    );

    // 注册 search_web 工具
    this.ctx.registerTool(
      {
        name: 'search_web',
        description: '使用搜索引擎搜索关键词，返回搜索结果列表（标题、链接、摘要）。当需要查找最新信息、回答事实性问题时使用。',
        i18n: {
          'zh-CN': { description: '使用搜索引擎搜索关键词，返回搜索结果列表（标题、链接、摘要）。当需要查找最新信息、回答事实性问题时使用。' },
          'en-US': { description: 'Search the web with keywords, returns a list of results (title, link, summary). Use when looking for up-to-date information or answering factual questions.' }
        },
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词'
            },
            count: {
              type: 'number',
              description: '返回结果数量（默认 5，最多 10）'
            }
          },
          required: ['query']
        }
      },
      async (args) => this._handleSearchWeb(args)
    );

    this.ctx.logger.info('网络工具插件已初始化');
  }

  async terminate() {
    this.ctx.unregisterTool('fetch_url');
    this.ctx.unregisterTool('search_web');
    this.ctx.logger.info('网络工具插件已停止');
  }

  // ==================== fetch_url ====================

  async _handleFetchUrl(args) {
    const url = args.url;
    if (!url || typeof url !== 'string') {
      return { toolCallId: '', content: '错误: 缺少 url 参数', success: false };
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { toolCallId: '', content: '错误: URL 必须以 http:// 或 https:// 开头', success: false };
    }

    try {
      this.ctx.logger.info(`fetch_url: ${url}`);
      const html = await this._httpGet(url);
      const text = this._extractText(html);
      
      // 截断过长内容
      const truncated = text.length > this.maxContentLength
        ? text.slice(0, this.maxContentLength) + `\n\n[内容已截断，共 ${text.length} 字符，仅显示前 ${this.maxContentLength} 字符]`
        : text;

      return {
        toolCallId: '',
        content: truncated || '(页面无可提取的文本内容)',
        success: true
      };
    } catch (error) {
      return {
        toolCallId: '',
        content: `获取 URL 失败: ${error.message}`,
        success: false
      };
    }
  }

  // ==================== search_web ====================

  async _handleSearchWeb(args) {
    const query = args.query;
    if (!query || typeof query !== 'string') {
      return { toolCallId: '', content: '错误: 缺少 query 参数', success: false };
    }

    const count = Math.min(Math.max(1, args.count || this.searchResultCount), 10);

    try {
      this.ctx.logger.info(`search_web: "${query}" (engine: ${this.searchEngine}, count: ${count})`);
      const results = await this._doSearch(query, count);

      if (results.length === 0) {
        return { toolCallId: '', content: `搜索 "${query}" 未找到结果`, success: true };
      }

      const formatted = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   链接: ${r.url}\n   摘要: ${r.snippet}`
      ).join('\n\n');

      return {
        toolCallId: '',
        content: `搜索 "${query}" 的结果:\n\n${formatted}`,
        success: true
      };
    } catch (error) {
      return {
        toolCallId: '',
        content: `搜索失败: ${error.message}`,
        success: false
      };
    }
  }

  // ==================== 搜索引擎适配 ====================

  async _doSearch(query, count) {
    switch (this.searchEngine) {
      case 'bing':
        return this._searchBing(query, count);
      case 'google':
        return this._searchGoogle(query, count);
      case 'duckduckgo':
        return this._searchDuckDuckGo(query, count);
      default:
        return this._searchBing(query, count);
    }
  }

  /**
   * Bing 搜索（通过抓取搜索结果页面）
   */
  async _searchBing(query, count) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}`;
    const html = await this._httpGet(url);
    return this._parseBingResults(html, count);
  }

  /**
   * Google 搜索（通过抓取搜索结果页面）
   */
  async _searchGoogle(query, count) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${count}`;
    const html = await this._httpGet(url);
    return this._parseGoogleResults(html, count);
  }

  /**
   * DuckDuckGo 搜索（通过 HTML 版本）
   */
  async _searchDuckDuckGo(query, count) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await this._httpGet(url);
    return this._parseDuckDuckGoResults(html, count);
  }

  // ==================== 搜索结果解析 ====================

  _parseBingResults(html, count) {
    const results = [];
    // 匹配 Bing 搜索结果 <li class="b_algo">
    const blockRegex = /<li class="b_algo">([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = blockRegex.exec(html)) !== null && results.length < count) {
      const block = match[1];
      const titleMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (titleMatch) {
        results.push({
          title: this._stripTags(titleMatch[2]).trim(),
          url: titleMatch[1],
          snippet: snippetMatch ? this._stripTags(snippetMatch[1]).trim() : ''
        });
      }
    }
    return results;
  }

  _parseGoogleResults(html, count) {
    const results = [];
    // 匹配 Google 搜索结果
    const blockRegex = /<div class="[^"]*tF2Cxc[^"]*">([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match;
    while ((match = blockRegex.exec(html)) !== null && results.length < count) {
      const block = match[1];
      const linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
      if (linkMatch) {
        results.push({
          title: this._stripTags(linkMatch[2]).trim(),
          url: linkMatch[1],
          snippet: snippetMatch ? this._stripTags(snippetMatch[1]).trim() : ''
        });
      }
    }

    // 如果上面的选择器没匹配到，尝试更宽泛的匹配
    if (results.length === 0) {
      const fallbackRegex = /<a href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = fallbackRegex.exec(html)) !== null && results.length < count) {
        const url = decodeURIComponent(match[1]);
        const title = this._stripTags(match[2]).trim();
        if (url.startsWith('http') && title && !url.includes('google.com')) {
          results.push({ title, url, snippet: '' });
        }
      }
    }

    return results;
  }

  _parseDuckDuckGoResults(html, count) {
    const results = [];
    // DuckDuckGo HTML 版结果
    const blockRegex = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match;
    while ((match = blockRegex.exec(html)) !== null && results.length < count) {
      const block = match[1];
      const linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
      if (linkMatch) {
        let url = linkMatch[1];
        // DuckDuckGo 有时用重定向 URL
        const directMatch = url.match(/uddg=([^&]+)/);
        if (directMatch) url = decodeURIComponent(directMatch[1]);
        results.push({
          title: this._stripTags(linkMatch[2]).trim(),
          url,
          snippet: snippetMatch ? this._stripTags(snippetMatch[1]).trim() : ''
        });
      }
    }
    return results;
  }

  // ==================== HTTP 请求 ====================

  /**
   * 使用 Node.js 内置 https/http 模块发送 GET 请求
   */
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? require('https') : require('http');
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: this.requestTimeout,
      };

      const req = mod.get(url, options, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          this._httpGet(redirectUrl).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // 尝试从 Content-Type 获取编码
          const contentType = res.headers['content-type'] || '';
          const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
          const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';
          
          try {
            const { TextDecoder } = require('util');
            const decoder = new TextDecoder(charset);
            resolve(decoder.decode(buffer));
          } catch {
            resolve(buffer.toString('utf-8'));
          }
        });
        res.on('error', reject);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`请求超时 (${this.requestTimeout}ms)`));
      });

      req.on('error', reject);
    });
  }

  // ==================== HTML 处理 ====================

  /**
   * 从 HTML 中提取正文文本
   */
  _extractText(html) {
    if (!html) return '';

    // 检查是否是 JSON 响应
    const trimmed = html.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return trimmed; // 直接返回 JSON
      } catch {
        // 不是有效 JSON，继续 HTML 处理
      }
    }

    let text = html;
    // 移除 <script> 和 <style>
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    // 移除 HTML 注释
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // 移除 nav、header、footer
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    // 保留段落分隔
    text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
    // 移除所有剩余标签
    text = text.replace(/<[^>]+>/g, '');
    // 解码 HTML 实体
    text = this._decodeEntities(text);
    // 压缩空白
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n+/g, '\n\n');
    return text.trim();
  }

  /**
   * 移除 HTML 标签（保留文本）
   */
  _stripTags(html) {
    if (!html) return '';
    return this._decodeEntities(html.replace(/<[^>]+>/g, ''));
  }

  /**
   * 解码常见 HTML 实体
   */
  _decodeEntities(text) {
    const entities = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
      '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&#x27;': "'",
      '&#x2F;': '/', '&mdash;': '—', '&ndash;': '–',
      '&hellip;': '…', '&copy;': '©', '&reg;': '®',
    };
    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
      result = result.split(entity).join(char);
    }
    // 数字实体
    result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
    return result;
  }
}

module.exports = WebToolsPlugin;
