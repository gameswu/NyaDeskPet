# 安装

本页介绍如何下载并安装 NyaDeskPet。

## 目录
- [安装](#安装)
  - [目录](#目录)
  - [下载](#下载)
  - [Windows 安装](#windows-安装)
  - [macOS 安装](#macos-安装)
  - [Linux 安装](#linux-安装)
  - [从源码构建安装包](#从源码构建安装包)
  - [首次启动](#首次启动)
  - [下一步](#下一步)

---

## 下载

前往 GitHub Releases 页面下载适合你系统的安装包：

| 平台 | 文件格式 | 说明 |
|------|---------|------|
| Windows | `.exe` 安装包 | 双击运行安装向导 |
| macOS | `.dmg` 磁盘映像 | 拖入 Applications 文件夹 |
| Linux | `.AppImage` | 赋予执行权限后直接运行 |

如果没有找到适合你系统的安装包，可以参考 [开发者指南](DEVELOPMENT.md) 中的打包分发部分，了解如何从源代码构建应用。

> [!TIP]
> 你也可以在应用的**设置 → 关于**页面中找到 GitHub 链接。

---

## Windows 安装

1. 下载 `.exe` 安装包
2. 双击运行，按照安装向导完成安装
3. 安装完成后，从桌面快捷方式或开始菜单启动

> [!WARNING]
> 首次运行时 Windows Defender 可能弹出安全警告，选择「仍要运行」即可。

---

## macOS 安装

1. 下载 `.dmg` 文件
2. 双击打开磁盘映像
3. 将 NyaDeskPet 拖入 **Applications** 文件夹
4. 从启动台或 Applications 中打开

> [!WARNING]
> macOS 可能提示"无法验证开发者"，请前往 **系统设置 → 隐私与安全性**，点击「仍要打开」。

---

## Linux 安装

1. 下载 `.AppImage` 文件
2. 赋予执行权限：
   ```bash
   chmod +x NyaDeskPet-*.AppImage
   ```
3. 双击或从终端运行：
   ```bash
   ./NyaDeskPet-*.AppImage
   ```

---

## 从源码构建安装包
如果你想从源代码构建应用，请参考 [开发者指南](DEVELOPMENT.md) 中的打包分发部分，了解详细的构建步骤和要求。

---

## 首次启动

<div align="center">
    <img src="./images/install-first-launch.png" alt="首次启动界面" width="300"/>
</div>

启动后你会看到桌面上出现一个 Live2D 角色。默认界面包括：

- **顶栏**：窗口控制与功能按钮
- **模型区域**：Live2D 角色，可以拖拽、缩放
- **底栏**：对话按钮、隐藏边框按钮

首次启动时角色还无法对话，你需要先 **[配置后端 Agent](AgentConfig.md)** 来接入 AI 供应商。

---

## 下一步

安装完成后，继续阅读 [配置后端 Agent](AgentConfig.md) 来让你的桌宠开口说话吧！
