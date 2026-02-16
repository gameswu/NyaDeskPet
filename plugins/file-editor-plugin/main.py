#!/usr/bin/env python3
"""
文件读写编辑插件
提供 read_file / write_file / edit_file / list_directory 四个能力，
对标 VSCode Copilot 的文件操作工具，支持精确文本替换编辑。
通过 UDP 向独立 tkinter UI 推送操作事件，展示类似 Copilot 的 Diff 视图。
"""

import asyncio
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import websockets
from websockets.asyncio.server import ServerConnection

from i18n import I18n

# UI 进程 UDP 默认端口（可通过 config.json 的 ui_port 覆盖）
DEFAULT_UI_PORT = 19098


class FileEditorPlugin:
    """文件读写编辑插件主类"""

    def __init__(self, host: str = "localhost", port: int = 8769, locale: str = "en-US"):
        self.host = host
        self.port = port
        self.clients: set = set()
        self.i18n = I18n(locale, default_locale="en-US")
        self.config: dict = {}
        self.pending_permissions: Dict[str, asyncio.Future] = {}
        self._ui_process: Optional[subprocess.Popen] = None
        self._ui_sock: Optional[socket.socket] = None
        self._ui_addr = ("127.0.0.1", DEFAULT_UI_PORT)

    # ==================== WebSocket 服务 ====================

    async def handle_client(self, websocket: ServerConnection):
        print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.connected')}: {websocket.remote_address}")
        self.clients.add(websocket)

        try:
            await websocket.send(json.dumps({
                "type": "connected",
                "plugin": "file-editor",
                "message": self.i18n.t("plugin.ready")
            }))

            # 主动向前端请求配置（不阻塞消息循环，响应通过 plugin_config 回来）
            await self._request_config(websocket)

            async for message in websocket:
                try:
                    data = json.loads(message)

                    if data.get("action") == "getMetadata":
                        locale = data.get("locale", "en-US")
                        self.i18n.set_locale(locale)
                        await websocket.send(json.dumps({
                            "type": "metadata",
                            "plugin": "file-editor",
                            "locale": self.i18n.get_frontend_locale(),
                            "defaultLocale": "en-US",
                            "metadata": self.i18n.get_metadata()
                        }))
                        continue

                    if data.get("action") == "setLocale":
                        locale = data.get("params", {}).get("locale", "en-US")
                        self.i18n.set_locale(locale)
                        await websocket.send(json.dumps({
                            "type": "plugin_response",
                            "success": True,
                            "locale": self.i18n.get_frontend_locale(),
                            "metadata": self.i18n.get_metadata()
                        }))
                        continue

                    if data.get("action") == "getConfig":
                        await self._request_config(websocket)
                        continue

                    if data.get("type") == "plugin_config":
                        self.config = data.get("config", {})
                        # 用配置中的端口更新 UI 通信地址
                        ui_port = self._get_config("ui_port", DEFAULT_UI_PORT)
                        self._ui_addr = ("127.0.0.1", int(ui_port))
                        print(f"✅ 已加载配置: {self.config}")
                        # 配置加载完成后再决定是否启动 UI
                        if self._get_config("show_ui", True) and not self._ui_process:
                            self._start_ui()
                        continue

                    if data.get("type") == "permission_response":
                        req_id = data.get("requestId")
                        if req_id in self.pending_permissions:
                            self.pending_permissions.pop(req_id).set_result(data.get("granted", False))
                        continue

                    # 操作处理可能需要等待权限审批（permission_response），
                    # 必须在后台任务中执行，否则 async for 循环会阻塞导致死锁。
                    asyncio.create_task(self._dispatch_action(data, websocket))

                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        "type": "plugin_response",
                        "success": False,
                        "error": self.i18n.t("error.invalid_json"),
                        "errorKey": "error.invalid_json",
                        "locale": self.i18n.get_frontend_locale()
                    }))
                except Exception as e:
                    err = {
                        "type": "plugin_response",
                        "success": False,
                        "error": str(e),
                        "errorKey": "error.execution_failed",
                        "locale": self.i18n.get_frontend_locale()
                    }
                    if isinstance(data, dict) and "requestId" in data:
                        err["requestId"] = data["requestId"]
                    await websocket.send(json.dumps(err))

        except websockets.exceptions.ConnectionClosed:
            print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.disconnected')}: {websocket.remote_address}")
        finally:
            self.clients.discard(websocket)

    async def _dispatch_action(self, data: dict, websocket: ServerConnection):
        """在后台任务中执行操作，使主消息循环不被阻塞"""
        try:
            response = await self.handle_message(data, websocket)
            if "requestId" in data:
                response["requestId"] = data["requestId"]
            await websocket.send(json.dumps(response))
        except Exception as e:
            err = {
                "type": "plugin_response",
                "success": False,
                "error": str(e),
                "errorKey": "error.execution_failed",
                "locale": self.i18n.get_frontend_locale()
            }
            if "requestId" in data:
                err["requestId"] = data["requestId"]
            try:
                await websocket.send(json.dumps(err))
            except Exception:
                pass

    async def _request_config(self, websocket: ServerConnection):
        await websocket.send(json.dumps({
            "action": "getConfig",
            "pluginId": "file-editor"
        }))

    def _get_config(self, key: str, default=None):
        return self.config.get(key, default)

    async def _request_permission(self, websocket: ServerConnection, perm_id: str, operation: str, details: dict = None) -> bool:
        req_id = str(uuid.uuid4())
        future = asyncio.Future()
        self.pending_permissions[req_id] = future
        await websocket.send(json.dumps({
            "type": "permission_request",
            "requestId": req_id,
            "permissionId": perm_id,
            "operation": operation,
            "details": details or {}
        }))
        try:
            return await asyncio.wait_for(future, timeout=30.0)
        except asyncio.TimeoutError:
            self.pending_permissions.pop(req_id, None)
            return False

    # ==================== 路径处理 ====================

    @staticmethod
    def _resolve_path(p: str) -> str:
        """解析路径：展开 ~ 前缀，相对路径基于用户主目录（而非插件工作目录）。
        使用 pathlib.Path.home() 保证 Windows/macOS/Linux 行为一致。"""
        expanded = os.path.expanduser(p)
        if not os.path.isabs(expanded):
            expanded = os.path.join(str(Path.home()), expanded)
        return os.path.normpath(expanded)

    def _check_path_allowed(self, path: str) -> bool:
        allowed = self._get_config("allowed_directories", "")
        if not allowed:
            return True
        resolved = os.path.realpath(path)
        for d in [x.strip() for x in allowed.split(",") if x.strip()]:
            if resolved.startswith(os.path.realpath(d)):
                return True
        return False

    # ==================== 消息路由 ====================

    async def handle_message(self, data: dict, websocket: ServerConnection) -> dict:
        action = data.get("action")
        params = data.get("params", {})
        try:
            if action == "readFile":
                return await self._read_file(params, websocket)
            elif action == "writeFile":
                return await self._write_file(params, websocket)
            elif action == "editFile":
                return await self._edit_file(params, websocket)
            elif action == "listDirectory":
                return await self._list_directory(params, websocket)
            else:
                return self._error(self.i18n.t("error.unknown_action", action=action), "error.unknown_action")
        except Exception as e:
            return self._error(self.i18n.t("error.execution_failed", error=str(e)), "error.execution_failed")

    def _error(self, msg: str, key: str, perm: str = None) -> dict:
        r = {
            "type": "plugin_response",
            "success": False,
            "error": msg,
            "errorKey": key,
            "locale": self.i18n.get_frontend_locale()
        }
        if perm:
            r["requiredPermission"] = perm
        return r

    def _ok(self, action: str, content: dict, perm: str = None) -> dict:
        r = {
            "type": "plugin_response",
            "success": True,
            "action": action,
            "result": {"type": "data", "content": content},
            "locale": self.i18n.get_frontend_locale()
        }
        if perm:
            r["requiredPermission"] = perm
        return r

    # ==================== 核心操作 ====================

    async def _read_file(self, params: dict, ws: ServerConnection) -> dict:
        path = params.get("path")
        if not path:
            return self._error(self.i18n.t("error.path_required"), "error.path_required")

        path = self._resolve_path(path)
        if not self._check_path_allowed(path):
            return self._error(self.i18n.t("error.path_not_allowed", path=path), "error.path_not_allowed")

        if not os.path.isfile(path):
            return self._error(self.i18n.t("error.file_not_found", path=path), "error.file_not_found")

        size = os.path.getsize(path)
        limit = self._get_config("max_file_size", 5242880)
        if size > limit:
            return self._error(
                self.i18n.t("error.file_too_large", size=size, limit=limit),
                "error.file_too_large"
            )

        start_line = params.get("start_line")
        end_line = params.get("end_line")

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            if start_line is not None or end_line is not None:
                lines = f.readlines()
                total = len(lines)
                s = max(0, (start_line or 1) - 1)
                e = min(total, end_line or total)
                content = "".join(lines[s:e])
                line_info = f"lines {s+1}-{e} of {total}"
            else:
                content = f.read()
                total = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
                line_info = f"{total} lines"

        # 推送到 UI
        await self._broadcast_ui({
            "type": "file_op",
            "op": "read",
            "path": path,
            "lineInfo": line_info,
            "contentPreview": content[:2000],
            "timestamp": datetime.now().isoformat()
        })

        return self._ok("readFile", {
            "path": path,
            "content": content,
            "size": size,
            "lineInfo": line_info
        })

    async def _write_file(self, params: dict, ws: ServerConnection) -> dict:
        path = params.get("path")
        content = params.get("content")
        if not path:
            return self._error(self.i18n.t("error.path_required"), "error.path_required")
        if content is None:
            return self._error(self.i18n.t("error.content_required"), "error.content_required")

        path = self._resolve_path(path)
        if not self._check_path_allowed(path):
            return self._error(self.i18n.t("error.path_not_allowed", path=path), "error.path_not_allowed")

        # 权限检查
        granted = await self._request_permission(ws, "file.write", "write_file", {"path": path})
        if not granted:
            return self._error(self.i18n.t("error.permission_denied"), "error.permission_denied", "file.write")

        # 读取旧内容用于 diff
        old_content = ""
        is_new = not os.path.isfile(path)
        if not is_new:
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    old_content = f.read()
            except Exception:
                pass

            if self._get_config("backup_before_edit", True):
                try:
                    shutil.copy2(path, path + ".bak")
                except Exception:
                    pass

        # 确保目录存在
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

        lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)

        # 推送 diff 到 UI
        await self._broadcast_ui({
            "type": "file_op",
            "op": "write",
            "path": path,
            "isNew": is_new,
            "oldContent": old_content[:3000],
            "newContent": content[:3000],
            "lines": lines,
            "timestamp": datetime.now().isoformat()
        })

        return self._ok("writeFile", {
            "path": path,
            "bytesWritten": len(content.encode("utf-8")),
            "lines": lines,
            "created": is_new
        }, "file.write")

    async def _edit_file(self, params: dict, ws: ServerConnection) -> dict:
        """
        精确文本替换编辑（对标 VSCode Copilot replace_string_in_file）。
        参数: path, old_text, new_text
        old_text 必须在文件中唯一匹配（避免歧义编辑）。
        """
        path = params.get("path")
        old_text = params.get("old_text")
        new_text = params.get("new_text")

        if not path:
            return self._error(self.i18n.t("error.path_required"), "error.path_required")
        if old_text is None:
            return self._error(self.i18n.t("error.old_text_required"), "error.old_text_required")
        if new_text is None:
            return self._error(self.i18n.t("error.new_text_required"), "error.new_text_required")

        path = self._resolve_path(path)
        if not self._check_path_allowed(path):
            return self._error(self.i18n.t("error.path_not_allowed", path=path), "error.path_not_allowed")

        if not os.path.isfile(path):
            return self._error(self.i18n.t("error.file_not_found", path=path), "error.file_not_found")

        # 权限检查
        granted = await self._request_permission(ws, "file.edit", "edit_file", {"path": path})
        if not granted:
            return self._error(self.i18n.t("error.permission_denied"), "error.permission_denied", "file.edit")

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            original = f.read()

        # 唯一匹配检查
        count = original.count(old_text)
        if count == 0:
            return self._error(self.i18n.t("error.old_text_not_found"), "error.old_text_not_found")
        if count > 1:
            return self._error(
                self.i18n.t("error.old_text_ambiguous", count=count),
                "error.old_text_ambiguous"
            )

        if self._get_config("backup_before_edit", True):
            try:
                shutil.copy2(path, path + ".bak")
            except Exception:
                pass

        edited = original.replace(old_text, new_text, 1)

        with open(path, "w", encoding="utf-8") as f:
            f.write(edited)

        # 计算替换位置（行号）
        before = original[:original.index(old_text)]
        start_line = before.count("\n") + 1
        old_lines = old_text.count("\n") + 1
        new_lines = new_text.count("\n") + 1

        # 推送 diff 到 UI
        await self._broadcast_ui({
            "type": "file_op",
            "op": "edit",
            "path": path,
            "startLine": start_line,
            "oldText": old_text[:2000],
            "newText": new_text[:2000],
            "oldLines": old_lines,
            "newLines": new_lines,
            "timestamp": datetime.now().isoformat()
        })

        return self._ok("editFile", {
            "path": path,
            "replacements": 1,
            "startLine": start_line,
            "oldLines": old_lines,
            "newLines": new_lines
        }, "file.edit")

    async def _list_directory(self, params: dict, ws: ServerConnection) -> dict:
        path = params.get("path", ".")
        path = self._resolve_path(path)

        if not self._check_path_allowed(path):
            return self._error(self.i18n.t("error.path_not_allowed", path=path), "error.path_not_allowed")

        if not os.path.isdir(path):
            return self._error(self.i18n.t("error.dir_not_found", path=path), "error.dir_not_found")

        entries = []
        try:
            for name in sorted(os.listdir(path)):
                full = os.path.join(path, name)
                is_dir = os.path.isdir(full)
                entry = {
                    "name": name + ("/" if is_dir else ""),
                    "type": "directory" if is_dir else "file",
                }
                if not is_dir:
                    try:
                        entry["size"] = os.path.getsize(full)
                    except OSError:
                        entry["size"] = -1
                entries.append(entry)
        except PermissionError:
            return self._error(self.i18n.t("error.permission_denied"), "error.permission_denied")

        await self._broadcast_ui({
            "type": "file_op",
            "op": "list",
            "path": path,
            "count": len(entries),
            "timestamp": datetime.now().isoformat()
        })

        return self._ok("listDirectory", {
            "path": os.path.abspath(path),
            "entries": entries,
            "count": len(entries)
        })

    # ==================== UI 通信 ====================

    async def _broadcast_ui(self, message: dict):
        if not self._ui_sock:
            return
        try:
            payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
            self._ui_sock.sendto(payload, self._ui_addr)
        except Exception:
            pass

    # ==================== 启动 / 关闭 ====================

    async def start(self):
        print(f"[{self.i18n.t('plugin.name')}] starting on ws://{self.host}:{self.port}")

        # UI 延迟到配置加载完成后启动（handle_client 收到 plugin_config 时触发）

        async with websockets.serve(self.handle_client, self.host, self.port):
            print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.ready')}")
            await asyncio.Future()

    def _start_ui(self):
        self._ui_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        plugin_dir = os.path.dirname(os.path.abspath(__file__))
        ui_script = os.path.join(plugin_dir, "file_editor_ui.py")
        python_exe = os.path.realpath(sys.executable)
        ui_log = os.path.join(plugin_dir, "file_editor_ui.log")

        try:
            log_fd = open(ui_log, "w")
            self._ui_process = subprocess.Popen(
                [python_exe, ui_script, "--port", str(self._ui_addr[1])],
                start_new_session=True,
                stdin=subprocess.DEVNULL,
                stdout=log_fd,
                stderr=subprocess.STDOUT,
            )
            log_fd.close()
            print(f"[{self.i18n.t('plugin.name')}] 文件编辑器 UI 已启动 (PID: {self._ui_process.pid})")
        except Exception as e:
            print(f"[{self.i18n.t('plugin.name')}] 启动 UI 失败: {e}")
            self._ui_process = None

    def cleanup(self):
        print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.cleanup')}")
        if self._ui_process and self._ui_process.poll() is None:
            try:
                self._ui_process.terminate()
                self._ui_process.wait(timeout=3)
            except Exception:
                try:
                    self._ui_process.kill()
                except Exception:
                    pass
        if self._ui_sock:
            try:
                self._ui_sock.close()
            except Exception:
                pass


def main():
    plugin = FileEditorPlugin(host="localhost", port=8769, locale="en-US")

    def sig_handler(sig, frame):
        print(f"\n[{plugin.i18n.t('plugin.name')}] {plugin.i18n.t('plugin.interrupt')}")
        plugin.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    try:
        asyncio.run(plugin.start())
    except KeyboardInterrupt:
        plugin.cleanup()


if __name__ == "__main__":
    main()
