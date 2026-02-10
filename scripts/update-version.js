#!/usr/bin/env node

/**
 * 版本管理脚本
 * 
 * 版本规范：
 * - 正式版：v1.0.0（三位语义化版本）
 * - 开发版：v1.0.0-beta-YYMMDDHHMM（带时间戳）
 * - 热修复：v1.0.0-hotfix-YYMMDDHHMM（带时间戳）
 * 
 * 使用方法：
 *   npm run version release 1.0.0        # 正式版
 *   npm run version beta 1.0.0           # 开发版（自动添加时间戳）
 *   npm run version hotfix 1.0.0         # 热修复版（自动添加时间戳）
 *   npm run version patch                # 补丁版本号+1（如 1.0.0 -> 1.0.1）
 *   npm run version minor                # 次版本号+1（如 1.0.0 -> 1.1.0）
 *   npm run version major                # 主版本号+1（如 1.0.0 -> 2.0.0）
 */

const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function warning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

/**
 * 生成时间戳（YYMMDDHHMM格式）
 */
function generateTimestamp() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${yy}${MM}${dd}${HH}${mm}`;
}

/**
 * 验证版本号格式（语义化版本）
 */
function validateVersion(version) {
  const semverRegex = /^\d+\.\d+\.\d+$/;
  return semverRegex.test(version);
}

/**
 * 解析当前版本号
 */
function parseVersion(version) {
  // 移除 v 前缀和后缀
  const cleanVersion = version.replace(/^v/, '').split('-')[0];
  const parts = cleanVersion.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

/**
 * 递增版本号
 */
function incrementVersion(currentVersion, type) {
  const version = parseVersion(currentVersion);
  
  switch (type) {
    case 'major':
      return `${version.major + 1}.0.0`;
    case 'minor':
      return `${version.major}.${version.minor + 1}.0`;
    case 'patch':
      return `${version.major}.${version.minor}.${version.patch + 1}`;
    default:
      throw new Error(`无效的递增类型: ${type}`);
  }
}

/**
 * 构建完整版本号
 */
function buildVersion(baseVersion, type) {
  if (!validateVersion(baseVersion)) {
    throw new Error(`无效的版本号格式: ${baseVersion}，应为 x.y.z 格式`);
  }

  const timestamp = generateTimestamp();
  
  switch (type) {
    case 'release':
      return `v${baseVersion}`;
    case 'beta':
      return `v${baseVersion}-beta-${timestamp}`;
    case 'hotfix':
      return `v${baseVersion}-hotfix-${timestamp}`;
    default:
      throw new Error(`无效的版本类型: ${type}`);
  }
}

/**
 * 更新 package.json
 */
function updatePackageJson(version) {
  const packagePath = path.join(__dirname, '../package.json');
  const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  packageData.version = version.replace(/^v/, ''); // npm 不需要 v 前缀
  
  fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2) + '\n', 'utf8');
  success(`已更新 package.json: ${packageData.version}`);
}

/**
 * 更新 README.md 中的版本徽章
 */
function updateReadme(version) {
  const readmePath = path.join(__dirname, '../README.md');
  
  if (!fs.existsSync(readmePath)) {
    warning('README.md 不存在，跳过');
    return;
  }
  
  let content = fs.readFileSync(readmePath, 'utf8');
  
  // 更新版本徽章（如果存在）
  const badgeRegex = /!\[Version\]\([^\)]*\)/g;
  const newBadge = `![Version](https://img.shields.io/badge/version-${version.replace(/^v/, '')}-blue)`;
  
  if (badgeRegex.test(content)) {
    content = content.replace(badgeRegex, newBadge);
    fs.writeFileSync(readmePath, content, 'utf8');
    success(`已更新 README.md 版本徽章`);
  } else {
    info('README.md 中未找到版本徽章，跳过');
  }
}

/**
 * 创建版本信息文件
 */
function createVersionFile(version, type, baseVersion) {
  const versionInfo = {
    version: version,
    versionWithoutPrefix: version.replace(/^v/, ''),
    baseVersion: baseVersion,
    type: type,
    buildTime: new Date().toISOString(),
    timestamp: type === 'release' ? null : generateTimestamp()
  };
  
  const versionPath = path.join(__dirname, '../version.json');
  fs.writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2) + '\n', 'utf8');
  success(`已创建版本信息文件: version.json`);
}

/**
 * 显示使用帮助
 */
function showHelp() {
  console.log(`
${colors.bright}版本管理脚本${colors.reset}

${colors.cyan}版本规范：${colors.reset}
  - 正式版：v1.0.0（三位语义化版本）
  - 开发版：v1.0.0-beta-YYMMDDHHMM（带时间戳）
  - 热修复：v1.0.0-hotfix-YYMMDDHHMM（带时间戳）

${colors.cyan}使用方法：${colors.reset}
  ${colors.green}指定完整版本号：${colors.reset}
    npm run version release 1.0.0        # 正式版 -> v1.0.0
    npm run version beta 1.0.0           # 开发版 -> v1.0.0-beta-2602101530
    npm run version hotfix 1.0.0         # 热修复 -> v1.0.0-hotfix-2602101530

  ${colors.green}自动递增版本号：${colors.reset}
    npm run version patch                # 补丁版本号+1（如 1.0.0 -> 1.0.1）
    npm run version minor                # 次版本号+1（如 1.0.0 -> 1.1.0）
    npm run version major                # 主版本号+1（如 1.0.0 -> 2.0.0）

${colors.cyan}示例：${colors.reset}
  npm run version release 2.0.0         # 发布 v2.0.0
  npm run version beta 2.1.0            # 开发版 v2.1.0-beta-2602101530
  npm run version patch                 # 从 v1.0.0 -> v1.0.1
`);
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const type = args[0];
  let baseVersion = args[1];

  try {
    // 读取当前版本
    const packagePath = path.join(__dirname, '../package.json');
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const currentVersion = packageData.version;

    info(`当前版本: v${currentVersion}`);

    // 处理自动递增
    if (['major', 'minor', 'patch'].includes(type)) {
      baseVersion = incrementVersion(currentVersion, type);
      info(`递增后版本: ${baseVersion}`);
      const newVersion = buildVersion(baseVersion, 'release');
      
      console.log();
      log(`${colors.bright}准备更新版本：${colors.reset}`);
      log(`  类型: ${colors.yellow}${type} 递增${colors.reset}`);
      log(`  版本: ${colors.green}${newVersion}${colors.reset}`);
      console.log();

      updatePackageJson(newVersion);
      updateReadme(newVersion);
      createVersionFile(newVersion, 'release', baseVersion);

      console.log();
      success(`版本更新完成！`);
      info(`下一步: git add . && git commit -m "chore: bump version to ${newVersion}" && git tag ${newVersion}`);
      
    } else if (['release', 'beta', 'hotfix'].includes(type)) {
      if (!baseVersion) {
        error('请指定版本号！');
        showHelp();
        process.exit(1);
      }

      const newVersion = buildVersion(baseVersion, type);
      
      console.log();
      log(`${colors.bright}准备更新版本：${colors.reset}`);
      log(`  类型: ${colors.yellow}${type}${colors.reset}`);
      log(`  版本: ${colors.green}${newVersion}${colors.reset}`);
      console.log();

      updatePackageJson(newVersion);
      updateReadme(newVersion);
      createVersionFile(newVersion, type, baseVersion);

      console.log();
      success(`版本更新完成！`);
      
      if (type === 'release') {
        info(`下一步: git add . && git commit -m "chore: release ${newVersion}" && git tag ${newVersion}`);
      } else {
        info(`下一步: git add . && git commit -m "chore: ${type} ${newVersion}"`);
      }
      
    } else {
      error(`无效的版本类型: ${type}`);
      showHelp();
      process.exit(1);
    }

  } catch (err) {
    error(`版本更新失败: ${err.message}`);
    process.exit(1);
  }
}

main();
