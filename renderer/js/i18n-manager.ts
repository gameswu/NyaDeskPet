/**
 * 国际化管理器
 * 负责语言切换和文本翻译
 */

import type { I18nManager as II18nManager } from '../types/global';

type NestedMessages = { [key: string]: string | NestedMessages };

class I18nManager implements II18nManager {
  public currentLocale: string = 'zh-CN';
  private messages: { [locale: string]: NestedMessages } = {};
  private storageKey = 'nya-desk-pet-locale';

  constructor() {
    this.loadLocale();
  }

  /**
   * 初始化国际化
   */
  public async initialize(): Promise<void> {
    const savedLocale = localStorage.getItem(this.storageKey);
    if (savedLocale) {
      this.currentLocale = savedLocale;
    } else {
      // 检测浏览器语言
      const browserLang = navigator.language;
      if (browserLang.startsWith('zh')) {
        this.currentLocale = 'zh-CN';
      } else {
        this.currentLocale = 'en-US';
      }
    }

    await this.loadMessages(this.currentLocale);
    this.applyTranslations();
  }

  /**
   * 加载语言文件
   */
  private async loadMessages(locale: string): Promise<void> {
    try {
      const response = await fetch(`locales/${locale}.json`);
      if (response.ok) {
        this.messages[locale] = await response.json();
      } else {
        window.logger.error(`无法加载语言文件: ${locale}`);
        // 回退到中文
        if (locale !== 'zh-CN') {
          const fallbackResponse = await fetch('locales/zh-CN.json');
          this.messages['zh-CN'] = await fallbackResponse.json();
          this.currentLocale = 'zh-CN';
        }
      }
    } catch (error) {
      window.logger.error('加载语言文件失败:', error);
    }
  }

  /**
   * 获取翻译文本
   */
  public t(key: string, params?: { [key: string]: string }): string {
    const keys = key.split('.');
    let value: any = this.messages[this.currentLocale];

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // 如果找不到，返回key本身
      }
    }

    if (typeof value !== 'string') {
      return key;
    }

    // 替换参数
    if (params) {
      Object.keys(params).forEach(param => {
        value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
      });
    }

    return value;
  }

  /**
   * 切换语言
   */
  public async setLocale(locale: string): Promise<void> {
    if (this.currentLocale === locale) return;

    await this.loadMessages(locale);
    this.currentLocale = locale;
    localStorage.setItem(this.storageKey, locale);
    this.applyTranslations();
  }

  /**
   * 获取当前语言
   */
  public getLocale(): string {
    return this.currentLocale;
  }

  /**
   * 加载已保存的语言设置
   */
  private loadLocale(): void {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      this.currentLocale = saved;
    }
  }

  /**
   * 应用翻译到页面
   */
  public applyTranslations(): void {
    // 翻译所有带 data-i18n 属性的元素
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key);
      }
    });

    // 翻译所有带 data-i18n-placeholder 属性的输入框
    const inputs = document.querySelectorAll('[data-i18n-placeholder]');
    inputs.forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key && el instanceof HTMLInputElement) {
        el.placeholder = this.t(key);
      }
      if (key && el instanceof HTMLTextAreaElement) {
        el.placeholder = this.t(key);
      }
    });

    // 翻译所有带 data-i18n-title 属性的元素
    const titled = document.querySelectorAll('[data-i18n-title]');
    titled.forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key && el instanceof HTMLElement) {
        el.title = this.t(key);
      }
    });

    // 更新主题选择器的选项文本
    this.updateThemeOptions();

    // 刷新 Lucide 图标
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  /**
   * 更新主题选择器选项的文本
   */
  private updateThemeOptions(): void {
    const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement;
    if (!themeSelect) return;

    const options = themeSelect.options;
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const value = option.value;
      switch (value) {
        case 'light':
          option.textContent = this.t('settings.appearance.themeLight');
          break;
        case 'dark':
          option.textContent = this.t('settings.appearance.themeDark');
          break;
        case 'system':
          option.textContent = this.t('settings.appearance.themeSystem');
          break;
      }
    }
  }

  /**
   * 获取可用语言列表
   */
  public getAvailableLocales(): Array<{ code: string; name: string }> {
    return [
      { code: 'zh-CN', name: '简体中文' },
      { code: 'en-US', name: 'English' }
    ];
  }
}

// 创建全局实例
const i18nManager = new I18nManager();
window.i18nManager = i18nManager;

export default i18nManager;
