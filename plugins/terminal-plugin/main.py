#!/usr/bin/env python3
"""
终端控制插件
提供终端命令执行、会话管理等功能
使用 WebSocket 与 NyaDeskPet 前端通信
"""

import asyncio
import json
import subprocess
import uuid
import os
import signal
import sys
import socket
from pathlib import Path
from typing import Dict, Optional
from datetime import datetime
import websockets
from websockets.asyncio.server import ServerConnection
import psutil
from i18n import I18n

# UI 进程通信默认端口（可通过 config.json 的 ui_port 覆盖）
DEFAULT_UI_PORT = 19099


class TerminalSession:
    """终端会话管理"""
    
    def __init__(self, session_id: str, shell: str, cwd: str):
        self.session_id = session_id
        self.shell = shell
        self.cwd = cwd
        self.process: Optional[subprocess.Popen] = None
        self.created_at = datetime.now()
        
    def start(self):
        """启动会话进程"""
        self.process = subprocess.Popen(
            [self.shell],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.cwd,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
    def send_input(self, data: str) -> bool:
        """向会话发送输入"""
        if self.process and self.process.stdin:
            try:
                self.process.stdin.write(data)
                self.process.stdin.flush()
                return True
            except Exception as e:
                print(f"发送输入失败: {e}")
                return False
        return False
        
    def is_alive(self) -> bool:
        """检查进程是否存活"""
        return self.process is not None and self.process.poll() is None
        
    def terminate(self):
        """终止会话"""
        if self.process:
            try:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
            except Exception as e:
                print(f"终止会话失败: {e}")


class TerminalPlugin:
    """终端控制插件主类"""
    
    def __init__(self, host: str = "localhost", port: int = 8765, locale: str = "en-US"):
        self.host = host
        self.port = port
        self.sessions: Dict[str, TerminalSession] = {}
        self.clients = set()
        self.i18n = I18n(locale, default_locale="en-US")
        self.config = {}  # 配置存储
        self.pending_permissions = {}  # 等待权限确认的请求
        # 终端监视器 UI（独立子进程 + UDP 通信）
        self._ui_process: Optional[subprocess.Popen] = None
        self._ui_sock: Optional[socket.socket] = None
        self._ui_addr = ("127.0.0.1", DEFAULT_UI_PORT)
        
    async def handle_client(self, websocket: ServerConnection):
        """处理客户端连接"""
        print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.connected')}: {websocket.remote_address}")
        self.clients.add(websocket)
        
        try:
            # 发送连接确认消息
            await websocket.send(json.dumps({
                "type": "connected",
                "plugin": "terminal",
                "message": self.i18n.t("plugin.ready")
            }))

            # 主动向前端请求配置（不阻塞消息循环，响应通过 plugin_config 回来）
            await self.request_config(websocket)

            async for message in websocket:
                try:
                    data = json.loads(message)
                    
                    # 处理元数据请求
                    if data.get("action") == "getMetadata":
                        locale = data.get("locale", "en-US")
                        self.i18n.set_locale(locale)
                        await websocket.send(json.dumps({
                            "type": "metadata",
                            "plugin": "terminal",
                            "locale": self.i18n.get_frontend_locale(),
                            "defaultLocale": "en-US",
                            "metadata": self.i18n.get_metadata()
                        }))
                        continue
                    
                    # 处理语言切换
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
                    
                    # 处理配置请求
                    if data.get("action") == "getConfig":
                        await self.request_config(websocket)
                        continue
                    
                    # 处理配置响应
                    if data.get("type") == "plugin_config":
                        self.config = data.get("config", {})
                        # 用配置中的端口更新 UI 通信地址
                        ui_port = self.get_config("ui_port", DEFAULT_UI_PORT)
                        self._ui_addr = ("127.0.0.1", int(ui_port))
                        print(f"✅ 已加载配置: {self.config}")
                        # 配置加载完成后再决定是否启动 UI
                        if self.get_config("show_ui", True) and not self._ui_process:
                            self._start_ui()
                        continue
                    
                    # 处理权限响应
                    if data.get("type") == "permission_response":
                        request_id = data.get("requestId")
                        if request_id in self.pending_permissions:
                            future = self.pending_permissions.pop(request_id)
                            future.set_result(data.get("granted", False))
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
                    error_response = {
                        "type": "plugin_response",
                        "success": False,
                        "error": str(e),
                        "errorKey": "error.execution_failed",
                        "locale": self.i18n.get_frontend_locale()
                    }
                    # data 已成功解析，回传 requestId
                    if isinstance(data, dict) and "requestId" in data:
                        error_response["requestId"] = data["requestId"]
                    await websocket.send(json.dumps(error_response))
                    
        except websockets.exceptions.ConnectionClosed:
            print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.disconnected')}: {websocket.remote_address}")
        finally:
            self.clients.discard(websocket)
    
    async def _dispatch_action(self, data: dict, websocket: ServerConnection):
        """在后台任务中执行操作，使主消息循环不被阻塞"""
        try:
            response = await self.handle_message(data, websocket)
            # 回传 requestId，供前端 callPlugin 匹配响应
            if "requestId" in data:
                response["requestId"] = data["requestId"]
            await websocket.send(json.dumps(response))
        except Exception as e:
            error_response = {
                "type": "plugin_response",
                "success": False,
                "error": str(e),
                "errorKey": "error.execution_failed",
                "locale": self.i18n.get_frontend_locale()
            }
            if "requestId" in data:
                error_response["requestId"] = data["requestId"]
            try:
                await websocket.send(json.dumps(error_response))
            except Exception:
                pass

    # ==================== 路径处理 ====================

    @staticmethod
    def _resolve_path(p: str) -> str:
        """解析路径：展开 ~ 前缀，相对路径基于用户主目录（而非插件工作目录）。
        使用 pathlib.Path.home() 保证 Windows/macOS/Linux 行为一致。"""
        expanded = os.path.expanduser(p)
        if not os.path.isabs(expanded):
            expanded = os.path.join(str(Path.home()), expanded)
        return os.path.normpath(expanded)

    async def request_config(self, websocket: ServerConnection):
        """向前端请求配置"""
        await websocket.send(json.dumps({
            "action": "getConfig",
            "pluginId": "terminal"
        }))
    
    def get_config(self, key: str, default=None):
        """获取配置值"""
        return self.config.get(key, default)
    
    async def request_permission(self, websocket: ServerConnection, permission_id: str, operation: str, details: dict = None) -> bool:
        """请求权限"""
        request_id = str(uuid.uuid4())
        
        # 创建 Future 用于等待响应
        future = asyncio.Future()
        self.pending_permissions[request_id] = future
        
        # 发送权限请求
        await websocket.send(json.dumps({
            "type": "permission_request",
            "requestId": request_id,
            "permissionId": permission_id,
            "operation": operation,
            "details": details or {}
        }))
        
        try:
            # 等待响应（30秒超时）
            granted = await asyncio.wait_for(future, timeout=30.0)
            return granted
        except asyncio.TimeoutError:
            self.pending_permissions.pop(request_id, None)
            return False
    
    def is_dangerous_command(self, command: str) -> bool:
        """检查是否为危险命令"""
        dangerous_list = self.get_config("dangerousCommands", [
            "rm -rf", "del /f", "format", "mkfs", "dd if=", ">(", "curl", "wget"
        ])
        return any(danger in command.lower() for danger in dangerous_list)
    
    async def broadcast_to_ui(self, message: dict):
        """向终端监视器 UI 推送事件（通过 UDP）"""
        if not self._ui_sock:
            return
        try:
            payload = json.dumps(message).encode("utf-8")
            self._ui_sock.sendto(payload, self._ui_addr)
        except Exception:
            pass  # UDP 发送失败不影响主流程
            
    async def handle_message(self, data: dict, websocket: ServerConnection) -> dict:
        """处理消息"""
        action = data.get("action")
        params = data.get("params", {})
        
        try:
            if action == "execute":
                return await self.execute_command(params, websocket)
            elif action == "createSession":
                return await self.create_session(params, websocket)
            elif action == "getSessions":
                return await self.get_sessions(params)
            elif action == "closeSession":
                return await self.close_session(params, websocket)
            elif action == "sendInput":
                return await self.send_input(params, websocket)
            elif action == "getCurrentDirectory":
                return await self.get_current_directory(params)
            elif action == "resize":
                return await self.resize(params)
            else:
                return {
                    "type": "plugin_response",
                    "success": False,
                    "error": self.i18n.t("error.unknown_action", action=action),
                    "errorKey": "error.unknown_action",
                    "locale": self.i18n.get_frontend_locale()
                }
        except Exception as e:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.execution_failed", error=str(e)),
                "errorKey": "error.execution_failed",
                "locale": self.i18n.get_frontend_locale()
            }
            
    async def execute_command(self, params: dict, websocket: ServerConnection) -> dict:
        """执行命令"""
        command = params.get("command")
        if not command:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.command_required"),
                "errorKey": "error.command_required",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": None
            }
        
        # 检查是否需要权限
        if self.is_dangerous_command(command):
            granted = await self.request_permission(
                websocket,
                "terminal.execute",
                "execute_command",
                {"command": command}
            )
            
            if not granted:
                return {
                    "type": "plugin_response",
                    "success": False,
                    "error": self.i18n.t("error.permission_denied"),
                    "errorKey": "error.permission_denied",
                    "locale": self.i18n.get_frontend_locale(),
                    "requiredPermission": "terminal.execute"
                }
            
        cwd = self._resolve_path(params.get("cwd") or str(Path.home()))
        timeout = self.get_config("commandTimeout", params.get("timeout", 30))
        
        # 广播命令开始
        await self.broadcast_to_ui({
            "type": "terminal_output",
            "event": "command_start",
            "data": {"command": command, "cwd": cwd}
        })
        
        start_time = datetime.now()
        
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # 广播命令输出
            await self.broadcast_to_ui({
                "type": "terminal_output",
                "event": "command_output",
                "data": {"stdout": result.stdout, "stderr": result.stderr}
            })
            
            # 广播命令结束
            await self.broadcast_to_ui({
                "type": "terminal_output",
                "event": "command_end",
                "data": {"exitCode": result.returncode, "command": command, "duration": duration_ms}
            })
            
            return {
                "type": "plugin_response",
                "success": True,
                "action": "execute",
                "result": {
                    "type": "data",
                    "content": {
                        "stdout": result.stdout,
                        "stderr": result.stderr,
                        "exitCode": result.returncode,
                        "command": command
                    }
                },
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": "terminal.execute" if self.is_dangerous_command(command) else None
            }
        except subprocess.TimeoutExpired:
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # 广播超时错误
            await self.broadcast_to_ui({
                "type": "terminal_output",
                "event": "command_error",
                "data": {"error": f"命令超时 ({timeout}s)", "command": command, "duration": duration_ms}
            })
            
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.command_timeout", timeout=timeout),
                "errorKey": "error.command_timeout",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": "terminal.execute" if self.is_dangerous_command(command) else None
            }
            
    async def create_session(self, params: dict, websocket: ServerConnection) -> dict:
        """创建会话"""
        # 请求 session.create 权限
        granted = await self.request_permission(
            websocket,
            "terminal.session",
            "create_session",
            {"shell": params.get("shell"), "cwd": params.get("cwd")}
        )
        
        if not granted:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.permission_denied"),
                "errorKey": "error.permission_denied",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": "terminal.session"
            }
        
        # 检查会话数量限制
        max_sessions = self.get_config("maxSessionCount", 5)
        if len(self.sessions) >= max_sessions:
            return {
                "type": "plugin_response",
                "success": False,
                "error": f"已达到最大会话数量限制 ({max_sessions})",
                "errorKey": "error.max_sessions_reached",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": "terminal.session"
            }
        
        shell = params.get("shell", self.get_config("defaultShell", "/bin/bash" if os.name != "nt" else "cmd.exe"))
        cwd = self._resolve_path(params.get("cwd") or self.get_config("workingDirectory") or str(Path.home()))
        session_id = str(uuid.uuid4())
        
        session = TerminalSession(session_id, shell, cwd)
        session.start()
        self.sessions[session_id] = session
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "createSession",
            "result": {
                "type": "data",
                "content": {
                    "sessionId": session_id,
                    "shell": shell,
                    "cwd": cwd
                }
            },
            "locale": self.i18n.get_frontend_locale(),
            "requiredPermission": "terminal.session"
        }
        
    async def get_sessions(self, params: dict) -> dict:
        """获取会话列表"""
        sessions_info = []
        for sid, session in self.sessions.items():
            sessions_info.append({
                "sessionId": sid,
                "shell": session.shell,
                "cwd": session.cwd,
                "alive": session.is_alive(),
                "createdAt": session.created_at.isoformat()
            })
            
        return {
            "type": "plugin_response",
            "success": True,
            "action": "getSessions",
            "result": {
                "type": "data",
                "content": {
                    "sessions": sessions_info
                }
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def close_session(self, params: dict, websocket: ServerConnection) -> dict:
        """关闭会话"""
        session_id = params.get("sessionId")
        if not session_id:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.session_id_required"),
                "errorKey": "error.session_id_required",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": None
            }
            
        session = self.sessions.get(session_id)
        if not session:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.session_not_found"),
                "errorKey": "error.session_not_found",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": None
            }
        
        # 请求关闭会话权限
        granted = await self.request_permission(
            websocket,
            "terminal.session",
            "close_session",
            {"sessionId": session_id}
        )
        
        if not granted:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.permission_denied"),
                "errorKey": "error.permission_denied",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": "terminal.session"
            }
            
        session.terminate()
        del self.sessions[session_id]
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "closeSession",
            "result": {
                "type": "data",
                "content": {
                    "sessionId": session_id
                }
            },
            "locale": self.i18n.get_frontend_locale(),
            "requiredPermission": "terminal.session"
        }
        
    async def send_input(self, params: dict, websocket: ServerConnection) -> dict:
        """发送输入到会话"""
        session_id = params.get("sessionId")
        data = params.get("data")
        
        if not session_id or data is None:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.input_required"),
                "errorKey": "error.input_required",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": None
            }
            
        session = self.sessions.get(session_id)
        if not session:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.session_not_found"),
                "errorKey": "error.session_not_found",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": None
            }
            
        success = session.send_input(data)
        
        return {
            "type": "plugin_response",
            "success": success,
            "action": "sendInput",
            "result": {
                "type": "data",
                "content": {
                    "sessionId": session_id
                }
            },
            "locale": self.i18n.get_frontend_locale(),
            "requiredPermission": "terminal.session"
        }
        
    async def get_current_directory(self, params: dict) -> dict:
        """获取当前目录"""
        session_id = params.get("sessionId")
        
        if session_id:
            session = self.sessions.get(session_id)
            if session:
                return {
                    "type": "plugin_response",
                    "success": True,
                    "action": "getCurrentDirectory",
                    "result": {
                        "type": "data",
                        "content": {
                            "cwd": session.cwd
                        }
                    },
                    "locale": self.i18n.get_frontend_locale()
                }
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "getCurrentDirectory",
            "result": {
                "type": "data",
                "content": {
                    "cwd": os.getcwd()
                }
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def resize(self, params: dict) -> dict:
        """调整终端大小（基础实现不支持）"""
        return {
            "type": "plugin_response",
            "success": False,
            "error": self.i18n.t("info.resize_not_supported"),
            "errorKey": "info.resize_not_supported",
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def start(self):
        """启动插件"""
        print(f"[{self.i18n.t('plugin.name')}] starting on ws://{self.host}:{self.port}")
        
        # UI 延迟到配置加载完成后启动（handle_client 收到 plugin_config 时触发）

        async with websockets.serve(self.handle_client, self.host, self.port):
            print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.ready')}")
            await asyncio.Future()
    
    def _start_ui(self):
        """以独立子进程启动 tkinter UI，使其拥有自己的进程组和 GUI 上下文"""
        # 创建 UDP socket 用于向 UI 发送事件
        self._ui_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        
        plugin_dir = os.path.dirname(os.path.abspath(__file__))
        ui_script = os.path.join(plugin_dir, "terminal_ui.py")
        # 必须解析符号链接获取真实路径，否则 venv 的 symlink 会导致
        # Tcl 无法找到 init.tcl（它按 argv[0] 相对路径查找 lib/tcl8.6）
        python_exe = os.path.realpath(sys.executable)
        ui_log = os.path.join(plugin_dir, "terminal_ui.log")
        
        try:
            log_fd = open(ui_log, "w")
            self._ui_process = subprocess.Popen(
                [python_exe, ui_script, "--port", str(self._ui_addr[1])],
                start_new_session=True,  # 脱离父进程组，获得独立 GUI 上下文
                stdin=subprocess.DEVNULL,
                stdout=log_fd,
                stderr=subprocess.STDOUT,
            )
            log_fd.close()
            print(f"[{self.i18n.t('plugin.name')}] 终端监视器 UI 已启动 (PID: {self._ui_process.pid})")
        except Exception as e:
            print(f"[{self.i18n.t('plugin.name')}] 启动终端监视器 UI 失败: {e}")
            self._ui_process = None
            
    def cleanup(self):
        """清理资源"""
        print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.cleanup')}")
        # 关闭 UI 子进程
        if self._ui_process and self._ui_process.poll() is None:
            try:
                self._ui_process.terminate()
                self._ui_process.wait(timeout=3)
            except Exception:
                try:
                    self._ui_process.kill()
                except Exception:
                    pass
        # 关闭 UDP socket
        if self._ui_sock:
            try:
                self._ui_sock.close()
            except Exception:
                pass
        for session in self.sessions.values():
            session.terminate()
        self.sessions.clear()


def main():
    """主函数"""
    # 默认使用英文，等待前端发送语言请求
    plugin = TerminalPlugin(host="localhost", port=8767, locale="en-US")
    
    def signal_handler(sig, frame):
        print(f"\n[{plugin.i18n.t('plugin.name')}] {plugin.i18n.t('plugin.interrupt')}")
        plugin.cleanup()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        asyncio.run(plugin.start())
    except KeyboardInterrupt:
        plugin.cleanup()


if __name__ == "__main__":
    main()
