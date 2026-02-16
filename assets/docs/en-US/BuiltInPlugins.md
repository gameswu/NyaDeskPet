# Enable Built-in Plugins

NyaDeskPet includes 3 built-in frontend plugins that provide terminal control, UI automation, and file editing capabilities. These plugins run as independent processes and communicate with the app via WebSocket.

## Table of Contents
- [Enable Built-in Plugins](#enable-built-in-plugins)
  - [Table of Contents](#table-of-contents)
  - [View the Plugin Panel](#view-the-plugin-panel)
  - [Built-in Plugin Overview](#built-in-plugin-overview)
  - [Terminal Control Plugin](#terminal-control-plugin)
  - [UI Automation Plugin](#ui-automation-plugin)
  - [File Editor Plugin](#file-editor-plugin)
  - [Start and Stop Plugins](#start-and-stop-plugins)
  - [Plugin Configuration](#plugin-configuration)
  - [Permission Management](#permission-management)
  - [Next Steps](#next-steps)

---

## View the Plugin Panel

<div align="center">
    <img src="../images/plugins-panel.png" alt="Plugin Panel" width="300"/>
</div>

Click the **Plugin button** in the top bar to open the plugin management panel. Here you can see all installed plugins and their status.

---

## Built-in Plugin Overview

| Plugin | Function | Use Case |
|--------|---------|----------|
| Terminal Control | Execute system commands, manage Shell sessions | Let AI run terminal commands for you |
| UI Automation | Mouse/keyboard simulation, screenshots | Let AI control your computer interface |
| File Editor | Read, create, edit files | Let AI handle files for you |

---

## Terminal Control Plugin

<div align="center">
    <img src="../images/plugins-terminal.png" alt="Terminal Control Plugin" width="300"/>
</div>

The Terminal Control plugin allows AI to execute commands on your system.

**Provided permissions:**

| Permission | Danger Level | Description |
|-----------|-------------|-------------|
| `terminal.execute` | <font color="red">high</font> | Execute terminal commands |
| `terminal.session` | <font color="orange">medium</font> | Manage Shell sessions |

**Prerequisite:** Your system must have an available Shell (Windows: PowerShell/CMD, macOS/Linux: bash/zsh).

> [!WARNING]
> Terminal commands have a high danger level — AI must get your confirmation each time. Please carefully read the command AI wants to execute before clicking Allow.

---

## UI Automation Plugin

The UI Automation plugin lets AI control mouse, keyboard, and capture screens.

**Provided permissions:**

| Permission | Danger Level | Description |
|-----------|-------------|-------------|
| `ui-automation.mouse` | <font color="red">high</font> | Mouse movement and clicks |
| `ui-automation.keyboard` | <font color="red">high</font> | Keyboard input and shortcuts |
| `ui-automation.screen` | <font color="orange">medium</font> | Screenshots |

**Prerequisites:**
- Python 3 and the `pyautogui` library must be installed
- macOS requires granting Accessibility permission in System Settings

---

## File Editor Plugin

The File Editor plugin lets AI read and modify your files.

**Provided permissions:**

| Permission | Danger Level | Description |
|-----------|-------------|-------------|
| `file.read` | <font color="green">low</font> | Read file contents |
| `file.write` | <font color="orange">medium</font> | Create new files |
| `file.edit` | <font color="orange">medium</font> | Edit existing files |

**Prerequisite:** Python 3 must be installed.

---

## Start and Stop Plugins

In the plugin management panel:

1. Find the plugin you want to enable
2. Click the **Start** button
3. The plugin will launch an independent process and connect automatically
4. Once connected, the status indicator turns green

> [!TIP]
> Set `autoStart: true` in the plugin's metadata to have it run automatically when the app starts.

---

## Plugin Configuration

<div align="center">
    <img src="../images/plugins-config.png" alt="Plugin Configuration" width="300"/>
</div>

Some plugins support custom configuration. Click the **Configure** button on the plugin card to modify plugin-specific parameters. Configuration items are defined by the plugin itself, and the app automatically generates the corresponding configuration form.

---

## Permission Management

Plugins require your authorization when performing sensitive operations. The first time a permission is used, the app will display a confirmation dialog. For details, see [Permissions](Permissions.md).

---

## Next Steps

- Learn about the permission system: [Permissions](Permissions.md)
- Start chatting with AI: [Conversation](Conversation.md)
- Want to develop your own plugin? See [Plugin Development](PluginDevelopment.md)
