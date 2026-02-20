/**
 * Monaco Editor 管理器
 * 
 * 封装 Monaco Editor 的加载、创建和管理。
 * 用于替代所有长文本输入框（textarea），提供语法高亮和更好的编辑体验。
 * 
 * Monaco Editor 通过 AMD loader 从 node_modules/monaco-editor/min/vs/ 加载。
 */

/** Monaco Editor 实例配置 */
interface MonacoEditorConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** 初始值 */
  value: string;
  /** 语言模式 */
  language?: string;
  /** 主题（自动跟随应用主题） */
  theme?: 'vs' | 'vs-dark';
  /** 最小高度（px） */
  minHeight?: number;
  /** 最大高度（px） */
  maxHeight?: number;
  /** 是否只读 */
  readOnly?: boolean;
  /** 值变化回调 */
  onChange?: (value: string) => void;
}

/** 活跃的编辑器实例信息 */
interface EditorInstance {
  editor: any;
  container: HTMLElement;
  minHeight: number;
  maxHeight: number;
}

class MonacoManager {
  /** Monaco 是否已加载 */
  private loaded = false;
  /** 加载 Promise（防止重复加载） */
  private loadPromise: Promise<void> | null = null;
  /** Monaco 模块引用 */
  private monaco: any = null;
  /** 活跃的编辑器实例 */
  private editors: Map<string, EditorInstance> = new Map();
  /** 编辑器 ID 计数器 */
  private nextId = 0;
  /** 基础路径 */
  private basePath = '../node_modules/monaco-editor/min';
  /** 预加载的 worker Blob URL（通过 IPC 从主进程读取源码生成） */
  private workerBlobUrl: string | null = null;

  /**
   * 加载 Monaco Editor AMD 模块
   */
  public async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    // 通过 IPC 从主进程读取 worker 脚本源码，创建 Blob URL
    try {
      const workerSource = await window.electronAPI.readMonacoWorker();
      if (workerSource) {
        const blob = new Blob([workerSource], { type: 'application/javascript' });
        this.workerBlobUrl = URL.createObjectURL(blob);
      }
    } catch (err) {
      window.logger.warn('[MonacoManager] IPC 读取 worker 失败:', err);
    }

    this.loadPromise = new Promise<void>((resolve, reject) => {
      // 加载 AMD loader
      const loaderScript = document.createElement('script');
      loaderScript.src = `${this.basePath}/vs/loader.js`;
      loaderScript.onload = () => {
        // 配置 Monaco AMD loader
        const amdRequire = (window as any).require;
        if (!amdRequire?.config) {
          reject(new Error('Monaco AMD loader not available'));
          return;
        }
        amdRequire.config({
          paths: { 'vs': `${this.basePath}/vs` }
        });

        // 配置 Worker 加载：使用 preload 预读取的 Blob URL
        const blobUrl = this.workerBlobUrl;
        (window as any).MonacoEnvironment = {
          getWorker(_workerId: string, _label: string) {
            if (blobUrl) {
              return new Worker(blobUrl);
            }
            // 预加载不可用，抛出错误让 Monaco 回退到主线程
            throw new Error('Worker blob URL not available');
          },
        };

        // 设置 locale
        const locale = window.i18nManager?.getLocale() || 'zh-CN';
        if (locale === 'zh-CN') {
          (window as any).MonacoEnvironment['vs/nls'] = { availableLanguages: { '*': 'zh-cn' } };
        }

        amdRequire(['vs/editor/editor.main'], (monaco: any) => {
          this.monaco = monaco;
          this.loaded = true;

          // 定义自定义主题
          this.defineCustomThemes();

          window.logger.info('[MonacoManager] Monaco Editor 加载完成');
          resolve();
        }, (err: any) => {
          // AMD 模块加载失败时的错误回调
          this.loadPromise = null;
          window.logger.error('[MonacoManager] Monaco Editor AMD 模块加载失败:', err);
          reject(new Error('Failed to load Monaco Editor modules: ' + (err?.message || err)));
        });
      };
      loaderScript.onerror = () => {
        this.loadPromise = null;
        reject(new Error('Failed to load Monaco Editor loader script'));
      };
      document.head.appendChild(loaderScript);
    });

    return this.loadPromise;
  }

  /**
   * 定义自定义主题，匹配应用的亮色/暗色风格
   */
  private defineCustomThemes(): void {
    if (!this.monaco) return;

    this.monaco.editor.defineTheme('nya-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#f8f9fa',
        'editor.foreground': '#333333',
        'editorLineNumber.foreground': '#999999',
        'editor.lineHighlightBackground': '#f0f0f0',
        'editorWidget.border': '#dddddd',
        'input.background': '#ffffff',
        'input.border': '#dddddd'
      }
    });

    this.monaco.editor.defineTheme('nya-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#2a2a2a',
        'editor.foreground': '#e0e0e0',
        'editorLineNumber.foreground': '#666666',
        'editor.lineHighlightBackground': '#333333',
        'editorWidget.border': '#444444',
        'input.background': '#333333',
        'input.border': '#555555'
      }
    });
  }

  /**
   * 获取当前应用主题对应的编辑器主题名
   */
  private getEditorTheme(): string {
    const isDark = document.body.classList.contains('dark-theme');
    return isDark ? 'nya-dark' : 'nya-light';
  }

  /**
   * 创建 Monaco Editor 实例
   * @returns 编辑器 ID，用于后续操作
   */
  public async createEditor(config: MonacoEditorConfig): Promise<string> {
    if (!this.loaded) {
      await this.load();
    }

    const id = `monaco-${this.nextId++}`;
    const minHeight = config.minHeight || 150;
    const maxHeight = config.maxHeight || 400;

    // 设置容器样式
    config.container.style.minHeight = `${minHeight}px`;
    config.container.style.height = `${minHeight}px`;
    config.container.style.border = '1px solid var(--monaco-border, #ddd)';
    config.container.style.borderRadius = '8px';
    config.container.style.overflow = 'hidden';
    config.container.setAttribute('data-monaco-id', id);

    const editor = this.monaco.editor.create(config.container, {
      value: config.value || '',
      language: config.language || 'plaintext',
      theme: config.theme || this.getEditorTheme(),
      minimap: { enabled: false },
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      wrappingStrategy: 'advanced',
      fontSize: 13,
      fontFamily: "'Consolas', 'Monaco', 'Menlo', monospace",
      lineHeight: 20,
      padding: { top: 8, bottom: 8 },
      renderLineHighlight: 'line',
      contextmenu: true,
      readOnly: config.readOnly || false,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'hidden',
        verticalScrollbarSize: 8,
        alwaysConsumeMouseWheel: false
      },
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      glyphMargin: false,
      folding: true,
      tabSize: 2,
      automaticLayout: false,
      fixedOverflowWidgets: true
    });

    const instance: EditorInstance = {
      editor,
      container: config.container,
      minHeight,
      maxHeight
    };

    this.editors.set(id, instance);

    // 自动调整高度
    this.updateEditorHeight(id);
    editor.onDidChangeModelContent(() => {
      this.updateEditorHeight(id);
      config.onChange?.(editor.getValue());
    });

    // 监听容器可见性变化（如对话框打开时）
    const resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });
    resizeObserver.observe(config.container);

    // 延迟再次 layout，确保容器尺寸稳定后编辑器正确渲染
    requestAnimationFrame(() => {
      editor.layout();
      this.updateEditorHeight(id);
    });

    return id;
  }

  /**
   * 根据内容自动调整编辑器高度
   */
  private updateEditorHeight(id: string): void {
    const instance = this.editors.get(id);
    if (!instance) return;

    const { editor, container, minHeight, maxHeight } = instance;
    const contentHeight = editor.getContentHeight();
    const newHeight = Math.max(minHeight, Math.min(maxHeight, contentHeight));

    container.style.height = `${newHeight}px`;
    editor.layout();
  }

  /**
   * 获取编辑器的值
   */
  public getValue(id: string): string {
    const instance = this.editors.get(id);
    return instance?.editor.getValue() || '';
  }

  /**
   * 设置编辑器的值
   */
  public setValue(id: string, value: string): void {
    const instance = this.editors.get(id);
    if (instance) {
      instance.editor.setValue(value);
    }
  }

  /**
   * 销毁编辑器实例
   */
  public destroyEditor(id: string): void {
    const instance = this.editors.get(id);
    if (instance) {
      instance.editor.dispose();
      this.editors.delete(id);
    }
  }

  /**
   * 销毁所有编辑器实例
   */
  public destroyAll(): void {
    for (const [, instance] of this.editors) {
      instance.editor.dispose();
    }
    this.editors.clear();
  }

  /**
   * 更新所有编辑器主题
   */
  public updateTheme(): void {
    if (!this.monaco) return;
    const theme = this.getEditorTheme();
    this.monaco.editor.setTheme(theme);
  }

  /**
   * 检查 Monaco 是否已加载
   */
  public isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 将 textarea 替换为 Monaco Editor
   * 返回编辑器 ID
   */
  public async replaceTextarea(textarea: HTMLTextAreaElement, language?: string): Promise<string> {
    const value = textarea.value || '';
    const dataKey = textarea.getAttribute('data-key') || '';
    const editorLanguage = textarea.getAttribute('data-language') || language || 'plaintext';
    const isEditorMode = textarea.classList.contains('editor');

    // 创建容器 div 替代 textarea
    const container = document.createElement('div');
    container.className = 'monaco-editor-container';
    if (dataKey) {
      container.setAttribute('data-key', dataKey);
    }
    container.setAttribute('data-editor-language', editorLanguage);

    textarea.parentElement?.replaceChild(container, textarea);

    const id = await this.createEditor({
      container,
      value,
      language: editorLanguage,
      minHeight: isEditorMode ? 200 : 150,
      maxHeight: isEditorMode ? 500 : 350
    });

    return id;
  }
}

// 全局单例
const monacoManager = new MonacoManager();
(window as any).monacoManager = monacoManager;

export default monacoManager;
