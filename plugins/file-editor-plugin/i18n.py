"""
国际化支持模块 — 文件读写编辑插件
"""

TRANSLATIONS = {
    "zh-cn": {
        "plugin.name": "文件读写编辑插件",
        "plugin.description": "读取、创建、编辑文件并展示操作 Diff",
        "plugin.ready": "文件编辑插件已就绪",
        "plugin.connected": "客户端已连接",
        "plugin.disconnected": "客户端断开连接",
        "plugin.cleanup": "正在清理...",
        "plugin.interrupt": "收到中断信号",

        "action.readFile": "读取文件",
        "action.writeFile": "写入文件",
        "action.editFile": "编辑文件",
        "action.listDirectory": "列出目录",

        "error.invalid_json": "无效的 JSON 格式",
        "error.unknown_action": "未知的操作: {action}",
        "error.execution_failed": "执行失败: {error}",
        "error.path_required": "文件路径是必需的",
        "error.content_required": "文件内容是必需的",
        "error.old_text_required": "替换文本(old_text)是必需的",
        "error.new_text_required": "新文本(new_text)是必需的",
        "error.file_not_found": "文件未找到: {path}",
        "error.dir_not_found": "目录未找到: {path}",
        "error.file_too_large": "文件超出大小限制 ({size} > {limit} 字节)",
        "error.path_not_allowed": "路径不在允许的目录中: {path}",
        "error.permission_denied": "权限被拒绝",
        "error.old_text_not_found": "未找到要替换的文本",
        "error.old_text_ambiguous": "要替换的文本匹配了 {count} 处（需唯一匹配）",

        "success.file_read": "文件读取成功",
        "success.file_written": "文件写入成功",
        "success.file_edited": "文件编辑成功",

        "ui.title": "NyaDeskPet 文件编辑器",
        "ui.read": "📖 读取",
        "ui.write": "📝 写入",
        "ui.edit": "✏️ 编辑",
        "ui.list": "📂 列目录",
        "ui.no_operations": "暂无操作记录",
    },
    "en": {
        "plugin.name": "File Editor Plugin",
        "plugin.description": "Read, create, edit files and display operation diffs",
        "plugin.ready": "File editor plugin ready",
        "plugin.connected": "Client connected",
        "plugin.disconnected": "Client disconnected",
        "plugin.cleanup": "Cleaning up...",
        "plugin.interrupt": "Received interrupt signal",

        "action.readFile": "Read File",
        "action.writeFile": "Write File",
        "action.editFile": "Edit File",
        "action.listDirectory": "List Directory",

        "error.invalid_json": "Invalid JSON format",
        "error.unknown_action": "Unknown action: {action}",
        "error.execution_failed": "Execution failed: {error}",
        "error.path_required": "File path is required",
        "error.content_required": "File content is required",
        "error.old_text_required": "old_text is required",
        "error.new_text_required": "new_text is required",
        "error.file_not_found": "File not found: {path}",
        "error.dir_not_found": "Directory not found: {path}",
        "error.file_too_large": "File exceeds size limit ({size} > {limit} bytes)",
        "error.path_not_allowed": "Path not in allowed directories: {path}",
        "error.permission_denied": "Permission denied",
        "error.old_text_not_found": "Text to replace not found",
        "error.old_text_ambiguous": "Text to replace matched {count} times (must be unique)",

        "success.file_read": "File read successfully",
        "success.file_written": "File written successfully",
        "success.file_edited": "File edited successfully",

        "ui.title": "NyaDeskPet File Editor",
        "ui.read": "📖 Read",
        "ui.write": "📝 Write",
        "ui.edit": "✏️ Edit",
        "ui.list": "📂 List Dir",
        "ui.no_operations": "No operations yet",
    }
}

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
        text = TRANSLATIONS.get(self.locale, {}).get(key)
        if not text:
            text = TRANSLATIONS.get(self.default_locale, {}).get(key, key)
        if kwargs:
            try:
                text = text.format(**kwargs)
            except KeyError:
                pass
        return text

    def set_locale(self, locale: str):
        mapped = LOCALE_MAP.get(locale, self.default_locale)
        self.locale = mapped if mapped in TRANSLATIONS else self.default_locale

    def get_frontend_locale(self) -> str:
        return "zh-CN" if self.locale == "zh-cn" else "en-US"

    def get_metadata(self) -> dict:
        return {
            "name": "file-editor",
            "version": "1.0.0",
            "displayName": self.t("plugin.name"),
            "description": self.t("plugin.description"),
            "author": "NyaDeskPet",
            "type": "external",
            "permissions": ["file.read", "file.write", "file.edit"],
            "capabilities": [
                "readFile",
                "writeFile",
                "editFile",
                "listDirectory"
            ]
        }
