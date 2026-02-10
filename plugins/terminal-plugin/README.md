# Terminal Plugin - 终端控制插件

Python实现的终端控制插件，通过WebSocket与NyaDeskPet通信。

## 功能特性

- ✅ 执行终端命令
- ✅ 创建和管理Shell会话
- ✅ 实时输入输出
- ✅ 多会话支持
- ✅ 获取工作目录
- ✅ 超时控制

## 依赖库

- **websockets**: WebSocket服务器
- **psutil**: 进程管理工具

## 安装

### 1. 创建虚拟环境

```bash
cd plugins/terminal-plugin
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

## 运行

```bash
python main.py
```

默认监听: `ws://localhost:8765`

## API 接口

### 执行命令

```json
{
  "action": "execute",
  "requestId": "uuid",
  "params": {
    "command": "ls -la",
    "cwd": "/path/to/dir",
    "timeout": 30
  }
}
```

响应：
```json
{
  "type": "plugin_response",
  "requestId": "uuid",
  "plugin": "terminal",
  "action": "execute",
  "success": true,
  "data": {
    "stdout": "...",
    "stderr": "...",
    "exitCode": 0
  }
}
```

### 创建会话

```json
{
  "action": "createSession",
  "params": {
    "shell": "/bin/bash",
    "cwd": "/home/user"
  }
}
```

### 获取会话列表

```json
{
  "action": "getSessions",
  "params": {}
}
```

### 发送输入

```json
{
  "action": "sendInput",
  "params": {
    "sessionId": "session-uuid",
    "data": "echo hello\n"
  }
}
```

### 关闭会话

```json
{
  "action": "closeSession",
  "params": {
    "sessionId": "session-uuid"
  }
}
```

### 获取当前目录

```json
{
  "action": "getCurrentDirectory",
  "params": {
    "sessionId": "session-uuid"
  }
}
```

## 配置

可以通过环境变量或修改 `main.py` 中的配置：

```python
plugin = TerminalPlugin(host="localhost", port=8765)
```

## 安全注意事项

⚠️ **警告**: 该插件允许执行任意终端命令，存在安全风险！

建议：
1. 仅在受信任的环境中使用
2. 不要暴露到公网
3. 考虑添加命令白名单
4. 考虑添加权限验证

## 架构设计

```
TerminalPlugin
  ├── WebSocket Server (websockets)
  ├── Session Manager
  │   └── TerminalSession[]
  │       ├── subprocess.Popen
  │       └── stdin/stdout/stderr
  └── Command Executor
```

## 限制

- 不支持交互式命令（如 `vim`, `nano`）
- 基础实现不支持终端大小调整（需要使用 `pty` 模块）
- 长时间运行的命令建议使用会话模式

## 许可证

MIT License
