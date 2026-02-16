#!/usr/bin/env python3
"""
文件编辑器 Diff UI（独立进程）
通过 localhost UDP 接收文件操作事件，以 tkinter 窗口实时展示类 VSCode Copilot 风格的
文件读取/写入/编辑 Diff 视图。

启动方式：
    python file_editor_ui.py [--port 19098]

由 main.py 在插件启动时以子进程方式自动拉起。
"""

import json
import socket
import tkinter as tk
from tkinter import scrolledtext
import argparse
import threading
from datetime import datetime

DEFAULT_UDP_PORT = 19098
UDP_BUFSIZE = 65535

# ────────────────── Catppuccin Mocha 颜色主题 ──────────────────
THEME = {
    "bg": "#1e1e2e",
    "bg_secondary": "#181825",
    "bg_surface": "#313244",
    "text": "#cdd6f4",
    "text_secondary": "#a6adc8",
    "text_muted": "#6c7086",
    "accent": "#89b4fa",
    "green": "#a6e3a1",
    "green_bg": "#1a2e1a",
    "red": "#f38ba8",
    "red_bg": "#2e1a1a",
    "yellow": "#f9e2af",
    "peach": "#fab387",
    "mauve": "#cba6f7",
    "teal": "#94e2d5",
    "border": "#45475a",
    "line_num": "#585b70",
}


class FileEditorMonitor:
    """文件编辑器 Diff 监视器窗口"""

    MAX_ENTRIES = 200
    POLL_INTERVAL = 50  # ms
    # 内容预览折叠阈值（超过此行数的内容默认折叠）
    COLLAPSE_THRESHOLD = 8

    def __init__(self, udp_port: int):
        self._udp_port = udp_port
        self._root = None
        self._text = None
        self._status_var = None
        self._time_var = None
        self._scroll_btn = None
        self._op_count = 0
        self._auto_scroll = True
        self._pending = []
        self._lock = threading.Lock()
        self._sock = None
        self._recv_thread = None
        # 折叠区域计数器（用于生成唯一 tag 名）
        self._collapse_id = 0

    # ──────────── 入口 ────────────

    def run(self):
        self._start_udp_receiver()
        self._build_ui()
        self._poll_events()
        self._root.mainloop()

    # ──────────── UDP 接收 ────────────

    def _start_udp_receiver(self):
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
        root.title("NyaDeskPet File Editor")
        root.geometry("820x580")
        root.configure(bg=THEME["bg"])
        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.minsize(540, 380)
        self._root = root

        # ── 顶栏 ──
        toolbar = tk.Frame(root, bg=THEME["bg_secondary"], height=32)
        toolbar.pack(fill=tk.X, side=tk.TOP)
        toolbar.pack_propagate(False)

        tk.Label(
            toolbar, text="🐱 File Editor",
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

        # ── 文本区 ──
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
            # 基础
            "timestamp":    {"foreground": THEME["text_muted"], "font": ("Menlo", 10)},
            "system":       {"foreground": THEME["text_secondary"], "font": ("Menlo", 11)},
            "separator":    {"foreground": THEME["border"]},
            "path":         {"foreground": THEME["yellow"], "font": ("Menlo", 12, "bold")},
            "info":         {"foreground": THEME["text_muted"], "font": ("Menlo", 10)},

            # 操作类型标签
            "op_read":      {"foreground": THEME["accent"], "font": ("Menlo", 10, "bold")},
            "op_write":     {"foreground": THEME["green"], "font": ("Menlo", 10, "bold")},
            "op_edit":      {"foreground": THEME["mauve"], "font": ("Menlo", 10, "bold")},
            "op_list":      {"foreground": THEME["teal"], "font": ("Menlo", 10, "bold")},

            # Diff 内容
            "line_num":     {"foreground": THEME["line_num"], "font": ("Menlo", 10)},
            "content":      {"foreground": THEME["text"], "font": ("Menlo", 11)},
            "added":        {"foreground": THEME["green"], "background": THEME["green_bg"], "font": ("Menlo", 11)},
            "removed":      {"foreground": THEME["red"], "background": THEME["red_bg"], "font": ("Menlo", 11)},
            "diff_header":  {"foreground": THEME["mauve"], "font": ("Menlo", 10, "bold")},

            # 目录列表
            "dir_entry":    {"foreground": THEME["accent"], "font": ("Menlo", 11)},
            "file_entry":   {"foreground": THEME["text"], "font": ("Menlo", 11)},
            "file_size":    {"foreground": THEME["text_muted"], "font": ("Menlo", 10)},
            # 折叠切换按钮
            "toggle":       {"foreground": THEME["accent"], "font": ("Menlo", 10, "bold"),
                             "underline": True},
        }
        for name, cfg in tags.items():
            self._text.tag_configure(name, **cfg)

        # 点击折叠按钮时的事件绑定
        self._text.tag_bind("toggle", "<Button-1>", self._on_toggle_click)
        self._text.tag_bind("toggle", "<Enter>",
                            lambda e: self._text.configure(cursor="hand2"))
        self._text.tag_bind("toggle", "<Leave>",
                            lambda e: self._text.configure(cursor="arrow"))

        # ── 底部状态栏 ──
        status_bar = tk.Frame(root, bg=THEME["bg_secondary"], height=24)
        status_bar.pack(fill=tk.X, side=tk.BOTTOM)
        status_bar.pack_propagate(False)

        self._status_var = tk.StringVar(value="操作: 0")
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

        self._append("system", "文件编辑器已启动 — 等待 Agent 文件操作...\n")

    # ──────────── 事件轮询 ────────────

    def _poll_events(self):
        with self._lock:
            events = self._pending[:]
            self._pending.clear()
        for event in events:
            self._handle_event(event)
        if self._root:
            self._root.after(self.POLL_INTERVAL, self._poll_events)

    def _handle_event(self, event):
        if event.get("type") != "file_op":
            return

        op = event.get("op", "")
        self._op_count += 1
        self._status_var.set(f"操作: {self._op_count}")
        ts = self._ts()
        self._time_var.set(ts)

        if op == "read":
            self._render_read(event, ts)
        elif op == "write":
            self._render_write(event, ts)
        elif op == "edit":
            self._render_edit(event, ts)
        elif op == "list":
            self._render_list(event, ts)

        self._trim()

    # ──────────── 可折叠区域 ────────────

    def _begin_collapsible(self, summary: str) -> str:
        """
        开始一个可折叠区域。返回区域 ID（用于 _end_collapsible）。
        summary: 折叠时显示的简要描述文字
        默认处于折叠（隐藏）状态。
        """
        self._collapse_id += 1
        cid = f"collapse_{self._collapse_id}"
        toggle_tag = f"toggle_{cid}"
        body_tag = f"body_{cid}"

        # 插入 ▶ 切换按钮 —— 同时带有通用 "toggle" 标签（绑定事件）和唯一标签（定位）
        self._text.configure(state=tk.NORMAL)
        self._text.insert(tk.END, f"  ▶ {summary}\n", ("toggle", toggle_tag))
        self._text.configure(state=tk.DISABLED)

        # 记录 body 起始位置（由后续 _append 写入）
        self._text.configure(state=tk.NORMAL)
        start_mark = f"start_{cid}"
        self._text.mark_set(start_mark, tk.END)
        self._text.mark_gravity(start_mark, tk.LEFT)
        self._text.configure(state=tk.DISABLED)

        # 保存元信息到 toggle tag（通过 tag 名约定即可在点击事件中还原）
        # 体的 tag 名就是 body_tag
        return cid

    def _end_collapsible(self, cid: str):
        """结束可折叠区域，对 body 范围打 tag 并默认折叠。"""
        body_tag = f"body_{cid}"
        start_mark = f"start_{cid}"
        self._text.configure(state=tk.NORMAL)
        try:
            self._text.tag_add(body_tag, start_mark, tk.END)
        except tk.TclError:
            pass
        # 默认折叠
        self._text.tag_configure(body_tag, elide=True)
        self._text.configure(state=tk.DISABLED)

    def _on_toggle_click(self, event):
        """处理折叠按钮点击事件"""
        # 定位点击位置所对应的所有 tag
        index = self._text.index(f"@{event.x},{event.y}")
        tags = self._text.tag_names(index)
        # 找到唯一的 toggle_collapse_N tag
        toggle_tag = None
        for t in tags:
            if t.startswith("toggle_collapse_"):
                toggle_tag = t
                break
        if not toggle_tag:
            return

        cid = toggle_tag.replace("toggle_", "")  # → collapse_N
        body_tag = f"body_{cid}"

        # 切换 elide 状态
        try:
            current = self._text.tag_cget(body_tag, "elide")
        except tk.TclError:
            return

        collapsed = (current == "1" or current is True or current == "true")
        self._text.configure(state=tk.NORMAL)

        # 更新箭头符号
        tr = self._text.tag_ranges(toggle_tag)
        if tr:
            old_text = self._text.get(str(tr[0]), str(tr[1]))
            if collapsed:
                new_text = old_text.replace("▶", "▼", 1)
            else:
                new_text = old_text.replace("▼", "▶", 1)
            self._text.delete(str(tr[0]), str(tr[1]))
            self._text.insert(str(tr[0]), new_text, ("toggle", toggle_tag))

        self._text.tag_configure(body_tag, elide=not collapsed)
        self._text.configure(state=tk.DISABLED)

    # ──────────── 读取 ────────────

    def _render_read(self, ev, ts):
        path = ev.get("path", "?")
        line_info = ev.get("lineInfo", "")
        preview = ev.get("contentPreview", "")

        self._append("timestamp", f"{ts} ")
        self._append("op_read", "READ ")
        self._append("path", self._short_path(path))
        self._append("info", f"  ({line_info})\n")

        # 显示内容预览（带行号），超过阈值则折叠
        if preview:
            lines = preview.split("\n")
            max_show = min(len(lines), 30)
            use_collapse = max_show > self.COLLAPSE_THRESHOLD

            cid = None
            if use_collapse:
                cid = self._begin_collapsible(f"查看内容 ({max_show} 行)")

            for i in range(max_show):
                ln = f"{i+1:>4} │ "
                self._append("line_num", ln)
                self._append("content", lines[i] + "\n")
            if len(lines) > max_show:
                self._append("info", f"     ... 共 {len(lines)} 行，已截断显示\n")

            if cid:
                self._end_collapsible(cid)

        self._append("separator", "─" * 70 + "\n")

    # ──────────── 写入 ────────────

    def _render_write(self, ev, ts):
        path = ev.get("path", "?")
        is_new = ev.get("isNew", False)
        old_content = ev.get("oldContent", "")
        new_content = ev.get("newContent", "")
        lines = ev.get("lines", 0)

        self._append("timestamp", f"{ts} ")
        self._append("op_write", "CREATE " if is_new else "WRITE ")
        self._append("path", self._short_path(path))
        self._append("info", f"  ({lines} lines)\n")

        # 统计变更行数用于判断是否折叠
        change_lines = max(len(new_content.split("\n")), len(old_content.split("\n")) if old_content else 0)
        use_collapse = change_lines > self.COLLAPSE_THRESHOLD

        cid = None
        if use_collapse:
            label = f"查看新文件 ({lines} 行)" if is_new else f"查看变更 (±{change_lines} 行)"
            cid = self._begin_collapsible(label)

        if is_new:
            self._append("diff_header", "  + New file\n")
            self._render_added_lines(new_content, 30)
        else:
            self._render_simple_diff(old_content, new_content, max_lines=30)

        if cid:
            self._end_collapsible(cid)

        self._append("separator", "─" * 70 + "\n")

    # ──────────── 编辑 ────────────

    def _render_edit(self, ev, ts):
        path = ev.get("path", "?")
        start_line = ev.get("startLine", 1)
        old_text = ev.get("oldText", "")
        new_text = ev.get("newText", "")
        old_lines_count = ev.get("oldLines", 0)
        new_lines_count = ev.get("newLines", 0)

        self._append("timestamp", f"{ts} ")
        self._append("op_edit", "EDIT ")
        self._append("path", self._short_path(path))
        self._append("info", f"  (L{start_line}, -{old_lines_count}/+{new_lines_count})\n")

        change_lines = old_lines_count + new_lines_count
        use_collapse = change_lines > self.COLLAPSE_THRESHOLD

        cid = None
        if use_collapse:
            cid = self._begin_collapsible(f"查看差异 (-{old_lines_count}/+{new_lines_count})")

        # VSCode Copilot 风格：先显示删除行，再显示新增行
        self._append("diff_header", f"  @@ -{start_line},{old_lines_count} +{start_line},{new_lines_count} @@\n")

        old_lines = old_text.split("\n")
        new_lines = new_text.split("\n")

        for i, line in enumerate(old_lines):
            ln = start_line + i
            self._append("line_num", f"{ln:>4} ")
            self._append("removed", f"- {line}\n")

        for i, line in enumerate(new_lines):
            ln = start_line + i
            self._append("line_num", f"{ln:>4} ")
            self._append("added", f"+ {line}\n")

        if cid:
            self._end_collapsible(cid)

        self._append("separator", "─" * 70 + "\n")

    # ──────────── 目录列表 ────────────

    def _render_list(self, ev, ts):
        path = ev.get("path", "?")
        count = ev.get("count", 0)

        self._append("timestamp", f"{ts} ")
        self._append("op_list", "LIST ")
        self._append("path", self._short_path(path))
        self._append("info", f"  ({count} entries)\n")
        self._append("separator", "─" * 70 + "\n")

    # ──────────── Diff 渲染辅助 ────────────

    def _render_added_lines(self, content: str, max_lines: int):
        """渲染全部新增行（绿色）"""
        lines = content.split("\n")
        show = min(len(lines), max_lines)
        for i in range(show):
            self._append("line_num", f"{i+1:>4} ")
            self._append("added", f"+ {lines[i]}\n")
        if len(lines) > show:
            self._append("info", f"     ... +{len(lines) - show} more lines\n")

    def _render_simple_diff(self, old: str, new: str, max_lines: int = 30):
        """
        简单行级 diff 渲染，类似 VSCode Copilot 的 inline diff。
        不依赖 difflib —— 做一个轻量逐行对比。
        """
        old_lines = old.split("\n")
        new_lines = new.split("\n")

        # 使用简单的最长公共子序列策略
        # 对于较短的内容做精确 diff，长内容做截断展示
        if len(old_lines) > 200 or len(new_lines) > 200:
            # 长文件：只显示统计
            self._append("diff_header", f"  @@ file changed: {len(old_lines)} → {len(new_lines)} lines @@\n")
            # 显示前后几行作为采样
            self._show_sample(old_lines, "removed", 10)
            self._append("info", "     ...\n")
            self._show_sample(new_lines, "added", 10)
            return

        # 短内容：逐行对比
        import difflib
        differ = difflib.unified_diff(old_lines, new_lines, lineterm="", n=3)
        rendered = 0
        for line in differ:
            if rendered >= max_lines:
                self._append("info", "     ... diff truncated\n")
                break
            if line.startswith("---") or line.startswith("+++"):
                continue
            elif line.startswith("@@"):
                self._append("diff_header", f"  {line}\n")
            elif line.startswith("-"):
                self._append("removed", f"  {line}\n")
                rendered += 1
            elif line.startswith("+"):
                self._append("added", f"  {line}\n")
                rendered += 1
            else:
                self._append("content", f"  {line}\n")
                rendered += 1

    def _show_sample(self, lines, tag, count):
        show = min(len(lines), count)
        prefix = "- " if tag == "removed" else "+ "
        for i in range(show):
            self._append("line_num", f"{i+1:>4} ")
            self._append(tag, f"{prefix}{lines[i]}\n")

    # ──────────── 文本操作 ────────────

    def _append(self, tag, text):
        self._text.configure(state=tk.NORMAL)
        self._text.insert(tk.END, text, tag)
        self._text.configure(state=tk.DISABLED)
        if self._auto_scroll:
            self._text.see(tk.END)

    def _trim(self):
        line_count = int(self._text.index("end-1c").split(".")[0])
        if line_count > 3000:
            self._text.configure(state=tk.NORMAL)
            self._text.delete("1.0", f"{line_count - 2000}.0")
            self._text.configure(state=tk.DISABLED)

    def _clear_output(self):
        self._text.configure(state=tk.NORMAL)
        self._text.delete("1.0", tk.END)
        self._text.configure(state=tk.DISABLED)
        self._op_count = 0
        self._status_var.set("操作: 0")
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
    def _short_path(path: str, max_len: int = 60) -> str:
        """缩短路径显示"""
        if len(path) <= max_len:
            return path
        parts = path.split("/")
        if len(parts) <= 3:
            return path
        return parts[0] + "/.../" + "/".join(parts[-2:])

    @staticmethod
    def _ts():
        return datetime.now().strftime("%H:%M:%S")


def main():
    parser = argparse.ArgumentParser(description="NyaDeskPet File Editor Monitor")
    parser.add_argument("--port", type=int, default=DEFAULT_UDP_PORT, help="UDP 监听端口")
    args = parser.parse_args()

    monitor = FileEditorMonitor(udp_port=args.port)
    monitor.run()


if __name__ == "__main__":
    main()
