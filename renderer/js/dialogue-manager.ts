/**
 * 对话管理器
 * 负责显示和管理对话框（桌面宠物气泡）
 */

import type { DialogueManager as IDialogueManager } from '../types/global';

/** 对话附件类型 */
interface DialogueAttachment {
  type: 'image' | 'file';
  url: string;
  name?: string;
}

class DialogueManager implements IDialogueManager {
  public dialogueBox: HTMLElement;
  public dialogueText: HTMLElement;
  public dialogueProgress: HTMLElement;
  public isShowing: boolean;
  public currentTimeout: number | null;
  public typewriterTimeout: number | null;

  constructor() {
    const dialogueBox = document.getElementById('dialogue-box');
    const dialogueText = document.getElementById('dialogue-text');
    const dialogueProgress = document.getElementById('dialogue-progress');

    if (!dialogueBox || !dialogueText || !dialogueProgress) {
      throw new Error('Required dialogue elements not found');
    }

    this.dialogueBox = dialogueBox;
    this.dialogueText = dialogueText;
    this.dialogueProgress = dialogueProgress;
    this.isShowing = false;
    this.currentTimeout = null;
    this.typewriterTimeout = null;
  }

  /**
   * 显示对话
   * @param text - 对话文本
   * @param duration - 显示时长（毫秒），0表示不自动隐藏
   * @param typewriter - 是否使用打字机效果
   * @param attachment - 可选的附件（图片/文件）
   */
  public showDialogue(text: string, duration: number = 5000, typewriter: boolean = true, attachment?: DialogueAttachment): void {
    // 清除之前的定时器
    this.clearTimeouts();

    // 显示对话框
    this.dialogueBox.classList.remove('hidden');
    this.isShowing = true;

    if (typewriter) {
      this.typewriterEffect(text, duration, attachment);
    } else {
      this.dialogueText.textContent = text;
      // 渲染附件
      if (attachment) {
        this.renderAttachment(attachment);
      }
      if (duration > 0) {
        this.startAutoHide(duration);
      }
    }
  }

  /**
   * 打字机效果
   * @param text - 完整文本
   * @param duration - 总显示时长
   * @param attachment - 可选的附件
   */
  public typewriterEffect(text: string, duration: number, attachment?: DialogueAttachment): void {
    this.dialogueText.textContent = '';
    let index = 0;
    const speed = Math.max(30, Math.min(100, text.length > 50 ? 50 : 80));

    const type = (): void => {
      if (index < text.length) {
        this.dialogueText.textContent += text.charAt(index);
        index++;
        this.typewriterTimeout = window.setTimeout(type, speed);
      } else {
        // 打字完成，渲染附件
        if (attachment) {
          this.renderAttachment(attachment);
        }
        // 开始倒计时隐藏
        if (duration > 0) {
          this.startAutoHide(duration);
        }
      }
    };

    type();
  }

  /**
   * 在对话气泡中渲染附件（图片/文件）
   */
  private renderAttachment(attachment: DialogueAttachment): void {
    // 移除之前的附件
    const existingAttachment = this.dialogueText.parentElement?.querySelector('.dialogue-attachment');
    if (existingAttachment) existingAttachment.remove();

    const container = document.createElement('div');
    container.className = 'dialogue-attachment';

    if (attachment.type === 'image') {
      const img = document.createElement('img');
      img.src = attachment.url;
      img.className = 'dialogue-image';
      img.alt = attachment.name || '';
      img.onclick = () => window.open(attachment.url);
      container.appendChild(img);
    } else {
      const fileEl = document.createElement('div');
      fileEl.className = 'dialogue-file';
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'file');
      icon.style.cssText = 'width: 14px; height: 14px;';
      fileEl.appendChild(icon);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = attachment.name || 'file';
      fileEl.appendChild(nameSpan);
      container.appendChild(fileEl);

      // 刷新图标
      if (typeof (window as any).lucide !== 'undefined') {
        (window as any).lucide.createIcons({ nameAttr: 'data-lucide' });
      }
    }

    // 插入到进度条之前
    this.dialogueProgress.parentElement?.insertBefore(container, this.dialogueProgress);
  }

  /**
   * 开始自动隐藏倒计时
   * @param duration - 显示时长（毫秒）
   */
  public startAutoHide(duration: number): void {
    // 更新进度条
    (this.dialogueProgress as HTMLElement).style.width = '100%';
    
    // 动画过渡
    setTimeout(() => {
      (this.dialogueProgress as HTMLElement).style.transition = `width ${duration}ms linear`;
      (this.dialogueProgress as HTMLElement).style.width = '0%';
    }, 50);

    // 设置隐藏定时器
    this.currentTimeout = window.setTimeout(() => {
      this.hideDialogue();
    }, duration);
  }

  /**
   * 隐藏对话框
   */
  public hideDialogue(): void {
    this.clearTimeouts();
    this.dialogueBox.classList.add('hidden');
    (this.dialogueProgress as HTMLElement).style.width = '0%';
    (this.dialogueProgress as HTMLElement).style.transition = 'width 0.3s';
    this.isShowing = false;

    // 清除附件
    const attachment = this.dialogueBox.querySelector('.dialogue-attachment');
    if (attachment) attachment.remove();
  }

  /**
   * 清除所有定时器
   */
  public clearTimeouts(): void {
    if (this.currentTimeout) {
      clearTimeout(this.currentTimeout);
      this.currentTimeout = null;
    }
    if (this.typewriterTimeout) {
      clearTimeout(this.typewriterTimeout);
      this.typewriterTimeout = null;
    }
  }

  /**
   * 追加文本
   * @param text - 要追加的文本
   */
  public appendText(text: string): void {
    if (!this.isShowing) {
      this.showDialogue(text);
    } else {
      this.dialogueText.textContent += text;
    }
  }

  /**
   * 快速显示（无动画）
   * @param text - 对话文本
   * @param duration - 显示时长
   */
  public showQuick(text: string, duration: number = 3000): void {
    this.showDialogue(text, duration, false);
  }
}

// 导出全局实例
window.dialogueManager = new DialogueManager();
