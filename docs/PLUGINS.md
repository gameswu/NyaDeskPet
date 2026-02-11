# 插件开发指南

本文档介绍如何为 NyaDeskPet 开发插件，扩展应用能力。

## 插件系统概述

插件系统允许后端 Agent 通过前端插件访问系统资源和执行操作。插件分为两类：

- **内置插件**：使用 TypeScript/JavaScript 开发，直接集成在应用内
- **外部插件**：使用 Python 等语言开发，通过进程间通信调用

## 插件接口规范

### 插件元数据

```typescript
interface PluginMetadata {
  name: string;                    // 插件唯一标识
  version: string;                 // 版本号
  displayName: string;             // 显示名称
  description: string;             // 描述
  author: string;                  // 作者
  type: 'builtin' | 'external';    // 类型
  permissions: string[];           // 需要的权限列表
  capabilities: string[];          // 提供的能力列表
}
```

### 插件操作定义

```typescript
interface PluginAction {
  name: string;                    // 操作名称
  description: string;             // 描述
  params: Record<string, any>;     // 参数 schema
  permissions: string[];           // 需要的权限
}
```

### 插件接口

```typescript
interface Plugin {
  metadata: PluginMetadata;
  actions: PluginAction[];
  runtimeInfo: PluginRuntimeInfo;
  
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  execute(action: string, params: any): Promise<any>;
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
}
```

## 内置插件开发

### 基本结构

```typescript
class MyPlugin implements Plugin {
  metadata: PluginMetadata = {
    name: 'my-plugin',
    version: '1.0.0',
    displayName: 'My Plugin',
    description: '插件描述',
    author: 'Your Name',
    type: 'builtin',
    permissions: ['permission.name'],
    capabilities: ['capability1', 'capability2']
  };
  
  actions: PluginAction[] = [
    {
      name: 'actionName',
      description: '操作描述',
      params: {
        param1: 'string',
        param2: 'number?'
      },
      permissions: ['permission.name']
    }
  ];
  
  runtimeInfo: PluginRuntimeInfo = {
    status: 'inactive',
    callCount: 0
  };
  
  async initialize(): Promise<void> {
    // 初始化逻辑
    this.runtimeInfo.status = 'active';
  }
  
  async destroy(): Promise<void> {
    // 清理逻辑
    this.runtimeInfo.status = 'inactive';
  }
  
  async execute(action: string, params: any): Promise<any> {
    switch (action) {
      case 'actionName':
        return await this.handleAction(params);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
  
  private async handleAction(params: any): Promise<any> {
    // 实现具体操作
    return { result: 'success' };
  }
  
  on(event: string, callback: Function): void {
    // 事件监听
  }
  
  off(event: string, callback: Function): void {
    // 移除监听
  }
}
```

### 注册插件

```typescript
const myPlugin = new MyPlugin();
window.pluginManager.registerPlugin(myPlugin);
await myPlugin.initialize();
```

## 权限系统

### 内置权限

| 权限名称 | 级别 | 说明 |
|---------|------|------|
| `terminal.execute` | dangerous | 执行终端命令 |
| `terminal.kill` | dangerous | 终止进程 |
| `file.read` | normal | 读取文件 |
| `file.write` | dangerous | 写入文件 |
| `file.delete` | dangerous | 删除文件 |
| `network.http` | normal | HTTP 请求 |
| `system.info` | safe | 获取系统信息 |
| `clipboard.read` | normal | 读取剪贴板 |
| `clipboard.write` | safe | 写入剪贴板 |

### 权限级别

- **safe**: 安全权限，自动授权
- **normal**: 普通权限，首次使用时请求授权
- **dangerous**: 危险权限，每次使用都需要用户确认

### 自定义权限

插件可以定义自己的权限，但需要确保权限名称唯一（建议使用命名空间，如 `myplugin.action`）。

## 外部插件开发

### 通信协议

外部插件通过标准输入输出（stdio）与前端通信，使用 JSON 格式。

### 消息格式

**请求**（前端 → 插件）：
```json
{
  "type": "action",
  "action": "execute",
  "params": {
    "command": "ls -la"
  }
}
```

**响应**（插件 → 前端）：
```json
{
  "success": true,
  "data": {
    "stdout": "...",
    "exitCode": 0
  }
}
```

### Python 示例

```python
import sys
import json

def handle_action(action, params):
    if action == 'execute':
        # 执行操作
        return {
            'success': True,
            'data': {'result': 'ok'}
        }
    return {
        'success': False,
        'error': f'Unknown action: {action}'
    }

def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            response = handle_action(
                request['action'],
                request['params']
            )
            print(json.dumps(response))
            sys.stdout.flush()
        except Exception as e:
            error_response = {
                'success': False,
                'error': str(e)
            }
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == '__main__':
    main()
```

### 插件配置

外部插件需要提供配置文件 `plugin.json`：

```json
{
  "name": "my-external-plugin",
  "version": "1.0.0",
  "displayName": "My External Plugin",
  "description": "插件描述",
  "author": "Your Name",
  "type": "external",
  "executable": "python",
  "args": ["plugin.py"],
  "permissions": ["file.read", "file.write"],
  "capabilities": ["readFile", "writeFile"],
  "actions": [
    {
      "name": "readFile",
      "description": "读取文件",
      "params": {
        "path": "string"
      },
      "permissions": ["file.read"]
    }
  ]
}
```

## 后端调用插件

### 调用请求

```json
{
  "type": "plugin_call",
  "requestId": "uuid-1234",
  "plugin": "my-plugin",
  "action": "actionName",
  "params": {
    "param1": "value1",
    "param2": 42
  },
  "permissions": ["permission.name"]
}
```

### 处理响应

插件必须按照规范格式返回响应，支持多种内容类型。

**基础响应格式**：

```json
{
  "type": "plugin_response",
  "requestId": "uuid-1234",
  "success": true,
  "action": "actionName",
  "result": {
    "type": "data",
    "content": {
      "key": "value"
    }
  }
}
```

**富内容类型支持**：

插件可以返回不同类型的内容，通过 `result.type` 标识：

**1. 文本内容** (`"text"`)
```json
{
  "result": {
    "type": "text",
    "content": {
      "text": "纯文本内容",
      "format": "plain"  // 可选: "plain", "markdown", "html"
    }
  }
}
```

**2. 图片内容** (`"image"`)
```json
{
  "result": {
    "type": "image",
    "content": {
      "data": "base64_encoded_image_data",
      "format": "png",  // "png", "jpeg", "gif", "webp"
      "width": 1920,
      "height": 1080,
      "filename": "screenshot.png"  // 可选
    }
  }
}
```

**3. 文件内容** (`"file"`)
```json
{
  "result": {
    "type": "file",
    "content": {
      "filename": "report.pdf",
      "size": 102400,
      "mimeType": "application/pdf",
      "data": "base64_encoded_file_data",  // Base64编码的文件内容
      "path": "/path/to/file"  // 或本地文件路径（仅限本地插件）
    }
  }
}
```

**4. 结构化数据** (`"data"`)
```json
{
  "result": {
    "type": "data",
    "content": {
      "key1": "value1",
      "key2": 123,
      "nested": { "data": "here" }
    }
  }
}
```

**5. 混合内容** (`"mixed"`)
```json
{
  "result": {
    "type": "mixed",
    "content": [
      {
        "type": "text",
        "content": { "text": "命令执行完成" }
      },
      {
        "type": "image",
        "content": { "data": "base64...", "format": "png", "width": 800, "height": 600 }
      }
    ]
  }
}
```

**规范要求**：
- 所有响应必须严格遵循上述格式，`result` 必须包含 `type` 字段
- 不支持简单对象自动包装，请明确指定内容类型
- 不符合规范的响应将导致调用失败

## 最佳实践

### 错误处理

插件应捕获所有异常并返回结构化错误：

```typescript
try {
  const result = await someOperation();
  return result;
} catch (error) {
  throw new Error(`Operation failed: ${error.message}`);
}
```

### 参数验证

在执行操作前验证参数：

```typescript
if (!params.requiredParam) {
  throw new Error('Missing required parameter: requiredParam');
}

if (typeof params.number !== 'number') {
  throw new Error('Invalid parameter type: number must be a number');
}
```

### 资源清理

在 `destroy()` 方法中清理所有资源：

```typescript
async destroy(): Promise<void> {
  // 关闭连接
  await this.closeConnections();
  
  // 清理定时器
  if (this.timer) {
    clearInterval(this.timer);
  }
  
  // 释放内存
  this.cache.clear();
  
  this.runtimeInfo.status = 'inactive';
}
```

### 安全考虑

1. **输入验证**：验证所有输入参数
2. **权限检查**：确保插件只请求必要的权限
3. **错误信息**：避免泄露敏感信息
4. **超时控制**：为长时间操作设置超时
5. **资源限制**：限制内存和CPU使用

## 调试插件

### 开发模式

在开发模式下，插件错误会在控制台显示：

```bash
npm run dev:mac  # macOS
npm run dev:linux  # Linux
npm run dev:win  # Windows
```

### 日志输出

使用 `console.log` 输出调试信息：

```typescript
console.log('[MyPlugin] Executing action:', action);
console.error('[MyPlugin] Error:', error);
```

### 测试插件

```typescript
// 手动测试插件
const result = await window.pluginManager.callPlugin(
  'my-plugin',
  'actionName',
  { param1: 'test' },
  ['permission.name']
);
console.log('Result:', result);
```

## 插件分发

### 内置插件

内置插件随应用一起分发，需要：
1. 将插件文件放入 `renderer/js/plugins/` 目录
2. 在应用启动时注册插件
3. 重新编译和打包应用

### 外部插件

外部插件可以独立分发：
1. 创建插件目录包含所有文件
2. 提供 `plugin.json` 配置文件
3. 用户将插件放入指定目录
4. 应用自动加载插件

## 示例插件

完整示例请参考：
- 内置插件示例：`renderer/js/plugins/example-plugin.ts`
- 外部插件示例：`examples/plugins/python-example/`

## 常见问题

### 插件无法加载

检查：
1. 插件元数据是否正确
2. 是否正确实现了 Plugin 接口
3. 控制台是否有错误信息

### 权限被拒绝

插件需要的权限必须：
1. 在 `metadata.permissions` 中声明
2. 在 `actions` 中指定需要该权限
3. 用户已授权该权限

### 外部插件通信失败

检查：
1. 可执行文件路径是否正确
2. JSON 格式是否正确
3. 是否正确 flush 输出缓冲
