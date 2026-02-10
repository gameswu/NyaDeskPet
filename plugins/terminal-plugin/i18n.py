"""
国际化支持模块
"""

TRANSLATIONS = {
    "zh-cn": {
        "plugin.name": "终端控制插件",
        "plugin.description": "执行终端命令、管理Shell会话",
        "plugin.ready": "终端插件已就绪",
        "plugin.connected": "客户端已连接",
        "plugin.disconnected": "客户端断开连接",
        "plugin.cleanup": "正在清理终端会话...",
        "plugin.interrupt": "收到中断信号",
        
        "action.execute": "执行命令",
        "action.createSession": "创建会话",
        "action.getSessions": "获取会话列表",
        "action.closeSession": "关闭会话",
        "action.sendInput": "发送输入",
        "action.getCurrentDirectory": "获取当前目录",
        "action.resize": "调整大小",
        
        "error.command_required": "命令参数是必需的",
        "error.command_timeout": "命令执行超时（{timeout}秒）",
        "error.session_id_required": "会话ID是必需的",
        "error.session_not_found": "会话未找到",
        "error.input_required": "会话ID和输入数据是必需的",
        "error.invalid_json": "无效的JSON格式",
        "error.unknown_action": "未知的操作: {action}",
        "error.execution_failed": "执行失败: {error}",
        
        "success.session_created": "会话创建成功",
        "success.session_closed": "会话已关闭",
        "success.input_sent": "输入已发送",
        "success.command_executed": "命令执行完成",
        
        "info.resize_not_supported": "基础subprocess实现不支持调整大小"
    },
    "en": {
        "plugin.name": "Terminal Plugin",
        "plugin.description": "Execute terminal commands and manage shell sessions",
        "plugin.ready": "Terminal plugin ready",
        "plugin.connected": "Client connected",
        "plugin.disconnected": "Client disconnected",
        "plugin.cleanup": "Cleaning up terminal sessions...",
        "plugin.interrupt": "Received interrupt signal",
        
        "action.execute": "Execute Command",
        "action.createSession": "Create Session",
        "action.getSessions": "Get Sessions",
        "action.closeSession": "Close Session",
        "action.sendInput": "Send Input",
        "action.getCurrentDirectory": "Get Current Directory",
        "action.resize": "Resize",
        
        "error.command_required": "Command is required",
        "error.command_timeout": "Command timeout after {timeout} seconds",
        "error.session_id_required": "Session ID is required",
        "error.session_not_found": "Session not found",
        "error.input_required": "Session ID and data are required",
        "error.invalid_json": "Invalid JSON format",
        "error.unknown_action": "Unknown action: {action}",
        "error.execution_failed": "Execution failed: {error}",
        
        "success.session_created": "Session created successfully",
        "success.session_closed": "Session closed",
        "success.input_sent": "Input sent",
        "success.command_executed": "Command executed",
        
        "info.resize_not_supported": "Resize not supported in basic subprocess implementation"
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
            "name": "terminal",
            "version": "1.0.0",
            "displayName": self.t("plugin.name"),
            "description": self.t("plugin.description"),
            "author": "NyaDeskPet",
            "type": "external",
            "permissions": ["terminal.execute", "terminal.session"],
            "capabilities": [
                "execute",
                "createSession", 
                "getSessions",
                "closeSession",
                "sendInput",
                "getCurrentDirectory",
                "resize"
            ]
        }

