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
      this.app = new PIXI.Application({
        view: this.canvas,
        width: 400,
        height: 600,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      });

      console.log('Live2D 初始化成功');
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
        autoInteract: true,  // 启用自动交互
        autoUpdate: true     // 启用自动更新
      });
      
      this.model = live2dModel as any;
      
      if (this.app) {
        // 添加到舞台
        this.app.stage.addChild(live2dModel as any);
        
        // 调整模型位置和大小
        this.adjustModelTransform();
        
        // 设置模型交互
        this.setupModelInteraction(live2dModel);
      }
      
      console.log('模型加载成功');
      return true;
    } catch (error) {
      console.error('模型加载失败:', error);
      throw error;
    }
  }

  /**
   * 设置模型交互
   */
  private setupModelInteraction(model: any): void {
    // 监听点击事件
    model.on('hit', (hitAreas: string[]) => {
      console.log('点击了模型区域:', hitAreas);
      
      // 播放相应的动作
      if (hitAreas.includes('Body') || hitAreas.includes('body')) {
        this.playMotion('TapBody', 0, 3);
      } else if (hitAreas.includes('Head') || hitAreas.includes('head')) {
        this.playMotion('TapHead', 0, 3);
      }
    });
    
    // 启用交互模式
    model.interactive = true;
    model.buttonMode = true;
  }

  /**
   * 调整模型位置和大小
   */
  public adjustModelTransform(): void {
    if (!this.model || !this.app) return;

    const model = this.model as any;
    
    // 计算合适的缩放比例
    const scaleX = (this.canvas.width * 0.8) / model.width;
    const scaleY = (this.canvas.height * 0.8) / model.height;
    const scale = Math.min(scaleX, scaleY);
    
    model.scale.set(scale);
    
    // 居中显示
    model.x = this.canvas.width / 2;
    model.y = this.canvas.height / 2 + 50;
    
    // 设置锚点为中心
    model.anchor?.set(0.5, 0.5);
    
    console.log('模型位置调整:', {
      scale,
      x: model.x,
      y: model.y,
      width: model.width,
      height: model.height
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
