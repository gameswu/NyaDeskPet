#!/usr/bin/env node

/**
 * i18n 键值检查工具
 * 扫描HTML和代码文件中的所有i18n键，并检查它们是否在语言文件中都有对应
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
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 配置路径
const projectRoot = path.join(__dirname, '..');
const rendererDir = path.join(projectRoot, 'renderer');
const htmlFile = path.join(rendererDir, 'index.html');
const localesDir = path.join(rendererDir, 'locales');
const jsDir = path.join(rendererDir, 'js');

// 递归获取目录下所有文件
function getAllFiles(dirPath, fileExtensions = []) {
  const files = [];
  
  function traverse(currentPath) {
    if (!fs.existsSync(currentPath)) {
      return;
    }
    
    const stats = fs.statSync(currentPath);
    
    if (stats.isDirectory()) {
      const entries = fs.readdirSync(currentPath);
      entries.forEach(entry => {
        traverse(path.join(currentPath, entry));
      });
    } else if (stats.isFile()) {
      if (fileExtensions.length === 0 || fileExtensions.some(ext => currentPath.endsWith(ext))) {
        files.push(currentPath);
      }
    }
  }
  
  traverse(dirPath);
  return files;
}

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

  return Array.from(keys);
}

// 从代码文件中提取 i18n 键
function extractI18nKeysFromCode(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const keys = new Set();
  
  // 匹配 i18nManager.t('key') 或 i18n.t('key') 或 t('key')
  const tFunctionRegex = /\b(?:i18nManager|i18n)?\.?t\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = tFunctionRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  
  // 匹配 i18nManager.translate('key') 或类似方法
  const translateRegex = /\b(?:i18nManager|i18n)\.translate\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = translateRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  
  // 匹配字符串模板中的 data-i18n="key"（用于动态生成的HTML）
  const stringTemplateI18nRegex = /data-i18n=["']([^"']+)["']/g;
  while ((match = stringTemplateI18nRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  
  // 匹配 getAttribute('data-i18n')
  const getAttributeRegex = /getAttribute\s*\(\s*['"]data-i18n['"]\s*\)/g;
  // 这种情况比较复杂，先跳过动态键
  
  return Array.from(keys);
}

/**
 * 检测 tProvider() 动态键模式
 * tProvider(providerId, path, fallback) 生成键: agent.providers.{providerId}.{path}
 * 扫描代码中的 tProvider 调用，提取 path 参数模式
 */
function extractProviderDynamicPaths(codeFiles) {
  const paths = new Set();
  
  for (const filePath of codeFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    // 匹配 tProvider(xxx, 'fields.apiKey.label', ...) 或 tProvider(pid, `fields.${field.key}.label`, ...)
    // 静态 path 参数
    const staticRegex = /tProvider\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = staticRegex.exec(content)) !== null) {
      paths.add(match[1]);
    }
    // 模板字面量 path 参数，例如 `fields.${field.key}.label`
    // 提取固定部分的后缀模式
    const templateRegex = /tProvider\s*\([^,]+,\s*`([^`]+)`/g;
    while ((match = templateRegex.exec(content)) !== null) {
      const tpl = match[1];
      // 提取最后的固定后缀，如 `fields.${field.key}.label` → '.label'
      const suffixMatch = tpl.match(/\}\.([\w.]+)$/);
      if (suffixMatch) {
        paths.add(`*.${suffixMatch[1]}`);
      }
      // 提取固定前缀，如 `fields.${...}` → 'fields'
      const prefixMatch = tpl.match(/^([\w.]+)\.\$\{/);
      if (prefixMatch) {
        paths.add(`${prefixMatch[1]}.*`);
      }
    }
  }
  
  return paths;
}

/**
 * 检测 tTTSProvider() 动态键模式
 * tTTSProvider(providerId, path, fallback) 生成键: agent.ttsProviders.{providerId}.{path}
 * 扫描代码中的 tTTSProvider 调用，提取 path 参数模式
 */
function extractTTSProviderDynamicPaths(codeFiles) {
  const paths = new Set();
  
  for (const filePath of codeFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    // 静态 path 参数
    const staticRegex = /tTTSProvider\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = staticRegex.exec(content)) !== null) {
      paths.add(match[1]);
    }
    // 模板字面量 path 参数
    const templateRegex = /tTTSProvider\s*\([^,]+,\s*`([^`]+)`/g;
    while ((match = templateRegex.exec(content)) !== null) {
      const tpl = match[1];
      const suffixMatch = tpl.match(/\}\.([\.\w]+)$/);
      if (suffixMatch) {
        paths.add(`*.${suffixMatch[1]}`);
      }
      const prefixMatch = tpl.match(/^([\.\w]+)\.\$\{/);
      if (prefixMatch) {
        paths.add(`${prefixMatch[1]}.*`);
      }
    }
  }
  
  return paths;
}

/**
 * 检查 Provider 元信息 i18n 键的完整性
 * 约定结构: agent.providers.{providerId}.{name|description|fields.{key}.{label|description|placeholder|options.{value}}}
 * 对照两个语言文件，检查结构是否一致
 */
function checkProviderI18nKeys(zhCN, enUS) {
  const zhProviders = getNestedValue(zhCN, 'agent.providers') || {};
  const enProviders = getNestedValue(enUS, 'agent.providers') || {};
  
  const zhIds = Object.keys(zhProviders);
  const enIds = Object.keys(enProviders);
  const allIds = [...new Set([...zhIds, ...enIds])];
  
  const issues = [];
  
  if (allIds.length === 0) {
    return { issues, providerKeyCount: 0 };
  }
  
  // 检查两语言文件中的 provider ID 是否一致
  const onlyInZh = zhIds.filter(id => !enIds.includes(id));
  const onlyInEn = enIds.filter(id => !zhIds.includes(id));
  
  for (const id of onlyInZh) {
    issues.push({ type: 'missing', locale: 'en-US', key: `agent.providers.${id}`, message: `Provider "${id}" 仅存在于 zh-CN` });
  }
  for (const id of onlyInEn) {
    issues.push({ type: 'missing', locale: 'zh-CN', key: `agent.providers.${id}`, message: `Provider "${id}" 仅存在于 en-US` });
  }
  
  // 对每个 provider 检查键结构一致性
  const commonIds = zhIds.filter(id => enIds.includes(id));
  for (const pid of commonIds) {
    const zhFlat = getFlattenedKeys(zhProviders[pid], `agent.providers.${pid}`);
    const enFlat = getFlattenedKeys(enProviders[pid], `agent.providers.${pid}`);
    
    const zhSet = new Set(zhFlat);
    const enSet = new Set(enFlat);
    
    for (const key of zhFlat) {
      if (!enSet.has(key)) {
        issues.push({ type: 'missing', locale: 'en-US', key, message: `Provider "${pid}" 键仅在 zh-CN 中存在` });
      }
    }
    for (const key of enFlat) {
      if (!zhSet.has(key)) {
        issues.push({ type: 'missing', locale: 'zh-CN', key, message: `Provider "${pid}" 键仅在 en-US 中存在` });
      }
    }
    
    // 检查空值
    for (const key of zhFlat) {
      const val = getNestedValue(zhCN, key);
      if (typeof val === 'string' && val === '') {
        issues.push({ type: 'empty', locale: 'zh-CN', key, message: '空值' });
      }
    }
    for (const key of enFlat) {
      const val = getNestedValue(enUS, key);
      if (typeof val === 'string' && val === '') {
        issues.push({ type: 'empty', locale: 'en-US', key, message: '空值' });
      }
    }
  }
  
  // 统计 provider 键总数
  const allProviderKeys = new Set([
    ...getFlattenedKeys(zhProviders, 'agent.providers'),
    ...getFlattenedKeys(enProviders, 'agent.providers')
  ]);
  
  return { issues, providerKeyCount: allProviderKeys.size };
}

/**
 * 检查 TTS Provider 元信息 i18n 键的完整性
 * 约定结构: agent.ttsProviders.{providerId}.{name|description|fields.{key}.{label|description|placeholder|options.{value}}}
 */
function checkTTSProviderI18nKeys(zhCN, enUS) {
  const zhProviders = getNestedValue(zhCN, 'agent.ttsProviders') || {};
  const enProviders = getNestedValue(enUS, 'agent.ttsProviders') || {};
  
  const zhIds = Object.keys(zhProviders);
  const enIds = Object.keys(enProviders);
  const allIds = [...new Set([...zhIds, ...enIds])];
  
  const issues = [];
  
  if (allIds.length === 0) {
    return { issues, providerKeyCount: 0 };
  }
  
  const onlyInZh = zhIds.filter(id => !enIds.includes(id));
  const onlyInEn = enIds.filter(id => !zhIds.includes(id));
  
  for (const id of onlyInZh) {
    issues.push({ type: 'missing', locale: 'en-US', key: `agent.ttsProviders.${id}`, message: `TTS Provider "${id}" 仅存在于 zh-CN` });
  }
  for (const id of onlyInEn) {
    issues.push({ type: 'missing', locale: 'zh-CN', key: `agent.ttsProviders.${id}`, message: `TTS Provider "${id}" 仅存在于 en-US` });
  }
  
  const commonIds = zhIds.filter(id => enIds.includes(id));
  for (const pid of commonIds) {
    const zhFlat = getFlattenedKeys(zhProviders[pid], `agent.ttsProviders.${pid}`);
    const enFlat = getFlattenedKeys(enProviders[pid], `agent.ttsProviders.${pid}`);
    
    const zhSet = new Set(zhFlat);
    const enSet = new Set(enFlat);
    
    for (const key of zhFlat) {
      if (!enSet.has(key)) {
        issues.push({ type: 'missing', locale: 'en-US', key, message: `TTS Provider "${pid}" 键仅在 zh-CN 中存在` });
      }
    }
    for (const key of enFlat) {
      if (!zhSet.has(key)) {
        issues.push({ type: 'missing', locale: 'zh-CN', key, message: `TTS Provider "${pid}" 键仅在 en-US 中存在` });
      }
    }
    
    for (const key of zhFlat) {
      const val = getNestedValue(zhCN, key);
      if (typeof val === 'string' && val === '') {
        issues.push({ type: 'empty', locale: 'zh-CN', key, message: '空值' });
      }
    }
    for (const key of enFlat) {
      const val = getNestedValue(enUS, key);
      if (typeof val === 'string' && val === '') {
        issues.push({ type: 'empty', locale: 'en-US', key, message: '空值' });
      }
    }
  }
  
  const allProviderKeys = new Set([
    ...getFlattenedKeys(zhProviders, 'agent.ttsProviders'),
    ...getFlattenedKeys(enProviders, 'agent.ttsProviders')
  ]);
  
  return { issues, providerKeyCount: allProviderKeys.size };
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
  
  const htmlKeys = extractI18nKeysFromHTML(htmlFile);
  log(`  找到 ${htmlKeys.length} 个i18n键\n`, 'green');

  // 2. 扫描代码文件中的键
  log('💻 扫描代码文件 (TS/JS)...', 'cyan');
  const codeFiles = getAllFiles(jsDir, ['.ts', '.js']);
  const codeKeysMap = new Map(); // 文件路径 -> 键数组
  const allCodeKeys = new Set();
  
  codeFiles.forEach(filePath => {
    const keys = extractI18nKeysFromCode(filePath);
    if (keys.length > 0) {
      const relativePath = path.relative(projectRoot, filePath);
      codeKeysMap.set(relativePath, keys);
      keys.forEach(key => allCodeKeys.add(key));
    }
  });
  
  log(`  扫描了 ${codeFiles.length} 个文件`, 'blue');
  log(`  找到 ${allCodeKeys.size} 个i18n键（来自 ${codeKeysMap.size} 个文件）\n`, 'green');
  
  if (codeKeysMap.size > 0) {
    log('  使用i18n的文件:', 'blue');
    for (const [filePath, keys] of codeKeysMap) {
      log(`    - ${filePath} (${keys.length}个键)`, 'blue');
    }
    log('');
  }

  // 3. 合并所有使用的键
  const allUsedKeys = new Set([...htmlKeys, ...allCodeKeys]);
  const usedKeys = Array.from(allUsedKeys).sort();
  
  log(`📊 总计使用的唯一键: ${usedKeys.length}`, 'cyan');
  log(`  - HTML: ${htmlKeys.length}`, 'blue');
  log(`  - 代码: ${allCodeKeys.size}`, 'blue');
  log('');

  // 4. 加载语言文件
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

  // 5. 检查使用的键是否在语言文件中存在
  log('🔍 检查键的完整性...', 'cyan');
  
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
      missingInZhCN.forEach(key => {
        // 找出是在哪个文件中使用的
        const sources = [];
        if (htmlKeys.includes(key)) sources.push('HTML');
        for (const [filePath, keys] of codeKeysMap) {
          if (keys.includes(key)) {
            sources.push(path.basename(filePath));
          }
        }
        log(`    - ${key} (用于: ${sources.join(', ')})`, 'yellow');
      });
    }
    if (missingInEnUS.length > 0) {
      log(`  ✗ en-US.json 中缺失 ${missingInEnUS.length} 个键:`, 'red');
      missingInEnUS.forEach(key => {
        const sources = [];
        if (htmlKeys.includes(key)) sources.push('HTML');
        for (const [filePath, keys] of codeKeysMap) {
          if (keys.includes(key)) {
            sources.push(path.basename(filePath));
          }
        }
        log(`    - ${key} (用于: ${sources.join(', ')})`, 'yellow');
      });
    }
  }

  // 6. 检查语言文件中未使用的键（排除 Provider 元信息动态键）
  log('\n🔍 检查未使用的键...', 'cyan');
  
  const zhCNKeys = getFlattenedKeys(zhCN);
  const enUSKeys = getFlattenedKeys(enUS);
  
  // agent.providers.* / agent.ttsProviders.* 下的键由 tProvider() / tTTSProvider() 动态拼接使用，不算作"未使用"
  const isProviderKey = key => key.startsWith('agent.providers.') || key.startsWith('agent.ttsProviders.');
  
  const unusedInZhCN = zhCNKeys.filter(key => !usedKeys.includes(key) && !isProviderKey(key));
  const unusedInEnUS = enUSKeys.filter(key => !usedKeys.includes(key) && !isProviderKey(key));

  if (unusedInZhCN.length > 0) {
    log(`  ⚠ zh-CN.json 中有 ${unusedInZhCN.length} 个未使用的键:`, 'yellow');
    unusedInZhCN.slice(0, 10).forEach(key => log(`    - ${key}`, 'yellow'));
    if (unusedInZhCN.length > 10) {
      log(`    ... 还有 ${unusedInZhCN.length - 10} 个`, 'yellow');
    }
  }

  if (unusedInEnUS.length > 0) {
    log(`  ⚠ en-US.json 中有 ${unusedInEnUS.length} 个未使用的键:`, 'yellow');
    unusedInEnUS.slice(0, 10).forEach(key => log(`    - ${key}`, 'yellow'));
    if (unusedInEnUS.length > 10) {
      log(`    ... 还有 ${unusedInEnUS.length - 10} 个`, 'yellow');
    }
  }

  if (unusedInZhCN.length === 0 && unusedInEnUS.length === 0) {
    log('  ✓ 没有未使用的键', 'green');
  }

  // 7. 检查两个语言文件之间的差异（排除 Provider 键，Provider 键由专项检查覆盖）
  log('\n🔍 检查语言文件之间的差异...', 'cyan');
  
  const onlyInZhCN = zhCNKeys.filter(key => !enUSKeys.includes(key) && !isProviderKey(key));
  const onlyInEnUS = enUSKeys.filter(key => !zhCNKeys.includes(key) && !isProviderKey(key));


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

  // 8. 检查键值完整性（是否有空值或格式问题）
  log('\n🔍 检查键值质量...', 'cyan');
  
  const emptyValuesZhCN = [];
  const emptyValuesEnUS = [];
  
  usedKeys.forEach(key => {
    const zhValue = getNestedValue(zhCN, key);
    const enValue = getNestedValue(enUS, key);
    
    if (zhValue !== undefined && (zhValue === '' || zhValue === null)) {
      emptyValuesZhCN.push(key);
    }
    if (enValue !== undefined && (enValue === '' || enValue === null)) {
      emptyValuesEnUS.push(key);
    }
  });
  
  if (emptyValuesZhCN.length > 0) {
    log(`  ⚠ zh-CN.json 中有 ${emptyValuesZhCN.length} 个空值:`, 'yellow');
    emptyValuesZhCN.forEach(key => log(`    - ${key}`, 'yellow'));
  }
  
  if (emptyValuesEnUS.length > 0) {
    log(`  ⚠ en-US.json 中有 ${emptyValuesEnUS.length} 个空值:`, 'yellow');
    emptyValuesEnUS.forEach(key => log(`    - ${key}`, 'yellow'));
  }
  
  if (emptyValuesZhCN.length === 0 && emptyValuesEnUS.length === 0) {
    log('  ✓ 所有使用的键都有有效值', 'green');
  }

  // 9. Provider 元信息 i18n 专项检查
  log('\n🧩 检查 Provider 元信息 i18n 键...', 'cyan');
  
  const providerDynamicPaths = extractProviderDynamicPaths(codeFiles);
  const providerCheck = checkProviderI18nKeys(zhCN, enUS);
  
  if (providerCheck.providerKeyCount > 0) {
    log(`  Provider i18n 键总数: ${providerCheck.providerKeyCount}`, 'blue');
    
    if (providerDynamicPaths.size > 0) {
      log(`  tProvider() 使用的路径模式: ${Array.from(providerDynamicPaths).join(', ')}`, 'blue');
    }
  }
  
  if (providerCheck.issues.length > 0) {
    const missingIssues = providerCheck.issues.filter(i => i.type === 'missing');
    const emptyIssues = providerCheck.issues.filter(i => i.type === 'empty');
    
    if (missingIssues.length > 0) {
      log(`  ✗ Provider 键两语言文件不一致 (${missingIssues.length} 处):`, 'red');
      missingIssues.forEach(issue => {
        log(`    - [${issue.locale}] ${issue.key} — ${issue.message}`, 'yellow');
      });
    }
    
    if (emptyIssues.length > 0) {
      log(`  ⚠ Provider 键空值 (${emptyIssues.length} 处):`, 'yellow');
      emptyIssues.forEach(issue => {
        log(`    - [${issue.locale}] ${issue.key}`, 'yellow');
      });
    }
  } else if (providerCheck.providerKeyCount > 0) {
    log(`  ✓ 所有 Provider 元信息键在两个语言文件中一致且完整`, 'green');
  } else {
    log(`  - 暂无 Provider 元信息 i18n 键`, 'blue');
  }

  // 9.5. TTS Provider 元信息 i18n 专项检查
  log('\n🔊 检查 TTS Provider 元信息 i18n 键...', 'cyan');
  
  const ttsProviderDynamicPaths = extractTTSProviderDynamicPaths(codeFiles);
  const ttsProviderCheck = checkTTSProviderI18nKeys(zhCN, enUS);
  
  if (ttsProviderCheck.providerKeyCount > 0) {
    log(`  TTS Provider i18n 键总数: ${ttsProviderCheck.providerKeyCount}`, 'blue');
    
    if (ttsProviderDynamicPaths.size > 0) {
      log(`  tTTSProvider() 使用的路径模式: ${Array.from(ttsProviderDynamicPaths).join(', ')}`, 'blue');
    }
  }
  
  if (ttsProviderCheck.issues.length > 0) {
    const missingIssues = ttsProviderCheck.issues.filter(i => i.type === 'missing');
    const emptyIssues = ttsProviderCheck.issues.filter(i => i.type === 'empty');
    
    if (missingIssues.length > 0) {
      log(`  ✗ TTS Provider 键两语言文件不一致 (${missingIssues.length} 处):`, 'red');
      missingIssues.forEach(issue => {
        log(`    - [${issue.locale}] ${issue.key} — ${issue.message}`, 'yellow');
      });
    }
    
    if (emptyIssues.length > 0) {
      log(`  ⚠ TTS Provider 键空值 (${emptyIssues.length} 处):`, 'yellow');
      emptyIssues.forEach(issue => {
        log(`    - [${issue.locale}] ${issue.key}`, 'yellow');
      });
    }
  } else if (ttsProviderCheck.providerKeyCount > 0) {
    log(`  ✓ 所有 TTS Provider 元信息键在两个语言文件中一致且完整`, 'green');
  } else {
    log(`  - 暂无 TTS Provider 元信息 i18n 键`, 'blue');
  }

  // 10. 生成详细报告（可选）
  if (process.argv.includes('--detailed')) {
    log('\n📋 详细报告...', 'cyan');
    log('\n  HTML中使用的键:', 'magenta');
    htmlKeys.sort().forEach(key => log(`    - ${key}`, 'blue'));
    
    if (allCodeKeys.size > 0) {
      log('\n  代码中使用的键:', 'magenta');
      Array.from(allCodeKeys).sort().forEach(key => log(`    - ${key}`, 'blue'));
    }
    
    // Provider 键详细列表
    const zhProviders = getNestedValue(zhCN, 'agent.providers') || {};
    const providerIds = Object.keys(zhProviders);
    if (providerIds.length > 0) {
      log('\n  Provider 元信息键:', 'magenta');
      for (const pid of providerIds) {
        const keys = getFlattenedKeys(zhProviders[pid], `agent.providers.${pid}`);
        log(`    [${pid}] ${keys.length} 个键`, 'blue');
        keys.forEach(key => log(`      - ${key}`, 'blue'));
      }
    }
    
    // TTS Provider 键详细列表
    const zhTTSProviders = getNestedValue(zhCN, 'agent.ttsProviders') || {};
    const ttsProviderIds = Object.keys(zhTTSProviders);
    if (ttsProviderIds.length > 0) {
      log('\n  TTS Provider 元信息键:', 'magenta');
      for (const pid of ttsProviderIds) {
        const keys = getFlattenedKeys(zhTTSProviders[pid], `agent.ttsProviders.${pid}`);
        log(`    [${pid}] ${keys.length} 个键`, 'blue');
        keys.forEach(key => log(`      - ${key}`, 'blue'));
      }
    }
  }

  // 11. 总结
  log('\n=== 检查总结 ===\n', 'bright');
  log(`📊 统计信息:`, 'cyan');
  log(`  - HTML中的键: ${htmlKeys.length}`, 'blue');
  log(`  - 代码中的键: ${allCodeKeys.size}`, 'blue');
  log(`  - 总唯一键数: ${usedKeys.length}`, 'blue');
  log(`  - Provider动态键数: ${providerCheck.providerKeyCount}`, 'blue');
  log(`  - TTS Provider动态键数: ${ttsProviderCheck.providerKeyCount}`, 'blue');
  log(`  - zh-CN.json总键数: ${zhCNKeys.length}`, 'blue');
  log(`  - en-US.json总键数: ${enUSKeys.length}`, 'blue');
  
  const providerHasErrors = providerCheck.issues.some(i => i.type === 'missing');
  const providerHasWarnings = providerCheck.issues.some(i => i.type === 'empty');
  const ttsProviderHasErrors = ttsProviderCheck.issues.some(i => i.type === 'missing');
  const ttsProviderHasWarnings = ttsProviderCheck.issues.some(i => i.type === 'empty');
  
  const hasErrors = missingInZhCN.length > 0 || missingInEnUS.length > 0 || 
                    emptyValuesZhCN.length > 0 || emptyValuesEnUS.length > 0 ||
                    providerHasErrors || ttsProviderHasErrors;
  const hasWarnings = unusedInZhCN.length > 0 || unusedInEnUS.length > 0 || 
                      onlyInZhCN.length > 0 || onlyInEnUS.length > 0 ||
                      providerHasWarnings || ttsProviderHasWarnings;

  if (!hasErrors && !hasWarnings) {
    log('\n✅ 太棒了！所有i18n键都正确配置！', 'green');
    process.exit(0);
  } else if (hasErrors) {
    log('\n❌ 发现错误！请修复缺失的键或空值。', 'red');
    log('提示：使用 --detailed 参数查看完整的键列表', 'yellow');
    process.exit(1);
  } else {
    log('\n⚠️  发现一些警告，建议检查。', 'yellow');
    log('提示：使用 --detailed 参数查看完整的键列表', 'yellow');
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
