#!/usr/bin/env python3
"""
终端监视器 UI（独立进程）
通过 localhost UDP 接收终端事件，以 tkinter 窗口实时展示 Agent 的终端操作。

启动方式：
    python terminal_ui.py [--port 19099]

由 main.py 在插件启动时以子进程方式自动拉起。
"""

import json
import socket
import tkinter as tk
from tkinter import scrolledtext
import argparse
import threading
from datetime import datetime

# UDP 接收默认端口
DEFAULT_UDP_PORT = 19099
# 最大 UDP 报文
UDP_BUFSIZE = 65535


# ────────────────── 颜色主题 ──────────────────
THEME = {
    "bg": "#1e1e2e",
    "bg_secondary": "#181825",
    "bg_surface": "#313244",
    "text": "#cdd6f4",
    "text_secondary": "#a6adc8",
    "text_muted": "#6c7086",
    "accent": "#89b4fa",
    "green": "#a6e3a1",
    "red": "#f38ba8",
    "yellow": "#f9e2af",
    "peach": "#fab387",
    "border": "#45475a",
}


class TerminalMonitor:
    """终端监视器窗口"""

    MAX_LINES = 2000
    POLL_INTERVAL = 50  # ms

    def __init__(self, udp_port: int):
        self._udp_port = udp_port
        self._root = None
        self._text = None
        self._status_var = None
        self._time_var = None
        self._scroll_btn = None
        self._cmd_count = 0
        self._auto_scroll = True
        self._pending = []  # 收到但尚未渲染的事件
        self._lock = threading.Lock()
        self._sock = None
        self._recv_thread = None

    # ──────────── 入口 ────────────

    def run(self):
        """启动 UI（在主线程中调用，阻塞直到窗口关闭）"""
        self._start_udp_receiver()
        self._build_ui()
        self._poll_events()
        self._root.mainloop()

    # ──────────── UDP 接收 ────────────

    def _start_udp_receiver(self):
        """在后台线程中监听 UDP 事件"""
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", self._udp_port))
        self._sock.settimeout(0.5)

        def _recv_loop():
            while True:
                try:
                    data, _ = self._sock.recvfrom(UDP_BUFSIZE)
                    event = json.loads(data.decode("utf-8"))
                    with self._lock:
                        self._pending.append(event)
                except socket.timeout:
                    continue
                except (OSError, json.JSONDecodeError):
                    continue

        self._recv_thread = threading.Thread(target=_recv_loop, daemon=True, name="udp-recv")
        self._recv_thread.start()

    # ──────────── UI 构建 ────────────

    def _build_ui(self):
        root = tk.Tk()
        root.title("NyaDeskPet Terminal Monitor")
        root.geometry("760x500")
        root.configure(bg=THEME["bg"])
        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.minsize(480, 320)
        self._root = root

        # ── 顶栏 ──
        toolbar = tk.Frame(root, bg=THEME["bg_secondary"], height=32)
        toolbar.pack(fill=tk.X, side=tk.TOP)
        toolbar.pack_propagate(False)

        tk.Label(
            toolbar, text="🐱 Terminal Monitor",
            bg=THEME["bg_secondary"], fg=THEME["accent"],
            font=("Menlo", 12, "bold"), padx=10,
        ).pack(side=tk.LEFT)

        tk.Button(
            toolbar, text="清空",
            bg=THEME["bg_surface"], fg=THEME["text_secondary"],
            activebackground=THEME["border"], activeforeground=THEME["red"],
            relief=tk.FLAT, font=("Menlo", 11), padx=8,
            command=self._clear_output,
        ).pack(side=tk.RIGHT, padx=6, pady=4)

        self._scroll_btn = tk.Button(
            toolbar, text="↓ 自动滚动",
            bg=THEME["bg_surface"], fg=THEME["accent"],
            activebackground=THEME["border"], activeforeground=THEME["accent"],
            relief=tk.FLAT, font=("Menlo", 11), padx=8,
            command=self._toggle_auto_scroll,
        )
        self._scroll_btn.pack(side=tk.RIGHT, padx=2, pady=4)

        # ── 终端输出区 ──
        text_frame = tk.Frame(root, bg=THEME["bg"])
        text_frame.pack(fill=tk.BOTH, expand=True)

        self._text = scrolledtext.ScrolledText(
            text_frame,
            bg=THEME["bg"], fg=THEME["text"],
            insertbackground=THEME["text"], selectbackground=THEME["border"],
            font=("Menlo", 12), wrap=tk.WORD, relief=tk.FLAT,
            borderwidth=0, padx=12, pady=8,
            state=tk.DISABLED, cursor="arrow",
        )
        self._text.pack(fill=tk.BOTH, expand=True)

        # 标签样式
        tags = {
            "timestamp":    {"foreground": THEME["text_muted"], "font": ("Menlo", 10)},
            "command":      {"foreground": THEME["yellow"], "font": ("Menlo", 12, "bold")},
            "stdout":       {"foreground": THEME["text"]},
            "stderr":       {"foreground": THEME["red"]},
            "exit_ok":      {"foreground": THEME["green"], "font": ("Menlo", 10)},
            "exit_fail":    {"foreground": THEME["red"], "font": ("Menlo", 10)},
            "system":       {"foreground": THEME["text_secondary"], "font": ("Menlo", 11)},
            "source_agent": {"foreground": THEME["accent"], "font": ("Menlo", 10, "bold")},
            "source_error": {"foreground": THEME["red"], "font": ("Menlo", 10, "bold")},
            "separator":    {"foreground": THEME["border"]},
            "cwd":          {"foreground": THEME["text_muted"], "font": ("Menlo", 10)},
        }
        for name, cfg in tags.items():
            self._text.tag_configure(name, **cfg)

        # ── 底部状态栏 ──
        status_bar = tk.Frame(root, bg=THEME["bg_secondary"], height=24)
        status_bar.pack(fill=tk.X, side=tk.BOTTOM)
        status_bar.pack_propagate(False)

        self._status_var = tk.StringVar(value="命令: 0")
        tk.Label(
            status_bar, textvariable=self._status_var,
            bg=THEME["bg_secondary"], fg=THEME["text_muted"],
            font=("Menlo", 10), padx=10,
        ).pack(side=tk.LEFT)

        self._time_var = tk.StringVar(value="-")
        tk.Label(
            status_bar, textvariable=self._time_var,
            bg=THEME["bg_secondary"], fg=THEME["text_muted"],
            font=("Menlo", 10), padx=10,
        ).pack(side=tk.RIGHT)

        # 欢迎信息
        self._append("system", "终端监视器已启动 — 等待 Agent 执行终端命令...\n")

    # ──────────── 事件轮询 ────────────

    def _poll_events(self):
        """从 pending 列表取事件并渲染"""
        with self._lock:
            events = self._pending[:]
            self._pending.clear()

        for event in events:
            self._handle_event(event)

        if self._root:
            self._root.after(self.POLL_INTERVAL, self._poll_events)

    def _handle_event(self, event):
        event_type = event.get("event", "")
        data = event.get("data", {})

        if event_type == "command_start":
            self._cmd_count += 1
            self._status_var.set(f"命令: {self._cmd_count}")
            ts = self._ts()
            self._append("timestamp", f"{ts} ")
            self._append("source_agent", "AGENT ")
            self._append("command", f"$ {data.get('command', '')}")
            cwd = data.get("cwd", "")
            if cwd:
                self._append("cwd", f"  ({cwd})")
            self._append("stdout", "\n")

        elif event_type == "command_output":
            stdout = data.get("stdout", "")
            stderr = data.get("stderr", "")
            if stdout:
                self._append("stdout", stdout)
                if not stdout.endswith("\n"):
                    self._append("stdout", "\n")
            if stderr:
                self._append("stderr", stderr)
                if not stderr.endswith("\n"):
                    self._append("stderr", "\n")

        elif event_type == "command_end":
            exit_code = data.get("exitCode", -1)
            duration = data.get("duration", 0)
            tag = "exit_ok" if exit_code == 0 else "exit_fail"
            ts = self._ts()
            self._append("timestamp", f"{ts} ")
            self._append(tag, f"退出码: {exit_code}")
            if duration:
                self._append("cwd", f"  耗时: {duration}ms")
            self._append("stdout", "\n")
            self._append("separator", "─" * 60 + "\n")
            self._time_var.set(ts)

        elif event_type == "command_error":
            error = data.get("error", "未知错误")
            ts = self._ts()
            self._append("timestamp", f"{ts} ")
            self._append("source_error", "ERROR ")
            self._append("stderr", f"{error}\n")
            self._append("separator", "─" * 60 + "\n")
            self._time_var.set(ts)

        self._trim_lines()

    # ──────────── 文本操作 ────────────

    def _append(self, tag, text):
        self._text.configure(state=tk.NORMAL)
        self._text.insert(tk.END, text, tag)
        self._text.configure(state=tk.DISABLED)
        if self._auto_scroll:
            self._text.see(tk.END)

    def _trim_lines(self):
        line_count = int(self._text.index("end-1c").split(".")[0])
        if line_count > self.MAX_LINES:
            self._text.configure(state=tk.NORMAL)
            self._text.delete("1.0", f"{line_count - self.MAX_LINES}.0")
            self._text.configure(state=tk.DISABLED)

    def _clear_output(self):
        self._text.configure(state=tk.NORMAL)
        self._text.delete("1.0", tk.END)
        self._text.configure(state=tk.DISABLED)
        self._cmd_count = 0
        self._status_var.set("命令: 0")
        self._append("system", "已清空\n")

    def _toggle_auto_scroll(self):
        self._auto_scroll = not self._auto_scroll
        if self._auto_scroll:
            self._scroll_btn.configure(fg=THEME["accent"])
            self._text.see(tk.END)
        else:
            self._scroll_btn.configure(fg=THEME["text_muted"])

    def _on_close(self):
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
        self._root.destroy()

    @staticmethod
    def _ts():
        return datetime.now().strftime("%H:%M:%S")


def main():
    parser = argparse.ArgumentParser(description="NyaDeskPet Terminal Monitor")
    parser.add_argument("--port", type=int, default=DEFAULT_UDP_PORT, help="UDP 监听端口")
    args = parser.parse_args()

    monitor = TerminalMonitor(udp_port=args.port)
    monitor.run()


if __name__ == "__main__":
    main()
