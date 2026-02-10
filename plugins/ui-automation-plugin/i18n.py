"""
国际化支持模块
"""

TRANSLATIONS = {
    "zh-cn": {
        "plugin.name": "UI自动化插件",
        "plugin.description": "模拟鼠标键盘操作，截取屏幕画面",
        "plugin.ready": "UI自动化插件已就绪",
        "plugin.connected": "客户端已连接",
        "plugin.disconnected": "客户端断开连接",
        "plugin.interrupt": "收到中断信号",
        "plugin.screen_size": "屏幕尺寸",
        
        "action.captureScreen": "截取屏幕",
        "action.mouseClick": "鼠标点击",
        "action.mouseMove": "鼠标移动",
        "action.mouseDrag": "鼠标拖拽",
        "action.getMousePosition": "获取鼠标位置",
        "action.keyboardType": "键盘输入",
        "action.keyboardPress": "按键",
        "action.mouseScroll": "鼠标滚轮",
        "action.getScreenSize": "获取屏幕尺寸",
        "action.setMouseSpeed": "设置鼠标速度",
        
        "error.display_not_found": "显示器 {display} 未找到",
        "error.coordinates_required": "x和y坐标是必需的",
        "error.drag_params_required": "x、y、endX、endY是必需的",
        "error.text_required": "text参数是必需的",
        "error.invalid_json": "无效的JSON格式",
        "error.unknown_action": "未知的操作: {action}",
        "error.execution_failed": "执行失败: {error}",
        
        "success.screenshot_taken": "截图已完成",
        "success.mouse_clicked": "鼠标点击成功",
        "success.mouse_moved": "鼠标移动成功",
        "success.mouse_dragged": "鼠标拖拽成功",
        "success.text_typed": "文本输入成功",
        "success.key_pressed": "按键成功",
        "success.scrolled": "滚动成功",
        "success.speed_set": "速度已设置"
    },
    "en": {
        "plugin.name": "UI Automation Plugin",
        "plugin.description": "Mouse and keyboard control, screen capture",
        "plugin.ready": "UI Automation plugin ready",
        "plugin.connected": "Client connected",
        "plugin.disconnected": "Client disconnected",
        "plugin.interrupt": "Received interrupt signal",
        "plugin.screen_size": "Screen size",
        
        "action.captureScreen": "Capture Screen",
        "action.mouseClick": "Mouse Click",
        "action.mouseMove": "Mouse Move",
        "action.mouseDrag": "Mouse Drag",
        "action.getMousePosition": "Get Mouse Position",
        "action.keyboardType": "Keyboard Type",
        "action.keyboardPress": "Keyboard Press",
        "action.mouseScroll": "Mouse Scroll",
        "action.getScreenSize": "Get Screen Size",
        "action.setMouseSpeed": "Set Mouse Speed",
        
        "error.display_not_found": "Display {display} not found",
        "error.coordinates_required": "x and y coordinates are required",
        "error.drag_params_required": "x, y, endX, endY are required",
        "error.text_required": "text parameter is required",
        "error.invalid_json": "Invalid JSON format",
        "error.unknown_action": "Unknown action: {action}",
        "error.execution_failed": "Execution failed: {error}",
        
        "success.screenshot_taken": "Screenshot captured",
        "success.mouse_clicked": "Mouse clicked",
        "success.mouse_moved": "Mouse moved",
        "success.mouse_dragged": "Mouse dragged",
        "success.text_typed": "Text typed",
        "success.key_pressed": "Key pressed",
        "success.scrolled": "Scrolled",
        "success.speed_set": "Speed set"
    }
}

# 语言代码映射：前端 -> 插件
LOCALE_MAP = {
    "zh-CN": "zh-cn",
    "zh-cn": "zh-cn",
    "en-US": "en",
    "en": "en"
}


class I18n:
    """国际化类"""
    
    def __init__(self, locale: str = "en-US", default_locale: str = "en-US"):
        self.default_locale = LOCALE_MAP.get(default_locale, "en")
        self.set_locale(locale)
            
    def t(self, key: str, **kwargs) -> str:
        """翻译文本"""
        # 尝试当前语言
        text = TRANSLATIONS.get(self.locale, {}).get(key)
        # 回退到默认语言
        if not text:
            text = TRANSLATIONS.get(self.default_locale, {}).get(key, key)
        
        if kwargs:
            try:
                text = text.format(**kwargs)
            except KeyError:
                pass
        return text
        
    def set_locale(self, locale: str):
        """设置语言"""
        # 映射前端语言代码到插件语言代码
        mapped_locale = LOCALE_MAP.get(locale, self.default_locale)
        
        # 如果映射后的语言不存在，使用默认语言
        if mapped_locale in TRANSLATIONS:
            self.locale = mapped_locale
        else:
            self.locale = self.default_locale
            
    def get_frontend_locale(self) -> str:
        """获取前端语言代码"""
        if self.locale == "zh-cn":
            return "zh-CN"
        else:
            return "en-US"
            
    def get_metadata(self) -> dict:
        """获取插件元数据（当前语言）"""
        return {
            "name": "ui-automation",
            "version": "1.0.0",
            "displayName": self.t("plugin.name"),
            "description": self.t("plugin.description"),
            "author": "NyaDeskPet",
            "type": "external",
            "permissions": ["ui.mouse", "ui.keyboard", "ui.screenshot"],
            "capabilities": [
                "captureScreen",
                "mouseClick",
                "mouseMove",
                "mouseDrag",
                "getMousePosition",
                "keyboardType",
                "keyboardPress",
                "mouseScroll",
                "getScreenSize",
                "setMouseSpeed"
            ]
        }

