/**
 * 主题管理器
 * 负责明亮/暗黑主题切换
 */

import type { ThemeManager as IThemeManager, ThemeMode } from '../types/global';

class ThemeManager implements IThemeManager {
  private currentTheme: ThemeMode = 'system';
  private storageKey = 'nya-desk-pet-theme';
  private mediaQuery: MediaQueryList | null = null;

  constructor() {
    this.loadTheme();
  }

  /**
   * 初始化主题
   */
  public initialize(): void {
    const savedTheme = localStorage.getItem(this.storageKey) as ThemeMode;
    if (savedTheme) {
      this.currentTheme = savedTheme;
    }

    // 监听系统主题变化
    if (window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        if (this.currentTheme === 'system') {
          this.applyTheme();
        }
      });
    }

    this.applyTheme();
  }

  /**
   * 设置主题
   */
  public setTheme(theme: ThemeMode): void {
    this.currentTheme = theme;
    localStorage.setItem(this.storageKey, theme);
    this.applyTheme();
  }

  /**
   * 获取当前主题
   */
  public getTheme(): ThemeMode {
    return this.currentTheme;
  }

  /**
   * 获取实际应用的主题（考虑系统主题）
   */
  public getEffectiveTheme(): 'light' | 'dark' {
    if (this.currentTheme === 'system') {
      return this.mediaQuery?.matches ? 'dark' : 'light';
    }
    return this.currentTheme;
  }

  /**
   * 加载已保存的主题
   */
  private loadTheme(): void {
    const saved = localStorage.getItem(this.storageKey) as ThemeMode;
    if (saved) {
      this.currentTheme = saved;
    }
  }

  /**
   * 应用主题到页面
   */
  private applyTheme(): void {
    const effectiveTheme = this.getEffectiveTheme();
    
    if (effectiveTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
    }

    // 同步 Monaco Editor 主题
    if (window.monacoManager?.isLoaded()) {
      window.monacoManager.updateTheme();
    }

    window.logger.info('应用主题:', this.currentTheme, '→', effectiveTheme);
  }
}

// 创建全局实例
const themeManager = new ThemeManager();
window.themeManager = themeManager;

export default themeManager;
