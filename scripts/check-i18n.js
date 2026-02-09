#!/usr/bin/env node

/**
 * i18n 键值检查工具
 * 扫描HTML中的所有i18n键，并检查它们是否在语言文件中都有对应
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

// 配置路径
const projectRoot = path.join(__dirname, '..');
const rendererDir = path.join(projectRoot, 'renderer');
const htmlFile = path.join(rendererDir, 'index.html');
const localesDir = path.join(rendererDir, 'locales');

// 读取HTML文件并提取所有i18n键
function extractI18nKeysFromHTML(htmlPath) {
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  const keys = new Set();

  // 匹配 data-i18n="key"
  const dataI18nRegex = /data-i18n="([^"]+)"/g;
  let match;
  while ((match = dataI18nRegex.exec(htmlContent)) !== null) {
    keys.add(match[1]);
  }

  // 匹配 data-i18n-placeholder="key"
  const dataI18nPlaceholderRegex = /data-i18n-placeholder="([^"]+)"/g;
  while ((match = dataI18nPlaceholderRegex.exec(htmlContent)) !== null) {
    keys.add(match[1]);
  }

  // 匹配 data-i18n-title="key"
  const dataI18nTitleRegex = /data-i18n-title="([^"]+)"/g;
  while ((match = dataI18nTitleRegex.exec(htmlContent)) !== null) {
    keys.add(match[1]);
  }

  return Array.from(keys).sort();
}

// 读取语言文件
function loadLocaleFile(localePath) {
  try {
    const content = fs.readFileSync(localePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log(`✗ 无法读取语言文件: ${localePath}`, 'red');
    log(`  错误: ${error.message}`, 'red');
    return null;
  }
}

// 从嵌套对象中获取值
function getNestedValue(obj, path) {
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  
  return current;
}

// 获取语言文件中的所有键（扁平化）
function getFlattenedKeys(obj, prefix = '') {
  const keys = [];
  
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getFlattenedKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  
  return keys;
}

// 检查键是否存在于语言文件中
function checkKeyExists(localeData, key) {
  const value = getNestedValue(localeData, key);
  return value !== undefined;
}

// 主检查函数
function checkI18n() {
  log('\n=== i18n 键值检查工具 ===\n', 'bright');

  // 1. 提取HTML中使用的键
  log('📄 扫描 HTML 文件...', 'cyan');
  if (!fs.existsSync(htmlFile)) {
    log(`✗ HTML文件不存在: ${htmlFile}`, 'red');
    process.exit(1);
  }
  
  const usedKeys = extractI18nKeysFromHTML(htmlFile);
  log(`  找到 ${usedKeys.length} 个i18n键\n`, 'green');

  // 2. 加载语言文件
  log('📦 加载语言文件...', 'cyan');
  const zhCNPath = path.join(localesDir, 'zh-CN.json');
  const enUSPath = path.join(localesDir, 'en-US.json');

  const zhCN = loadLocaleFile(zhCNPath);
  const enUS = loadLocaleFile(enUSPath);

  if (!zhCN || !enUS) {
    process.exit(1);
  }

  log('  ✓ zh-CN.json 已加载', 'green');
  log('  ✓ en-US.json 已加载\n', 'green');

  // 3. 检查HTML中的键是否在语言文件中存在
  log('🔍 检查HTML中的键...', 'cyan');
  
  const missingInZhCN = [];
  const missingInEnUS = [];
  const existsInBoth = [];

  usedKeys.forEach(key => {
    const inZhCN = checkKeyExists(zhCN, key);
    const inEnUS = checkKeyExists(enUS, key);

    if (!inZhCN) missingInZhCN.push(key);
    if (!inEnUS) missingInEnUS.push(key);
    if (inZhCN && inEnUS) existsInBoth.push(key);
  });

  if (missingInZhCN.length === 0 && missingInEnUS.length === 0) {
    log(`  ✓ 所有 ${usedKeys.length} 个键都存在于两个语言文件中`, 'green');
  } else {
    if (missingInZhCN.length > 0) {
      log(`  ✗ zh-CN.json 中缺失 ${missingInZhCN.length} 个键:`, 'red');
      missingInZhCN.forEach(key => log(`    - ${key}`, 'yellow'));
    }
    if (missingInEnUS.length > 0) {
      log(`  ✗ en-US.json 中缺失 ${missingInEnUS.length} 个键:`, 'red');
      missingInEnUS.forEach(key => log(`    - ${key}`, 'yellow'));
    }
  }

  // 4. 检查语言文件中未使用的键
  log('\n🔍 检查未使用的键...', 'cyan');
  
  const zhCNKeys = getFlattenedKeys(zhCN);
  const enUSKeys = getFlattenedKeys(enUS);
  
  const unusedInZhCN = zhCNKeys.filter(key => !usedKeys.includes(key));
  const unusedInEnUS = enUSKeys.filter(key => !usedKeys.includes(key));

  if (unusedInZhCN.length > 0) {
    log(`  ⚠ zh-CN.json 中有 ${unusedInZhCN.length} 个未使用的键:`, 'yellow');
    unusedInZhCN.forEach(key => log(`    - ${key}`, 'yellow'));
  }

  if (unusedInEnUS.length > 0) {
    log(`  ⚠ en-US.json 中有 ${unusedInEnUS.length} 个未使用的键:`, 'yellow');
    unusedInEnUS.forEach(key => log(`    - ${key}`, 'yellow'));
  }

  if (unusedInZhCN.length === 0 && unusedInEnUS.length === 0) {
    log('  ✓ 没有未使用的键', 'green');
  }

  // 5. 检查两个语言文件之间的差异
  log('\n🔍 检查语言文件之间的差异...', 'cyan');
  
  const onlyInZhCN = zhCNKeys.filter(key => !enUSKeys.includes(key));
  const onlyInEnUS = enUSKeys.filter(key => !zhCNKeys.includes(key));

  if (onlyInZhCN.length > 0) {
    log(`  ⚠ 仅存在于 zh-CN.json 的键 (${onlyInZhCN.length}个):`, 'yellow');
    onlyInZhCN.forEach(key => log(`    - ${key}`, 'yellow'));
  }

  if (onlyInEnUS.length > 0) {
    log(`  ⚠ 仅存在于 en-US.json 的键 (${onlyInEnUS.length}个):`, 'yellow');
    onlyInEnUS.forEach(key => log(`    - ${key}`, 'yellow'));
  }

  if (onlyInZhCN.length === 0 && onlyInEnUS.length === 0) {
    log('  ✓ 两个语言文件的键完全一致', 'green');
  }

  // 6. 总结
  log('\n=== 检查总结 ===\n', 'bright');
  log(`📊 统计信息:`, 'cyan');
  log(`  - HTML中使用的键: ${usedKeys.length}`, 'blue');
  log(`  - zh-CN.json总键数: ${zhCNKeys.length}`, 'blue');
  log(`  - en-US.json总键数: ${enUSKeys.length}`, 'blue');
  
  const hasErrors = missingInZhCN.length > 0 || missingInEnUS.length > 0;
  const hasWarnings = unusedInZhCN.length > 0 || unusedInEnUS.length > 0 || 
                      onlyInZhCN.length > 0 || onlyInEnUS.length > 0;

  if (!hasErrors && !hasWarnings) {
    log('\n✅ 太棒了！所有i18n键都正确配置！', 'green');
    process.exit(0);
  } else if (hasErrors) {
    log('\n❌ 发现错误！请修复缺失的键。', 'red');
    process.exit(1);
  } else {
    log('\n⚠️  发现一些警告，建议检查。', 'yellow');
    process.exit(0);
  }
}

// 运行检查
try {
  checkI18n();
} catch (error) {
  log(`\n❌ 检查过程中发生错误:`, 'red');
  log(error.stack, 'red');
  process.exit(1);
}
