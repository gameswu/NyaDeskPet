# UI Automation Plugin - UI自动化插件

Python实现的UI自动化插件，使用PyAutoGUI和MSS等成熟库，通过WebSocket与NyaDeskPet通信。

## 功能特性

- ✅ 鼠标点击（单击/双击/右键）
- ✅ 鼠标移动（支持平滑移动）
- ✅ 鼠标拖拽
- ✅ 获取鼠标位置
- ✅ 键盘输入文本
- ✅ 键盘按键（支持组合键）
- ✅ 鼠标滚轮滚动
- ✅ 屏幕截图（高性能MSS）
- ✅ 获取屏幕尺寸
- ✅ 可调节鼠标速度

## 依赖库

- **pyautogui**: 跨平台的鼠标键盘控制
- **Pillow**: 图像处理
- **mss**: 高性能截屏库（比PyAutoGUI更快）
- **websockets**: WebSocket服务器

## 安装

### 1. 系统依赖

#### macOS
```bash
# 需要授予辅助功能权限
# 系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能
```

#### Linux
```bash
sudo apt-get install python3-tk python3-dev scrot
```

#### Windows
无需额外系统依赖。

### 2. 创建虚拟环境

```bash
cd plugins/ui-automation-plugin
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows
```

### 3. 安装Python依赖

```bash
pip install -r requirements.txt
```

## 运行

```bash
python main.py
```

默认监听: `ws://localhost:8766`

## API 接口

### 截取屏幕

```json
{
  "action": "captureScreen",
  "params": {
    "format": "png",
    "display": 0
  }
}
```

响应：
```json
{
  "success": true,
  "data": {
    "screenshot": "data:image/png;base64,...",
    "width": 1920,
    "height": 1080
  }
}
```

### 鼠标点击

```json
{
  "action": "mouseClick",
  "params": {
    "x": 100,
    "y": 200,
    "button": "left",
    "double": false
  }
}
```

按钮类型: `"left"` | `"right"` | `"middle"`

### 鼠标移动

```json
{
  "action": "mouseMove",
  "params": {
    "x": 500,
    "y": 300,
    "smooth": true
  }
}
```

### 鼠标拖拽

```json
{
  "action": "mouseDrag",
  "params": {
    "x": 100,
    "y": 100,
    "endX": 200,
    "endY": 200,
    "button": "left"
  }
}
```

### 获取鼠标位置

```json
{
  "action": "getMousePosition",
  "params": {}
}
```

### 键盘输入文本

```json
{
  "action": "keyboardType",
  "params": {
    "text": "Hello World",
    "delay": 0.05
  }
}
```

### 键盘按键

```json
{
  "action": "keyboardPress",
  "params": {
    "keys": ["enter"],
    "modifiers": ["control", "shift"]
  }
}
```

支持的修饰键: `control/ctrl`, `command/cmd`, `alt/option`, `shift`

常用按键: `enter`, `space`, `tab`, `backspace`, `delete`, `esc`, `up`, `down`, `left`, `right`, `f1-f12`

### 鼠标滚轮

```json
{
  "action": "mouseScroll",
  "params": {
    "deltaX": 0,
    "deltaY": -100
  }
}
```

负数向下滚动，正数向上滚动。

### 获取屏幕尺寸

```json
{
  "action": "getScreenSize",
  "params": {}
}
```

### 设置鼠标速度

```json
{
  "action": "setMouseSpeed",
  "params": {
    "speed": 5
  }
}
```

速度范围: 1-10（1=最慢，10=最快）

## 配置

可以通过环境变量或修改 `main.py` 中的配置：

```python
plugin = UIAutomationPlugin(host="localhost", port=8766)
```

PyAutoGUI配置：
```python
pyautogui.FAILSAFE = True   # 鼠标移到屏幕角落可中断
pyautogui.PAUSE = 0.1       # 每次操作后暂停
```

## 安全注意事项

⚠️ **警告**: 该插件可以完全控制鼠标键盘，存在安全风险！

建议：
1. 仅在受信任的环境中使用
2. 不要暴露到公网
3. 启用 FAILSAFE（移动鼠标到左上角可中断）
4. 考虑添加操作日志
5. 考虑添加权限验证

## 性能优化

- 使用 **MSS** 而非 PyAutoGUI 截图（快10倍+）
- 截图结果直接转换为base64，避免保存临时文件
- WebSocket异步通信，不阻塞操作

## 跨平台兼容性

| 功能 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 鼠标控制 | ✅ | ✅ | ✅ |
| 键盘控制 | ✅ | ✅ | ✅ |
| 截图 | ✅ | ✅ | ✅ |
| 横向滚动 | ⚠️ 有限 | ⚠️ 有限 | ⚠️ 有限 |

## 故障排除

### macOS 权限问题

如果无法控制鼠标键盘：
1. 打开 **系统偏好设置 > 安全性与隐私 > 隐私**
2. 选择 **辅助功能**
3. 添加 Terminal 或 Python

### Linux 截图失败

安装 scrot：
```bash
sudo apt-get install scrot
```

### Windows 防病毒软件拦截

某些防病毒软件可能阻止鼠标键盘控制，需要添加白名单。

## 许可证

MIT License
