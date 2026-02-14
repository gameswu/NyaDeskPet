#!/usr/bin/env node

/**
 * Live2D 参数映射表检查工具
 * 扫描 models/live2d/ 下所有模型目录，验证 param-map.json 映射是否与实际模型数据一致
 *
 * 检查项：
 *  1. param-map.json 格式与版本
 *  2. parameters[].id 是否存在于模型的 cdi3.json 参数列表
 *  3. expressions[].id 是否存在于 model3.json 表情列表
 *  4. motions[].group 是否存在于 model3.json 动作组（"Default" ↔ "" 映射）
 *  5. alias 唯一性检查（跨类别不可重复）
 *  6. 必填字段完整性检查
 */

const fs = require('fs');
const path = require('path');

// ── 颜色输出 ────────────────────────────────────────────
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

// ── 路径 ─────────────────────────────────────────────────
const projectRoot = path.join(__dirname, '..');
const modelsDir = path.join(projectRoot, 'models', 'live2d');

const PARAM_MAP_FILENAME = 'param-map.json';
const SUPPORTED_VERSION = 1;

// ── 统计 ─────────────────────────────────────────────────
let totalModels = 0;
let modelsWithMap = 0;
let totalErrors = 0;
let totalWarnings = 0;

// ── 辅助函数 ─────────────────────────────────────────────

/**
 * 在模型目录中查找 *.model3.json 文件
 */
function findModel3Json(modelDir) {
  const files = fs.readdirSync(modelDir);
  // 优先查找根目录
  const model3File = files.find(f => f.endsWith('.model3.json'));
  if (model3File) return path.join(modelDir, model3File);

  // 某些模型放在 runtime 子目录
  const runtimeDir = path.join(modelDir, 'runtime');
  if (fs.existsSync(runtimeDir) && fs.statSync(runtimeDir).isDirectory()) {
    const runtimeFiles = fs.readdirSync(runtimeDir);
    const runtimeModel3 = runtimeFiles.find(f => f.endsWith('.model3.json'));
    if (runtimeModel3) return path.join(runtimeDir, runtimeModel3);
  }

  return null;
}

/**
 * 从 model3.json 读取表情名称列表
 */
function getExpressionNames(model3) {
  const expressions = model3?.FileReferences?.Expressions;
  if (!Array.isArray(expressions)) return [];
  return expressions.map(e => e.Name).filter(Boolean);
}

/**
 * 从 model3.json 读取动作组名称列表
 * 注意：空字符串 "" 是合法的组名，在应用中映射为 "Default"
 */
function getMotionGroups(model3) {
  const motions = model3?.FileReferences?.Motions;
  if (!motions || typeof motions !== 'object') return [];
  return Object.keys(motions);
}

/**
 * 从 model3.json 读取每个动作组的动作数量
 */
function getMotionGroupCounts(model3) {
  const motions = model3?.FileReferences?.Motions;
  if (!motions || typeof motions !== 'object') return {};
  const counts = {};
  for (const [group, files] of Object.entries(motions)) {
    counts[group] = Array.isArray(files) ? files.length : 0;
  }
  return counts;
}

/**
 * 从 cdi3.json 读取参数 ID 列表
 */
function getParameterIds(cdi3) {
  const params = cdi3?.Parameters;
  if (!Array.isArray(params)) return [];
  return params.map(p => p.Id).filter(Boolean);
}

/**
 * 解析 cdi3.json 文件路径（从 model3.json 的 DisplayInfo 字段获取）
 */
function resolveCdi3Path(model3, model3FilePath) {
  const displayInfo = model3?.FileReferences?.DisplayInfo;
  if (!displayInfo) return null;
  return path.join(path.dirname(model3FilePath), displayInfo);
}

/**
 * 安全读取 JSON 文件
 */
function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

// ── 校验逻辑 ─────────────────────────────────────────────

function checkModel(modelName, modelDir) {
  const errors = [];
  const warnings = [];

  const paramMapPath = path.join(modelDir, PARAM_MAP_FILENAME);

  // 查找 param-map.json（可能在 runtime 子目录）
  let paramMap = null;
  let actualParamMapPath = paramMapPath;

  if (fs.existsSync(paramMapPath)) {
    paramMap = readJson(paramMapPath);
  } else {
    const runtimePath = path.join(modelDir, 'runtime', PARAM_MAP_FILENAME);
    if (fs.existsSync(runtimePath)) {
      paramMap = readJson(runtimePath);
      actualParamMapPath = runtimePath;
    }
  }

  if (!paramMap) {
    return { hasMap: false, errors, warnings };
  }

  // ═══ 1. 版本检查 ═══
  if (paramMap.version !== SUPPORTED_VERSION) {
    errors.push(`版本不匹配：期望 ${SUPPORTED_VERSION}，实际 ${paramMap.version}`);
  }

  // ═══ 2. 查找 model3.json ═══
  const model3Path = findModel3Json(modelDir);
  if (!model3Path) {
    errors.push('未找到 *.model3.json 文件');
    return { hasMap: true, errors, warnings };
  }

  const model3 = readJson(model3Path);
  if (!model3) {
    errors.push(`无法解析 model3.json: ${path.basename(model3Path)}`);
    return { hasMap: true, errors, warnings };
  }

  // ═══ 3. 查找 cdi3.json（参数列表来源） ═══
  const cdi3Path = resolveCdi3Path(model3, model3Path);
  let parameterIds = [];

  if (cdi3Path && fs.existsSync(cdi3Path)) {
    const cdi3 = readJson(cdi3Path);
    if (cdi3) {
      parameterIds = getParameterIds(cdi3);
    } else {
      warnings.push(`无法解析 cdi3.json: ${path.basename(cdi3Path)}`);
    }
  } else {
    warnings.push('未找到 cdi3.json（DisplayInfo），跳过参数 ID 校验');
  }

  const expressionNames = getExpressionNames(model3);
  const motionGroups = getMotionGroups(model3);
  const motionGroupCounts = getMotionGroupCounts(model3);

  // ═══ 4. 参数校验 ═══
  const allAliases = new Set();

  if (Array.isArray(paramMap.parameters)) {
    const paramIds = new Set(parameterIds);

    for (const param of paramMap.parameters) {
      // 必填字段
      if (!param.id) {
        errors.push('parameters 中存在缺少 "id" 字段的条目');
        continue;
      }
      if (!param.alias) {
        errors.push(`参数 "${param.id}" 缺少 "alias" 字段`);
      }
      if (!param.description) {
        warnings.push(`参数 "${param.id}" 缺少 "description" 字段`);
      }

      // 参数 ID 是否存在于模型中
      if (paramIds.size > 0 && !paramIds.has(param.id)) {
        warnings.push(`参数 "${param.id}" 不存在于模型的 cdi3.json 参数列表中`);
      }

      // alias 唯一性
      if (param.alias) {
        if (allAliases.has(param.alias)) {
          errors.push(`alias "${param.alias}" 重复使用`);
        }
        allAliases.add(param.alias);
      }
    }
  }

  // ═══ 5. 表情校验 ═══
  if (Array.isArray(paramMap.expressions)) {
    const exprSet = new Set(expressionNames);

    for (const expr of paramMap.expressions) {
      if (!expr.id) {
        errors.push('expressions 中存在缺少 "id" 字段的条目');
        continue;
      }
      if (!expr.alias) {
        errors.push(`表情 "${expr.id}" 缺少 "alias" 字段`);
      }
      if (!expr.description) {
        warnings.push(`表情 "${expr.id}" 缺少 "description" 字段`);
      }

      // 表情 ID 是否存在于模型中
      if (exprSet.size > 0 && !exprSet.has(expr.id)) {
        warnings.push(`表情 "${expr.id}" 不存在于模型的 model3.json 表情列表中`);
      }

      // alias 唯一性
      if (expr.alias) {
        if (allAliases.has(expr.alias)) {
          errors.push(`alias "${expr.alias}" 重复使用`);
        }
        allAliases.add(expr.alias);
      }
    }
  }

  // ═══ 6. 动作校验（逐个动作：group + index） ═══
  if (Array.isArray(paramMap.motions)) {
    // 构建组名 → 动作数量映射（注意 "" ↔ "Default" 映射）
    const groupCountMap = {};
    for (const g of motionGroups) {
      groupCountMap[g] = motionGroupCounts[g] || 0;
    }
    if ('' in groupCountMap) {
      groupCountMap['Default'] = groupCountMap[''];
    }

    for (const motion of paramMap.motions) {
      if (!motion.group) {
        errors.push('motions 中存在缺少 "group" 字段的条目');
        continue;
      }
      if (motion.index === undefined || motion.index === null) {
        errors.push(`动作 "${motion.group}" 缺少 "index" 字段`);
        continue;
      }
      if (!motion.alias) {
        errors.push(`动作 "${motion.group}[${motion.index}]" 缺少 "alias" 字段`);
      }
      if (!motion.description) {
        warnings.push(`动作 "${motion.group}[${motion.index}]" 缺少 "description" 字段`);
      }

      // 动作组是否存在于模型中
      if (!(motion.group in groupCountMap)) {
        warnings.push(`动作组 "${motion.group}" 不存在于模型的 model3.json 动作列表中`);
      } else {
        // 索引是否在有效范围内
        const count = groupCountMap[motion.group];
        if (motion.index < 0 || motion.index >= count) {
          warnings.push(`动作 "${motion.group}[${motion.index}]" 索引越界（该组共 ${count} 个动作，有效范围 0~${count - 1}）`);
        }
      }

      // alias 唯一性
      if (motion.alias) {
        if (allAliases.has(motion.alias)) {
          errors.push(`alias "${motion.alias}" 重复使用`);
        }
        allAliases.add(motion.alias);
      }
    }
  }

  // ═══ 7. 覆盖率统计（信息级） ═══
  const mappedParamCount = paramMap.parameters?.length || 0;
  const mappedExprCount = paramMap.expressions?.length || 0;
  const mappedMotionCount = paramMap.motions?.length || 0;
  const totalMotionCount = Object.values(motionGroupCounts).reduce((sum, c) => sum + c, 0);

  const coverage = {
    parameters: parameterIds.length > 0
      ? `${mappedParamCount}/${parameterIds.length}`
      : `${mappedParamCount}/未知`,
    expressions: `${mappedExprCount}/${expressionNames.length}`,
    motions: `${mappedMotionCount}/${totalMotionCount}`
  };

  return { hasMap: true, errors, warnings, coverage };
}

// ── 主流程 ───────────────────────────────────────────────

function main() {
  log('\n╔══════════════════════════════════════════════╗', 'cyan');
  log('║   Live2D 参数映射表检查工具 (check-live2d)  ║', 'cyan');
  log('╚══════════════════════════════════════════════╝\n', 'cyan');

  if (!fs.existsSync(modelsDir)) {
    log('⚠ models/live2d/ 目录不存在，跳过检查', 'yellow');
    process.exit(0);
  }

  // 扫描所有模型目录
  const entries = fs.readdirSync(modelsDir);
  const modelDirs = entries.filter(entry => {
    const fullPath = path.join(modelsDir, entry);
    return fs.statSync(fullPath).isDirectory() && !entry.startsWith('.');
  });

  if (modelDirs.length === 0) {
    log('⚠ models/live2d/ 下无模型目录', 'yellow');
    process.exit(0);
  }

  totalModels = modelDirs.length;
  log(`📂 发现 ${totalModels} 个模型目录\n`, 'blue');

  for (const modelName of modelDirs) {
    const modelDir = path.join(modelsDir, modelName);
    const result = checkModel(modelName, modelDir);

    if (!result.hasMap) {
      log(`  📁 ${modelName}`, 'reset');
      log(`     ⏭ 无 ${PARAM_MAP_FILENAME}，跳过\n`, 'yellow');
      continue;
    }

    modelsWithMap++;

    const hasErrors = result.errors.length > 0;
    const hasWarnings = result.warnings.length > 0;
    const statusIcon = hasErrors ? '❌' : hasWarnings ? '⚠️' : '✅';
    const statusColor = hasErrors ? 'red' : hasWarnings ? 'yellow' : 'green';

    log(`  📁 ${modelName} ${statusIcon}`, statusColor);

    // 覆盖率
    if (result.coverage) {
      const c = result.coverage;
      log(`     📊 覆盖率: 参数 ${c.parameters} | 表情 ${c.expressions} | 动作 ${c.motions}`, 'cyan');
    }

    // 错误
    for (const err of result.errors) {
      log(`     ❌ ${err}`, 'red');
      totalErrors++;
    }

    // 警告
    for (const warn of result.warnings) {
      log(`     ⚠  ${warn}`, 'yellow');
      totalWarnings++;
    }

    console.log();
  }

  // ── 汇总 ──────────────────────────────────────────────
  log('─────────────────────────────────────────────', 'bright');
  log(`  模型总数: ${totalModels}  |  含映射表: ${modelsWithMap}`, 'blue');

  if (totalErrors > 0) {
    log(`  ❌ 错误: ${totalErrors}`, 'red');
  }
  if (totalWarnings > 0) {
    log(`  ⚠  警告: ${totalWarnings}`, 'yellow');
  }
  if (totalErrors === 0 && totalWarnings === 0) {
    log('  ✅ 所有映射表校验通过', 'green');
  }

  log('─────────────────────────────────────────────\n', 'bright');

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();