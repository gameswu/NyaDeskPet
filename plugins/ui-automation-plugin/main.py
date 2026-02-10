#!/usr/bin/env python3
"""
UI自动化插件
提供鼠标键盘控制、屏幕截图等功能
使用 WebSocket 与 NyaDeskPet 前端通信
"""

import asyncio
import json
import base64
import signal
import sys
from typing import Set
import websockets
from websockets.server import WebSocketServerProtocol
import pyautogui
from PIL import Image
import mss
import io
from i18n import I18n


class UIAutomationPlugin:
    """UI自动化插件主类"""
    
    def __init__(self, host: str = "localhost", port: int = 8766, locale: str = "en-US"):
        self.host = host
        self.port = port
        self.clients: Set[WebSocketServerProtocol] = set()
        self.i18n = I18n(locale, default_locale="en-US")
        
        # 配置 pyautogui
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.1
        
    async def handle_client(self, websocket: WebSocketServerProtocol):
        """处理客户端连接"""
        print(f"📱 {self.i18n.t('plugin.connected')}: {websocket.remote_address}")
        self.clients.add(websocket)
        
        try:
            # 发送连接确认消息
            await websocket.send(json.dumps({
                "type": "connected",
                "plugin": "ui-automation",
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
                            "plugin": "ui-automation",
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
                    
                    # 处理其他操作
                    response = await self.handle_message(data)
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
            print(f"📱 {self.i18n.t('plugin.disconnected')}: {websocket.remote_address}")
        finally:
            self.clients.discard(websocket)
            
    async def handle_message(self, data: dict) -> dict:
        """处理消息"""
        action = data.get("action")
        params = data.get("params", {})
        
        try:
            if action == "captureScreen":
                return await self.capture_screen(params)
            elif action == "mouseClick":
                return await self.mouse_click(params)
            elif action == "mouseMove":
                return await self.mouse_move(params)
            elif action == "mouseDrag":
                return await self.mouse_drag(params)
            elif action == "getMousePosition":
                return await self.get_mouse_position(params)
            elif action == "keyboardType":
                return await self.keyboard_type(params)
            elif action == "keyboardPress":
                return await self.keyboard_press(params)
            elif action == "mouseScroll":
                return await self.mouse_scroll(params)
            elif action == "getScreenSize":
                return await self.get_screen_size(params)
            elif action == "setMouseSpeed":
                return await self.set_mouse_speed(params)
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
            
    async def capture_screen(self, params: dict) -> dict:
        """截取屏幕"""
        display = params.get("display", 1)
        format_type = params.get("format", "png")
        
        with mss.mss() as sct:
            if display < 1 or display > len(sct.monitors) - 1:
                return {
                    "type": "plugin_response",
                    "success": False,
                    "error": self.i18n.t("error.display_not_found", display=display),
                    "errorKey": "error.display_not_found",
                    "locale": self.i18n.get_frontend_locale()
                }
            
            screenshot = sct.grab(sct.monitors[display])
            img = Image.frombytes("RGB", screenshot.size, screenshot.rgb)
            
            buffer = io.BytesIO()
            img.save(buffer, format=format_type.upper())
            img_base64 = base64.b64encode(buffer.getvalue()).decode()
            
            return {
                "type": "plugin_response",
                "success": True,
                "action": "captureScreen",
                "data": {
                    "image": img_base64,
                    "format": format_type,
                    "width": screenshot.width,
                    "height": screenshot.height
                },
                "locale": self.i18n.get_frontend_locale()
            }
            
    async def mouse_click(self, params: dict) -> dict:
        """鼠标点击"""
        x = params.get("x")
        y = params.get("y")
        button = params.get("button", "left")
        clicks = params.get("clicks", 1)
        
        if x is not None and y is not None:
            pyautogui.click(x, y, clicks=clicks, button=button)
        else:
            pyautogui.click(clicks=clicks, button=button)
            
        return {
            "type": "plugin_response",
            "success": True,
            "action": "mouseClick",
            "data": {
                "x": x,
                "y": y,
                "button": button,
                "clicks": clicks
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def mouse_move(self, params: dict) -> dict:
        """鼠标移动"""
        x = params.get("x")
        y = params.get("y")
        
        if x is None or y is None:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.coordinates_required"),
                "errorKey": "error.coordinates_required",
                "locale": self.i18n.get_frontend_locale()
            }
            
        duration = params.get("duration", 0.0)
        pyautogui.moveTo(x, y, duration=duration)
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "mouseMove",
            "data": {
                "x": x,
                "y": y,
                "duration": duration
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def mouse_drag(self, params: dict) -> dict:
        """鼠标拖拽"""
        x = params.get("x")
        y = params.get("y")
        end_x = params.get("endX")
        end_y = params.get("endY")
        
        if x is None or y is None or end_x is None or end_y is None:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.drag_params_required"),
                "errorKey": "error.drag_params_required",
                "locale": self.i18n.get_frontend_locale()
            }
            
        button = params.get("button", "left")
        duration = params.get("duration", 0.5)
        
        pyautogui.moveTo(x, y)
        pyautogui.drag(end_x - x, end_y - y, duration=duration, button=button)
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "mouseDrag",
            "data": {
                "x": x,
                "y": y,
                "endX": end_x,
                "endY": end_y,
                "button": button
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def get_mouse_position(self, params: dict) -> dict:
        """获取鼠标位置"""
        position = pyautogui.position()
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "getMousePosition",
            "data": {
                "x": position.x,
                "y": position.y
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def keyboard_type(self, params: dict) -> dict:
        """键盘输入"""
        text = params.get("text")
        
        if not text:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.text_required"),
                "errorKey": "error.text_required",
                "locale": self.i18n.get_frontend_locale()
            }
            
        interval = params.get("interval", 0.0)
        pyautogui.typewrite(text, interval=interval)
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "keyboardType",
            "data": {
                "text": text,
                "interval": interval
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def keyboard_press(self, params: dict) -> dict:
        """按键"""
        key = params.get("key")
        
        if not key:
            return {
                "type": "plugin_response",
                "success": False,
                "error": self.i18n.t("error.text_required"),
                "errorKey": "error.text_required",
                "locale": self.i18n.get_frontend_locale()
            }
            
        presses = params.get("presses", 1)
        pyautogui.press(key, presses=presses)
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "keyboardPress",
            "data": {
                "key": key,
                "presses": presses
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def mouse_scroll(self, params: dict) -> dict:
        """鼠标滚轮"""
        clicks = params.get("clicks", 1)
        pyautogui.scroll(clicks)
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "mouseScroll",
            "data": {
                "clicks": clicks
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def get_screen_size(self, params: dict) -> dict:
        """获取屏幕尺寸"""
        size = pyautogui.size()
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "getScreenSize",
            "data": {
                "width": size.width,
                "height": size.height
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def set_mouse_speed(self, params: dict) -> dict:
        """设置鼠标速度"""
        speed = params.get("speed", 0.1)
        pyautogui.PAUSE = speed
        
        return {
            "type": "plugin_response",
            "success": True,
            "action": "setMouseSpeed",
            "data": {
                "speed": speed
            },
            "locale": self.i18n.get_frontend_locale()
        }
        
    async def start(self):
        """启动插件"""
        print(f"🚀 {self.i18n.t('plugin.name')} starting on ws://{self.host}:{self.port}")
        
        async with websockets.serve(self.handle_client, self.host, self.port):
            screen_size = pyautogui.size()
            print(f"✅ {self.i18n.t('plugin.ready')}")
            print(f"📌 {self.i18n.t('plugin.screen_size')}: {screen_size}")
            await asyncio.Future()


def main():
    """主函数"""
    # 默认使用英文，等待前端发送语言请求
    plugin = UIAutomationPlugin(host="localhost", port=8766, locale="en-US")
    
    def signal_handler(sig, frame):
        print(f"\n⚠️  {plugin.i18n.t('plugin.interrupt')}")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        asyncio.run(plugin.start())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
