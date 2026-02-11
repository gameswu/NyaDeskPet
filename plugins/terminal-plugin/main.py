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
from typing import Dict, Optional
from datetime import datetime
import websockets
from websockets.server import WebSocketServerProtocol
import psutil
from i18n import I18n


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
        
    async def handle_client(self, websocket: WebSocketServerProtocol):
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
                        print(f"✅ 已加载配置: {self.config}")
                        continue
                    
                    # 处理权限响应
                    if data.get("type") == "permission_response":
                        request_id = data.get("requestId")
                        if request_id in self.pending_permissions:
                            future = self.pending_permissions.pop(request_id)
                            future.set_result(data.get("granted", False))
                        continue
                    
                    # 处理其他操作
                    response = await self.handle_message(data, websocket)
                    await websocket.send(json.dumps(response))
                    
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        "type": "plugin_response",
                        "success": False,
                        "error": self.i18n.t("error.invalid_json"),
                        "errorKey": "error.invalid_json",
                        "locale": self.i18n.get_frontend_locale()
                    }))
                except Exception as e:
                    await websocket.send(json.dumps({
                        "type": "plugin_response",
                        "success": False,
                        "error": str(e),
                        "errorKey": "error.execution_failed",
                        "locale": self.i18n.get_frontend_locale()
                    }))
                    
        except websockets.exceptions.ConnectionClosed:
            print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.disconnected')}: {websocket.remote_address}")
        finally:
            self.clients.discard(websocket)
    
    async def request_config(self, websocket: WebSocketServerProtocol):
        """向前端请求配置"""
        await websocket.send(json.dumps({
            "action": "getConfig",
            "pluginId": "terminal"
        }))
    
    def get_config(self, key: str, default=None):
        """获取配置值"""
        return self.config.get(key, default)
    
    async def request_permission(self, websocket: WebSocketServerProtocol, permission_id: str, operation: str, details: dict = None) -> bool:
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
            
    async def handle_message(self, data: dict, websocket: WebSocketServerProtocol) -> dict:
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
            
    async def execute_command(self, params: dict, websocket: WebSocketServerProtocol) -> dict:
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
            
        cwd = params.get("cwd", os.getcwd())
        timeout = self.get_config("commandTimeout", params.get("timeout", 30))
        
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
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
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.command_timeout", timeout=timeout),
                "errorKey": "error.command_timeout",
                "locale": self.i18n.get_frontend_locale(),
                "requiredPermission": "terminal.execute" if self.is_dangerous_command(command) else None
            }
            
    async def create_session(self, params: dict, websocket: WebSocketServerProtocol) -> dict:
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
        cwd = params.get("cwd", self.get_config("workingDirectory", os.getcwd()))
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
        
    async def close_session(self, params: dict, websocket: WebSocketServerProtocol) -> dict:
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
        
    async def send_input(self, params: dict, websocket: WebSocketServerProtocol) -> dict:
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
        
        async with websockets.serve(self.handle_client, self.host, self.port):
            print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.ready')}")
            await asyncio.Future()
            
    def cleanup(self):
        """清理资源"""
        print(f"[{self.i18n.t('plugin.name')}] {self.i18n.t('plugin.cleanup')}")
        for session in self.sessions.values():
            session.terminate()
        self.sessions.clear()


def main():
    """主函数"""
    # 默认使用英文，等待前端发送语言请求
    plugin = TerminalPlugin(host="localhost", port=8765, locale="en-US")
    
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
