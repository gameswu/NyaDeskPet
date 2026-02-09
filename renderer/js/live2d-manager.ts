/**
 * Live2D 管理器
 * 负责加载、渲染和控制 Live2D 模型
 */

import type { Live2DManager as ILive2DManager, Live2DModel } from '../types/global';
import type { Application } from 'pixi.js';

// pixi-live2d-display 通过全局脚本加载（lib/pixi-live2d-cubism4.min.js）
// 运行时可通过 PIXI.live2d.Live2DModel 访问

// 确保 PIXI 全局可用（pixi-live2d-display 需要）
if (typeof window !== 'undefined') {
  (window as any).PIXI = window.PIXI;
}

class Live2DManager implements ILive2DManager {
  public canvas: HTMLCanvasElement;
  public app: Application | null;
  public model: Live2DModel | null;
  public currentMotion: string | null;
  public currentExpression: string | null;
  public initialized: boolean;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private modelStartX: number = 0;
  private modelStartY: number = 0;
  private originalModelBounds: { width: number; height: number } | null = null;

  constructor(canvasId: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
      throw new Error(`Canvas element with id "${canvasId}" not found`);
    }
    this.canvas = canvas;
    this.app = null;
    this.model = null;
    this.currentMotion = null;
    this.currentExpression = null;
    this.initialized = false;
  }

  /**
   * 初始化 Live2D
   */
  public async initialize(): Promise<boolean> {
    try {
      // 创建 PixiJS 应用
      const PIXI = window.PIXI;
      
      // 使用 CSS 尺寸
      const width = this.canvas.clientWidth || window.innerWidth;
      const height = this.canvas.clientHeight || window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      
      this.app = new PIXI.Application({
        view: this.canvas,
        width: width,
        height: height,
        backgroundAlpha: 0,
        resolution: dpr,     // 使用设备像素比以获得清晰显示
        autoDensity: true    // 自动调整 CSS 尺寸
      });

      // 监听窗口大小变化
      this.setupResizeHandler();

      console.log('Live2D 初始化成功, 尺寸:', width, 'x', height, 'DPR:', dpr);
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Live2D 初始化失败:', error);
      return false;
    }
  }

  /**
   * 加载 Live2D 模型
   * @param modelPath - 模型文件路径
   */
  public async loadModel(modelPath: string): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      console.log('开始加载模型:', modelPath);
      
      // 清除旧模型
      if (this.model && this.app) {
        this.app.stage.removeChild(this.model as any);
        (this.model as any).destroy?.();
      }
      
      // 使用 pixi-live2d-display 加载模型（通过全局 PIXI.live2d）
      const Live2DModel = (window.PIXI as any).live2d.Live2DModel;
      const live2dModel = await Live2DModel.from(modelPath, {
        autoInteract: false, // 禁用自动交互，我们自己处理
        autoUpdate: true     // 启用自动更新
      });
      
      this.model = live2dModel as any;
      
      if (this.app) {
        // 添加到舞台
        this.app.stage.addChild(live2dModel as any);
        
        // 设置锚点为中心（pixi-live2d-display 支持）
        live2dModel.anchor.set(0.5, 0.5);
        
        // 保存模型原始尺寸（使用 internalModel 获取真正的原始尺寸）
        const internalModel = live2dModel.internalModel;
        if (internalModel) {
          this.originalModelBounds = {
            width: internalModel.width,
            height: internalModel.height
          };
        } else {
          // 回退方案
          this.originalModelBounds = {
            width: live2dModel.width,
            height: live2dModel.height
          };
        }
        
        console.log('模型原始尺寸:', this.originalModelBounds);
        
        // 调整模型位置和大小
        this.adjustModelTransform();
        
        // 设置拖动功能（同时处理点击）
        this.setupDragging(live2dModel);
      }
      
      console.log('模型加载成功');
      return true;
    } catch (error) {
      console.error('模型加载失败:', error);
      throw error;
    }
  }

  /**
   * 设置窗口大小变化处理
   */
  private setupResizeHandler(): void {
    let resizeTimeout: number | null = null;
    
    window.addEventListener('resize', () => {
      // 防抖处理，避免频繁调整
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }
      
      resizeTimeout = window.setTimeout(() => {
        console.log('窗口大小变化，调整模型位置');
        this.handleResize();
        resizeTimeout = null;
      }, 100);
    });
  }

  /**
   * 处理窗口大小变化
   */
  private handleResize(): void {
    if (!this.app || !this.model) return;

    // 使用 CSS 尺寸
    const newWidth = this.canvas.clientWidth;
    const newHeight = this.canvas.clientHeight;

    console.log(`调整窗口尺寸: ${newWidth}x${newHeight}`);

    // 更新PixiJS渲染器尺寸
    this.app.renderer.resize(newWidth, newHeight);
    
    // 重新调整模型位置和大小
    this.adjustModelTransform();
  }

  /**
   * 设置模型拖动功能
   */
  private setupDragging(model: any): void {
    const dragThreshold = 3; // 拖动阈值
    let hasMoved = false;
    
    // 启用交互
    model.interactive = true;
    model.eventMode = 'static';
    this.canvas.style.cursor = 'grab';

    // 直接在整个 canvas 上处理拖动，不做碰撞检测
    this.canvas.addEventListener('mousedown', (event: MouseEvent) => {
      if (!this.model) return;
      
      this.isDragging = true;
      hasMoved = false;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      
      const m = this.model as any;
      this.modelStartX = m.x;
      this.modelStartY = m.y;
      this.canvas.style.cursor = 'grabbing';
      event.preventDefault();
    });

    // 全局监听 mousemove
    window.addEventListener('mousemove', (event: MouseEvent) => {
      if (!this.isDragging || !this.model) return;
      
      const deltaX = event.clientX - this.dragStartX;
      const deltaY = event.clientY - this.dragStartY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (distance > dragThreshold) {
        hasMoved = true;
        const m = this.model as any;
        m.x = this.modelStartX + deltaX;
        m.y = this.modelStartY + deltaY;
      }
    });

    // 全局监听 mouseup
    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
        
        // 如果没有移动，触发点击事件
        if (!hasMoved && this.model) {
          console.log('模型被点击');
          // 可以在这里触发点击事件
        }
      }
    });
  }

  /**
   * 调整模型位置和大小
   */
  public adjustModelTransform(): void {
    if (!this.model || !this.app) return;

    const model = this.model as any;
    
    // 使用 CSS 尺寸（与鼠标事件坐标系一致）
    const canvasWidth = this.canvas.clientWidth;
    const canvasHeight = this.canvas.clientHeight;
    
    // 确保渲染器尺寸与 CSS 尺寸一致
    this.app.renderer.resize(canvasWidth, canvasHeight);
    
    // 使用原始模型尺寸或当前边界框
    let modelWidth: number;
    let modelHeight: number;
    
    if (this.originalModelBounds) {
      modelWidth = this.originalModelBounds.width;
      modelHeight = this.originalModelBounds.height;
    } else {
      // 回退方案：获取当前边界框并除以当前缩放比例
      const currentScale = model.scale.x || 1;
      modelWidth = model.width / currentScale;
      modelHeight = model.height / currentScale;
    }
    
    // 计算合适的缩放比例（保持75%的窗口占用，留出边距）
    const targetWidthRatio = 0.75;
    const targetHeightRatio = 0.75;
    
    const scaleX = (canvasWidth * targetWidthRatio) / modelWidth;
    const scaleY = (canvasHeight * targetHeightRatio) / modelHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // 应用缩放
    model.scale.set(scale);
    
    // 居中显示（X轴中心，Y轴居中）
    model.x = canvasWidth / 2;
    model.y = canvasHeight / 2;
    
    console.log('模型位置调整:', {
      originalSize: this.originalModelBounds,
      scale,
      position: { x: model.x, y: model.y },
      displaySize: { width: model.width, height: model.height },
      canvas: { width: canvasWidth, height: canvasHeight }
    });
  }

  /**
   * 播放动作
   * @param motionGroup - 动作组
   * @param motionIndex - 动作索引
   * @param _priority - 优先级
   */
  public playMotion(motionGroup: string, motionIndex: number = 0, _priority: number = 2): void {
    if (!this.model) {
      console.warn('模型未加载');
      return;
    }

    try {
      const model = this.model as any;
      
      // 使用 pixi-live2d-display 的动作播放
      if (model.internalModel && model.internalModel.motionManager) {
        model.motion(motionGroup, motionIndex);
        console.log(`播放动作: ${motionGroup}[${motionIndex}]`);
        this.currentMotion = `${motionGroup}[${motionIndex}]`;
      } else {
        console.warn('模型不支持动作播放');
      }
    } catch (error) {
      console.error('播放动作失败:', error);
    }
  }

  /**
   * 设置表情
   * @param expressionId - 表情ID
   */
  public setExpression(expressionId: string): void {
    if (!this.model) {
      console.warn('模型未加载');
      return;
    }

    try {
      const model = this.model as any;
      
      // 使用 pixi-live2d-display 的表情设置
      if (model.internalModel && model.internalModel.motionManager) {
        model.expression(expressionId);
        console.log(`设置表情: ${expressionId}`);
        this.currentExpression = expressionId;
      } else {
        console.warn('模型不支持表情设置');
      }
    } catch (error) {
      console.error('设置表情失败:', error);
    }
  }

  /**
   * 视线跟随
   * @param x - 鼠标 X 坐标
   * @param y - 鼠标 Y 坐标
   */
  public lookAt(x: number, y: number): void {
    if (!this.model) return;

    try {
      const model = this.model as any;
      
      // 计算相对于模型中心的位置
      const modelX = model.x;
      const modelY = model.y;
      
      // 归一化坐标 (-1 到 1)
      const normalizedX = (x - modelX) / (this.canvas.width / 2);
      const normalizedY = (y - modelY) / (this.canvas.height / 2);
      
      // 使用 pixi-live2d-display 的视线跟随功能
      if (model.internalModel && model.internalModel.coreModel) {
        // Focus 控制视线方向  
        model.focus(normalizedX * 30, -normalizedY * 30);
      }
    } catch (error) {
      // 忽略视线跟随错误
    }
  }

  /**
   * 点击模型时的反应
   * @param x - 点击 X 坐标
   * @param y - 点击 Y 坐标
   */
  public tap(x: number, y: number): void {
    if (!this.model) return;

    console.log('点击模型:', x, y);
    
    const model = this.model as any;
    
    // 触发点击测试
    if (model.internalModel) {
      const hitAreaNames = model.internalModel.hitTest(x, y);
      if (hitAreaNames && hitAreaNames.length > 0) {
        console.log('命中区域:', hitAreaNames);
        // 播放点击反应动作
        this.playMotion('TapBody', 0, 3);
      }
    } else {
      // 如果没有命中测试，播放默认动作
      this.playMotion('TapBody', 0, 3);
    }
  }

  /**
   * 销毁 Live2D
   */
  public destroy(): void {
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.model = null;
    this.initialized = false;
  }
}

// 导出全局实例
window.live2dManager = new Live2DManager('live2d-canvas');
