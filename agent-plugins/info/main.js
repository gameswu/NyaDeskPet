/**
 * 项目信息指令插件 (Info Command Plugin)
 * 
 * 提供 /info 斜杠指令，用于输出 NyaDeskPet 项目基本信息和仓库地址。
 * 作为指令系统的测试与示范插件。
 */

const { AgentPlugin } = require('../../dist/agent/agent-plugin');

/** 硬编码的项目信息 */
const PROJECT_INFO = {
  name: 'NyaDeskPet',
  version: '1.0.0',
  description: '跨平台 Live2D 桌面宠物应用',
  author: 'gameswu',
  license: 'MIT',
  repository: 'https://github.com/gameswu/NyaDeskPet'
};

class InfoPlugin extends AgentPlugin {

  async initialize() {
    // 注册 /info 指令
    this.ctx.registerCommand(
      {
        name: 'info',
        description: '显示 NyaDeskPet 项目信息和仓库地址',
        category: '系统',
        params: []
      },
      () => this._handleInfo()
    );

    this.ctx.logger.info('项目信息插件已初始化');
  }

  async terminate() {
    this.ctx.unregisterCommand('info');
    this.ctx.logger.info('项目信息插件已停止');
  }

  /**
   * 处理 /info 指令
   */
  _handleInfo() {
    const text = [
      `📦 ${PROJECT_INFO.name}`,
      `   版本: ${PROJECT_INFO.version}`,
      `   描述: ${PROJECT_INFO.description}`,
      `   作者: ${PROJECT_INFO.author}`,
      `   许可: ${PROJECT_INFO.license}`,
      `   仓库: ${PROJECT_INFO.repository}`
    ].join('\n');

    return {
      command: 'info',
      success: true,
      text
    };
  }
}

module.exports = InfoPlugin;
module.exports.default = InfoPlugin;
