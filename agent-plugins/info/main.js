/**
 * 项目信息指令插件 (Info Command Plugin)
 * 
 * 提供 /info 斜杠指令，用于输出 NyaDeskPet 项目基本信息和仓库地址。
 * 作为指令系统的测试与示范插件。
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');
const path = require('path');
const fs = require('fs');

class InfoPlugin extends AgentPlugin {

  /** 项目信息（从 package.json 读取） */
  projectInfo = {
    name: 'NyaDeskPet',
    version: '未知',
    description: '跨平台 Live2D 桌面宠物应用',
    author: 'gameswu',
    license: 'MIT',
    repository: 'https://github.com/gameswu/NyaDeskPet'
  };

  async initialize() {
    // 尝试从 package.json 读取项目信息
    this._loadPackageInfo();

    // 注册 /info 指令
    this.ctx.registerCommand(
      {
        name: 'info',
        description: '显示 NyaDeskPet 项目信息和仓库地址',
        category: '系统',
        params: [
          {
            name: 'section',
            description: '查看指定部分：basic（基本信息）、tech（技术栈）、all（全部），默认 all',
            type: 'string',
            required: false,
            default: 'all',
            choices: [
              { name: '全部', value: 'all' },
              { name: '基本信息', value: 'basic' },
              { name: '技术栈', value: 'tech' }
            ]
          }
        ]
      },
      (args) => this._handleInfo(args)
    );

    this.ctx.logger.info('项目信息插件已初始化');
  }

  async terminate() {
    this.ctx.unregisterCommand('info');
    this.ctx.logger.info('项目信息插件已停止');
  }

  /**
   * 从 package.json 加载项目信息
   */
  _loadPackageInfo() {
    try {
      // 从插件目录向上查找项目根目录的 package.json
      const rootDir = path.resolve(__dirname, '..', '..');
      const pkgPath = path.join(rootDir, 'package.json');
      
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) this.projectInfo.name = pkg.name;
        if (pkg.version) this.projectInfo.version = pkg.version;
        if (pkg.description) this.projectInfo.description = pkg.description;
        if (pkg.author) this.projectInfo.author = typeof pkg.author === 'string' ? pkg.author : pkg.author.name || this.projectInfo.author;
        if (pkg.license) this.projectInfo.license = pkg.license;
        if (pkg.repository) {
          this.projectInfo.repository = typeof pkg.repository === 'string' 
            ? pkg.repository 
            : pkg.repository.url || this.projectInfo.repository;
        }
        this.ctx.logger.info(`已从 package.json 加载项目信息 (v${this.projectInfo.version})`);
      }
    } catch (error) {
      this.ctx.logger.warn(`读取 package.json 失败: ${error.message}`);
    }
  }

  /**
   * 处理 /info 指令
   */
  _handleInfo(args) {
    const section = (args.section || 'all').toString().toLowerCase();

    const parts = [];

    // 基本信息
    if (section === 'all' || section === 'basic') {
      parts.push(
        `📦 ${this.projectInfo.name}`,
        `   版本: ${this.projectInfo.version}`,
        `   描述: ${this.projectInfo.description}`,
        `   作者: ${this.projectInfo.author}`,
        `   许可: ${this.projectInfo.license}`,
        `   仓库: ${this.projectInfo.repository}`
      );
    }

    // 技术栈
    if (section === 'all' || section === 'tech') {
      if (parts.length > 0) parts.push('');
      parts.push(
        '🛠️ 技术栈',
        '   框架: Electron 28 + TypeScript 5.3',
        '   渲染: PixiJS 7.3 + Live2D Cubism SDK',
        '   通信: WebSocket（实时双向通信）',
        '   音频: MediaSource Extensions（MSE 流式播放）',
        '   语音: Sherpa-ONNX（本地 ASR 语音识别）',
        '   AI: 多 Provider 支持（OpenAI / Anthropic / Gemini 等）'
      );
    }

    if (parts.length === 0) {
      return {
        command: 'info',
        success: false,
        error: `未知的信息类型: ${section}，可选值: all, basic, tech`
      };
    }

    return {
      command: 'info',
      success: true,
      text: parts.join('\n')
    };
  }
}

module.exports = InfoPlugin;
module.exports.default = InfoPlugin;
