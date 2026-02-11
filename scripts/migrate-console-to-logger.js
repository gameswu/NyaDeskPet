#!/usr/bin/env node

/**
 * 日志迁移脚本
 * 自动将所有 console.log/error/warn/info/debug 替换为 logger 调用
 * 
 * 使用方法:
 *   npm run migrate-logger:preview  # 预览模式，不修改文件
 *   npm run migrate-logger          # 执行实际替换
 * 
 * 功能:
 *   - 自动扫描所有 TypeScript 文件
 *   - 识别并替换 console.log/error/warn/info/debug
 *   - 自动区分渲染进程 (window.logger) 和主进程 (logger)
 *   - 排除 logger.ts 自身的 console 调用
 *   - 生成详细的统计报告
 * 
 * 级别映射:
 *   console.log   → logger.info
 *   console.info  → logger.info
 *   console.warn  → logger.warn
 *   console.error → logger.error
 *   console.debug → logger.debug
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// 配置
const CONFIG = {
  // 需要扫描的目录
  scanDirs: [
    'renderer/js/**/*.ts',
    'src/**/*.ts'
  ],
  // 排除的文件（这些文件中的 console 保留）
  excludeFiles: [
    'renderer/js/logger.ts',  // logger 自身的初始化日志
    'src/logger.ts'            // 主进程 logger 的初始化日志
  ],
  // 日志级别映射
  levelMapping: {
    'log': 'info',
    'info': 'info',
    'warn': 'warn',
    'error': 'error',
    'debug': 'debug'
  },
  // 是否执行实际替换（false 为预览模式）
  dryRun: process.argv.includes('--dry-run'),
  // 是否显示详细信息
  verbose: process.argv.includes('--verbose')
};

/**
 * 统计信息
 */
const stats = {
  totalFiles: 0,
  modifiedFiles: 0,
  totalReplacements: 0,
  byLevel: {
    log: 0,
    info: 0,
    warn: 0,
    error: 0,
    debug: 0
  }
};

/**
 * 检查文件是否需要排除
 */
function shouldExclude(filePath) {
  return CONFIG.excludeFiles.some(pattern => filePath.includes(pattern));
}

/**
 * 转换 console 调用为 logger 调用
 */
function convertConsoleToLogger(content, filePath) {
  let modified = false;
  let replacements = 0;
  
  // 判断是渲染进程还是主进程
  const isRenderer = filePath.includes('renderer/');
  const loggerPrefix = isRenderer ? 'window.logger' : 'logger';
  
  // 正则表达式匹配 console.xxx() 调用
  // 支持多种格式：console.log('xxx'), console.error('xxx', error), etc.
  const consoleRegex = /console\.(log|info|warn|error|debug)\(/g;
  
  const newContent = content.replace(consoleRegex, (match, level) => {
    modified = true;
    replacements++;
    stats.byLevel[level]++;
    
    const loggerLevel = CONFIG.levelMapping[level];
    
    if (CONFIG.verbose) {
      console.log(`  [${level} → ${loggerLevel}] ${match}`);
    }
    
    return `${loggerPrefix}.${loggerLevel}(`;
  });
  
  if (modified) {
    stats.modifiedFiles++;
    stats.totalReplacements += replacements;
    console.log(`✓ ${filePath} (${replacements} 处替换)`);
  }
  
  return { content: newContent, modified };
}

/**
 * 处理单个文件
 */
async function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { content: newContent, modified } = convertConsoleToLogger(content, filePath);
    
    if (modified && !CONFIG.dryRun) {
      fs.writeFileSync(filePath, newContent, 'utf-8');
    }
  } catch (error) {
    console.error(`✗ 处理文件失败: ${filePath}`, error.message);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🔍 开始扫描项目文件...\n');
  
  if (CONFIG.dryRun) {
    console.log('📋 预览模式（不会实际修改文件）\n');
  }
  
  // 扫描所有文件
  const allFiles = [];
  for (const pattern of CONFIG.scanDirs) {
    const files = glob.sync(pattern, { cwd: process.cwd() });
    allFiles.push(...files);
  }
  
  // 过滤排除的文件
  const filesToProcess = allFiles.filter(file => !shouldExclude(file));
  stats.totalFiles = filesToProcess.length;
  
  console.log(`找到 ${stats.totalFiles} 个文件需要扫描\n`);
  console.log('正在处理...\n');
  
  // 处理每个文件
  for (const file of filesToProcess) {
    await processFile(file);
  }
  
  // 输出统计信息
  console.log('\n' + '='.repeat(60));
  console.log('📊 统计信息');
  console.log('='.repeat(60));
  console.log(`总文件数: ${stats.totalFiles}`);
  console.log(`修改文件数: ${stats.modifiedFiles}`);
  console.log(`总替换数: ${stats.totalReplacements}`);
  console.log('\n按级别分类:');
  console.log(`  console.log   → logger.info:  ${stats.byLevel.log}`);
  console.log(`  console.info  → logger.info:  ${stats.byLevel.info}`);
  console.log(`  console.warn  → logger.warn:  ${stats.byLevel.warn}`);
  console.log(`  console.error → logger.error: ${stats.byLevel.error}`);
  console.log(`  console.debug → logger.debug: ${stats.byLevel.debug}`);
  console.log('='.repeat(60));
  
  if (CONFIG.dryRun) {
    console.log('\n💡 这是预览模式，未实际修改文件');
    console.log('   执行实际替换请运行: node scripts/migrate-console-to-logger.js');
  } else {
    console.log('\n✅ 迁移完成！');
    console.log('   请运行 npm run compile 检查是否有编译错误');
  }
}

// 运行
main().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
